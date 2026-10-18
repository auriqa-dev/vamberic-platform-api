import { EffectivenessRunLinkSchema } from "./agent-effectiveness";
import { requireProjectedSnapshots } from "./agent-context-projection";
import { z } from "zod";
import {
  digest,
  EvaluationPayloadSchema,
  RuntimeImplementationManifestSchema as ImplementationManifestSchema,
  type RuntimeImplementationManifest as ImplementationManifest,
  RuntimeClaimedWorkSchema as ClaimedWorkSchema,
  RuntimeOutcomeSchema as OutcomeSchema,
  UsageObservationSchema,
  CheckpointSchema,
  InputRequestSchema,
  InputResponseSchema,
  type RuntimeClaimedWork as ClaimedWork,
  type RuntimeOutcome as Outcome,
  type UsageObservation,
  type Checkpoint,
  type InputRequest,
  type InputResponse,
} from "@workspace/agent-runtime-protocol";
import { platformIdSchema } from "./schemas";
import { partnerHumanSchema } from "./partners";
import {
  AgentOperationTarget,
  AgentOperationKey,
  workspaceTarget,
} from "./agent-operator";

/** Preserve upstream parsing/refinements rather than a second protocol schema. */
function protocol<T>(schema: {
  safeParse(v: unknown): { success: boolean };
  parse(v: unknown): T;
}) {
  return z.unknown().transform((v, ctx): T => {
    if (!schema.safeParse(v).success) {
      ctx.addIssue({
        code: "custom",
        message: "Invalid Runtime protocol value",
        fatal: true,
      });
      return z.NEVER;
    }
    return schema.parse(v);
  });
}
type Frozen<T> = T extends unknown
  ? Omit<T, "attemptId" | "generation" | "fence" | "lease" | "resume">
  : never;
export type FrozenAgentWork = Frozen<ClaimedWork>;
export function parseFrozenWork(value: unknown): FrozenAgentWork {
  const parsed = z.record(z.unknown()).parse(value);
  for (const key of ["attemptId", "generation", "fence", "lease", "resume"])
    if (key in parsed)
      throw new Error("Attempt state is not frozen configuration");
  // These validation-only values are removed and never persisted or dispatched.
  const work = ClaimedWorkSchema.parse({
    ...parsed,
    attemptId: "validation",
    generation: 1,
    fence: 1,
    lease: {
      id: "validation",
      workerId: "validation",
      expiresAt: "9999-12-31T23:59:59.999Z",
    },
  });
  requireProjectedSnapshots(work.context);
  const { attemptId, generation, fence, lease, resume, ...frozen } = work;
  void attemptId;
  void generation;
  void fence;
  void lease;
  void resume;
  return frozen;
}
const frozenSchema = z.unknown().transform((v, ctx) => {
  try {
    return parseFrozenWork(v);
  } catch {
    ctx.addIssue({
      code: "custom",
      message: "Invalid frozen execution contract",
      fatal: true,
    });
    return z.NEVER;
  }
});
const counter = z.number().int().min(0).max(1_000_000);
const token = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const common = {
  workspaceId: platformIdSchema("workspace"),
  createdAt: z.date(),
  updatedAt: z.date(),
};
export const AgentRunSchemaV10 = z
  .object({
    ...common,
    id: platformIdSchema("agentrun"),
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
    operation: AgentOperationKey,
    requestKey: token,
    requestDigest: hash,
    frozen: frozenSchema,
    manifest: protocol<ImplementationManifest>(ImplementationManifestSchema),
    frozenDigest: hash,
    status: z.enum([
      "queued",
      "running",
      "awaiting_input",
      "completed",
      "failed",
      "cancelled",
    ]),
    generation: counter.min(1),
    fence: counter,
    attemptCount: counter,
    nextAttemptReason: z
      .enum(["initial", "retry", "resume", "continuation"])
      .default("initial"),
    failures: counter,
    inputCycles: counter,
    continuations: counter,
    limits: z
      .object({
        attempts: counter.min(1).max(100),
        failures: counter.max(20),
        inputCycles: counter.max(20),
        continuations: counter.max(100),
      })
      .strict(),
    deadline: z.date(),
    notBefore: z.date(),
    cancelRequestedAt: z.date().optional(),
    terminalReason: z
      .enum([
        "success",
        "cancelled",
        "revoked",
        "deadline",
        "input_expired",
        "attempt_limit",
        "retry_exhausted",
        "continuation_limit",
        "input_limit",
        "runtime_failure",
        "budget_exhausted",
      ])
      .optional(),
    activeAttemptId: platformIdSchema("agentattempt").optional(),
    lastResultId: platformIdSchema("agentresult").optional(),
    checkpoint: protocol<Checkpoint>(CheckpointSchema).optional(),
    inputRequest: protocol<InputRequest>(InputRequestSchema).optional(),
    inputResponse: protocol<InputResponse>(InputResponseSchema).optional(),
    inputResponseDigest: hash.optional(),
    inputResponses: z
      .array(protocol<InputResponse>(InputResponseSchema))
      .max(20)
      .default([]),
    dispatch: z
      .object({
        id: token,
        generation: counter.min(1),
        publisherId: token.optional(),
        fence: counter,
        leaseUntil: z.date().optional(),
        lastPublishedAt: z.date().optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((run, ctx) => {
    if (
      new Set(run.inputResponses.map((r) => r.requestId)).size !==
        run.inputResponses.length ||
      run.frozenDigest !== digest(run.frozen) ||
      run.updatedAt < run.createdAt ||
      run.deadline <= run.createdAt ||
      (run.status === "running") !== Boolean(run.activeAttemptId) ||
      (run.status === "awaiting_input" &&
        (!run.inputRequest || !run.checkpoint)) ||
      ["completed", "failed", "cancelled"].includes(run.status) !==
        Boolean(run.terminalReason) ||
      run.frozen.runId !== run.id ||
      run.frozen.workspaceId !== run.workspaceId ||
      run.frozen.clientId !== run.organisationId ||
      run.frozen.operation !== run.operation ||
      (run.frozen.protocolVersion === "2.0"
        ? run.target.kind !== "workspace_agent" ||
          digest(run.frozen.executionTarget) !== run.target.id ||
          digest(run.frozen.executionTarget) !==
            digest({
              kind: run.target.kind,
              workspaceId: run.target.workspaceId,
              definition: run.target.definition,
              implementation: run.target.implementation,
            }) ||
          run.target.revision !== run.frozen.definition.version
        : run.target.kind !== "client_agent" ||
          run.frozen.clientAgent.id !== run.target.id ||
          run.frozen.clientAgent.revision !== run.target.revision) ||
      run.dispatch.generation !== run.generation
    )
      ctx.addIssue({
        code: "custom",
        message: "Invalid Run state or frozen scope",
      });
  });
export const AgentRunSchema = AgentRunSchemaV10.innerType()
  .extend({ effectiveness: EffectivenessRunLinkSchema.optional() })
  .superRefine((v, c) => {
    const { effectiveness: _, ...old } = v;
    void _;
    const result = AgentRunSchemaV10.safeParse(old);
    if (!result.success)
      for (const issue of result.error.issues) c.addIssue(issue);
  });
export const AgentAttemptSchema = z
  .object({
    ...common,
    id: platformIdSchema("agentattempt"),
    runId: platformIdSchema("agentrun"),
    ordinal: counter.min(1),
    generation: counter.min(1),
    fence: counter.min(1),
    reason: z.enum(["initial", "retry", "resume", "continuation"]),
    status: z.enum([
      "running",
      "succeeded",
      "paused",
      "yielded",
      "failed",
      "cancelled",
      "expired",
    ]),
    claimId: token,
    workerId: token,
    workloadClientId: token,
    leaseId: token,
    leaseUntil: z.date(),
    startedAt: z.date(),
    endedAt: z.date().optional(),
    consumedInputRequestId: token.optional(),
    consumedCheckpointDigest: hash.optional(),
    reservedCost: z.string().regex(/^(0|[1-9][0-9]{0,17})(\.[0-9]{1,12})?$/),
    receipt: z
      .object({
        submissionId: token,
        payloadDigest: hash,
        resultId: platformIdSchema("agentresult"),
        acceptedAt: z.date(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((a, ctx) => {
    if (
      a.updatedAt < a.createdAt ||
      a.startedAt < a.createdAt ||
      a.leaseUntil <= a.startedAt ||
      (a.status !== "running") !== Boolean(a.endedAt) ||
      (a.endedAt && (a.endedAt < a.startedAt || a.endedAt > a.updatedAt))
    )
      ctx.addIssue({ code: "custom", message: "Invalid Attempt lifecycle" });
  });
export const AgentResultSchemaV10 = z
  .object({
    ...common,
    id: platformIdSchema("agentresult"),
    runId: platformIdSchema("agentrun"),
    attemptId: platformIdSchema("agentattempt"),
    envelope: protocol<Outcome>(OutcomeSchema),
    dispositions: z
      .array(
        z
          .object({
            proposalId: token,
            status: z.enum([
              "pending",
              "applied_to_draft",
              "rejected",
              "superseded",
            ]),
            actor: partnerHumanSchema.optional(),
            at: z.date().optional(),
            reason: z.string().min(1).max(500).optional(),
            target: z
              .object({
                resource: AgentOperationKey,
                id: token,
                updatedAt: z.date(),
                revision: counter.min(1).optional(),
                contentHash: hash.optional(),
              })
              .strict()
              .optional(),
          })
          .strict(),
      )
      .max(20),
  })
  .strict()
  .superRefine((r, ctx) => {
    if (
      r.updatedAt < r.createdAt ||
      new Date(r.envelope.endedAt) > r.createdAt ||
      r.dispositions.length !== r.envelope.outcome.content.proposals.length ||
      r.dispositions.some(
        (d) =>
          !r.envelope.outcome.content.proposals.some(
            (p) => p.id === d.proposalId,
          ) ||
          (d.status !== "pending") !== Boolean(d.actor) ||
          (d.status !== "pending") !== Boolean(d.at) ||
          (d.status === "applied_to_draft") !== Boolean(d.target) ||
          (d.at && (d.at < r.createdAt || d.at > r.updatedAt)),
      ) ||
      r.envelope.runId !== r.runId ||
      r.envelope.attemptId !== r.attemptId ||
      new Set(r.dispositions.map((d) => d.proposalId)).size !==
        r.dispositions.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Invalid Result scope or disposition",
      });
  });
export const AgentUsageSchema = z
  .object({
    ...common,
    id: platformIdSchema("agentusage"),
    runId: platformIdSchema("agentrun"),
    attemptId: platformIdSchema("agentattempt"),
    observation: protocol<UsageObservation>(UsageObservationSchema),
    contentDigest: hash,
  })
  .strict()
  .superRefine((u, ctx) => {
    if (
      u.createdAt.getTime() !== u.updatedAt.getTime() ||
      u.contentDigest !== digest(u.observation) ||
      u.observation.runId !== u.runId ||
      u.observation.attemptId !== u.attemptId ||
      u.observation.workspaceId !== u.workspaceId
    )
      ctx.addIssue({ code: "custom", message: "Invalid Usage scope" });
  });
export type AgentRun = z.infer<typeof AgentRunSchema>;
export type AgentAttempt = z.infer<typeof AgentAttemptSchema>;
export const AgentResultSchema = AgentResultSchemaV10.superRefine((v, c) => {
  const output = v.envelope.outcome.content.domainOutput;
  if (
    output &&
    typeof output === "object" &&
    !Array.isArray(output) &&
    output.kind === "effectiveness_evaluation"
  ) {
    if (!EvaluationPayloadSchema.safeParse(output).success)
      c.addIssue({ code: "custom", message: "Invalid evaluation payload" });
  }
});
export type AgentResult = z.infer<typeof AgentResultSchema>;
export type AgentUsage = z.infer<typeof AgentUsageSchema>;

export function frozenTarget(work: FrozenAgentWork) {
  return work.protocolVersion === "2.0"
    ? workspaceTarget(work.executionTarget)
    : {
        kind: "client_agent" as const,
        id: work.clientAgent.id,
        revision: work.clientAgent.revision,
      };
}
