import { z } from "zod";
import type { ClientSession, Db } from "mongodb";
import { JsonPayloadSchema, digest } from "@workspace/agent-runtime-protocol";
import {
  AgentOperationKey,
  WorkspaceAgentTarget,
} from "../domain/agent-operator";
import { platformIdSchema, generatePlatformId } from "../domain/schemas";
import {
  parseFrozenWork,
  frozenTarget,
  type AgentRun,
  type FrozenAgentWork,
} from "../domain/agent-control-plane";
import type { AppConfig } from "../config";
import type { MongoService } from "./mongo";
import type { AuthenticatedUser } from "../middlewares/auth";
import { resolveHvmContext } from "./hvm-context";
import {
  requireAgentControlPlane,
  AgentControlPlaneUnavailable,
} from "./agent-operators";
import { AuthorizationDenied } from "../authorization/policy";
import { createAgentControlPlane } from "./agent-control-plane";
import { createAgentExecutionReadiness } from "./agent-execution-readiness";
import { createAgentWorkloadAuthority } from "../authorization/agent-workload";

const LegacyRequestSchema = z
  .object({
    clientAgentId: platformIdSchema("clientagent"),
    revision: z.number().int().positive().safe(),
    operation: AgentOperationKey,
    requestKey: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/),
    input: z.unknown(),
  })
  .strict();
const RequestSchema = z.union([
  LegacyRequestSchema,
  LegacyRequestSchema.omit({ clientAgentId: true, revision: true })
    .extend({
      target: WorkspaceAgentTarget,
      configurationOverlay: z
        .object({
          id: platformIdSchema("clientagent"),
          revision: z.number().int().safe().positive(),
          contentHash: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .strict()
        .optional(),
    })
    .strict(),
]);
/** Code-reviewed operation preparation, not executable plugin/user metadata.
 * The preparer must use only approved projections and the current actor's scope;
 * the execution policy independently validates the resulting grants and budget.
 * No production implementation is registered in 4A.2. */
export interface AgentRunPreparer {
  prepareWorkspace?(context: {
    db: Db;
    session: ClientSession;
    identity: AuthenticatedUser;
    workspaceId: string;
    runId: string;
    target: import("../domain/agent-operator").AgentTarget;
    configuration: unknown;
    configurationOverlay?: import("./reasoning-configuration").ConfigurationSelection;
    input: unknown;
    now: Date;
  }): Promise<{ frozen: FrozenAgentWork; limits: AgentRun["limits"] }>;
  manifestDigest: string;
  operation: string;
  prepare(context: {
    db: Db;
    session: ClientSession;
    identity: AuthenticatedUser;
    workspaceId: string;
    runId: string;
    clientAgentId: string;
    revision: number;
    input: unknown;
    now: Date;
  }): Promise<{ frozen: FrozenAgentWork; limits: AgentRun["limits"] }>;
}
export function createAgentRunRequests(
  config: AppConfig,
  mongo: MongoService,
  workloads: ReturnType<typeof createAgentWorkloadAuthority>,
  readiness: ReturnType<typeof createAgentExecutionReadiness>,
  preparers: readonly AgentRunPreparer[] = [],
  clock: () => Date = () => new Date(),
) {
  const registry = new Map<string, AgentRunPreparer>();
  for (const preparer of preparers) {
    const key = preparer.manifestDigest + ":" + preparer.operation;
    if (registry.has(key)) throw new Error("Duplicate reviewed Run preparer");
    registry.set(key, Object.freeze({ ...preparer }));
  }
  async function request(
    identity: AuthenticatedUser,
    workspaceId: string,
    input: unknown,
    inspectOnly: boolean,
  ) {
    platformIdSchema("workspace").parse(workspaceId);
    const body = RequestSchema.parse(input);
    const normalized = JsonPayloadSchema.parse(body.input);
    if (!mongo.withTransaction)
      throw new AgentControlPlaneUnavailable("Transactions required");
    return mongo.withTransaction(async (db, session) => {
      await requireAgentControlPlane(db, session);
      const resolved = await resolveHvmContext(db, config, identity, session);
      const target =
        "target" in body
          ? body.target
          : {
              kind: "client_agent" as const,
              id: body.clientAgentId,
              revision: body.revision,
            };
      if (
        !resolved.authority.authorizeAgentOperation(
          resolved.context,
          { workspaceId, target, operation: body.operation, action: "request" },
          clock(),
        )
      )
        throw new AuthorizationDenied();
      const overlay = "target" in body ? body.configurationOverlay : undefined;
      if (overlay)
        resolved.authority.scopeFilter(resolved.context, "read", {
          type: "client_agents",
          workspaceId,
        });
      const state = await readiness.inspect(
        db,
        workspaceId,
        target,
        session,
        overlay,
      );
      const manifest = state.manifest;
      if (
        state.reasons.length ||
        !manifest ||
        !manifest.operations.includes(body.operation)
      )
        throw new AgentControlPlaneUnavailable(
          "Execution readiness unavailable",
        );
      const preparer = registry.get(
        manifest.manifestDigest + ":" + body.operation,
      );
      if (!preparer)
        throw new AgentControlPlaneUnavailable(
          "Operation preparation unavailable",
        );
      const runId = generatePlatformId("agentrun");
      const common = {
        db,
        session,
        identity,
        workspaceId,
        runId,
        input: normalized,
        now: clock(),
      };
      const prepared =
        "target" in body
          ? await (preparer.prepareWorkspace
              ? preparer.prepareWorkspace({
                  ...common,
                  target,
                  configuration: state.configuration ?? {},
                  ...(overlay ? { configurationOverlay: overlay } : {}),
                })
              : Promise.reject(
                  new AgentControlPlaneUnavailable(
                    "Workspace preparation unavailable",
                  ),
                ))
          : await preparer.prepare({
              ...common,
              clientAgentId: body.clientAgentId,
              revision: body.revision,
            });
      const frozen = parseFrozenWork(prepared.frozen);
      if (
        frozen.protocolVersion === "2.0" &&
        digest(frozen.configurationOverlay ?? null) !== digest(overlay ?? null)
      )
        throw new AuthorizationDenied();
      const workspace = await db
        .collection("crm_workspaces")
        .findOne({ id: workspaceId }, { session });
      if (
        frozen.runId !== runId ||
        frozen.workspaceId !== workspaceId ||
        frozen.clientId !== workspace?.clientOrganisationId ||
        digest(frozenTarget(frozen)) !== digest(target) ||
        frozen.operation !== body.operation ||
        digest(frozen.input) !== digest(normalized)
      )
        throw new AuthorizationDenied();
      // Reuse the existing transaction/session; no nested transaction or uncommitted
      // readiness snapshot escapes into a subsequent acceptance transaction.
      const transactionMongo: MongoService = {
        ...mongo,
        withTransaction: async (work) => work(db, session),
      };
      const control = createAgentControlPlane(
        config,
        transactionMongo,
        workloads,
        readiness.policy,
        clock,
      );
      return control.acceptPrepared(
        identity,
        { ...prepared, frozen, requestKey: body.requestKey, manifest },
        inspectOnly,
      );
    });
  }
  return {
    create: (
      identity: AuthenticatedUser,
      workspaceId: string,
      input: unknown,
    ) => request(identity, workspaceId, input, false),
    async readiness(
      identity: AuthenticatedUser,
      workspaceId: string,
      input: unknown,
    ) {
      try {
        await request(identity, workspaceId, input, true);
        return { executionReady: true, provisional: true };
      } catch (error) {
        if (error instanceof AgentControlPlaneUnavailable)
          return {
            executionReady: false,
            reasons: ["execution_unavailable"],
            provisional: true,
          };
        throw error;
      }
    },
  };
}
