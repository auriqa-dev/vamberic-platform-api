import { Router, type IRouter, type Request, type Response } from "express";
import { RootReadinessCheckResponse } from "@workspace/api-zod";
import type { AppConfig } from "../config";
import type { MongoService } from "../services/mongo";

export function createReadinessRouter(
  config: AppConfig,
  mongo: MongoService,
): IRouter {
  const router: IRouter = Router();

  const readinessHandler = async (_req: Request, res: Response) => {
    let isMongoAvailable = false;

    try {
      isMongoAvailable = await mongo.isAvailable();
    } catch {
      isMongoAvailable = false;
    }

    const data = RootReadinessCheckResponse.parse({
      status: isMongoAvailable ? "ready" : "unavailable",
      serviceName: config.serviceName,
      environment: config.deploymentEnvironment,
      dependencies: {
        mongodb: isMongoAvailable ? "available" : "unavailable",
      },
      timestamp: new Date().toISOString(),
    });

    res.status(isMongoAvailable ? 200 : 503).json(data);
  };

  router.get("/ready", readinessHandler);
  router.get("/api/v1/ready", readinessHandler);

  return router;
}