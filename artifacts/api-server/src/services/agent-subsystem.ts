import type { Db, ClientSession } from "mongodb";
import { createNbaNativeExecution } from "./nba/native";
import { psuAppOptions } from "./psu-app-options";
import {
  createAgentEffectiveness,
  type EffectivenessProfile,
} from "./agent-effectiveness";
import type { AppConfig } from "../config";
import type { MongoService } from "./mongo";
import { createAgentWorkloadAuthority } from "../authorization/agent-workload";
import { createAgentControlPlane } from "./agent-control-plane";
import {
  createAgentExecutionReadiness,
  type AgentCapabilityProvider,
  type WorkspaceExecutionPolicy,
} from "./agent-execution-readiness";
import {
  createAgentRunRequests,
  type AgentRunPreparer,
} from "./agent-run-requests";
import {
  createAgentProposalReview,
  type AgentProposalHandler,
} from "./agent-proposals";
import {
  createAgentHumanRouter,
  createAgentWorkloadRouter,
  type WorkloadAuthenticator,
} from "../routes/agent-control-plane";
import { createAgentOperatorRouter } from "../routes/agent-operators";

/** Trusted server composition only. Default: no runtime capacity, execution
 * policy, preparers or workload authentication. Generic canonical Hive draft
 * handlers are reviewed server-owned defaults; unknown target kinds fail closed. No env/header bypass. */
export function createAgentSubsystem(
  config: AppConfig,
  mongo: MongoService,
  options: {
    nbaAvailable?: (db?: Db, session?: ClientSession) => Promise<boolean>;
    capacity?: ReturnType<
      typeof import("./agent-execution-reconciliation").createExecutionReconciliation
    >;
    capabilities?: AgentCapabilityProvider;
    execution?: WorkspaceExecutionPolicy;
    preparers?: readonly AgentRunPreparer[];
    handlers?: ReadonlyMap<string, AgentProposalHandler>;
    authority?: ReturnType<typeof createAgentWorkloadAuthority>;
    authenticate?: WorkloadAuthenticator;
    clock?: () => Date;
    effectivenessProfiles?: readonly EffectivenessProfile[];
  } = {},
) {
  const authority =
    options.authority ??
    createAgentWorkloadAuthority(config.deploymentEnvironment, []);
  const readiness = createAgentExecutionReadiness(
    options.capabilities,
    options.execution,
  );
  const effectiveness = createAgentEffectiveness(
    config,
    mongo,
    authority,
    readiness,
    options.effectivenessProfiles,
    options.clock,
  );
  const control = createAgentControlPlane(
    config,
    mongo,
    authority,
    readiness.policy,
    options.clock,
    effectiveness.hooks,
  );
  const requests = createAgentRunRequests(
    config,
    mongo,
    authority,
    readiness,
    options.preparers,
    options.clock,
  );
  const review = createAgentProposalReview(
    config,
    mongo,
    control,
    options.handlers,
    options.clock,
    effectiveness.eligible,
  );
  return {
    effectiveness,
    control,
    nba: options.nbaAvailable ? createNbaNativeExecution(config,mongo,authority,readiness.policy,options.nbaAvailable) : undefined,
    human: createAgentHumanRouter(config, mongo, control, {
      psuOptions: (identity, workspaceId) =>
        psuAppOptions(
          config,
          mongo,
          identity,
          workspaceId,
          options.capabilities,
        ),
      ...requests,
      ...review,
      effectiveness,
    }),
    operators: createAgentOperatorRouter(config, mongo, readiness.catalogue),
    workload: createAgentWorkloadRouter(
      control,
      options.authenticate,
      options.capacity,
    ),
  };
}
