import { generalClarificationView } from "./product-service-understanding/clarification-view";
import {
  verifyProductSupport,
  verifyProductCanonicalSnapshots,
} from "./product-service-understanding/support";
import { WorkspaceAgentTarget } from "../domain/agent-operator";
import { frozenTarget } from "../domain/agent-control-plane";
import { z } from "zod";
import type { Db, ClientSession } from "mongodb";
import {
  ProductCanonicalContextSchema,
  digest,
  canonicalJson,
  CriteriaSetSchema,
  assembleCriteriaSet,
  EvaluationInputSchema,
  validateEvaluation,
  importedEvidenceMatches,
  ImportedSupportSchema,
  selectedCandidate,
  type BudgetLimits,
  type CandidateRef,
  type CriteriaSet,
} from "@workspace/agent-runtime-protocol";
import {
  EffectivenessCaseSchema,
  EffectivenessDefinitionSchema,
  EffectivenessPolicySchema,
  decideEffectiveness,
  defectDigest,
  type EffectivenessCase,
  type EffectivenessDefinition,
  type EffectivenessPolicy,
} from "../domain/agent-effectiveness";
import {
  AgentRunSchema,
  AgentResultSchema,
  parseFrozenWork,
  type AgentRun,
  type FrozenAgentWork,
} from "../domain/agent-control-plane";
import { decimalUnits } from "../domain/agent-budget";
import {
  generatePlatformId,
  EventSchema,
  platformIdSchema,
} from "../domain/schemas";
import { AuthorizationDenied } from "../authorization/policy";
import type { AppConfig } from "../config";
import type { AuthenticatedUser } from "../middlewares/auth";
import type { MongoService } from "./mongo";
import { resolveHvmContext, withoutMongoId } from "./hvm-context";
import { serializeAgentAuthority } from "./agent-authority-serialization";
import {
  currentAgentSource,
  AgentProposalStale,
} from "./agent-proposal-freshness";
import {
  AgentControlPlaneUnavailable,
  readOperatingTarget,
} from "./agent-operators";
import {
  createAgentControlPlane,
  AgentRunConflict,
  type AgentLifecycleHooks,
} from "./agent-control-plane";
import type { createAgentExecutionReadiness } from "./agent-execution-readiness";
import type { createAgentWorkloadAuthority } from "../authorization/agent-workload";

/** Reviewed server composition, never an API prompt/code/grant supplied by users. */
export interface EffectivenessProfile {
  criteriaFloor: CriteriaSet["criteria"];
  manifestDigest: string;
  definition: EffectivenessDefinition;
  policy: EffectivenessPolicy;
  allowedNotApplicable(
    input: ReturnType<typeof EvaluationInputSchema.parse>,
  ): readonly string[];
  prepareCase(context: {
    db: Db;
    session: ClientSession;
    identity: AuthenticatedUser;
    workspaceId: string;
    input: unknown;
    predecessor?: EffectivenessCase;
    predecessorFresh?: boolean;
    requestAudit?: {
      actor: AgentRun["requester"];
      capacity: AgentRun["authority"]["basis"];
      requestKey: string;
      confirmedAt: string;
    };
  }): Promise<{
    criteria: CriteriaSet;
    totalBudget: BudgetLimits;
    preparedInput?: unknown;
  }>;
  prepareRun(context: {
    db: Db;
    session: ClientSession;
    identity: AuthenticatedUser;
    case: EffectivenessCase;
    runId: string;
    role: "maker" | "evaluator" | "revision";
    input: unknown;
  }): Promise<{ frozen: FrozenAgentWork; limits: AgentRun["limits"] }>;
  selector: CandidateRef["selector"];
  /** Reviewed operation input parser; exact Result authority is still checked here. */
  historicalSupport?(
    input: unknown,
  ): ReturnType<typeof ImportedSupportSchema.parse>;
}
const legacyRequest = z
  .object({
    clientAgentId: platformIdSchema("clientagent"),
    revision: z.number().int().positive(),
    operation: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    requestKey: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/),
    input: z.unknown(),
    predecessorCaseId: platformIdSchema("effectivenesscase").optional(),
  })
  .strict();
const request = z.union([
  legacyRequest,
  legacyRequest
    .omit({ clientAgentId: true, revision: true })
    .extend({ target: WorkspaceAgentTarget })
    .strict(),
]);
export function createAgentEffectiveness(
  config: AppConfig,
  mongo: MongoService,
  workloads: ReturnType<typeof createAgentWorkloadAuthority>,
  readiness: ReturnType<typeof createAgentExecutionReadiness>,
  profiles: readonly EffectivenessProfile[] = [],
  clock: () => Date = () => new Date(),
) {
  const registry = new Map<string, EffectivenessProfile>();
  for (const p of profiles) {
    EffectivenessDefinitionSchema.parse(p.definition);
    EffectivenessPolicySchema.parse(p.policy);
    if (digest(p.definition.policy) !== digest(p.policy.identity))
      throw new Error("Profile policy mismatch");
    const k = p.manifestDigest + ":" + p.definition.maker;
    if (registry.has(k)) throw new Error("Duplicate effectiveness profile");
    registry.set(k, p);
  }
  const original = (c: EffectivenessCase): AuthenticatedUser => ({
    issuer: c.requester.issuer,
    subject: c.requester.id,
    clientId: c.requesterClientId,
  });
  async function requireV11(db: Db, session: ClientSession) {
    const ledger = await db
      .collection("schema_versions")
      .findOne({ _id: "vapp-v1" } as never, { session });
    if (
      ![11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25].includes(
        ledger?.version ?? 0,
      )
    )
      throw new AgentControlPlaneUnavailable(
        "Effectiveness requires schema v11",
      );
  }
  async function load(db: Db, id: string, session: ClientSession) {
    const row = await db
      .collection("agent_effectiveness_cases")
      .findOne({ id }, { session });
    if (!row) throw new AuthorizationDenied();
    return EffectivenessCaseSchema.parse(withoutMongoId(row));
  }
  async function save(
    db: Db,
    c: EffectivenessCase,
    previous: number,
    session: ClientSession,
  ) {
    c.stateRevision = previous + 1;
    c.updatedAt = new Date(
      Math.max(clock().getTime(), c.updatedAt.getTime() + 1),
    );
    const parsed = EffectivenessCaseSchema.parse(c);
    const updated = await db.collection("agent_effectiveness_cases").updateOne(
      { id: c.id, workspaceId: c.workspaceId, stateRevision: previous },
      {
        $set: parsed,
        ...(!c.activeRunId ? { $unset: { activeRunId: "" } } : {}),
      },
      { session },
    );
    if (!updated.matchedCount) throw new AgentRunConflict("Case changed");
  }
  async function audit(
    db: Db,
    c: EffectivenessCase,
    action: string,
    actor: unknown,
    session: ClientSession,
  ) {
    const now = clock();
    await db.collection("events").insertOne(
      EventSchema.parse({
        id: generatePlatformId("event"),
        workspaceId: c.workspaceId,
        createdAt: now,
        updatedAt: now,
        occurredAt: now,
        eventType: "agent_effectiveness_changed",
        payload: {
          caseId: c.id,
          action,
          actor,
          stateRevision: c.stateRevision,
        },
      }),
      { session },
    );
  }
  async function authorize(
    db: Db,
    c: EffectivenessCase,
    identity: AuthenticatedUser,
    operation: string,
    action: "read" | "request" | "cancel",
    session: ClientSession,
  ) {
    const resolved = await resolveHvmContext(db, config, identity, session);
    const authority = resolved.authority.authorizeAgentOperation(
      resolved.context,
      {
        workspaceId: c.workspaceId,
        target: c.target,
        operation,
        action,
        requester: c.requester,
        ...(c.authority.basis === "client"
          ? {
              membershipId: c.authority.membershipId,
              grantId: c.authority.grantId,
            }
          : {}),
      },
      clock(),
    );
    if (!authority) throw new AuthorizationDenied();
    if (action !== "read")
      await serializeAgentAuthority(
        db,
        {
          workspaceId: c.workspaceId,
          target: c.target,
          requester: resolved.response.human,
          authority,
        },
        session,
      );
    await readOperatingTarget(db, c.workspaceId, c.target, session);
    return resolved;
  }
  async function profile(db: Db, c: EffectivenessCase, session: ClientSession) {
    const state = await readiness.inspect(db, c.workspaceId, c.target, session);
    if (state.reasons.length || !state.manifest)
      throw new AgentControlPlaneUnavailable(
        "Effectiveness implementation unavailable",
      );
    const p = registry.get(
      state.manifest.manifestDigest + ":" + c.definition.maker,
    );
    if (
      !p ||
      !state.definition?.data.effectiveness?.some(
        (d: unknown) => digest(d) === digest(c.definition),
      ) ||
      digest(p.definition) !== digest(c.definition) ||
      digest(p.policy) !== digest(c.policy)
    )
      throw new AgentControlPlaneUnavailable(
        "Effectiveness profile unavailable",
      );
    return { p, manifest: state.manifest };
  }
  function allocate(
    c: EffectivenessCase,
    runId: string,
    b: BudgetLimits,
    role: "maker" | "evaluator" | "revision",
  ) {
    const all = [...c.allocations.map((a) => a.budget), b];
    const total = c.totalBudget;
    if (
      b.cost.currency !== total.cost.currency ||
      new Date(b.deadline) > new Date(total.deadline) ||
      new Date(b.deadline) <= clock() ||
      all.reduce((s, x) => s + decimalUnits(x.cost.amount), 0n) >
        decimalUnits(total.cost.amount) ||
      all.reduce((s, x) => s + x.modelCalls, 0) > total.modelCalls ||
      all.reduce((s, x) => s + x.toolCalls, 0) > total.toolCalls ||
      all.some((x) =>
        x.providerCalls.some(
          (p) => !total.providerCalls.some((t) => t.provider === p.provider),
        ),
      ) ||
      total.providerCalls.some(
        (p) =>
          all.reduce(
            (s, x) =>
              s +
              (x.providerCalls.find((t) => t.provider === p.provider)?.calls ??
                0),
            0,
          ) > p.calls,
      )
    )
      throw new AgentRunConflict("Case budget exhausted");
    c.allocations.push({ runId, budget: b, role });
  }
  async function sources(db: Db, run: AgentRun, session: ClientSession) {
    const context = await resolveHvmContext(
      db,
      config,
      {
        issuer: run.requester.issuer,
        subject: run.requester.id,
        clientId: run.requesterClientId,
      },
      session,
    );
    await verifyProductCanonicalSnapshots(db, run, session, (ref) => {
      if (ref.workspaceId !== run.workspaceId) throw new AuthorizationDenied();
      context.authority.scopeFilter(context.context, "read", {
        type: ref.resourceType,
        workspaceId: run.workspaceId,
      });
    });
    const result = [];
    for (const snapshot of run.frozen.context.snapshots) {
      if (snapshot.reference.resourceType !== "agent_result_projection")
        continue;
      const row = await db
        .collection("agent_results")
        .findOne(
          { id: snapshot.reference.id, workspaceId: run.workspaceId },
          { session },
        );
      if (!row) throw new AuthorizationDenied();
      const r = AgentResultSchema.parse(withoutMongoId(row));
      if (r.envelope.payloadDigest !== snapshot.reference.contentHash)
        throw new AuthorizationDenied();
      const sourceRunRaw = await db
        .collection("agent_runs")
        .findOne({ id: r.runId, workspaceId: run.workspaceId }, { session });
      if (!sourceRunRaw) throw new AuthorizationDenied();
      const sourceRun = AgentRunSchema.parse(withoutMongoId(sourceRunRaw));
      const context = await resolveHvmContext(
        db,
        config,
        {
          issuer: run.requester.issuer,
          subject: run.requester.id,
          clientId: run.requesterClientId,
        },
        session,
      );
      if (
        !context.authority.authorizeAgentOperation(
          context.context,
          {
            workspaceId: sourceRun.workspaceId,
            target: sourceRun.target,
            operation: sourceRun.operation,
            action: "read",
            requester: sourceRun.requester,
            ...(sourceRun.authority.basis === "client"
              ? {
                  membershipId: sourceRun.authority.membershipId,
                  grantId: sourceRun.authority.grantId,
                }
              : {}),
          },
          clock(),
        )
      )
        throw new AuthorizationDenied();
      await serializeAgentAuthority(
        db,
        sourceRun,
        session,
        await readiness.policy.dependencies(db, sourceRun, session),
      );
      // Fixed projection names and exact immutable source bytes; no generic collection lookup.
      const available: Record<string, unknown> = {
        domainOutput: r.envelope.outcome.content.domainOutput,
        findings: r.envelope.outcome.content.findings,
        evidence: r.envelope.outcome.content.evidence,
        knowledgeGaps: r.envelope.outcome.content.knowledgeGaps,
        proposals: r.envelope.outcome.content.proposals,
        lineage: r.envelope.outcome.content.lineage,
        assumptions: r.envelope.outcome.content.assumptions,
        unknowns: r.envelope.outcome.content.unknowns,
        artifacts: r.envelope.outcome.content.artifacts,
        warnings: r.envelope.outcome.content.warnings,
      };
      const expected = Object.fromEntries(
        snapshot.fields.map((f) => {
          if (!(f in available) || available[f] === undefined)
            throw new AuthorizationDenied();
          return [f, available[f]];
        }),
      );
      if (digest(expected) !== snapshot.payloadDigest)
        throw new AuthorizationDenied();
      result.push({
        resultId: r.id,
        envelopeDigest: r.envelope.payloadDigest,
        content: {
          ...r.envelope.outcome.content,
          evidence: snapshot.fields.includes("evidence")
            ? r.envelope.outcome.content.evidence
            : [],
        },
      });
    }
    return result;
  }
  async function fresh(db: Db, c: EffectivenessCase, session: ClientSession) {
    try {
      await authorize(db, c, original(c), c.definition.maker, "read", session);
      for (const l of c.criteria.lineage)
        if (l.source.kind === "resource")
          await currentAgentSource(
            db,
            c.workspaceId,
            l.source.reference,
            session,
          );
      await profile(db, c, session);
      for (const candidate of c.candidates) {
        const row = await db
          .collection("agent_results")
          .findOne(
            { id: candidate.reference.resultId, workspaceId: c.workspaceId },
            { session },
          );
        if (!row) return false;
        const r = AgentResultSchema.parse(withoutMongoId(row));
        const sourceRun = await db
          .collection("agent_runs")
          .findOne({ id: r.runId, workspaceId: c.workspaceId }, { session });
        if (!sourceRun) return false;
        await sources(
          db,
          AgentRunSchema.parse(withoutMongoId(sourceRun)),
          session,
        );
        if (
          r.envelope.payloadDigest !== candidate.reference.envelopeDigest ||
          digest(
            selectedCandidate(
              r.envelope.outcome.content,
              candidate.reference.selector,
            ),
          ) !== candidate.reference.contentDigest
        )
          return false;
        for (const l of r.envelope.outcome.content.lineage)
          if (
            l.role === "consumed" &&
            l.source.kind === "resource" &&
            l.source.reference.resourceType !== "agent_result_projection"
          )
            await currentAgentSource(
              db,
              c.workspaceId,
              l.source.reference,
              session,
            );
      }
      for (const evaluation of c.evaluations) {
        if (!evaluation.resultId) continue;
        const raw = await db
          .collection("agent_results")
          .findOne(
            { id: evaluation.resultId, workspaceId: c.workspaceId },
            { session },
          );
        const runRaw = await db
          .collection("agent_runs")
          .findOne(
            { id: evaluation.runId, workspaceId: c.workspaceId },
            { session },
          );
        if (!raw || !runRaw) return false;
        const result = AgentResultSchema.parse(withoutMongoId(raw));
        await sources(
          db,
          AgentRunSchema.parse(withoutMongoId(runRaw)),
          session,
        );
        for (const l of result.envelope.outcome.content.lineage)
          if (
            l.role === "consumed" &&
            l.source.kind === "resource" &&
            l.source.reference.resourceType !== "agent_result_projection"
          )
            await currentAgentSource(
              db,
              c.workspaceId,
              l.source.reference,
              session,
            );
      }
      return true;
    } catch (error) {
      if (
        error instanceof AgentProposalStale ||
        error instanceof AuthorizationDenied ||
        error instanceof AgentControlPlaneUnavailable
      )
        return false;
      throw error;
    }
  }
  function transactionService(db: Db, session: ClientSession) {
    return createAgentControlPlane(
      config,
      { ...mongo, withTransaction: async (work) => work(db, session) },
      workloads,
      readiness.policy,
      clock,
      hooks,
    );
  }
  async function start(
    db: Db,
    c: EffectivenessCase,
    role: "maker" | "evaluator" | "revision",
    input: unknown,
    session: ClientSession,
    existingRunId?: string,
    explicitRequest?: NonNullable<
      EffectivenessCase["allocations"][number]["request"]
    >,
  ) {
    const { p, manifest } = await profile(db, c, session);
    const operation = c.definition[role];
    await authorize(db, c, original(c), operation, "request", session);
    if (c.status === "closed" || new Date(c.totalBudget.deadline) <= clock())
      throw new AuthorizationDenied();
    if (
      role === "revision" &&
      c.allocations.filter((a) => a.role === "revision").length >=
        c.policy.maxRevisions
    )
      throw new AgentRunConflict("Revision exhausted");
    if (role === "evaluator" && c.evaluations.length >= 8)
      throw new AgentRunConflict("Evaluation limit");
    const runId = existingRunId ?? generatePlatformId("agentrun");
    const prepared = await p.prepareRun({
      db,
      session,
      identity: original(c),
      case: structuredClone(c),
      runId,
      role,
      input,
    });
    const frozen = parseFrozenWork(prepared.frozen);
    if (
      frozen.runId !== runId ||
      frozen.operation !== operation ||
      frozen.workspaceId !== c.workspaceId ||
      frozen.clientId !== c.organisationId ||
      digest(frozenTarget(frozen)) !== digest(c.target) ||
      new Date(frozen.grant.expiresAt) > new Date(c.totalBudget.deadline)
    )
      throw new AuthorizationDenied();
    if (role === "evaluator") {
      const ei = EvaluationInputSchema.parse(frozen.input);
      const candidate = c.candidates.at(-1)?.reference;
      if (
        !candidate ||
        digest(ei.candidate) !== digest(candidate) ||
        digest(ei.criteria) !== digest(c.criteria) ||
        digest(ei.policy) !== digest(c.policy.identity) ||
        frozen.grant.proposalTargets.length ||
        frozen.grant.tools.some((t) => t.class === "external_mutation")
      )
        throw new AuthorizationDenied();
      c.evaluations.push({
        requestKey: ei.requestKey,
        runId,
        candidateRevision: candidate.revision,
      });
    }
    allocate(c, runId, frozen.grant.budgets, role);
    if (explicitRequest) c.allocations.at(-1)!.request = explicitRequest;
    const old = c.stateRevision;
    c.activeRunId = runId;
    c.status =
      role === "evaluator"
        ? "evaluating"
        : role === "revision"
          ? "revising"
          : "pending";
    c.reason = "execution_pending";
    await save(db, c, old, session);
    const transitionKey = digest({
      caseId: c.id,
      ordinal: c.allocations.length,
      role,
      candidate: c.candidates.at(-1)?.reference ?? null,
      criteria: c.criteria.digest,
      policy: c.policy.identity.digest,
      implementation: manifest.manifestDigest,
      stateRevision: old,
      request: explicitRequest ?? null,
    });
    await transactionService(db, session).acceptPrepared(original(c), {
      ...prepared,
      frozen,
      manifest,
      requestKey: transitionKey,
      effectiveness: {
        caseId: c.id,
        role,
        ordinal: c.allocations.length,
        transitionKey,
      },
    });
    await audit(db, c, `requested_${role}`, c.requester, session);
  }
  async function scheduleNext(
    db: Db,
    c: EffectivenessCase,
    role: "evaluator" | "revision",
    input: unknown,
    session: ClientSession,
  ) {
    const before = structuredClone(c);
    try {
      await start(db, c, role, input, session);
    } catch (error) {
      if (!(
        error instanceof AuthorizationDenied ||
        error instanceof AgentControlPlaneUnavailable ||
        error instanceof AgentRunConflict
      ))
        throw error;
      const current = await load(db, c.id, session);
      if (
        current.activeRunId &&
        current.activeRunId !== before.activeRunId &&
        (await db
          .collection("agent_runs")
          .findOne({ id: current.activeRunId }, { session }))
      )
        throw error;
      before.status = "held";
      before.reason = "next_execution_unavailable";
      delete before.activeRunId;
      await save(db, before, current.stateRevision, session);
      await audit(
        db,
        before,
        "held",
        { type: "system", id: "effectiveness" },
        session,
      );
    }
  }
  const hooks: AgentLifecycleHooks = {
    required(run) {
      return [...registry.values()].some(
        (p) =>
          p.manifestDigest === run.manifest.manifestDigest &&
          [
            p.definition.maker,
            p.definition.evaluator,
            p.definition.revision,
          ].includes(run.operation),
      );
    },
    async terminal(db, run, session) {
      const c = await load(db, run.effectiveness!.caseId, session);
      if (c.activeRunId !== run.id) return;
      const old = c.stateRevision;
      delete c.activeRunId;
      c.status = "held";
      c.reason =
        run.status === "cancelled" ? "execution_cancelled" : "execution_failed";
      await save(db, c, old, session);
      await audit(db, c, c.reason, { type: "system", id: run.id }, session);
    },
    async current(db, run, session) {
      await requireV11(db, session);
      const c = await load(db, run.effectiveness!.caseId, session);
      if (
        !c.allocations[run.effectiveness!.ordinal - 1] ||
        c.allocations[run.effectiveness!.ordinal - 1]!.runId !== run.id ||
        c.allocations[run.effectiveness!.ordinal - 1]!.role !==
          run.effectiveness!.role ||
        digest(c.allocations[run.effectiveness!.ordinal - 1]!.budget) !==
          digest(run.frozen.grant.budgets) ||
        c.activeRunId !== run.id ||
        c.status === "closed" ||
        c.target.id !== run.target.id ||
        c.target.revision !== run.target.revision ||
        c.workspaceId !== run.workspaceId ||
        digest(c.requester) !== digest(run.requester) ||
        digest(c.authority) !== digest(run.authority) ||
        run.operation !== c.definition[run.effectiveness!.role]
      )
        return false;
      await profile(db, c, session);
      await authorize(db, c, original(c), run.operation, "request", session);
      await sources(db, run, session);
      // Reviewed uncertainty is a new maker, but its independently sourced
      // applicability evidence must remain current at every lifecycle gate.
      if ((run.frozen.input as Record<string, unknown>).uncertaintyOrigin) {
        for (const source of run.frozen.context.references)
          await currentAgentSource(
            db,
            run.workspaceId,
            source.reference,
            session,
          );
      }
      const old = c.stateRevision;
      await save(db, c, old, session);
      return true;
    },
    async importedEvidence(db, run, envelope, session) {
      await verifyProductSupport(db, run, envelope, session);
      const c = await load(db, run.effectiveness!.caseId, session);
      const { p } = await profile(db, c, session);
      const imports = new Set<string>();
      // Verified canonical witnesses are exact imported observations, not model provenance.
      await sources(db, run, session);
      for (const snapshot of run.frozen.context.snapshots) {
        if (!snapshot.fields.includes("canonicalSupport")) continue;
        const projection = ProductCanonicalContextSchema.parse(
          (snapshot.payload as Record<string, unknown>).canonicalSupport,
        );
        for (const item of projection.composed)
          for (const e of item.evidence) {
            const observed = envelope.outcome.content.evidence.find(
              (x) => x.id === e.id,
            );
            if (observed && digest(observed) !== digest(e))
              throw new AuthorizationDenied();
            if (observed) imports.add(e.id);
          }
      }
      if (run.effectiveness!.role === "evaluator") {
        const input = EvaluationInputSchema.parse(run.frozen.input);
        const src = await sources(db, run, session);
        for (const observation of envelope.outcome.content.evidence)
          if (
            input.importedSupport.some(
              (x) => x.localEvidenceId === observation.id,
            )
          ) {
            if (!importedEvidenceMatches(observation, input, src))
              throw new AuthorizationDenied();
            imports.add(observation.id);
          }
        if (envelope.outcome.content.domainOutput !== undefined)
          validateEvaluation(envelope.outcome.content, input, {
            allowedNotApplicable: p.allowedNotApplicable(input),
            modelInvocationIds: envelope.usage
              .filter((x) => x.category === "model")
              .map((x) => x.invocationId),
          });
        if (envelope.outcome.content.proposals.length)
          throw new AuthorizationDenied();
      }
      if (run.effectiveness!.role !== "evaluator" && p.historicalSupport) {
        const importedSupport = ImportedSupportSchema.parse(
          p.historicalSupport(run.frozen.input),
        );
        const permitted = new Set(
          c.candidates.map((x) => x.reference.resultId),
        );
        if (run.effectiveness!.role === "maker") {
          permitted.clear();
          if (c.predecessorCase) {
            const prior = await load(db, c.predecessorCase.id, session);
            const candidate = prior.candidates.at(-1)?.reference;
            if (
              prior.workspaceId !== c.workspaceId ||
              candidate?.contentDigest !== c.predecessorCase.candidateDigest ||
              prior.criteria.digest !== c.predecessorCase.criteriaDigest
            )
              throw new AuthorizationDenied();
            permitted.add(candidate.resultId);
          }
        }
        if (importedSupport.some((x) => !permitted.has(x.sourceResultId)))
          throw new AuthorizationDenied();
        const src = await sources(db, run, session);
        for (const observation of envelope.outcome.content.evidence) {
          if (
            !importedSupport.some((x) => x.localEvidenceId === observation.id)
          )
            continue;
          if (!importedEvidenceMatches(observation, { importedSupport }, src))
            throw new AuthorizationDenied();
          imports.add(observation.id);
        }
      }
      return imports;
    },
    async accepted(db, run, result, session) {
      const c = await load(db, run.effectiveness!.caseId, session);
      if (c.activeRunId !== run.id) {
        if (["failed", "cancelled"].includes(run.status)) return;
        throw new AgentRunConflict();
      }
      if (!["completed", "failed", "cancelled"].includes(run.status)) return;
      const old = c.stateRevision;
      delete c.activeRunId;
      if (run.status !== "completed") {
        c.status = "held";
        c.reason = "execution_failed";
        await save(db, c, old, session);
        await audit(db, c, "held", { type: "system", id: run.id }, session);
        return;
      }
      await verifyProductSupport(db, run, result.envelope, session);
      const content = result.envelope.outcome.content;
      if (run.effectiveness!.role !== "evaluator") {
        if (
          content.knowledgeGaps.some((g) => g.severity === "blocking") ||
          result.envelope.outcome.completeness.kind !== "complete"
        ) {
          c.status = "held";
          c.reason = "knowledge_gap";
          await save(db, c, old, session);
          await audit(
            db,
            c,
            "held_knowledge_gap",
            { type: "system", id: run.id },
            session,
          );
          return;
        }
        const { p } = await profile(db, c, session);
        const previous = c.candidates.at(-1);
        const ref: CandidateRef = {
          caseId: c.id,
          revision: c.candidates.length + 1,
          runId: run.id,
          attemptId: result.attemptId,
          resultId: result.id,
          envelopeDigest: result.envelope.payloadDigest,
          contentDigest: digest(selectedCandidate(content, p.selector)),
          selector: p.selector,
        };
        c.candidates.push({
          reference: ref,
          ...(previous
            ? {
                predecessorDigest: previous.reference.contentDigest,
                triggeringEvaluationId: c.evaluations.at(-1)!.resultId,
              }
            : {}),
          addressedDefects: previous
            ? z
                .object({
                  defects: z.array(z.object({ findingId: z.string() })),
                })
                .parse(run.frozen.input)
                .defects.map((d) => d.findingId)
            : [],
        });
        await save(db, c, old, session);
        if (
          previous &&
          c.candidates
            .slice(0, -1)
            .some((x) => x.reference.contentDigest === ref.contentDigest)
        ) {
          const rev = c.stateRevision;
          c.status = "escalated";
          c.reason = "no_progress";
          await save(db, c, rev, session);
          await audit(
            db,
            c,
            "escalated_no_progress",
            { type: "system", id: run.id },
            session,
          );
          return;
        }
        if (!(await fresh(db, c, session))) {
          const rev = c.stateRevision;
          c.status = "held";
          c.reason = "stale";
          await save(db, c, rev, session);
          await audit(
            db,
            c,
            "held_stale",
            { type: "system", id: run.id },
            session,
          );
          return;
        }
        await scheduleNext(db, c, "evaluator", { candidate: ref }, session);
        return;
      }
      const input = EvaluationInputSchema.parse(run.frozen.input);
      const { p } = await profile(db, c, session);
      const evaluation = validateEvaluation(content, input, {
        allowedNotApplicable: p.allowedNotApplicable(input),
        modelInvocationIds: result.envelope.usage
          .filter((x) => x.category === "model")
          .map((x) => x.invocationId),
      });
      const entry = c.evaluations.find((x) => x.runId === run.id);
      if (!entry) throw new AgentRunConflict();
      entry.resultId = result.id;
      const defects = defectDigest(evaluation);
      const oscillation =
        c.evaluations.some(
          (x) => x.runId !== run.id && x.defectDigest === defects,
        ) && evaluation.defects.length > 0;
      entry.defectDigest = defects;
      const decision = decideEffectiveness({
        criteria: c.criteria,
        policy: c.policy,
        evaluation,
        revision: input.candidate.revision,
        blockingGap: content.knowledgeGaps.some(
          (g) => g.severity === "blocking",
        ),
        fresh: await fresh(db, c, session),
        authorized: true,
        canRevise: true,
        oscillation,
      });
      c.decisions.push({ ...decision, evaluationResultId: result.id });
      c.status =
        decision.kind === "pass"
          ? "passed"
          : decision.kind === "escalate"
            ? "escalated"
            : decision.kind === "hold"
              ? "held"
              : "revising";
      c.reason = decision.reason;
      await save(db, c, old, session);
      await audit(
        db,
        c,
        decision.kind,
        { type: "system", id: run.id },
        session,
      );
      if (decision.kind === "revise")
        await scheduleNext(
          db,
          c,
          "revision",
          {
            candidate: input.candidate,
            evaluationResultId: result.id,
            defects: evaluation.defects,
          },
          session,
        );
    },
  };
  async function transact<T>(
    fn: (db: Db, session: ClientSession) => Promise<T>,
  ) {
    if (!mongo.withTransaction) throw new AgentControlPlaneUnavailable();
    return mongo.withTransaction(async (db, session) => {
      await requireV11(db, session);
      return fn(db, session);
    });
  }
  return {
    hooks,
    async create(
      identity: AuthenticatedUser,
      workspaceId: string,
      value: unknown,
    ) {
      const body = request.parse(value);
      return transact(async (db, session) => {
        const target =
          "target" in body
            ? body.target
            : {
                kind: "client_agent" as const,
                id: body.clientAgentId,
                revision: body.revision,
              };
        const state = await readiness.inspect(db, workspaceId, target, session);
        if (state.reasons.length || !state.manifest)
          throw new AgentControlPlaneUnavailable();
        const p = registry.get(
          state.manifest.manifestDigest + ":" + body.operation,
        );
        if (!p) throw new AgentControlPlaneUnavailable();
        const resolved = await resolveHvmContext(db, config, identity, session);
        const authority = resolved.authority.authorizeAgentOperation(
          resolved.context,
          { workspaceId, target, operation: body.operation, action: "request" },
          clock(),
        );
        if (!authority) throw new AuthorizationDenied();
        const existing = await db
          .collection("agent_effectiveness_cases")
          .findOne(
            {
              workspaceId,
              "requester.issuer": identity.issuer,
              "requester.id": identity.subject,
              requestKey: body.requestKey,
            },
            { session },
          );
        if (existing) {
          const c = EffectivenessCaseSchema.parse(withoutMongoId(existing));
          await authorize(db, c, identity, c.definition.maker, "read", session);
          if (c.requestDigest !== digest(body)) throw new AgentRunConflict();
          return c;
        }
        let predecessorCase: EffectivenessCase["predecessorCase"];
        let previousCase: EffectivenessCase | undefined;
        if (body.predecessorCaseId) {
          const previous = await load(db, body.predecessorCaseId, session);
          await authorize(
            db,
            previous,
            identity,
            previous.definition.maker,
            "read",
            session,
          );
          const candidate = previous.candidates.at(-1)?.reference;
          if (
            previous.workspaceId !== workspaceId ||
            previous.target.id !== target.id ||
            !candidate
          )
            throw new AuthorizationDenied();
          previousCase = previous;
          predecessorCase = {
            id: previous.id,
            candidateDigest: candidate.contentDigest,
            criteriaDigest: previous.criteria.digest,
          };
        }
        const prepared = await p.prepareCase({
          db,
          session,
          identity,
          workspaceId,
          input: body.input,
          requestAudit: {
            actor: resolved.response.human,
            capacity: authority.basis,
            requestKey: body.requestKey,
            confirmedAt: clock().toISOString(),
          },
          predecessor: previousCase,
          predecessorFresh: previousCase
            ? await fresh(db, previousCase, session)
            : undefined,
        });
        const { criteria: derivedCriteria } = prepared;
        const {
          criteria: derivedEntries,
          digest: derivedDigest,
          ...criteriaMetadata
        } = derivedCriteria;
        void derivedDigest;
        prepared.criteria = assembleCriteriaSet(criteriaMetadata, [
          p.criteriaFloor,
          derivedEntries,
        ]);
        const workspace = await db
          .collection("crm_workspaces")
          .findOne({ id: workspaceId }, { session });
        const now = clock();
        const c = EffectivenessCaseSchema.parse({
          id: generatePlatformId("effectivenesscase"),
          workspaceId,
          organisationId: workspace?.clientOrganisationId,
          requester: resolved.response.human,
          requesterClientId: identity.clientId,
          authority,
          target,
          requestKey: body.requestKey,
          requestDigest: digest(body),
          ...(predecessorCase ? { predecessorCase } : {}),
          definition: p.definition,
          criteria: CriteriaSetSchema.parse(prepared.criteria),
          policy: p.policy,
          totalBudget: prepared.totalBudget,
          allocations: [],
          rootRunId: generatePlatformId("agentrun"),
          status: "pending",
          reason: "requested",
          stateRevision: 1,
          createdAt: now,
          updatedAt: now,
          candidates: [],
          evaluations: [],
          decisions: [],
          dispositions: [],
        });
        for (const op of [
          c.definition.maker,
          c.definition.evaluator,
          ...(c.policy.maxRevisions ? [c.definition.revision] : []),
        ])
          await authorize(db, c, identity, op, "request", session);
        await db
          .collection("agent_effectiveness_cases")
          .insertOne(structuredClone(c), { session });
        await start(
          db,
          c,
          "maker",
          prepared.preparedInput ?? body.input,
          session,
          c.rootRunId,
        );
        return load(db, c.id, session);
      });
    },
    async list(
      identity: AuthenticatedUser,
      workspaceId: string,
      value: unknown,
    ) {
      platformIdSchema("workspace").parse(workspaceId);
      const query = z
        .object({
          limit: z.coerce.number().int().min(1).max(100).default(20),
          after: platformIdSchema("effectivenesscase").optional(),
          status: z
            .enum([
              "pending",
              "evaluating",
              "revising",
              "passed",
              "held",
              "escalated",
              "closed",
            ])
            .optional(),
        })
        .strict()
        .parse(value);
      return transact(async (db, session) => {
        const resolved = await resolveHvmContext(db, config, identity, session);
        const queen = resolved.authority.authorize(resolved.context, "update", {
          type: "client_agents",
          workspaceId,
        });
        const after = query.after
          ? await load(db, query.after, session)
          : undefined;
        if (after) {
          if (after.workspaceId !== workspaceId)
            throw new AuthorizationDenied();
          await authorize(
            db,
            after,
            identity,
            after.definition.maker,
            "read",
            session,
          );
        }
        const sortField = queen ? "updatedAt" : "createdAt";
        const rows = await db
          .collection("agent_effectiveness_cases")
          .find(
            {
              workspaceId,
              ...(queen
                ? {}
                : {
                    "requester.issuer": identity.issuer,
                    "requester.id": identity.subject,
                  }),
              ...(after
                ? {
                    $or: [
                      {
                        [sortField]: {
                          [queen ? "$gt" : "$lt"]: after[sortField],
                        },
                      },
                      { [sortField]: after[sortField], id: { $gt: after.id } },
                    ],
                  }
                : {}),
              ...(query.status
                ? { status: query.status }
                : queen
                  ? {
                      status: {
                        $in: [
                          "pending",
                          "evaluating",
                          "revising",
                          "passed",
                          "held",
                          "escalated",
                          "closed",
                        ],
                      },
                    }
                  : {}),
            },
            { session, maxTimeMS: 5000 },
          )
          .sort({ [sortField]: queen ? 1 : -1, id: 1 })
          .limit(query.limit)
          .toArray();
        const items: EffectivenessCase[] = [];
        for (const row of rows) {
          const c = EffectivenessCaseSchema.parse(withoutMongoId(row));
          try {
            await authorize(
              db,
              c,
              identity,
              c.definition.maker,
              "read",
              session,
            );
            items.push(c);
          } catch (error) {
            if (!(error instanceof AuthorizationDenied)) throw error;
          }
        }
        return {
          items,
          ...(rows.length === query.limit ? { next: rows.at(-1)!.id } : {}),
        };
      });
    },
    async read(identity: AuthenticatedUser, id: string) {
      return transact(async (db, session) => {
        const c = await load(db, id, session);
        await authorize(db, c, identity, c.definition.maker, "read", session);
        const current = await fresh(db, c, session);
        const clarification = current
          ? await generalClarificationView(db, c, session, clock())
          : undefined;
        return {
          case: c,
          fresh: current,
          ...(clarification ? { clarification } : {}),
        };
      });
    },
    async requestExecution(
      identity: AuthenticatedUser,
      id: string,
      role: "evaluator" | "revision",
      value: unknown,
    ) {
      const body = z
        .object({
          expectedRevision: z.number().int().positive(),
          requestKey: legacyRequest.shape.requestKey,
          reason: z.string().min(1).max(2000),
        })
        .strict()
        .parse(value);
      canonicalJson(body, 8192);
      return transact(async (db, session) => {
        const c = await load(db, id, session);
        const resolved = await authorize(
          db,
          c,
          identity,
          c.definition[role],
          "request",
          session,
        );
        const actor = resolved.response.human;
        const key = digest({
          caseId: id,
          role,
          actor,
          requestKey: body.requestKey,
        });
        const prior = c.allocations.find((a) => a.request?.key === key);
        if (prior) {
          if (prior.request!.digest !== digest(body))
            throw new AgentRunConflict("Request key conflict");
          return { case: c, runId: prior.runId };
        }
        if (
          c.activeRunId ||
          c.status === "closed" ||
          c.stateRevision !== body.expectedRevision ||
          !c.candidates.length
        )
          throw new AgentRunConflict("Case is not ready");
        if (!(await fresh(db, c, session)))
          throw new AgentRunConflict(
            "New frozen case required for changed sources or criteria",
          );
        const candidate = c.candidates.at(-1)!.reference;
        let input: unknown = { candidate };
        if (role === "revision") {
          const evaluation = c.evaluations
            .filter(
              (e) => e.candidateRevision === candidate.revision && e.resultId,
            )
            .at(-1);
          if (!evaluation)
            throw new AgentRunConflict(
              "Revision requires an accepted evaluation",
            );
          const row = await db
            .collection("agent_results")
            .findOne(
              { id: evaluation.resultId, workspaceId: c.workspaceId },
              { session },
            );
          const result = AgentResultSchema.parse(withoutMongoId(row!));
          const evaluationRun = await db
            .collection("agent_runs")
            .findOne(
              { id: evaluation.runId, workspaceId: c.workspaceId },
              { session },
            );
          const ei = EvaluationInputSchema.parse(
            AgentRunSchema.parse(withoutMongoId(evaluationRun!)).frozen.input,
          );
          const { p } = await profile(db, c, session);
          const payload = validateEvaluation(
            result.envelope.outcome.content,
            ei,
            {
              allowedNotApplicable: p.allowedNotApplicable(ei),
              modelInvocationIds: result.envelope.usage
                .filter((u) => u.category === "model")
                .map((u) => u.invocationId),
            },
          );
          if (!payload.defects.length)
            throw new AgentRunConflict("Revision requires recorded defects");
          input = {
            candidate,
            evaluationResultId: result.id,
            defects: payload.defects,
          };
        }
        await start(db, c, role, input, session, undefined, {
          key,
          digest: digest(body),
          actor,
        });
        const current = await load(db, id, session);
        await audit(db, current, "human_requested_" + role, actor, session);
        return { case: current, runId: current.activeRunId! };
      });
    },
    async review(identity: AuthenticatedUser, id: string, value: unknown) {
      const body = z
        .object({
          expectedRevision: z.number().int().positive(),
          requestKey: z.string().min(1).max(100),
          action: z.enum(["hold", "close"]),
          reason: z.string().min(1).max(2000),
        })
        .strict()
        .parse(value);
      return transact(async (db, session) => {
        const c = await load(db, id, session);
        const resolved = await authorize(
          db,
          c,
          identity,
          c.definition.maker,
          "read",
          session,
        );
        if (
          !resolved.authority.authorize(resolved.context, "update", {
            type: "client_agents",
            workspaceId: c.workspaceId,
          })
        )
          throw new AuthorizationDenied();
        await serializeAgentAuthority(
          db,
          {
            workspaceId: c.workspaceId,
            target: c.target,
            requester: resolved.response.human,
            authority: { basis: "partner" },
          },
          session,
        );
        const prior = c.dispositions.find(
          (d) => d.requestKey === body.requestKey,
        );
        if (prior) {
          if (prior.requestDigest !== digest(body))
            throw new AgentRunConflict();
          return c;
        }
        if (
          c.status === "closed" ||
          c.stateRevision !== body.expectedRevision ||
          c.activeRunId ||
          c.dispositions.length >= 8
        )
          throw new AgentRunConflict();
        const old = c.stateRevision;
        c.dispositions.push({
          requestKey: body.requestKey,
          requestDigest: digest(body),
          actor: resolved.response.human,
          at: clock(),
          action: body.action,
          reason: body.reason,
          ...(c.candidates.at(-1)
            ? { candidateDigest: c.candidates.at(-1)!.reference.contentDigest }
            : {}),
          ...(c.evaluations.at(-1)?.resultId
            ? { evaluationResultId: c.evaluations.at(-1)!.resultId }
            : {}),
          criteriaDigest: c.criteria.digest,
          policyDigest: c.policy.identity.digest,
        });
        c.status = body.action === "close" ? "closed" : "held";
        c.reason = "human_review";
        await save(db, c, old, session);
        await audit(db, c, body.action, resolved.response.human, session);
        return c;
      });
    },
    async cancel(identity: AuthenticatedUser, id: string) {
      return transact(async (db, session) => {
        const c = await load(db, id, session);
        await authorize(db, c, identity, c.definition.maker, "cancel", session);
        if (c.status === "closed") return c;
        if (c.activeRunId) {
          const active = await db
            .collection("agent_runs")
            .findOne({ id: c.activeRunId }, { session });
          if (active)
            await transactionService(db, session).cancel(
              identity,
              c.activeRunId,
              active.updatedAt.toISOString(),
            );
        }
        const old = (await load(db, c.id, session)).stateRevision;
        c.status = "closed";
        c.reason = "cancelled";
        delete c.activeRunId;
        await save(db, c, old, session);
        await audit(
          db,
          c,
          "cancelled",
          { type: "human", issuer: identity.issuer, id: identity.subject },
          session,
        );
        return c;
      });
    },
    async eligible(
      db: Db,
      run: AgentRun,
      proposalId: string,
      session: ClientSession,
    ) {
      if (!run.effectiveness) return true;
      const c = await load(db, run.effectiveness.caseId, session);
      const candidate = c.candidates.at(-1)?.reference;
      const eligible =
        c.status === "passed" &&
        candidate?.runId === run.id &&
        candidate.selector.kind === "proposal" &&
        candidate.selector.proposalId === proposalId &&
        (await fresh(db, c, session));
      if (eligible) await save(db, c, c.stateRevision, session);
      return eligible;
    },
  };
}
