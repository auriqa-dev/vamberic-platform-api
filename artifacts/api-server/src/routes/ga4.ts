import { Router, type ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import type { AppConfig } from "../config";
import type { MongoService } from "../services/mongo";
import { createGa4Application } from "../services/ga4/application";
import { Ga4Error } from "../services/ga4/google";
import { AuthorizationDenied } from "../authorization/policy";
import { HiveConflict } from "../services/hive-definitions";
export function createGa4Router(config: AppConfig, mongo: MongoService) {
  const router = Router(),
    app = createGa4Application(config, mongo),
    root = "/workspaces/:workspaceId/ga4";
  router.get(root, async (req, res) => {
    res.json(await app.read(req.auth!, String(req.params.workspaceId)));
  });
  for (const [path, action] of Object.entries({
    connect: app.begin,
    finish: app.finish,
    properties: app.properties,
    select: app.select,
    test: app.test,
    disconnect: app.disconnect,
  })) {
    router.post(`${root}/${path}`, async (req, res) => {
      res.json(
        await action(req.auth!, String(req.params.workspaceId), req.body),
      );
    });
  }
  const errors: ErrorRequestHandler = (e, req, res, next) => {
    if (!/\/ga4(?:\/|$)/.test(req.path) || res.headersSent) return next(e);
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
          code: "GA4_CONNECTION",
          message:
            e instanceof Ga4Error || e instanceof HiveConflict
              ? e.message
              : e instanceof ZodError
                ? "Check the connection request and try again."
                : "The GA4 operation could not be completed. Refresh its saved status before retrying.",
        },
      });
  };
  router.use(errors);
  return router;
}
