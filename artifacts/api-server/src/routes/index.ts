import { Router, type IRouter } from "express";
import { createHealthRouter } from "./health";
import { createReadinessRouter } from "./readiness";
import { createDashboardRouter } from "./dashboard";
import { createCrmDeleteRouter } from "./crm-delete";
import { createCrmRouter } from "./crm";
import { createProductsRouter } from "./products";
import type { AppConfig } from "../config";
import type { MongoService } from "../services/mongo";

export function createRouter(config: AppConfig, mongo: MongoService): IRouter {
  const router: IRouter = Router();

  router.use(createHealthRouter(config));
  router.use(createReadinessRouter(config, mongo));
  router.use(createDashboardRouter(mongo));
  router.use(createProductsRouter(mongo));
  router.use(createCrmRouter(mongo));
  router.use(createCrmDeleteRouter(mongo));

  return router;
}
