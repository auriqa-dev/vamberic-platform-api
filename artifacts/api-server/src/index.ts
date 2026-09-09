import { createServer } from "node:http";
import app from "./app";
import { loadConfig } from "./config";
import { logger } from "./lib/logger";

const config = loadConfig();
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

  server.close((error) => {
    if (error) {
      logger.error({ err: error }, "Error during server shutdown");
      process.exitCode = 1;
      return;
    }

    logger.info("Server shut down cleanly");
  });
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
