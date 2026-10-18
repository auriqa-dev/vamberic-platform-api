import { strategyInterpreterFromEnvironment } from "../services/contact-strategy/interpret";
import { Router, type ErrorRequestHandler } from "express";
import { z, ZodError } from "zod";
import type { AppConfig } from "../config";
import type { MongoService } from "../services/mongo";
import { createContactStrategies } from "../services/contact-strategy/application";
import { AuthorizationDenied } from "../authorization/policy";
import { HiveConflict } from "../services/hive-definitions";
export function createContactStrategyRouter(
  config: AppConfig,
  mongo: MongoService,
) {
  const router = Router(),
    service = createContactStrategies(
      config,
      mongo,
      strategyInterpreterFromEnvironment(),
    ),
    root = "/workspaces/:workspaceId/contact-strategies";
  router.get(root, async (req, res) =>
    res.json(
      await service.list(req.auth!, z.string().parse(req.params.workspaceId)),
    ),
  );
  router.post(root + "/interpret", async (req, res) =>
    res.json(
      await service.propose(
        req.auth!,
        z.string().parse(req.params.workspaceId),
        req.body,
      ),
    ),
  );
  router.post(root, async (req, res) =>
    res.json(
      await service.mutate(
        req.auth!,
        z.string().parse(req.params.workspaceId),
        req.body,
      ),
    ),
  );
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    void _next;
    const status =
      error instanceof AuthorizationDenied
        ? 404
        : error instanceof ZodError
          ? 400
          : error instanceof HiveConflict
            ? 409
            : 503;
    res.status(status).json({
      error: {
        code: status === 409 ? "CONFLICT" : "STRATEGY_UNAVAILABLE",
        message:
          status === 409
            ? error.message
            : "Unable to complete the strategy action. Your saved strategies are unchanged.",
      },
    });
  };
  router.use(errors);
  return router;
}
