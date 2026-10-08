import { z } from "zod";
import { operatingJsonSize } from "./operating-json-size";
import type { Document } from "mongodb";
import {
  OperatingRecordSchemas,
  OperatingRecordSchemasV9,
  OperatingRecordSchemasV10,
} from "../domain/operating";
import { offerMongoStructure } from "./offer-validators";
// Additive compiler wrapper: never alters the published v8 structures/compiler.
function structure(schema: z.ZodTypeAny): Document {
  if (schema instanceof z.ZodEffects) return structure(schema._def.schema);
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodDefault)
    return structure(schema._def.innerType);
  if (schema instanceof z.ZodNullable)
    return { anyOf: [structure(schema._def.innerType), { bsonType: "null" }] };
  if (schema instanceof z.ZodObject) {
    const properties = Object.fromEntries(
      Object.entries(schema.shape as z.ZodRawShape).map(([k, v]) => [
        k,
        structure(v),
      ]),
    );
    const required = Object.entries(schema.shape as z.ZodRawShape)
      .filter(([, v]) => !v.isOptional())
      .map(([k]) => k);
    return {
      bsonType: "object",
      additionalProperties: false,
      properties,
      ...(required.length ? { required } : {}),
    };
  }
  if (schema instanceof z.ZodArray) {
    const a = offerMongoStructure(z.array(z.string()));
    a.items = structure(schema.element);
    if (schema._def.minLength) a.minItems = schema._def.minLength.value;
    if (schema._def.maxLength) a.maxItems = schema._def.maxLength.value;
    return a;
  }
  const result = offerMongoStructure(schema);
  if (schema instanceof z.ZodString) {
    for (const check of schema._def.checks) {
      if (check.kind === "datetime")
        result.pattern = z.datetimeRegex(check).source;
      if (check.kind === "url") {
        // URL parser semantics remain reviewed separately from structural bounds.
        // Preserve an existing stricter issuer pattern when present.
        result.pattern ??= String.raw`^[\x00-\x20]*[A-Za-z][A-Za-z0-9+.\t\r\n-]*:`;
      }
    }
  }
  return result;
}
const arr = (p: string): Document => ({ $cond: [{ $isArray: p }, p, []] });
const has = (p: string): Document => ({ $ne: [{ $type: p }, "missing"] });
const all = (input: Document, condition: Document): Document => ({
  $allElementsTrue: [{ $map: { input, as: "item", in: condition } }],
});
// Build local refinements for every occurrence, including nested commercial snapshots.
function local(schema: Document, p: string): Document[] {
  if (schema.anyOf) return schema.anyOf.flatMap((s: Document) => local(s, p));
  const props = schema.properties as Record<string, Document> | undefined;
  const rules: Document[] = [];
  if (schema.bsonType === "string" && schema.maxLength !== undefined) {
    const text = { $cond: [{ $eq: [{ $type: p }, "string"] }, p, ""] };
    rules.push({
      $lte: [
        {
          $add: [
            { $strLenCP: text },
            {
              $size: {
                $regexFindAll: {
                  input: text,
                  regex: "[\\x{10000}-\\x{10FFFF}]",
                },
              },
            },
          ],
        },
        schema.maxLength,
      ],
    });
  }
  if (
    schema.bsonType === "string" &&
    schema.minLength === 1 &&
    schema.pattern === "\\S"
  ) {
    rules.push({
      $ne: [
        {
          $trim: {
            input: { $cond: [{ $eq: [{ $type: p }, "string"] }, p, ""] },
            chars:
              "\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff",
          },
        },
        "",
      ],
    });
  }
  if (schema.bsonType === "date") {
    const epoch = { $convert: { input: p, to: "long", onError: 0, onNull: 0 } };
    rules.push({ $lte: [{ $abs: epoch }, 8640000000000000] });
  }
  if (props) {
    if (
      props.maker &&
      props.evaluator &&
      props.revision &&
      props.profile &&
      props.policy
    )
      rules.push({
        $or: [
          { $not: [has(p)] },
          {
            $eq: [
              {
                $size: {
                  $setUnion: [
                    [`${p}.maker`, `${p}.evaluator`, `${p}.revision`],
                    [],
                  ],
                },
              },
              3,
            ],
          },
        ],
      });
    if (props.currency)
      props.currency.enum = Intl.supportedValuesOf("currency");
    if (props.type?.enum?.includes("human") && props.id)
      props.id.pattern = "^(?!partner_)[\\s\\S]*\\S";
    if (props.key && props.text && props.number && props.boolean)
      rules.push({
        $eq: [
          {
            $add: ["text", "number", "boolean"].map((k) => ({
              $cond: [has(`${p}.${k}`), 1, 0],
            })),
          },
          1,
        ],
      });
    if (props.minimumProviders && props.required)
      rules.push({
        $or: [
          { $ne: [`${p}.required`, true] },
          { $gt: [`${p}.minimumProviders`, 0] },
        ],
      });
    if (props.minimumMargin && props.targetMargin)
      rules.push({ $lte: [`${p}.minimumMargin`, `${p}.targetMargin`] });
    if (props.effectiveFrom && props.effectiveUntil)
      rules.push({
        $or: [
          { $not: [has(`${p}.effectiveUntil`)] },
          { $gt: [`${p}.effectiveUntil`, `${p}.effectiveFrom`] },
        ],
      });
    if (props.adjustment && props.commitment) {
      rules.push(
        {
          $eq: [
            { $eq: [`${p}.adjustment.kind`, "percentage_discount"] },
            has(`${p}.adjustment.percentage`),
          ],
        },
        {
          $eq: [
            { $in: [`${p}.adjustment.kind`, ["fixed_discount", "custom"]] },
            has(`${p}.adjustment.amountMinor`),
          ],
        },
        {
          $or: [
            { $ne: [`${p}.commitment.kind`, "monthly"] },
            { $eq: [`${p}.commitment.months`, 1] },
          ],
        },
        {
          $or: [
            { $ne: [`${p}.commitment.kind`, "annual"] },
            { $eq: [`${p}.commitment.months`, 12] },
          ],
        },
        {
          $or: [
            { $ne: [`${p}.billingFrequency`, "annual"] },
            { $gte: [`${p}.commitment.months`, 12] },
          ],
        },
      );
    }
    for (const [key, child] of Object.entries(props)) {
      const path = `${p}.${key}`;
      if (child.bsonType === "array") {
        const element = child.items as Document;
        if (element.pattern && /Ids$/.test(key)) child.uniqueItems = true;
        if (
          [
            "configuration",
            "requiredAgents",
            "recommendedAgents",
            "optionalAgents",
            "compatibleAgents",
          ].includes(key)
        ) {
          const field = key === "configuration" ? "key" : "id";
          const mapped = {
            $map: { input: arr(path), as: "entry", in: `$$entry.${field}` },
          };
          rules.push({
            $eq: [{ $size: arr(path) }, { $size: { $setUnion: [mapped, []] } }],
          });
        }
        const nested = local(element, "$$item");
        if (nested.length) rules.push(all(arr(path), { $and: nested }));
      } else {
        const nested = local(child, path);
        if (schema.required?.includes(key)) rules.push(...nested);
        else if (nested.length)
          rules.push({ $cond: [has(path), { $and: nested }, true] });
      }
    }
  }
  return rules;
}
function validators(
  records: typeof OperatingRecordSchemas,
): Record<string, Document> {
  return Object.fromEntries(
    Object.entries(records).map(([name, schema]) => {
      const json = structure(schema);
      json.properties._id = {};
      const rules = [operatingJsonSize(schema), ...local(json, "$$ROOT")];
      return [
        name,
        {
          $and: [
            { $jsonSchema: json },
            {
              $expr: {
                $and: [
                  { $gte: ["$updatedAt", "$createdAt"] },
                  {
                    $eq: [
                      { $ifNull: ["$archived", false] },
                      has("$archivedAt"),
                    ],
                  },
                  {
                    $eq: [
                      { $eq: ["$status", "retired"] },
                      { $ifNull: ["$archived", false] },
                    ],
                  },
                  {
                    $or: [
                      { $not: [has("$archivedAt")] },
                      {
                        $and: [
                          { $gte: ["$archivedAt", "$createdAt"] },
                          { $lte: ["$archivedAt", "$updatedAt"] },
                        ],
                      },
                    ],
                  },
                  ...rules,
                ],
              },
            },
          ],
        },
      ];
    }),
  );
}
export const EFFECTIVENESS_OPERATING_MONGO_VALIDATORS = validators(
  OperatingRecordSchemas,
);
export const CONTROL_PLANE_OPERATING_MONGO_VALIDATORS = validators(
  OperatingRecordSchemasV10,
);
export const OPERATING_V9_MONGO_VALIDATORS = validators(
  OperatingRecordSchemasV9,
);

// Keep canonical setup at the installed v9 contract until the complete control-plane
// migration and all new validator parity checks are ready for registration.
export const OPERATING_MONGO_VALIDATORS = OPERATING_V9_MONGO_VALIDATORS;
