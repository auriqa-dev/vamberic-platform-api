# Workspace Hive definitions (schema v6)

Offering is factual client knowledge: what exists, what the customer buys and how it is supplied. It is not Product, a future market-facing Offer, an agent or a capability output. Ideal Customer Profile defines reusable fit; Buyer Profile describes a buying archetype, not an actual CRM Person. All three remain independent of capability enablement.

## Ownership and contracts

Canonical collections are `offerings`, `ideal_customer_profiles`, `buyer_profiles`, and `hive_definition_revisions`. IDs use the registered `offering_`, `icp_`, `buyerprofile_` and `hiverevision_` prefixes with the existing ULID suffix. Base `schemaVersion` remains structural document version 1; the database setup target advances from 5 to 6.

Each current definition has required workspace ownership, immutable relationships, BSON timestamps/server human actors, `revision`, `status`, `contentHash`, bounded `evidence`, and a strict `definition` content object. Offering's Organisation comes from the authorized client workspace, never the request. The optional single Brand must be active and match both workspace and client Organisation. There is no slug or display-name uniqueness. An ICP belongs to one Offering; a Buyer Profile explicitly references that same Offering and one ICP. Reparenting is unsupported.

Offering classification keeps business model, offering type, delivery modes and implementation/mobilisation model separate. Software, installed technology, products, people-led services, advisory, managed operations, financial products and hybrids are supported without software assumptions. Free-text business/commercial context avoids incorrectly treating an enum as factual knowledge.

ICP `profileType` is `b2b`, `b2c` or `d2c`. B2B firmographics live in `definition.accountProfile`; consumer demographics/behaviour live in `definition.consumerProfile`. Using the wrong profile branch is rejected. General `characteristics` and fit/context lists complement firmographics. Buyer buying roles share the exact vocabulary used by Opportunity participants.

Strings are trimmed and bounded; content lists are bounded; a current definition is limited to 200KB by the domain parser. Most lists have at most 40 entries of 2,000 characters; names are limited to 200 and descriptions to 10,000. No generic capability output or unrestricted metadata is used for content. HTTP dates are ISO strings; persisted dates are BSON Date.

## Revisions and approval

1. Create revision 1 in `draft`.
2. Replace draft `definition` through an explicit human update with `expectedUpdatedAt`.
3. `approve` is an authorized human-only operation. In one transaction it inserts an immutable approved snapshot and marks the current revision approved, with `approvedAt`, `approvedBy` and `approvedRevision`.
4. Approved content cannot be edited or receive new evidence. `revise` explicitly starts revision N+1 as a draft, retaining evidence and the `approvedRevision` pointer to the last trusted snapshot. Approval metadata for the new revision is unset. The old approved snapshot remains unchanged and readable.
5. Approving the draft writes another snapshot and advances `approvedRevision`. A unique workspace/entity/revision index prevents duplicate historical identity.

`contentHash` is SHA-256 over deterministically key-sorted semantic content and immutable relationship IDs. Array order remains significant. Timestamps, evidence, actors, lifecycle and revision counters are excluded. Consequently observations do not change content identity. Revision is not `updatedAt`, schema version or Product model version. An explicit new revision can retain the same content hash; no downstream invalidation or regeneration exists.

Snapshots are immutable through supported services/routes; Mongo administrator credentials are not a tamper-proof ledger. There is no edit/delete API for history. Consumers should select an approved snapshot by `(workspaceId, entityType, entityId, revision)`; the current document can be an unapproved draft. Approval does not claim that a research agent, completeness scorer or fact checker ran.

## Evidence and provenance

One embedded evidence schema is shared by all three objects, with a maximum of 100 append-only observations per definition. This fits the bounded-document approach and keeps a revision's evidence with its approved content; there is no cross-object evidence search requirement in this phase. At the bound, writes fail rather than truncate history. Archiving or a later separately designed evidence store is preferable to silently dropping observations.

Each observation has a definition-relative field/path, bounded candidate value, `origin` (`user_supplied`, `external_evidence`, `ai_inferred`), optional provider/reference/confidence, `observedAt`, `verification` (`observed`, `human_confirmed`, `rejected`), plus server-recorded timestamp and human actor. Paths/candidates are checked against the entity's strict content schema. Examples are `whatCustomerBuys`, `characteristics` or `consumerProfile.values`. Unknown facts belong in `definition.unknowns`, not a fake evidence origin.

Observations never promote or overwrite canonical facts, even when a human confirms the candidate. Confirmation records the human's assertion about that observation; applying it to the definition requires an explicit draft edit. Evidence cannot be replaced through update input. Human edits can deliberately revise a fact; old approved content/evidence stays in history. There are no agent writers, workload authentication or automatic merge semantics in this phase. A future agent seam must not bypass this service's human checks, silently overwrite canonical content, or impersonate an approver.

## HTTP API

All paths are below `/api/v1/hvm/workspaces/:workspaceId`. Resource paths are `offerings`, `ideal-customer-profiles`, `buyer-profiles`.

| Method/path | Contract |
| --- | --- |
| GET `/:resource` | Bounded `items`, `hasMore`, `limit`, `offset`; default 20, maximum 100, offset maximum 10,000. Default excludes archived; `archived=true` lists retired records. |
| GET `/:resource/:id` | Current definition, including archived history when authorized. |
| GET `/:resource/:id/revisions/:revision` | Exact approved snapshot, also readable after archive. |
| POST `/:resource/create` | `{definition,...parentIds}`; Offering optionally accepts `brandId`; ICP requires `offeringId`; Buyer requires `offeringId` and `idealCustomerProfileId`. |
| POST `/:resource/update` | `{id,expectedUpdatedAt,definition}`; full replacement of draft content, not a metadata patch. |
| POST `/:resource/revise` | `{id,expectedUpdatedAt}`; starts next draft from approved current content. |
| POST `/:resource/approve` | `{id,expectedUpdatedAt}`; explicit human approval. |
| POST `/:resource/archive` | `{id,expectedUpdatedAt}`; retires the object, never cascades. |
| POST `/:resource/observe` | `{id,expectedUpdatedAt,evidence}`; appends one observation to a draft. |

Offering lists accept `brandId`; ICP lists accept `offeringId`; Buyer lists accept `offeringId` and/or `idealCustomerProfileId`. Unknown query/body keys are rejected. Clients cannot submit workspace/Organisation/actor/revision/hash/approval metadata. Parent IDs are exact-scope checked, not access grants. Mutation results return the current bounded domain record with ISO date serialization. Errors use sanitized HVM 400/404/409/503 envelopes.

Routes remain handwritten like the existing HVM surface; no generated Vapp contracts or frontend UI were changed. New definitions are unavailable through internal Vapp Product routes.

## Authorization and relationship safety

The existing JWT middleware must first authenticate the HVM human client. Every read resolves current HVM memberships; every mutation resolves again inside the Mongo transaction. Workspace admin/Partner owner can create/edit/approve/archive. Partner member/onboarder can create/edit/revise/observe drafts but cannot approve/archive. Workspace member/viewer can only read. Application identity, scope and actor cannot be supplied in JSON or inferred from Organisation, domain, email, Brand or Product.

Transactions touch the workspace using optimistic concurrency, sharing the lock used by existing HVM mutations. This serializes parent archival/edits and membership changes. Organisation reference writes also use the existing reference-lock counter to conflict safely with guarded deletion. All relationships, content, evidence, current state, snapshot insertion and audit events succeed or roll back together. Audit payloads contain IDs/action/revision/hash and human identity, not submitted definition/evidence contents.

Archived parents prohibit new or changed dependent definitions and approvals; children remain readable and can be explicitly archived. No cascade, restoration or ordinary hard deletion is introduced. Organisation guarded deletion now blocks both current Offering references (including archived records) and immutable Offering revision history. Archiving is a lifecycle operation and does not erase approved identity.

## Database setup and rollout

Migration ID: `006-hive-definitions`. Registration supplies four collections, strict Mongo validators and twelve indexes. Indexes support workspace/Brand Offering access, workspace/Offering ICP and Buyer access, workspace/ICP Buyer access, and exact unique revision identity. Existing schemas/data/indexes are not rewritten or dropped. Mongo validators enforce document structure; transactional service checks enforce cross-collection relationships and semantic hashes.

The HVM context and provisioning guards now accept reviewed versions 5 and 6 and reject older/newer versions. New definition operations require exactly v6. No startup/request path runs DDL or auto-creates these collections when the ledger is v5.

No migration or deployment was performed. Later rollout under separate authorization:

1. Review and deploy a compatible API build that supports both v5 and v6, preserving normal image-release ownership. Existing HVM operations continue on v5; new definition endpoints fail closed.
2. Using the existing secure environment loader, run `pnpm --filter @workspace/api-server db:setup --dry-run`. Review the four additions, validators, twelve indexes and compatibility/duplicate diagnostics.
3. Separately approve and run `pnpm --filter @workspace/api-server db:setup --apply`. Setup updates the ledger last, is repeatable, and never implies that existing data was exhaustively backfilled. DDL is not atomic; re-run inspection after any partial failure.
4. Verify ledger v6 and authenticated isolated-workspace CRUD/revision/approval behavior. No seed, client reprovisioning or automatic production data creation is required.
5. After v6, an application rollback must retain v6-compatible HVM guards; do not roll back to the old exact-v5 runtime without a separately reviewed recovery plan.

Tests use the repository's in-memory transactional adapters and setup planner. They are not evidence of a live Mongo migration or deployment. No agents, Offer object, lead generation, Swarm, Odyssiant integration, frontend or downstream invalidation were implemented.
