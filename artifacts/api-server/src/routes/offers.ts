import { createOfferBriefs } from "../services/offer-architecture/briefs";
import { logger } from "../lib/logger";
import {
  offerBriefInterpreterFromEnvironment,
  OfferBriefProviderFailure,
} from "../services/offer-architecture/brief-generate";
import { createOfferArchitecture } from "../services/offer-architecture/application";
import { offerGeneratorFromEnvironment } from "../services/offer-architecture/generate";
import { Router, type ErrorRequestHandler } from "express";
import { z, ZodError } from "zod";
import type { AppConfig } from "../config";
import type { MongoService } from "../services/mongo";
import { AuthorizationDenied } from "../authorization/policy";
import {
  readOfferFoundation,
  mutateOfferFoundation,
  OfferConflict,
  OFFER_ACTIONS,
  OFFER_DESIGN_ACTIONS,
  type OfferResource,
} from "../services/offers";
export function createOffersRouter(config: AppConfig, mongo: MongoService) {
  const router = Router();
  const app = createOfferArchitecture(
    config,
    mongo,
    offerGeneratorFromEnvironment(),
  );
  const root = "/workspaces/:workspaceId/offer-architecture";
  const w = (req: { params: Record<string, unknown> }) =>
    z.string().parse(req.params.workspaceId);
  const briefs = createOfferBriefs(
    config,
    mongo,
    offerBriefInterpreterFromEnvironment(),
  );
  router.get(root + "/briefs", async (req, res) =>
    res.json(
      await briefs.latest(
        req.auth!,
        w(req),
        z.string().parse(req.query.offeringId),
      ),
    ),
  );
  router.get(root + "/briefs/:id", async (req, res) =>
    res.json(
      await briefs.read(req.auth!, w(req), z.string().parse(req.params.id)),
    ),
  );
  router.post(root + "/briefs", async (req, res) =>
    res.status(202).json(await briefs.start(req.auth!, w(req), req.body)),
  );
  router.post(root + "/briefs/methodology", async (req, res) =>
    res.json(await briefs.methodology(req.auth!, w(req), req.body)),
  );
  router.post(root + "/briefs/confirm", async (req, res) =>
    res.json(await briefs.confirm(req.auth!, w(req), req.body)),
  );
  router.get(root + "/approved-brief/:id", async (req, res) =>
    res.json(
      await app.approvedBrief(
        req.auth!,
        w(req),
        z.string().parse(req.params.id),
      ),
    ),
  );
  router.get(root + "/permissions", async (req, res) =>
    res.json(await app.permissions(req.auth!, w(req))),
  );
  router.get(root + "/generations", async (req, res) =>
    res.json(
      await app.latest(
        req.auth!,
        w(req),
        z.string().parse(req.query.offeringId),
      ),
    ),
  );
  router.post(root + "/generations", async (req, res) =>
    res.status(202).json(await app.start(req.auth!, w(req), req.body)),
  );
  router.get(root + "/generations/:id", async (req, res) =>
    res.json(
      await app.read(req.auth!, w(req), z.string().parse(req.params.id)),
    ),
  );
  router.get(root + "/offers/:id", async (req, res) =>
    res.json(
      await app.bundle(req.auth!, w(req), z.string().parse(req.params.id)),
    ),
  );
  router.post(root + "/output", async (req, res) =>
    res.json(await app.registerOutput(req.auth!, w(req), req.body)),
  );
  router.post(root + "/save", async (req, res) =>
    res.json(await app.save(req.auth!, w(req), req.body)),
  );
  router.post(root + "/transition", async (req, res) =>
    res.json(await app.transition(req.auth!, w(req), req.body)),
  );

  const methodRoot = "/workspaces/:workspaceId/offer-design-methodologies";
  router.get(methodRoot, async (req, res) => {
    res.json(
      await readOfferFoundation(
        mongo,
        config,
        req.auth!,
        z.string().parse(req.params.workspaceId),
        "methodologies",
        req.query,
      ),
    );
  });
  router.get(methodRoot + "/:id/versions/:version", async (req, res) => {
    res.json(
      await readOfferFoundation(
        mongo,
        config,
        req.auth!,
        z.string().parse(req.params.workspaceId),
        "methodologies",
        req.query,
        z.string().parse(req.params.id),
        z.coerce.number().int().positive().parse(req.params.version),
      ),
    );
  });
  for (const [path, kind] of Object.entries({
    "offer-designs": "offer_designs",
    offers: "offers",
  }) as [string, OfferResource][]) {
    const root = `/workspaces/:workspaceId/${path}`;
    router.get(root, async (req, res) => {
      res.json(
        await readOfferFoundation(
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
        await readOfferFoundation(
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
    if (kind === "offers")
      router.get(root + "/:id/revisions/:revision", async (req, res) => {
        res.json(
          await readOfferFoundation(
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
    for (const operation of kind === "offers"
      ? OFFER_ACTIONS
      : OFFER_DESIGN_ACTIONS)
      router.post(root + "/" + operation, async (req, res) => {
        res
          .status(operation === "create" ? 201 : 200)
          .json(
            await mutateOfferFoundation(
              mongo,
              config,
              req.auth!,
              z.string().parse(req.params.workspaceId),
              kind,
              operation,
              req.body,
            ),
          );
      });
  }
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    void _next;
    if (error instanceof OfferBriefProviderFailure)
      logger.warn(
        {
          event: "offer_brief_provider_failure",
          requestId: _req.id,
          diagnostic: error.diagnostic,
        },
        "Offer brief provider failure",
      );
    const status =
      error instanceof AuthorizationDenied
        ? 404
        : error instanceof ZodError
          ? 400
          : error instanceof OfferConflict || error?.code === 11000
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
