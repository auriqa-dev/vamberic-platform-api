# HVMapp Phase 1 backend foundation — schema v5 proposal

Schema v6 adds workspace-owned Offering, ICP and Buyer Profile definitions. See [Hive definitions](hive-definitions.md) for the additive setup, revision/approval API and v5/v6 runtime compatibility. The phase-1 description below records the original v5 rollout.

Hive is shared storage, Vapp is portfolio/operator oversight, HVMapp operates authorized client workspaces. No deployment, provisioning, migration apply, payments, agent implementation or frontend/website changes are part of this task.

## Trusted application identity and infrastructure prerequisite

Vapp continues to use `COGNITO_CLIENT_ID`. Configure a **different public SPA app client in the existing Cognito user pool** and pass its ID as `HVM_COGNITO_CLIENT_ID`. JWT verification uses the pool's trusted JWKS, RS256, issuer, expiry, access `token_use` and allowed `client_id`. Verified client ID determines application; browser headers/query/custom claims cannot select it. Equal Vapp/HVM client IDs are rejected at startup. Set `HVM_AUTH_ENABLED=true` to require `HVM_COGNITO_CLIENT_ID` at startup; there is no Vapp fallback. Explicit `false` disables HVM authentication. For backwards compatibility, omitting the flag enables HVM only when its distinct client ID is provided.

The existing `hvmapp-web` public SPA client in pool `eu-west-2_CogD1Prpz` is configured in the environment examples. It has no secret and uses authorization code with PKCE and `openid email profile`. Production callback is `https://app.h-v-m.agency/auth/callback`, logout is `https://app.h-v-m.agency/`; local callback is `http://localhost:5173/auth/callback`, logout is `http://localhost:5173/`. The shared pool hosted-login domain is `https://vamberic-dev-vapp-755905325223.auth.eu-west-2.amazoncognito.com`; its name does not select the Vapp client. HVMapp sends its **access token**, not ID token. Same-pool identities preserve issuer/subject continuity. No AWS resources were changed.

Server CORS: `HVM_CORS_ORIGINS=https://app.h-v-m.agency,http://localhost:5173` uses comma-separated explicit origins, no wildcards. `CORS_ORIGINS` continues to describe Vapp, `PUBLIC_ENQUIRY_CORS_ORIGINS` the unauthenticated product website. CORS is not authorization. Both authenticated browser origin lists are accepted by the API; token-derived app/workspace policy remains the boundary.

## Durable access resolution

HVM requests require schema v5, trusted HVM application identity and a human actor. `GET /api/v1/hvm/context` reads durable records afresh per request; writes resolve again inside their transaction. No token membership claims or process-wide membership cache.

Partner path: exact issuer/subject → active/unarchived `hvm_partner_memberships` → active/unarchived `hvm_partners` → active/unarchived `workspace_partner_assignments` → unarchived client workspace. Invalid records fail closed. Owner maps to central `admin`; member maps to `onboarder`. Both primary/supporting assignments represent responsibility, not entitlements. An agency may have multiple humans and a Partner may operate multiple clients. Ending membership/assignment or suspending/ending a Partner removes that access on the next request. In-flight reads may complete; current grants are not a retroactive revocation mechanism.

New `workspace_memberships` independently represents client-user access: `workspacemembership_…`, workspaceId, strict human `{type:"human", issuer, id}`, optional Person reference, role `admin | member`, status `active | ended`, joinedAt/endedAt, addedBy and base timestamps/provenance. Active membership uniqueness is workspace + issuer + subject. Ended records remain history. Dates follow the existing Partner-membership lifecycle. `admin` maps to central admin, `member` to viewer. Optional Person references are not authentication; existing hard-delete safeguards retain referenced membership history. The provisioning API does not accept arbitrary Person links.

A human may have both independent access paths. Revoking Partner access does not revoke an independent client membership. Context returns application/human, safe Partner summaries with assigned workspace IDs, client contexts and workspace names/effective roles. It returns no raw CRM records or secrets. A no-access HVM user receives empty workspace/context arrays. Resolver bounds: at most 200 memberships and 200 assignments per Partner; excess scope fails closed pending pagination support.

Minimal central policy:

| Effective role | Rights                                                                            |
| -------------- | --------------------------------------------------------------------------------- |
| viewer         | Workspace reads                                                                   |
| onboarder      | Reads; workspace profile, Brand, draft-kit and integration metadata create/update |
| admin          | Above plus kit approve/retire and client membership provision/revoke              |

No HVM hard delete, entitlement purchase/write or capability execution permission is added. Existing generic operator/service contracts remain; the durable Partner resolver emits the narrower onboarding role. Agents/system actors continue to require explicit resource/action/workspace grants and cannot use the human HVM routes.

## HTTP contract

All private routes require `Authorization: Bearer <HVM access token>` and JSON writes. Base: `/api/v1/hvm`. Responses are `Cache-Control: no-store`. Invalid input 400, unauthorized/missing scope 404, stale/conflicting state 409, unavailable storage/schema 503; errors contain no raw driver/provider objects or input. Reads return 200; successful writes return 200 with `{id, updatedAt}`. Collection views are bounded to 100 records and return conflict when exceeded rather than silently truncating. Pagination is required before larger workspaces.

| GET route                                       | Response                                                                                                |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `/context`                                      | Human, application, Partner/client contexts, available workspace roles                                  |
| `/integration-providers`                        | Supported client-owned provider identifiers                                                             |
| `/workspaces/:workspaceId/overview`             | Workspace summary, safe client Organisation, active Partner summaries, Brand/approved-kit counts        |
| `/workspaces/:workspaceId/brands`               | Workspace Brand metadata                                                                                |
| `/workspaces/:workspaceId/brands/:brandId/kit`  | Current approved Brand Kit, approved assets and derived readiness; 404 if none                          |
| `/workspaces/:workspaceId/brands/:brandId/kits` | Workspace Brand's drafts/current/history for onboarding; no cross-Brand guesses                         |
| `/workspaces/:workspaceId/integrations`         | Allowlisted non-secret connection metadata/readiness; no secretReference, error payloads or credentials |
| `/workspaces/:workspaceId/team`                 | Client membership summaries, active Partner assignment summaries; no unrelated agency roster            |
| `/workspaces/:workspaceId/capabilities`         | Scoped instance/entitlement summaries and derived entitlement access; no pricing/purchase operations    |
| `/workspaces/:workspaceId/enquiries`            | Authorized workspace leads and opportunities                                                            |

Writes use `POST /workspaces/:workspaceId/<operation>`. IDs, scope, audit actors, lifecycle dates and legal Organisation linkage are server controlled. Dates in request preconditions are ISO timestamps returned from the last read/write.

| Operation                | JSON body                                                                                                                  |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `profile`                | `{name, expectedUpdatedAt}`; changes workspace name only, never global Organisation data                                   |
| `brand-create`           | `{name, slug, primaryDomain?, description?}`; Organisation derived from workspace                                          |
| `brand-update`           | `{id, expectedUpdatedAt, changes:{name?, slug?, primaryDomain?, description?}}`                                            |
| `kit-create`             | `{brandId, content:{…}, sourceKitId?}`; optional same-Brand kit clone, always draft                                        |
| `kit-update`             | `{id, expectedUpdatedAt, content:{…}}`; draft only                                                                         |
| `kit-approve`            | `{id, expectedUpdatedAt, replacesKitId?}`; draft only; exact current approved ID required when replacing                   |
| `kit-retire`             | `{id, expectedUpdatedAt}`; current approved only                                                                           |
| `integration-create`     | `{provider, displayName, externalAccountId?, externalTenantId?}`; always pending                                           |
| `integration-update`     | `{id, expectedUpdatedAt, changes:{displayName?, externalAccountId?, externalTenantId?}}`; pending only, provider immutable |
| `integration-disconnect` | `{id, expectedUpdatedAt}`; preserves historical configuration/reference                                                    |
| `member-provision`       | `{human:{type:"human",issuer,id}, role:"admin"                                                                             | "member"}`; configured issuer, explicit known Cognito subject, no email invite |
| `member-revoke`          | `{id, expectedUpdatedAt}`; ends membership, self-revocation refused                                                        |

Kit `content` accepts colours, typography, visualRules, voice, terminology, descriptions, imageryGuidance and emailDefaults using existing bounded Brand Kit schemas. It rejects id/workspace/approval/audit fields. Product copy and reply-to ContactPoint links must resolve within the same workspace/Brand. Raw asset references are not accepted because no trusted upload/asset registry exists. An authorized same-Brand clone may retain existing reviewed references; no S3 fetch or signed URLs are generated. Approval preserves the partial unique index and retires the old approved kit in the same transaction. A stale replacement ID fails 409; a failed transaction retains the prior approved kit. Full historical version management remains deferred.

All writes require transactions, freshly resolve access and serialize through the selected workspace's updatedAt write, giving concurrent supported membership revocations/kit changes a common conflict boundary. `expectedUpdatedAt` protects record edits. Future Partner/membership administrative writers must use the same coordination protocol; no such edit API is exposed here. Successful changes append a canonical scoped Event carrying human, application, workspace, resource/action and time. Reads do not create audit events. Provider errors, request bodies and secrets are not audit payloads.

## Integrations and AI boundary

Supported Phase 1 client providers: `odyssiant`, `lusha`, `postmark`, `hubspot`, `ga4`, `ahrefs`, `google_ads`, `linkedin`, generic `crm` and `social`. Domain provider strings remain extensible; onboarding APIs use this deliberate allowlist. New metadata remains pending. No raw secrets, secretReference, scopes, provider errors or connected-state claims can be submitted. A future server credential endpoint must authorize workspace, create/validate restricted Secrets Manager references and verify connections before setting connected.

**Odyssiant has no API.** Its pending record can label an existing account; no endpoints, scopes, authentication or sync contracts are invented. Connection readiness is false for Odyssiant.

**OpenAI/model providers, AWS and Mongo are platform infrastructure, not client integrations.** HVM clients never enter model keys. Future HVM agents call the Vamberic AI Runtime/Model Gateway, which owns credentials in secure server configuration/Secrets Manager, meters usage internally and can route to OpenAI, private/open models, Hugging Face-hosted or Vamberic-hosted models. AI usage is included in capability economics for now; metering is future platform work. No model gateway, token billing or provider calls are implemented here.

## Self-client provisioning — do not execute yet

Operator-only `hvm:provision` works for HVM or any external client, with no HVM-name special case. It requires schema v5, an existing active internal Organisation reference (or an explicitly supplied legal Organisation name and new stable ID), a verified Cognito issuer/subject and explicit stable IDs in a reviewed JSON manifest. It can create the explicitly named Organisation when absent, then creates Partner, owner membership, client workspace, primary assignment, Brand and optional client-admin membership transactionally. It does not create Brand Kit content, capabilities, subscriptions, entitlements, integrations or Products. The same manifest is idempotent; identity/state conflicts abort instead of overwriting or reactivating ended records. Store/reuse the manifest IDs rather than regenerating them on retry.

Manifest (replace placeholders with real canonical IDs and verified human identity; no secrets):

```json
{
  "organisationId": "org_<existing or new stable ULID>",
  "organisationName": "<explicit legal name; omit when referencing an existing Organisation>",
  "workspaceId": "workspace_<new stable ULID>",
  "partnerId": "partner_<new stable ULID>",
  "partnerMembershipId": "partnermembership_<new stable ULID>",
  "assignmentId": "partnerassignment_<new stable ULID>",
  "brandId": "brand_<new stable ULID>",
  "clientMembershipId": "workspacemembership_<optional stable ULID>",
  "workspaceName": "HVM",
  "partnerName": "HVM Partner",
  "brandName": "HVM",
  "brandSlug": "hvm",
  "brandPrimaryDomain": "h-v-m.agency",
  "human": {
    "type": "human",
    "issuer": "https://cognito-idp.eu-west-2.amazonaws.com/eu-west-2_CogD1Prpz",
    "id": "<verified Cognito sub>"
  }
}
```

`brandPrimaryDomain` is optional and uses the canonical Brand domain validation (bare domain, not a URL). When supplied, it is checked on repeat provisioning: a different or missing stored domain causes a conflict rather than overwriting the Brand. Omitting it preserves compatibility with older manifests and does not change an existing domain.

Remove clientMembershipId if independent client access is not wanted. Use the actual legal Organisation; no ID/name is guessed. If the reviewed ID is new, organisationName is required; an existing archived or workspace-owned ID is rejected. Generate canonical IDs using the existing domain `generatePlatformId` helper and retain them in the manifest. The human is supplied by the operator after verification, never assumed from AWS SSO identity.

Later command **inside the existing secure loader**, after explicit provisioning approval:

```text
pnpm --filter @workspace/api-server hvm:provision --input /absolute/path/hvm-client.json --apply
```

Use the Python loader in [hvm-partners.md](hvm-partners.md#secure-later-apply-invocation--not-executed), replacing only its subprocess argument list with `['pnpm','--filter','@workspace/api-server','hvm:provision','--input','/absolute/path/hvm-client.json','--apply']`. It retrieves dev `MONGODB_URI` from `vamberic/dev/api` with profile `vamberic-admin`, region eu-west-2; nothing prints/persists the secret. The command refuses non-dev environments. **It was not run.**

## Public website enquiry routing and migration

Existing endpoint stays:

```text
POST /api/v1/public/products/product_01m2wffbf3p9p19d3nd1s2fp3x/enquiries
```

After provisioning, infrastructure should set the server-owned configuration:

```text
PUBLIC_ENQUIRY_WORKSPACE_ROUTES_JSON={"product_01m2wffbf3p9p19d3nd1s2fp3x":{"workspaceId":"workspace_<provisioned>","brandId":"brand_<provisioned>"}}
```

Mapping keys are validated Product IDs and values exact workspace/Brand IDs. Routing verifies active client workspace, active matching Brand and an available Product in that workspace or the existing internal portfolio catalogue. A preexisting Product brandId must agree. Bad configured mappings fail closed, never fall back to internal writes. Public callers cannot submit workspaceId/brandId. Unmapped Products retain internal enquiry behavior.

**Exact website change:** no endpoint or payload change is required if HVM already uses the above Product endpoint. Continue the existing strict enquiry JSON, attribution and explicit opt-in evidence; do not add workspaceId or Brand ID. If changing an API base URL during rollout, use the deployed API base plus this same path. Keep `PUBLIC_ENQUIRY_CORS_ORIGINS=https://h-v-m.agency` and existing Product notification recipient configuration. Frontend changes were not made.

Workspace ingestion uses `source.system = workspace_public_enquiry`. Every created Person, ContactPoint, Organisation, employment relationship, ProductRelationship, CRM Lead, Opportunity, immutable enquiry Event and explicit MarketingPermission is scoped to the resolved workspace. Dedupe queries always include that scope. Existing Person operational integrity status is preserved; no new sales lifecycle is introduced. Same email/domain across workspaces or internal CRM is independent. Repeated scoped submissions reuse the contact/person, matching Organisation, relationship, lead and open enquiry Opportunity, while appending an Event per submission and consent evidence only for explicit opt-in. Closed opportunities are not reopened. Attribution stays on immutable events. Contact writes serialize repeats; scoped partial unique indexes protect concurrent first inserts and retry the whole transaction. Notifications remain post-commit/best-effort and accepted enquiries return 201 even if delivery fails.

Old internal dedupe indexes remain unchanged. New records use a distinct source so old source-filtered global unique indexes do not conflict. No historical unscoped enquiry is moved or merged. Imported/other-source ambiguity fails closed; this is not a global identity-cleanup migration. Runtime refuses scoped enquiry writes if the new indexes are missing. Vapp's internal filters and direct-ID/delete protections remain; HVM cannot use Vapp routes.

## Additive schema v5

`005-hvm-phase1`, **4 → 5**: one new empty `workspace_memberships` collection and validator; six new indexes. No existing validators, indexes or domain records are changed/dropped. Target: 30 domain collections / 95 application indexes (excluding Mongo `_id`).

| Collection / index                                     | Keys                                                  | Constraint/access pattern                                                          |
| ------------------------------------------------------ | ----------------------------------------------------- | ---------------------------------------------------------------------------------- |
| workspace_memberships / id_unique                      | `{id:1}`                                              | Unique canonical ID                                                                |
| workspace_memberships / human_status_workspaces        | `{"human.issuer":1,"human.id":1,status:1}`            | Verified human's active client contexts                                            |
| workspace_memberships / workspace_status_members       | `{workspaceId:1,status:1}`                            | Workspace team/history                                                             |
| workspace_memberships / workspace_human_active_unique  | `{workspaceId:1,"human.issuer":1,"human.id":1}`       | Unique, partial `{status:"active"}`                                                |
| contact_points / workspace_public_enquiry_email_unique | `{workspaceId:1,normalizedValue:1,"source.system":1}` | Unique; partial email + workspace string + source workspace_public_enquiry         |
| organisations / workspace_public_enquiry_org_unique    | `{workspaceId:1,domain:1,name:1,"source.system":1}`   | Unique; partial domain string + workspace string + source workspace_public_enquiry |

No sparse indexes. Existing internal dedupe definitions remain byte-for-byte equivalent. `db:setup --dry-run` checks additive compatibility/uniqueness; schema v5 remains unapplied. Mongo validators enforce membership shape/dates; referenced Person/workspace integrity remains a trusted writer responsibility. HVM runtime and provisioning fail closed until v5 is applied. Safe rollout sequence: review code/migration → separately approve/apply v5 through secure loader → separately provision verified client records → configure Cognito client/CORS and trusted enquiry mapping → deploy under separate approval → authenticated/website smoke tests. No new migration is coupled to deployment workflows.

## Verification on 2026-09-28

Secure dev `db:setup --dry-run` succeeded against `vamberic_studio`: existing schema 4, proposed schema 5 (`upgrade-pending`), exactly one collection/validator and six indexes above. No validator conflicts, incompatible indexes, uniqueness risks or diagnostic uncertainties. Two Products remain; all other existing domain collections are empty. No live writes or provisioning occurred.

Validation passed: 256 API tests, 20 client tests, 17 deployment tests, API lint, workspace typecheck and full build, source/document formatting and `git diff --check`. Root has no lint/test scripts; canonical API lint and API/client/deployment suites were used. The existing Vapp bundle-size warning remains. API/transaction tests use local HTTP and transactional in-memory Mongo fixtures; the read-only preflight does not execute new DDL or prove live concurrent endpoint behavior. Real authenticated onboarding, replacement and enquiry smoke tests belong to the separately approved rollout after schema/configuration/provisioning.

## HVMapp authentication deployment configuration

Backend environment: retain `COGNITO_USER_POOL_ID=eu-west-2_CogD1Prpz`, the existing Vapp `COGNITO_CLIENT_ID`, and `AWS_REGION=eu-west-2`. Set `HVM_AUTH_ENABLED=true`, `HVM_COGNITO_CLIENT_ID` to the existing public `hvmapp-web` ID shown in `.env.example`, and `HVM_CORS_ORIGINS=https://app.h-v-m.agency,http://localhost:5173` (production may omit localhost). These variables must be injected into the API deployment environment; this change does not deploy them. Vapp `CORS_ORIGINS` and website `PUBLIC_ENQUIRY_CORS_ORIGINS` remain independently configured. No wildcard origins are supported.

In sibling `hvm-app`, `.env.example` supplies explicit local values and `.env.production.example` supplies production values. Public build variables are `VITE_APP_ENV`, `VITE_API_BASE_URL`, `VITE_COGNITO_REGION`, `VITE_COGNITO_USER_POOL_ID`, `VITE_COGNITO_CLIENT_ID`, `VITE_COGNITO_DOMAIN`, `VITE_AUTH_CALLBACK_URL`, and `VITE_AUTH_LOGOUT_URL`. The production API origin is `https://api.vamberic.com`. No client secret belongs in Vite configuration. HVMapp never falls back to backend or Vapp client variables.

The existing PKCE flow and session restoration are retained. Local and production callbacks/logout must match their selected environment exactly. Automated tests verify client selection, callback settings, restoration and logout with mocked OIDC operations; a real hosted-login exchange requires a separately deployed/configured API and browser smoke test. The frontend still uses its existing pending workspace gateway, so configuring sign-in alone does not wire its screens to live HVM APIs.

A verified HVM access token resolves only to `hvmapp`: application headers/custom claims cannot override identity, unknown clients are rejected, and HVM cannot call Vapp-only routes. `/api/v1/hvm/context` returns empty access lists for a valid human with no memberships, while workspace access fails closed. No access records are fabricated. Next provisioning step is a separately reviewed explicit manifest with the verified Cognito issuer/sub and stable Organisation, Partner, workspace and Brand IDs, using the operator-only command above through the secure dev loader.
