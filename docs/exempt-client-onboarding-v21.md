# Exempt client onboarding — unapplied v21

Status: local implementation, not a live activation or migration authorization.

## Approved boundary

Queen owners prepare Partner-scoped pre-client declarations and a versioned exempt proposal. The proposal records zero customer charge for HVM Platform and Agent services, internal treatment and exclusion of direct external services. Zero is currency-independent; this is not a fabricated paid tariff, payment, invoice or subscription. Paid pricing/Stripe remain inactive. Website URLs and growth expectations remain declarations, not verified evidence or permission to retrieve a website.

Empress independently approves the exact onboarding identity, Partner, intake/base-package revision and digest, and proposal revision and digest. Approval lasts exactly seven days. A changed intake/base package invalidates approval; changed persisted proposal/binding fails closed. An expired approval needs a fresh decision. Approval revision numbers remain monotonic with the onboarding revision. No Empress workspace membership is inferred.

An active Partner owner then provisions exactly an Organisation, client workspace, Brand and primary Partner assignment. The existing workspace billing exemption retains the approval actor/time/reason and scope. After provisioning it persists until independently revoked through existing Empress workspace billing governance. Pre-client revocation cannot rewrite a completed provisioning receipt.

No client membership, Agent grant/configuration, campaign, integration or execution authority is created. The owner obtains only the authority already defined by the existing primary assignment policy. Marketing stays inactive. The user must onboard Built Matters through the real app later; no Built Matters or other live records were created here.

## Persistence and authority

`client_onboardings` stores bounded current state with a revision and real-write execution serial. `events` remains append-only audit, with a complete snapshot on each successful transition, authenticated actor, request scope/digest and exact final canonical identities. `client_onboarding_changed` is reserved against generic event insertion. No new generic CRM CRUD resource is exposed.

Every mutation/replay checks the HVM issuer/client and human identity. Queen requests require the exact active owner membership and active Partner; real writes lock both authority records. Empress requests use the existing server allowlist, independently from workspace authority. Provisioning also verifies the approval issuer remains allowlisted in the current server configuration. The server allowlist is existing deployment configuration, not a newly invented transactional permission store.

Approval, revision, revocation, provision and replay serialize through the same onboarding document. The whole provisioning package, workspace exemption, state update and event receipt commit in one Mongo transaction. Any insert failure rolls back all writes. The create scope is unique and actor/Partner/request-key bound; changed request-key payload reuse fails. Exact retries return current state without reapplying an earlier approval. Completed Queen replays also recheck and lock the current workspace/assignment. Database transaction retry does not silently rebase a stale expected revision.

The existing direct Queen provisioning endpoint continues to reject schema21. The new screen uses only the commercial onboarding endpoint; it does not retain a hidden fallback to the legacy creator. Operator/bootstrap provisioning was not widened. No policy to bypass commercial admission was introduced.

## API and app

Queen routes: GET/POST `/api/v1/hvm/partners/:partnerId/client-onboarding`, POST on `/:id`. Empress routes: GET `/api/v1/hvm/empress/client-onboarding`, POST on `/:id`. Lists use bounded ID cursor pagination (50 items); unknown queries/fields and cross-role actions fail closed. Errors remain sanitized by the HVM router.

The existing Queen onboard-client destination now collects intake/base-package details, creates the exempt proposal, shows current approval, permits revision and provisions an approved client. Empress has a separate pre-client approval queue with exact declarations, decision reason, expiry and revocation. Unknown mutation outcomes preserve the exact request for retry. Definitive conflicts require refresh before another decision. Partner/actor changes unmount private state and abort old requests. Opening a new workspace uses existing route-triggered access rediscovery, not an optimistic grant.

## Migration and compatibility

Ordered dependency remains schema11 → v12 → v13 → v14 → v15 → v16 → v17 → v18 → v19 → v20 → **v21**. All earlier frozen definitions remain unchanged. The unimplemented e-c Queen-onboarding proposal no longer reserves21; choose a later free version when that follow-up is implemented. e-c setup remains tracked and is not discarded.

Migration `021-exempt-client-onboarding` adds only:

- `client_onboardings` collection and strict/error structural validator;
- `id_unique` unique `{id:1}`;
- `create_scope_unique` unique `{createScope:1}`;
- `partner_id` `{partnerId:1,id:1}`.

No existing collection/index/validator is changed by this target; no backfill. The fixed v21 runner requires exact ordered v20 (or already installed v21), exact installed canonical validators and strict/error mode. Wrong ledger, unexpected validator/mode or incompatible existing data stops before writes. The general/default setup target remains pinned to20; the explicit compiled artifact is `artifacts/api-server/dist/migrations/v21/db-setup.mjs`. Building that artifact does not run it.

The new service requires21. Existing HVM context and workspace billing now accept21 against their unchanged canonical validators. The subsequent PSU v21 integration review qualified the existing Agent, operating, Hive and canonical-support schema gates by comparing all v20 validators/indexes and running v21 offline lifecycles. Unknown22 still fails closed. Production capacity, real-provider preparation and worker composition remain unavailable by default; a coherent live PSU/API/worker release still needs qualification before activation. See `release-reviews/psu-v21-integration-readiness/RELEASE-PLAN.md` in the parent workspace.

Mongo checks structure/types, bounded fields, literals, identities and numeric limits. Application-only checks include authenticated authority, exact digest/reference binding, seven-day interval/current time, state transitions, idempotency, ownership and transaction semantics. The structural validator alone confers no authority. In-memory migration/snapshot tests are not installed-Mongo parity or native replica-set concurrency proof.

## Verification and remaining gates

Exact results, files, Git statuses, preservation evidence and logs: `release-reviews/exempt-onboarding-v21` in the parent workspace. Earlier review history remains in `release-reviews/preclient-onboarding-foundation/REVIEW.md` with an appended continuation.

Before release: restore/recovery readiness (deferred, not waived), authorized ordered migrations with native validator/parity checks, coherent API/frontend release review and authorization, and real role-based smoke tests. PSU still needs trusted production preparation/capacity/worker composition, consistent internal cost denomination and separate activation approval. Existing inactive Runtime composition is preserved and tested; no new live provider path is claimed. No customer per-Run budget UI or artificial pilot was added.

No credentials, provider/website/Stripe calls, notifications, live data writes, AWS/Atlas changes, migration application, Agent activation, deployment, staging, commits or pushes occurred.
