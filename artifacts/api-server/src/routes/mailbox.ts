import { Router, type ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import type { AppConfig } from "../config";
import type { MongoService } from "../services/mongo";
import { createMailboxApplication } from "../services/mailbox/application";
import { MailboxError } from "../services/mailbox/google";
import { AuthorizationDenied } from "../authorization/policy";
import { HiveConflict } from "../services/hive-definitions";
export function createMailboxRouter(config: AppConfig, mongo: MongoService) {
  const router = Router(),
    app = createMailboxApplication(config, mongo),
    root = "/workspaces/:workspaceId/mailbox";
  router.get(root, async (req, res) =>
    res.json(await app.read(req.auth!, String(req.params.workspaceId))),
  );
  router.post(root + "/connect", async (req, res) =>
    res.json(await app.begin(req.auth!, String(req.params.workspaceId))),
  );
  router.post(root + "/finish", async (req, res) =>
    res.json(
      await app.finish(req.auth!, String(req.params.workspaceId), req.body),
    ),
  );
  router.post(root + "/test", async (req, res) =>
    res.json(
      await app.testConnection(req.auth!, String(req.params.workspaceId)),
    ),
  );
  router.post(root + "/send-test", async (req, res) =>
    res.json(
      await app.sendTest(req.auth!, String(req.params.workspaceId), req.body),
    ),
  );
  router.post(root + "/replies", async (req, res) =>
    res.json(await app.sync(req.auth!, String(req.params.workspaceId))),
  );
  router.post(root + "/disconnect", async (req, res) =>
    res.json(
      await app.disconnect(req.auth!, String(req.params.workspaceId), req.body),
    ),
  );
  const errors: ErrorRequestHandler = (e, req, res, next) => {
    if (!req.path.includes("/mailbox") || res.headersSent) return next(e);
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
          code: e instanceof MailboxError ? e.code : "MAILBOX_UNAVAILABLE",
          message:
            e instanceof MailboxError || e instanceof HiveConflict
              ? e.message
              : e instanceof ZodError
                ? "Check the mailbox request and try again."
                : "The mailbox operation could not be completed. Refresh to check its saved status before trying again.",
        },
      });
  };
  router.use(errors);
  return router;
}
