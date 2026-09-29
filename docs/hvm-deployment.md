# HVMapp deployment preparation

Prepared 2026-09-29. **No deployment, AWS resource creation, DNS change, Mongo/schema change, reprovisioning, or public enquiry routing change was performed.** The public hostname uses the existing **dev API/database** (`api.vamberic.com`, `vamberic_studio`, schema 5); `VITE_APP_ENV=production` describes the browser build, not a move to another database.

## Configuration and infrastructure ownership

Backend runtime configuration belongs in `../vamberic-infrastructure`, not the image-only application release policy:

- `config/environment.ts`: optional HVM auth configuration.
- `config/dev.ts`: existing HVM client and only `https://app.h-v-m.agency` for HVM CORS.
- `lib/api-stack.ts`: injects `HVM_AUTH_ENABLED=true`, `HVM_COGNITO_CLIENT_ID=q40elfmgdcfggcols0qnhot5e`, `HVM_CORS_ORIGINS=https://app.h-v-m.agency` into the ECS container environment.
- `lib/hvm-app-stack.ts`: dedicated certificate, private retained S3 bucket, CloudFront OAC, HTTPS, security headers, SPA rewrite, scoped deployment role and outputs.
- `bin/vamberic-infrastructure.ts`: new hosting/certificate stacks are opt-in with `-c hvmApp=true`.
- `test/hvm-app.test.ts`, `test/stacks.test.ts`, `test/app-environments.test.ts`: enforce SPA/security/OIDC and exact intended runtime changes while retaining the existing infrastructure baseline.

The existing Vapp Cognito client, Vapp CORS, public website CORS, notification settings and Secrets Manager ECS injection of `MONGODB_URI` remain unchanged. `PUBLIC_ENQUIRY_WORKSPACE_ROUTES_JSON` is **not** enabled. No migration is coupled to either deployment workflow. Local HVM CORS remains a local runtime choice; it is not included in the deployed dev API HVM allowlist.

`vamberic-platform-api/.github/workflows/deploy-dev.yml` remains the existing validated API image release followed by Vapp. Its scoped role cannot make this environment/hosting change. Do not broaden it: use the separately approved infrastructure deployment first, retaining the current `ApiImageTag`.

## Certificate and external DNS

Read-only ACM inspection confirmed the existing issued HVM certificate in **us-east-1**:

`arn:aws:acm:us-east-1:755905325223:certificate/461b6d57-ad23-4fdb-89c5-8f5836aeb528`

Its complete SAN list is only `h-v-m.agency`, `www.h-v-m.agency`; it does **not** cover `app.h-v-m.agency`. Prepare a dedicated certificate through `VambericHvmAppCertificate`, leaving the public site's certificate untouched. CloudFront requires the certificate in us-east-1.

The new app validation CNAME **does not exist yet**. Its exact name/value cannot be determined without requesting the certificate, which is outside this task's authorization. After certificate-stack creation starts, retrieve it using the commands below and add that exact CNAME at the external DNS provider. Do not reuse the apex/www validation records or invent a hash. Retain the validation CNAME for renewal.

After hosting exists, add the routing record: **CNAME `app.h-v-m.agency` → the `DistributionDomainName` output** (a `d….cloudfront.net` name). Its exact target is also unavailable before resource creation. Do not alter the apex/www public website records.

## Frontend runtime

`../hvm-app/.env.production.example` already has the reviewed eight public Vite variables: production mode, API `https://api.vamberic.com`, eu-west-2/pool `eu-west-2_CogD1Prpz`, HVM SPA client, shared hosted domain `https://vamberic-dev-vapp-755905325223.auth.eu-west-2.amazoncognito.com`, callback `https://app.h-v-m.agency/auth/callback`, logout `https://app.h-v-m.agency/`. No client secret. The existing local template retains localhost callbacks separately.

The real adapter reads `/api/v1/hvm/context`, then server-authorized workspace `overview`, `brands`, `integrations`, `team`, `capabilities`, and Brand `kits`. It validates response shapes, subject, issuer and workspace references, preserves independent Queen and Client membership, and uses server-computed capability access. It does not infer entitlements or substitute fake data. The kit list distinguishes an empty approved-kit set from a denied request; the singular kit endpoint returns 404 for both missing kit and denied access. Only approved kits are projected as current.

HVM's current state renders one Partner and workspace in Queen view, independent Client access, the HVM Brand and domain, an active admin membership, and intentional empty kit/integration/capability states. Team API currently supplies membership IDs/roles, not human display names; the UI labels these as workspace members rather than inventing names. No activity endpoint exists, so activity stays explicitly unavailable.

Setup edits workspace name and existing Brand name/domain through the existing `profile` and `brand-update` POST operations with `expectedUpdatedAt`. The adapter also exposes an allowlisted write seam for the other existing onboarding operations; no fictional endpoint is introduced. Full kit/team/integration management forms remain outside this focused deployment preparation. Backend authorization is authoritative; 401 clears session, 403/404 deny, 409 asks for reload, and no provider/body errors are rendered. Private workspace data lives only in React memory; existing OIDC sessionStorage remains unchanged, with no sensitive localStorage persistence.

Context switching re-resolves server access without sign-out. URL workspace selection is checked against the server context and every backend endpoint reauthorizes. A caller cannot obtain Vapp identity from headers or access Vapp-only routes with an HVM token; the reciprocal restriction also remains.

## Static security and routes

Use the dedicated CDK CloudFront/S3 stack rather than manual public bucket hosting. Its viewer-request function rewrites extensionless routes to `/index.html`, including `/auth/callback`, all Queen/client paths and deep refreshes. Missing JS/CSS/image files are not rewritten to HTML. Default caching is disabled for correctness in Phase 1; hashed assets are uploaded with immutable browser caching, public fixed-name assets and HTML with no-cache. Old hashed assets are retained to support already-open clients and rollback.

CSP: `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://api.vamberic.com https://cognito-idp.eu-west-2.amazonaws.com https://vamberic-dev-vapp-755905325223.auth.eu-west-2.amazoncognito.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self' https://vamberic-dev-vapp-755905325223.auth.eu-west-2.amazoncognito.com`.

No inline/eval script exception, wildcard connect origin or global security weakening. Headers also enforce nosniff, DENY framing, no-referrer and one-year HSTS. Login/logout use top-level redirects and the code exchange uses the allowlisted Cognito domain. No external fonts are required.

## GitHub

Read-only GitHub inspection confirmed HVMapp's immutable OIDC subject prefix:
`repo:auriqa-dev@209590030/hvm-app@1392322706`.

The role trusts exactly that repository's **hvmapp** Environment and `sts.amazonaws.com` audience, with access limited to its own S3 bucket and CloudFront invalidations. The account's existing OIDC provider is reused; no access keys are needed.

Create/protect the GitHub Environment `hvmapp` later (main branch only, required reviewer recommended), then set its public variables from stack outputs:

- `HVMAPP_DEPLOY_ROLE_ARN` ← `DeploymentRoleArn`
- `HVMAPP_BUCKET` ← `BucketName`
- `HVMAPP_DISTRIBUTION_ID` ← `DistributionId`

`hvm-app/.github/workflows/deploy.yml` is **workflow_dispatch only**, main only. It installs/checks/tests/builds, checks built public config, requires API /health and /ready HTTP 200 plus Mongo available, then uses OIDC for S3 upload (HTML last) and waited CloudFront invalidation. It never applies schema, provisions clients or changes the website. Environment approval and live smoke tests remain required for rollout; readiness alone does not prove that HVM authentication has deployed.

## Exact later rollout (not executed)

Run only after separate approval and reviewed commits are available. Review existing unrelated infrastructure working-tree changes before committing/deploying; never use `cdk deploy --all`.

1. **Backend configuration/infrastructure**. In `vamberic-infrastructure`, validate, review the dev API diff, and preserve the live image parameter explicitly:

   ```sh
   npm run build && npm test
   npx cdk diff VambericDevApi --exclusively -c environment=dev --profile vamberic-admin
   CURRENT_API_IMAGE_TAG=$(aws cloudformation describe-stacks --stack-name VambericDevApi --region eu-west-2 --profile vamberic-admin --query 'Stacks[0].Parameters[?ParameterKey==`ApiImageTag`].ParameterValue | [0]' --output text)
   npx cdk deploy VambericDevApi --exclusively -c environment=dev --profile vamberic-admin --parameters "VambericDevApi:ApiImageTag=$CURRENT_API_IMAGE_TAG" --previous-parameters true
   ```

   Expect only the reviewed HVM environment additions/task-service update; stop on unrelated changes. Do not reset the image parameter, secret or enquiry routes.

2. **Backend deploy**. From platform-api after reviewed commits reach main: `gh workflow run deploy-dev.yml --ref main`. This runs the existing validation/image-only API deployment and Vapp job; wait for success. No schema/provisioning command.
3. **Backend health/readiness**. Require HTTP 200 on `https://api.vamberic.com/health` and `/ready`, JSON `status=ready`, `dependencies.mongodb=available`. Confirm the desired immutable task image and HVM ECS environment are active. Do not paste tokens or credentials into logs.
4. **HVMapp certificate and hosting**. In infrastructure:

   ```sh
   npx cdk diff VambericHvmAppCertificate VambericHvmApp -c environment=dev -c hvmApp=true --profile vamberic-admin
   npx cdk deploy VambericHvmAppCertificate --exclusively -c environment=dev -c hvmApp=true --profile vamberic-admin
   ```

   While certificate creation waits for DNS, in a second terminal:

   ```sh
   HVMAPP_CERTIFICATE_ARN=$(aws cloudformation list-stack-resources --stack-name VambericHvmAppCertificate --region us-east-1 --profile vamberic-admin --query 'StackResourceSummaries[?ResourceType==`AWS::CertificateManager::Certificate`].PhysicalResourceId | [0]' --output text)
   aws acm describe-certificate --certificate-arn "$HVMAPP_CERTIFICATE_ARN" --region us-east-1 --profile vamberic-admin --query 'Certificate.DomainValidationOptions[].ResourceRecord'
   ```

   Add the returned validation CNAME externally, wait for ISSUED and certificate-stack completion, then:

   ```sh
   npx cdk deploy VambericHvmApp --exclusively -c environment=dev -c hvmApp=true --profile vamberic-admin --parameters "VambericHvmApp:CertificateArn=$HVMAPP_CERTIFICATE_ARN"
   aws cloudformation describe-stacks --stack-name VambericHvmApp --region eu-west-2 --profile vamberic-admin --query 'Stacks[0].Outputs'
   ```

5. **HVMapp build/deploy**. Configure protected GitHub Environment/variables from outputs, then in hvm-app run `gh workflow run deploy.yml --ref main`. Wait for build, upload and invalidation. For local validation only: `npm ci && npm run check && npm test && npm run build && node scripts/check-build.mjs` with the production example loaded (no secrets).
6. **DNS routing**. Set only `app` CNAME to the new CloudFront distribution; verify HTTPS and direct refreshes for every documented route.
7. **Cognito login**. Sign in as Aly through the HVM client; verify code/PKCE callback and sign-out URI, no CSP/CORS errors. Never copy access/refresh tokens into reports.
8. **HVM context smoke**. Through the authenticated browser, `/api/v1/hvm/context` must return `application=hvmapp`, Aly's subject and both independently authorized contexts. Test a no-membership identity only if an existing suitable test user is available; do not create one implicitly.
9. **Queen view**. HVM Partner → one HVM workspace; refresh `/queen/clients/<workspaceId>`; arbitrary workspace IDs denied.
10. **Client view**. Switch without logout; HVM Brand/domain, admin membership, no approved kit/integrations/capabilities; refresh all client routes. Vapp-only API routes remain denied.
11. **Onboarding read/write smoke**. Under explicit approval for a live write, use Setup to save the reviewed workspace/Brand values, reload and verify persisted values and audit event. A save is a real audited mutation even when values are unchanged. Verify conflict handling without overwriting someone else's update. Do not seed kits/integrations/commercial data merely for presentation.
12. **Public HVM enquiry routing last**. Only after the above pass, separately approve the Product→workspace/Brand mapping and public-site verification. It remains disabled in this preparation.

Remaining rollout dependencies are certificate issuance/DNS records, creation of hosting/role and GitHub environment variables, reviewed commits and the above separately approved deployments/live smoke tests. Existing source-level validation is not evidence of deployed Cognito/browser success.

## Preparation validation results

Backend: API lint, workspace typecheck/build, 259 API tests and diff check passed. Existing Vapp chunk-size warning remains. HVMapp: Node 20 check (TypeScript/ESLint), 80 tests, production build, built-config/credential-pattern inspection and diff check passed. Infrastructure: build/lint, 35 tests, opt-in offline synthesis and diff check passed. Workflow YAML/manual-only trigger and embedded shell syntax passed. The existing network synthesis emits availability-zone warnings; HVMapp adds no network resources. No live Cognito login, browser API session or write smoke was attempted.

Additional read-only checks found no CloudFront distribution already claiming `app.h-v-m.agency` and no HVMapp GitHub Environments. These remain later creation/configuration steps, not duplicated resources.
