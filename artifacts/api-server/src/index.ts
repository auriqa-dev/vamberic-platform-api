import { brandGeneratorFromEnvironment } from "./services/brand-expression/generate";
import { icpGeneratorFromEnvironment } from "./services/icp/generate";
import { psuGeneratorFromEnvironment } from "./services/psu/generate";
import { SQSClient } from "@aws-sdk/client-sqs";
import {
  createDispatchScheduler,
  sqsDispatchSink,
} from "./services/agent-dispatch";
import { composeAgentDeployment } from "./services/agent-deployment";
import { createServer } from "node:http";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { logger } from "./lib/logger";
import { MongoClientService } from "./services/mongo";

const config = loadConfig();
const mongo = new MongoClientService(config.mongodbUri);
const agents = composeAgentDeployment(config, mongo);
const app = createApp(config, mongo, { agents, brandGenerator:brandGeneratorFromEnvironment(), icpGenerator: icpGeneratorFromEnvironment(), psuGenerator: psuGeneratorFromEnvironment() });
const server = createServer(app);
const dispatchEnabled = process.env.AGENT_DISPATCH_ENABLED;
if (
  dispatchEnabled !== undefined &&
  !["true", "false"].includes(dispatchEnabled)
)
  throw new Error("Invalid dispatch setting");
if (
  dispatchEnabled === "true" &&
  (!process.env.AGENT_QUEUE_URL ||
    !process.env.AWS_REGION ||
    !process.env.AGENT_WORKLOAD_CLIENT_ID)
)
  throw new Error("Incomplete dispatch configuration");
if (dispatchEnabled === "true") {
  const queue = new URL(process.env.AGENT_QUEUE_URL!);
  if (
    queue.origin !== `https://sqs.${process.env.AWS_REGION}.amazonaws.com` ||
    !/^\/\d{12}\/vamberic-(dev|prod)-agent-runtime$/.test(queue.pathname) ||
    !queue.pathname.endsWith(
      `/vamberic-${config.deploymentEnvironment}-agent-runtime`,
    ) ||
    queue.username ||
    queue.password ||
    queue.search ||
    queue.hash
  )
    throw new Error("Invalid environment dispatch queue");
}
const sqs =
  dispatchEnabled === "true"
    ? new SQSClient({
        region: process.env.AWS_REGION,
        maxAttempts: 2,
        requestHandler: { connectionTimeout: 5000, requestTimeout: 10000 },
      })
    : undefined;
const dispatcher = sqs
  ? createDispatchScheduler(
      mongo,
      agents.control,
      sqsDispatchSink(sqs, process.env.AGENT_QUEUE_URL!),
      (code) => logger.warn({ code }, "Agent dispatch unavailable"),
    )
  : undefined;

server.listen(config.port, () => {
  dispatcher?.start();
  logger.info(
    {
      port: config.port,
      environment: config.deploymentEnvironment,
      runtimeMode: config.runtimeMode,
      service: config.serviceName,
      version: config.version,
    },
    "Server listening",
  );
});

let isShuttingDown = false;

function shutdown(signal: NodeJS.Signals): void {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  logger.info({ signal }, "Shutdown requested");
  void dispatcher?.stop();

  server.close(async (error) => {
    let shutdownFailed = false;

    if (error) {
      logger.error({ err: error }, "Error during server shutdown");
      shutdownFailed = true;
    }

    try {
      await dispatcher?.stop();
      sqs?.destroy();
      await mongo.close();
    } catch {
      logger.error("MongoDB shutdown failed");
      shutdownFailed = true;
    }

    if (shutdownFailed) {
      process.exitCode = 1;
    } else {
      logger.info("Server shut down cleanly");
    }
  });
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
