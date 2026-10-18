import type { ClientSession, Db, Document } from "mongodb";
import { NBA_FOUNDATION_MANIFEST as manifest } from "@workspace/agent-runtime-protocol";
import { generatePlatformId } from "../../domain";
import { parseFrozenWork } from "../../domain/agent-control-plane";
import type { AppConfig } from "../../config";
import type { AuthenticatedUser } from "../../middlewares/auth";
import type { MongoService } from "../mongo";
import { HiveConflict } from "../hive-definitions";
import { createAgentControlPlane } from "../agent-control-plane";
import type { AgentExecutionPolicy } from "../agent-control-plane";
import type { createAgentWorkloadAuthority } from "../../authorization/agent-workload";
import { nbaAccess, nbaContext } from "./context";
import { nbaHash, guardDecision } from "./model";
import { claimKeys, engagementConflicts } from "./coordination";

export interface NbaExecution {
  available(db?: Db, session?: ClientSession): Promise<boolean>;
  enqueue(
    db: Db,
    session: ClientSession,
    user: AuthenticatedUser,
    workspaceId: string,
    campaignId: string,
    payload: Document,
  ): Promise<string>;
  cancel(
    db: Db,
    session: ClientSession,
    user: AuthenticatedUser,
    workspaceId: string,
    runId: string,
  ): Promise<void>;
}
export async function nbaWorkAllowed(
  db: Db,
  workspaceId: string,
  work: import("../../domain/agent-control-plane").FrozenAgentWork,
  session: ClientSession,
  config: AppConfig,
) {
  const deny = (reason: string) => {
    console.warn(
      JSON.stringify({
        event: "nba_execution_denied",
        runId: work.runId,
        reason,
      }),
    );
    return false;
  };
  if (
    work.protocolVersion !== "2.0" ||
    work.operation !== "reconsider" ||
    work.definition.key !== "next_best_action" ||
    work.definition.version !== 1 ||
    work.implementation.manifestDigest !== manifest.manifestDigest ||
    work.implementation.buildDigest !== manifest.buildDigest ||
    work.grant.models.length ||
    work.grant.tools.length ||
    work.grant.bindings.length ||
    work.grant.proposalTargets.length ||
    work.grant.budgets.modelCalls ||
    work.grant.budgets.toolCalls ||
    work.grant.budgets.providerCalls.length ||
    work.grant.budgets.cost.amount !== "0"
  )
    return deny("contract");
  const input = work.input as Document;
  const row = await db
    .collection("events")
    .find(
      {
        workspaceId,
        eventType: "nba_decision",
        "payload.decisionId": input.decisionId,
      },
      { session },
    )
    .sort({ "payload.version": -1 })
    .limit(1)
    .next();
  if (
    !row ||
    row.payload.state !== "scheduled" ||
    row.payload.version !== input.decisionVersion ||
    row.payload.contextHash !== input.contextHash ||
    !row.payload.approvedBy
  )
    return deny("decision_state_or_version");
  const p = row.payload,
    user = p.approvedBy as AuthenticatedUser;
  try {
    await nbaAccess(db, config, user, workspaceId, "approve", session);
    const context = await nbaContext(
      db,
      config,
      user,
      workspaceId,
      row.campaignId,
      p.campaignVersion,
      p.subject,
      session,
      p.decisionId,
    );
    const checked = guardDecision(
      { ...p.decision, dueAt: null, awaitEvent: "policy" },
      context,
      new Date(),
    );
    if (nbaHash(context.versions) !== p.contextHash)
      return deny("context_changed");
    if (checked.blockers.length) return deny("decision_guard");
    if (
      (
        await engagementConflicts(
          db,
          session,
          workspaceId,
          claimKeys(p.subject, p.organisationId),
          p.decisionId,
        )
      ).length
    )
      return deny("engagement_conflict");
    if (
      work.context.references.length ||
      work.context.snapshots.length ||
      work.grant.resources.length
    )
      return deny("context_or_resource_grant");
    if (input.dueAt !== (p.decision.dueAt ?? p.approvedAt))
      return deny("schedule_changed");
    return true;
  } catch {
    return deny("context_or_authority_unavailable");
  }
}
export function createNbaNativeExecution(
  config: AppConfig,
  mongo: MongoService,
  authority: ReturnType<typeof createAgentWorkloadAuthority>,
  policy: AgentExecutionPolicy,
  available: (db?: Db, session?: ClientSession) => Promise<boolean>,
): NbaExecution {
  const control = (db: Db, session: ClientSession) =>
    createAgentControlPlane(
      config,
      { ...mongo, withTransaction: async (fn) => fn(db, session) },
      authority,
      policy,
    );
  return {
    available,
    async enqueue(db, session, user, w, campaignId, p) {
      if (!(await available(db, session)))
        throw new HiveConflict(
          "NBA worker is not ready. Your decision is saved; retry approval when it is available.",
        );
      const definition = await db.collection("agent_definitions").findOne(
        {
          key: "next_best_action",
          version: 1,
          status: "active",
          archived: false,
          "data.executionImplementation.manifestDigest":
            manifest.manifestDigest,
        },
        { session },
      );
      const workspace = await db
        .collection("crm_workspaces")
        .findOne({ id: w }, { session });
      if (!definition || !workspace)
        throw new HiveConflict("NBA foundation registration is not ready.");
      const runId = generatePlatformId("agentrun"),
        now = new Date(),
        dueAt = p.decision.dueAt ?? p.approvedAt;
      const deadline = new Date(
        Math.max(now.getTime(), Date.parse(dueAt)) + 86400000,
      ).toISOString();
      const implementation = {
        ...manifest.implementation,
        manifestDigest: manifest.manifestDigest,
        buildDigest: manifest.buildDigest,
      };
      const def = {
        id: definition.id,
        key: definition.key,
        version: definition.version,
      };
      const frozen = parseFrozenWork({
        protocolVersion: "2.0",
        runId,
        workspaceId: w,
        clientId: workspace.clientOrganisationId,
        operation: "reconsider",
        definition: def,
        implementation,
        executionTarget: {
          kind: "workspace_agent",
          workspaceId: w,
          definition: def,
          implementation,
        },
        configuration: [],
        context: { references: [], snapshots: [] },
        input: {
          decisionId: p.decisionId,
          decisionVersion: p.version,
          contextHash: p.contextHash,
          dueAt,
        },
        resultSchemaVersion: 2,
        checkpointSchemaVersion: 2,
        grant: {
          id: `grant:${runId}`,
          version: 1,
          runId,
          workspaceId: w,
          expiresAt: deadline,
          resources: [],
          proposalTargets: [],
          tools: [],
          bindings: [],
          models: [],
          budgets: {
            deadline,
            modelCalls: 0,
            toolCalls: 0,
            providerCalls: [],
            cost: { currency: "GBP", amount: "0" },
          },
        },
        traceId: `nba:${campaignId}:${p.decisionId}`,
        lineage: [],
      });
      const accepted = await control(db, session).acceptPrepared(user, {
        frozen,
        manifest,
        requestKey: `nba:${p.decisionId}:${p.version}`,
        limits: { attempts: 4, failures: 2, inputCycles: 0, continuations: 2 },
      });
      return accepted.id;
    },
    async cancel(db, session, user, w, runId) {
      const run = await db
        .collection("agent_runs")
        .findOne({ id: runId, workspaceId: w }, { session });
      if (!run)
        throw new HiveConflict("The scheduled NBA run could not be found.");
      await control(db, session).cancel(
        user,
        runId,
        run.updatedAt.toISOString(),
      );
    },
  };
}
