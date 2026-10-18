import { Router, type ErrorRequestHandler } from "express";
import { z, ZodError } from "zod";
import type { AppConfig } from "../config";
import type { MongoService } from "../services/mongo";
import { createCommunications } from "../services/communications/service";
import { AuthorizationDenied } from "../authorization/policy";
import { HiveConflict } from "../services/hive-definitions";
import { MailboxError } from "../services/mailbox/google";
import { createEmailTemplates } from "../services/email-templates/service";
export function createCommunicationsRouter(
  config: AppConfig,
  mongo: MongoService,
) {
  const router = Router(),
    app = createCommunications(config, mongo),
    root = "/workspaces/:workspaceId/communications";
  const templates = createEmailTemplates(config, mongo);
  router.get(root + "/templates", async (req, res) =>
    res.json(
      await templates.list(
        req.auth!,
        String(req.params.workspaceId),
        String(req.query.brandId),
      ),
    ),
  );
  router.post(root + "/templates", async (req, res) =>
    res.json(
      await templates.mutate(
        req.auth!,
        String(req.params.workspaceId),
        req.body,
      ),
    ),
  );
  router.post(root + "/templates/sample", async (req, res) =>
    res.json(
      await templates.sample(
        req.auth!,
        String(req.params.workspaceId),
        req.body,
      ),
    ),
  );
  router.post(root + "/preview", async (req, res) =>
    res.json(
      await templates.preview(
        req.auth!,
        String(req.params.workspaceId),
        req.body,
      ),
    ),
  );
  router.get(root + "/measurement", async (req, res) =>
    res.json(
      await app.measurement(
        req.auth!,
        String(req.params.workspaceId),
        z
          .object({
            campaignId: z.string().max(100).optional(),
            contactId: z.string().max(100).optional(),
            organisationId: z.string().max(100).optional(),
            communicationId: z.string().max(100).optional(),
            since: z.string().datetime().optional(),
          })
          .strict()
          .parse(req.query),
      ),
    ),
  );
  router.get(root, async (req, res) =>
    res.json(await app.list(req.auth!, String(req.params.workspaceId))),
  );
  router.post(root, async (req, res) =>
    res.json(
      await app.create(req.auth!, String(req.params.workspaceId), req.body),
    ),
  );
  router.post(root + "/sync", async (req, res) =>
    res.json(await app.sync(req.auth!, String(req.params.workspaceId))),
  );
  router.post(root + "/replies/:id", async (req, res) =>
    res.json(
      await app.review(
        req.auth!,
        String(req.params.workspaceId),
        String(req.params.id),
        req.body,
      ),
    ),
  );
  router.post(root + "/:id", async (req, res) =>
    res.json(
      await app.mutate(
        req.auth!,
        String(req.params.workspaceId),
        String(req.params.id),
        req.body,
      ),
    ),
  );
  const errors: ErrorRequestHandler = (e, req, res, next) => {
    if (!req.path.includes("/communications") || res.headersSent)
      return next(e);
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
          code: "COMMUNICATIONS_UNAVAILABLE",
          message:
            e instanceof HiveConflict || e instanceof MailboxError
              ? e.message
              : e instanceof ZodError
                ? "Check the required communication fields."
                : "Could not complete the request. Refresh the saved status before retrying.",
        },
      });
  };
  router.use(errors);
  return router;
}
