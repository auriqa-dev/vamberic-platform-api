import { z } from "zod";

const configSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DEPLOYMENT_ENV: z.enum(["dev", "prod", "test", "local"]),
  PORT: z.coerce.number().int().min(1).max(65535).default(5000),
  SERVICE_NAME: z
    .string()
    .trim()
    .min(1)
    .default("vamberic-studio-platform-api"),
  API_VERSION: z.string().trim().min(1).default("0.1.0"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:3000")
    .transform((value) =>
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    )
    .refine((origins) => !origins.includes("*"), {
      message: "CORS_ORIGINS must list explicit origins; '*' is not allowed",
    }),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(100),
});

export type AppConfig = {
  deploymentEnvironment: "dev" | "prod" | "test" | "local";
  runtimeMode: "development" | "test" | "production";
  port: number;
  serviceName: string;
  version: string;
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
  corsOrigins: string[];
  rateLimit: {
    windowMs: number;
    maxRequests: number;
  };
};

export function parseConfig(
  environment: Record<string, string | undefined> = process.env,
): AppConfig {
  const parsed = configSchema.safeParse(environment);

  if (!parsed.success) {
    throw new Error(
      `Invalid application configuration: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "config"} ${issue.message}`)
        .join("; ")}`,
    );
  }

  return {
    deploymentEnvironment: parsed.data.DEPLOYMENT_ENV,
    runtimeMode: parsed.data.NODE_ENV,
    port: parsed.data.PORT,
    serviceName: parsed.data.SERVICE_NAME,
    version: parsed.data.API_VERSION,
    logLevel: parsed.data.LOG_LEVEL,
    corsOrigins: parsed.data.CORS_ORIGINS,
    rateLimit: {
      windowMs: parsed.data.RATE_LIMIT_WINDOW_MS,
      maxRequests: parsed.data.RATE_LIMIT_MAX_REQUESTS,
    },
  };
}

export const loadConfig = parseConfig;
