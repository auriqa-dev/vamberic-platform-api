import {
  createPublicEnquiriesRouter,
  type EnquirySpamCheck,
} from "./routes/public-enquiries";
import { authenticate, type JwtKeyResolver } from "./middlewares/auth";
import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { createRouter } from "./routes";
import { logger } from "./lib/logger";
import type { AppConfig } from "./config";
import { requestId } from "./middlewares/request-id";
import { rateLimit } from "./middlewares/rate-limit";
import { errorHandler, notFoundHandler } from "./middlewares/errors";
import type { MongoService } from "./services/mongo";

export function createApp(
  config: AppConfig,
  mongo: MongoService,
  options: {
    jwtKeyResolver?: JwtKeyResolver;
    enquirySpamCheck?: EnquirySpamCheck;
  } = {},
): Express {
  const app: Express = express();

  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.headers["x-request-id"]?.toString() ?? req.id,
      serializers: {
        req(req) {
          if (/^\/api\/v1\/public(?:\/|$)/i.test(req.url ?? ""))
            return { method: req.method, url: "/api/v1/public" };
          return {
            id: req.id,
            method: req.method,
            url: req.url?.split("?")[0],
          };
        },
        res(res) {
          return {
            statusCode: res.statusCode,
          };
        },
      },
    }),
  );
  app.use(helmet());
  app.use(
    "/api/v1/public",
    createPublicEnquiriesRouter(config, mongo, options.enquirySpamCheck),
  );
  app.use(
    cors({
      origin: config.corsOrigins.length > 0 ? config.corsOrigins : false,
      credentials: false,
    }),
  );
  app.use(rateLimit(config.rateLimit));
  // CORS preflight runs first; all actual business requests require a token.
  app.use("/api/v1", authenticate(config.cognito, options.jwtKeyResolver));
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));

  app.use(createRouter(config, mongo));
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
