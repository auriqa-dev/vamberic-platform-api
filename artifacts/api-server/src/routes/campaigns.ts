import { Router, type ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import type { AppConfig } from "../config";
import type { MongoService } from "../services/mongo";
import { createCampaignService } from "../services/campaigns/service";
import { contentGeneratorFromEnvironment } from "../services/content-strategy/generate";
import { AuthorizationDenied } from "../authorization/policy";
import { HiveConflict } from "../services/hive-definitions";
export function createCampaignRouter(config: AppConfig, mongo: MongoService) {
  const router = Router(),
    service = createCampaignService(
      config,
      mongo,
      contentGeneratorFromEnvironment(),
    ),
    root = "/workspaces/:workspaceId/campaigns";
  router.get(root, async (req, res) =>
    res.json(await service.list(req.auth!, String(req.params.workspaceId))),
  );
  router.post(root, async (req, res) =>
    res.json(
      await service.change(
        req.auth!,
        String(req.params.workspaceId),
        undefined,
        req.body,
      ),
    ),
  );
  router.get(root + "/:id/journey", async (req,res) => res.json(await service.journey(req.auth!,String(req.params.workspaceId),String(req.params.id))));
  router.get(root + "/:id/recipients", async (req,res) => res.json(await service.recipientCandidates(req.auth!,String(req.params.workspaceId),String(req.params.id),req.query)));
  router.post(root + "/:id/journey", async (req,res) => res.json(await service.saveJourney(req.auth!,String(req.params.workspaceId),String(req.params.id),req.body)));
  router.get(root + "/:id/audience", async (req, res) =>
    res.json(
      await service.audience(
        req.auth!,
        String(req.params.workspaceId),
        String(req.params.id),
        req.query,
      ),
    ),
  );
  router.get(root + "/:id", async (req, res) =>
    res.json(
      await service.read(
        req.auth!,
        String(req.params.workspaceId),
        String(req.params.id),
      ),
    ),
  );
  router.post(root + "/:id", async (req, res) =>
    res.json(
      await service.change(
        req.auth!,
        String(req.params.workspaceId),
        String(req.params.id),
        req.body,
      ),
    ),
  );
  router.post(root + "/:id/meetings", async (req,res) => res.json(await service.recordMeeting(req.auth!,String(req.params.workspaceId),String(req.params.id),req.body)));
  router.post(root + "/:id/research", async (req, res) =>
    res
      .status(202)
      .json(
        await service.start(
          req.auth!,
          String(req.params.workspaceId),
          String(req.params.id),
          req.body,
        ),
      ),
  );
  router.post(root + "/:id/overlap-policy", async (req, res) =>
    res.json(
      await service.savePolicy(
        req.auth!,
        String(req.params.workspaceId),
        String(req.params.id),
        req.body,
      ),
    ),
  );
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
          code: "CAMPAIGN_REQUEST_FAILED",
          message:
            e instanceof HiveConflict
              ? e.message
              : e instanceof ZodError
                ? "Check the campaign fields and try again."
                : "Campaign request could not be completed. Your saved setup is unchanged.",
        },
      });
  };
  router.use(errors);
  return router;
}
