# Vapp

Vapp calls the Vamberic Platform API. Only the API connects to MongoDB Atlas.
Never put `MONGODB_URI` or database credentials in Vapp environment files or
`VITE_*` variables: Vite embeds public environment values into browser code.

## Local development

Use Node 24 and pnpm 10.26.1 from the repository root:

```sh
pnpm install --frozen-lockfile
PORT=3000 BASE_PATH=/ VITE_PLATFORM_API_BASE_URL=http://localhost:5000 pnpm --filter @workspace/vapp run dev
```

The API must be running separately with its server-side configuration. See
the [API README](../api-server/README.md). The frontend does not start MongoDB
or receive its credentials.

`VITE_PLATFORM_API_BASE_URL` is the API origin, without `/api`: generated hooks
already request `/api/v1/...`. `src/main.tsx` calls `setBaseUrl()` before rendering.
Set the variable when starting Vite or building; changing the API origin later
requires rebuilding the frontend. A build without it passes compilation but
the frontend refuses to start.

For the intended future production frontend build:

```sh
PORT=3000 BASE_PATH=/ VITE_PLATFORM_API_BASE_URL=https://api.vamberic.com pnpm --filter @workspace/vapp run build
```

Both frontend Vite configurations require `PORT` and `BASE_PATH` at config load
time. `BASE_PATH` controls asset URLs; `PORT` is used by dev/preview servers.

## API browser origins

Configure the API's `CORS_ORIGINS` as comma-separated HTTP(S) origins, without
paths or trailing slashes. Whitespace around entries is trimmed. For example:

```dotenv
CORS_ORIGINS=http://localhost:3000,https://app.vamberic.com
```

Use `CORS_ORIGINS=https://app.vamberic.com` for production if that is its only
browser client. `*` is rejected. An empty value disables browser cross-origin
access. Unlisted origins receive no `Access-Control-Allow-Origin` header;
CORS is browser enforcement, not authentication or authorization.

## Current scope

The branded shell includes dashboard counts and product list/search/filter,
create, detail, and edit screens. The detail screen doubles as the edit form.
Activity, tasks, other domain screens, header search, and notifications remain
placeholders. Products use the existing v1 domain model through these routes:

- `GET /api/v1/dashboard/summary`
- `GET /api/v1/products`
- `POST /api/v1/products`
- `GET /api/v1/products/:id`
- `PATCH /api/v1/products/:id`

There is no product delete endpoint. IDs, creation timestamps, schema version,
and archive metadata remain server-managed through these product routes.

Before public exposure, an authentication/authorization boundary is still
required: these routes currently have no application-level access control.
Deployment also needs the API runtime configuration, Atlas connectivity and
existing v1 indexes verified through the normal deployment process. Local API
tests use in-memory database substitutes and do not verify a live Atlas setup.
