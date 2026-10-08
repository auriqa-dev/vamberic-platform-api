import { PRODUCT_WEBSITE_MANIFEST } from "@workspace/agent-runtime-protocol";
import { websiteReviewPin } from "./product-service-understanding/website-review";
import {
  WEBSITE_REVIEW_INPUT,
  parseWebsiteReviewResponse,
} from "@workspace/agent-runtime-protocol";
import {
  PRODUCT_REVIEWED_UNCERTAINTY_MANIFEST,
  PRODUCT_CLARIFICATION_MANIFEST,
  GENERAL_CLARIFICATION_INPUT,
  GeneralClarificationCheckpoint,
  parseGeneralAnswer,
  PSU_REVIEWED_INPUT,
  PsuUncertaintyCheckpointV2,
  parseReviewedAnswer,
} from "@workspace/agent-runtime-protocol";
import {
  parseFactSubmission,
  FactSubmissionCheckpointSchema,
  PSU_FACT_INPUT,
  PSU_FACT_POLICY,
  PRODUCT_GENERAL_MANIFEST,
} from "@workspace/agent-runtime-protocol";
import { frozenTarget } from "../domain/agent-control-plane";
import {
  serializeAgentAuthority,
  type AuthorityAnchor,
} from "./agent-authority-serialization";
import { z } from "zod";
import { outcomeWithinGrant } from "../domain/agent-outcome-scope";
import { randomUUID } from "node:crypto";
import type { ClientSession, Db, Document } from "mongodb";
import {
  AnswerProvenanceSchema,
  answerSubmissionId,
  digestWithout,
  validateAnswerProvenance,
  RuntimeClaimedWorkSchema as ClaimedWorkSchema,
  RuntimeDispatchSchema as DispatchSchema,
  RuntimeOutcomeSchema as OutcomeSchema,
  InputResponseSchema,
  UsageObservationSchema,
  digest,
  validateInputResponse,
  type RuntimeClaimedWork as ClaimedWork,
  type RuntimeDispatch as Dispatch,
  type RuntimeImplementationManifest as ImplementationManifest,
} from "@workspace/agent-runtime-protocol";
import type { AppConfig } from "../config";
import type { AuthenticatedUser } from "../middlewares/auth";
import { AuthorizationDenied } from "../authorization/policy";
import {
  createAgentWorkloadAuthority,
  type AgentWorkloadPrincipal,
  type AgentWorkloadAction,
} from "../authorization/agent-workload";
import {
  AgentRunSchema,
  AgentAttemptSchema,
  AgentResultSchema,
  AgentUsageSchema,
  type AgentRun,
  type AgentAttempt,
  type FrozenAgentWork,
  type AgentResult,
} from "../domain/agent-control-plane";
import { generatePlatformId, EventSchema } from "../domain/schemas";
import {
  decimalUnits,
  decimalAmount,
  remainingCost,
} from "../domain/agent-budget";
import type { MongoService } from "./mongo";
import { resolveHvmContext, withoutMongoId } from "./hvm-context";
import {
  requireAgentControlPlane,
  readOperatingTarget,
  AgentControlPlaneUnavailable,
  AgentOperatorConflict,
} from "./agent-operators";

export class AgentRunConflict extends Error {}
export interface AgentExecutionPolicy {
  /** Trusted composition only. Must check registered implementation/build,
   * models/tools, bindings, source projections and workspace spend policy. */
  current(db: Db, run: AgentRun, session: ClientSession): Promise<boolean>;
  /** Enumerate every further persisted readiness/authority dependency. */
  dependencies(
    db: Db,
    run: AgentRun,
    session: ClientSession,
  ): Promise<readonly AuthorityAnchor[]>;
}
export const unavailableExecutionPolicy: AgentExecutionPolicy = {
  async dependencies() {
    return [];
  },
  async current() {
    return false;
  },
};
export interface AgentLifecycleHooks {
  required(run: AgentRun): boolean;
  terminal(db: Db, run: AgentRun, session: ClientSession): Promise<void>;
  current(db: Db, run: AgentRun, session: ClientSession): Promise<boolean>;
  importedEvidence(
    db: Db,
    run: AgentRun,
    envelope: import("@workspace/agent-runtime-protocol").RuntimeOutcome,
    session: ClientSession,
  ): Promise<ReadonlySet<string>>;
  accepted(
    db: Db,
    run: AgentRun,
    result: AgentResult,
    session: ClientSession,
  ): Promise<void>;
}
type WorkloadAuthority = ReturnType<typeof createAgentWorkloadAuthority>;
type LeaseRequest = {
  runId: string;
  attemptId: string;
  generation: number;
  fence: number;
  leaseId: string;
};
const terminal = (run: AgentRun) =>
  ["completed", "failed", "cancelled"].includes(run.status);
const tick = (previous: Date, now: Date) =>
  new Date(Math.max(previous.getTime() + 1, now.getTime()));

/** Transactional lifecycle core. HTTP authentication and readiness construction
 * are deliberately separate trusted composition boundaries. No startup worker,
 * timer, transport or production workload principal is installed here. */
export function createAgentControlPlane(
  config: AppConfig,
  mongo: MongoService,
  workloads: WorkloadAuthority,
  policy: AgentExecutionPolicy = unavailableExecutionPolicy,
  clock: () => Date = () => new Date(),
  hooks?: AgentLifecycleHooks,
) {
  const transact = <T>(
    work: (db: Db, session: ClientSession) => Promise<T>,
  ) => {
    if (!mongo.withTransaction)
      throw new AgentControlPlaneUnavailable("Transactions required");
    return mongo.withTransaction(async (db, session) => {
      await requireAgentControlPlane(db, session);
      return work(db, session);
    });
  };
  async function load(db: Db, id: string, session: ClientSession) {
    const row = await db.collection("agent_runs").findOne({ id }, { session });
    if (!row) throw new AuthorizationDenied();
    return AgentRunSchema.parse(withoutMongoId(row));
  }
  async function save(
    db: Db,
    run: AgentRun,
    expected: Date,
    session: ClientSession,
  ) {
    const parsed = AgentRunSchema.parse(run);
    // Replacement is server-owned, based on a transaction-local validated row.
    // Explicit unset prevents stale optional lease/input fields surviving $set.
    const unset = Object.fromEntries(
      [
        "activeAttemptId",
        "checkpoint",
        "inputRequest",
        "inputResponse",
        "inputResponseDigest",
        "terminalReason",
        "cancelRequestedAt",
        "lastResultId",
      ]
        .filter((k) => !(k in parsed))
        .map((k) => [k, ""]),
    );
    const result = await db.collection("agent_runs").updateOne(
      { id: run.id, workspaceId: run.workspaceId, updatedAt: expected },
      {
        $set: parsed,
        ...(Object.keys(unset).length ? { $unset: unset } : {}),
      },
      { session },
    );
    if (!result.matchedCount) throw new AgentRunConflict("Run changed");
    if (
      run.effectiveness &&
      hooks &&
      ["failed", "cancelled"].includes(run.status)
    )
      await hooks.terminal(db, run, session);
  }
  async function audit(
    db: Db,
    run: AgentRun,
    operation: string,
    actor: Document,
    session: ClientSession,
    answerProvenance?: import("@workspace/agent-runtime-protocol").AnswerProvenance,
  ) {
    const now = clock();
    await db.collection("events").insertOne(
      EventSchema.parse({
        id: generatePlatformId("event"),
        workspaceId: run.workspaceId,
        createdAt: now,
        updatedAt: now,
        occurredAt: now,
        eventType: "agent_run_changed",
        payload: {
          application: "hvmapp",
          actor,
          runId: run.id,
          operation,
          generation: run.generation,
          ...(answerProvenance ? { answerProvenance } : {}),
        },
      }),
      { session },
    );
  }
  async function human(
    db: Db,
    run: AgentRun,
    identity: AuthenticatedUser,
    action: "read" | "respond" | "cancel",
    session: ClientSession,
  ) {
    if (run.frozen.protocolVersion !== "1.1" && action !== "read") {
      const ledger = await db
        .collection<{ _id: string; version: number }>("schema_versions")
        .findOne({ _id: "vapp-v1" }, { session });
      if (
        !(
          run.frozen.protocolVersion === "2.0"
            ? [16, 17, 18, 19, 20, 21, 22, 23, 24, 25]
            : [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25]
        ).includes(ledger?.version ?? 0)
      )
        throw new AgentControlPlaneUnavailable(
          "Protocol 1.2 requires schema v12",
        );
    }
    const resolved = await resolveHvmContext(db, config, identity, session);
    const permitted = resolved.authority.authorizeAgentOperation(
      resolved.context,
      {
        workspaceId: run.workspaceId,
        target: run.target,
        operation: run.operation,
        action,
        requester: run.requester,
        ...(run.authority.basis === "client"
          ? {
              membershipId: run.authority.membershipId,
              grantId: run.authority.grantId,
            }
          : {}),
      },
      clock(),
    );
    if (!permitted) throw new AuthorizationDenied();
    if (permitted.basis === "client")
      await readOperatingTarget(db, run.workspaceId, run.target, session);
    return { ...resolved, permitted };
  }
  async function executable(
    db: Db,
    run: AgentRun,
    session: ClientSession,
    allowCancellationAcknowledgement = false,
  ) {
    if (
      (run.cancelRequestedAt && !allowCancellationAcknowledgement) ||
      run.deadline <= clock() ||
      new Date(run.frozen.grant.expiresAt) <= clock()
    )
      return false;
    try {
      // The original requester, not a new Queen or a worker, remains the delegator.
      await human(
        db,
        run,
        {
          issuer: run.requester.issuer,
          subject: run.requester.id,
          clientId: run.requesterClientId,
        },
        "respond",
        session,
      );
      await readOperatingTarget(db, run.workspaceId, run.target, session);
      await serializeAgentAuthority(
        db,
        run,
        session,
        await policy.dependencies(db, run, session),
      );
      return (
        !(hooks?.required(run) && !run.effectiveness) &&
        (await policy.current(db, run, session)) &&
        (!run.effectiveness ||
          (!!hooks && (await hooks.current(db, run, session))))
      );
    } catch (error) {
      if (
        error instanceof AuthorizationDenied ||
        error instanceof AgentRunConflict ||
        error instanceof AgentOperatorConflict
      )
        return false;
      throw error;
    }
  }
  async function owned(
    db: Db,
    principal: AgentWorkloadPrincipal,
    request: LeaseRequest,
    action: AgentWorkloadAction,
    session: ClientSession,
  ) {
    workloads.require(principal, action);
    const run = await load(db, request.runId, session);
    const row = await db
      .collection("agent_attempts")
      .findOne(
        { id: request.attemptId, runId: run.id, workspaceId: run.workspaceId },
        { session },
      );
    if (!row) throw new AuthorizationDenied();
    const attempt = AgentAttemptSchema.parse(withoutMongoId(row));
    if (
      run.activeAttemptId !== attempt.id ||
      run.status !== "running" ||
      attempt.status !== "running" ||
      run.generation !== request.generation ||
      attempt.generation !== request.generation ||
      run.fence !== request.fence ||
      attempt.fence !== request.fence ||
      attempt.leaseId !== request.leaseId ||
      attempt.workerId !== principal.workerId ||
      attempt.workloadClientId !== principal.clientId ||
      attempt.leaseUntil <= clock()
    )
      throw new AuthorizationDenied();
    return { run, attempt };
  }
  async function finishAttempt(
    db: Db,
    attempt: AgentAttempt,
    status: AgentAttempt["status"],
    session: ClientSession,
  ) {
    const now = clock();
    const next = AgentAttemptSchema.parse({
      ...attempt,
      status,
      endedAt: now,
      updatedAt: tick(attempt.updatedAt, now),
    });
    const result = await db
      .collection("agent_attempts")
      .updateOne(
        { id: attempt.id, status: "running", fence: attempt.fence },
        { $set: next },
        { session },
      );
    if (!result.matchedCount)
      throw new AgentRunConflict("Attempt already finalized");
  }
  function close(
    run: AgentRun,
    status: "completed" | "failed" | "cancelled",
    reason: AgentRun["terminalReason"],
  ) {
    run.status = status;
    run.terminalReason = reason;
    delete run.activeAttemptId;
    delete run.inputRequest;
    delete run.inputResponse;
    delete run.inputResponseDigest;
  }
  function queue(
    run: AgentRun,
    notBefore: Date,
    reason: AgentRun["nextAttemptReason"] = "retry",
  ) {
    run.nextAttemptReason = reason;
    run.status = "queued";
    run.generation++;
    run.notBefore = notBefore;
    run.dispatch = { id: randomUUID(), generation: run.generation, fence: 0 };
    delete run.activeAttemptId;
  }
  async function claimedWork(
    db: Db,
    run: AgentRun,
    attempt: AgentAttempt,
    session: ClientSession,
  ): Promise<ClaimedWork> {
    const resume = run.checkpoint
      ? run.inputRequest && run.inputResponse
        ? {
            kind: "input",
            checkpoint: run.checkpoint,
            request: run.inputRequest,
            response: run.inputResponse,
          }
        : { kind: "continuation", checkpoint: run.checkpoint }
      : undefined;
    if (run.frozen.protocolVersion !== "1.1" && resume?.kind === "input") {
      const events = await db
        .collection("events")
        .find(
          {
            workspaceId: run.workspaceId,
            eventType: "agent_run_changed",
            "payload.operation": "input_answered",
            "payload.runId": run.id,
            "payload.answerProvenance.requestId": run.inputRequest!.id,
          },
          { session },
        )
        .limit(2)
        .toArray();
      if (events.length !== 1)
        throw new AgentRunConflict("Missing or ambiguous answer provenance");
      const event = events[0]!;
      const provenance = AnswerProvenanceSchema.parse(
        event.payload.answerProvenance,
      );
      if (
        digest(provenance.actor) !== digest(event.payload.actor) ||
        provenance.resumeGeneration !== event.payload.generation
      )
        throw new AgentRunConflict("Answer provenance audit binding mismatch");
      validateAnswerProvenance(provenance, {
        ...run.frozen,
        protocolVersion: "1.2",
        generation: attempt.generation,
        resume: resume as ClaimedWork["resume"],
      });
      Object.assign(resume, { answerProvenance: provenance });
    }
    return ClaimedWorkSchema.parse({
      ...run.frozen,
      attemptId: attempt.id,
      generation: attempt.generation,
      fence: attempt.fence,
      lease: {
        id: attempt.leaseId,
        workerId: attempt.workerId,
        expiresAt: attempt.leaseUntil.toISOString(),
      },
      grant: {
        ...run.frozen.grant,
        budgets: {
          ...run.frozen.grant.budgets,
          modelCalls: Math.floor(
            run.frozen.grant.budgets.modelCalls / run.limits.attempts,
          ),
          toolCalls: Math.floor(
            run.frozen.grant.budgets.toolCalls / run.limits.attempts,
          ),
          providerCalls: run.frozen.grant.budgets.providerCalls.map((p) => ({
            ...p,
            calls: Math.floor(p.calls / run.limits.attempts),
          })),
          cost: {
            ...run.frozen.grant.budgets.cost,
            amount: attempt.reservedCost,
          },
        },
      },
      ...(resume ? { resume } : {}),
    });
  }
  async function usage(
    db: Db,
    run: AgentRun,
    attempt: AgentAttempt,
    input: unknown,
    session: ClientSession,
  ) {
    const observation = UsageObservationSchema.parse(input);
    if (
      observation.runId !== run.id ||
      observation.attemptId !== attempt.id ||
      observation.workspaceId !== run.workspaceId ||
      (observation.clientAgentId &&
        observation.clientAgentId !== run.target.id) ||
      (observation.cost.status !== "unknown" &&
        observation.cost.currency !== run.frozen.grant.budgets.cost.currency)
    )
      throw new AuthorizationDenied();
    const grant = run.frozen.grant;
    if (
      (observation.category === "model" &&
        !grant.models.some(
          (m) =>
            m.provider === observation.provider &&
            m.model === observation.model,
        )) ||
      (observation.category === "tool" &&
        !grant.tools.some(
          (t) =>
            t.provider === observation.provider &&
            t.key === observation.tool &&
            t.operation === observation.operation,
        )) ||
      new Date(observation.startedAt) < attempt.startedAt ||
      new Date(observation.endedAt) > (attempt.endedAt ?? clock())
    )
      throw new AuthorizationDenied();
    const contentDigest = digest(observation);
    const previous = await db
      .collection("agent_usage_observations")
      .findOne(
        { "observation.id": observation.id, runId: run.id },
        { session },
      );
    if (previous) {
      if (previous.contentDigest !== contentDigest)
        throw new AgentRunConflict(
          "Usage identity reused with different content",
        );
      return;
    }
    if (
      (await db
        .collection("agent_usage_observations")
        .countDocuments(
          { attemptId: attempt.id, runId: run.id },
          { session },
        )) >= 200
    )
      throw new AgentRunConflict("Usage observation limit reached");
    if (observation.supersedes) {
      const source = await db.collection("agent_usage_observations").findOne(
        {
          "observation.id": observation.supersedes,
          runId: run.id,
          attemptId: attempt.id,
          workspaceId: run.workspaceId,
        },
        { session },
      );
      if (
        !source ||
        source.observation.invocationId !== observation.invocationId
      )
        throw new AgentRunConflict("Invalid usage correction");
      if (
        await db
          .collection("agent_usage_observations")
          .findOne(
            { "observation.supersedes": observation.supersedes, runId: run.id },
            { session },
          )
      )
        throw new AgentRunConflict("Usage already superseded");
    }
    const now = clock();
    await db.collection("agent_usage_observations").insertOne(
      AgentUsageSchema.parse({
        id: generatePlatformId("agentusage"),
        workspaceId: run.workspaceId,
        runId: run.id,
        attemptId: attempt.id,
        createdAt: now,
        updatedAt: now,
        observation,
        contentDigest,
      }),
      { session },
    );
  }
  return {
    /** Trusted operational composition only; called in the slot transaction. */
    async authorizeInvocation(
      db: Db,
      session: ClientSession,
      principal: AgentWorkloadPrincipal,
      binding: import("../domain/agent-capacity").SlotBinding,
      action: "acquire" | "send" | "terminal" | "quarantine",
    ) {
      const { run, attempt } = await owned(
        db,
        principal,
        binding,
        "capacity",
        session,
      );
      if (
        run.workspaceId !== binding.workspaceId ||
        run.frozen.implementation.manifestDigest !==
          binding.release.manifestDigest ||
        run.frozen.implementation.buildDigest !== binding.release.buildDigest
      )
        throw new AuthorizationDenied();
      if (
        (action === "acquire" || action === "send") &&
        !(await executable(db, run, session))
      )
        throw new AuthorizationDenied();
      if (action === "acquire") {
        const used = await db.collection("events").countDocuments(
          {
            "payload.operation": "provider_execution_slot",
            "payload.binding.runId": run.id,
            "payload.binding.attemptId": attempt.id,
            "payload.state": "occupied",
          },
          { session },
        );
        if (
          used >=
          Math.floor(run.frozen.grant.budgets.modelCalls / run.limits.attempts)
        )
          throw new AgentRunConflict("Attempt invocation allowance exhausted");
      }
      // Conflict with cancellation, heartbeat, terminalization and a new fence.
      const previousUpdatedAt = run.updatedAt;
      run.updatedAt = tick(previousUpdatedAt, clock());
      await save(db, run, previousUpdatedAt, session);
      const locked = await db.collection("agent_attempts").updateOne(
        {
          id: attempt.id,
          updatedAt: attempt.updatedAt,
          status: "running",
          fence: attempt.fence,
        },
        { $set: { updatedAt: tick(attempt.updatedAt, clock()) } },
        { session },
      );
      if (locked.matchedCount !== 1)
        throw new AgentRunConflict("Attempt changed");
    },
    async list(
      identity: AuthenticatedUser,
      workspaceId: string,
      input: unknown = {},
    ) {
      const query = z
        .object({
          limit: z.coerce.number().int().min(1).max(100).default(20),
          offset: z.coerce.number().int().min(0).max(10000).default(0),
        })
        .strict()
        .parse(input);
      return transact(async (db, session) => {
        const resolved = await resolveHvmContext(db, config, identity, session);
        const queen = resolved.authority.authorize(resolved.context, "read", {
          type: "agent_runs",
          workspaceId,
        });
        const rows = await db
          .collection("agent_runs")
          .find(
            {
              workspaceId,
              ...(queen
                ? {}
                : {
                    "requester.id": identity.subject,
                    "requester.issuer": identity.issuer,
                  }),
            },
            { session },
          )
          .sort({ createdAt: -1, id: -1 })
          .skip(query.offset)
          .limit(query.limit)
          .toArray();
        const items = [];
        for (const row of rows) {
          const run = AgentRunSchema.parse(withoutMongoId(row));
          try {
            await human(db, run, identity, "read", session);
          } catch (error) {
            if (
              error instanceof AuthorizationDenied ||
              error instanceof AgentOperatorConflict
            )
              continue;
            throw error;
          }
          items.push({
            id: run.id,
            workspaceId,
            target: run.target,
            operation: run.operation,
            status: run.status,
            createdAt: run.createdAt.toISOString(),
            updatedAt: run.updatedAt.toISOString(),
          });
        }
        return { items, offset: query.offset, limit: query.limit };
      });
    },
    async read(identity: AuthenticatedUser, runId: string) {
      return transact(async (db, session) => {
        const run = await load(db, runId, session);
        await human(db, run, identity, "read", session);
        const input =
          run.status === "awaiting_input" && run.inputRequest
            ? {
                id: run.inputRequest.id,
                schemaKey: run.inputRequest.schemaKey,
                schemaVersion: run.inputRequest.schemaVersion,
                question: run.inputRequest.question,
                reason: run.inputRequest.reason,
                fields: run.inputRequest.fields,
                expiresAt: run.inputRequest.expiresAt,
              }
            : undefined;
        const websiteReview =
          input?.schemaKey === WEBSITE_REVIEW_INPUT
            ? websiteReviewPin(run, run.checkpoint?.payload).draft
            : undefined;
        let factReview;
        if (input?.schemaKey === PSU_FACT_INPUT) {
          const pin = FactSubmissionCheckpointSchema.parse(
            run.checkpoint?.payload,
          );
          if (pin.inputDigest !== digest(run.frozen.input))
            throw new AgentRunConflict("Fact checkpoint context changed");
          const snapshots = run.frozen.context.snapshots.filter(
            (s) => s.reference.resourceType === "agent_result_projection",
          );
          if (snapshots.length !== 1)
            throw new AgentRunConflict(
              "Fact checkpoint requires exact Candidate",
            );
          const content = z
            .object({
              proposals: z.array(
                z.object({ id: z.string(), candidate: z.record(z.unknown()) }),
              ),
            })
            .parse(snapshots[0]!.payload);
          if (
            content.proposals.length !== 1 ||
            content.proposals[0]!.id !== "offering_understanding"
          )
            throw new AgentRunConflict(
              "Fact checkpoint requires exact proposal",
            );
          const proposal = content.proposals[0]!.candidate;
          factReview = pin.slots.map((slot) => {
            const raw = proposal[slot.target];
            const before =
              raw === undefined
                ? null
                : slot.target === "explicitExclusions"
                  ? z.array(z.string().max(4000)).max(40).parse(raw)
                  : z.string().max(4000).parse(raw);
            return {
              key: slot.key,
              target: slot.target,
              before,
              effect:
                slot.target === "explicitExclusions" ? "append" : "replace",
            };
          });
        }
        if (
          input?.schemaKey === PSU_REVIEWED_INPUT ||
          input?.schemaKey === GENERAL_CLARIFICATION_INPUT
        ) {
          const isGeneral = input.schemaKey === GENERAL_CLARIFICATION_INPUT;
          const pin = (
            isGeneral
              ? GeneralClarificationCheckpoint
              : PsuUncertaintyCheckpointV2
          ).parse(run.checkpoint?.payload);
          const prepared = z
            .object({ uncertaintyOrigin: z.unknown() })
            .parse(run.frozen.input);
          if (
            pin.inputDigest !== digest(run.frozen.input) ||
            digest(pin.origin) !== digest(prepared.uncertaintyOrigin) ||
            run.frozen.implementation.manifestDigest !==
              (isGeneral
                ? PRODUCT_CLARIFICATION_MANIFEST
                : PRODUCT_REVIEWED_UNCERTAINTY_MANIFEST
              ).manifestDigest
          )
            throw new AgentRunConflict(
              "Reviewed clarification context changed",
            );
          const proposals = pin.base.content.proposals;
          if (
            proposals.length !== 1 ||
            proposals[0]!.id !== "offering_understanding"
          )
            throw new AgentRunConflict(
              "Reviewed clarification requires exact proposal",
            );
          const proposal = z.record(z.unknown()).parse(proposals[0]!.candidate);
          factReview = pin.slots.map((slot) => ({
            key: slot.key,
            target: slot.target,
            before:
              proposal[slot.target] === undefined
                ? null
                : z.string().max(4000).parse(proposal[slot.target]),
            effect: "replace",
          }));
        }
        return {
          id: run.id,
          workspaceId: run.workspaceId,
          target: run.target,
          operation: run.operation,
          status: run.status,
          createdAt: run.createdAt.toISOString(),
          updatedAt: run.updatedAt.toISOString(),
          terminalReason: run.terminalReason,
          lastResultId: run.lastResultId,
          ...(input ? { input } : {}),
          ...(factReview ? { factReview } : {}),
          ...(websiteReview ? { websiteReview } : {}),
        };
      });
    },
    async results(identity: AuthenticatedUser, runId: string) {
      return transact(async (db, session) => {
        const run = await load(db, runId, session);
        await human(db, run, identity, "read", session);
        const rows = await db
          .collection("agent_results")
          .find({ runId, workspaceId: run.workspaceId }, { session })
          .sort({ createdAt: 1, id: 1 })
          .limit(101)
          .toArray();
        if (rows.length > 100)
          throw new AgentRunConflict("Result history exceeds Run limit");
        return rows.map((row) => {
          const r = AgentResultSchema.parse(withoutMongoId(row));
          return {
            id: r.id,
            runId,
            attemptId: r.attemptId,
            createdAt: r.createdAt.toISOString(),
            updatedAt: r.updatedAt.toISOString(),
            outcome: r.envelope.outcome.kind,
            completeness: r.envelope.outcome.completeness,
            content: r.envelope.outcome.content,
            dispositions: r.dispositions,
          };
        });
      });
    },
    /** Durable publisher lease. Transport gets references only. Re-publication
     * after send-before-ack crash is intentional; claim fences duplicates. */
    async publish(
      runId: string,
      publisherId: string,
      sink: { send(message: Dispatch): Promise<void> },
    ) {
      z.string()
        .min(1)
        .max(100)
        .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/)
        .parse(publisherId);
      const intent = await transact(async (db, session) => {
        const run = await load(db, runId, session);
        const now = clock();
        if (
          run.status !== "queued" ||
          run.notBefore > now ||
          run.deadline <= now ||
          run.cancelRequestedAt ||
          (run.dispatch.leaseUntil && run.dispatch.leaseUntil > now)
        )
          return undefined;
        if (!(await executable(db, run, session))) return undefined;
        const expected = run.updatedAt;
        run.dispatch = {
          ...run.dispatch,
          publisherId,
          fence: run.dispatch.fence + 1,
          leaseUntil: new Date(now.getTime() + 30_000),
        };
        run.updatedAt = tick(expected, now);
        await save(db, run, expected, session);
        return {
          fence: run.dispatch.fence,
          message: DispatchSchema.parse({
            protocolVersion: run.frozen.protocolVersion,
            environment: config.deploymentEnvironment,
            runId,
            generation: run.generation,
            dispatchId: run.dispatch.id,
            notBefore: run.notBefore.toISOString(),
            traceId: run.frozen.traceId,
          }),
        };
      });
      if (!intent) return false;
      await sink.send(intent.message);
      await transact(async (db, session) => {
        const run = await load(db, runId, session);
        if (
          run.status !== "queued" ||
          run.generation !== intent.message.generation ||
          run.dispatch.fence !== intent.fence ||
          run.dispatch.publisherId !== publisherId
        )
          return;
        const expected = run.updatedAt;
        run.dispatch.lastPublishedAt = clock();
        // Retain a bounded redelivery delay until a worker claims the intent.
        run.dispatch.leaseUntil = new Date(clock().getTime() + 30_000);
        run.updatedAt = tick(expected, clock());
        await save(db, run, expected, session);
      });
      return true;
    },
    /** Explicit scheduler seam; never runs DDL or registers an import-time timer. */
    reconcile(runId: string) {
      return transact(async (db, session) => {
        const run = await load(db, runId, session);
        if (terminal(run)) return run.status;
        const expected = run.updatedAt;
        const now = clock();
        const active = run.activeAttemptId
          ? await db
              .collection("agent_attempts")
              .findOne({ id: run.activeAttemptId, runId }, { session })
          : undefined;
        const attempt = active
          ? AgentAttemptSchema.parse(withoutMongoId(active))
          : undefined;
        if (
          run.cancelRequestedAt ||
          run.deadline <= now ||
          !(await executable(db, run, session))
        ) {
          if (attempt) await finishAttempt(db, attempt, "cancelled", session);
          close(
            run,
            run.deadline <= now ? "failed" : "cancelled",
            run.deadline <= now
              ? "deadline"
              : run.cancelRequestedAt
                ? "cancelled"
                : "revoked",
          );
        } else if (
          run.status === "awaiting_input" &&
          run.inputRequest &&
          new Date(run.inputRequest.expiresAt) <= now
        )
          close(run, "failed", "input_expired");
        else if (attempt && attempt.leaseUntil <= now) {
          await finishAttempt(db, attempt, "expired", session);
          run.failures++;
          run.fence++;
          if (
            run.failures > run.limits.failures ||
            run.attemptCount >= run.limits.attempts
          )
            close(run, "failed", "retry_exhausted");
          else
            queue(
              run,
              new Date(
                now.getTime() + Math.min(60_000, 1000 * 2 ** run.failures),
              ),
            );
        } else if (
          run.status === "queued" &&
          run.attemptCount >= run.limits.attempts
        )
          close(run, "failed", "attempt_limit");
        else return run.status;
        run.updatedAt = tick(expected, now);
        await save(db, run, expected, session);
        await audit(
          db,
          run,
          "reconciled",
          { type: "system", id: "agent_control_plane" },
          session,
        );
        return run.status;
      });
    },
    receipt(
      principal: AgentWorkloadPrincipal,
      request: LeaseRequest & { submissionId: string; payloadDigest: string },
    ) {
      workloads.require(principal, "receipt");
      return transact(async (db, session) => {
        const row = await db.collection("agent_attempts").findOne(
          {
            id: request.attemptId,
            runId: request.runId,
            workerId: principal.workerId,
            workloadClientId: principal.clientId,
            generation: request.generation,
            fence: request.fence,
            leaseId: request.leaseId,
          },
          { session },
        );
        if (!row) throw new AuthorizationDenied();
        const attempt = AgentAttemptSchema.parse(withoutMongoId(row));
        if (!attempt.receipt) return undefined;
        if (
          attempt.receipt.submissionId !== request.submissionId ||
          attempt.receipt.payloadDigest !== request.payloadDigest
        )
          throw new AgentRunConflict("Conflicting receipt lookup");
        return attempt.receipt;
      });
    },
    reportUsage(
      principal: AgentWorkloadPrincipal,
      request: LeaseRequest,
      input: unknown,
    ) {
      workloads.require(principal, "usage");
      return transact(async (db, session) => {
        const run = await load(db, request.runId, session);
        const row = await db.collection("agent_attempts").findOne(
          {
            id: request.attemptId,
            runId: run.id,
            workspaceId: run.workspaceId,
            workerId: principal.workerId,
            workloadClientId: principal.clientId,
            generation: request.generation,
            fence: request.fence,
            leaseId: request.leaseId,
          },
          { session },
        );
        if (!row) throw new AuthorizationDenied();
        const attempt = AgentAttemptSchema.parse(withoutMongoId(row));
        // Narrow late-usage path: same authenticated worker/Attempt only, within
        // 24 hours of terminalization. It cannot read context or submit Results.
        if (attempt.status === "running")
          await owned(db, principal, request, "usage", session);
        else if (
          !attempt.endedAt ||
          clock().getTime() > attempt.endedAt.getTime() + 86_400_000
        )
          throw new AuthorizationDenied();
        await usage(db, run, attempt, input, session);
        return { accepted: true };
      });
    },
    /** Called only after trusted readiness/grant construction; not an HTTP body. */
    async acceptPrepared(
      identity: AuthenticatedUser,
      prepared: {
        frozen: FrozenAgentWork;
        requestKey: string;
        limits: AgentRun["limits"];
        manifest: ImplementationManifest;
        effectiveness?: AgentRun["effectiveness"];
      },
      inspectOnly = false,
    ) {
      return transact(async (db, session) => {
        const now = clock();
        const work = prepared.frozen;
        if (work.protocolVersion !== "1.1") {
          const ledger = await db
            .collection<{ _id: string; version: number }>("schema_versions")
            .findOne({ _id: "vapp-v1" }, { session });
          if (
            !(
              work.protocolVersion === "2.0"
                ? [16, 17, 18, 19, 20, 21, 22, 23, 24, 25]
                : [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25]
            ).includes(ledger?.version ?? 0)
          )
            throw new AgentControlPlaneUnavailable(
              "Protocol 1.2 requires schema v12",
            );
        }
        if (work.grant.tools.some((t) => t.class === "external_mutation"))
          throw new AuthorizationDenied();
        const target = frozenTarget(work);
        await readOperatingTarget(db, work.workspaceId, target, session);
        const resolved = await resolveHvmContext(db, config, identity, session);
        const authority = resolved.authority.authorizeAgentOperation(
          resolved.context,
          {
            workspaceId: work.workspaceId,
            target,
            operation: work.operation,
            action: "request",
          },
          now,
        );
        if (!authority) throw new AuthorizationDenied();
        const requestDigest = digest({
          target,
          operation: work.operation,
          input: work.input,
        });
        const existing = await db.collection("agent_runs").findOne(
          {
            workspaceId: work.workspaceId,
            "requester.issuer": identity.issuer,
            "requester.id": identity.subject,
            requestKey: prepared.requestKey,
          },
          { session },
        );
        if (existing) {
          if (existing.requestDigest !== requestDigest)
            throw new AgentRunConflict("Request key reused");
          return { id: existing.id, status: existing.status };
        }
        const run = AgentRunSchema.parse({
          id: work.runId,
          workspaceId: work.workspaceId,
          organisationId: work.clientId,
          requester: resolved.response.human,
          requesterClientId: identity.clientId,
          authority,
          target,
          operation: work.operation,
          requestKey: prepared.requestKey,
          requestDigest,
          ...(prepared.effectiveness
            ? { effectiveness: prepared.effectiveness }
            : {}),
          frozen: work,
          manifest: prepared.manifest,
          frozenDigest: digest(work),
          createdAt: now,
          updatedAt: now,
          status: "queued",
          generation: 1,
          fence: 0,
          attemptCount: 0,
          failures: 0,
          inputCycles: 0,
          continuations: 0,
          limits: prepared.limits,
          deadline: new Date(work.grant.budgets.deadline),
          notBefore: now,
          dispatch: { id: randomUUID(), generation: 1, fence: 0 },
        });
        if (
          digest(run.manifest.implementation) !==
            digest({
              key: work.implementation.key,
              version: work.implementation.version,
            }) ||
          run.manifest.manifestDigest !== work.implementation.manifestDigest ||
          run.manifest.buildDigest !== work.implementation.buildDigest ||
          !run.manifest.operations.includes(work.operation) ||
          !run.manifest.compatibleDefinitions.some(
            (d) =>
              d.key === work.definition.key &&
              d.version === work.definition.version,
          ) ||
          !run.manifest.protocolVersions.some(
            (v) => v === work.protocolVersion,
          ) ||
          !run.manifest.resultSchemaVersions.includes(
            work.resultSchemaVersion,
          ) ||
          !run.manifest.checkpointSchemaVersions.includes(
            work.checkpointSchemaVersion,
          )
        )
          throw new AgentRunConflict("Implementation manifest pins differ");
        if (!inspectOnly)
          await serializeAgentAuthority(
            db,
            run,
            session,
            await policy.dependencies(db, run, session),
          );
        if (hooks?.required(run) && !run.effectiveness)
          throw new AuthorizationDenied();
        if (!(await policy.current(db, run, session)))
          throw new AgentControlPlaneUnavailable("Execution unavailable");
        if (
          run.effectiveness &&
          (!hooks || !(await hooks.current(db, run, session)))
        )
          throw new AuthorizationDenied();
        if (inspectOnly) return { id: run.id, status: "ready" };
        await db.collection("agent_runs").insertOne(run, { session });
        await audit(db, run, "requested", resolved.response.human, session);
        return { id: run.id, status: run.status };
      });
    },
    /** Delivery disposition contains no tenant data and never grants execution. */
    dispatchStatus(principal: AgentWorkloadPrincipal, input: unknown) {
      workloads.require(principal, "claim");
      const dispatch = DispatchSchema.parse(input);
      if (dispatch.environment !== principal.environment)
        throw new AuthorizationDenied();
      return transact(async (db, session) => {
        const run = await load(db, dispatch.runId, session);
        if (dispatch.generation > run.generation) throw new AgentRunConflict();
        const obsolete =
          dispatch.generation < run.generation ||
          (dispatch.generation === run.generation &&
            dispatch.dispatchId === run.dispatch.id &&
            (terminal(run) || run.status === "awaiting_input"));
        return {
          disposition: obsolete ? ("discard" as const) : ("retry" as const),
        };
      });
    },
    /** Transport failure, not an Agent Result. No supplied provenance is accepted.
     * A terminal response acknowledges existing durable state, not successful work. */
    rejectWork(
      principal: AgentWorkloadPrincipal,
      request: LeaseRequest,
      input: unknown,
    ) {
      workloads.require(principal, "outcome");
      const reason = z
        .enum([
          "invalid_work",
          "configuration_error",
          "implementation_failure",
          "unauthorized_or_revoked",
          "timeout",
          "cancelled",
        ])
        .parse(input);
      return transact(async (db, session) => {
        const row = await db.collection("agent_attempts").findOne(
          {
            id: request.attemptId,
            runId: request.runId,
            generation: request.generation,
            fence: request.fence,
            leaseId: request.leaseId,
            workerId: principal.workerId,
            workloadClientId: principal.clientId,
          },
          { session },
        );
        if (!row) throw new AuthorizationDenied();
        const previous = AgentAttemptSchema.parse(withoutMongoId(row));
        if (previous.status !== "running")
          return { status: "terminal" as const };
        const { run, attempt } = await owned(
          db,
          principal,
          request,
          "outcome",
          session,
        );
        const expected = run.updatedAt;
        const allowed = await executable(db, run, session);
        await finishAttempt(
          db,
          attempt,
          allowed ? "failed" : "cancelled",
          session,
        );
        const deadlineExpired = run.deadline <= clock();
        close(
          run,
          allowed || deadlineExpired ? "failed" : "cancelled",
          deadlineExpired
            ? "deadline"
            : run.cancelRequestedAt
              ? "cancelled"
              : allowed
                ? "runtime_failure"
                : "revoked",
        );
        run.updatedAt = tick(expected, clock());
        await save(db, run, expected, session);
        await audit(
          db,
          run,
          `runtime_rejected_${reason}`,
          { type: "system", id: principal.workerId },
          session,
        );
        return { status: "terminal" as const };
      });
    },
    claim(
      principal: AgentWorkloadPrincipal,
      input: { dispatch: unknown; claimId: string },
    ) {
      workloads.require(principal, "claim");
      const dispatch = DispatchSchema.parse(input.dispatch);
      if (dispatch.environment !== principal.environment)
        throw new AuthorizationDenied();
      return transact(async (db, session) => {
        const run = await load(db, dispatch.runId, session);
        const now = clock();
        const expected = run.updatedAt;
        if (
          run.frozen.protocolVersion !== dispatch.protocolVersion ||
          run.generation !== dispatch.generation ||
          run.dispatch.id !== dispatch.dispatchId ||
          run.notBefore > now
        )
          throw new AgentRunConflict("Stale or ineligible dispatch");
        if (!(await executable(db, run, session)))
          throw new AuthorizationDenied();
        if (run.status === "running") {
          const previous = await db.collection("agent_attempts").findOne(
            {
              id: run.activeAttemptId,
              claimId: input.claimId,
              workerId: principal.workerId,
              workloadClientId: principal.clientId,
            },
            { session },
          );
          if (previous && previous.leaseUntil > now)
            return claimedWork(
              db,
              run,
              AgentAttemptSchema.parse(withoutMongoId(previous)),
              session,
            );
        }
        if (run.status !== "queued" || run.attemptCount >= run.limits.attempts)
          throw new AgentRunConflict("Run is not claimable");
        const attempts = await db
          .collection("agent_attempts")
          .find({ runId: run.id }, { session })
          .limit(101)
          .toArray();
        const observations = await db
          .collection("agent_usage_observations")
          .find({ runId: run.id }, { session })
          .limit(20_001)
          .toArray();
        if (observations.length > 20_000 || attempts.length > 100)
          throw new AgentRunConflict("Execution history exceeds bound");
        const remaining = decimalUnits(
          remainingCost(
            run.frozen.grant.budgets.cost,
            attempts.map((a) => ({
              amount: a.reservedCost,
              settled: false,
              observations: observations
                .filter((o) => o.attemptId === a.id)
                .map(
                  (o) => AgentUsageSchema.parse(withoutMongoId(o)).observation,
                ),
            })),
          ),
        );
        const free = decimalUnits(run.frozen.grant.budgets.cost.amount) === 0n;
        if (!free && remaining <= 0n)
          throw new AgentRunConflict("Run budget exhausted");
        // Reserve a bounded share; retries cannot receive the original full Run budget.
        const slots = BigInt(run.limits.attempts - run.attemptCount);
        const allowance = remaining / slots;
        if (!free && !allowance)
          throw new AgentRunConflict("Attempt allowance exhausted");
        const attempt = AgentAttemptSchema.parse({
          id: generatePlatformId("agentattempt"),
          workspaceId: run.workspaceId,
          runId: run.id,
          createdAt: now,
          updatedAt: now,
          startedAt: now,
          ordinal: run.attemptCount + 1,
          generation: run.generation,
          fence: run.fence + 1,
          reason: run.nextAttemptReason,
          status: "running",
          claimId: input.claimId,
          workerId: principal.workerId,
          workloadClientId: principal.clientId,
          leaseId: randomUUID(),
          leaseUntil: new Date(
            Math.min(
              now.getTime() + 90_000,
              run.deadline.getTime(),
              new Date(run.frozen.grant.expiresAt).getTime(),
            ),
          ),
          reservedCost: decimalAmount(allowance),
          ...(run.inputResponse
            ? { consumedInputRequestId: run.inputResponse.requestId }
            : {}),
          ...(run.checkpoint
            ? { consumedCheckpointDigest: run.checkpoint.digest }
            : {}),
        });
        run.activeAttemptId = attempt.id;
        run.status = "running";
        run.fence = attempt.fence;
        run.attemptCount++;
        run.updatedAt = tick(expected, now);
        const work = await claimedWork(db, run, attempt, session);
        await db.collection("agent_attempts").insertOne(attempt, { session });
        await save(db, run, expected, session);
        await audit(
          db,
          run,
          "claimed",
          { type: "system", id: principal.workerId },
          session,
        );
        return work;
      });
    },
    heartbeat(principal: AgentWorkloadPrincipal, request: LeaseRequest) {
      return transact(async (db, session) => {
        const { run, attempt } = await owned(
          db,
          principal,
          request,
          "heartbeat",
          session,
        );
        if (!(await executable(db, run, session))) {
          const expected = run.updatedAt;
          await finishAttempt(db, attempt, "cancelled", session);
          close(
            run,
            run.deadline <= clock() ? "failed" : "cancelled",
            run.deadline <= clock()
              ? "deadline"
              : run.cancelRequestedAt
                ? "cancelled"
                : "revoked",
          );
          run.updatedAt = tick(expected, clock());
          await save(db, run, expected, session);
          await audit(
            db,
            run,
            "execution_stopped",
            { type: "system", id: principal.workerId },
            session,
          );
          return { continue: false as const };
        }
        const expires = new Date(
          Math.min(
            clock().getTime() + 90_000,
            run.deadline.getTime(),
            new Date(run.frozen.grant.expiresAt).getTime(),
          ),
        );
        await db.collection("agent_attempts").updateOne(
          { id: attempt.id, status: "running", fence: attempt.fence },
          {
            $set: {
              leaseUntil: expires,
              updatedAt: tick(attempt.updatedAt, clock()),
            },
          },
          { session },
        );
        return {
          continue: true as const,
          leaseExpiresAt: expires.toISOString(),
        };
      });
    },
    context(
      principal: AgentWorkloadPrincipal,
      request: LeaseRequest & { snapshotId: string },
    ) {
      return transact(async (db, session) => {
        const { run } = await owned(db, principal, request, "context", session);
        if (!(await executable(db, run, session)))
          throw new AuthorizationDenied();
        const snapshot = run.frozen.context.snapshots.find(
          (s) => s.id === request.snapshotId,
        );
        if (!snapshot) throw new AuthorizationDenied();
        return structuredClone(snapshot);
      });
    },
    outcome(
      principal: AgentWorkloadPrincipal,
      request: LeaseRequest,
      input: unknown,
    ) {
      workloads.require(principal, "outcome");
      const envelope = OutcomeSchema.parse(input);
      return transact(async (db, session) => {
        // Durable receipt check precedes live-lease checks, but remains scoped to
        // the original authenticated worker, Attempt, fence and exact payload.
        const previous = await db.collection("agent_attempts").findOne(
          {
            id: request.attemptId,
            runId: request.runId,
            workerId: principal.workerId,
            workloadClientId: principal.clientId,
            fence: request.fence,
            generation: request.generation,
            leaseId: request.leaseId,
          },
          { session },
        );
        if (previous?.receipt) {
          if (
            previous.receipt.submissionId !== envelope.submissionId ||
            previous.receipt.payloadDigest !== envelope.payloadDigest
          )
            throw new AgentRunConflict("Conflicting outcome replay");
          return previous.receipt;
        }
        const { run, attempt } = await owned(
          db,
          principal,
          request,
          "outcome",
          session,
        );
        if (
          !(await executable(
            db,
            run,
            session,
            envelope.outcome.kind === "cancelled",
          ))
        )
          throw new AuthorizationDenied();
        const imported =
          run.effectiveness && hooks
            ? await hooks.importedEvidence(db, run, envelope, session)
            : new Set<string>();
        if (
          envelope.protocolVersion !== run.frozen.protocolVersion ||
          envelope.runId !== run.id ||
          envelope.attemptId !== attempt.id ||
          envelope.fence !== attempt.fence ||
          envelope.generation !== attempt.generation ||
          digest(envelope.implementation) !==
            digest(run.frozen.implementation) ||
          envelope.resultSchemaVersion !== run.frozen.resultSchemaVersion ||
          envelope.traceId !== run.frozen.traceId ||
          !outcomeWithinGrant(run, envelope, imported) ||
          digest(envelope.instruction) !== digest(run.manifest.instruction) ||
          new Date(envelope.startedAt) < attempt.startedAt ||
          new Date(envelope.endedAt) > clock()
        )
          throw new AgentRunConflict("Outcome pins differ");
        const now = clock();
        const expected = run.updatedAt;
        const resultId = generatePlatformId("agentresult");
        const result = AgentResultSchema.parse({
          id: resultId,
          workspaceId: run.workspaceId,
          runId: run.id,
          attemptId: attempt.id,
          createdAt: now,
          updatedAt: now,
          envelope,
          dispositions: envelope.outcome.content.proposals.map((p) => ({
            proposalId: p.id,
            status: "pending",
          })),
        });
        const kind = envelope.outcome.kind;
        const status =
          kind === "success"
            ? "succeeded"
            : kind === "needs_input"
              ? "paused"
              : kind === "yield"
                ? "yielded"
                : kind === "cancelled"
                  ? "cancelled"
                  : "failed";
        await finishAttempt(db, attempt, status, session);
        const receipt = {
          submissionId: envelope.submissionId,
          payloadDigest: envelope.payloadDigest,
          resultId,
          acceptedAt: now,
        };
        await db
          .collection("agent_attempts")
          .updateOne({ id: attempt.id }, { $set: { receipt } }, { session });
        await db.collection("agent_results").insertOne(result, { session });
        for (const observation of envelope.usage)
          await usage(db, run, attempt, observation, session);
        run.lastResultId = resultId;
        delete run.activeAttemptId;
        if (kind === "success") close(run, "completed", "success");
        else if (kind === "cancelled") close(run, "cancelled", "cancelled");
        else if (envelope.outcome.kind === "needs_input") {
          run.inputCycles++;
          run.checkpoint = envelope.outcome.checkpoint;
          run.inputRequest = envelope.outcome.inputRequest;
          delete run.inputResponse;
          delete run.inputResponseDigest;
          if (run.attemptCount >= run.limits.attempts)
            close(run, "failed", "attempt_limit");
          else if (run.inputCycles > run.limits.inputCycles)
            close(run, "failed", "input_limit");
          else run.status = "awaiting_input";
        } else if (envelope.outcome.kind === "yield") {
          run.continuations++;
          run.checkpoint = envelope.outcome.checkpoint;
          delete run.inputRequest;
          delete run.inputResponse;
          delete run.inputResponseDigest;
          if (run.attemptCount >= run.limits.attempts)
            close(run, "failed", "attempt_limit");
          else if (run.continuations > run.limits.continuations)
            close(run, "failed", "continuation_limit");
          else
            queue(
              run,
              new Date(
                Math.max(
                  now.getTime(),
                  envelope.outcome.notBefore
                    ? Date.parse(envelope.outcome.notBefore)
                    : 0,
                ),
              ),
              "continuation",
            );
        } else {
          run.failures++;
          if (
            (envelope.outcome.kind === "failure" &&
              !envelope.outcome.error.retryable) ||
            run.failures > run.limits.failures ||
            run.attemptCount >= run.limits.attempts
          )
            close(run, "failed", "retry_exhausted");
          else
            queue(
              run,
              new Date(
                now.getTime() +
                  Math.max(
                    Math.min(60_000, 1000 * 2 ** run.failures),
                    envelope.outcome.kind === "failure"
                      ? (envelope.outcome.error.retryAfterMs ?? 0)
                      : 0,
                  ),
              ),
            );
        }
        run.updatedAt = tick(expected, now);
        await save(db, run, expected, session);
        await audit(
          db,
          run,
          `outcome_${kind}`,
          { type: "system", id: principal.workerId },
          session,
        );
        if (run.effectiveness && hooks)
          await hooks.accepted(db, run, result, session);
        return receipt;
      });
    },
    respond(
      identity: AuthenticatedUser,
      runId: string,
      expectedUpdatedAt: string,
      input: unknown,
    ) {
      return transact(async (db, session) => {
        const run = await load(db, runId, session);
        const expected = run.updatedAt;
        const resolved = await human(db, run, identity, "respond", session);
        if (!(await executable(db, run, session)))
          throw new AuthorizationDenied();
        const body = z
          .object({
            requestId: z.string().min(1).max(100),
            values: z
              .array(
                z
                  .object({
                    key: z.string().min(1).max(64),
                    value: z.union([
                      z.string().max(4000),
                      z.boolean(),
                      z.number().finite(),
                    ]),
                  })
                  .strict(),
              )
              .max(12),
          })
          .strict()
          .parse(input);
        const responseDigest = digest(body);
        const priorAnswer = run.inputResponses.find(
          (r) => r.requestId === body.requestId,
        );
        if (priorAnswer) {
          if (
            digest({
              requestId: priorAnswer.requestId,
              values: priorAnswer.values,
            }) !== responseDigest
          )
            throw new AgentRunConflict("Input response identity reused");
          return { id: run.id, status: run.status };
        }
        if (run.inputResponseDigest === responseDigest)
          return { id: run.id, status: run.status };
        if (!run.inputRequest)
          throw new AgentRunConflict("Input is no longer active");
        const response = InputResponseSchema.parse({
          ...body,
          schemaKey: run.inputRequest.schemaKey,
          schemaVersion: run.inputRequest.schemaVersion,
          answeredAt: clock().toISOString(),
          actorReference: resolved.response.human.id,
        });
        if (run.inputResponseDigest === responseDigest)
          return { id: run.id, status: run.status };
        if (
          run.status !== "awaiting_input" ||
          !run.inputRequest ||
          expected.toISOString() !== expectedUpdatedAt
        )
          throw new AgentRunConflict("Input is no longer active");
        if (run.attemptCount >= run.limits.attempts) {
          close(run, "failed", "attempt_limit");
          run.updatedAt = tick(expected, clock());
          await save(db, run, expected, session);
          return { id: run.id, status: run.status };
        }
        validateInputResponse(run.inputRequest, response);
        if (run.inputRequest.schemaKey === WEBSITE_REVIEW_INPUT)
          parseWebsiteReviewResponse(
            run.inputRequest,
            response,
            websiteReviewPin(run, run.checkpoint?.payload),
          );
        if (run.inputRequest.schemaKey === "psu_uncertainty_answer_v1")
          throw new AgentRunConflict(
            "Historical uncertainty continuation is unsupported",
          );
        if (
          run.inputRequest.schemaKey === PSU_REVIEWED_INPUT ||
          run.inputRequest.schemaKey === GENERAL_CLARIFICATION_INPUT
        ) {
          const isGeneral =
            run.inputRequest.schemaKey === GENERAL_CLARIFICATION_INPUT;
          const pin = (
            isGeneral
              ? GeneralClarificationCheckpoint
              : PsuUncertaintyCheckpointV2
          ).parse(run.checkpoint?.payload);
          const prepared = run.frozen.input as Record<string, unknown>;
          if (
            run.frozen.protocolVersion !== "2.0" ||
            run.operation !== "understand" ||
            run.manifest.manifestDigest !==
              (isGeneral
                ? PRODUCT_CLARIFICATION_MANIFEST
                : PRODUCT_REVIEWED_UNCERTAINTY_MANIFEST
              ).manifestDigest ||
            pin.inputDigest !== digest(run.frozen.input) ||
            digest(pin.origin) !== digest(prepared.uncertaintyOrigin) ||
            pin.origin.targetDigest !== digest(run.target) ||
            pin.origin.workspaceId !== run.workspaceId ||
            pin.base.sourceDigests.length !==
              run.frozen.context.snapshots.length ||
            pin.base.sourceDigests.some(
              (source) =>
                !run.frozen.context.snapshots.some(
                  (snapshot) =>
                    digest(snapshot.reference) === digest(source.reference) &&
                    snapshot.payloadDigest === source.digest,
                ),
            )
          )
            throw new AgentRunConflict(
              "Uncertainty checkpoint differs from prepared work",
            );
          const prior = run.frozen.context.snapshots.find(
            (snapshot) =>
              snapshot.reference.resourceType === "agent_result_projection" &&
              snapshot.reference.id === pin.origin.candidate.resultId &&
              snapshot.reference.contentHash ===
                pin.origin.candidate.envelopeDigest,
          )?.payload as Record<string, unknown> | undefined;
          if (!prior)
            throw new AgentRunConflict("Missing uncertainty Candidate");
          for (const field of [
            "domainOutput",
            "evidence",
            "assumptions",
            "unknowns",
            "artifacts",
            "warnings",
          ] as const)
            if (digest(pin.base.content[field]) !== digest(prior[field]))
              throw new AgentRunConflict("Uncertainty Candidate changed");
          const withoutLineage = (value: unknown) =>
            z
              .array(z.record(z.unknown()))
              .parse(value)
              .map(({ lineageIds, ...rest }) => {
                void lineageIds;
                return rest;
              });
          for (const field of ["findings", "proposals"] as const)
            if (
              digest(withoutLineage(pin.base.content[field])) !==
              digest(withoutLineage(prior[field]))
            )
              throw new AgentRunConflict("Uncertainty support changed");
          (isGeneral ? parseGeneralAnswer : parseReviewedAnswer)(
            run.inputRequest,
            response,
            pin,
          );
        }
        if (run.inputRequest.schemaKey === PSU_FACT_INPUT) {
          if (
            run.frozen.protocolVersion === "1.1" ||
            run.operation !== "revise_understanding" ||
            ![
              PRODUCT_GENERAL_MANIFEST.manifestDigest,
              PRODUCT_REVIEWED_UNCERTAINTY_MANIFEST.manifestDigest,
              PRODUCT_CLARIFICATION_MANIFEST.manifestDigest,
              PRODUCT_WEBSITE_MANIFEST.manifestDigest,
            ].includes(run.manifest.manifestDigest) ||
            (run.frozen.input as Record<string, unknown>)
              .factAdmissionPolicy !== PSU_FACT_POLICY
          )
            throw new AgentRunConflict("Unpinned fact policy");
          const pin = FactSubmissionCheckpointSchema.parse(
            run.checkpoint?.payload,
          );
          const prepared = run.frozen.input as Record<string, unknown>;
          const defects = z
            .array(z.object({ findingId: z.string() }))
            .parse(prepared.defects);
          const candidate = run.frozen.context.snapshots.filter(
            (s) => s.reference.resourceType === "agent_result_projection",
          );
          if (
            pin.inputDigest !== digest(run.frozen.input) ||
            candidate.length !== 1 ||
            pin.slots.some(
              (slot) => !defects.some((d) => d.findingId === slot.defectId),
            ) ||
            pin.base.sourceDigests.length !==
              run.frozen.context.snapshots.length ||
            pin.base.sourceDigests.some(
              (source) =>
                !run.frozen.context.snapshots.some(
                  (s) =>
                    digest(s.reference) === digest(source.reference) &&
                    s.payloadDigest === source.digest,
                ),
            )
          )
            throw new AgentRunConflict(
              "Fact checkpoint differs from prepared context",
            );
          const original = candidate[0]!.payload as Record<string, unknown>;
          // This stage may only rebind lineage to exact projected resources;
          // it cannot replace the prepared Candidate or its observations.
          for (const field of [
            "domainOutput",
            "evidence",
            "assumptions",
            "unknowns",
            "knowledgeGaps",
            "artifacts",
            "warnings",
          ] as const)
            if (
              digest(pin.base.content[field] ?? null) !==
              digest(original[field] ?? null)
            )
              throw new AgentRunConflict(
                "Fact checkpoint changed prepared Candidate",
              );
          const withoutLineage = (items: unknown) =>
            z
              .array(z.record(z.unknown()))
              .parse(items)
              .map(({ lineageIds, ...item }) => {
                void lineageIds;
                return item;
              });
          for (const field of ["findings", "proposals"] as const)
            if (
              digest(withoutLineage(pin.base.content[field])) !==
              digest(withoutLineage(original[field]))
            )
              throw new AgentRunConflict(
                "Fact checkpoint changed prepared support",
              );
          parseFactSubmission(run.inputRequest, response, pin);
        }
        if (new Date(run.inputRequest.expiresAt) <= clock())
          throw new AgentRunConflict("Input expired");
        let answerProvenance:
          | import("@workspace/agent-runtime-protocol").AnswerProvenance
          | undefined;
        if (run.frozen.protocolVersion !== "1.1") {
          // The respondent may differ from the original delegator. Serialize
          // the actual accepting authority chain against concurrent revocation.
          if (
            digest(run.requester) !== digest(resolved.response.human) ||
            digest(run.authority) !== digest(resolved.permitted)
          )
            await serializeAgentAuthority(
              db,
              {
                workspaceId: run.workspaceId,
                target: run.target,
                requester: resolved.response.human,
                authority: resolved.permitted,
              },
              session,
              [],
              false,
            );
          const fields = {
            kind: "platform_answer_provenance" as const,
            schemaVersion: 1 as const,
            workspaceId: run.workspaceId,
            runId: run.id,
            operation: run.operation,
            action: "respond" as const,
            requestId: run.inputRequest.id,
            requestDigest: digest(run.inputRequest),
            checkpoint: run.inputRequest.checkpoint,
            submissionGeneration: run.generation,
            resumeGeneration: run.generation + 1,
            responseDigest: digest(response),
            actor: resolved.response.human,
            capacity: resolved.permitted.basis,
            submittedAt: response.answeredAt,
          };
          const identified = {
            ...fields,
            submissionId: answerSubmissionId(fields),
          };
          answerProvenance = AnswerProvenanceSchema.parse({
            ...identified,
            digest: digestWithout(identified, "digest"),
          });
        }
        run.inputResponse = response;
        run.inputResponses.push(response);
        run.inputResponseDigest = responseDigest;
        queue(run, clock(), "resume");
        run.updatedAt = tick(expected, clock());
        await save(db, run, expected, session);
        await audit(
          db,
          run,
          "input_answered",
          resolved.response.human,
          session,
          answerProvenance,
        );
        return { id: run.id, status: run.status };
      });
    },
    cancel(
      identity: AuthenticatedUser,
      runId: string,
      expectedUpdatedAt: string,
    ) {
      return transact(async (db, session) => {
        const run = await load(db, runId, session);
        const expected = run.updatedAt;
        const resolved = await human(db, run, identity, "cancel", session);
        if (terminal(run)) return { id: run.id, status: run.status };
        if (expected.toISOString() !== expectedUpdatedAt)
          throw new AgentRunConflict("Run changed");
        run.cancelRequestedAt = clock();
        if (run.status !== "running") close(run, "cancelled", "cancelled");
        run.updatedAt = tick(expected, clock());
        await save(db, run, expected, session);
        await audit(
          db,
          run,
          "cancel_requested",
          resolved.response.human,
          session,
        );
        return { id: run.id, status: run.status };
      });
    },
  };
}
