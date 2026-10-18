import { CrmTaskSchema } from "./crm-records";
import { z } from "zod";
import { digest } from "@workspace/agent-runtime-protocol";
import { platformIdSchema } from "./schemas";
import { partnerHumanSchema } from "./partners";
import {
  EvidenceReference,
  KnowledgeRevisionReference,
  ReasoningDecisionSchema,
  validateReasoningSemantics,
} from "./reasoning-foundation";
import {
  ReasoningActionLinkSchema,
  parseReasoningTask,
} from "./reasoning-crm-links";
const text = (max = 2000) => z.string().trim().min(1).max(max);
const version = z.number().int().positive().safe();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const key = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
const list = <T extends z.ZodTypeAny>(schema: T) => z.array(schema).max(40);
const audit = {
  createdAt: z.date(),
  updatedAt: z.date(),
  createdBy: partnerHumanSchema,
  updatedBy: partnerHumanSchema,
  archived: z.boolean(),
  archivedAt: z.date().optional(),
  schemaVersion: z.literal(1),
};
export const ActionTypeReferenceSchema = z
  .object({
    id: platformIdSchema("actiontype"),
    key,
    version,
    contentHash: hash,
  })
  .strict();
export const ActionRevisionReferenceSchema = z
  .object({
    definitionId: platformIdSchema("actiondefinition"),
    snapshotId: platformIdSchema("actionrevision"),
    revision: version,
    contentHash: hash,
  })
  .strict();
const AgentReference = z
  .object({ id: platformIdSchema("agentdefinition"), version })
  .strict();
export const ActionTypeDataSchema = z
  .object({
    name: text(200),
    description: text(),
    capabilityIds: list(platformIdSchema("capability")),
  })
  .strict();
export const ActionTypeRecordSchema = z
  .object({
    ...audit,
    id: platformIdSchema("actiontype"),
    key,
    version,
    status: z.enum(["draft", "active", "retired"]),
    availability: z.enum(["internal", "queens", "experimental"]),
    data: ActionTypeDataSchema,
    contentHash: hash,
  })
  .strict();
/** Hash semantic content only. Lifecycle withdrawal remains an independent current check. */
export const actionTypeHash = (
  v: Pick<z.infer<typeof ActionTypeRecordSchema>, "key" | "version" | "data">,
) => digest({ key: v.key, version: v.version, data: v.data });
const ResourceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("knowledge"),
      reference: KnowledgeRevisionReference,
    })
    .strict(),
  z
    .object({ kind: z.literal("evidence"), reference: EvidenceReference })
    .strict(),
  z
    .object({
      kind: z.literal("external_descriptor"),
      label: text(200),
      resourceType: key,
      locator: z
        .string()
        .max(2048)
        .url()
        .refine((v) => {
          try {
            const u = new URL(v);
            return (
              ["https:", "http:"].includes(u.protocol) &&
              !u.username &&
              !u.password &&
              !u.search &&
              !u.hash
            );
          } catch {
            return false;
          }
        }, "Non-credentialled public locator only")
        .optional(),
    })
    .strict(),
]);
export const ActionDefinitionDataSchema = z
  .object({
    name: text(200),
    description: text(),
    purpose: text(),
    actionType: ActionTypeReferenceSchema,
    resources: list(ResourceSchema),
    executor: z
      .object({
        capabilityId: platformIdSchema("capability").optional(),
        agentDefinition: AgentReference.optional(),
      })
      .strict()
      .refine(
        (v) => Boolean(v.capabilityId || v.agentDefinition),
        "Executor reference required",
      )
      .optional(),
    channelContext: text(500).optional(),
    prerequisites: list(text()),
    eligibilityConstraints: list(text()),
    approvalRequirements: list(text()),
    availability: z
      .object({
        startsAt: z.date().optional(),
        endsAt: z.date().optional(),
        occursAt: z.date().optional(),
        registrationEndsAt: z.date().optional(),
        constraints: list(text()),
      })
      .strict(),
    evidence: list(EvidenceReference),
  })
  .strict();
export const ActionDefinitionRecordSchema = z
  .object({
    ...audit,
    id: platformIdSchema("actiondefinition"),
    workspaceId: platformIdSchema("workspace"),
    definition: ActionDefinitionDataSchema,
    status: z.enum(["draft", "approved", "retired"]),
    revision: version,
    approvedRevision: version.optional(),
    approvedAt: z.date().optional(),
    approvedBy: partnerHumanSchema.optional(),
    contentHash: hash,
  })
  .strict();
export const actionDefinitionHash = (
  v: Pick<z.infer<typeof ActionDefinitionRecordSchema>, "definition">,
) => digest(JSON.parse(JSON.stringify(v.definition)));
function chronology(
  v: {
    createdAt: Date;
    updatedAt: Date;
    archived: boolean;
    archivedAt?: Date;
    status: string;
  },
  ctx: z.RefinementCtx,
) {
  if (
    v.updatedAt < v.createdAt ||
    (v.status === "retired") !== v.archived ||
    v.archived !== Boolean(v.archivedAt) ||
    (v.archivedAt && (v.archivedAt < v.createdAt || v.archivedAt > v.updatedAt))
  )
    ctx.addIssue({ code: "custom", message: "Invalid lifecycle chronology" });
}
function bounded(v: unknown, ctx: z.RefinementCtx) {
  if (Buffer.byteLength(JSON.stringify(v)) > 65536)
    ctx.addIssue({ code: "custom", message: "Action record exceeds 64 KiB" });
}
export const ActionTypeSchema = ActionTypeRecordSchema.superRefine((v, c) => {
  chronology(v, c);
  bounded(v, c);
  if (
    actionTypeHash(v) !== v.contentHash ||
    new Set(v.data.capabilityIds).size !== v.data.capabilityIds.length
  )
    c.addIssue({
      code: "custom",
      message: "Invalid type hash or duplicate capabilities",
    });
});
export const ActionDefinitionSchema = ActionDefinitionRecordSchema.superRefine(
  (v, c) => {
    chronology(v, c);
    bounded(v, c);
    if (actionDefinitionHash(v) !== v.contentHash)
      c.addIssue({ code: "custom", message: "Invalid Action hash" });
    if (
      Boolean(v.approvedAt) !== Boolean(v.approvedBy) ||
      (v.status === "draft" && v.approvedAt) ||
      (v.approvedAt &&
        (v.approvedAt < v.createdAt || v.approvedAt > v.updatedAt)) ||
      (v.status === "approved" &&
        (!v.approvedAt || v.approvedRevision !== v.revision)) ||
      (v.approvedRevision !== undefined &&
        (v.approvedRevision > v.revision ||
          (v.status === "draft" && v.approvedRevision >= v.revision)))
    )
      c.addIssue({ code: "custom", message: "Invalid approval/revision" });
    const a = v.definition.availability;
    if (
      (a.startsAt && a.endsAt && a.endsAt <= a.startsAt) ||
      (a.registrationEndsAt && a.occursAt && a.registrationEndsAt > a.occursAt)
    )
      c.addIssue({ code: "custom", message: "Invalid availability interval" });
    for (const values of [
      v.definition.resources,
      v.definition.evidence,
      v.definition.prerequisites,
      v.definition.eligibilityConstraints,
      v.definition.approvalRequirements,
    ])
      if (new Set(values.map((x) => digest(x))).size !== values.length)
        c.addIssue({
          code: "custom",
          message: "Duplicate Action reference or constraint",
        });
  },
);
export const ActionDefinitionRevisionSchema = z
  .object({
    id: platformIdSchema("actionrevision"),
    workspaceId: platformIdSchema("workspace"),
    definitionId: platformIdSchema("actiondefinition"),
    revision: version,
    snapshot: ActionDefinitionSchema,
  })
  .strict()
  .superRefine((v, c) => {
    if (
      v.workspaceId !== v.snapshot.workspaceId ||
      v.definitionId !== v.snapshot.id ||
      v.revision !== v.snapshot.revision ||
      v.snapshot.status !== "approved"
    )
      c.addIssue({
        code: "custom",
        message: "Snapshot identity/approval mismatch",
      });
    bounded(v, c);
  });
export const ACTION_LIBRARY_SCHEMAS = {
  action_types: ActionTypeSchema,
  action_definitions: ActionDefinitionSchema,
  action_definition_revisions: ActionDefinitionRevisionSchema,
};
/** Persistence adapters must enforce insert-only snapshots; this comparison never grants approval. */
export function assertImmutableActionRevision(
  previous: unknown,
  next: unknown,
) {
  const a = ActionDefinitionRevisionSchema.parse(previous),
    b = ActionDefinitionRevisionSchema.parse(next);
  if (
    digest(JSON.parse(JSON.stringify(a))) !==
    digest(JSON.parse(JSON.stringify(b)))
  )
    throw new Error("Immutable Action revision");
}
export function assertActionTypeTransition(previous: unknown, next: unknown) {
  const a = ActionTypeSchema.parse(previous),
    b = ActionTypeSchema.parse(next);
  if (
    a.id !== b.id ||
    a.key !== b.key ||
    a.version !== b.version ||
    b.updatedAt < a.updatedAt ||
    a.createdAt.getTime() !== b.createdAt.getTime() ||
    digest(a.createdBy) !== digest(b.createdBy) ||
    (a.status !== "draft" &&
      (a.contentHash !== b.contentHash || b.status === "draft")) ||
    (a.status === "retired" && b.status !== "retired")
  )
    throw new Error("Published Action type requires a new version");
}
export const ReasoningDecisionV17Schema = ReasoningDecisionSchema.extend({
  candidates: ReasoningDecisionSchema.shape.candidates.element
    .extend({ action: ActionRevisionReferenceSchema.optional() })
    .strict()
    .array()
    .min(1)
    .max(30),
}).superRefine((v, c) => {
  try {
    validateReasoningSemantics("reasoning_decisions", {
      ...v,
      candidates: v.candidates.map(({ action, ...candidate }) => {
        void action;
        return candidate;
      }),
    });
  } catch {
    c.addIssue({ code: "custom", message: "Invalid Decision semantics" });
  }
});
export const ReasoningActionLinkV17Schema = ReasoningActionLinkSchema.extend({
  action: ActionRevisionReferenceSchema.optional(),
}).strict();
export function parseActionTask(input: unknown) {
  const v = z
    .object({ record: z.unknown(), reasoning: ReasoningActionLinkV17Schema })
    .strict()
    .parse(input);
  CrmTaskSchema.innerType().strict().parse(v.record);
  const { action, ...reasoning } = v.reasoning;
  return {
    ...parseReasoningTask({ record: v.record, reasoning }),
    reasoning: { ...reasoning, ...(action ? { action } : {}) },
  };
}
/** Future authorized writers must preserve identity and advance drafts explicitly.
 * This is a transition validator, never an approval operation. */
export function assertActionDefinitionTransition(
  previous: unknown,
  next: unknown,
) {
  const a = ActionDefinitionSchema.parse(previous),
    b = ActionDefinitionSchema.parse(next);
  if (
    a.id !== b.id ||
    a.workspaceId !== b.workspaceId ||
    a.createdAt.getTime() !== b.createdAt.getTime() ||
    digest(a.createdBy) !== digest(b.createdBy) ||
    b.updatedAt <= a.updatedAt
  )
    throw new Error("Action identity or CAS chronology changed");
  if (a.status === "retired")
    throw new Error("Retired Action cannot be rewritten");
  if (a.status === "approved") {
    if (b.status === "draft") {
      if (
        b.revision !== a.revision + 1 ||
        b.approvedRevision !== a.revision ||
        b.contentHash !== a.contentHash
      )
        throw new Error("Open an exact successor draft before editing");
    } else if (
      b.status !== "retired" ||
      b.revision !== a.revision ||
      b.contentHash !== a.contentHash ||
      b.approvedRevision !== a.approvedRevision ||
      b.approvedAt?.getTime() !== a.approvedAt?.getTime() ||
      digest(b.approvedBy) !== digest(a.approvedBy)
    )
      throw new Error("Approved Action content is immutable");
  } else if (
    b.revision !== a.revision ||
    (b.status === "approved" && b.contentHash !== a.contentHash)
  )
    throw new Error("Draft revision and approval content must remain pinned");
}
