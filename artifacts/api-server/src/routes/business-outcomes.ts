import express, { Router, type ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import type { AppConfig } from "../config";
import type { MongoService } from "../services/mongo";
import { AuthorizationDenied } from "../authorization/policy";
import { HiveConflict } from "../services/hive-definitions";
import { createBusinessOutcomes } from "../services/business-outcomes/service";
import { rateLimit } from "../middlewares/rate-limit";
const errors: ErrorRequestHandler = (e, _req, res, next) => {
  if (res.headersSent) return next(e);
  res
    .status(
      e.type === "entity.too.large"
        ? 413
        : e instanceof SyntaxError
          ? 400
          : e instanceof AuthorizationDenied
            ? 404
            : e instanceof ZodError
              ? 400
              : e instanceof HiveConflict
                ? 409
                : 503,
    )
    .json({
      error: {
        code: "BUSINESS_OUTCOME",
        message:
          e instanceof HiveConflict
            ? e.message
            : e instanceof ZodError
              ? "Check the outcome fields and mapping."
              : e instanceof AuthorizationDenied
                ? "Outcome connection unavailable."
                : "Outcome storage unavailable. Retry with the same event reference.",
      },
    });
};
export function businessOutcomesRouter(config: AppConfig, mongo: MongoService) {
  const r = Router(),
    app = createBusinessOutcomes(config, mongo),
    root = "/workspaces/:workspaceId/outcomes";
  r.get(root, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(await app.state(req.auth!, String(req.params.workspaceId)));
  });
  r.post(root, async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(
      await app.change(req.auth!, String(req.params.workspaceId), req.body),
    );
  });
  const scopedErrors: ErrorRequestHandler = (err, req, res, next) => {
    if (!/\/outcomes(?:\/|$)/.test(req.path)) return next(err);
    errors(err, req, res, next);
  };
  r.use(scopedErrors);
  return r;
}
export function publicOutcomesRouter(config: AppConfig, mongo: MongoService) {
  const r = Router(),
    app = createBusinessOutcomes(config, mongo);
  r.use(rateLimit(config.rateLimit));
  r.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    // Server-to-server evidence only. Never expose this credential in a website script.
    if (
      req.headers.origin ||
      !/^Bearer [A-Za-z0-9_-]{43}$/.test(req.headers.authorization ?? "")
    ) {
      res.status(401).json({
        error: {
          code: "OUTCOME_AUTH",
          message: "A server connection key is required.",
        },
      });
      return;
    }
    next();
  });
  r.use(express.json({ limit: "32kb" }));
  r.post("/:workspaceId/:outcomeId", async (req, res) => {
    const mode = req.header("X-HVM-Test");
    if (mode && mode !== "true") {
      res.status(400).json({
        error: {
          code: "OUTCOME_TEST",
          message: "Use X-HVM-Test: true for tests; omit it for live evidence.",
        },
      });
      return;
    }
    res.json(
      await app.receive(
        String(req.params.workspaceId),
        String(req.params.outcomeId),
        req.headers.authorization!.slice(7),
        req.body,
        mode === "true",
      ),
    );
  });
  r.use(errors);
  return r;
}
