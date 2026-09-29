import { Router, type ErrorRequestHandler } from "express";
import { z, ZodError } from "zod";
import type { AppConfig } from "../config";
import type { MongoService } from "../services/mongo";
import { AuthorizationDenied } from "../authorization/policy";
import {
  HiveConflict,
  HIVE_OPERATIONS,
  mutateHiveDefinition,
  readHiveDefinitions,
} from "../services/hive-definitions";
import type { HiveKind } from "../domain/hive-definitions";
/** Mounted within the authenticated, human-only HVM router after its bounded JSON parser. */
export function createHiveDefinitionsRouter(
  config: AppConfig,
  mongo: MongoService,
) {
  const router = Router();
  const paths: Record<string, HiveKind> = {
    offerings: "offerings",
    "ideal-customer-profiles": "ideal_customer_profiles",
    "buyer-profiles": "buyer_profiles",
  };
  for (const [path, kind] of Object.entries(paths)) {
    const root = `/workspaces/:workspaceId/${path}`;
    router.get(root, async (req, res) => {
      res.json(
        await readHiveDefinitions(
          mongo,
          config,
          req.auth!,
          z.string().parse(req.params.workspaceId),
          kind,
          req.query,
        ),
      );
    });
    router.get(root + "/:id", async (req, res) => {
      res.json(
        await readHiveDefinitions(
          mongo,
          config,
          req.auth!,
          z.string().parse(req.params.workspaceId),
          kind,
          req.query,
          z.string().parse(req.params.id),
        ),
      );
    });
    router.get(root + "/:id/revisions/:revision", async (req, res) => {
      res.json(
        await readHiveDefinitions(
          mongo,
          config,
          req.auth!,
          z.string().parse(req.params.workspaceId),
          kind,
          req.query,
          z.string().parse(req.params.id),
          z.coerce.number().int().positive().parse(req.params.revision),
        ),
      );
    });
    for (const op of HIVE_OPERATIONS)
      router.post(root + "/" + op, async (req, res) => {
        res
          .status(op === "create" ? 201 : 200)
          .json(
            await mutateHiveDefinition(
              mongo,
              config,
              req.auth!,
              z.string().parse(req.params.workspaceId),
              kind,
              op,
              req.body,
            ),
          );
      });
  }
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    void _next;
    const status =
      error instanceof AuthorizationDenied
        ? 404
        : error instanceof ZodError
          ? 400
          : error instanceof HiveConflict || error?.code === 11000
            ? 409
            : 503;
    res.status(status).json({
      error: {
        code:
          status === 404
            ? "NOT_FOUND"
            : status === 400
              ? "INVALID_INPUT"
              : status === 409
                ? "CONFLICT"
                : "HVM_UNAVAILABLE",
        message:
          status === 404
            ? "Resource not found"
            : status === 400
              ? "Invalid request"
              : status === 409
                ? "Record changed or conflicts; reload"
                : "HVM temporarily unavailable",
      },
    });
  };
  router.use(errors);
  return router;
}
