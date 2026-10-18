import { publicOutcomesRouter } from "./routes/business-outcomes";
import { publicInteractionRouter } from "./routes/interaction";
import { publicWebsiteTrackingRouter } from "./routes/website-tracking";
import type { IcpGenerator } from "./services/icp/generate";
import { createAgentSubsystem } from "./services/agent-subsystem";
import { createHvmRouter } from "./routes/hvm";
import { humanClients } from "./services/hvm-context";
import { createAuthorizationAuthority } from "./authorization/policy";
import { authorizeOperationalRequest } from "./middlewares/authorization";
import {
  createNotificationService,
  type NotificationDependencies,
} from "./notifications/service";
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
    agents?: ReturnType<typeof createAgentSubsystem>;
    icpGenerator?: IcpGenerator;
    brandGenerator?: import("./services/brand-expression/generate").BrandGenerator;
    psuGenerator?: import("./services/psu/generate").PsuGenerator;
    brandImages?: import("./services/brand-images").BrandImageStore;
    jwtKeyResolver?: JwtKeyResolver;
    enquirySpamCheck?: EnquirySpamCheck;
    notifications?: NotificationDependencies;
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
  app.use("/api/v1/public/outcomes", publicOutcomesRouter(config, mongo));
  app.use("/api/v1/public/interaction", publicInteractionRouter(config, mongo, options.brandImages));
  app.use("/api/v1/public/tracking", publicWebsiteTrackingRouter(config, mongo));
  app.use(
    "/api/v1/public",
    createPublicEnquiriesRouter(
      config,
      mongo,
      createNotificationService(config.notifications, options.notifications),
      options.enquirySpamCheck,
    ),
  );
  app.use(
    cors({
      origin: [...config.corsOrigins, ...config.hvmCorsOrigins],
      credentials: false,
      exposedHeaders: ["Retry-After"],
    }),
  );
  app.use(rateLimit(config.rateLimit));
  const agents = options.agents ?? createAgentSubsystem(config, mongo);
  app.use("/api/v1/agent-workload", agents.workload);
  // CORS preflight runs first; all actual business requests require a token.
  const authority = createAuthorizationAuthority({
    humanClients: humanClients(config),
  });
  app.use(
    "/api/v1",
    authenticate(config.cognito, options.jwtKeyResolver, authority),
  );
  app.use(
    "/api/v1/hvm",
    createHvmRouter(config, mongo, agents, options.brandImages, options.psuGenerator, options.icpGenerator, options.brandGenerator),
  );
  app.use("/api/v1", authorizeOperationalRequest(authority));
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));

  app.use(createRouter(config, mongo));
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
