import { createProfileDeletion } from "../services/psu/deletion";
import { Router, type ErrorRequestHandler } from "express";
import { z } from "zod";
import type { AppConfig } from "../config";
import type { MongoService } from "../services/mongo";
import type { PsuGenerator } from "../services/psu/generate";
import { createPsuApplication } from "../services/psu/application";
import { AuthorizationDenied } from "../authorization/policy";
import { HiveConflict } from "../services/hive-definitions";
export function createPsuRouter(
  config: AppConfig,
  mongo: MongoService,
  generator?: PsuGenerator,
) {
  const router = Router(),
    psu = createPsuApplication(config, mongo, generator),
    root = "/workspaces/:workspaceId/psu";
  const removeProfile = createProfileDeletion(config, mongo);
  router.post(root + "/deletion-preview", async (req, res) =>
    res.json(
      await removeProfile(req.auth!, String(req.params.workspaceId), req.body),
    ),
  );
  router.post(root + "/delete", async (req, res) =>
    res.json(
      await removeProfile(
        req.auth!,
        String(req.params.workspaceId),
        req.body,
        true,
      ),
    ),
  );
  router.get(root, async (req, res) => {
    res.json(
      await psu.list(req.auth!, z.string().parse(req.params.workspaceId)),
    );
  });
  router.get(root + "/reference-data", async (req, res) => {
    res.json(
      await psu.referenceData(req.auth!, String(req.params.workspaceId)),
    );
  });
  router.get(root + "/company/:brandId", async (req, res) =>
    res.json(
      await psu.company(
        req.auth!,
        String(req.params.workspaceId),
        String(req.params.brandId),
      ),
    ),
  );
  router.post(root + "/company/:brandId/save", async (req, res) =>
    res.json(
      await psu.saveCompany(
        req.auth!,
        String(req.params.workspaceId),
        String(req.params.brandId),
        req.body,
      ),
    ),
  );
  router.post(root + "/company/:brandId/approve", async (req, res) =>
    res.json(
      await psu.approveCompany(
        req.auth!,
        String(req.params.workspaceId),
        String(req.params.brandId),
        req.body,
      ),
    ),
  );
  router.post(root + "/company/:brandId/primary", async (req, res) =>
    res.json(
      await psu.primaryProduct(
        req.auth!,
        String(req.params.workspaceId),
        String(req.params.brandId),
        req.body,
      ),
    ),
  );
  router.post(root + "/products", async (req, res) =>
    res
      .status(201)
      .json(
        await psu.createProduct(
          req.auth!,
          String(req.params.workspaceId),
          req.body,
        ),
      ),
  );
  router.get(root + "/:id", async (req, res) => {
    res.json(
      await psu.read(
        req.auth!,
        z.string().parse(req.params.workspaceId),
        z.string().parse(req.params.id),
      ),
    );
  });
  router.post(root, async (req, res) => {
    res
      .status(202)
      .json(
        await psu.start(
          req.auth!,
          z.string().parse(req.params.workspaceId),
          req.body,
        ),
      );
  });
  router.post(root + "/:id/save", async (req, res) => {
    res.json(
      await psu.save(
        req.auth!,
        z.string().parse(req.params.workspaceId),
        z.string().parse(req.params.id),
        req.body,
      ),
    );
  });
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    void _next;
    const status =
      error instanceof AuthorizationDenied
        ? 404
        : error instanceof HiveConflict
          ? 409
          : error?.name === "ZodError"
            ? 400
            : 503;
    res.status(status).json({
      error: {
        code:
          status === 404
            ? "NOT_FOUND"
            : status === 409
              ? "CONFLICT"
              : status === 400
                ? "INVALID_INPUT"
                : "HVM_UNAVAILABLE",
        message:
          _req.path.endsWith("/delete") ||
          _req.path.endsWith("/deletion-preview")
            ? "Deletion could not be confirmed. Refresh the page and review the deletion preview again. Your workspace and Brand Kit are protected."
            : status === 404
              ? "Resource not found"
              : status === 409
                ? "This draft or its brand has changed. Reload before continuing."
                : status === 400
                  ? "Check the product details and public page URLs."
                  : "Draft generation is temporarily unavailable. Your saved products are unchanged.",
      },
    });
  };
  router.use(errors);
  return router;
}
