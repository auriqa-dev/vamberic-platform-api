import { Router, type IRouter, type Request, type Response } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import type { AppConfig } from "../config";

export function createHealthRouter(config: AppConfig): IRouter {
  const router: IRouter = Router();

  const healthHandler = (_req: Request, res: Response) => {
    const data = HealthCheckResponse.parse({
      status: "ok",
      serviceName: config.serviceName,
      environment: config.environment,
      version: config.version,
      timestamp: new Date().toISOString(),
    });

    res.status(200).json(data);
  };

  router.get("/health", healthHandler);
  router.get("/api/v1/health", healthHandler);
  // Kept for the existing artifact startup probe while the public contract moves to /api/v1.
  router.get("/api/healthz", healthHandler);

  return router;
}