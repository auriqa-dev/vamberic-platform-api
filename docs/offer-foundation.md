# Offer foundation

This adds the data/API foundation for a future Offer Architect. It does not run agents, models, research, campaigns, billing, integrations or downstream regeneration. The existing Offering, ICP and Buyer Profile remain factual source definitions; this service never rewrites them.

## Three distinct concepts

- **Offer Design Methodology** is a reusable, immutable, versioned method. The first catalogue entry is **Value Equation**, key `value_equation`, version `1`, ID `offermethodology_00000000000000000000000001`.
- **Offer Design** is workspace-owned working material under one Offering: progress, research references, unverified findings, user questions/answers, options, decisions, assumptions and unknowns.
- **Offer** is a separate canonical market proposition under that Offering, targeted at one or more ICPs and optionally their Buyer Profiles. Many Offers can belong to one Offering. A design is optional, but competitive analysis and approved source definitions are required for approval.

Methods live in a code-owned global catalogue (`src/domain/offer-methodologies.ts`), not copied into each workspace. This is sufficient for the initial standard and avoids a fourth collection or seed operation. New versions must be appended while retaining previous versions. Designs pin the exact ID, key and version; there is no fallback to the latest version. A regression digest protects the initial method from accidental edits. Method creation/customization APIs are not included.

The method defines a conceptual relationship between desired outcome/confidence and time-to-value/customer effort. It is guidance, not a fabricated numerical score. Its 14 ordered stages cover market context, desired outcome, confidence, time to value, customer effort, obstacles, solution design, delivery/packaging, value stack, pricing/terms, risk reduction, positioning, proposition/CTA, and review. Each stage defines purpose, guidance, completion requirements and the reusable `offer_stage_v1` working-data shape.

## Introductory learning before the stages

Product/Service is **what you sell**; Customer is **who you sell it to**; Offer is **how you market and sell it**. One underlying product/service can have multiple Offers for different segments, markets, buyers, packages or commercial situations. Client-facing teaching refers to Product/Service Understanding rather than requiring knowledge of the internal Offering entity.

A methodology may now provide optional `learning` data: a title, short explanation and an ordered array of 1–20 strict plain-text sections. Four section kinds are supported: `concept`, `example`, `conceptual_model` and `next_steps`. Keys are unique; titles are bounded to 200 characters, explanations to at most 4,000, and examples/references have bounded explicit fields. There is no HTML field, template expression language or arbitrary CMS payload. Future consumers must render these as text, not HTML.

Value Equation v1 supplies this sequence before its unchanged 14 working stages:

1. **Product / Service — what you sell:** the factual product/service and what it can legitimately deliver.
2. **Customer — who you sell it to:** differences in outcomes, problems, proof and acceptable terms.
3. **Offer — how you market and sell it:** outcome, packaging, price, terms, proof, risk reduction and action; explicitly allows multiple Offers.
4. **Example:** an energy optimisation service compared with an illustrative assessment/recommendations/fixed-price assessment/optional measurement proposition. The example explicitly disclaims required commercial terms. An optional `clientExample` descriptor names `current_offering`, `name` and `factual_summary`, plus display prompts. These are semantic hints for a future authorized presenter, not an implemented query or binding to internal field names.
5. **The Value Equation:** references the existing `conceptualModel` expression and its four dimension explanations; it does not duplicate the formula data.
6. **Designing your offer:** references the actual `stages` array for the process overview, rather than maintaining a separate workflow list.

Other methodologies may use different concepts, examples and models, different stage sequences, or omit learning entirely. Canonical Offer remains methodology-independent. No UI, dynamic example resolution or Offer Architect behaviour is implemented.

This is an explicitly approved **pre-release** addition to the still-unapplied Value Equation v1 catalogue. Its ID/key/version and all previous definition fields (including every stage) remain unchanged. The catalogue digest has been updated deliberately and a second digest test protects the entire original definition with the additive learning field removed. Published versions must still be retained unchanged in future.

There is no methodology collection or seed: only the code-owned definition/schema and read response gain the optional learning field. Schema v8 remains three new collections, three validators and seven indexes; Offer Design/Offer validators and applied migrations 006/007 are unchanged by this enhancement.

## Working material and lifecycle

`OfferDesign.work` holds `name`, target IDs, current stage, completed stage keys, stage artifacts and competitive analysis. Each stage has a registered `stageKey`, status, research, unverified agent findings, user inputs, facts, options, selections, decision rationale, assumptions, evidence, unknowns, notes and generic groups. Collections are bounded; references and option keys must resolve locally. Facts/research need evidence references; assumptions retain their separate validation status. Selecting or rejecting an option requires a rationale. Proposed changes to the underlying Offering are marked explicitly and never applied automatically.

No hidden model reasoning, arbitrary executable stage schemas, raw provider payloads or campaign content fields are accepted. A future agent may supply candidate material through a future authorized workflow; this phase exposes human-only writes and does not execute or approve agent output.

Design transitions:

- `create` → `draft`; `start` → `in_progress`.
- `update` replaces the submitted work document and returns to `in_progress`.
- `ready` → `ready_for_review`, requiring all registered stages completed, a target ICP, decision rationales and external competitive analysis.
- `complete` → `completed`, pinning the exact approved Offering/ICP/Buyer revision IDs and content hashes. This does **not** approve or create an Offer.
- `reopen` returns reviewed/completed work to `in_progress` and clears its completion source pins.
- `archive` → `abandoned`; it preserves the record and does not cascade.

Edits require the last `expectedUpdatedAt`. Working data is mutable, not a full history of every intermediate edit. Offer approval stores a separate immutable completed-design snapshot alongside the approved Offer snapshot, so later reopening cannot rewrite the evidence behind an already approved Offer.

Competitive analysis records dated external sources, direct/indirect/alternative competitors, pricing/packaging, capability, positioning, buyers, delivery/contract terms, strengths, weaknesses, comparisons, material gaps and selected positioning. Each finding requires an external evidence reference. Future research/source dates are rejected. The API checks structure and provenance; it cannot independently establish that research is accurate or current and performs no research itself.

## Canonical Offer

`Offer.definition` contains strategic proposition language, target IDs, components, descriptive commercial options, incentives, risk reduction, customer commitments, differentiation, objections, proof/supportable claims, CTA, journey, eligibility/constraints, rationale, assumptions and unknowns. It excludes final email/ad/social/landing-page/campaign copy.

Commercial amounts reuse the existing minor-unit money and ISO currency primitive. Pricing can describe one-off, recurring, per-site, per-user, usage-based, commission, free, bundled or custom-quote arrangements. This creates no charges, subscriptions, entitlements or provider records. Guarantees and incentives are optional.

Offers begin as drafts. `approve` creates an immutable `offer_revisions` snapshot and sets the approved revision pointer. `revise` starts a new draft revision while retaining the previous approved pointer/history. `archive` retires the current document without deleting history. Approved Offers must be revised before editing.

For a linked Offer, approval requires a completed active design, matching targets and its competitive analysis. Lineage uses the sources pinned when that design completed, even if a source has since gained another approved revision. The immutable history stores `designSnapshot` separately from the clean Offer snapshot. Standalone Offer approval captures the currently approved source revisions and requires its own competitive analysis. This phase does not automatically invalidate an Offer when its sources change.

All targets must belong to the same workspace and Offering; each selected Buyer Profile must belong to a selected ICP. Parents must be active. Archiving a linked design blocks further non-archive mutations of its Offer until the domain workflow is reconsidered; existing approved history remains readable.

## API and authorization

All routes are below `/api/v1/hvm/workspaces/:workspaceId` and use the existing Cognito/application mapping and central workspace authority. Only authenticated `hvmapp` humans with appropriate workspace permissions can use them. Vapp identity, spoofed actors, another workspace and ungranted users cannot bypass authority. Viewer access is read-only; existing admin/onboarder action grants apply, with approval/archive requiring approval permission. No agent execution or autonomous approval is added.

| Resource path                                      | Operations                                                                                                         |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `offer-design-methodologies`                       | GET list                                                                                                           |
| `offer-design-methodologies/:id/versions/:version` | GET exact version                                                                                                  |
| `offer-designs`                                    | GET list; GET `/:id`; POST `/create`, `/update`, `/start`, `/ready`, `/complete`, `/reopen`, `/archive`            |
| `offers`                                           | GET list; GET `/:id`; GET `/:id/revisions/:revision`; POST `/create`, `/update`, `/approve`, `/revise`, `/archive` |

Design create takes `{offeringId, methodologyId, methodologyVersion, work}`. Offer create takes `{offeringId, offerDesignId?, definition, competitiveAnalysis?}`. Updates take `{id, expectedUpdatedAt, work}` or `{id, expectedUpdatedAt, definition, competitiveAnalysis?}`. Other mutations take `{id, expectedUpdatedAt}`. IDs, actors, workspace, lifecycle, hashes and lineage are server-controlled. The exact bounded nested field contracts are exported from `src/domain/offers.ts`; `test/offers.test.ts` provides executable complete examples.

Lists support `offeringId`, `archived=true|false`, `limit` (default 20, max 100), `offset` (max 10000), ordered by ID. Methodology listing is the entire small catalogue and does not accept Offering/archive filtering or nonzero offset. Individual archived records/history remain available through authorized reads. Create returns 201; other successful operations return 200. Invalid bodies return 400, inaccessible records return 404, lifecycle/concurrency conflicts return 409, and unavailable schema/runtime returns 503 without internal errors or input content.

Mutations use the existing transaction mechanism and workspace concurrency lock. Artifact changes, revision snapshots and ID/action-only audit events commit together or roll back. Each working/current record is capped at 200 KB; the existing HVM request body limit remains 256 KB.

## Unapplied schema v8

Migration `008-offer-foundation` is additive from schema v7:

| Collection        | Index name                   | Keys                                   | Unique |
| ----------------- | ---------------------------- | -------------------------------------- | ------ |
| `offer_designs`   | `id_unique`                  | `{id:1}`                               | yes    |
| `offer_designs`   | `workspace_offering_designs` | `{workspaceId:1,offeringId:1,id:1}`    | no     |
| `offers`          | `id_unique`                  | `{id:1}`                               | yes    |
| `offers`          | `workspace_offering_offers`  | `{workspaceId:1,offeringId:1,id:1}`    | no     |
| `offers`          | `workspace_design_offers`    | `{workspaceId:1,offerDesignId:1}`      | no     |
| `offer_revisions` | `id_unique`                  | `{id:1}`                               | yes    |
| `offer_revisions` | `offer_revision_unique`      | `{workspaceId:1,offerId:1,revision:1}` | yes    |

Three new validators accompany the three empty collections; there are no partial/sparse filters, seeds, Product changes, or existing validator/index replacements in v7→v8. Mongo's automatic `_id` indexes are separate from these seven application indexes. Existing v7 validator repairs and frozen historical migration definitions are preserved.

The new Mongo structural validators are compiled only from code-owned Zod schemas, rejecting unsupported structures. They enforce strict keys, types, enums, bounds and local lifecycle rules. Document-local stage progress/artifact references, selection consistency, external research sources, free-price rules and nested snapshot lifecycle/identity are also enforced. Cross-document authorization/relationships, catalogue membership and catalogue-dependent completion, semantic content hashes, byte limits and full date/URL parsing remain service-enforced; Mongo JSON Schema alone cannot replace the service. New Offer endpoints require schema 8 and never run migrations automatically. Existing HVM/Hive services also recognize schema 8.

Use the existing secure AWS Secrets Manager child-process loader documented in [hvm-partners.md](hvm-partners.md), with only `db:setup --dry-run` for review. Do not run apply without separate approval. No migration was applied during implementation.

## Verification

Tests cover version-pinned methodology, resumable stages, target isolation, human authorization, role restrictions, strict artifacts, competitive analysis, lifecycle, stale updates, transactional rollback, immutable Offer/design snapshots, and source revisions pinned across later source approval. Planner tests verify exactly three collections/seven indexes, no existing validator replacement, no seeding and idempotent migration planning.

An opt-in read-only Mongo parity test uses synthetic `$documents` aggregation and the proposed validators; it does not insert records or install validators. Run `test/offers.test.ts` with `OFFER_PARITY_MONGO=true` through the secure loader. Ordinary test runs skip this live check. The corrected proposed v8 validators passed secure read-only Mongo parity and a clean v7→v8 dry-run on 2026-09-30. See [the pre-migration verification report](investigations/offer-foundation-v8-pre-migration-verification.md) for exact coverage, service-only boundaries and the original failure/repair history. This is not an apply or an installed-v8 verification.
