# Vapp Cognito authentication

Vapp → Cognito hosted login → Platform API → MongoDB Atlas. No password handling,
AWS resource creation, client secret, roles, or permissions are implemented here.
Every authenticated user of the configured Vapp client has the same business API
access. Manage who can join the user pool accordingly until authorization exists.

## API boundary

The Express middleware in `artifacts/api-server/src/middlewares/auth.ts` protects
all current and future routes under `/api/v1`, including Dashboard and Products.
Only GET/HEAD `/api/v1/health` and `/api/v1/ready` bypass it. Root `/health` and
`/ready` remain public, as does the existing `/api/healthz` compatibility probe.
CORS OPTIONS preflights execute before authentication and expose no business data.

Supply these server runtime variables through the existing deployment process:

```dotenv
AWS_REGION=eu-west-2
COGNITO_USER_POOL_ID=eu-west-2_REPLACE
COGNITO_CLIENT_ID=replacewithclientid
CORS_ORIGINS=https://app.vamberic.com
```

The issuer is derived as
`https://cognito-idp.<AWS_REGION>.amazonaws.com/<COGNITO_USER_POOL_ID>`; the pool's
region must match. JWKS are fetched lazily from that issuer's
`/.well-known/jwks.json`, cached, and refreshed by `jose` for key rotation, with
a five-second request timeout and a thirty-second refresh cooldown. No AWS SDK
credentials are required to retrieve public signing keys.

`jose.jwtVerify` enforces RS256 signatures, exact issuer, required expiry/issued-at
and subject claims, expiry and not-before. The middleware also requires a key ID,
a nonempty subject, no future issued-at, `token_use=access`, and an exact
`client_id` match. ID tokens are deliberately rejected, even with matching `aud`:
Cognito ID tokens identify the browser session; access tokens authorize API calls.
Cognito access tokens use `client_id` for the app-client check, not ID-token `aud`.
This configuration does not enable Cognito resource-bound access-token audiences.

Missing, malformed, expired, invalidly signed, wrong-issuer/client and wrong-token-use
credentials all return `401`, `WWW-Authenticate: Bearer`, and
`{"error":"Unauthorized"}`. Verification errors and raw bearer tokens are never
logged. Network/JWKS failures fail closed with the same response. CORS still
provides the allow-origin header on these responses to approved browser origins.

Verified identity is available as typed, immutable `req.auth` with `subject`,
`issuer`, and `clientId`. The Cognito subject is not a Platform person ID. Later
audit work can map this identity to the existing actor model; client-submitted
audit fields do not become trusted through this change.

There is no local or production auth-disable switch. Local tests inject only
verification keys, exercising the real middleware and claim checks. Dummy Cognito
identifiers are sufficient for those tests and public probes; business requests
still require a valid JWT. API startup (and commands using the shared config)
requires all three Cognito variables. Existing MongoDB variables remain server-only.

## Browser session

Install dependencies with Node 24 / pnpm 10.26.1. Copy the Vapp `.env.example` to
`.env.local` in `artifacts/vapp` and replace the public identifiers:

```dotenv
VITE_PLATFORM_API_BASE_URL=https://api.vamberic.com
VITE_COGNITO_REGION=eu-west-2
VITE_COGNITO_USER_POOL_ID=eu-west-2_REPLACE
VITE_COGNITO_CLIENT_ID=replacewithclientid
VITE_COGNITO_DOMAIN=https://replace.auth.eu-west-2.amazoncognito.com
```

The domain is the HTTPS origin of Cognito managed login (or its configured custom
domain), without a path. The API base is its origin without `/api`. These values
are public, build-time Vite configuration. Never add a client secret, AWS access
key, or `MONGODB_URI`. Missing/invalid configuration shows a setup message and
mounts no business screens. Compilation alone does not prove live login is configured.

`oidc-client-ts` performs Authorization Code + PKCE with `openid email profile`,
state correlation, and callback processing. There is no implicit or password grant.
Callback and logout-return URLs are the current frontend origin plus Vite's
`BASE_PATH`: with `BASE_PATH=/`, register exactly `https://app.vamberic.com/` and,
for local development, `http://localhost:3000/`. Codes, state and provider errors
are removed from browser history after callback processing. Hosting must serve the
SPA entrypoint for its routes.

Session/token and PKCE state use tab-scoped `sessionStorage`, not localStorage.
The session survives reloads in that tab. Tokens remain accessible to browser
JavaScript, so normal XSS protections remain necessary. No auth-library debug
logger is enabled. Expiry deliberately returns to login; automatic silent renewal
is disabled. Sign-out clears tokens and private React Query data, attempts refresh
token revocation, then visits Cognito's `/logout` with `client_id` and `logout_uri`.
Sign-out is tab-local; it is not a server-side global session invalidation system.
Offline JWT verification does not immediately detect a revoked access token, so
use short access-token lifetimes in Cognito.

The React auth gate mounts business screens only after authentication. It supplies
an access-token getter to the existing generated client's `custom-fetch` once;
individual hooks contain no auth logic. Tokens are attached only to the configured
API origin. Missing session tokens prevent sending an unauthenticated request.
A shared 401 handler clears the session/query cache and returns to login; it throws
a generic sign-in error instead of rendering provider/API response details. Query
retries stop for authentication errors.

## Tests and validation

The API tests sign short-lived RS256 JWTs with locally generated test keys and
inject a local JWKS resolver. Products/Dashboard tests now use those JWTs. CORS
and public probe tests remain unauthenticated. No test connects to Cognito or MongoDB.

```sh
PORT=3000 BASE_PATH=/ pnpm run build
pnpm --filter @workspace/api-server run lint
pnpm run typecheck
pnpm --filter @workspace/api-server run test
pnpm --filter @workspace/api-server exec node --import tsx --test ../vapp/src/auth/session.test.ts ../../lib/api-client-react/test/custom-fetch.test.ts
pnpm --filter @workspace/api-server run format:check
git diff --check
```

The additional tests cover restored/expired sessions, single callback handling,
safe provider failures, sign-out, restoration races, token destination restriction,
missing-session blocking and 401 handling. Live hosted-login integration requires
the resources below and has not been tested by these offline suites.

## Infrastructure handoff (separate repository)

- Create the user pool and a public Vapp app client **without a client secret**.
- Enable authorization-code grant, PKCE-compatible login, and `openid email profile`.
  Configure the Cognito managed-login domain, identity providers and user admission.
- Register the exact allowed callback and sign-out URLs above, including trailing
  slashes. Use separate environment resources/client IDs as appropriate.
- Supply public Vite configuration at frontend build time and Cognito identifiers
  to the API runtime; continue supplying MongoDB credentials only to the API.
- Keep `CORS_ORIGINS` explicit (comma-separated, e.g.
  `http://localhost:3000,https://app.vamberic.com`); never use `*`.
- Permit API HTTPS egress to the configured Cognito issuer's JWKS endpoint. Configure
  token lifetimes/revocation and verify live login, logout and key rotation before release.
- Continue GitHub Actions/AWS deployment and existing Atlas/index verification.
  This implementation makes no infrastructure changes or deployments.

References: [Cognito JWT verification](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-tokens-verifying-a-jwt.html),
[oidc-client-ts Cognito guidance](https://authts.github.io/oidc-client-ts/),
[Cognito logout](https://docs.aws.amazon.com/cognito/latest/developerguide/logout-endpoint.html).
