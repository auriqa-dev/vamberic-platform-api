import { z } from "zod";
import { platformIdSchema } from "./schemas";

const text = z.string().trim().min(1).max(2000);
const key = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const version = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const bounded = <T extends z.ZodTypeAny>(schema: T) => z.array(schema).max(100);
/** Exact persisted source, never a latest-version selector or copied knowledge. */
export const KnowledgeRevisionReference = z
  .object({
    kind: z.enum(["offering", "icp", "buyer_profile", "offer"]),
    entityId: z
      .string()
      .regex(
        /^(offering|icp|buyerprofile|offer)_[0-7][0-9abcdefghjkmnpqrstvwxyz]{25}$/,
      ),
    snapshotId: z
      .string()
      .regex(
        /^(hiverevision|offerrevision)_[0-7][0-9abcdefghjkmnpqrstvwxyz]{25}$/,
      ),
    revision: version,
    contentHash: hash,
  })
  .strict();
export const EvidenceReference = z
  .object({
    collection: z.enum([
      "events",
      "agent_results",
      "hive_definition_revisions",
      "offer_revisions",
    ]),
    id: z.string().min(1).max(100),
    contentHash: hash,
    evidenceId: z.string().min(1).max(100).optional(),
  })
  .strict();
const policyReference = z
  .object({ id: platformIdSchema("contactstrategy"), version })
  .strict();
const methodologyReference = z
  .object({ id: platformIdSchema("offermethodology"), version })
  .strict();
const source = z
  .object({
    kind: z.enum(["human", "platform", "agent"]),
    reference: z.string().min(1).max(200),
    resultId: platformIdSchema("agentresult").optional(),
  })
  .strict();
const base = {
  workspaceId: platformIdSchema("workspace"),
  createdAt: z.date(),
  updatedAt: z.date(),
  source,
};
const subjects = {
  organisationIds: bounded(platformIdSchema("org")),
  personIds: bounded(platformIdSchema("person")),
  contactPointIds: bounded(platformIdSchema("contact")),
  campaignIds: bounded(platformIdSchema("campaign")),
  knowledge: bounded(KnowledgeRevisionReference),
};
export const ReasoningContextSchema = z
  .object({
    ...base,
    id: platformIdSchema("reasoningcontext"),
    objective: text,
    ...subjects,
    observationIds: bounded(platformIdSchema("event")),
    evidence: bounded(EvidenceReference),
    methodologies: bounded(methodologyReference),
    policies: bounded(policyReference),
    learningIds: bounded(platformIdSchema("learning")),
    currentStateEvidence: bounded(EvidenceReference),
    supersedesId: platformIdSchema("reasoningcontext").optional(),
  })
  .strict();
const candidate = z
  .object({
    key,
    description: text,
    capabilityId: platformIdSchema("capability").optional(),
    agentDefinitionId: platformIdSchema("agentdefinition").optional(),
    agentDefinitionVersion: version.optional(),
  })
  .strict();
export const ReasoningDecisionSchema = z
  .object({
    ...base,
    id: platformIdSchema("reasoningdecision"),
    contextId: platformIdSchema("reasoningcontext"),
    candidates: z.array(candidate).min(1).max(30),
    selectedCandidateKey: key.optional(),
    explanation: text,
    evidence: bounded(EvidenceReference),
    confidence: z.number().min(0).max(1),
    priority: z.enum(["low", "normal", "high", "urgent"]),
    authorityLevel: z.enum([
      "recommendation",
      "delegated_decision",
      "human_escalation",
    ]),
    // Descriptive history only. No grant, dispatch or approval can consume this as authority.
    authorityEvidence: bounded(EvidenceReference),
    constraints: bounded(text),
    policies: bounded(policyReference),
    status: z.enum(["proposed", "recorded", "superseded", "withdrawn"]),
    decidedAt: z.date(),
    supersedesId: platformIdSchema("reasoningdecision").optional(),
  })
  .strict();
export const ScopedLearningSchema = z
  .object({
    ...base,
    id: platformIdSchema("learning"),
    claim: text,
    scope: z
      .object({
        kind: z.enum([
          "workspace",
          "offering",
          "icp",
          "buyer_profile",
          "contact_strategy",
          "capability",
          "methodology",
        ]),
        knowledge: bounded(KnowledgeRevisionReference),
        policies: bounded(policyReference),
        capabilityIds: bounded(platformIdSchema("capability")),
        methodologies: bounded(methodologyReference),
      })
      .strict(),
    evidence: z.array(EvidenceReference).min(1).max(100),
    confidence: z.number().min(0).max(1),
    validFrom: z.date(),
    validUntil: z.date().optional(),
    contextIds: bounded(platformIdSchema("reasoningcontext")),
    decisionIds: bounded(platformIdSchema("reasoningdecision")),
    outcomeEventIds: bounded(platformIdSchema("event")),
    supersedesId: platformIdSchema("learning").optional(),
    limitations: bounded(text),
  })
  .strict();
export const ContactStrategyPolicySchema = z
  .object({
    ...base,
    id: platformIdSchema("contactstrategy"),
    key,
    version,
    ...subjects,
    status: z.enum(["draft", "recorded", "superseded", "withdrawn"]),
    clauses: z
      .array(
        z
          .object({
            key,
            category: z.enum(["contact", "proposition", "priority"]),
            statement: text,
            evidence: bounded(EvidenceReference),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    supersedesId: platformIdSchema("contactstrategy").optional(),
  })
  .strict();
export const REASONING_SCHEMAS = {
  reasoning_contexts: ReasoningContextSchema,
  reasoning_decisions: ReasoningDecisionSchema,
  scoped_learning: ScopedLearningSchema,
  contact_strategy_policies: ContactStrategyPolicySchema,
} as const;
export type ReasoningContext = z.infer<typeof ReasoningContextSchema>;
export type ReasoningDecision = z.infer<typeof ReasoningDecisionSchema>;
export type ScopedLearning = z.infer<typeof ScopedLearningSchema>;
export type ContactStrategyPolicy = z.infer<typeof ContactStrategyPolicySchema>;

/** Semantic validation before any future persistence adapter; never an authorization check. */
export function validateReasoningSemantics(
  collection: keyof typeof REASONING_SCHEMAS,
  input: unknown,
) {
  const record = REASONING_SCHEMAS[collection].parse(input);
  if (record.updatedAt.getTime() !== record.createdAt.getTime())
    throw new Error("Foundation records are immutable snapshots");
  if (record.supersedesId === record.id)
    throw new Error("Self supersession is invalid");
  if ("candidates" in record) {
    if (
      new Set(record.candidates.map((c) => c.key)).size !==
      record.candidates.length
    )
      throw new Error("Duplicate candidate key");
    if (
      record.selectedCandidateKey &&
      !record.candidates.some((c) => c.key === record.selectedCandidateKey)
    )
      throw new Error("Unknown selected candidate");
    if (
      record.candidates.some(
        (c) =>
          Boolean(c.agentDefinitionId) !== Boolean(c.agentDefinitionVersion),
      )
    )
      throw new Error("Exact Agent definition version required");
    if (
      record.authorityLevel === "delegated_decision" &&
      !record.authorityEvidence.length
    )
      throw new Error(
        "Delegation history requires evidence, not an authority grant",
      );
  }
  if ("scope" in record) {
    const scope = record.scope;
    if (
      ["offering", "icp", "buyer_profile"].includes(scope.kind) &&
      !scope.knowledge.some((k) => k.kind === scope.kind)
    )
      throw new Error("Exact learning scope reference required");
    if (
      (scope.kind === "contact_strategy" && !scope.policies.length) ||
      (scope.kind === "capability" && !scope.capabilityIds.length) ||
      (scope.kind === "methodology" && !scope.methodologies.length)
    )
      throw new Error("Exact learning scope reference required");
  }
  if (
    "clauses" in record &&
    new Set(record.clauses.map((c) => c.key)).size !== record.clauses.length
  )
    throw new Error("Duplicate policy clause key");
  if (
    "validUntil" in record &&
    record.validUntil &&
    record.validUntil <= record.validFrom
  )
    throw new Error("Invalid learning validity interval");
  return record;
}
