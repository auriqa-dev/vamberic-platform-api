import { Router, type IRouter } from "express";
import { z } from "zod";
import {
  DeletePersonBody,
  DeletePersonResponse,
  GetPersonDeletePreviewResponse,
} from "@workspace/api-zod";
import { platformIdSchema } from "../domain";
import {
  auditDelete,
  CrmDeleteError,
  hardDeleteCrm,
  previewCrmDelete,
} from "../services/crm-delete";
import type { MongoService } from "../services/mongo";

export function createCrmDeleteRouter(mongo: MongoService): IRouter {
  const router: IRouter = Router();
  for (const [path, kind, prefix] of [
    ["people", "person", "person"],
    ["organisations", "organisation", "org"],
    ["opportunities", "opportunity", "opportunity"],
  ] as const) {
    for (const preview of [true, false]) {
      router[preview ? "get" : "delete"](
        `/api/v1/${path}/:id${preview ? "/delete-preview" : ""}`,
        async (req, res) => {
          res.setHeader("Cache-Control", "no-store");
          if (!req.auth) {
            res.status(401).json({ error: "Unauthorized" });
            return;
          }
          const params = z
            .object({ id: platformIdSchema(prefix) })
            .safeParse(req.params);
          if (!params.success) {
            res.status(400).json({
              error: { code: "INVALID_ID", message: "Invalid record ID." },
            });
            return;
          }
          try {
            if (preview) {
              res.json(
                GetPersonDeletePreviewResponse.parse(
                  await previewCrmDelete(mongo, kind, params.data.id),
                ),
              );
              return;
            }
            const input = DeletePersonBody.strict().safeParse(req.body);
            if (!input.success) {
              auditDelete(
                req.auth.subject,
                kind,
                params.data.id,
                "CONFIRMATION_REQUIRED",
              );
              throw new CrmDeleteError(
                400,
                "CONFIRMATION_REQUIRED",
                'Exact confirmation "DELETE" and the current preview token are required.',
              );
            }
            res.json(
              DeletePersonResponse.parse(
                await hardDeleteCrm(
                  mongo,
                  kind,
                  params.data.id,
                  input.data.previewToken,
                  req.auth.subject,
                ),
              ),
            );
          } catch (error) {
            const safe =
              error instanceof CrmDeleteError
                ? error
                : new CrmDeleteError(
                    503,
                    "DELETE_UNAVAILABLE",
                    "Deletion preview is temporarily unavailable.",
                  );
            res.status(safe.status).json({
              error: { code: safe.code, message: safe.message },
              ...(safe.blockedBy.length ? { blockedBy: safe.blockedBy } : {}),
            });
          }
        },
      );
    }
  }
  return router;
}
