# Offer foundation — final post-v8 verification

## PASS — OFFER ARCHITECT DATA FOUNDATION COMPLETE

Final post-migration verification completed 2026-09-30. Live dev is schema **8**, the corrected validators and all seven new indexes are installed, installed-validator parity passes, runtime guards accept v8, existing-data checks pass, full code validation is green, and secure setup dry-run is compatible with zero pending work.

**The Offer Architect data foundation is complete. The next workstream is the HVM Empress operating-layer data.**

This closes the data/API foundation only. No agent, frontend, operating-layer implementation, deployment or live customer-CRUD exercise was performed. No material outstanding defect was found. All prior pre-migration findings, repair details and initial failure evidence are preserved below as historical records; their former unapplied/failure status is superseded by this final verification.

Evidence labels: **Live** = actual read-only Mongo inspection; **Installed parity** = actual Mongo query evaluation using the installed validator definitions; **Automated** = unchanged local/in-memory tests; **Static** = executable-source inspection. None of the in-memory tests is represented as a live persistent write test.

## 1. Live schema, history and installed structures

**Live:** accessed dev database `vamberic_studio` using AWS profile `vamberic-admin`, region `eu-west-2`, and the secure child-process loader documented in `docs/hvm-partners.md`. The existing secret supplied the URI; no credentials/URI or sensitive document contents were printed or written to files.

Both ledger `version` and `schemaVersion` are **8**. `008-offer-foundation` exists exactly once, applied at **2026-09-30T09:46:17.713Z**. Entries 001–007 (including IDs, versions and applied timestamps) exactly match the retained pre-apply inventory. No unexpected migration entry exists.

There are **37 domain collections + `schema_versions` = 38**, and **114 application indexes**, plus automatic Mongo `_id` indexes. This is the prior 34/107 domain inventory plus exactly the three reviewed collections and seven indexes. No unexpected or missing collection/index was found. Every declared index was compared for ordered keys, name, uniqueness, sparse/partial filter, collation, TTL and hidden settings. Existing v7 validators and strict/error options also match their expected definitions.

**Live installed v8 validators:** `listCollections` metadata for `offer_designs`, `offers` and `offer_revisions` is deeply equal to the final corrected exported validator definitions, with `validationLevel: strict` and `validationAction: error`. These are the corrected versions, not the earlier proposals missing snapshot checks.

## 2. Installed-validator parity and original failure

**Installed parity: 423 passed / 0 failed / 0 skipped.** This includes 206 declared boundary cases exercised through both canonical Zod and Mongo, plus the surrounding unchanged Offer tests.

The ordinary suite imports exported proposed validators. To verify actual installation without editing tests/source, an external temporary preload:

1. Read live schema and installed collection options.
2. Required ledger v8 and deep equality to the corrected source definitions, with strict/error validation.
3. Replaced only the process-local exported validator-map values with the actual BSON validator objects read from Mongo.
4. Ran the unchanged Offer suite with `OFFER_PARITY_MONGO=true`.

Consequently the query predicates used in this run came from **installed metadata**, not merely from an assumption that source was installed. The original test's label still says “proposed”; its label was intentionally not edited.

Each boundary uses `$documents` → `$match` → `$project` collectionless aggregation. There is no insert, update, temporary collection, transaction-based test write, `$out` or `$merge`. Local HTTP/provisioning fixtures use the in-memory adapter only. No persistent fixture can be left by these queries.

Explicit original-case results:

| Embedded designSnapshot case          | Canonical Zod | Installed Mongo validator |
| ------------------------------------- | ------------- | ------------------------- |
| Valid baseline, createdAt ≤ updatedAt | Accept        | Accept                    |
| Equal createdAt and updatedAt         | Accept        | Accept                    |
| updatedAt = createdAt − 1 millisecond | Reject        | Reject                    |

Installed parity also covers snapshot archive/completion/identity, timestamp types/order, stage progress and duplicate artifacts, selections, references, rationales, external research evidence, free-price consistency, IDs/strict structures, approval pointers/metadata and hash format. Semantic hash recomputation, cross-collection lineage truth and current authorization remain service checks. Offer evidence uses reference observation dates; no Hive-style recordedAt/confidence chronology is invented where the Offer contract has no such field. Full URL/calendar parsing and normalization remain the documented canonical-parser responsibilities.

## 3. Value Equation v1

**Automated + Static:** catalogue name **Value Equation**, key `value_equation`, version **1**. Tests verify its complete digest, unchanged original-definition digest, four dimensions and 14 stages. The structured learning order remains Product/Service → Customer → Offer → example → model → next steps. It teaches what/who/how, explicitly permits multiple Offers for the same product/service, retains the generic energy example and client-specific example descriptor, and references the actual formula/dimensions/stages instead of copying a workflow.

Canonical Offer content stays methodology-independent. **Live + Static:** no methodology collection or seed exists. Search of API source/specification, Vapp source and product documentation found no prohibited user-facing branding references. No catalogue, content or test change was made during verification.

## 4. Offer Design and competitive analysis

**Automated + Static + installed structure/parity:** workspace-owned `offer_designs` retains its immutable Offering/method identity, ICP/Buyer targets, current/completed progress and bounded stage work. Research, user answers, unverified future-agent findings, options, selected/rejected decisions, rationale, assumptions, evidence, unknowns and notes are explicit business artifacts—not hidden model reasoning. It supports repeated updates, ready/completion/reopening, optimistic concurrency and non-cascading abandonment. Completion pins approved sources and does not itself approve/create an Offer.

Competitive/substitute analysis remains embedded research with identity/kind, sources, pricing/packaging, capabilities, positioning, buyer, delivery, contract/commitment/friction, strengths/gaps/relevance/comparisons. External evidence is required as designed and checked by both canonical and installed validation. The requirement does not claim that software independently fact-checks sources. No global competitor collection or research execution was introduced.

## 5. Canonical Offer, lifecycle, evidence and history

**Automated + Static + installed structure/parity:** `offers` remains separate from factual Offering and working design. Each belongs to one immutable Offering; multiple Offers can target different ICPs/Buyers. The service enforces matching workspace/Offering and selected-ICP compatibility. Optional completed design lineage and approved Offering/ICP/Buyer revision pins are preserved. Tests verify a later source approval does not silently change a completed design's lineage.

Clean output supports proposition/promise, packaging/components, descriptive terms, incentives/risk reduction, commitments/friction, differentiation, objections/proof, CTA/next steps, constraints, concise rationale/assumptions/unknowns. Strict input excludes final campaign/channel copy. Full workings belong in the separate design snapshot, not indiscriminately in canonical content.

The tested lifecycle is create draft revision 1 → draft-only update → explicit human approval with immutable revision → revise N+1 retaining prior approved pointer → non-cascading archive, with exact history still readable. There is no separate Offer `observe` endpoint; designed evidence handling is explicit work/analysis updates and draft changes, never silent canonical promotion. Content hash includes immutable parent/design IDs, definition and competitive analysis, and excludes timestamps/actors/lifecycle/revision counters. Snapshot history has no supported edit route.

Admin/Partner owner can manage/approve/archive; onboarder can work on drafts/design but cannot approve/archive; viewer is read-only. Identity/membership is re-resolved server-side and inside mutations, with human HVM application checks and transactional workspace locking. JSON, shared Organisation/Product/Brand/domain/email and valid ID prefixes do not grant access. Foreign workspace/Buyer selection, spoofing, stale writes and audit-failure rollback are covered by unchanged tests. No live membership or record was created.

## 6. Runtime guards and API boundaries

**Static executable-code search + Automated:**

| Runtime                       | Accepted ledger versions |
| ----------------------------- | ------------------------ |
| HVM context resolution        | 5, 6, 7, 8               |
| HVM provisioning              | 5, 6, 7, 8               |
| Hive definition operations    | 6, 7, 8                  |
| Offer/Offer Design operations | exactly 8                |

No active exact-v7 guard rejects v8. Existing guard tests run in the full suite; Offer fixture lifecycles use ledger 8. Unsupported older and unknown future values remain rejected. Startup/request paths do not invoke schema setup automatically. This confirms repository runtime compatibility, not the image currently deployed to ECS.

Workspace-scoped HVM routes, strict body/query parsing, bounded list filters/pagination, ISO serialization, server-controlled actor/lineage fields, expectedUpdatedAt and sanitized errors remain unchanged. No Offer endpoint appears in Vapp Product CRUD.

## 7. Existing data and integrity

**Live counts:**

| Collection                | Count |
| ------------------------- | ----: |
| products                  |     2 |
| organisations             |     1 |
| crm_workspaces            |     1 |
| brands                    |     1 |
| offerings                 |     0 |
| ideal_customer_profiles   |     0 |
| buyer_profiles            |     0 |
| hive_definition_revisions |     0 |
| offer_designs             |     0 |
| offers                    |     0 |
| offer_revisions           |     0 |

Partner, Partner membership, primary assignment, workspace membership and event counts remain one each. Other managed domain collections remain empty. Counts agree with the pre-migration baseline; no migration/test/customer seed data appeared. Secure preflight reports no incompatible existing documents. Empty Hive/Offer collections make their existing-record check vacuous; synthetic installed parity separately exercises their rules.

Before/after post-verification fingerprints of documents, collection options, all indexes and ledger match exactly: `f78bc5cdf8eb648ce43b479df597cbad6fb9868f3a00ee954072273a7ac249d5`. No live state changed during this task. No evidence of unexpected domain-record rewriting was found. Historical byte-for-byte preservation across the user's apply is not independently proven by counts: the retained pre-apply whole-state digest includes a ledger/inventory that necessarily changed. Migration code performs additive DDL/ledger work, not Product/domain-document updates.

## 8. Seven installed indexes

**Live:** all match exactly; none has a partial/sparse filter or global display-name constraint.

| Collection      | Index                      | Keys                                   | Unique |
| --------------- | -------------------------- | -------------------------------------- | ------ |
| offer_designs   | id_unique                  | `{id:1}`                               | yes    |
| offer_designs   | workspace_offering_designs | `{workspaceId:1,offeringId:1,id:1}`    | no     |
| offers          | id_unique                  | `{id:1}`                               | yes    |
| offers          | workspace_offering_offers  | `{workspaceId:1,offeringId:1,id:1}`    | no     |
| offers          | workspace_design_offers    | `{workspaceId:1,offerDesignId:1}`      | no     |
| offer_revisions | id_unique                  | `{id:1}`                               | yes    |
| offer_revisions | offer_revision_unique      | `{workspaceId:1,offerId:1,revision:1}` | yes    |

Global platform record-ID uniqueness is intentional; approved revision identity is workspace/Offer/revision scoped. No unexpected workspace-crossing business uniqueness or removed old index was found.

## 9. Full validation and idempotent dry-run

Node 24.21.0, pnpm 10.26.1. Counts overlap; do not sum them as distinct coverage.

| Check                                                                                                                      | Final result                                          |
| -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Full API suite, including methodology, designs, Offers, authorization, guards, setup/migrations and canonical parity cases | **845 passed / 0 failed / 7 opt-in skips**, 852 total |
| Secure unchanged Offer suite using installed live validator definitions                                                    | **423 passed / 0 failed / 0 skipped**                 |
| Workspace typecheck                                                                                                        | PASS                                                  |
| API lint                                                                                                                   | PASS                                                  |
| API build                                                                                                                  | PASS                                                  |
| API format check                                                                                                           | PASS                                                  |
| git diff --check                                                                                                           | PASS                                                  |

Six ordinary skips are existing opt-in Hive Mongo groups; the seventh is Offer Mongo parity, explicitly run against installed definitions above. All requested local categories ran as part of the full suite; no test was changed to obtain a pass.

**Live secure `db:setup --dry-run`:**

```json
{
  "existingSchemaVersion": 8,
  "schemaVersion": 8,
  "compatibility": "compatible",
  "collectionsToCreate": [],
  "validatorsToApply": [],
  "indexesToCreate": [],
  "validatorConflicts": [],
  "incompatibleIndexes": [],
  "uniqueIndexRisks": [],
  "uniqueIndexRiskDiagnostics": []
}
```

This verifies no pending setup work without another apply.

## 10. Scope, limits, files and operational boundary

No Offer Architect, Product/Service Understanding, ICP, Research, Campaign Automation, Contact Management or Lead Gen agent; agent runtime/authentication; autonomous approval; Empress layer; Swarm configuration/runtime; HVMapp Offer UI; model/web research; outreach/campaign/billing execution; Odyssiant integration; or downstream regeneration was implemented by this foundation/verification. Existing unrelated platform capabilities were not changed.

No material outstanding issue remains. Live write-transaction contention and deployed frontend/API operation were not exercised because this task is read-only and deployment-free. Installed-validator queries and in-memory lifecycle tests are reported separately; those limits do not block this data-foundation sign-off.

Only repository file changed during verification: **this existing report**. A task-start file-hash inventory confirms application code, validators, migrations and tests remained unchanged. Existing unstaged/untracked work is preserved. No staging, commit, push or deployment. No database writes, apply, provisioning or persistent fixtures; no test records remain. No cleanup writes were necessary.

The Offer Architect data foundation is complete. The next workstream is the HVM Empress operating-layer data.

Final `git status --short --untracked-files=all`:

```text
 M artifacts/api-server/src/authorization/policy.ts
 M artifacts/api-server/src/db/collections.ts
 M artifacts/api-server/src/db/hive-validators.ts
 M artifacts/api-server/src/db/setup.ts
 M artifacts/api-server/src/domain/hive-definitions.ts
 M artifacts/api-server/src/domain/ids.ts
 M artifacts/api-server/src/domain/index.ts
 M artifacts/api-server/src/routes/hvm.ts
 M artifacts/api-server/src/services/hive-definitions.ts
 M artifacts/api-server/src/services/hvm-context.ts
 M artifacts/api-server/src/services/hvm-provision.ts
 M artifacts/api-server/test/crm-foundation.test.ts
 M artifacts/api-server/test/domain.test.ts
 M artifacts/api-server/test/hive-definitions.test.ts
 M docs/hive-definitions.md
?? artifacts/api-server/src/db/hive-validators-v6.ts
?? artifacts/api-server/src/db/offer-validators.ts
?? artifacts/api-server/src/domain/offer-methodologies.ts
?? artifacts/api-server/src/domain/offers.ts
?? artifacts/api-server/src/routes/offers.ts
?? artifacts/api-server/src/services/offers.ts
?? artifacts/api-server/test/helpers/offer-parity.ts
?? artifacts/api-server/test/hive-validator-parity.test.ts
?? artifacts/api-server/test/offer-methodologies.test.ts
?? artifacts/api-server/test/offers.test.ts
?? docs/investigations/hive-definitions-v6-post-migration-verification.md
?? docs/investigations/offer-foundation-v8-pre-migration-verification.md
?? docs/investigations/offering-icp-data-architecture-current-state.md
?? docs/offer-foundation.md
```

## Preserved pre-migration verification and repair history

<details>
<summary>Pre-migration PASS, consistency repairs, and initial failure history</summary>

# Offer foundation v8 pre-migration verification

## Final result: PASS — SAFE TO APPLY v8

Completed 2026-09-30 after the explicitly authorized consistency repair. **Schema v8 remains unapplied.** This is approval-readiness evidence, not execution authorization or a claim that v8 validators are installed. Live dev remains v7. The initial failure and its evidence are preserved in the historical section below.

Evidence labels: **Live** = actual read-only dev state; **Mongo parity** = actual Mongo query evaluation of the proposed validator on collectionless synthetic documents; **Automated** = local/in-memory tests; **Static** = inspected implementation. These forms of evidence are not interchangeable.

## 1. Repair and every additional mismatch

**Static + Mongo parity:** `offerMongoStructure` compiles structural Zod rules but intentionally unwraps `ZodEffects`; refinements require explicit Mongo predicates. The initial `offer_revisions` validator restored lifecycle checks only for `snapshot`, omitting `designSnapshot`. A valid BSON date type therefore did not imply valid chronology.

The focused repair adds reusable document-local expressions at both current and historical paths, without changing canonical Zod/domain/service semantics:

| Drift found                                                                                                                        | Repair                                                                                                  | Applies to                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Embedded design `updatedAt < createdAt` accepted                                                                                   | Same date-order predicate as canonical chronology                                                       | Current design and `designSnapshot`                                             |
| Embedded design archive state/date interval omitted                                                                                | Match abandoned/archive relationship, archive timestamp presence and inclusive created/updated interval | Current design and `designSnapshot`                                             |
| Completed embedded design could omit source pins                                                                                   | Require existing `sourceRevisions` for completed state                                                  | Both design locations                                                           |
| Embedded review/completion could omit analysis/targets                                                                             | Require competitive analysis and nonempty ICP selection in applicable states                            | Both design locations                                                           |
| Embedded design identity/workspace/status could differ from revision                                                               | Require completed state, matching outer workspace and `snapshot.offerDesignId`                          | Optional `designSnapshot` only                                                  |
| Duplicate stage identities and inconsistent completed-stage progress accepted                                                      | Unique stage keys; exact set equality of completed stages and completed keys                            | Both design locations                                                           |
| Duplicate option/evidence identities and inconsistent selected options accepted                                                    | Unique artifact keys; selected-key set equals options marked selected                                   | Both design locations                                                           |
| Dangling stage research/fact/agent-finding/assumption evidence references accepted                                                 | Each referenced key must exist in that stage's evidence                                                 | Both design locations                                                           |
| Selected/rejected options without rationale, Offering-change flag without explanation, completed stages without rationale accepted | Mirror the canonical conditional required fields                                                        | Both design locations                                                           |
| Competitive finding without external evidence accepted                                                                             | Each finding must include an external-evidence source                                                   | Design work, Offer and both embedded snapshots                                  |
| Free pricing with nonzero price accepted                                                                                           | Free price, when supplied, must equal zero                                                              | Offer commercial options and component commercial effects, current and snapshot |

Existing structural rules continue to cover strict objects, required typed values, IDs/prefixes, enum values, bounded arrays/text, currencies, safe nonnegative minor amounts, integer/range constraints, human actor shape and hash format. No additional timestamp order was invented: source import dates, lineage design-update date and evidence dates have only the rules the canonical contracts already define.

No methodology, service, route, authorization, lifecycle or Offer/Offering meaning changed. No change was made to migration 006/007 source or definitions in this repair; existing earlier task modifications remain in the working tree.

## 2. Systematic parity review and intentional differences

**Static + Automated + Mongo parity:** all three new persisted structures were reviewed, including their nested copies. The suite now has **206 explicit boundary cases**, each checked by Zod and (when enabled) real Mongo. Expected acceptance is declared independently of either implementation; semantic Offer hashes are refreshed when testing another field so a hash mismatch cannot hide its result.

Coverage includes root/nested identities, required/optional/null fields, unknown keys, workspace and lineage prefixes, lifecycle/archive/approval state, timestamp types/order/equality, approved revision pointers, source revision/hash/version structure, nonempty/bounded text, bounded/duplicate arrays, progress/decisions/evidence references, assumptions, agent finding flags, competitive sources, actor identities/issuer shape, commercial enums, free pricing at both locations, safe integers, commission ranges/NaN/infinity, currencies, targets, and outer-to-snapshot identity. Both current and embedded design chronology test equality as valid and reversal as invalid.

The following differences are intentional, with no claim that Mongo replaces them:

| Invariant                                                                                                                  | Owner and reason                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authorization, current membership, application identity, human approval, workload denial                                   | Central policy and transactional service; no document can prove current caller authority                                                            |
| Optimistic concurrency, immutable updates/history and parent archive state                                                 | Service operations, expected timestamps and shared transaction/workspace lock; Mongo validators cannot compare previous state or external documents |
| Offering/ICP/Buyer existence, scope, compatibility; approved source revision lookup                                        | Transactional cross-collection checks; ID syntax alone is insufficient                                                                              |
| Method catalogue lookup/version/key agreement and registered stage membership                                              | Code-owned versioned catalogue, not duplicated Mongo constants                                                                                      |
| All method-required stages complete before review/completion                                                               | Catalogue-dependent workflow; Mongo enforces local progress consistency and required research/targets but cannot resolve the method                 |
| Semantic hash recomputation, source-lineage truth and future research-date check against execution time                    | Service; Mongo validates shape/format and local snapshot identities without fetching sources or recreating hashing                                  |
| Full URL/calendar parsing, trimming/case conversion/default materialization and stripping permitted source metadata extras | Canonical parser normalizes inputs before persistence. Mongo checks bounded structure/basic syntax, not a second WHATWG/ISO/Unicode parser          |
| Unicode UTF-16 versus BSON code-point lengths and 200KB serialized JSON cap                                                | Application parser; Mongo's units differ. Normalized service writes are the supported path                                                          |
| Research accuracy, substantiation of claims and business decisions                                                         | Human/source review; external-reference presence is enforced but is not a fact-checking engine                                                      |

No unexplained validator drift remains from this review. Parity is representative boundary evidence, not a mathematical equivalence proof for every possible BSON document or a grant to bypass services. Evidence uses the Offer foundation's explicit references/facts/assumptions; it does not inherit Hive observation fields such as recordedAt/confidence/path where those are absent from the Offer contract. No such fields or new semantics were invented.

## 3. Live dev state, compatibility and unchanged data

**Live:** authenticated via `vamberic-admin`, `eu-west-2`, existing Secrets Manager loader. URI was confined to child environment; no credentials or document content were printed or saved.

- Database `vamberic_studio`; ledger `version=7`, `schemaVersion=7`.
- Exactly one entry for each migration 001–007, with existing applied timestamps retained; no 008/009 entry.
- 34 domain collections plus ledger; 107 application indexes plus automatic `_id` indexes.
- Explicit inventory compared ordered index keys, names, uniqueness, sparse/partial filters, collation, TTL and hidden settings. No missing/unexpected/mismatched collection/index.
- All currently managed validator definitions and strict/error options match source. No existing validator replacement is proposed.
- Products **2**, Organisations **1**, workspaces **1**, Brands **1**; Partner, Partner membership, assignment and workspace membership **1 each**; events **1**. Four Hive collections **0 each**; new Offer collections **absent**. Other counts match the initial complete semantic result retained below.
- Before/after hashes of all existing documents, collection options, indexes and ledger match (`e4744fd1abf4f20f102af8e06e4cd5a89087794845ef998b9a775b00fc938cab`). No persistent test records were created; no test collection exists. Existing Hive data compatibility is vacuous because those collections are empty; synthetic parity supplies separate coverage.

An initial external inventory helper attempted to import a private validator map and failed safely. The helper was corrected to read the existing exported maps; this was not an application defect, did not write Mongo and did not change repository code.

## 4. Final secure migration plan and history safety

**Live:** secure `pnpm --filter @workspace/api-server db:setup --dry-run` succeeds:

- `existingSchemaVersion: 7`, `schemaVersion: 8`, `compatibility: upgrade-pending`.
- `collectionsToCreate` and `validatorsToApply`: exactly `offer_designs`, `offers`, `offer_revisions`.
- Seven `indexesToCreate`, shown below.
- `validatorConflicts`, `incompatibleIndexes`, `uniqueIndexRisks`, `uniqueIndexRiskDiagnostics`: all `[]`.
- No existing-data incompatibility, rewrite/backfill, repurposed collection, index replacement or destructive operation.

**Static + Automated:** migration identity remains `008-offer-foundation`; no 009 exists. The frozen v6 validator fingerprint test and v7 correction/history/retry tests pass. The v7→v8 planner test verifies three empty collections/seven indexes, preserves existing documents/indexes/validators and is idempotent. Setup appends pending history and advances ledger only after successful collection/validator/index work; no history is rewritten. DDL remains sequential, not transactional: any later apply failure requires read-only inspection before retry.

## 5. Runtime compatibility

**Static + Automated:** HVM context/provisioning allow 5/6/7/8; Hive definitions allow 6/7/8; new Offer operations require exactly 8. Existing v7 remains usable, and Offer endpoints fail closed there without creating collections. Unknown future versions fail closed. Search of app/startup/routes/services found no `setupDatabase`/`runDatabaseSetup` invocation; ordinary Mongo startup only connects/pings. No automatic DDL or runtime migration exists. Full API tests cover these paths. Future deployment/rollback must retain an API build compatible with the installed schema.

## 6. Methodology and scope

**Automated + Static:** Value Equation is code-owned, key `value_equation`, version **1**, with immutable reads, unchanged original-definition digest, four formula dimensions and 14 stages. Learning remains Product/Service → Customer → Offer → example → conceptual model → next steps. It teaches multiple Offers per product/service; the generic example and future client-example descriptor remain. Next steps reference real stages, not a duplicated workflow. No methodology collection or seed. Canonical Offer remains method-independent.

Search of API source, API specification, Vapp source and product docs found no forbidden methodology-brand references. No agents, runtimes, agent authentication, frontend, web research, LLM calls, outreach/campaigns, billing, Swarms, Empress, Odyssiant or downstream invalidation were added. The inspected foundation does not introduce Lead Gen as an individual agent.

## 7. Offer Design, competitive analysis and canonical Offer

**Automated + Static:** design work is resumable and explicitly edited, with target IDs, method pins, progress, research, unverified findings, user questions/answers, options/rejections/selection rationale, assumptions, evidence and unknowns. No hidden reasoning field. Draft/in-progress/ready/completed/abandoned transitions and stale-update refusal are preserved. Completion pins approved source revisions without approving/creating an Offer; reopening clears completion pins.

Competitive/substitute findings remain bounded working research with sources, pricing/packaging, functionality, positioning, buyer, delivery, commitment/friction, strengths/gaps/relevance/comparisons. They are not a competitor database. Research is supplied and reviewed, not executed by an agent.

`offers` is a clean, selected proposition under one immutable Offering; many Offers per Offering are permitted. It supports the agreed proposition/promise, components, descriptive terms, incentives/risk reduction, customer commitments, differentiation, objections/proof, CTA/journey, constraints, rationale/assumptions/unknowns. Strict content rejects final campaign copy and a method key. Full workings are retained separately in `offer_revisions.designSnapshot`, not indiscriminately merged into the canonical proposition.

## 8. Approval, lineage, relationships and authorization

**Automated + Static:** create gives draft revision 1; only drafts update; approval is explicit human-only and transactional with immutable history/audit; revise gives N+1 while retaining the previous approved pointer; archive is non-cascading; exact historical revisions stay readable. Hash includes immutable Offering/design identity, definition and analysis, excluding actors/dates/revision state. Approval metadata/pointers and timestamp/archive invariants are enforced at current and snapshot levels. No separate Offer `observe` endpoint exists; evidence/working changes are explicit, not silent canonical overwrites.

Linked approval requires completed design, identical targets and its research; lineage uses sources pinned at design completion even if sources later gain an approval. Standalone approval captures approved source revisions and requires its own research. Service checks parent workspace/Offering, Buyer-to-selected-ICP compatibility and active parents; no reparenting or ID-only access. Mutations resolve current memberships and parent references in the transaction, sharing workspace concurrency locking; rollback on audit failure is tested.

Admin/Partner owner may manage/approve/archive; onboarder may work on drafts/design but cannot approve/archive; viewer reads only. Authority derives from verified client/issuer/subject and server-resolved memberships, not JSON, email/domain, Organisation/Product/Brand. Vapp, foreign workspaces, spoofed fields and ungranted users are rejected. Offer service explicitly requires human HVM identity, so a workload grant cannot impersonate approval. No live users or memberships were created for tests.

## 9. Index and API review

**Static + Live preflight:**

| Collection      | Index                      | Keys                                   | Unique | Access pattern                     |
| --------------- | -------------------------- | -------------------------------------- | ------ | ---------------------------------- |
| offer_designs   | id_unique                  | `{id:1}`                               | yes    | Platform record ID                 |
| offer_designs   | workspace_offering_designs | `{workspaceId:1,offeringId:1,id:1}`    | no     | Offering's scoped working designs  |
| offers          | id_unique                  | `{id:1}`                               | yes    | Platform record ID                 |
| offers          | workspace_offering_offers  | `{workspaceId:1,offeringId:1,id:1}`    | no     | Offering's scoped propositions     |
| offers          | workspace_design_offers    | `{workspaceId:1,offerDesignId:1}`      | no     | Design-to-Offer lookup support     |
| offer_revisions | id_unique                  | `{id:1}`                               | yes    | Platform history record ID         |
| offer_revisions | offer_revision_unique      | `{workspaceId:1,offerId:1,revision:1}` | yes    | Exact historical approval identity |

No partial/sparse filters, global display-name constraints or existing-data uniqueness risks. Global platform IDs intentionally remain unique. No query-performance benchmark is claimed; workspace-only lists may need sorting when Offering is not filtered, which is not a correctness blocker.

Routes remain under `/api/v1/hvm/workspaces/:workspaceId`: method list/exact version; design list/read/create/update/start/ready/complete/reopen/archive; Offer list/read/create/update/approve/revise/archive/exact revision. Strict body/query parsing, parent filters, 20 default/100 max list limit and 10,000 max offset, ISO dates, expectedUpdatedAt and sanitized 400/404/409/503 errors remain. The small methodology catalogue returns all entries, rejects Offering/archive/nonzero-offset filters and does not use list limit; this is documented existing behavior. No Offer endpoint is exposed via Vapp Product CRUD.

## 10. Final validation results

Node 24.21.0 / pnpm 10.26.1. Counts overlap and must not be added together as distinct tests.

| Check                                                               | Result                                                                                      |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Focused methodology, Offer, authorization, DB setup/migration tests | **265 pass / 0 fail / 1 opt-in skip** (266 total)                                           |
| Full API suite                                                      | **845 pass / 0 fail / 7 opt-in skips** (852 total)                                          |
| Secure Offer suite with proposed Mongo parity enabled               | **423 pass / 0 fail / 0 skips**; 206 paired Zod/Mongo boundary cases plus surrounding tests |
| Workspace typecheck                                                 | PASS                                                                                        |
| API lint                                                            | PASS                                                                                        |
| API build                                                           | PASS                                                                                        |
| API format check                                                    | PASS                                                                                        |
| Secure db:setup dry-run                                             | PASS, clean 7→8 plan                                                                        |
| git diff --check                                                    | PASS                                                                                        |

Six full-suite skips are existing opt-in Hive Mongo groups; one is the Offer Mongo group, run separately above. Installed v7 validators were compared live, but the unchanged Hive synthetic suite was not redundantly rerun. Mongo parity uses **corrected proposed validators**, never installs them, and persists no fixtures. Local tests are not proof of real write-transaction contention or actual future DDL execution; those are inherent limits of this read-only pre-migration task, not outstanding validator defects.

## 11. Files, remaining gaps and final recommendation

Changed by this repair:

- `artifacts/api-server/src/db/offer-validators.ts`
- `artifacts/api-server/test/helpers/offer-parity.ts` (new boundary fixtures)
- `artifacts/api-server/test/offers.test.ts`
- `docs/offer-foundation.md`
- This existing investigation report (history preserved below).

No unrelated tests were altered to obtain a pass. Pre-existing working-tree changes were preserved. Git remains unstaged; no commit/push/deployment. No Mongo writes, no migration apply, no provisioning and no persistent test records. **No material outstanding issue from the completed verification remains. Safe to apply v8 only under separate explicit authorization.**

Final `git status --short --untracked-files=all`:

```text
 M artifacts/api-server/src/authorization/policy.ts
 M artifacts/api-server/src/db/collections.ts
 M artifacts/api-server/src/db/hive-validators.ts
 M artifacts/api-server/src/db/setup.ts
 M artifacts/api-server/src/domain/hive-definitions.ts
 M artifacts/api-server/src/domain/ids.ts
 M artifacts/api-server/src/domain/index.ts
 M artifacts/api-server/src/routes/hvm.ts
 M artifacts/api-server/src/services/hive-definitions.ts
 M artifacts/api-server/src/services/hvm-context.ts
 M artifacts/api-server/src/services/hvm-provision.ts
 M artifacts/api-server/test/crm-foundation.test.ts
 M artifacts/api-server/test/domain.test.ts
 M artifacts/api-server/test/hive-definitions.test.ts
 M docs/hive-definitions.md
?? artifacts/api-server/src/db/hive-validators-v6.ts
?? artifacts/api-server/src/db/offer-validators.ts
?? artifacts/api-server/src/domain/offer-methodologies.ts
?? artifacts/api-server/src/domain/offers.ts
?? artifacts/api-server/src/routes/offers.ts
?? artifacts/api-server/src/services/offers.ts
?? artifacts/api-server/test/helpers/offer-parity.ts
?? artifacts/api-server/test/hive-validator-parity.test.ts
?? artifacts/api-server/test/offer-methodologies.test.ts
?? artifacts/api-server/test/offers.test.ts
?? docs/investigations/hive-definitions-v6-post-migration-verification.md
?? docs/investigations/offer-foundation-v8-pre-migration-verification.md
?? docs/investigations/offering-icp-data-architecture-current-state.md
?? docs/offer-foundation.md
```

## Historical initial verification — failure preserved

<details>
<summary>Initial v8 verification, confirmed chronology defect and stop decision</summary>

# Offer foundation v8 pre-migration verification

Verified 2026-09-30. **FAIL — DO NOT APPLY.** Verification stopped at a confirmed proposed-validator mismatch, as explicitly required. This is a partial verification report, not a completed release sign-off.

## 1. Executive result

The secure live preflight matches the additive 7 → 8 plan. However, the proposed `offer_revisions` validator accepts invalid chronology in its embedded `designSnapshot` that canonical `OfferRevisionSchema` rejects. This is a local document invariant, not authorization, a foreign-key lookup, semantic hash recomputation or another inherently service-only rule.

No application, schema, migration or test was changed. No repair was attempted. Only this report was added to the repository during verification. No apply, Mongo write, persistent fixture, commit, push or deployment occurred.

Evidence labels used below: **Live** = read-only actual dev metadata/data; **Mongo parity** = actual Mongo query evaluation of proposed validators on synthetic collectionless documents; **Automated** = existing tests with in-memory services; **Static** = inspected source; **Not verified** = not completed before the stop condition.

## 2. Current live v7 state

**Live:** secure loader from `docs/hvm-partners.md`, AWS profile `vamberic-admin`, region `eu-west-2`, existing `vamberic/dev/api` secret, database `vamberic_studio`. URI was passed only to child processes, never printed or written to disk.

Ledger `version=7`, `schemaVersion=7`. Each history entry exists once with the expected version and applied timestamp:

| Version | Migration                      | Applied UTC              |
| ------- | ------------------------------ | ------------------------ |
| 1       | 001-vapp-v1-baseline           | 2026-09-15T14:32:29.287Z |
| 2       | 002-crm-foundation             | 2026-09-27T09:18:48.931Z |
| 3       | 003-commercial-foundation      | 2026-09-27T11:57:07.499Z |
| 4       | 004-brand-foundation           | 2026-09-27T16:43:30.585Z |
| 5       | 005-hvm-phase1                 | 2026-09-28T12:42:21.173Z |
| 6       | 006-hive-definitions           | 2026-09-29T16:37:32.154Z |
| 7       | 007-hive-validator-consistency | 2026-09-29T17:06:01.813Z |

35 collections: 34 domain collections plus `schema_versions`. No unexpected collection or collection with a test name was found. 107 existing application indexes, plus Mongo `_id` indexes. Explicit inventory compared index names/keys/uniqueness; the canonical dry-run separately checks configured index options. No missing/different/unexpected existing application index was reported. The dry-run finds no existing validator update or conflict; current Hive validators remain canonical v7.

## 3. Complete semantic dry-run result

**Live:** `pnpm --filter @workspace/api-server db:setup --dry-run` through the secure loader succeeded. No apply was invoked.

```json
{
  "existingSchemaVersion": 7,
  "schemaVersion": 8,
  "compatibility": "upgrade-pending",
  "collectionsToCreate": ["offer_designs", "offers", "offer_revisions"],
  "validatorsToApply": ["offer_designs", "offers", "offer_revisions"],
  "indexesToCreate": [
    "offer_designs.id_unique",
    "offer_designs.workspace_offering_designs",
    "offers.id_unique",
    "offers.workspace_offering_offers",
    "offers.workspace_design_offers",
    "offer_revisions.id_unique",
    "offer_revisions.offer_revision_unique"
  ],
  "validatorConflicts": [],
  "incompatibleIndexes": [],
  "uniqueIndexRisks": [],
  "uniqueIndexRiskDiagnostics": [],
  "existingCollections": [
    "offerings",
    "ideal_customer_profiles",
    "buyer_profiles",
    "hive_definition_revisions",
    "workspace_memberships",
    "brands",
    "brand_kits",
    "hvm_partner_memberships",
    "workspace_integrations",
    "hvm_partners",
    "workspace_partner_assignments",
    "capabilities",
    "capability_instances",
    "commercial_packages",
    "commercial_charges",
    "products",
    "people",
    "contact_points",
    "organisations",
    "organisation_relationships",
    "product_relationships",
    "marketing_permissions",
    "opportunities",
    "subscriptions",
    "entitlements",
    "campaigns",
    "imports",
    "events",
    "transactions",
    "crm_pipelines",
    "crm_workspaces",
    "crm_leads",
    "crm_tasks",
    "external_references"
  ],
  "documentCounts": {
    "offerings": 0,
    "ideal_customer_profiles": 0,
    "buyer_profiles": 0,
    "hive_definition_revisions": 0,
    "workspace_memberships": 1,
    "brands": 1,
    "brand_kits": 0,
    "hvm_partner_memberships": 1,
    "workspace_integrations": 0,
    "hvm_partners": 1,
    "workspace_partner_assignments": 1,
    "capabilities": 0,
    "capability_instances": 0,
    "commercial_packages": 0,
    "commercial_charges": 0,
    "products": 2,
    "people": 0,
    "contact_points": 0,
    "organisations": 1,
    "organisation_relationships": 0,
    "product_relationships": 0,
    "marketing_permissions": 0,
    "opportunities": 0,
    "subscriptions": 0,
    "entitlements": 0,
    "campaigns": 0,
    "imports": 0,
    "events": 1,
    "transactions": 0,
    "crm_pipelines": 0,
    "crm_workspaces": 1,
    "crm_leads": 0,
    "crm_tasks": 0,
    "external_references": 0
  }
}
```

This is an expected plan, not proof the proposed validators are correct. None of the three new collections exists. No existing validator replacement, index replacement, backfill or destructive change is proposed.

## 4. Migration-history and runtime compatibility

**Static + Live:** existing 006/007 ledger entries remain intact. Setup retains previous migration entries, adds pending entries, creates collections/validators/indexes before advancing the ledger, and rejects conflicts. DDL is sequential, not transactional. Live existing validators match the preflight's expected definitions. Full historical fingerprint regression was **not rerun** before stopping, so complete migration-history sign-off is withheld.

Inspected guards accept HVM context versions 5/6/7/8 and Hive versions 6/7/8. New Offer operations require exactly 8 and fail closed at 7; the existing Offer suite exercises that v7 refusal. There is no schema apply call in the inspected Offer service. A complete startup/request-path and provisioning-guard audit was **not completed** before stopping. No runtime incompatibility was demonstrated, but this is not a full runtime sign-off.

## 5. Methodology verification

**Automated:** existing Offer suite confirms stable Value Equation key/version, four dimensions, 14 stages, immutable catalogue reads and the updated full catalogue digest. **Static/documented:** methodology is code-owned, not workspace duplicated or persisted; there is no proposed methodology collection/seed. Learning consists of Product/Service, Customer, Offer, example, model reference and stage reference. Offer's clean definition remains independent of methodology.

Dedicated learning tests and the requested forbidden-name search were **not rerun/completed** in this task before the stop. Previous successful runs are not counted as current verification.

## 6. Offer Design verification

**Automated + Static:** the existing suite covers resumable work, target IDs, stage progress, strict artifacts, explicit facts/references/assumptions/options/rationale, completion/reopening, concurrency and workspace isolation. Complete designs pin approved source revisions. Work and completion do not automatically create or approve an Offer. No hidden chain-of-thought field exists in the inspected contract.

The persistent collection is `offer_designs`. Full field-by-field parity review stopped at the embedded snapshot defect and is **incomplete**.

## 7. Competitive-analysis persistence

**Static:** bounded `CompetitiveAnalysisSchema` embeds findings in design work (and approval material), not a global competitor collection. Findings include identity/kind, sources, pricing/packaging, capabilities, positioning, target buyer, delivery, contract/commitment/friction, strengths, weaknesses/gaps, relevance and comparisons. Zod requires external evidence for each finding. **Automated:** missing research prevents finalization/approval in the existing tests. Comprehensive Mongo boundary coverage is **not complete**.

## 8. Offer verification

**Static + Automated:** `offers` holds the canonical proposition separately from factual Offering and design work. The contract supports targets, proposition/promise, components, commercial terms, incentives, risk reduction, commitments, positioning, objections/proof, CTA/journey, constraints, rationale, assumptions and unknowns. The strict canonical-content test rejects campaign-copy and methodology-key injection. Parent and method references are not substitute authority. No live Offer record was created.

## 9. Revision/approval verification and defect

**Automated:** draft/edit/approve/revise/archive/exact-history behavior, completed-design snapshot preservation and source pins surviving later source approval pass the existing Offer suite. There is no Offer `observe` action: design/evidence working material is updated explicitly; Offer updates are draft-only. **Static:** semantic hash covers parent/design IDs, definition and competitive analysis; it differs from Hive's separate append-only observation mechanism. No approval is implicit.

`offer_revisions` is the third collection: immutable approved Offer snapshots, optionally accompanied by a completed `designSnapshot`. It is not a methodology collection or generic research store.

**Confirmed defect — Mongo parity:**

1. Use the existing in-memory fixture to construct a valid approved Offer revision with completed design snapshot.
2. Keep one unchanged baseline.
3. Clone it and set only `designSnapshot.updatedAt = designSnapshot.createdAt - 1 millisecond`.
4. Canonical `OfferRevisionSchema.safeParse` accepts baseline and rejects the clone at path `["designSnapshot"]` with `Invalid lifecycle chronology`.
5. Submit both documents to Mongo using `$documents` → `$match` with the actual exported **proposed** `offer_revisions` validator → `$project` of synthetic IDs.
6. Mongo returns IDs `[0,1]`; correct expectation is `[0]`.

Root cause: `offerMongoStructure` strips Zod effects/refinements (`db/offer-validators.ts:17`). The revision validator reapplies lifecycle predicates at `snapshot`, but has no corresponding lifecycle predicate at `designSnapshot` (`db/offer-validators.ts:178–197`). Canonical `OfferRevisionSchema` embeds full `OfferDesignSchema`, whose chronology refinement is enforced by Zod (`domain/offers.ts:268–270`). Direct current design chronology is protected, while its historical embedded form is not.

This is unexplained persistence drift in a simple same-document invariant, analogous to the earlier snapshot-lifecycle issue. Service validation currently rejects the bad object, but that does not satisfy the requested Mongo parity gate. Additional snapshot constraints require systematic review after separately authorized repair; this report does not claim chronology is the only missing constraint.

## 10. Relationship validation

**Automated + Static:** the existing Offer suite verifies foreign workspace/Offering/Buyer rejection and target compatibility; service checks parent existence/scope and approved source snapshots in transactions. Valid ID syntax alone is not a grant. Mongo is not treated as a cross-collection foreign-key engine. Exhaustive relationship audit **not completed**.

## 11. Authorization

**Automated:** existing Offer suite exercises role restrictions, Vapp/foreign-workspace rejection, input injection, stale updates and audit-failure rollback. **Static:** service resolves current HVM context and requires human/HVM application authority. No live user, membership or workspace was created. Dedicated authorization suite and exhaustive owner/onboarder/viewer matrix **not rerun** before stop.

## 12. Zod/Mongo parity review

**FAIL, incomplete.** Structural generation handles many types/bounds/strict fields, but does not preserve Zod refinements automatically. The embedded snapshot chronology discrepancy is proved above. Authorized-service checks such as membership, cross-collection references, concurrency and hash recomputation remain legitimately service-owned; the confirmed date-order rule is not explained by those boundaries.

Do not interpret broad documentation about service refinements as resolving this concrete persistence mismatch. Required/optional/null, number, currency, URL, stage/evidence/commercial and other boundary categories have not received the requested exhaustive verification after this stop.

## 13. Read-only Mongo parity results

- Existing `test/offers.test.ts` with `OFFER_PARITY_MONGO=true`: **10 passed, 0 failed, 0 skipped**. Its Mongo group covers all three proposed validators, three valid fixtures and fifteen representative invalid variants.
- Targeted rerun of the existing Mongo group with an external, temporary diagnostic preload: **1 existing test passed, 0 failed, 0 skipped**. The supplemental diagnostic is outside the test runner's assertions and must not be mistaken for a passing parity result.
- Supplemental chronology comparison: **1 boundary passed (valid baseline), 1 failed (invalid chronology accepted), 0 skipped**. The diagnostic explicitly emitted `passed:false`.

The external harness intercepted only the process-local Mongo read cursor to submit the extra synthetic query and inspect ledger/index metadata. Repository tests, schemas and validator objects were not modified. The harness contains no insert/update/create/collMod/out/merge call. These tests exercised **proposed exported validators**, not installed v8 validators (none are installed).

## 14. Existing-data compatibility

**Live:** two Products, one Organisation, one workspace, one Brand. All four existing Hive collections are empty; all three new collections are absent. The dry-run reports no existing-data incompatibility or uniqueness risk. No existing collection is repurposed. Counts agree with the prior v7 verification, but no historical bytewise comparison was made in this task. No sensitive document contents were printed.

## 15. Index review

**Static + Live plan:** seven additive indexes, no partial/sparse filter and no display-name uniqueness:

| Collection      | Name                       | Keys                                   | Unique | Purpose                                            |
| --------------- | -------------------------- | -------------------------------------- | ------ | -------------------------------------------------- |
| offer_designs   | id_unique                  | `{id:1}`                               | yes    | Global platform ID identity                        |
| offer_designs   | workspace_offering_designs | `{workspaceId:1,offeringId:1,id:1}`    | no     | Scoped Offering design lists/working record lookup |
| offers          | id_unique                  | `{id:1}`                               | yes    | Global platform ID identity                        |
| offers          | workspace_offering_offers  | `{workspaceId:1,offeringId:1,id:1}`    | no     | Scoped Offering proposition lists                  |
| offers          | workspace_design_offers    | `{workspaceId:1,offerDesignId:1}`      | no     | Design-to-Offer lookup support                     |
| offer_revisions | id_unique                  | `{id:1}`                               | yes    | Global revision record ID                          |
| offer_revisions | offer_revision_unique      | `{workspaceId:1,offerId:1,revision:1}` | yes    | Exact immutable approved revision identity         |

Global ID uniqueness follows existing platform convention; there is no global business-name uniqueness or cross-workspace revision collision. Collections are absent, so existing-data duplicate risk is absent. No index query-performance benchmark was run.

## 16. API review

**Static/Automated, partial:** handwritten HVM workspace-scoped method/design/Offer routes; strict inputs, list/read, explicit lifecycle POSTs and exact history. HTTP fixtures demonstrate serialized dates and sanitized error responses. Mutations require expected timestamps and server-owned actors/IDs/lineage. Evidence belongs to explicit working data rather than a new observation endpoint. Exhaustive API/query-pagination review **not completed** before stop.

## 17. Scope-creep check

No implementation was added by this task. Inspected Offer services/catalogue contain data, validation and persistence behavior, not agent execution. No live research, model generation, outreach, billing, provisioning or integration was run. Full repository scope-creep and naming audit **not completed** before stop.

## 18. Full validation results

The immediate-stop requirement takes precedence over completing the remaining checklist. Current-task results:

| Check                                                      | Result                                          |
| ---------------------------------------------------------- | ----------------------------------------------- |
| Secure db:setup dry-run                                    | PASS; exact additive plan above                 |
| Existing Offer tests including live read-only parity       | 10 pass / 0 fail / 0 skip                       |
| Targeted existing Mongo group rerun                        | 1 pass / 0 fail / 0 skip; overlaps previous run |
| Additional snapshot chronology boundaries                  | 1 pass / 1 fail / 0 skip                        |
| Focused learning, dedicated authorization/setup tests      | NOT RUN after stop                              |
| Full API suite, workspace typecheck, API lint/build/format | NOT RUN after stop                              |
| git diff --check                                           | PASS after writing this report                  |

Previous task's 638-pass suite is not a fresh verification result and cannot negate the demonstrated gap.

## 19. Issues/gaps and Git state

Blocking issue: missing embedded design snapshot chronology enforcement. No repair authorized/performed. Remaining verification categories are explicitly incomplete above. A future repair should review all embedded snapshot local invariants, add negative regression coverage, and then rerun the requested complete gate; do not infer that fixing one predicate guarantees full parity.

Only repository change in this task: new `docs/investigations/offer-foundation-v8-pre-migration-verification.md`. All pre-existing unstaged modifications/untracked implementation files remain. Nothing was staged. Final status is recorded below.

## 20. Apply recommendation and operational boundary

**FAIL — DO NOT APPLY v8.** Live remains v7. No database write or persistent test record was made. The inventory contains no test collection; all synthetic fixture documents existed only in memory/collectionless queries, so no cleanup write is necessary. No commit, push or deployment occurred. Stop here for a separate repair decision.

Final `git status --short --untracked-files=all`:

```text
 M artifacts/api-server/src/authorization/policy.ts
 M artifacts/api-server/src/db/collections.ts
 M artifacts/api-server/src/db/hive-validators.ts
 M artifacts/api-server/src/db/setup.ts
 M artifacts/api-server/src/domain/hive-definitions.ts
 M artifacts/api-server/src/domain/ids.ts
 M artifacts/api-server/src/domain/index.ts
 M artifacts/api-server/src/routes/hvm.ts
 M artifacts/api-server/src/services/hive-definitions.ts
 M artifacts/api-server/src/services/hvm-context.ts
 M artifacts/api-server/src/services/hvm-provision.ts
 M artifacts/api-server/test/crm-foundation.test.ts
 M artifacts/api-server/test/domain.test.ts
 M artifacts/api-server/test/hive-definitions.test.ts
 M docs/hive-definitions.md
?? artifacts/api-server/src/db/hive-validators-v6.ts
?? artifacts/api-server/src/db/offer-validators.ts
?? artifacts/api-server/src/domain/offer-methodologies.ts
?? artifacts/api-server/src/domain/offers.ts
?? artifacts/api-server/src/routes/offers.ts
?? artifacts/api-server/src/services/offers.ts
?? artifacts/api-server/test/hive-validator-parity.test.ts
?? artifacts/api-server/test/offer-methodologies.test.ts
?? artifacts/api-server/test/offers.test.ts
?? docs/investigations/hive-definitions-v6-post-migration-verification.md
?? docs/investigations/offer-foundation-v8-pre-migration-verification.md
?? docs/investigations/offering-icp-data-architecture-current-state.md
?? docs/offer-foundation.md
```

</details>

</details>
