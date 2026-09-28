# Partner accounts, memberships and workspace integrations — unapplied v3

Hive stores shared platform data. Vapp provides portfolio/operator oversight. HVMapp will operate authorized client workspaces. A client workspace is the operational/data/commercial context; these terms do not assert legal ownership. Products remain portfolio products, capabilities reusable functions, instances configured capability use, packages bundles, entitlements functional access and billing treatment a separate commercial decision.

## Partner account and authenticated humans

`hvm_partners` remains a neutral business/operating account behind the external **Swarm Queen** role. It can represent a consultant, agency or other business. Optional Organisation and primary Person references, display name, status, timestamps and provenance remain unchanged. Neither Person nor Organisation is required to establish its canonical Partner identity.

New `hvm_partner_memberships` fields:

- `id`: `partnermembership_…`; `partnerId`: canonical `partner_…`.
- `human`: strict `{type: "human", issuer, id}`. `id` is the verified subject, namespaced by issuer, never an email or Partner ID. Existing actor semantics are retained.
- Optional `personId`: internal Person registry reference; not an authentication grant.
- `role`: `owner | member`; `status`: `active | ended`.
- Required `joinedAt`, `createdAt`, `updatedAt`; optional `endedAt`, `addedBy` (issuer-qualified human), base archive/provenance fields.

There is no invitation workflow. Joined time cannot exceed updated time; ended status requires endedAt between joinedAt and updatedAt; other statuses forbid endedAt. Only ended memberships may be archived. Updated time cannot predate created time. Imported relationship dates may predate creation. A human may belong to multiple Partners; one active membership per Partner/issuer/subject is enforced by a partial unique index. Ended memberships remain history, allowing a later membership with a new ID. No owner-count or complex RBAC rules are inferred.

Partner membership answers who belongs to a Partner. `workspace_partner_assignments` separately answers which client workspace it operates, with existing primary/supporting roles. Future access resolution is verified human → active membership → eligible Partner → active assignment → workspace → central authorization → capability/integration access. No new resolver, endpoint or automatic grant is introduced. The specific human remains the event actor. Owner/member and primary/supporting roles do not automatically translate to viewer/operator permissions.

Optional membership Person references are checked in pure proposed-state validation and protected by existing CRM hard-delete blockers, including ended history. Future trusted transactional writers must recheck references, immutable identity fields and authorization; schemas cannot authenticate the author of a record.

## A Partner can independently be a client

The same Organisation may be referenced by both a Partner and a client workspace, without a mutually exclusive type/status constraint. Its Partner may operate that workspace and other clients. Subscriptions, entitlements, packages, charges and integrations belong to the workspace/commercial context, never to the operating Partner. Ending an assignment or membership does not mutate client records, credentials, Products or capability instances. Independent client-user permissions can remain after Partner-derived access ends.

**e-c example (documentation only):** Organisation e-c; Partner e-c; members Tom plus future staff; its own client workspace e-c plus assignments to Agreus and future client workspaces. The e-c workspace can purchase Offer, Strategy/ICP, Lead Gen and other capabilities independently of its Partner status. Connections may include Odyssiant, Lusha, Postmark, HubSpot/CRM, GA4 and multiple ad accounts.

**Built Matters example (documentation only):** a client workspace with capability entitlement/charge treatment `internal`, integrations as required and an assigned Partner. Changing Partner leaves client data and connection configuration in place. HVM, Odyssiant and external clients use the same schema. No records are seeded.

## Generic workspace connections

New `workspace_integrations` fields:

| Field                                   | Contract                                                                                                 |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `id`, `workspaceId`                     | Required canonical `integration_…`, `workspace_…`                                                        |
| `provider`                              | Lowercase identifier matching `^[a-z][a-z0-9_]{0,63}$`; extensible, not an enum                          |
| `displayName`                           | Required label, 1–200 characters                                                                         |
| `externalAccountId`, `externalTenantId` | Optional non-secret identifiers, 1–200 characters                                                        |
| `status`                                | `pending                                                                                                 | connected | error | disconnected` |
| `scopes`                                | Provider-specific strings, unique, at most 100 entries of 1–200 characters; defaults empty               |
| `secretReference`                       | Optional AWS Secrets Manager secret ARN; never secret contents                                           |
| `connectedAt`, `connectedBy`            | Optional connection date and issuer-qualified human; connected state requires date, author requires date |
| `disconnectedAt`                        | Required exactly when disconnected; historical connection and reference remain                           |
| `lastSyncAt`, `lastSuccessfulSyncAt`    | Optional observation times; success cannot exceed last attempt                                           |
| `errorCode`                             | Optional safe identifier matching `^[A-Za-z][A-Za-z0-9_]{0,63}$`; no raw message                         |
| Base fields                             | Creation/update, source/provenance, archive fields                                                       |

Pending has no connectedAt; disconnected time cannot predate connected time. Sync times require connectedAt and cannot predate it. All observation dates must be at or before updatedAt; updatedAt cannot predate createdAt. Only disconnected records may be archived. Reconnection is not implemented; future writers must define/reset session observation dates consistently. Connected status describes configuration, not authorization or proof of provider availability.

Multiple connections for the same provider/account are allowed. Canonical integration ID distinguishes them. No unsafe provider/account uniqueness is assumed. Lookup by a known ID must also filter by authorized workspaceId; account IDs and provider names never grant access. No speculative account discriminator is required before actual providers exist.

`provider: "odyssiant"` is ready now with optional account/tenant identifiers and a secret reference. No Odyssiant payloads, API fields, sync, Product/ICP logic or calls are invented. Other named providers and future providers use the same collection.

## Secret handling and metadata limits

Credentials live in **AWS Secrets Manager**. Mongo stores only a reference matching:

```text
^arn:aws:secretsmanager:[a-z]{2}(?:-[a-z]+)+-\d:\d{12}:secret:[A-Za-z0-9/_+=.@-]{1,512}$
```

Strict Zod and Mongo top-level schemas exclude raw API keys, access/refresh tokens, passwords, client secrets, raw errors, headers and arbitrary metadata. No free-form provider metadata is currently needed; add reviewed bounded non-sensitive fields when a real integration requires them. Human-written labels/source identifiers must never contain secrets: pattern validation cannot determine the meaning of arbitrary text. Future adapters must allowlist fields, sanitize provider errors and never copy credential payloads into provenance or logs. No credential creation, resolution or logging is implemented. A valid ARN neither proves existence nor authorizes credential access; a future trusted adapter must enforce permitted secret scope through central authorization and AWS permissions.

Vapp cannot operate workspace integrations. Future HVMapp must use central authorized workspace filters; Partner membership or assignment alone is insufficient. Service/system actors require explicit resource/action/workspace grants. Client workspace connections persist when its Partner changes.

## New indexes in this refinement

All are managed by canonical `db:setup`; none is sparse.

| Collection / index                                       | Keys                                          | Unique / filter             | Query or invariant                                              |
| -------------------------------------------------------- | --------------------------------------------- | --------------------------- | --------------------------------------------------------------- |
| hvm_partner_memberships / id_unique                      | `{id:1}`                                      | Unique, none                | Canonical membership/history lookup                             |
| hvm_partner_memberships / partner_status_members         | `{partnerId:1,status:1}`                      | No, none                    | Active/ended Partner roster                                     |
| hvm_partner_memberships / human_status_partners          | `{"human.issuer":1,"human.id":1,status:1}`    | No, none                    | Active memberships for a verified issuer/subject                |
| hvm_partner_memberships / partner_human_active_unique    | `{partnerId:1,"human.issuer":1,"human.id":1}` | Unique, `{status:"active"}` | One active relationship; ended history remains                  |
| workspace_integrations / id_unique                       | `{id:1}`                                      | Unique, none                | Specific connection lookup, with authorized workspace predicate |
| workspace_integrations / workspace_status_integrations   | `{workspaceId:1,status:1}`                    | No, none                    | Workspace connected/error/pending/history list                  |
| workspace_integrations / workspace_provider_integrations | `{workspaceId:1,provider:1}`                  | No, none                    | Workspace provider connection list, including multiple accounts |

## Migration and validation boundary

This extends still-unapplied `003-commercial-foundation`, **2 → 3**, not v4. Total: **8 new empty collections, 9 validators, 23 indexes**; resulting **27 domain collections / 84 application indexes**, excluding Mongo `_id` indexes. New collections: capabilities, capability_instances, commercial_packages, commercial_charges, hvm_partners, workspace_partner_assignments, hvm_partner_memberships, workspace_integrations. Validators cover those eight plus the existing additive entitlement refinement. Existing Products, workspaces, subscriptions and transactions are unchanged; no records are rewritten, inferred or seeded.

The two new collection validators enforce document structure and lifecycle timestamps. Cross-document references remain trusted service checks, not foreign keys. Existing migration conflict/uniqueness checks and idempotent retry behavior remain. Dry-run inspects existing state but does not execute DDL for new collections, exercise provider adapters or prove future authorization resolution.

For the exact future secure apply command, see [secure later apply invocation](hvm-partners.md#secure-later-apply-invocation--not-executed). It retrieves `vamberic/dev/api` using `vamberic-admin` in eu-west-2 and passes credentials only to the db:setup child process. **Do not run until explicitly approved.** No apply, deploy, commit or push is part of this task.

Verified on 2026-09-27 with Node 24.21.0 / pnpm 10.26.1: API lint, workspace typecheck/build, 233 API tests, 20 Vapp/client tests, 17 deployment tests, formatting and diff checks passed. Root has no lint/test script; the existing API lint and API/client/deployment suites were used. The existing Vapp chunk-size warning remains.

Secure read-only dev preflight succeeded against `vamberic_studio`, using the existing `vamberic-admin` profile and `vamberic/dev/api` secret. Current version is 2; planned version 3 has exactly the eight collections, nine validators and 23 indexes above. No validator conflicts, incompatible indexes, uniqueness risks or diagnostic uncertainties were reported. Two Products remain; all other current domain collections have zero documents. No Mongo state was changed. The revised v3 proposal is ready for explicit apply review; future HVM runtime authorization and credential adapters remain separate work before operational use.

Phase 1 API implementation and the client-user membership refinement are described in [HVM Phase 1 backend](hvm-phase1-backend.md). OpenAI/model providers, AWS and Mongo are platform infrastructure, not client-owned integrations. Odyssiant has no API and is metadata/pending only.
