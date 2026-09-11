import { createServer } from "node:http";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { logger } from "./lib/logger";
import { MongoClientService } from "./services/mongo";

const config = loadConfig();
const mongo = new MongoClientService(config.mongodbUri);
const app = createApp(config, mongo);
const server = createServer(app);

server.listen(config.port, () => {
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

  server.close(async (error) => {
    let shutdownFailed = false;

    if (error) {
      logger.error({ err: error }, "Error during server shutdown");
      shutdownFailed = true;
    }

    try {
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
