import { logger } from "../lib/logger";
import { Router, json, type ErrorRequestHandler } from "express";
import type { AppConfig } from "../config";
import type { MongoService } from "../services/mongo";
import {
  createWebsiteTracking,
  trackingSite,
} from "../services/website-tracking/service";
import {
  automated,
  recordingBudget,
  trackingBase,
  digest,
} from "../services/website-tracking/model";
import { trackerScript } from "../services/website-tracking/script";
import { rateLimit } from "../middlewares/rate-limit";
import { ZodError } from "zod";
import { HiveConflict } from "../services/hive-definitions";
import { AuthorizationDenied } from "../authorization/policy";
export function websiteTrackingRouter(config: AppConfig, mongo: MongoService) {
  const router = Router(),
    app = createWebsiteTracking(config, mongo),
    root = "/workspaces/:workspaceId/website-tracking";
  router.get(root, async (req, res) =>
    res.json(await app.list(req.auth!, String(req.params.workspaceId))),
  );
  router.post(root, async (req, res) =>
    res.json(
      await app.mutate(req.auth!, String(req.params.workspaceId), req.body),
    ),
  );
  const errors: ErrorRequestHandler = (e, req, res, next) => {
    if (!req.path.includes("/website-tracking")) return next(e);
    res
      .status(
        e instanceof AuthorizationDenied
          ? 404
          : e instanceof ZodError
            ? 400
            : e instanceof HiveConflict
              ? 409
              : 503,
      )
      .json({
        error: {
          code: "WEBSITE_TRACKING",
          message:
            e instanceof HiveConflict
              ? e.message
              : e instanceof ZodError
                ? "Check the website settings."
                : "Website tracking is unavailable. Refresh and try again.",
        },
      });
  };
  router.use(errors);
  return router;
}
export function publicWebsiteTrackingRouter(
  config: AppConfig,
  mongo: MongoService,
) {
  let lastError = 0;
  const router = Router(),
    app = createWebsiteTracking(config, mongo, {
      recordingError: () => {
        if (Date.now() - lastError > 60000) {
          lastError = Date.now();
          logger.warn(
            { code: "WEBSITE_TRACKING_RECORD_FAILED" },
            "CTA navigation preserved; tracking write failed",
          );
        }
      },
    });
  router.use((_req, res, next) => {
    res.set({
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow",
    });
    next();
  });
  router.get("/tracker.js", (_req, res) => {
    res.set("Cross-Origin-Resource-Policy", "cross-origin");
    res.type("application/javascript").send(trackerScript);
  });
  // Do not rate-limit the redirect itself: failure to collect must not break navigation.
  const mayRecord = recordingBudget();
  router.get("/r/:token", async (req, res) => {
    const url = await app.redirect(
      String(req.params.token),
      automated(
        req.get("user-agent") || "",
        req.get("purpose") || req.get("sec-purpose") || "",
      ),
      !!trackingBase() &&
        req.method !== "HEAD" &&
        mayRecord(digest(req.ip || "unknown")),
    );
    if (!url) return res.status(404).end();
    return res.redirect(302, url);
  });
  router.use(
    "/sites/:id/events",
    (req, res, next) => {
      if (!trackingBase()) return res.status(503).end();
      if (!mayRecord("collect:" + digest(req.ip || "unknown")))
        return res.status(429).end();
      return next();
    },
    rateLimit({ windowMs: 60000, maxRequests: 120 }),
    async (req, res, next) => {
      const site = await trackingSite(
          await mongo.database(),
          String(req.params.id),
        ),
        origin = req.get("origin");
      if (
        !origin ||
        !site?.payload.enabled ||
        site.payload.revoked ||
        !site.payload.verifiedAt ||
        site.payload.origin !== origin
      )
        return res.status(403).end();
      res.set({
        "Access-Control-Allow-Origin": origin,
        Vary: "Origin",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      if (req.method === "OPTIONS") return res.status(204).end();
      return next();
    },
  );
  router.post(
    "/sites/:id/events",
    json({ limit: "4kb", type: "application/json" }),
    async (req, res) =>
      res.json(
        await app.collect(
          String(req.params.id),
          req.get("origin")!,
          req.body,
          automated(req.get("user-agent") || "", req.get("purpose") || ""),
        ),
      ),
  );
  const errors: ErrorRequestHandler = (e, _req, res, next) => {
    if (res.headersSent) return next(e);
    res
      .status(
        e?.type === "entity.too.large"
          ? 413
          : e instanceof ZodError || e?.type === "entity.parse.failed"
            ? 400
            : e instanceof HiveConflict
              ? 409
              : 503,
      )
      .json({ error: "Tracking unavailable" });
  };
  router.use(errors);
  return router;
}
