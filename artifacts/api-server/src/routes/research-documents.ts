import { Router, raw, json, type ErrorRequestHandler } from "express";
import { z, ZodError } from "zod";
import type { AppConfig } from "../config";
import type { MongoService } from "../services/mongo";
import { AuthorizationDenied } from "../authorization/policy";
import { HiveConflict } from "../services/hive-definitions";
import {
  createResearchDocuments,
  createResearchStore,
  MAX_RESEARCH_BYTES,
} from "../services/research/documents";
export function createResearchDocumentsRouter(
  config: AppConfig,
  mongo: MongoService,
) {
  const router = Router();
  const store = config.brandImages
    ? createResearchStore(config.brandImages.bucket, config.brandImages.region)
    : undefined;
  const documents = createResearchDocuments(config, mongo, store);
  const root = "/workspaces/:workspaceId/research-documents";
  router.post(
    root + "/:id/file",
    async (req, _res, next) => {
      await documents.authoriseUpload(
        req.auth!,
        z.string().parse(req.params.workspaceId),
        z.string().parse(req.params.id),
      );
      next();
    },
    raw({
      type: "application/octet-stream",
      limit: MAX_RESEARCH_BYTES,
      inflate: false,
    }),
    async (req, res) => {
      res.json(
        await documents.upload(
          req.auth!,
          z.string().parse(req.params.workspaceId),
          z.string().parse(req.params.id),
          req.body,
        ),
      );
    },
  );
  router.get(root + "/:id/file", async (req, res) => {
    const file = await documents.download(
      req.auth!,
      z.string().parse(req.params.workspaceId),
      z.string().parse(req.params.id),
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
    );
    res.type("application/octet-stream").send(file.bytes);
  });
  router.get(root, async (req, res) =>
    res.json(
      await documents.list(req.auth!, z.string().parse(req.params.workspaceId)),
    ),
  );
  router.post(root, json({ limit: "32kb", inflate: false }), async (req, res) =>
    res
      .status(201)
      .json(
        await documents.create(
          req.auth!,
          z.string().parse(req.params.workspaceId),
          req.body,
        ),
      ),
  );
  router.post(
    root + "/update",
    json({ limit: "32kb", inflate: false }),
    async (req, res) =>
      res.json(
        await documents.mutate(
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
        code: status === 409 ? "CONFLICT" : "RESEARCH_UNAVAILABLE",
        message:
          "Unable to complete the document action. Your saved documents are unchanged.",
      },
    });
  };
  router.use(errors);
  return router;
}
