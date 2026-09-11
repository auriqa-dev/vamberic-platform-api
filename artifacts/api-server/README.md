# Vamberic Studio Platform API

The initial API foundation for the Vamberic Studio platform. This service is intentionally domain-neutral: it provides the HTTP, configuration, observability, and safety foundations that future product domains can build on without connecting to a database or external provider.

## Local development

1. Copy `.env.example` to `.env` and adjust values if needed.
2. Install workspace dependencies with `pnpm install`.
3. Start the API with `pnpm --filter @workspace/api-server run dev`.

The API listens on `PORT` (5000 by default). The health endpoints are:

- `GET /health`
- `GET /api/v1/health`
- `GET /ready`
- `GET /api/v1/ready`

The existing `/api/healthz` path remains available for the local service startup probe.
Health is a liveness check and does not depend on MongoDB. Readiness returns HTTP
200 only when the API can ping MongoDB, and otherwise returns HTTP 503 without
exposing connection details.

## Environment variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `NODE_ENV` | No | `development` | `development`, `test`, or `production` |
| `DEPLOYMENT_ENV` | Yes | — | Deployment environment: `dev`, `prod`, `test`, or `local` |
| `MONGODB_URI` | Yes | — | MongoDB Atlas or local MongoDB connection URI |
| `PORT` | No | `5000` | HTTP port |
| `SERVICE_NAME` | No | `vamberic-studio-platform-api` | Service identifier returned by health |
| `API_VERSION` | No | `0.1.0` | API version returned by health |
| `LOG_LEVEL` | No | `info` | Pino log level |
| `CORS_ORIGINS` | No | `http://localhost:3000` | Comma-separated explicit allowed origins |
| `RATE_LIMIT_WINDOW_MS` | No | `60000` | Rate-limit window |
| `RATE_LIMIT_MAX_REQUESTS` | No | `100` | Requests per IP and window |

Invalid configuration causes startup to fail with a clear validation error. Secrets are not required by this first pass.

## Structure

```text
src/
├── app.ts                 # Express composition root
├── config.ts              # Zod-validated environment configuration
├── index.ts               # HTTP server lifecycle and graceful shutdown
├── lib/
│   └── logger.ts          # Structured Pino logger
├── middlewares/
│   ├── errors.ts          # 404 and centralized error handling
│   ├── rate-limit.ts      # Configurable in-process rate limiting
│   └── request-id.ts      # Correlation ID support
└── routes/
    ├── health.ts          # Versioned and unversioned health endpoints
    ├── readiness.ts       # MongoDB-backed readiness endpoints
    └── index.ts           # Route composition
services/
└── mongo.ts               # Reusable lazy MongoDB client and ping
```

Future domain modules should be added as isolated route/service/provider boundaries for identity, organisations, CRM, products, entitlements, assessments, events, communications, payments, GDPR/retention, and agents. External providers should be introduced behind interfaces rather than imported directly into domain logic.

## Checks

```sh
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/api-server run lint
pnpm --filter @workspace/api-server run format:check
pnpm --filter @workspace/api-server run test
```

## Docker

The repository-root `Dockerfile` builds the API with Node.js 24 LTS and pnpm
10.26.1. It uses the workspace lockfile, compiles the bundled production output
in a build stage, and copies only `dist` into the non-root runtime stage.

From the repository root:

```sh
docker build --tag vamberic-platform-api:local .
docker run --rm --name vamberic-platform-api -p 3000:3000 \
  --env DEPLOYMENT_ENV=local \
  --env MONGODB_URI=mongodb://host.docker.internal:27017 \
  vamberic-platform-api:local
curl --fail http://localhost:3000/health
```

The container sets `NODE_ENV=production`, listens on port 3000, runs as the
standard unprivileged `node` user, and includes a Docker health check against
`GET /health`. Runtime configuration can be supplied with `--env-file` or
individual `--env` flags; secrets must never be copied into the image.