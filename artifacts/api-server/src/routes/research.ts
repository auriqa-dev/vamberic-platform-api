import {
  createResearchCandidates,
  ResearchActionConflict,
} from "../services/research/candidates";
import { Router, type ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import type { AppConfig } from "../config";
import type { MongoService } from "../services/mongo";
import { createResearchService } from "../services/research/service";
import { contentGeneratorFromEnvironment } from "../services/content-strategy/generate";
import { AuthorizationDenied } from "../authorization/policy";
import { HiveConflict } from "../services/hive-definitions";
export function createResearchRouter(config: AppConfig, mongo: MongoService) {
  const router = Router(),
    app = createResearchService(
      config,
      mongo,
      contentGeneratorFromEnvironment(),
    );
  const root = "/workspaces/:workspaceId/research";
  const candidates = createResearchCandidates(config, mongo);
  router.post(root + "/candidates/:id/people", async (req, res) => {
    const w = String(req.params.workspaceId);
    const request = await candidates.peopleRequest(
      req.auth!,
      w,
      String(req.params.id),
    );
    const job = await app.start(req.auth!, w, request);
    res.status(202).json(job);
    void app.run(req.auth!, w, job.id).catch(() => {});
  });
  router.post(root + "/candidates/:id/supplement", async (req, res) =>
    res.json(
      await candidates.supplement(
        req.auth!,
        String(req.params.workspaceId),
        String(req.params.id),
      ),
    ),
  );
  router.get(root + "/candidates/:id/dossier", async (req, res) =>
    res.json(
      await candidates.dossier(
        req.auth!,
        String(req.params.workspaceId),
        String(req.params.id),
      ),
    ),
  );
  router.post(root + "/candidates/:id/review", async (req, res) =>
    res.json(
      await candidates.review(
        req.auth!,
        String(req.params.workspaceId),
        String(req.params.id),
        req.body,
      ),
    ),
  );
  router.post(root + "/candidates/:id/enrich", async (req, res) =>
    res.json(
      await candidates.enrich(
        req.auth!,
        String(req.params.workspaceId),
        String(req.params.id),
      ),
    ),
  );
  router.post(root + "/candidates/:id/promote", async (req, res) =>
    res.json(
      await candidates.promote(
        req.auth!,
        String(req.params.workspaceId),
        String(req.params.id),
      ),
    ),
  );

  router.get(root, async (req, res) =>
    res.json(await app.list(req.auth!, String(req.params.workspaceId))),
  );
  router.post(root, async (req, res) => {
    const w = String(req.params.workspaceId);
    const job = await app.start(req.auth!, w, req.body);
    res.status(202).json(job);
    void app.run(req.auth!, w, job.id).catch(() => {});
  });
  router.post(root + "/policies", async (req, res) =>
    res.json(
      await app.policy(req.auth!, String(req.params.workspaceId), req.body),
    ),
  );
  router.post(root + "/findings/:id", async (req, res) =>
    res.json(
      await app.review(
        req.auth!,
        String(req.params.workspaceId),
        String(req.params.id),
        req.body,
      ),
    ),
  );
  router.post(root + "/policies/:id/remove", async (req, res) =>
    res.json(
      await app.removePolicy(
        req.auth!,
        String(req.params.workspaceId),
        String(req.params.id),
        req.body,
      ),
    ),
  );
  router.get(root + "/evidence/:type/:id", async (req, res) =>
    res.json(
      await app.evidenceFor(
        req.auth!,
        String(req.params.workspaceId),
        String(req.params.type),
        String(req.params.id),
      ),
    ),
  );
  router.get(root + "/:id", async (req, res) =>
    res.json(
      await app.read(
        req.auth!,
        String(req.params.workspaceId),
        String(req.params.id),
      ),
    ),
  );
  router.post(root + "/:id/update", async (req, res) => {
    const w = String(req.params.workspaceId);
    const result = await app.mutate(
      req.auth!,
      w,
      String(req.params.id),
      req.body,
    );
    res.json(result);
    if (req.body.action === "retry")
      void app.run(req.auth!, w, result.id).catch(() => {});
  });
  router.post(root + "/:id/continue", async (req, res) => {
    const w = String(req.params.workspaceId),
      id = String(req.params.id);
    const result = await app.resume(req.auth!, w, id);
    res.status(202).json(result);
    void app.run(req.auth!, w, id).catch(() => {});
  });
  const errors: ErrorRequestHandler = (e, _req, res, next) => {
    if (res.headersSent) {
      next(e);
      return;
    }
    res
      .status(
        e instanceof AuthorizationDenied
          ? 404
          : e instanceof HiveConflict
            ? 409
            : e instanceof ZodError
              ? 400
              : 503,
      )
      .json({
        error: {
          code:
            e instanceof ResearchActionConflict
              ? "RESEARCH_ACTION_REVIEW"
              : e instanceof HiveConflict
                ? "CONFLICT"
                : "RESEARCH_UNAVAILABLE",
          message:
            e instanceof ResearchActionConflict
              ? e.message
              : "Research could not complete this request.",
        },
      });
  };
  router.use(errors);
  return router;
}
