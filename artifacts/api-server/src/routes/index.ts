import { Router, type IRouter } from "express";
import { createHealthRouter } from "./health";
import type { AppConfig } from "../config";

export function createRouter(config: AppConfig): IRouter {
  const router: IRouter = Router();

  router.use(createHealthRouter(config));

  return router;
}
