import { Router, type IRouter } from "express";
import { createHealthRouter } from "./health";
import { createReadinessRouter } from "./readiness";
import type { AppConfig } from "../config";
import type { MongoService } from "../services/mongo";

export function createRouter(config: AppConfig, mongo: MongoService): IRouter {
  const router: IRouter = Router();

  router.use(createHealthRouter(config));
  router.use(createReadinessRouter(config, mongo));

  return router;
}
