import { logger } from "../lib/logger";
import { Router, type ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import type { AppConfig } from "../config";
import type { MongoService } from "../services/mongo";
import { createLushaConnection } from "../services/lusha/connection";
import { LushaFailure } from "../services/lusha/provider";
import { HiveConflict } from "../services/hive-definitions";
import { AuthorizationDenied } from "../authorization/policy";
export function createLushaRouter(config: AppConfig, mongo: MongoService) {
  const router = Router(),
    app = createLushaConnection(config, mongo),
    root = "/workspaces/:workspaceId/lusha";
  router.use(root, (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  router.get(root, async (req, res) =>
    res.json(await app.read(req.auth!, String(req.params.workspaceId))),
  );
  router.post(root + "/connect", async (req, res) =>
    res.json(
      await app.connect(req.auth!, String(req.params.workspaceId), req.body),
    ),
  );
  router.post(root + "/update", async (req, res) =>
    res.json(
      await app.update(req.auth!, String(req.params.workspaceId), req.body),
    ),
  );
  router.post(root + "/test", async (req, res) =>
    res.json(await app.test(req.auth!, String(req.params.workspaceId))),
  );
  const errors: ErrorRequestHandler = (e, _req, res, next) => {
    if (res.headersSent) return next(e);
    const messages: Record<string, string> = {
      invalid_credentials:
        "Lusha rejected this API key. Check the key in your Lusha account and try again.",
      not_permitted:
        "Your Lusha account does not permit this API operation. Check your account’s API access.",
      no_credits:
        "Lusha reports no available credits. Check your account balance.",
      rate_limited:
        "Lusha is temporarily limiting requests. Wait a moment and try again.",
      outcome_unknown:
        "HVM could not confirm the response from Lusha. Try again shortly.",
      invalid_response:
        "Lusha returned an unexpected account response. The connection could not be confirmed.",
    };
    const databaseFailure = e?.code === 121 || e?.code === 11000;
    logger.warn(
      {
        requestId: _req.id,
        category:
          e instanceof LushaFailure
            ? e.code
            : e instanceof ZodError
              ? "validation"
              : e instanceof HiveConflict
                ? "conflict"
                : e instanceof AuthorizationDenied
                  ? "denied"
                  : databaseFailure
                    ? "persistence"
                    : "internal",
      },
      "Lusha connection request failed",
    );
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
          code:
            e instanceof LushaFailure
              ? e.code
              : e instanceof HiveConflict
                ? "LUSHA_CONFLICT"
                : "LUSHA_UNAVAILABLE",
          message:
            e instanceof HiveConflict
              ? e.message
              : e instanceof LushaFailure
                ? messages[e.code]
                : "HVM could not save or check the Lusha connection. Refresh the connection status before trying again. If this continues, contact support.",
        },
      });
  };
  router.use(errors);
  return router;
}
