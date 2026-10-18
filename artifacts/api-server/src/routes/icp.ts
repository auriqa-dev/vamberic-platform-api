import { logger } from "../lib/logger";
import { marketDiscoveryFromEnvironment } from "../services/icp/discovery";
import { createEligibility } from "../services/icp/eligibility";
import { Router, type ErrorRequestHandler } from "express";
import { z, ZodError } from "zod";
import type { AppConfig } from "../config";
import type { MongoService } from "../services/mongo";
import { AuthorizationDenied } from "../authorization/policy";
import { HiveConflict } from "../services/hive-definitions";
import { createHiveImporter } from "../services/icp/import";
import { createIcpApplication } from "../services/icp/application";
import type { IcpGenerator } from "../services/icp/generate";
export function createIcpRouter(
  config: AppConfig,
  mongo: MongoService,
  generator?: IcpGenerator,
) {
  const router = Router(),
    importer = createHiveImporter(config, mongo),
    app = createIcpApplication(config, mongo, generator);
  const root = "/workspaces/:workspaceId/icp";
  router.get(root + "/setup", async(req,res)=>res.json(await app.readSetup(req.auth!,z.string().parse(req.params.workspaceId),req.query)));
  router.post(root + "/setup", async(req,res)=>res.json(await app.saveSetup(req.auth!,z.string().parse(req.params.workspaceId),req.body)));
  const eligibility = createEligibility(config, mongo, marketDiscoveryFromEnvironment());
  router.get(root + "/eligibility/discovery", async (req, res) => res.json(await eligibility.discoveryLatest(req.auth!, z.string().parse(req.params.workspaceId), z.string().parse(req.query.policyId))));
  router.post(root + "/eligibility/discovery", async (req, res) => res.status(202).json(await eligibility.discoveryStart(req.auth!, z.string().parse(req.params.workspaceId), req.body)));
  router.get(root + "/eligibility/discovery/:id", async (req, res) => res.json(await eligibility.discoveryRead(req.auth!, z.string().parse(req.params.workspaceId), z.string().parse(req.params.id))));
  router.get(root + "/eligibility", async (req, res) =>
    res.json(
      await eligibility.read(
        req.auth!,
        z.string().parse(req.params.workspaceId),
      ),
    ),
  );
  router.post(root + "/eligibility", async (req, res) =>
    res
      .status(201)
      .json(
        await eligibility.save(
          req.auth!,
          z.string().parse(req.params.workspaceId),
          req.body,
        ),
      ),
  );
  router.post(root + "/eligibility/update", async (req, res) =>
    res.json(
      await eligibility.updateDraft(
        req.auth!,
        z.string().parse(req.params.workspaceId),
        req.body,
      ),
    ),
  );
  router.post(root + "/eligibility/delete-drafts", async (req, res) =>
    res.json(
      await eligibility.deleteDrafts(
        req.auth!,
        z.string().parse(req.params.workspaceId),
        req.body,
      ),
    ),
  );
  router.post(root + "/eligibility/approve", async (req, res) =>
    res.json(
      await eligibility.approve(
        req.auth!,
        z.string().parse(req.params.workspaceId),
        req.body,
      ),
    ),
  );
  router.get(root + "/eligibility/identify", async (req, res) =>
    res.json(
      await eligibility.identify(
        req.auth!,
        z.string().parse(req.params.workspaceId),
        req.query,
      ),
    ),
  );

  router.get(root + "/imports/progress/:jobId", async (req, res) =>
    res.json(
      await importer.progress(
        req.auth!,
        z.string().parse(req.params.workspaceId),
        z.string().parse(req.params.jobId),
      ),
    ),
  );
  router.get(root + "/imports/observations", async (req, res) =>
    res.json(
      await importer.observations(
        req.auth!,
        z.string().parse(req.params.workspaceId),
        req.query,
      ),
    ),
  );
  router.post(root + "/imports/preview", async (req, res) =>
    res.json(
      await importer.preview(
        req.auth!,
        z.string().parse(req.params.workspaceId),
        req.body,
      ),
    ),
  );
  router.post(root + "/imports/commit", async (req, res) =>
    res.json(
      await importer.commit(
        req.auth!,
        z.string().parse(req.params.workspaceId),
        req.body,
      ),
    ),
  );
  router.get(root + "/examples", async (req, res) =>
    res.json(
      await app.examples(
        req.auth!,
        z.string().parse(req.params.workspaceId),
        req.query,
      ),
    ),
  );
  router.get(root + "/generations", async (req, res) =>
    res.json(
      await app.latest(
        req.auth!,
        z.string().parse(req.params.workspaceId),
        req.query,
      ),
    ),
  );
  router.post(root + "/generations", async (req, res) =>
    res
      .status(202)
      .json(
        await app.start(
          req.auth!,
          z.string().parse(req.params.workspaceId),
          req.body,
        ),
      ),
  );
  router.post(root + "/generations/:id/save", async (req, res) =>
    res.json(
      await app.save(
        req.auth!,
        z.string().parse(req.params.workspaceId),
        z.string().parse(req.params.id),
        req.body,
      ),
    ),
  );
  router.get(root + "/generations/:id", async (req, res) =>
    res.json(
      await app.read(
        req.auth!,
        z.string().parse(req.params.workspaceId),
        z.string().parse(req.params.id),
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
    if (status === 503 && /\/imports\/(preview|commit)$/.test(_req.path)) {
      // Deliberately omit messages, query values, records and request bodies.
      const allowedNames = ["TypeError", "RangeError", "MongoServerError", "MongoNetworkError", "MongoServerSelectionError"];
      logger.error({
        operation: _req.path.endsWith("/preview") ? "hive_import_preview" : "hive_import_commit",
        errorType: allowedNames.includes(error?.name) ? error.name : "Error",
        databaseCode: Number.isInteger(error?.code) ? error.code : undefined,
        locations: typeof error?.stack === "string"
          ? error.stack.split("\n").slice(1).flatMap((line: string) => {
              const location = line.match(/(?:src|dist)\/[a-zA-Z0-9_./-]+:\d+:\d+/);
              return location ? [location[0]] : [];
            }).slice(0, 5)
          : [],
      }, "Import operation failed");
    }
    res.status(status).json({
      error: {
        code:
          status === 409
            ? "CONFLICT"
            : status === 400
              ? "INVALID_INPUT"
              : status === 404
                ? "NOT_FOUND"
                : "HVM_UNAVAILABLE",
        message:
          status === 409
            ? "The data changed or needs review. Refresh and try again."
            : "Unable to complete this request.",
      },
    });
  };
  router.use(errors);
  return router;
}
