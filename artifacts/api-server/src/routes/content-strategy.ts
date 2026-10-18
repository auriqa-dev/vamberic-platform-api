import { createEmailContent } from "../services/email-content/service";
import { createLibrary } from "../services/content-strategy/library";
import { createWorkspaceHenry } from "../services/content-strategy/workspace-henry";
import { initialiseContentTypes } from "../services/content-strategy/catalogue";
import { contentAccess } from "../services/content-strategy/application";
import { discoverWebsite } from "../services/content-strategy/discovery";
import { Router, type ErrorRequestHandler } from "express";
import { z, ZodError } from "zod";
import type { AppConfig } from "../config";
import type { MongoService } from "../services/mongo";
import { createContentStrategy } from "../services/content-strategy/application";
import { contentGeneratorFromEnvironment } from "../services/content-strategy/generate";
import { AuthorizationDenied } from "../authorization/policy";
import { HiveConflict } from "../services/hive-definitions";
export function createContentStrategyRouter(
  config: AppConfig,
  mongo: MongoService,
) {
  const router = Router(),
    service = createContentStrategy(
      config,
      mongo,
      contentGeneratorFromEnvironment(),
    ),
    root = "/workspaces/:workspaceId/content-strategy";
  const email = createEmailContent(
    config,
    mongo,
    contentGeneratorFromEnvironment(),
  );
  router.get(root + "/email", async (req, res) =>
    res.json(
      await email.list(req.auth!, z.string().parse(req.params.workspaceId)),
    ),
  );
  router.get(root + "/email/candidates", async (req, res) =>
    res.json(
      await email.candidates(
        req.auth!,
        z.string().parse(req.params.workspaceId),
        z.string().parse(req.query.briefId),
      ),
    ),
  );
  router.get(root + "/email/:id/history", async (req, res) =>
    res.json(
      await email.history(
        req.auth!,
        z.string().parse(req.params.workspaceId),
        z.string().parse(req.params.id),
      ),
    ),
  );
  router.post(root + "/email/generate", async (req, res) =>
    res.json(
      await email.generate(
        req.auth!,
        z.string().parse(req.params.workspaceId),
        req.body,
      ),
    ),
  );
  router.post(root + "/email/:id", async (req, res) =>
    res.json(
      await email.mutate(
        req.auth!,
        z.string().parse(req.params.workspaceId),
        z.string().parse(req.params.id),
        req.body,
      ),
    ),
  );
  const library = createLibrary(config, mongo);
  router.post(root + "/library/planning", async (req, res) =>
    res.json(
      await library.manageOffers(
        req.auth!,
        z.string().parse(req.params.workspaceId),
        req.body,
      ),
    ),
  );
  router.get(root + "/library/assets/:id", async (req, res) =>
    res.json(
      await library.asset(
        req.auth!,
        z.string().parse(req.params.workspaceId),
        z.string().parse(req.params.id),
      ),
    ),
  );
  router.get(root + "/library/search", async (req, res) =>
    res.json(
      await library.search(
        req.auth!,
        z.string().parse(req.params.workspaceId),
        z.string().parse(req.query.q),
      ),
    ),
  );
  router.get(root + "/library/planning", async (req, res) =>
    res.json(
      await library.planning(
        req.auth!,
        z.string().parse(req.params.workspaceId),
      ),
    ),
  );
  router.get(root + "/library/discovery", async (req, res) =>
    res.json(
      await library.list(req.auth!, z.string().parse(req.params.workspaceId)),
    ),
  );
  router.get(root + "/library/discovery/:id", async (req, res) =>
    res.json(
      await library.discovery(
        req.auth!,
        z.string().parse(req.params.workspaceId),
        z.string().parse(req.params.id),
      ),
    ),
  );
  router.post(root + "/library/discovery", async (req, res) =>
    res.json(
      await library.start(
        req.auth!,
        z.string().parse(req.params.workspaceId),
        req.body,
      ),
    ),
  );
  router.post(root + "/library/discovery/:id/continue", async (req, res) =>
    res.json(
      await library.step(
        req.auth!,
        z.string().parse(req.params.workspaceId),
        z.string().parse(req.params.id),
      ),
    ),
  );
  router.post(root + "/library/import", async (req, res) =>
    res.json(
      await library.importPage(
        req.auth!,
        z.string().parse(req.params.workspaceId),
        req.body,
      ),
    ),
  );
  const henry = createWorkspaceHenry(
    config,
    mongo,
    contentGeneratorFromEnvironment(),
  );
  router.get("/workspaces/:workspaceId/henry", async (req, res) =>
    res.json(
      await henry.list(
        req.auth!,
        z.string().parse(req.params.workspaceId),
        z
          .string()
          .max(100)
          .parse(req.query.brandId ?? ""),
      ),
    ),
  );
  router.post("/workspaces/:workspaceId/henry", async (req, res) =>
    res.json(
      await henry.ask(
        req.auth!,
        z.string().parse(req.params.workspaceId),
        req.body,
      ),
    ),
  );
  router.post(root + "/website", async (req, res) => {
    const w = z.string().parse(req.params.workspaceId);
    await contentAccess(await mongo.database(), config, req.auth!, w, "update");
    const input = z
      .object({
        url: z.string().url().max(2048),
        mode: z.enum(["discover", "read"]),
      })
      .strict()
      .parse(req.body);
    res.json(await discoverWebsite(input.url, input.mode));
  });
  router.post(root + "/catalogue", async (req, res) => {
    await contentAccess(
      await mongo.database(),
      config,
      req.auth!,
      z.string().parse(req.params.workspaceId),
      "read",
    );
    res.json(await initialiseContentTypes(config, mongo, req.auth!));
  });
  router.get(root, async (req, res) =>
    res.json(
      await service.list(req.auth!, z.string().parse(req.params.workspaceId)),
    ),
  );
  router.get(root + "/:id/export", async (req, res) =>
    res.json(
      await service.exportBrief(
        req.auth!,
        z.string().parse(req.params.workspaceId),
        z.string().parse(req.params.id),
      ),
    ),
  );
  router.get(root + "/:id/history", async (req, res) =>
    res.json(
      await service.history(
        req.auth!,
        z.string().parse(req.params.workspaceId),
        z.string().parse(req.params.id),
      ),
    ),
  );
  router.post(root, async (req, res) =>
    res.json(
      await service.mutate(
        req.auth!,
        z.string().parse(req.params.workspaceId),
        req.body,
      ),
    ),
  );
  router.post(root + "/generate", async (req, res) =>
    res.json(
      await service.propose(
        req.auth!,
        z.string().parse(req.params.workspaceId),
        req.body,
      ),
    ),
  );
  router.post(root + "/handoff", async (req, res) =>
    res.json(
      await service.handoff(
        req.auth!,
        z.string().parse(req.params.workspaceId),
        req.body,
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
          : e instanceof HiveConflict
            ? 409
            : 503;
    res.status(status).json({
      error: {
        code: status === 409 ? "CONFLICT" : "CONTENT_STRATEGY_UNAVAILABLE",
        message:
          status === 409
            ? e.message
            : status === 400
              ? "Check the required fields and source selections."
              : "Content Strategy could not complete this action. Saved records are unchanged.",
      },
    });
  };
  router.use(errors);
  return router;
}
