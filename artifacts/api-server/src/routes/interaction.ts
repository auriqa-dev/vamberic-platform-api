import {
  createBrandImageStore,
  type BrandImageStore,
} from "../services/brand-images";
import { Router, json, type ErrorRequestHandler } from "express";
import { z, ZodError } from "zod";
import type { AppConfig } from "../config";
import type { MongoService } from "../services/mongo";
import { createInteraction } from "../services/interaction/service";
import { contentGeneratorFromEnvironment } from "../services/content-strategy/generate";
import { rateLimit } from "../middlewares/rate-limit";
import { HiveConflict } from "../services/hive-definitions";
import { interactionWidget } from "../services/interaction/widget";
const errors: ErrorRequestHandler = (e, _req, res, next) => {
  // Express identifies error handlers by their four-argument signature.
  void next;
  res
    .status(e instanceof ZodError ? 400 : e instanceof HiveConflict ? 409 : 503)
    .json({
      error: {
        code: "INTERACTION",
        message:
          e instanceof HiveConflict
            ? e.message
            : e instanceof ZodError
              ? "Check the entered values."
              : "Interaction is unavailable. Please try again.",
      },
    });
};
export function interactionRouter(config: AppConfig, mongo: MongoService) {
  const r = Router(),
    app = createInteraction(config, mongo),
    root = "/workspaces/:workspaceId/interactions";
  r.get(root, async (req, res) =>
    res.json(
      await app.list(
        req.auth!,
        String(req.params.workspaceId),
        z.string().max(100).optional().parse(req.query.cursor),
      ),
    ),
  );
  r.post(root, async (req, res) =>
    res.json(
      await app.mutate(req.auth!, String(req.params.workspaceId), req.body),
    ),
  );
  r.get(root + "/:id", async (req, res) =>
    res.json(
      await app.transcript(
        req.auth!,
        String(req.params.workspaceId),
        String(req.params.id),
      ),
    ),
  );
  const scopedErrors: ErrorRequestHandler = (e, req, res, next) =>
    req.path.includes("/interactions") ? errors(e, req, res, next) : next(e);
  r.use(scopedErrors);
  return r;
}
export function publicInteractionRouter(
  config: AppConfig,
  mongo: MongoService,
  store: BrandImageStore | undefined = config.brandImages
    ? createBrandImageStore(
        config.brandImages.bucket,
        config.brandImages.region,
      )
    : undefined,
) {
  const r = Router(),
    app = createInteraction(
      config,
      mongo,
      contentGeneratorFromEnvironment(),
      store,
    );
  r.use((_req, res, next) => {
    res.set({
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow",
    });
    next();
  });
  r.get("/widget.js", (_req, res) => {
    res.set("Cross-Origin-Resource-Policy", "cross-origin");
    res.type("application/javascript").send(interactionWidget);
  });
  r.use((_req, res, next) =>
    process.env.HVM_INTERACTION_ENABLED === "true"
      ? next()
      : res
          .status(503)
          .json({ error: { message: "Website chat is not available yet." } }),
  );
  r.use(rateLimit({ windowMs: 60000, maxRequests: 30 }));
  r.use("/:id", async (req, res, next) => {
    const origin = req.get("origin");
    if (!origin) return res.status(403).end();
    try {
      await app.publicConfig(String(req.params.id), origin);
    } catch {
      return res.status(403).end();
    }
    res.set({
      "Access-Control-Allow-Origin": origin,
      Vary: "Origin",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
    if (req.method === "OPTIONS") return res.status(204).end();
    return next();
  });
  r.use(json({ limit: "12kb" }));
  r.get("/:id", async (req, res) =>
    res.json(await app.publicConfig(String(req.params.id), req.get("origin")!)),
  );
  r.get("/:id/avatar", async (req, res) => {
    const bytes = await app.avatar(String(req.params.id), req.get("origin")!);
    if (!bytes) return void res.status(404).end();
    res.type("image/png").send(bytes);
  });
  r.post("/:id/sessions", async (req, res) => {
    res.json(
      await app.start(String(req.params.id), req.get("origin")!, req.body),
    );
  });
  for (const operation of ["messages", "enquiries"] as const)
    r.post(`/:id/sessions/:sessionId/${operation}`, async (req, res) => {
      const token = z
        .string()
        .regex(/^Bearer [A-Za-z0-9_-]{43}$/)
        .parse(req.get("authorization"))
        .slice(7);
      res.json(
        await (operation === "messages" ? app.send : app.enquire)(
          String(req.params.id),
          req.get("origin")!,
          String(req.params.sessionId),
          token,
          req.body,
        ),
      );
    });
  r.use(errors);
  return r;
}
