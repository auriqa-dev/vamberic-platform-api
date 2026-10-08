import { z } from "zod";
import type { Document } from "mongodb";
import {
  OfferDesignRecordSchema,
  OfferRecordSchema,
  OfferRevisionSchema,
} from "../domain/offers";
import { HIVE_MONGO_VALIDATORS } from "./hive-validators";

/** Code-owned structure compiler, scoped to Offer schemas. Not an executable user schema language.
 * Unknown Zod types/checks fail at startup rather than silently dropping validation.
 * Refinements are enforced by the service, with document lifecycle predicates below.
 */
export function offerMongoStructure(schema: z.ZodTypeAny): Document {
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodDefault)
    return offerMongoStructure(schema._def.innerType);
  if (schema instanceof z.ZodEffects)
    return offerMongoStructure(schema._def.schema);
  if (schema instanceof z.ZodDiscriminatedUnion || schema instanceof z.ZodUnion)
    return {
      anyOf: schema.options.map((s: z.ZodTypeAny) => offerMongoStructure(s)),
    };
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodTypeAny>;
    const required = Object.entries(shape)
      .filter(([, s]) => !s.isOptional())
      .map(([k]) => k);
    return {
      bsonType: "object",
      additionalProperties: false,
      properties: Object.fromEntries(
        Object.entries(shape).map(([k, s]) => [k, offerMongoStructure(s)]),
      ),
      ...(required.length ? { required } : {}),
    };
  }

  if (schema instanceof z.ZodString) {
    const result: Document = { bsonType: "string" };
    for (const c of schema._def.checks) {
      if (c.kind === "min") result.minLength = c.value;
      else if (c.kind === "max") result.maxLength = c.value;
      else if (c.kind === "regex") result.pattern = c.regex.source;
      else if (c.kind === "datetime")
        result.pattern =
          "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?Z$";
      else if (!["trim", "toUpperCase", "url"].includes(c.kind))
        throw new Error("Unsupported Offer string constraint");
    }
    if (
      schema._def.checks.some((c) => c.kind === "trim") &&
      result.minLength > 0 &&
      !result.pattern
    )
      result.pattern = "\\S";
    return result;
  }
  if (schema instanceof z.ZodNumber) {
    const result: Document = { bsonType: ["int", "long", "double"] };
    // Zod checks compose by intersection, including the bounds added by safe().
    const bound = (
      side: "minimum" | "maximum",
      value: number,
      inclusive: boolean,
    ) => {
      if (!Number.isFinite(value)) throw new Error("Unsupported numeric bound");
      const exclusive =
        side === "minimum" ? "exclusiveMinimum" : "exclusiveMaximum";
      const previous = result[side];
      if (
        previous === undefined ||
        (side === "minimum" ? value > previous : value < previous)
      ) {
        result[side] = value;
        delete result[exclusive];
        if (!inclusive) result[exclusive] = true;
      } else if (value === previous && !inclusive) result[exclusive] = true;
    };
    for (const c of schema._def.checks) {
      if (c.kind === "int") result.multipleOf = 1;
      else if (c.kind === "min") bound("minimum", c.value, c.inclusive);
      else if (c.kind === "max") bound("maximum", c.value, c.inclusive);
      else if (c.kind === "finite") {
        bound("minimum", -Number.MAX_VALUE, true);
        bound("maximum", Number.MAX_VALUE, true);
      } else throw new Error("Unsupported Offer number constraint");
    }
    if (result.minimum !== undefined && result.maximum !== undefined) {
      const empty =
        result.minimum > result.maximum ||
        (result.minimum === result.maximum &&
          (result.exclusiveMinimum || result.exclusiveMaximum));
      const integerMin =
        Math.ceil(result.minimum) +
        (result.exclusiveMinimum && Number.isInteger(result.minimum) ? 1 : 0);
      const integerMax =
        Math.floor(result.maximum) -
        (result.exclusiveMaximum && Number.isInteger(result.maximum) ? 1 : 0);
      if (empty || (result.multipleOf === 1 && integerMin > integerMax))
        throw new Error("Contradictory numeric constraints");
    }
    return result;
  }
  if (schema instanceof z.ZodEnum) return { enum: schema.options };
  if (schema instanceof z.ZodLiteral) return { enum: [schema.value] };
  if (schema instanceof z.ZodBoolean) return { bsonType: "bool" };
  if (schema instanceof z.ZodDate) return { bsonType: "date" };
  if (schema instanceof z.ZodArray)
    return {
      bsonType: "array",
      items: offerMongoStructure(schema.element),
      ...(schema._def.minLength
        ? { minItems: schema._def.minLength.value }
        : {}),
      ...(schema._def.maxLength
        ? { maxItems: schema._def.maxLength.value }
        : {}),
    };
  throw new Error("Unsupported Offer schema type");
}
function root(schema: z.ZodTypeAny) {
  const result = offerMongoStructure(schema);
  result.properties._id = {};
  return result;
}
const designStructure = root(OfferDesignRecordSchema);
const offerStructure = root(OfferRecordSchema);
const revisionStructure = root(OfferRevisionSchema);
// Keep source currency semantics tied to the same runtime ISO catalogue as the shared money primitive.
function currencies(value: Document) {
  if (value.properties?.type?.enum?.includes("human") && value.properties?.id)
    value.properties.id.pattern = "^(?!partner_)[\\s\\S]*\\S";
  for (const [k, v] of Object.entries(value)) {
    if (k === "currency" && v?.bsonType === "string")
      v.enum = Intl.supportedValuesOf("currency");
    if (
      [
        "targetIcpIds",
        "targetBuyerProfileIds",
        "completedStageKeys",
        "selectedOptionKeys",
      ].includes(k) &&
      v?.bsonType === "array"
    )
      v.uniqueItems = true;
    if (v && typeof v === "object") currencies(v);
  }
}
for (const schema of [designStructure, offerStructure, revisionStructure])
  currencies(schema);
const offerLifecycle = HIVE_MONGO_VALIDATORS.offerings.$and[1];
const historyLifecycle =
  HIVE_MONGO_VALIDATORS.hive_definition_revisions.$and[0];
// Reuse document-local predicates at both current and historical paths. Catalogue
// lookup/completion, semantic hashing and cross-collection authority stay in services.
const array = (path: string): Document => ({
  $cond: [{ $isArray: path }, path, []],
});
const present = (path: string): Document => ({
  $ne: [{ $type: path }, "missing"],
});
const every = (input: Document, as: string, condition: Document): Document => ({
  $allElementsTrue: [{ $map: { input, as, in: condition } }],
});
const keys = (input: Document, as: string, path: string): Document => ({
  $map: { input, as, in: path },
});
const unique = (input: Document): Document => ({
  $eq: [{ $size: input }, { $size: { $setUnion: [input, []] } }],
});
function researchRules(path: string): Document {
  return every(array(`${path}.findings`), "finding", {
    $gt: [
      {
        $size: {
          $filter: {
            input: array("$$finding.sources"),
            as: "source",
            cond: { $eq: ["$$source.kind", "external_evidence"] },
          },
        },
      },
      0,
    ],
  });
}
function designRules(path: string): Document {
  const stages = array(`${path}.work.stages`);
  const completed = keys(
    {
      $filter: {
        input: stages,
        as: "stage",
        cond: { $eq: ["$$stage.status", "completed"] },
      },
    },
    "stage",
    "$$stage.stageKey",
  );
  const archived = { $ifNull: [`${path}.archived`, false] };
  return {
    $and: [
      { $gte: [`${path}.updatedAt`, `${path}.createdAt`] },
      { $eq: [archived, present(`${path}.archivedAt`)] },
      { $eq: [archived, { $eq: [`${path}.status`, "abandoned"] }] },
      {
        $or: [
          { $not: [present(`${path}.archivedAt`)] },
          {
            $and: [
              { $gte: [`${path}.archivedAt`, `${path}.createdAt`] },
              { $lte: [`${path}.archivedAt`, `${path}.updatedAt`] },
            ],
          },
        ],
      },
      {
        $or: [
          { $ne: [`${path}.status`, "completed"] },
          present(`${path}.sourceRevisions`),
        ],
      },
      {
        $or: [
          {
            $not: [
              { $in: [`${path}.status`, ["ready_for_review", "completed"]] },
            ],
          },
          {
            $and: [
              present(`${path}.work.competitiveAnalysis`),
              { $gt: [{ $size: array(`${path}.work.targetIcpIds`) }, 0] },
            ],
          },
        ],
      },
      unique(keys(stages, "stage", "$$stage.stageKey")),
      { $setEquals: [completed, array(`${path}.work.completedStageKeys`)] },
      every(stages, "stage", {
        $let: {
          vars: {
            optionKeys: keys(
              array("$$stage.optionsConsidered"),
              "option",
              "$$option.key",
            ),
            evidenceKeys: keys(
              array("$$stage.evidence"),
              "evidence",
              "$$evidence.key",
            ),
          },
          in: {
            $and: [
              unique(array("$$optionKeys")),
              unique(array("$$evidenceKeys")),
              {
                $setEquals: [
                  array("$$stage.selectedOptionKeys"),
                  keys(
                    {
                      $filter: {
                        input: array("$$stage.optionsConsidered"),
                        as: "option",
                        cond: { $eq: ["$$option.status", "selected"] },
                      },
                    },
                    "option",
                    "$$option.key",
                  ),
                ],
              },
              every(
                {
                  $concatArrays: [
                    array("$$stage.research"),
                    array("$$stage.facts"),
                    array("$$stage.agentFindings"),
                    array("$$stage.assumptions"),
                  ],
                },
                "artifact",
                {
                  $setIsSubset: [
                    array("$$artifact.evidenceReferenceKeys"),
                    "$$evidenceKeys",
                  ],
                },
              ),
              every(array("$$stage.optionsConsidered"), "option", {
                $and: [
                  {
                    $or: [
                      { $eq: ["$$option.status", "considered"] },
                      present("$$option.rationale"),
                    ],
                  },
                  {
                    $or: [
                      {
                        $ne: [
                          {
                            $ifNull: ["$$option.requiresOfferingChange", false],
                          },
                          true,
                        ],
                      },
                      present("$$option.requiredOfferingChange"),
                    ],
                  },
                ],
              }),
              {
                $or: [
                  { $ne: ["$$stage.status", "completed"] },
                  present("$$stage.decisionRationale"),
                ],
              },
            ],
          },
        },
      }),
      researchRules(`${path}.work.competitiveAnalysis`),
    ],
  };
}
function offerRules(path: string): Document {
  const prices = {
    $concatArrays: [
      array(`${path}.definition.commercialTerms.options`),
      keys(
        array(`${path}.definition.components`),
        "component",
        "$$component.commercialEffect",
      ),
    ],
  };
  return {
    $and: [
      researchRules(`${path}.competitiveAnalysis`),
      every(prices, "price", {
        $or: [
          { $ne: ["$$price.pricingModel", "free"] },
          { $not: [present("$$price.price")] },
          { $eq: ["$$price.price.amountMinor", 0] },
        ],
      }),
      {
        $or: [
          { $ne: [`${path}.status`, "approved"] },
          {
            $and: [
              present(`${path}.lineage`),
              present(`${path}.competitiveAnalysis`),
            ],
          },
        ],
      },
    ],
  };
}
export const OFFER_MONGO_VALIDATORS: Record<string, Document> = {
  offer_designs: {
    $and: [{ $jsonSchema: designStructure }, { $expr: designRules("$$ROOT") }],
  },
  offers: {
    $and: [
      { $jsonSchema: offerStructure },
      offerLifecycle,
      { $expr: offerRules("$$ROOT") },
    ],
  },
  offer_revisions: {
    $and: [
      { $jsonSchema: revisionStructure },
      historyLifecycle,
      { "snapshot.status": "approved" },
      {
        $expr: {
          $and: [
            offerRules("$snapshot"),
            { $eq: ["$workspaceId", "$snapshot.workspaceId"] },
            { $eq: ["$offerId", "$snapshot.id"] },
            { $eq: ["$revision", "$snapshot.revision"] },
            {
              $cond: [
                present("$designSnapshot"),
                {
                  $and: [
                    designRules("$designSnapshot"),
                    { $eq: ["$designSnapshot.status", "completed"] },
                    { $eq: ["$designSnapshot.id", "$snapshot.offerDesignId"] },
                    { $eq: ["$designSnapshot.workspaceId", "$workspaceId"] },
                  ],
                },
                true,
              ],
            },
          ],
        },
      },
    ],
  },
};
