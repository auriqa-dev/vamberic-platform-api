# Vamberic Studio Platform

Production-oriented, product-neutral API foundation for the Vamberic Studio multi-product platform.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — build and run the API server
- `pnpm --filter @workspace/api-server run test` — run API and configuration tests
- `pnpm --filter @workspace/api-server run lint` — lint API TypeScript
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- API environment variables are documented in `artifacts/api-server/.env.example`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/api-server/src` — Express API implementation
- `artifacts/api-server/src/config.ts` — validated runtime configuration
- `artifacts/api-server/src/middlewares` — request IDs, rate limiting, and errors
- `lib/api-spec/openapi.yaml` — source of truth for the HTTP contract
- `artifacts/api-server/README.md` — local development and service structure

## Architecture decisions

- The API is product-neutral; no product domain logic is implemented in the foundation.
- Product applications and agents will eventually use the same API/service layer.
- Databases, authentication, and external providers are deliberately absent from this pass.
- Future external providers must sit behind provider abstractions rather than domain imports.

## Product

- Safe health metadata at `/health` and `/api/v1/health`
- Structured request logging and correlation IDs
- Explicit CORS allowlists, security headers, configurable rate limiting, and graceful shutdown

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Run API codegen after every change to `lib/api-spec/openapi.yaml`.
- Never configure `CORS_ORIGINS=*`; startup validation rejects wildcard origins.
- Do not add direct database access to product applications.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
