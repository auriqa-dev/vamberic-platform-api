import { z } from "zod";
import type { Document } from "mongodb";
import {
  AgentRunSchemaV10 as AgentRunSchema,
  AgentAttemptSchema,
  AgentResultSchemaV10 as AgentResultSchema,
  AgentUsageSchema,
} from "../domain/agent-control-plane";
import { offerMongoStructure } from "./offer-validators";
import {
  protocolArtifacts,
  protocolMongoStructure,
  protocolTextBounds,
} from "./agent-protocol-validators";
import { agentJsonIntegrity } from "./agent-json-integrity";
const arr = (path: string) => ({ $cond: [{ $isArray: path }, path, []] });
const exists = (path: string) => ({ $ne: [{ $type: path }, "missing"] });
const every = (path: string, variable: string, condition: unknown) => ({
  $allElementsTrue: [
    { $map: { input: arr(path), as: variable, in: condition } },
  ],
});
const unique = (path: string, field?: string) => {
  const values = field
    ? {
        $map: {
          input: arr(path),
          as: "uniqueEntry",
          in: `$$uniqueEntry.${field}`,
        },
      }
    : arr(path);
  return {
    $eq: [{ $size: arr(path) }, { $size: { $setUnion: [values, []] } }],
  };
};
const optional = (path: string, condition: unknown) => ({
  $cond: [exists(path), condition, true],
});
const date = (path: string) => ({
  $convert: { input: path, to: "date", onError: null, onNull: null },
});
const and = (...checks: unknown[]): Document => ({ $and: checks });
function bounded(path: string | Document, bytes: number) {
  return agentJsonIntegrity(path, bytes);
}
function projection(path: string) {
  return and(
    unique(path),
    every(path, "field", {
      $eq: [
        {
          $size: {
            $setIntersection: [
              { $split: ["$$field", "."] },
              ["__proto__", "constructor", "prototype"],
            ],
          },
        },
        0,
      ],
    }),
  );
}
const referenceKey = (path: string) =>
  [
    "resourceType",
    "id",
    "workspaceId",
    "version",
    "revision",
    "contentHash",
  ].map((k) => ({ $ifNull: [`${path}.${k}`, null] }));
const uniqueKeys = (path: string, keys: unknown) => ({
  $eq: [{ $size: arr(path) }, { $size: { $setUnion: [keys, []] } }],
});
function frozenWork(path: string) {
  const grant = `${path}.grant`;
  const grants = arr(`${grant}.resources`);
  const readGrant = (reference: string) => ({
    $filter: {
      input: grants,
      as: "granted",
      cond: {
        $eq: [referenceKey("$$granted.reference"), referenceKey(reference)],
      },
    },
  });
  const permittedFields = (reference: string, fields: string) => ({
    $anyElementTrue: [
      {
        $map: {
          input: readGrant(reference),
          as: "readGrant",
          in: { $setIsSubset: [arr(fields), arr("$$readGrant.fields")] },
        },
      },
    ],
  });
  return and(
    bounded(
      {
        $mergeObjects: [
          path,
          {
            $literal: {
              attemptId: "validation",
              generation: 1,
              fence: 1,
              lease: {
                id: "validation",
                workerId: "validation",
                expiresAt: "9999-12-31T23:59:59.999Z",
              },
            },
          },
        ],
      },
      262144,
    ),
    bounded(`${path}.input`, 32768),
    bounded(`${path}.clientAgent.configuration`, 32768),
    bounded(grant, 131072),
    { $eq: [`${path}.runId`, `${grant}.runId`] },
    { $eq: [`${path}.workspaceId`, `${grant}.workspaceId`] },
    every(
      `${grant}.resources`,
      "resource",
      and(projection("$$resource.fields"), {
        $eq: ["$$resource.reference.workspaceId", `${path}.workspaceId`],
      }),
    ),
    every(`${grant}.proposalTargets`, "target", {
      $cond: [
        { $eq: ["$$target.kind", "update"] },
        { $eq: ["$$target.reference.workspaceId", `${path}.workspaceId`] },
        every("$$target.parents", "parent", {
          $eq: ["$$parent.reference.workspaceId", `${path}.workspaceId`],
        }),
      ],
    }),
    every(
      `${grant}.tools`,
      "tool",
      optional("$$tool.bindingId", {
        $in: ["$$tool.bindingId", arr(`${grant}.bindings`)],
      }),
    ),
    unique(`${grant}.bindings`),
    unique(`${grant}.budgets.providerCalls`, "provider"),
    every(`${grant}.tools`, "tool", {
      $cond: [
        { $eq: ["$$tool.class", "external_mutation"] },
        exists("$$tool.authorizedOperationId"),
        true,
      ],
    }),
    uniqueKeys(`${grant}.resources`, {
      $map: { input: grants, as: "g", in: referenceKey("$$g.reference") },
    }),
    uniqueKeys(`${grant}.tools`, {
      $map: {
        input: arr(`${grant}.tools`),
        as: "g",
        in: [
          "$$g.key",
          "$$g.version",
          "$$g.operation",
          { $ifNull: ["$$g.bindingId", ""] },
        ],
      },
    }),
    uniqueKeys(`${grant}.models`, {
      $map: {
        input: arr(`${grant}.models`),
        as: "g",
        in: ["$$g.provider", "$$g.model", "$$g.purpose"],
      },
    }),
    ...["references", "snapshots"].map((field) =>
      every(
        `${path}.context.${field}`,
        "context",
        and(
          projection("$$context.fields"),
          permittedFields("$$context.reference", "$$context.fields"),
        ),
      ),
    ),
    every(
      `${path}.context.snapshots`,
      "snapshot",
      bounded("$$snapshot.payload", 32768),
    ),
    every(
      `${path}.lineage`,
      "source",
      and(lineage("$$source"), {
        $cond: [
          { $eq: ["$$source.source.kind", "resource"] },
          and(
            {
              $eq: [
                "$$source.source.reference.workspaceId",
                `${path}.workspaceId`,
              ],
            },
            {
              $or: [
                { $gt: [{ $size: readGrant("$$source.source.reference") }, 0] },
                and(
                  { $eq: ["$$source.role", "proposal_base"] },
                  {
                    $anyElementTrue: [
                      {
                        $map: {
                          input: arr(`${grant}.proposalTargets`),
                          as: "target",
                          in: and(
                            { $eq: ["$$target.kind", "update"] },
                            {
                              $eq: [
                                referenceKey("$$target.reference"),
                                referenceKey("$$source.source.reference"),
                              ],
                            },
                          ),
                        },
                      },
                    ],
                  },
                ),
              ],
            },
            optional(
              "$$source.fields",
              permittedFields("$$source.source.reference", "$$source.fields"),
            ),
          ),
          true,
        ],
      }),
    ),
  );
}
function usage(path: string) {
  return and(
    bounded(path, 16384),
    unique(`${path}.quantities`, "unit"),
    {
      $eq: [
        { $subtract: [date(`${path}.endedAt`), date(`${path}.startedAt`)] },
        `${path}.durationMs`,
      ],
    },
    optional(`${path}.retryOf`, { $ne: [`${path}.retryOf`, `${path}.id`] }),
    optional(`${path}.supersedes`, {
      $ne: [`${path}.supersedes`, `${path}.id`],
    }),
    {
      $cond: [
        { $eq: [`${path}.category`, "model"] },
        exists(`${path}.model`),
        exists(`${path}.tool`),
      ],
    },
  );
}
function lineage(path: string) {
  return and(
    bounded(path, 8192),
    { $lte: [`${path}.observedAt`, `${path}.fetchedAt`] },
    optional(`${path}.fields`, projection(`${path}.fields`)),
  );
}
function checkpoint(path: string) {
  return and(
    bounded(path, 65536),
    bounded(`${path}.payload`, 32768),
    unique(`${path}.completedInvocationIds`),
    every(
      `${path}.lineage`,
      "checkpointLineage",
      lineage("$$checkpointLineage"),
    ),
  );
}
function inputRequest(path: string) {
  return and(
    bounded(path, 32768),
    unique(`${path}.fields`, "key"),
    every(
      `${path}.fields`,
      "inputField",
      and(
        {
          $cond: [
            { $eq: ["$$inputField.type", "choice"] },
            unique("$$inputField.options", "value"),
            true,
          ],
        },
        {
          $cond: [
            { $eq: ["$$inputField.type", "number"] },
            { $lte: ["$$inputField.minimum", "$$inputField.maximum"] },
            true,
          ],
        },
      ),
    ),
  );
}
function inputResponse(path: string) {
  return and(bounded(path, 32768), unique(`${path}.values`, "key"));
}
function content(path: string) {
  return and(
    bounded(path, 262144),
    ...[
      "findings",
      "evidence",
      "proposals",
      "artifacts",
      "assumptions",
      "unknowns",
      "knowledgeGaps",
      "lineage",
    ].map((field) => unique(`${path}.${field}`, "id")),
    optional(`${path}.domainOutput`, bounded(`${path}.domainOutput`, 32768)),
    ...["findings", "proposals", "assumptions", "knowledgeGaps"].map((field) =>
      every(`${path}.${field}`, "supported", {
        $setIsSubset: [
          arr("$$supported.evidenceIds"),
          { $map: { input: arr(`${path}.evidence`), as: "e", in: "$$e.id" } },
        ],
      }),
    ),
    ...["findings", "proposals", "knowledgeGaps"].map((field) =>
      every(`${path}.${field}`, "supported", {
        $setIsSubset: [
          arr("$$supported.lineageIds"),
          { $map: { input: arr(`${path}.lineage`), as: "e", in: "$$e.id" } },
        ],
      }),
    ),
    every(`${path}.knowledgeGaps`, "supported", {
      $setIsSubset: [
        arr("$$supported.findingIds"),
        { $map: { input: arr(`${path}.findings`), as: "e", in: "$$e.id" } },
      ],
    }),
    every(
      `${path}.knowledgeGaps`,
      "gap",
      and(
        bounded("$$gap", 8192),
        unique("$$gap.evidenceIds"),
        unique("$$gap.findingIds"),
        unique("$$gap.lineageIds"),
      ),
    ),
    every(`${path}.lineage`, "lineage", lineage("$$lineage")),
    every(
      `${path}.findings`,
      "finding",
      and(
        bounded("$$finding", 16384),
        optional("$$finding.payload", bounded("$$finding.payload", 32768)),
        {
          $cond: [
            {
              $in: [
                "$$finding.kind",
                ["observed_fact", "evidence_backed_finding", "inference"],
              ],
            },
            { $gt: [{ $size: arr("$$finding.evidenceIds") }, 0] },
            true,
          ],
        },
      ),
    ),
    every(
      `${path}.evidence`,
      "evidence",
      and(
        bounded("$$evidence", 16384),
        optional(
          "$$evidence.candidate",
          bounded("$$evidence.candidate", 32768),
        ),
        { $lte: ["$$evidence.observedAt", "$$evidence.retrievedAt"] },
      ),
    ),
    every(
      `${path}.proposals`,
      "proposal",
      and(bounded("$$proposal", 49152), bounded("$$proposal.candidate", 32768)),
    ),
  );
}
function outcome(path: string) {
  const inner = `${path}.outcome`;
  return and(
    bounded(path, 262144),
    content(`${inner}.content`),
    { $lte: [`${path}.startedAt`, `${path}.endedAt`] },
    {
      $cond: [
        { $eq: [`${inner}.completeness.kind`, "complete"] },
        and(
          { $eq: [`${inner}.kind`, "success"] },
          every(`${inner}.content.knowledgeGaps`, "gap", {
            $ne: ["$$gap.severity", "blocking"],
          }),
        ),
        true,
      ],
    },
    {
      $cond: [
        { $eq: [`${inner}.kind`, "cancelled"] },
        { $eq: [`${inner}.error.code`, "cancelled"] },
        true,
      ],
    },
    {
      $cond: [
        { $eq: [`${inner}.kind`, "failure"] },
        { $ne: [`${inner}.error.code`, "cancelled"] },
        true,
      ],
    },
    optional(
      `${inner}.checkpoint`,
      and(
        checkpoint(`${inner}.checkpoint`),
        { $eq: [`${inner}.checkpoint.runId`, `${path}.runId`] },
        {
          $eq: [
            `${inner}.checkpoint.implementation.key`,
            `${path}.implementation.key`,
          ],
        },
        {
          $eq: [
            `${inner}.checkpoint.implementation.version`,
            `${path}.implementation.version`,
          ],
        },
      ),
    ),
    optional(
      `${inner}.inputRequest`,
      and(
        inputRequest(`${inner}.inputRequest`),
        { $gt: [`${inner}.inputRequest.expiresAt`, `${path}.endedAt`] },
        {
          $eq: [
            `${inner}.inputRequest.checkpoint.id`,
            `${inner}.checkpoint.id`,
          ],
        },
        {
          $eq: [
            `${inner}.inputRequest.checkpoint.digest`,
            `${inner}.checkpoint.digest`,
          ],
        },
      ),
    ),
    unique(`${path}.usage`, "id"),
    every(
      `${path}.usage`,
      "usage",
      and(
        usage("$$usage"),
        { $eq: ["$$usage.runId", `${path}.runId`] },
        { $eq: ["$$usage.attemptId", `${path}.attemptId`] },
      ),
    ),
  );
}
const frozenArtifact = structuredClone(protocolArtifacts.ClaimedWork!);
for (const key of ["attemptId", "generation", "fence", "lease", "resume"]) {
  delete frozenArtifact.properties[key];
  frozenArtifact.required = frozenArtifact.required.filter(
    (k: string) => k !== key,
  );
}
const protocolFields: Record<string, Document> = {
  frozen: frozenArtifact,
  manifest: protocolArtifacts.Manifest!,
  checkpoint: protocolArtifacts.Checkpoint!,
  inputRequest: protocolArtifacts.InputRequest!,
  inputResponse: protocolArtifacts.InputResponse!,
  "inputResponses[]": protocolArtifacts.InputResponse!,
  envelope: protocolArtifacts.Outcome!,
  observation: protocolArtifacts.Usage!,
};
function structural(
  schema: z.ZodTypeAny,
  path = "",
  fields: Record<string, Document> = protocolFields,
): Document {
  if (fields[path]) return protocolMongoStructure(fields[path]!);
  if (schema instanceof z.ZodEffects)
    return structural(schema._def.schema, path, fields);
  if (schema instanceof z.ZodDefault || schema instanceof z.ZodOptional)
    return structural(schema._def.innerType, path, fields);
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as z.ZodRawShape;
    return {
      bsonType: "object",
      additionalProperties: false,
      properties: Object.fromEntries(
        Object.entries(shape).map(([key, child]) => [
          key,
          structural(child, path ? `${path}.${key}` : key, fields),
        ]),
      ),
      required: Object.entries(shape)
        .filter(([, child]) => !child.isOptional())
        .map(([key]) => key),
    };
  }
  if (schema instanceof z.ZodDiscriminatedUnion || schema instanceof z.ZodUnion)
    return {
      anyOf: schema.options.map((child: z.ZodTypeAny) =>
        structural(child, path, fields),
      ),
    };
  if (schema instanceof z.ZodArray)
    return {
      ...offerMongoStructure(z.array(z.string())),
      items: structural(schema.element, path + "[]", fields),
      ...(schema._def.minLength
        ? { minItems: schema._def.minLength.value }
        : {}),
      ...(schema._def.maxLength
        ? { maxItems: schema._def.maxLength.value }
        : {}),
    };
  if (schema instanceof z.ZodNumber) {
    const result = offerMongoStructure(schema);
    const lower = schema._def.checks.filter((c) => c.kind === "min");
    const upper = schema._def.checks.filter((c) => c.kind === "max");
    if (lower.length) {
      result.minimum = Math.max(...lower.map((c) => c.value));
      result.exclusiveMinimum = lower.some(
        (c) => c.value === result.minimum && !c.inclusive,
      );
    }
    if (upper.length) {
      result.maximum = Math.min(...upper.map((c) => c.value));
      result.exclusiveMaximum = upper.some(
        (c) => c.value === result.maximum && !c.inclusive,
      );
    }
    return result;
  }
  return offerMongoStructure(schema);
}
function bsonDateBounds(schema: Document, path: string): Document {
  const checks: unknown[] = [];
  if (
    schema.bsonType === "string" &&
    schema.minLength === 1 &&
    schema.pattern === "\\S"
  )
    checks.push(
      optional(path, {
        $ne: [
          {
            $trim: {
              input: {
                $cond: [{ $eq: [{ $type: path }, "string"] }, path, ""],
              },
              chars:
                "\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff",
            },
          },
          "",
        ],
      }),
    );
  if (schema.properties?.type?.enum?.includes("human") && schema.properties.id)
    checks.push({
      $not: [
        {
          $regexMatch: {
            input: {
              $trim: {
                input: {
                  $cond: [
                    { $eq: [{ $type: `${path}.id` }, "string"] },
                    `${path}.id`,
                    "",
                  ],
                },
                chars:
                  "\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff",
              },
            },
            regex: "^partner_",
          },
        },
      ],
    });
  if (schema.bsonType === "date")
    checks.push({
      $lte: [
        {
          $abs: {
            $convert: { input: path, to: "long", onError: 0, onNull: 0 },
          },
        },
        8640000000000000,
      ],
    });
  for (const [key, child] of Object.entries(schema.properties ?? {}))
    checks.push(bsonDateBounds(child as Document, `${path}.${key}`));
  if (schema.items)
    checks.push(
      every(path, "datedItem", bsonDateBounds(schema.items, "$$datedItem")),
    );
  for (const branch of schema.anyOf ?? [])
    checks.push(bsonDateBounds(branch, path));
  return { $and: checks.length ? checks : [true] };
}
function textShape(schema: Document): Document {
  return {
    ...(schema.bsonType === "string"
      ? {
          type: "string",
          ...(schema.minLength === undefined
            ? {}
            : { minLength: schema.minLength }),
          ...(schema.maxLength === undefined
            ? {}
            : { maxLength: schema.maxLength }),
        }
      : {}),
    ...(schema.properties
      ? {
          properties: Object.fromEntries(
            Object.entries(schema.properties).map(([key, child]) => [
              key,
              textShape(child as Document),
            ]),
          ),
        }
      : {}),
    ...(schema.items ? { items: textShape(schema.items) } : {}),
    ...(schema.anyOf ? { anyOf: schema.anyOf.map(textShape) } : {}),
  };
}
function root(
  schema: z.ZodTypeAny,
  refinements: Document,
  wire: Record<string, Document>,
  fields?: Record<string, Document>,
) {
  const shape = structural(schema, "", fields);
  shape.properties._id = {};
  const checks = Object.entries(wire).map(([path, artifact]) =>
    optional(path, protocolTextBounds(artifact, path)),
  );
  return {
    $and: [
      { $jsonSchema: shape },
      {
        $expr: and(
          { $gte: ["$updatedAt", "$createdAt"] },
          refinements,
          protocolTextBounds(textShape(shape), "$$ROOT", true),
          bsonDateBounds(shape, "$$ROOT"),
          ...checks,
        ),
      },
    ],
  };
}
const runChecks = and(
  { $eq: ["$frozen.runId", "$id"] },
  { $eq: ["$frozen.workspaceId", "$workspaceId"] },
  { $eq: ["$frozen.clientId", "$organisationId"] },
  { $eq: ["$frozen.operation", "$operation"] },
  { $eq: ["$target.kind", "client_agent"] },
  { $eq: ["$frozen.clientAgent.id", "$target.id"] },
  { $eq: ["$frozen.clientAgent.revision", "$target.revision"] },
  { $eq: ["$dispatch.generation", "$generation"] },
  { $gt: ["$deadline", "$createdAt"] },
  { $eq: [{ $eq: ["$status", "running"] }, exists("$activeAttemptId")] },
  {
    $eq: [
      { $in: ["$status", ["completed", "failed", "cancelled"]] },
      exists("$terminalReason"),
    ],
  },
  {
    $cond: [
      { $eq: ["$status", "awaiting_input"] },
      and(exists("$checkpoint"), exists("$inputRequest")),
      true,
    ],
  },
  frozenWork("$frozen"),
  bounded("$manifest", 32768),
  optional("$checkpoint", checkpoint("$checkpoint")),
  optional("$inputRequest", inputRequest("$inputRequest")),
  optional("$inputResponse", inputResponse("$inputResponse")),
  unique("$inputResponses", "requestId"),
  every(
    "$inputResponses",
    "response",
    and(
      inputResponse("$$response"),
      protocolTextBounds(protocolArtifacts.InputResponse!, "$$response"),
    ),
  ),
);
const attemptChecks = and(
  { $gte: ["$startedAt", "$createdAt"] },
  { $gt: ["$leaseUntil", "$startedAt"] },
  { $eq: [{ $ne: ["$status", "running"] }, exists("$endedAt")] },
  optional(
    "$endedAt",
    and(
      { $gte: ["$endedAt", "$startedAt"] },
      { $lte: ["$endedAt", "$updatedAt"] },
    ),
  ),
);
const resultChecks = and(
  outcome("$envelope"),
  { $lte: [date("$envelope.endedAt"), "$createdAt"] },
  { $eq: ["$envelope.runId", "$runId"] },
  { $eq: ["$envelope.attemptId", "$attemptId"] },
  unique("$dispositions", "proposalId"),
  {
    $eq: [
      { $size: arr("$dispositions") },
      { $size: arr("$envelope.outcome.content.proposals") },
    ],
  },
  every(
    "$dispositions",
    "disposition",
    and(
      {
        $in: [
          "$$disposition.proposalId",
          {
            $map: {
              input: arr("$envelope.outcome.content.proposals"),
              as: "proposal",
              in: "$$proposal.id",
            },
          },
        ],
      },
      {
        $eq: [
          { $ne: ["$$disposition.status", "pending"] },
          exists("$$disposition.actor"),
        ],
      },
      {
        $eq: [
          { $ne: ["$$disposition.status", "pending"] },
          exists("$$disposition.at"),
        ],
      },
      {
        $eq: [
          { $eq: ["$$disposition.status", "applied_to_draft"] },
          exists("$$disposition.target"),
        ],
      },
      optional(
        "$$disposition.at",
        and(
          { $gte: ["$$disposition.at", "$createdAt"] },
          { $lte: ["$$disposition.at", "$updatedAt"] },
        ),
      ),
    ),
  ),
);
export const AGENT_CONTROL_PLANE_VALIDATORS: Record<string, Document> = {
  agent_runs: root(AgentRunSchema, runChecks, {
    $frozen: frozenArtifact,
    $manifest: protocolArtifacts.Manifest!,
    $checkpoint: protocolArtifacts.Checkpoint!,
    $inputRequest: protocolArtifacts.InputRequest!,
    $inputResponse: protocolArtifacts.InputResponse!,
  }),
  agent_attempts: root(AgentAttemptSchema, attemptChecks, {}),
  agent_results: root(AgentResultSchema, resultChecks, {
    $envelope: protocolArtifacts.Outcome!,
  }),
  agent_usage_observations: root(
    AgentUsageSchema,
    and(
      usage("$observation"),
      { $eq: ["$createdAt", "$updatedAt"] },
      { $eq: ["$observation.runId", "$runId"] },
      { $eq: ["$observation.attemptId", "$attemptId"] },
      { $eq: ["$observation.workspaceId", "$workspaceId"] },
    ),
    { $observation: protocolArtifacts.Usage! },
  ),
};

export { root as agentValidatorRoot };
