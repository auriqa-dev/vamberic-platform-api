import { z } from "zod";
import {
  CriteriaSetSchema,
  CandidateRefSchema,
  EvaluationPayloadSchema,
  BudgetLimitsSchema,
  canonicalJson,
  digest,
  type CriteriaSet,
  type CandidateRef,
  type EvaluationPayload,
  type BudgetLimits,
} from "@workspace/agent-runtime-protocol";
import { platformIdSchema } from "./schemas";
import { partnerHumanSchema } from "./partners";
import { AgentOperationTarget } from "./agent-operator";
export function shared<T>(schema: { parse(v: unknown): T }) {
  return z.unknown().transform((v, c): T => {
    try {
      return schema.parse(v);
    } catch {
      c.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid shared contract",
      });
      return z.NEVER;
    }
  });
}
const key = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
const token = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const identity = z
  .object({
    key,
    version: z.number().int().min(1).max(1_000_000),
    digest: hash,
  })
  .strict();
export const EffectivenessPolicySchema = z
  .object({
    identity,
    maxRevisions: z.number().int().min(0).max(2),
    manualOverride: z.literal(false),
    consequences: z
      .array(
        z
          .object({
            key,
            onFailure: z.enum(["revise", "hold", "escalate"]),
            onUncertain: z.enum(["hold", "escalate"]),
          })
          .strict(),
      )
      .min(1)
      .max(40),
  })
  .strict()
  .superRefine((v, c) => {
    if (
      new Set(v.consequences.map((x) => x.key)).size !== v.consequences.length
    )
      c.addIssue({ code: "custom", message: "Duplicate consequence" });
    const { identity: i, ...body } = v;
    if (digest({ key: i.key, version: i.version, ...body }) !== i.digest)
      c.addIssue({ code: "custom", message: "Policy digest mismatch" });
  });
export type EffectivenessPolicy = z.infer<typeof EffectivenessPolicySchema>;
export const EffectivenessDefinitionSchema = z
  .object({
    maker: key,
    evaluator: key,
    revision: key,
    profile: identity,
    policy: identity,
    required: z.literal(true),
    maxRevisions: z.number().int().min(0).max(2),
  })
  .strict()
  .refine(
    (v) => new Set([v.maker, v.evaluator, v.revision]).size === 3,
    "Roles require separate operations",
  );
export const EffectivenessRunLinkSchema = z
  .object({
    caseId: platformIdSchema("effectivenesscase"),
    role: z.enum(["maker", "evaluator", "revision"]),
    ordinal: z.number().int().min(1).max(11),
    transitionKey: hash,
  })
  .strict();
export const EffectivenessDecisionSchema = z
  .object({
    kind: z.enum(["pass", "revise", "hold", "escalate"]),
    reason: key,
    inputDigest: hash,
    policyDigest: hash,
    evaluationResultId: platformIdSchema("agentresult").optional(),
  })
  .strict();
export const EffectivenessCaseSchema = z
  .object({
    id: platformIdSchema("effectivenesscase"),
    workspaceId: platformIdSchema("workspace"),
    organisationId: platformIdSchema("org"),
    requester: partnerHumanSchema,
    requesterClientId: token,
    authority: z.discriminatedUnion("basis", [
      z.object({ basis: z.literal("partner") }).strict(),
      z
        .object({
          basis: z.literal("client"),
          membershipId: platformIdSchema("workspacemembership"),
          grantId: platformIdSchema("agentoperatorgrant"),
        })
        .strict(),
    ]),
    target: AgentOperationTarget,
    requestKey: token,
    requestDigest: hash,
    predecessorCase: z
      .object({
        id: platformIdSchema("effectivenesscase"),
        candidateDigest: hash,
        criteriaDigest: hash,
      })
      .strict()
      .optional(),
    definition: EffectivenessDefinitionSchema,
    criteria: shared<CriteriaSet>(CriteriaSetSchema),
    policy: EffectivenessPolicySchema,
    totalBudget: shared<BudgetLimits>(BudgetLimitsSchema),
    allocations: z
      .array(
        z
          .object({
            runId: platformIdSchema("agentrun"),
            budget: shared<BudgetLimits>(BudgetLimitsSchema),
            role: z.enum(["maker", "evaluator", "revision"]),
            request: z
              .object({ key: hash, digest: hash, actor: partnerHumanSchema })
              .strict()
              .optional(),
          })
          .strict(),
      )
      .max(11),
    rootRunId: platformIdSchema("agentrun"),
    activeRunId: platformIdSchema("agentrun").optional(),
    status: z.enum([
      "pending",
      "evaluating",
      "revising",
      "passed",
      "held",
      "escalated",
      "closed",
    ]),
    reason: key,
    stateRevision: z.number().int().min(1).max(1_000_000),
    createdAt: z.date(),
    updatedAt: z.date(),
    candidates: z
      .array(
        z
          .object({
            reference: shared<CandidateRef>(CandidateRefSchema),
            predecessorDigest: hash.optional(),
            triggeringEvaluationId: platformIdSchema("agentresult").optional(),
            addressedDefects: z.array(z.string().min(1).max(200)).max(40),
          })
          .strict(),
      )
      .max(3),
    evaluations: z
      .array(
        z
          .object({
            requestKey: token,
            runId: platformIdSchema("agentrun"),
            candidateRevision: z.number().int().min(1).max(3),
            resultId: platformIdSchema("agentresult").optional(),
            defectDigest: hash.optional(),
          })
          .strict(),
      )
      .max(8),
    decisions: z.array(EffectivenessDecisionSchema).max(16),
    dispositions: z
      .array(
        z
          .object({
            requestKey: token,
            requestDigest: hash,
            actor: partnerHumanSchema,
            at: z.date(),
            action: z.enum(["hold", "close"]),
            reason: z.string().min(1).max(2000),
            candidateDigest: hash.optional(),
            evaluationResultId: platformIdSchema("agentresult").optional(),
            criteriaDigest: hash,
            policyDigest: hash,
          })
          .strict(),
      )
      .max(8),
  })
  .strict()
  .superRefine((v, c) => {
    try {
      canonicalJson(JSON.parse(JSON.stringify(v)), 196608);
    } catch {
      c.addIssue({ code: "custom", message: "Case bounds" });
    }
    if (
      (v.target.kind !== "client_agent" &&
        v.target.kind !== "workspace_agent") ||
      (v.target.kind === "workspace_agent" &&
        v.target.workspaceId !== v.workspaceId) ||
      v.updatedAt < v.createdAt ||
      new Date(v.totalBudget.deadline) <= v.createdAt ||
      digest(v.criteria.profile) !== digest(v.definition.profile) ||
      digest(v.policy.identity) !== digest(v.definition.policy) ||
      v.policy.maxRevisions > v.definition.maxRevisions
    )
      c.addIssue({ code: "custom", message: "Case pins inconsistent" });
    if (
      v.candidates.some(
        (x, i) =>
          x.reference.caseId !== v.id ||
          x.reference.revision !== i + 1 ||
          (i > 0 &&
            x.predecessorDigest !==
              v.candidates[i - 1]!.reference.contentDigest),
      )
    )
      c.addIssue({ code: "custom", message: "Revision lineage inconsistent" });
    if (
      new Set(v.allocations.map((a) => a.runId)).size !==
        v.allocations.length ||
      new Set(v.evaluations.map((a) => a.requestKey)).size !==
        v.evaluations.length ||
      new Set(v.dispositions.map((a) => a.requestKey)).size !==
        v.dispositions.length
    )
      c.addIssue({ code: "custom", message: "Duplicate case identity" });
    const latest = v.candidates.at(-1)?.reference;
    const lastDecision = v.decisions.at(-1);
    if (
      (v.activeRunId &&
        !v.allocations.some((a) => a.runId === v.activeRunId)) ||
      v.allocations.filter((a) => a.role === "revision").length >
        v.policy.maxRevisions ||
      v.candidates.length > 1 + v.policy.maxRevisions ||
      v.allocations.some(
        (a) => new Date(a.budget.deadline) > new Date(v.totalBudget.deadline),
      ) ||
      v.evaluations.some(
        (e) =>
          !v.allocations.some(
            (a) => a.runId === e.runId && a.role === "evaluator",
          ) ||
          !v.candidates.some(
            (c) => c.reference.revision === e.candidateRevision,
          ),
      ) ||
      v.candidates.some(
        (c) =>
          !v.allocations.some(
            (a) => a.runId === c.reference.runId && a.role !== "evaluator",
          ),
      )
    )
      c.addIssue({
        code: "custom",
        message: "Case execution links inconsistent",
      });
    if (
      v.status === "passed" &&
      (!latest ||
        lastDecision?.kind !== "pass" ||
        !v.evaluations.some(
          (e) =>
            e.resultId === lastDecision.evaluationResultId &&
            e.candidateRevision === latest.revision,
        ))
    )
      c.addIssue({
        code: "custom",
        message: "Pass requires current accepted evaluation",
      });
    if (
      v.criteria.criteria.some(
        (x) => !v.policy.consequences.some((p) => p.key === x.consequenceKey),
      )
    )
      c.addIssue({ code: "custom", message: "Missing criterion policy" });
  });
export type EffectivenessCase = z.infer<typeof EffectivenessCaseSchema>;
export type EffectivenessDefinition = z.infer<
  typeof EffectivenessDefinitionSchema
>;
export function defectDigest(e: EvaluationPayload) {
  return digest(
    e.defects
      .map((d) => ({
        criterionId: d.criterionId,
        type: d.type,
        location: d.location,
      }))
      .sort((a, b) =>
        JSON.stringify(a) < JSON.stringify(b)
          ? -1
          : JSON.stringify(a) > JSON.stringify(b)
            ? 1
            : 0,
      ),
  );
}
export function decideEffectiveness(input: {
  criteria: CriteriaSet;
  policy: EffectivenessPolicy;
  evaluation: EvaluationPayload;
  revision: number;
  blockingGap: boolean;
  fresh: boolean;
  authorized: boolean;
  canRevise: boolean;
  oscillation: boolean;
}) {
  const c = CriteriaSetSchema.parse(input.criteria),
    p = EffectivenessPolicySchema.parse(input.policy),
    e = EvaluationPayloadSchema.parse(input.evaluation);
  const make = (
    kind: "pass" | "revise" | "hold" | "escalate",
    reason: string,
  ) => ({
    kind,
    reason,
    inputDigest: digest(input),
    policyDigest: p.identity.digest,
  });
  if (!input.authorized || !input.fresh)
    return make("hold", !input.authorized ? "authority_unavailable" : "stale");
  if (
    e.criteriaDigest !== c.digest ||
    digest(e.policy) !== digest(p.identity) ||
    e.assessments.length !== c.criteria.length ||
    c.criteria.some((x) => !e.assessments.some((a) => a.criterionId === x.id))
  )
    throw new Error("Decision pins/coverage mismatch");
  const required = c.criteria
    .filter((x) => x.importance === "mandatory")
    .map((x) => ({
      criterion: x,
      assessment: e.assessments.find((a) => a.criterionId === x.id)!,
      rule: p.consequences.find((r) => r.key === x.consequenceKey),
    }));
  if (required.some((x) => !x.rule)) throw new Error("Missing decision rule");
  if (
    required.some(
      (x) =>
        x.assessment.outcome === "uncertain" &&
        x.rule!.onUncertain === "escalate",
    )
  )
    return make("escalate", "mandatory_uncertainty");
  if (input.blockingGap) return make("hold", "knowledge_gap");
  if (required.some((x) => x.assessment.outcome === "uncertain"))
    return make("hold", "mandatory_uncertainty");
  const failed = required.filter((x) => x.assessment.outcome === "fail");
  if (!failed.length) return make("pass", "criteria_satisfied");
  if (input.oscillation) return make("escalate", "no_progress");
  if (input.revision > p.maxRevisions)
    return make("escalate", "revision_exhausted");
  if (failed.some((x) => x.rule!.onFailure === "escalate"))
    return make("escalate", "mandatory_failure");
  if (failed.some((x) => x.rule!.onFailure === "hold"))
    return make("hold", "unresolved_condition");
  return input.canRevise
    ? make("revise", "remediable_failure")
    : make("escalate", "revision_unavailable");
}
