import { readOrganisationDossier } from "../services/research/organisation-dossier";
import { contactContextAccess } from "../services/contact-context";
import { logger } from "../lib/logger";
import { createContactContext } from "../services/contact-context";
import { createConsumerFacts } from "../services/icp/consumer-facts";
import { Router, type ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import type { AppConfig } from "../config";
import type { MongoService } from "../services/mongo";
import { AuthorizationDenied } from "../authorization/policy";
import { HiveConflict } from "../services/hive-definitions";
import {
  createContactManagement,
  kindSchema,
  ContactConflict,
} from "../services/contact-management";
export function createContactManagementRouter(
  config: AppConfig,
  mongo: MongoService,
) {
  const r = Router(),
    app = createContactManagement(config, mongo),
    root = "/workspaces/:workspaceId/records/:kind";
  r.use("/workspaces/:workspaceId/records", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  const context = createContactContext(config, mongo);
  r.get("/workspaces/:workspaceId/organisations/:id/dossier",async(req,res)=>{
    const w=String(req.params.workspaceId),db=await mongo.database();
    await contactContextAccess(db,config,req.auth!,w,"read");
    res.json(await readOrganisationDossier(db,w,String(req.params.id)));
  });
  r.get("/workspaces/:workspaceId/email-history/unlinked", async (req, res) =>
    res.json(
      await context.unlinked(
        req.auth!,
        String(req.params.workspaceId),
        req.query,
      ),
    ),
  );
  r.post(
    "/workspaces/:workspaceId/email-history/:eventId/link",
    async (req, res) =>
      res.json(
        await context.link(
          req.auth!,
          String(req.params.workspaceId),
          String(req.params.eventId),
          req.body,
        ),
      ),
  );
  r.get(root + "/:id/context", async (req, res) =>
    res.json(
      await context.read(
        req.auth!,
        String(req.params.workspaceId),
        String(req.params.id),
      ),
    ),
  );
  r.post(root + "/:id/context", async (req, res) =>
    res.json(
      await context.save(
        req.auth!,
        String(req.params.workspaceId),
        String(req.params.id),
        req.body,
      ),
    ),
  );
  const consumer = createConsumerFacts(config, mongo);
  r.get(
    "/workspaces/:workspaceId/records/contacts/:id/consumer-facts",
    async (req, res) =>
      res.json(
        await consumer.read(
          req.auth!,
          String(req.params.workspaceId),
          String(req.params.id),
        ),
      ),
  );
  r.post(
    "/workspaces/:workspaceId/records/contacts/:id/consumer-facts",
    async (req, res) =>
      res.json(
        await consumer.save(
          req.auth!,
          String(req.params.workspaceId),
          String(req.params.id),
          req.body,
        ),
      ),
  );
  r.get(root, async (req, res) =>
    res.json(
      await app.list(
        req.auth!,
        String(req.params.workspaceId),
        kindSchema.parse(req.params.kind),
        req.query,
      ),
    ),
  );
  r.get(root + "/:id", async (req, res) =>
    res.json(
      await app.read(
        req.auth!,
        String(req.params.workspaceId),
        kindSchema.parse(req.params.kind),
        String(req.params.id),
      ),
    ),
  );
  r.post(root + "/create", async (req, res) =>
    res
      .status(201)
      .json(
        await app.write(
          req.auth!,
          String(req.params.workspaceId),
          kindSchema.parse(req.params.kind),
          undefined,
          req.body,
        ),
      ),
  );
  for (const action of ["save", "archive", "restore"] as const)
    r.post(root + "/:id/" + action, async (req, res) =>
      res.json(
        await app.write(
          req.auth!,
          String(req.params.workspaceId),
          kindSchema.parse(req.params.kind),
          String(req.params.id),
          req.body,
          action,
        ),
      ),
    );
  const errors: ErrorRequestHandler = (e, _req, res, _next) => {
    void _next;
    const status =
      e instanceof AuthorizationDenied
        ? 404
        : e instanceof ZodError
          ? 400
          : e instanceof ContactConflict || e instanceof HiveConflict
            ? 409
            : 503;
    if (status === 503) logger.error({
      operation: "contact-management",
      method: _req.method,
      errorType: e instanceof Error ? e.name : "UnknownError",
      databaseCode: typeof e?.code === "number" ? e.code : undefined,
    }, "Contact record request failed");
    res.status(status).json({
      error: {
        message:
          status === 409
            ? e.message
            : status === 400
              ? "Check the highlighted fields."
              : "Unable to access this record.",
        ...(e instanceof ZodError ? { fields: e.flatten().fieldErrors } : {}),
      },
    });
  };
  r.use(errors);
  return r;
}
