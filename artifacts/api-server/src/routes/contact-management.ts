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
