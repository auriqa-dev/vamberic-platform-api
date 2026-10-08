# Hive definition foundation — final post-v7 verification

## Final result: PASS

Verified on 2026-09-29. The Hive **Offering → ICP → Buyer Profile** data foundation is ready for the next design phase: **Offering Agent + ICP Agent**. No material outstanding foundation defect was found in this verification.

Live dev is schema **7**, the corrected validators are installed, installed-validator parity passes, runtime guards accept v7, existing data checks pass, code validation passes and secure setup dry-run has no pending work. The earlier v6 defects and pre-apply v7 correction work are preserved below as historical results; their former apply blocker is now resolved.

This is a data-foundation sign-off, not an agent implementation or live customer-CRUD exercise. No database writes, commits, pushes or deployments occurred during this verification.

## Evidence and live schema

**Verified against live dev Mongo:** authenticated using AWS profile `vamberic-admin`, region `eu-west-2`, and the existing secure loader pattern from `docs/hvm-partners.md`. `MONGODB_URI` came from the existing secret and was passed only through process environment. No URI, credentials, secret values or sensitive record contents were printed or written to files.

Database: **`vamberic_studio`**, dev. Both ledger `version` and `schemaVersion` equal **7**. Migration history retains 001 through 006 and contains exactly one `007-hive-validator-consistency` entry at version 7 with an applied timestamp. The original v6 entry remains present.

Live inventory exactly matches the canonical registry: **34 domain collections + `schema_versions` = 35**. All four Hive collections remain present. There are **107 application indexes**, including **12 Hive indexes**, plus Mongo `_id` indexes. Every expected index name, ordered key definition, uniqueness, sparse/partial filter, collation, TTL and hidden setting was compared. There are no missing or unexpected collections/indexes in the current inventory. This matches the expected unchanged v7 inventory; the correction introduced no collection/index additions.

## Installed validators and actual Mongo parity

**Verified against live dev Mongo:** read `listCollections` metadata for `offerings`, `ideal_customer_profiles`, `buyer_profiles`, `hive_definition_revisions`. Each installed validator is deeply equal to its corrected canonical v7 definition, with strict validation and error action.

**Verified by actual Mongo query evaluation using the installed definitions:** the existing repository suite normally references exported source validators. To meet this post-apply request without editing tests, a temporary external preload:

1. Read and checked the installed validators/options and ledger.
2. Assigned those installed BSON validator objects to the already-imported, process-local validator map before the unchanged test suite ran.
3. Ran the existing six current/snapshot Mongo groups using their ordinary `$documents` → `$match` → `$project` pipelines.

Therefore this run used the **actual installed definitions**, not merely assumptions based on source equality. The source comparison provided an additional check. Only a runtime object in the verification process was substituted; no repository source/test/configuration file was changed.

**Result: 350 total tests; 350 passes; 0 failures; 0 skips.** Counts include Zod fixture subtests, six server-evaluated Mongo groups and hash checks; they are not 350 persistent write attempts. Fixture documents existed only in collectionless aggregation input. No insert, transaction rollback, temporary collection or cleanup write was needed.

Coverage includes valid HTTP/HTTPS URLs (including `https://example.com/@company`), representative malformed/non-HTTP/credential URL rejection, future revision pointers, draft/approved/retired combinations, approval metadata, snapshot archive-state and timestamp ordering, evidence chronology/non-finite values/bounds/enums, Partner-ID exclusion, nonempty text, IDs, strict content, ICP branches and Buyer roles. Full WHATWG host/IDNA/port parsing and semantic hashes remain application responsibilities as documented; this is representative parity, not a claim that Mongo duplicates every application invariant.

## Runtime v7 compatibility

**Static executable-code search plus automated/in-memory tests:** the active runtime guards are:

| Guard                          | Accepted versions | Verification                                                                                                     |
| ------------------------------ | ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| `services/hvm-context.ts`      | 5, 6, 7           | Source inspection; v7 HTTP lifecycle resolves HVM context; existing v5 and unknown-future tests pass.            |
| `services/hvm-provision.ts`    | 5, 6, 7           | Source inspection confirms the explicit allowlist; existing provisioning tests passed. No live provisioning ran. |
| `services/hive-definitions.ts` | 6, 7              | Source inspection; v7 create/approve test passes; v5 definition writes fail closed.                              |

A repository executable-code search for ledger/schema guards found no active exact-v5 or exact-v6 HVM guard that rejects v7. The full suite tests v4 rejection, v5 normal-HVM compatibility with Hive unavailable, v6 Hive lifecycles, v7 Hive access and unknown v8 rejection. All allowlists also reject other unlisted older/future versions by inspection. No live mutation was used to test these guards.

## Existing dev data and cleanliness

**Verified against live dev Mongo:** counts and structural compatibility match the previous preflight:

| Collection / record group                                                                      |  Count |
| ---------------------------------------------------------------------------------------------- | -----: |
| Products                                                                                       |      2 |
| Organisations                                                                                  |      1 |
| Client workspaces                                                                              |      1 |
| Brands                                                                                         |      1 |
| HVM Partners                                                                                   |      1 |
| Partner memberships                                                                            |      1 |
| Workspace Partner assignments                                                                  |      1 |
| Workspace memberships                                                                          |      1 |
| Events                                                                                         |      1 |
| Each of offerings / ideal_customer_profiles / buyer_profiles / hive_definition_revisions       |      0 |
| Brand Kits, integrations, capabilities/instances, packages/charges, subscriptions/entitlements | 0 each |

Secure setup preflight checked managed documents against target validators and reported no incompatible documents. The four Hive collections are empty, so their existing-document compatibility is vacuous; synthetic parity separately proves rejection/acceptance behaviour.

Read-only before/after fingerprints of all domain documents, collection metadata, all indexes and the ledger matched exactly during this verification. No records were changed or left behind. These fingerprints prove stability during this run; pre-v7 historical preservation is supported by matching earlier counts and current structural checks, not a pre-v7 bytewise snapshot that this task did not have.

## Final code validation and setup idempotency

Node **24.21.0**, pnpm **10.26.1**. Tests and application files were not modified.

| Command/check                                                                                 | Result                                              |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `pnpm run typecheck`                                                                          | PASS across workspace                               |
| `pnpm --filter @workspace/api-server run lint`                                                | PASS                                                |
| `pnpm --filter @workspace/api-server run build`                                               | PASS                                                |
| `pnpm --filter @workspace/api-server run test`                                                | **630 total: 624 passed, 0 failed, 6 opt-in skips** |
| Existing parity suite, secure loader + installed-validator preload + `HIVE_PARITY_MONGO=true` | **350 total: 350 passed, 0 failed, 0 skipped**      |
| `pnpm --filter @workspace/api-server run format:check`                                        | PASS                                                |
| `git diff --check`                                                                            | PASS                                                |

The full API suite includes domain/parity fixture checks, setup/migration/planner, Hive definition HTTP/in-memory, authorization, version-guard and provisioning tests. The six skipped API tests are exactly the opt-in Mongo groups, separately passed in the installed-validator run. The two totals overlap and must not be summed as distinct tests. API HTTP tests received localhost-listener permission, without live Mongo credentials.

**Verified against live dev Mongo:** secure `pnpm --filter @workspace/api-server db:setup --dry-run` returned:

```json
{
  "existingSchemaVersion": 7,
  "schemaVersion": 7,
  "compatibility": "compatible",
  "collectionsToCreate": [],
  "indexesToCreate": [],
  "validatorsToApply": [],
  "validatorConflicts": [],
  "incompatibleIndexes": [],
  "uniqueIndexRisks": [],
  "uniqueIndexRiskDiagnostics": []
}
```

Setup is at a clean/idempotent state. No `--apply` was invoked.

## Hive foundation behaviour

**Automated/in-memory + static service inspection**, not live customer writes:

| Area                     | Verified status and source                                                                                                                                                                                                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Offering                 | Existing HTTP lifecycle tests pass create draft, update, observe, approve, revise, archive and exact revision reads. Server-authoritative ownership, rejected metadata injection and optional Brand scope checks pass.                                                                    |
| ICP                      | Existing tests pass create, update, approve, revise, archive, Offering ownership and exact approved revision reads. Profile branches pass both Zod and installed-Mongo fixture checks. Observe uses the same inspected shared service; no separate live ICP observation occurred.         |
| Buyer Profile            | Existing tests pass create, update, approve, revise, archive and approved revision reads; explicit Offering/ICP consistency is tested. Buying-role vocabulary passes both validators. Observe uses the same inspected shared service; no separate live Buyer observation occurred.        |
| Shared authorization     | Existing tests pass workspace isolation, unrelated-user denial, fresh membership resolution, human admin/owner approval, onboarder restrictions and viewer read-only behaviour.                                                                                                           |
| Shared consistency       | Existing tests pass optimistic concurrency, transactional rollback in the in-memory adapter, deterministic/semantic hashes, immutable approved history and non-cascading archive.                                                                                                         |
| Evidence                 | Existing tests verify append-only observations, no automatic canonical promotion, retained evidence on edits and server-assigned actors; installed-Mongo fixtures verify bounds/enums/chronology. Static inspection confirms shared revise/observe behaviour and draft-only observations. |
| History/index protection | Exact revision lookup is scoped by workspace/entity/revision. The installed unique index and repaired history validators match expectations. No live duplicate insert was attempted.                                                                                                      |

**Not exercised:** live authenticated customer CRUD, live write-transaction contention/rollback, or an attempted live unique-index violation. These are deliberate no-write verification boundaries, not claims of live end-to-end coverage. No material outstanding defect or additional blocker was identified under the requested verification method.

## Scope, files and final repository status

**Static inspection:** this closes the data foundation only. The Hive modules/routes still use dedicated definition collections, not `capability_instance.output`. This work did not introduce Offering/ICP/Offer agents, an Offer entity, Lead Generation, candidate-account research, agent runtime/authentication, autonomous approval, Swarms, frontend/UI, Odyssiant integration or downstream regeneration. Existing unrelated platform integration concepts predate this foundation.

**Only repository file changed during this verification:** `docs/investigations/hive-definitions-v6-post-migration-verification.md`. Content fingerprints of the other files were compared against the start-of-task baseline. Earlier validator-repair changes remain in the working tree and are not new changes from this verification.

Final status (all entries except the report were already present at task start):

```text
 M artifacts/api-server/src/db/collections.ts
 M artifacts/api-server/src/db/hive-validators.ts
 M artifacts/api-server/src/db/setup.ts
 M artifacts/api-server/src/domain/hive-definitions.ts
 M artifacts/api-server/src/services/hive-definitions.ts
 M artifacts/api-server/src/services/hvm-context.ts
 M artifacts/api-server/src/services/hvm-provision.ts
 M artifacts/api-server/test/domain.test.ts
 M artifacts/api-server/test/hive-definitions.test.ts
 M docs/hive-definitions.md
?? artifacts/api-server/src/db/hive-validators-v6.ts
?? artifacts/api-server/test/hive-validator-parity.test.ts
?? docs/investigations/hive-definitions-v6-post-migration-verification.md
?? docs/investigations/offering-icp-data-architecture-current-state.md
```

No staging, database writes, persistent test records, commits, pushes or deployments occurred. The apply reported by the operator happened before this verification. **The foundation is ready for Offering Agent + ICP Agent design.**

---

<details>
<summary>Historical v6 investigation and pre-apply v7 correction verification (superseded status)</summary>

# Hive definitions post-migration verification and validator correction

## 1. Executive result

**PASS WITH BLOCKER — code correction verified; live validator correction is not applied.**

The original v6 verification discovered independently handwritten Mongo validation drift. The authorized systematic correction is now implemented as **v7, `007-hive-validator-consistency`**, preserving the existing v6 domain contract and original migration definitions. No live migration, data write, commit, push or deployment occurred. This report supersedes the earlier stop-only findings in this same file.

Evidence labels: **Live** means read-only inspection of dev Mongo; **Mongo fixtures** means the actual Mongo query engine evaluated synthetic, non-persistent documents; **Automated** means local/in-memory tests; **Static** means source inspection. Mongo fixtures do not prove installed validators have changed or that live CRUD transactions have been exercised.

## 2. Live schema verification

**Live:** secure loader from `docs/hvm-partners.md`, AWS profile `vamberic-admin`, region `eu-west-2`, existing secret `vamberic/dev/api`. STS authentication succeeded. The URI was passed in process environment, never printed or stored in a file.

Target: dev `vamberic_studio`. Ledger **6**, code target **7**, compatibility **upgrade-pending**. All four Hive collections exist, each empty. Their installed validators match the preserved original v6 definitions; they still require correction. The preflight found all expected indexes, including the twelve Hive indexes with their expected keys/uniqueness/options. No index creation or incompatible index was reported. Existing non-Hive validators have no reported conflicts or proposed changes.

The proposed plan is exactly:

- Replace validators on `offerings`, `ideal_customer_profiles`, `buyer_profiles`, `hive_definition_revisions`.
- No new collections or indexes; no document rewrites.
- No validator conflicts, incompatible indexes or unresolved unique-index risks.
- Existing data is compatible with the targets; Hive compatibility is vacuous because all four collections are empty.

Products: **2**. Organisation, HVM Partner, Partner membership, workspace, primary assignment, workspace membership and Brand: **1 each**. Brand Kits: **0**. The read-only command examined all 34 domain collections. No before-migration document digest was available; current counts/presence and schema compatibility do not prove historical byte-for-byte preservation. This task did not rewrite any record.

## 3. Automated validation results

Node 24.21.0; pnpm 10.26.1. Final results: **624 passed / 0 failed / 6 opt-in skips** in the full API suite; **350 passed / 0 failed / 0 skipped** in the separately authorized read-only Mongo parity run. These totals overlap; they must not be added as distinct coverage.

The initial unprivileged full suite hit sandbox `listen EPERM`; the suite was rerun with localhost listener permission. This was an execution restriction, not an application failure. No live credentials were supplied to the ordinary API suite.

Focused Mongo parity runs load credentials securely and run only `hive-validator-parity.test.ts`, with `HIVE_PARITY_MONGO=true`. Each of six groups uses collectionless aggregation (`$documents`, `$match`, `$project`), without insert/update/create/collMod/out/merge. No test collection is created. Normal API tests skip those six opt-in groups.

## 4. Offering lifecycle verification

**Automated + Static:** existing HTTP/in-memory tests cover revision-1 draft creation, server-derived Organisation/workspace, scope/metadata injection rejection, foreign Brand rejection, draft replacement, optimistic concurrency, immutable approved snapshots, revision increment, approval pointer retention and archive/history reads. Update/revise/approve/observe/archive use the same transactional service and strict inputs.

Evidence tests establish append-only observation, actor assignment, invalid candidate-path rejection, unchanged canonical content/hash, preservation through update and rejection of client evidence replacement. Parity fixtures exercise the 100-observation boundary; service parsing enforces it before commit. Approval and revision fields remain server-controlled. Static inspection confirms observations require a draft and revise retains evidence while clearing current approval metadata.

New HTTP regression verifies malformed URL returns sanitized 400, and a valid `https://example.com/@company` creates successfully in memory. **Mongo fixtures** verify the same URL in current Offering and approved snapshot validators. No live Offering was created.

## 5. ICP lifecycle verification

**Automated + Static:** same shared lifecycle service as Offering. Existing tests create ICPs under an Offering, approve/read exact revisions, revise/update/archive and reject reparenting. Parent archival prevents approval; no cascade deletes children. Cross-workspace parents are denied even with shared Organisation identity.

**Mongo fixtures + Automated:** B2B/B2C/D2C branches agree, wrong branch and unknown profile type fail, strict content and representative characteristic/list bounds agree. Account/consumer branches are optional in both contracts; no new requirement to populate them was invented.

## 6. Buyer Profile lifecycle verification

**Automated + Static:** explicit Offering and ICP are required; ICP must refer to the same Offering in the same workspace. Cross-Offering creation is rejected. Tests cover approval/exact revision reads, revision/update/archive and reparenting rejection. Parent archive prevents inappropriate approval while explicit child archive remains available.

**Mongo fixtures + Automated:** required parent IDs, ID prefixes and shared Opportunity buying-role enum are exercised. No live Buyer Profile was created.

## 7. Authorization/isolation verification

**Automated + Static:** current memberships are re-resolved for reads and within write transactions. Context is issued by central authorization; request JSON cannot supply its authority. Existing tests deny Vapp tokens, unrelated humans, foreign workspace/Brand references and revoked memberships. Viewer reads but cannot create; onboarder drafts but cannot approve/archive. Admin/owner approval is exercised by lifecycle tests. Central policy tests also run in the full suite.

Static action mapping permits admin/owner all supported operations; onboarder create/update/revise/observe and read; viewer read only. Organisation/Product/domain/email identity alone does not grant a workspace. No authorization policy or membership record was changed.

Compatibility: normal HVM context/provisioning accepts **5/6/7**; definitions accept **6/7**. Existing tests keep v5 definition access closed and reject unknown future version 8. A new v7 HTTP lifecycle test creates and approves in memory. No active exact-v5/v6 guard remains in the inspected HVM services.

## 8. Revision/hash verification

**Automated + Mongo fixtures:** approved pointer equals revision, draft pointer (if present) is strictly previous, retired pointer is not future. Missing/equal/future/previous cases are checked in applicable states. Snapshots require approved metadata and matching outer workspace/entity/revision identity by source inspection and existing exact-history tests.

**Automated + Static:** semantic hash sorts object keys, preserves array order, includes immutable relationship IDs and definition content, excludes timestamps/actors/evidence/lifecycle/revision. New tests verify key-order equivalence, array-order significance, relationship sensitivity and metadata independence. A content-identical new revision may retain the hash. Mongo validates hash format; the service recomputes it.

Exact history reads use workspace + entity type + entity ID + revision. **Live preflight** confirms the declared unique history index is present; no synthetic duplicate was inserted into live Mongo. No supported history edit/delete route exists.

## 9. Archive/dependency verification

**Automated + Static:** Offering archive does not cascade; dependents remain readable and explicitly archivable. Archived parents block non-archive dependent mutations. Approved history remains accessible after archive. ICP/Buyer use the shared hierarchy checks.

Organisation delete planning checks both current Offerings (including archived) and immutable Offering snapshots via `snapshot.organisationId`. Existing guarded-delete tests and the full CRM delete suite pass. No restore or hard-delete behaviour was added.

**Mongo fixtures:** snapshots now reuse current lifecycle constraints, rejecting `archived:false` with `archivedAt`, reverse creation/update dates and out-of-range approval dates. Evidence timestamps also cannot exceed their recorded/current update boundaries.

## 10. API contracts

**Automated + Static:** routes remain under `/api/v1/hvm/workspaces/:workspaceId`, separate from Vapp Product routes. Each resource supports list/read/exact revision read and POST create/update/revise/approve/archive/observe. Create returns 201; other operations return 200.

List defaults: 20/offset 0, limit 1–100, offset 0–10,000. Default excludes archived; `archived=true` selects archived. Offering supports Brand filtering; ICP supports Offering; Buyer supports Offering/ICP. Unknown query/body keys fail; inappropriate resource-specific filters return authorization-style 404. Scoped current/history reads include archived records.

HTTP dates serialize as ISO strings; persistence uses Dates. Responses use sanitized 400 validation, 404 missing/denied, 409 concurrency/duplicate conflict and 503 unavailable envelopes. New malformed-URL handling fixes an unintended exception without changing accepted URL semantics.

## 11. Scope-creep and systematic consistency review

Only definition validation, guarded schema correction, compatible version guards, tests and documentation changed. No Offer, agent/runtime/authentication, Lead Generation, Swarm, integration, frontend or downstream regeneration was introduced. Existing unrelated platform concepts were left intact.

| Invariant/category          | Result and enforcement                                                                                                                                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| URL                         | Repaired broad `@` exclusion. Mongo syntax guard permits valid paths/query/fragment and excludes nonempty credentials/non-HTTP schemes. Zod retains full WHATWG semantics. Malformed application URLs now return validation failure rather than throw. |
| Revision pointers           | Repaired missing equality/order rules in all current types and history.                                                                                                                                                                                |
| Snapshot archive/chronology | Repaired omission of current lifecycle predicates from snapshots; same predicate is rebased to snapshot paths.                                                                                                                                         |
| Evidence chronology         | Repaired missing observedAt ≤ recordedAt ≤ updatedAt checks, including snapshots.                                                                                                                                                                      |
| Evidence values             | Repaired acceptance of unbounded non-finite numbers/Decimal128: canonical API accepts finite JavaScript numbers, not BSON Decimal128 objects.                                                                                                          |
| Human IDs                   | Repaired missing `partner_` exclusion; no invented identity/role grant.                                                                                                                                                                                |
| Nonempty strings            | Added non-whitespace check; canonical trimming still occurs before writes.                                                                                                                                                                             |
| Required/optional/null      | Reviewed typed optionals, strict definitions and required IDs; defaults are materialized by Zod before persistence. Source strips unknown fields in the application before strict Mongo storage.                                                       |
| IDs/ownership               | Matching registered prefixes and required workspace/parent fields. Reparenting and same-workspace existence are service rules.                                                                                                                         |
| Enums/arrays                | Shared classification/list/role constants and matching maxima. Text lists enforce uniqueness; enum arrays are not made unique where Zod does not require it.                                                                                           |
| ICP branches                | Matching optional B2B account versus B2C/D2C consumer branches, strict nested objects.                                                                                                                                                                 |
| Base/source/date fields     | BSON type/date and existing lifecycle checks retained; no requirement for source or new chronology such as importedAt ordering was invented.                                                                                                           |
| Schema/revision integers    | Existing positive-integer semantics retained; no new safe-integer maximum introduced.                                                                                                                                                                  |
| Hash and snapshot identity  | Format and local identity comparisons retained; semantic recomputation remains application-owned.                                                                                                                                                      |

Intentional boundaries, not unexplained drift: full URL host/IDNA/port parsing, Unicode normalization and JavaScript UTF-16 string-length accounting, trims/defaults, JSON 200KB limit, semantic hash computation, evidence candidate interpretation/promotion, current membership/human approval authority, optimistic concurrency, immutable history access, Organisation/Brand/parent references and archive checks. Mongo document validators cannot replace these services. Parity fixtures cover representative documents, not a proof of equivalence for every arbitrary BSON input. Direct domain writes bypassing the service remain unsupported.

## 12. Live verification gaps and migration strategy

**Blocked:** installed validators are original v6. Mongo fixture success proves corrected expressions, not an applied correction. Authenticated live CRUD, Mongo write-transaction contention/rollback and installed-index duplicate rejection were not exercised; doing so would require writing records. In-memory lifecycle/rollback tests are explicitly not live transaction tests.

There was no established same-version replacement mechanism: setup rejected any changed nonempty validator. Implemented v7 permits only exact historical v6 definitions at ledger 6 (strict/error), or already-correct target validators during a partial retry. Arbitrary drift still blocks; existing-data incompatibility blocks before mutation. Original v6 definitions and a regression fingerprint preserve truthful migration history. No new collection/index or rewrite is necessary.

A separately authorized apply would replace four validators and append v7 only after success. A simulated mid-correction failure leaves ledger 6; retry finishes remaining validators, retains all existing data/indexes/history and is idempotent. DDL is sequential, not atomic: use one schema operator and inspect after any failure. Unknown concurrent DDL changes are outside the migration's supported single-operator execution model.

Next: review this code/plan, obtain separate authorization for the secure v7 apply, then rerun the same secure dry-run and verify ledger 7, zero pending work and installed target validators. Keep v7-compatible API guards for deployment/rollback. Do not claim overall live PASS before that verification.

## 13. Files changed and validation record

Source changes: `db/collections.ts`, `db/setup.ts`, `db/hive-validators.ts`, new `db/hive-validators-v6.ts`; `domain/hive-definitions.ts`; version guards in `services/hive-definitions.ts`, `services/hvm-context.ts`, `services/hvm-provision.ts`.

Tests: `test/domain.test.ts` (guarded v7 migration, incompatibility refusal, partial failure/retry, historical fingerprint, updated target expectations); `test/hive-definitions.test.ts` (v7 access and URL HTTP boundary); new `test/hive-validator-parity.test.ts` (six entity/current/snapshot groups, opt-in real Mongo query checks, hash semantics).

Docs: `docs/hive-definitions.md` and this existing report. The pre-existing architecture investigation under `docs/investigations/` was not modified.

| Command/check                                                                                                                                  | Final result                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm run typecheck`                                                                                                                           | PASS, workspace including API/Vapp/scripts                                                                                                                  |
| `pnpm --filter @workspace/api-server run lint`                                                                                                 | PASS                                                                                                                                                        |
| `pnpm --filter @workspace/api-server run build`                                                                                                | PASS                                                                                                                                                        |
| `pnpm --filter @workspace/api-server run test`                                                                                                 | 630 reported tests: 624 pass, 0 fail, 6 opt-in Mongo groups skipped. Includes domain, setup/planner, Hive HTTP/in-memory, authorization and all API suites. |
| Secure child: `HIVE_PARITY_MONGO=true`, `pnpm --filter @workspace/api-server exec node --import tsx --test test/hive-validator-parity.test.ts` | 350 pass, 0 fail, 0 skip. Includes Zod fixture subtests plus six actual Mongo validator query groups and hash assertions.                                   |
| `pnpm --filter @workspace/api-server run format:check`                                                                                         | PASS                                                                                                                                                        |
| Secure `pnpm --filter @workspace/api-server db:setup --dry-run`                                                                                | PASS: ledger 6 → target 7, four validators only, no conflicts or incompatible data                                                                          |
| `git diff --check`                                                                                                                             | PASS                                                                                                                                                        |

Final `git status --short --untracked-files=all`:

```text
 M artifacts/api-server/src/db/collections.ts
 M artifacts/api-server/src/db/hive-validators.ts
 M artifacts/api-server/src/db/setup.ts
 M artifacts/api-server/src/domain/hive-definitions.ts
 M artifacts/api-server/src/services/hive-definitions.ts
 M artifacts/api-server/src/services/hvm-context.ts
 M artifacts/api-server/src/services/hvm-provision.ts
 M artifacts/api-server/test/domain.test.ts
 M artifacts/api-server/test/hive-definitions.test.ts
 M docs/hive-definitions.md
?? artifacts/api-server/src/db/hive-validators-v6.ts
?? artifacts/api-server/test/hive-validator-parity.test.ts
?? docs/investigations/hive-definitions-v6-post-migration-verification.md
?? docs/investigations/offering-icp-data-architecture-current-state.md
```

The last file was pre-existing and remains untouched; the verification report also began untracked. Nothing was staged.

## 14. Operational boundary

No live collection, document, index, validator or ledger was changed. No persistent fixtures, provisioning or demo/customer data were created. No credentials or secret values were printed. No commits, pushes, deployments or migration apply occurred.

Remaining blocker: separate authorization and execution of the v7 validator correction, followed by installed-state verification. Code repairs preserve the existing domain semantics; they do not constitute a new domain model.

</details>
