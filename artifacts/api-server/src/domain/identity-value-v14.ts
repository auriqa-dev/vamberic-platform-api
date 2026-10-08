import { z } from "zod";
import { platformIdSchema, applicationIdSchema, EventSchema } from "./schemas";
import {
  ReasoningContextSchema,
  ContactStrategyPolicySchema,
  EvidenceReference,
  KnowledgeRevisionReference,
  validateReasoningSemantics,
} from "./reasoning-foundation";

const key = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
const text = z.string().trim().min(1).max(2000);
const version = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const confidence = z.number().min(0).max(1);
const list = <T extends z.ZodTypeAny>(s: T) => z.array(s).max(50);
const evidence = list(EvidenceReference);
const base = ReasoningContextSchema.pick({
  workspaceId: true,
  createdAt: true,
  updatedAt: true,
  source: true,
});
/** Internal references only. No public URL, cookie, credential or token material. */
export const StateReferenceV14 = z
  .object({
    collection: z.enum([
      "interaction_identities",
      "identity_resolutions",
      "relationship_value_assessments",
      "organisations",
      "people",
      "contact_points",
      "organisation_relationships",
      "product_relationships",
      "crm_tasks",
      "opportunities",
      "campaigns",
      "marketing_permissions",
    ]),
    id: applicationIdSchema,
    digest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const PrivacyContextV14 = z
  .object({
    purpose: key,
    historyUse: z.enum([
      "not_assessed",
      "prohibited",
      "requires_current_authorization",
    ]),
    permissionReferences: list(
      StateReferenceV14.extend({
        collection: z.literal("marketing_permissions"),
      }),
    ),
    evidence,
  })
  .strict();
export const InteractionIdentitySchema = base
  .extend({
    id: platformIdSchema("interactionidentity"),
    kind: key,
    channel: key.optional(),
    namespace: key,
    evidence,
    privacy: PrivacyContextV14,
    // Describes the intended recipient, never proves who used a link.
    communication: z
      .object({
        taskId: platformIdSchema("task").optional(),
        eventId: platformIdSchema("event").optional(),
        intendedPersonId: platformIdSchema("person").optional(),
        intendedContactPointId: platformIdSchema("contact").optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export const IdentityResolutionSchema = base
  .extend({
    id: platformIdSchema("identityresolution"),
    identityId: platformIdSchema("interactionidentity"),
    personId: platformIdSchema("person").optional(),
    status: z.enum(["unresolved", "resolved", "revoked"]),
    method: key,
    basis: z.enum(["unknown", "deterministic", "non_deterministic"]),
    relationship: z.enum(["observed_person", "intended_recipient"]),
    evidence,
    confidence,
    validFrom: z.date(),
    validUntil: z.date().optional(),
    privacy: PrivacyContextV14,
    supersedesId: platformIdSchema("identityresolution").optional(),
  })
  .strict();
export const RelationshipValueSchema = base
  .extend({
    id: platformIdSchema("relationshipvalue"),
    key,
    version,
    subject: z
      .object({
        kind: z.enum(["organisation", "person", "workspace"]),
        organisationId: platformIdSchema("org").optional(),
        personId: platformIdSchema("person").optional(),
      })
      .strict(),
    // People influence the account; they are not duplicated economic subjects.
    influencingPersonIds: list(platformIdSchema("person")),
    offerings: list(
      KnowledgeRevisionReference.extend({
        kind: z.literal("offering"),
        entityId: platformIdSchema("offering"),
        snapshotId: platformIdSchema("hiverevision"),
      }),
    ),
    dimensions: z
      .array(
        z
          .object({
            key,
            basis: z.enum([
              "known",
              "estimated_potential",
              "strategic_priority",
              "assumption",
            ]),
            statement: text,
            measurement: z
              .object({
                value: z.number().finite(),
                unit: key,
                currency: z
                  .string()
                  .regex(/^[A-Z]{3}$/)
                  .optional(),
              })
              .strict()
              .optional(),
            evidence,
            assumptions: list(text),
            confidence,
          })
          .strict(),
      )
      .min(1)
      .max(50),
    methodologies: ReasoningContextSchema.shape.methodologies,
    validFrom: z.date(),
    validUntil: z.date().optional(),
    supersedesId: platformIdSchema("relationshipvalue").optional(),
  })
  .strict();
const effective = {
  effectiveFrom: z.date(),
  effectiveUntil: z.date().optional(),
};
const priorityNode = z
  .object({ kind: z.enum(["objective", "clause"]), key })
  .strict();
export const StrategyObjectivesV14 = z
  .object({
    ...effective,
    objectives: z
      .array(z.object({ key, description: text, evidence }).strict())
      .min(1)
      .max(50),
    precedence: list(
      z
        .object({
          higher: priorityNode,
          lower: priorityNode,
          rationale: text,
          ...effective,
        })
        .strict(),
    ),
    propositions: list(
      z
        .object({
          offering: KnowledgeRevisionReference.extend({
            kind: z.literal("offering"),
            entityId: platformIdSchema("offering"),
            snapshotId: platformIdSchema("hiverevision"),
          }),
          priority: z.number().int().min(0).max(1000).optional(),
          relationships: list(
            z
              .object({
                kind: key,
                offering: KnowledgeRevisionReference.extend({
                  kind: z.literal("offering"),
                  entityId: platformIdSchema("offering"),
                  snapshotId: platformIdSchema("hiverevision"),
                }),
                rationale: text,
              })
              .strict(),
          ),
          ...effective,
        })
        .strict(),
    ),
  })
  .strict();
/** Additive contracts in the SAME v13 collections. Frozen v13 exports remain untouched. */
export const ReasoningContextV14Schema = ReasoningContextSchema.extend({
  inputs: z
    .object({
      identities: list(
        StateReferenceV14.extend({
          collection: z.literal("interaction_identities"),
        }),
      ),
      resolutions: list(
        StateReferenceV14.extend({
          collection: z.literal("identity_resolutions"),
        }),
      ),
      relationshipValues: list(
        StateReferenceV14.extend({
          collection: z.literal("relationship_value_assessments"),
        }),
      ),
      relationships: list(
        StateReferenceV14.extend({
          collection: z.enum([
            "organisations",
            "people",
            "organisation_relationships",
            "product_relationships",
          ]),
        }),
      ),
      activities: list(
        StateReferenceV14.extend({
          collection: z.enum(["crm_tasks", "opportunities", "campaigns"]),
        }),
      ),
      objectiveReferences: list(
        z
          .object({
            policyId: platformIdSchema("contactstrategy"),
            version,
            objectiveKey: key,
          })
          .strict(),
      ),
    })
    .strict()
    .optional(),
}).strict();
export const ContactStrategyPolicyV14Schema =
  ContactStrategyPolicySchema.extend({
    strategy: StrategyObjectivesV14.optional(),
  }).strict();
export const EventIdentityObservationV14 = z
  .object({
    identityId: platformIdSchema("interactionidentity"),
    knowledgeAtEvent: z.enum(["unresolved", "resolution_recorded"]),
    resolutionId: platformIdSchema("identityresolution").optional(),
  })
  .strict();
export type EventV14 = z.infer<typeof EventSchema> & {
  identityObservation?: z.infer<typeof EventIdentityObservationV14>;
};
export const V14_SCHEMAS = {
  interaction_identities: InteractionIdentitySchema,
  identity_resolutions: IdentityResolutionSchema,
  relationship_value_assessments: RelationshipValueSchema,
  reasoning_contexts: ReasoningContextV14Schema,
  contact_strategy_policies: ContactStrategyPolicyV14Schema,
} as const;
export type V14Collection = keyof typeof V14_SCHEMAS;
export type InteractionIdentity = z.infer<typeof InteractionIdentitySchema>;
export type IdentityResolution = z.infer<typeof IdentityResolutionSchema>;
export type RelationshipValue = z.infer<typeof RelationshipValueSchema>;
export type ReasoningContextV14 = z.infer<typeof ReasoningContextV14Schema>;
export type ContactStrategyPolicyV14 = z.infer<
  typeof ContactStrategyPolicyV14Schema
>;

function fail(message: string): never {
  throw new Error(message);
}
function unique(keys: string[]) {
  if (new Set(keys).size !== keys.length) fail("Duplicate key");
}
function period(from: Date, until?: Date) {
  if (until && until <= from) fail("Invalid effective period");
}
/** Semantics only: not a matching, scoring, priority or authorization engine. */
export function parseV14(collection: V14Collection, input: unknown) {
  const row = V14_SCHEMAS[collection].parse(input);
  if (row.updatedAt.getTime() !== row.createdAt.getTime())
    fail("Immutable snapshot required");
  if ("supersedesId" in row && row.supersedesId === row.id)
    fail("Self supersession");
  if ("validFrom" in row) period(row.validFrom, row.validUntil);
  if (collection === "reasoning_contexts") {
    const base = ReasoningContextV14Schema.parse(row);
    delete base.inputs;
    validateReasoningSemantics("reasoning_contexts", base);
  }
  if (collection === "contact_strategy_policies") {
    const { strategy, ...base } = ContactStrategyPolicyV14Schema.parse(row);
    validateReasoningSemantics("contact_strategy_policies", base);
    if (strategy) {
      period(strategy.effectiveFrom, strategy.effectiveUntil);
      unique(strategy.objectives.map((o) => o.key));
      const nodes = new Set([
        ...strategy.objectives.map((o) => "objective:" + o.key),
        ...base.clauses.map((c) => "clause:" + c.key),
      ]);
      const edges = new Map<string, string[]>();
      for (const p of strategy.precedence) {
        period(p.effectiveFrom, p.effectiveUntil);
        const higher = p.higher.kind + ":" + p.higher.key,
          lower = p.lower.kind + ":" + p.lower.key;
        if (!nodes.has(higher) || !nodes.has(lower) || higher === lower)
          fail("Unknown/self precedence reference");
        edges.set(higher, [...(edges.get(higher) ?? []), lower]);
      }
      // Structural cycle rejection, not priority evaluation; cycles even with disjoint dates are invalid.
      const visited = new Set<string>();
      const visit = (node: string, path: Set<string>) => {
        if (path.has(node)) fail("Cyclic precedence");
        if (visited.has(node)) return;
        for (const next of edges.get(node) ?? [])
          visit(next, new Set([...path, node]));
        visited.add(node);
      };
      for (const node of nodes) visit(node, new Set());
      for (const p of strategy.propositions)
        period(p.effectiveFrom, p.effectiveUntil);
    }
  }
  if ("identityId" in row) {
    if (row.status === "unresolved") {
      if (row.personId || row.basis !== "unknown")
        fail("Unresolved must remain unknown");
    } else {
      if (!row.personId || !row.evidence.length || row.basis === "unknown")
        fail("Resolution requires Person and evidence-backed basis");
    }
    if (row.status === "revoked" && !row.supersedesId)
      fail("Revocation requires prior assertion");
  }
  if ("subject" in row) {
    const subject = row.subject;
    if (
      (subject.kind === "organisation") !== Boolean(subject.organisationId) ||
      (subject.kind === "person") !== Boolean(subject.personId)
    )
      fail("Exactly the declared economic subject is required");
    unique(row.dimensions.map((d) => d.key));
    for (const d of row.dimensions) {
      if (
        !d.evidence.length &&
        !(d.basis === "assumption" && d.assumptions.length)
      )
        fail("Evidence or explicit assumption required");
    }
  }
  if ("communication" in row && row.communication) {
    const c = row.communication;
    if (
      !(c.taskId || c.eventId) ||
      !(c.intendedPersonId || c.intendedContactPointId)
    )
      fail("Communication context and intended recipient required");
  }
  return row;
}
/** Captures knowledge at event time without changing the existing Event contract or mutation API. */
export function parseIdentityEventV14(input: unknown) {
  const envelope = z
    .object({
      record: z.unknown(),
      identityObservation: EventIdentityObservationV14,
    })
    .strict()
    .parse(input);
  const record = EventSchema.parse(envelope.record);
  const observation = envelope.identityObservation;
  if (!record.workspaceId) fail("Workspace required");
  if (
    (observation.knowledgeAtEvent === "resolution_recorded") !==
    Boolean(observation.resolutionId)
  )
    fail("Exact event-time resolution state required");
  if (
    observation.knowledgeAtEvent === "unresolved" &&
    (record.personId || record.personIds?.length)
  )
    fail("Unresolved observation cannot assert Person");
  return { ...record, identityObservation: observation };
}
