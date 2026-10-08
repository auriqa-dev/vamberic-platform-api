import { parsePsuStartupBinding } from "./psu-startup-binding";
import { openAITerminalQualification } from "./psu-terminal-qualification";
import {
  ECSClient,
  DescribeTasksCommand,
  DescribeServicesCommand,
} from "@aws-sdk/client-ecs";
import { CapacityReleaseSchema } from "../domain/agent-capacity";
import { composePsuProduction } from "./psu-production-composition";
import { createEcsDeploymentObserver } from "./agent-deployment-observer";
import type { AppConfig } from "../config";
import type { MongoService } from "./mongo";
import { createCognitoWorkloadAuthentication } from "../authorization/agent-workload-cognito";
import { createAgentSubsystem } from "./agent-subsystem";

/** Compatibility for the still-deployed autonomous worker. Its heartbeat must
 * retain the existing verified capacity contract until worker retirement. The
 * direct PSU app routes do not call or depend on this legacy execution flow. */
export function composeAgentDeployment(
  config: AppConfig,
  mongo: MongoService,
  env: NodeJS.ProcessEnv = process.env,
) {
  if (
    env.PSU_TERMINAL_QUALIFICATION !== undefined &&
    env.PSU_PRODUCTION_RELEASE === undefined
  )
    throw new Error("Incomplete PSU qualification configuration");
  const values = [
    env.AGENT_WORKLOAD_ISSUER,
    env.AGENT_WORKLOAD_CLIENT_ID,
    env.AGENT_WORKLOAD_RESOURCE_SERVER,
  ];
  if (env.PSU_PRODUCTION_RELEASE !== undefined && values.some((v) => !v))
    throw new Error("PSU requires workload authentication");
  if (values.every((v) => v === undefined))
    return createAgentSubsystem(config, mongo);
  if (
    values.some((v) => !v) ||
    !["dev", "prod"].includes(config.deploymentEnvironment)
  )
    throw new Error("Incomplete workload deployment configuration");
  const authentication = createCognitoWorkloadAuthentication({
    environment: config.deploymentEnvironment as "dev" | "prod",
    issuer: env.AGENT_WORKLOAD_ISSUER!,
    clientId: env.AGENT_WORKLOAD_CLIENT_ID!,
    resourceServer: env.AGENT_WORKLOAD_RESOURCE_SERVER!,
  });
  if (env.PSU_PRODUCTION_RELEASE === undefined)
    return createAgentSubsystem(config, mongo, authentication);
  let release;
  try {
    if (env.PSU_PRODUCTION_RELEASE.length > 4096) throw new Error();
    release = CapacityReleaseSchema.parse(
      JSON.parse(env.PSU_PRODUCTION_RELEASE),
    );
    if (release.workloadClientId !== env.AGENT_WORKLOAD_CLIENT_ID)
      throw new Error();
  } catch {
    throw new Error("Invalid PSU release configuration");
  }
  const service =
    /^arn:aws:ecs:([a-z0-9-]+):[0-9]{12}:service\/[^/]+\/[^/]+$/.exec(
      release.serviceArn,
    );
  if (!service || config.deploymentEnvironment !== "dev")
    throw new Error("Invalid PSU deployment binding");
  const taskPrefix =
    release.serviceArn.split(":service/")[0] + ":task-definition/";
  if (
    !release.taskDefinitionArn.startsWith(taskPrefix) ||
    !/^[^/:]+:[1-9][0-9]*$/.test(
      release.taskDefinitionArn.slice(taskPrefix.length),
    )
  )
    throw new Error("Invalid PSU task definition binding");
  if (!env.PSU_TERMINAL_QUALIFICATION)
    throw new Error("Missing PSU qualification configuration");
  const binding = parsePsuStartupBinding(
    env.PSU_TERMINAL_QUALIFICATION,
    release,
  );
  const qualification = openAITerminalQualification(binding.projectReference);
  const ecs = new ECSClient({
    region: service[1],
    maxAttempts: 1,
    requestHandler: { connectionTimeout: 2000, requestTimeout: 5000 },
  });
  const observer = createEcsDeploymentObserver({
    describeTasks: (input) => ecs.send(new DescribeTasksCommand(input)),
    describeServices: (input) => ecs.send(new DescribeServicesCommand(input)),
  });
  const subsystem = composePsuProduction(
    config,
    mongo,
    authentication,
    release,
    observer,
    undefined,
    qualification,
  );
  let polling = false;
  const timer = setInterval(() => {
    if (polling) return;
    polling = true;
    void subsystem.capacity
      .observe()
      .catch(() => {})
      .finally(() => {
        polling = false;
      });
  }, 10000);
  timer.unref();
  const dispose = () => {
    clearInterval(timer);
    ecs.destroy();
  };
  process.once("SIGTERM", dispose);
  process.once("SIGINT", dispose);
  return subsystem;
}
