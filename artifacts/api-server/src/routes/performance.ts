import { Router, type ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { logger } from "../lib/logger";
import type { AppConfig } from "../config";
import type { MongoService } from "../services/mongo";
import { createPerformanceService } from "../services/performance/service";
import { AuthorizationDenied } from "../authorization/policy";
import { HiveConflict } from "../services/hive-definitions";
import { Ga4Error } from "../services/ga4/google";
export function createPerformanceRouter(
  config: AppConfig,
  mongo: MongoService,
) {
  const router = Router(),
    app = createPerformanceService(config, mongo),
    root = "/workspaces/:workspaceId/performance";
  router.get(root, async (req, res) => {
    res.json(await app.state(req.auth!, String(req.params.workspaceId)));
  });
  for (const [path, action] of Object.entries({
    report: app.report,
    baseline: app.saveBaseline,
    attribution: app.saveAttribution,
  }))
    router.post(`${root}/${path}`, async (req, res) => {
      res.json(
        await action(req.auth!, String(req.params.workspaceId), req.body),
      );
    });
  const errors: ErrorRequestHandler = (e, req, res, next) => {
    if (!/\/performance(?:\/|$)/.test(req.path) || res.headersSent)
      return next(e);
    if (e instanceof ZodError)
      logger.warn({ issues: e.issues.map((issue) => ({ code: issue.code, path: issue.path })) }, "Performance validation failed");
    res
      .status(
        e instanceof AuthorizationDenied
          ? 404
          : e instanceof ZodError
            ? 400
            : e instanceof HiveConflict
              ? 409
              : 503,
      )
      .json({
        error: {
          code: "PERFORMANCE",
          message:
            e instanceof HiveConflict || e instanceof Ga4Error
              ? e.message
              : e instanceof ZodError
                ? "Check the date range and report details."
                : "Performance data could not be loaded. Retry; missing data is not zero.",
        },
      });
  };
  router.use(errors);
  return router;
}
