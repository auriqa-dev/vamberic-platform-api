import type { NbaExecution } from "../services/nba/native";
import { Router, type ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import type { AppConfig } from "../config";
import type { MongoService } from "../services/mongo";
import { createNbaService } from "../services/nba/service";
import { contentGeneratorFromEnvironment } from "../services/content-strategy/generate";
import { AuthorizationDenied } from "../authorization/policy";
import { HiveConflict } from "../services/hive-definitions";
export function createNbaRouter(config: AppConfig, mongo: MongoService, execution?: NbaExecution) {
  const router = Router(),
    service = createNbaService(
      config,
      mongo,
      contentGeneratorFromEnvironment(),
      execution,
    ),
    root = "/workspaces/:workspaceId/nba";
  router.get(root, async (req, res) =>
    res.json(await service.list(req.auth!, String(req.params.workspaceId))),
  );
  router.post(root, async (req, res) =>
    res.json(
      await service.preview(
        req.auth!,
        String(req.params.workspaceId),
        req.body,
      ),
    ),
  );
  router.get(root + "/:id/history", async (req, res) =>
    res.json(
      await service.history(
        req.auth!,
        String(req.params.workspaceId),
        String(req.params.id),
      ),
    ),
  );
  router.post(root + "/:id", async (req, res) =>
    res.json(
      await service.change(
        req.auth!,
        String(req.params.workspaceId),
        String(req.params.id),
        req.body,
      ),
    ),
  );
  const errors: ErrorRequestHandler = (e, _req, res, next) => {
    if (res.headersSent) {
      next(e);
      return;
    }
    res
      .status(
        e instanceof AuthorizationDenied
          ? 404
          : e instanceof HiveConflict
            ? 409
            : e instanceof ZodError
              ? 400
              : 503,
      )
      .json({
        error: {
          code: "NBA_REQUEST_FAILED",
          message:
            e instanceof HiveConflict
              ? e.message
              : e instanceof ZodError
                ? "Check the decision fields and try again."
                : "NBA could not complete this request. Saved decisions are retained.",
        },
      });
  };
  router.use(errors);
  return router;
}
