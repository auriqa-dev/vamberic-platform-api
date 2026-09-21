import { Router, json, type ErrorRequestHandler, type Request } from "express";
import cors from "cors";
import {
  SubmitPublicEnquiryParams,
  SubmitPublicEnquiryResponse,
} from "@workspace/api-zod";
import type { AppConfig } from "../config";
import type { MongoService } from "../services/mongo";
import {
  PublicEnquirySchema,
  type PublicEnquiry,
} from "../domain/public-enquiry";
import { submitEnquiry, EnquiryError } from "../services/enquiries";
import { rateLimit } from "../middlewares/rate-limit";
import type { NotificationService } from "../notifications/service";
import { logger } from "../lib/logger";

// A future challenge provider can reject before any CRM lookup or write.
// No token/header/raw request is included in persisted context.
export type EnquirySpamCheck = (context: {
  productId: string;
  enquiry: PublicEnquiry;
  ip: Request["ip"];
}) => Promise<boolean>;

export function createPublicEnquiriesRouter(
  config: AppConfig,
  mongo: MongoService,
  notifications: NotificationService,
  spamCheck?: EnquirySpamCheck,
) {
  const router = Router();
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  router.use(
    cors({
      origin: config.publicEnquiry.corsOrigins.length
        ? config.publicEnquiry.corsOrigins
        : false,
      credentials: false,
      methods: ["POST", "OPTIONS"],
      allowedHeaders: ["Content-Type"],
    }),
  );
  router.use(rateLimit(config.publicEnquiry.rateLimit));
  router.use((req, _res, next) => {
    if (
      req.headers.origin &&
      !config.publicEnquiry.corsOrigins.includes(req.headers.origin)
    )
      return next(
        new EnquiryError(403, "ORIGIN_NOT_ALLOWED", "Origin not approved"),
      );
    next();
  });
  router.post(
    "/products/:productId/enquiries",
    (req, _res, next) => {
      if (!req.is("application/json"))
        return next(
          new EnquiryError(415, "JSON_REQUIRED", "JSON content type required"),
        );
      next();
    },
    json({ limit: "16kb", strict: true, inflate: false }),
    async (req, res) => {
      const params = SubmitPublicEnquiryParams.safeParse(req.params);
      const input = PublicEnquirySchema.safeParse(req.body);
      if (!params.success || !input.success)
        throw new EnquiryError(
          400,
          "INVALID_ENQUIRY",
          "Invalid enquiry details",
        );
      if (
        spamCheck &&
        !(await spamCheck({
          productId: params.data.productId,
          enquiry: input.data,
          ip: req.ip,
        }))
      )
        throw new EnquiryError(
          400,
          "INVALID_ENQUIRY",
          "Invalid enquiry details",
        );
      const enquiryId = await submitEnquiry(
        mongo,
        params.data.productId,
        input.data,
        notifications,
      );
      res
        .status(201)
        .json(
          SubmitPublicEnquiryResponse.parse({ status: "received", enquiryId }),
        );
    },
  );
  // Terminate the namespace, including unsupported verbs; never fall through
  // into private handlers and never echo user-supplied paths in errors.
  router.use((_req, res) => {
    res
      .status(404)
      .json({ error: { code: "NOT_FOUND", message: "Route not found" } });
  });
  const safeErrors: ErrorRequestHandler = (error, _req, res, _next) => {
    void _next;
    const parserType =
      error && typeof error === "object" && "type" in error
        ? error.type
        : undefined;
    const status =
      error instanceof EnquiryError
        ? error.status
        : parserType === "entity.too.large"
          ? 413
          : parserType === "encoding.unsupported" ||
              parserType === "charset.unsupported"
            ? 415
            : parserType === "entity.parse.failed"
              ? 400
              : 503;
    const code =
      error instanceof EnquiryError
        ? error.code
        : status === 413
          ? "PAYLOAD_TOO_LARGE"
          : status === 415
            ? "UNSUPPORTED_ENCODING"
            : status === 400
              ? "INVALID_JSON"
              : "ENQUIRY_UNAVAILABLE";
    const message =
      error instanceof EnquiryError
        ? error.message
        : status === 503
          ? "Enquiry capture temporarily unavailable"
          : "Invalid request payload";
    if (status === 503) logger.warn({ code }, "Public enquiry failed");
    res.status(status).json({ error: { code, message } });
  };
  router.use(safeErrors);
  return router;
}
