# Empress operating-layer verification — history and resumed verification

**PASS — FINAL POST-v9 VERIFICATION.** Live dev schema v9, installed validators/indexes, data integrity, authorization and read-only parity are verified. The final post-v9 section supersedes the earlier pre-migration status; implementation and repair history remain below.

## Initial verification (historical)

## Confirmed stop condition

The new central authorization branch groups five global and four workspace resources together, then selects Empress versus Queen authority based only on whether `resource.workspaceId` is present. It does not enforce the intrinsic scope of the resource type.

A focused policy regression suite confirms:

1. A Partner-derived Queen can obtain `update` authorization for `agent_definitions` when the resource carries the Queen's assigned workspace ID. Global definitions must remain Empress-only.
2. Empress can obtain `update` authorization for `client_swarms` when workspaceId is absent. Workspace resources must require an explicit authorized workspace.

The new operating service's `access` function separately rejects these malformed resource/scope combinations. These findings establish a central policy defect, **not a demonstrated HTTP endpoint bypass or live data exposure**. Depending on service-side duplication is not sufficient to claim that the central policy is safe.

Section 76 explicitly requires stopping during verification for an authorization/isolation defect. Implementation stopped without repairing the policy or proceeding to migration verification.

Recommended focused repair: classify global and workspace operating resources separately in the central policy, reject invalid scope shapes before grants are considered, and retain independent Partner assignment checks for workspace access. Review workload-grant ordering at the same boundary. Then resume the required authorization, service, parity and migration checks. No product decision is needed to understand the intended scope boundary.

## Architecture proposal at stop

Existing capabilities and capability instances remain unchanged: a Capability represents a reusable function, not a versioned specialist Agent. New Agent Definitions reference capabilities, while client agent instances reference exact definitions and may reference existing capability instances.

Existing commercial packages remain capability groupings; Swarm Templates describe jobs and provider-neutral composition. Existing subscriptions remain Product/provider-oriented records, while proposed Swarm Agreements preserve configured-Swarm commercial terms without fabricating billing records. Existing charges and entitlements are not repurposed. Workspace integrations remain the connection store; new provider definitions and instance bindings reference that store rather than duplicating credentials.

No existing persisted collection is intentionally extended by the operating-layer proposal. The nine proposed collections are:

- agent_definitions
- integration_providers
- swarm_templates
- commercial_policies
- methodology_availability
- client_agents
- client_swarms
- pricing_recommendations
- swarm_agreements

Corresponding ID prefixes are agentdefinition, integrationprovider, swarmtemplate, commercialpolicy, methodologyavailability, clientagent, clientswarm, pricingrecommendation and swarmagreement. These resources were added to the authorization vocabulary. External-reference and guarded-deletion integration review is not complete.

## Authority proposal

Empress uses an explicit server-configured `HVM_EMPRESS_SUBJECTS` allowlist tied to the existing trusted Cognito issuer and HVM application. Queen authority derives from active Partner membership and workspace assignment. Client admin membership alone is insufficient. Intended global/workspace separation is currently blocked by the policy defect above. Commercial decisions outside the pinned policy require separate Empress approval; end-to-end validation remains outstanding.

## Registry, integrations and Swarms

The draft schemas include stable definition keys and versions, draft/active/retired lifecycle, availability, capability and dependency references, declarative Hive access, typed configuration, integration slots and cost drivers. Published definitions are intended to remain immutable; new versions require new records.

Provider definitions describe capabilities and authentication metadata. Instance bindings reference exact provider versions and existing workspace integrations, with client-funded, HVM-funded, pass-through and included-allowance treatment. They permit multiple bindings; no failover execution is implemented.

Client Swarms reference exact template versions and client agent instances. Configuration revisions and immutable recommendation snapshots are intended to retain history. Readiness checks cover dependencies, required agents, configuration and compatible same-workspace connections. These paths are not yet comprehensively validated. No catalogue was seeded. Lead Generation remains a Swarm/job concept; Contact Management terminology is retained.

## Commercial and methodology proposal

Commercial Policies capture versioned economic assumptions, effective dates and Queen decision limits. Pricing Recommendations freeze configuration, policy and economic inputs separately from Queen decisions and final agreement amounts. Deterministic decision math supports percentage/fixed discounts and custom prices, with commitment separate from monthly/annual billing.

Internal and waived treatment is intended to preserve economic recommendations while producing zero billed amounts and no payment dependency. Built Matters and HVM can therefore use the same intended model without named-client special cases; this has not yet passed end-to-end commercial tests. Provider integration is only a future seam. No Stripe/payment records or payment engine were implemented.

Methodology availability references code-owned catalogue ID/version, including Value Equation v1. Methodology content is not copied into a second Mongo source of truth.

## Proposed database change — not verified live

Previous verified live schema: 8. Proposed target: 9 (`009-empress-operating-foundation`). The declaration proposes 9 new collections, 9 validators and 29 application indexes. None were created by this task.

Each of five global collections declares ID uniqueness, key/version uniqueness and a status/availability catalogue index (15 indexes). Commercial Policies additionally declare one active policy per currency through a partial unique index (1). The four workspace collections declare ID and workspace/ID indexes (8), with definition/integration queries for client agents (2), agent membership queries for Swarms (1), recommendation-by-Swarm (1), and agreement-by-Swarm/status/effectivity (1).

The draft runtime strategy permits existing HVM functionality on schemas 5–9, Hive functionality on 6–9 and Offers on 8–9; new operating services require 9. Compatibility regression tests are still required. No live compatibility, validator conflicts, index conflicts or uniqueness-risk conclusions can be drawn from this stopped run.

## Validation evidence

Command:

```sh
pnpm --filter @workspace/api-server exec node --import tsx --test test/operating-authorization.test.ts
```

Result: **6 tests; 4 passed, 2 failed, 0 skipped, 0 cancelled**.

Passing checks: Queen's assigned workspace access; denial for client-admin-only access; denial for another workspace; normal global mutation requires Empress.

Failing checks: the two scope-shape cases described above.

An earlier API typecheck completed successfully before the regression test was added. `git diff --check` passed at the stop point. Neither result establishes readiness.

Full API tests, complete operating/commercial/integration tests, migration tests, validator parity, workspace typecheck, API lint/build/format check and secure dev dry-run have **not been completed for this implementation**. Tests not run are not counted as skipped. The secure live checks were deliberately not reached after the stop condition.

## Scope and environment

No frontend, agent or Swarm execution, individual agent behaviour, LLM orchestration, AI pricing/Swarm assembly, Stripe or payment collection was implemented. No AWS/Mongo access occurred during this verification. No migration apply, database writes, seed/provisioning operations, persistent test records, deployment, commit, push or staging occurred. Tests used only in-memory synthetic authorization contexts.

The repository already contained uncommitted Hive/Offer foundation work before this task. The final status below includes that pre-existing work; it must not be attributed wholesale to the operating-layer implementation.

Current operating-layer work touches configuration/environment examples, policy, IDs/domain exports, collection/setup declarations, HVM routing and compatibility/context services. New files include the operating domain/logic, validators, service, router, authorization regression tests and documentation. The architecture document remains a proposal: `docs/empress-operating-layer.md`.

## Final Git status

```text
 M artifacts/api-server/.env.example
 M artifacts/api-server/src/authorization/policy.ts
 M artifacts/api-server/src/config.ts
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
?? artifacts/api-server/src/db/operating-validators.ts
?? artifacts/api-server/src/domain/offer-methodologies.ts
?? artifacts/api-server/src/domain/offers.ts
?? artifacts/api-server/src/domain/operating-logic.ts
?? artifacts/api-server/src/domain/operating.ts
?? artifacts/api-server/src/routes/offers.ts
?? artifacts/api-server/src/routes/operating.ts
?? artifacts/api-server/src/services/offers.ts
?? artifacts/api-server/src/services/operating.ts
?? artifacts/api-server/test/helpers/offer-parity.ts
?? artifacts/api-server/test/hive-validator-parity.test.ts
?? artifacts/api-server/test/offer-methodologies.test.ts
?? artifacts/api-server/test/offers.test.ts
?? artifacts/api-server/test/operating-authorization.test.ts
?? docs/empress-operating-layer.md
?? docs/investigations/
?? docs/offer-foundation.md
```


## Resumed verification after authorized scope repair

### Repair and classification

Root cause of both original defects: the new policy branch selected platform versus workspace authority from the caller-supplied presence of workspaceId without first enforcing each resource's intrinsic scope.

`RESOURCE_SCOPES` now explicitly classifies all policy resources. The nine operating resources are classified as follows:

| Class | Resources |
| --- | --- |
| Global | agent_definitions, integration_providers, swarm_templates, commercial_policies, methodology_availability |
| Workspace | client_agents, client_swarms, pricing_recommendations, swarm_agreements |

Global resources reject any supplied workspace. Workspace resources require a valid workspace ID. These checks run before human **and nonhuman** grants, so a trusted workload grant cannot repair an invalid resource scope. Existing service authentication seams were not expanded.

Existing resources retain `legacy_internal_or_workspace` grant behavior. This preserves the existing Vapp-internal/HVM-workspace policy rather than silently changing Brand, Brand Kit, connections, team membership, Offering/ICP/Buyer Profile, Offer Design/Offer or capability/commercial behavior. Persisted entity/service restrictions still apply. No unrelated existing scope vulnerability was established by this review.

Queen authority still requires an active Partner-derived assignment to the requested workspace. Client-admin/viewer membership alone does not grant operating authority. Empress requires the explicit server-side allowlist and does not imply arbitrary client access. Combined roles work through independent valid grants; no identity special case was added.

Bindings and Queen commercial decisions are embedded in workspace-scoped client-agent/agreement resources. There are no invented standalone resources. The existing boolean/sanitized-error policy interface is preserved; no HTTP membership detail is exposed.

Service-layer scope checks and relationship checks remain intact. Only formatting changed in the operating service/router during this repair.

### Regression and local validation results

- Original six regressions: **6 passed, 0 failed, 0 skipped** (previously 4/2/0).
- Expanded operating authorization suite: **15 passed, 0 failed, 0 skipped**.
- Complete authorization run including existing policy tests: **21 passed, 0 failed, 0 skipped**.
- Matrix includes Empress only, Queen owner, Partner onboarder, client admin, client viewer, combined Empress/Queen, unauthorized human, agent and system contexts; all nine resources, correct/omitted/wrong/malformed scopes; read/create/update/approve. Publish/configure/retire map to update in the existing service.
- Full API suite: **873 total; 865 passed, 0 failed, 8 skipped, 0 cancelled**. Includes existing commercial, integration, DB setup and local parity tests. Opt-in integration/parity skips are not evidence of live parity passing.
- Added in-memory v8→v9 setup test: verifies nine empty additions, 29 indexes, unchanged existing validators/indexes/documents and idempotent retry. It passed within the API run; no live apply was invoked.
- Workspace typecheck: **PASS**.
- API lint: **PASS** (removed one unused helper from the unfinished operating validator module; no predicate changed).
- API build: **PASS**.
- API format check: **PASS** after formatting unfinished operating files.
- `git diff --check`: **PASS**.

The first full test attempt was blocked by sandbox localhost-listener permissions. The authorized unsandboxed run exposed ten stale v8 target/count/future-version expectations, which were updated for the actual v9 proposal without altering historical migration fixtures or validator definitions. The final full API result above is the rerun. Earlier lint/format failures were corrected without domain redesign.

### Read-only Mongo parity: confirmed new stop condition

AWS profile `vamberic-admin` passed the read-only identity check. The existing secure loader retrieved `MONGODB_URI` from `vamberic/dev/api` in eu-west-2 into the child process environment only. No URI/secret was printed or written to a file.

The new parity fixture constructs an Agent Definition with 40 configuration fields, each containing 30 bounded 200-character choices. Every individual array/string bound is respected, but the complete record exceeds the canonical 200,000-byte JSON size limit.

Results:

- Valid baseline: Zod and Mongo both accept.
- Global record carrying workspaceId: both reject.
- Reversed chronology: both reject.
- Aggregate record over 200 KB: **Zod rejects; proposed Mongo validator accepts**.

Runner result: **9 total; 7 passed, 2 failed, 0 skipped**. There is **one failing parity case**; Node additionally counts the enclosing failed parent test. Broken down: canonical checks 4/0; Mongo leaf checks 3/1.

Cause: `OperatingSchemas` includes a final `Buffer.byteLength(JSON.stringify(record)) > 200000` refinement, while `OPERATING_MONGO_VALIDATORS` is generated from `OperatingRecordSchemas` with additional local expressions that omit this record-size invariant. The proposed predicate was exercised directly using database-level `$documents` + `$match` + `$project` aggregation against `vamberic_studio`. There were no inserts, updates, DDL, output/merge stages or temporary collections.

Section 18 requires stopping on unexplained validator drift. No size-validator fix or domain redesign was attempted. Recommended next repair is a deliberately equivalent record-size contract in application and Mongo validation, with boundary tests. A BSON-size check must not be assumed equivalent to the current JSON-byte measurement without justification.

### Current migration/readiness status and remaining work

**FAIL — DO NOT MIGRATE.** The authorization repair is verified; the wider operating foundation is not yet fully verified.

Proposed schema remains **8→9**, nine new collections/nine validators/29 application indexes, with existing records and persisted contracts intentionally unchanged. Previous live schema 8 was not re-read in this run; the parity query validates proposed predicates, not the installed migration ledger.

No secure `db:setup --dry-run` was run after the parity failure. Current live migration conflicts, incompatible indexes, uniqueness risks and existing-data compatibility therefore remain **unverified**. No apply was run.

All-nine-validator parity coverage, complete operating service/commercial/history/readiness tests and the secure migration preflight remain outstanding. Passing the current API suite does not close those coverage gaps. The architecture/reuse, registry, provider/binding, Swarm and commercial proposals described above were not redesigned. Internal/waived zero-billing and monthly/annual support remain draft implementation capabilities, not newly established end-to-end guarantees.

### Files changed by this repair/resumed verification

Behavioral repair:
- artifacts/api-server/src/authorization/policy.ts

Tests added/updated:
- artifacts/api-server/test/operating-authorization.test.ts
- artifacts/api-server/test/operating-validator-parity.test.ts (new)
- artifacts/api-server/test/authorization.test.ts
- artifacts/api-server/test/domain.test.ts
- artifacts/api-server/test/crm-foundation.test.ts
- artifacts/api-server/test/hive-definitions.test.ts

Formatting of unfinished work only, except removal of an unused validator helper:
- artifacts/api-server/src/config.ts
- artifacts/api-server/src/db/collections.ts
- artifacts/api-server/src/db/operating-validators.ts
- artifacts/api-server/src/domain/operating.ts
- artifacts/api-server/src/domain/operating-logic.ts
- artifacts/api-server/src/routes/operating.ts
- artifacts/api-server/src/services/hvm-context.ts
- artifacts/api-server/src/services/operating.ts

Documentation:
- docs/empress-operating-layer.md
- docs/investigations/empress-operating-layer-verification.md (this existing report; initial findings retained)

No database writes occurred. No persistent test records or temporary collections were created. Nothing was staged, committed, pushed or deployed. No frontend, agent/Swarm execution, payment functionality or AI pricing was added.

### Final Git status after resumed verification

The status includes prior uncommitted work; it is not a list of changes attributable solely to this repair.

```text
 M artifacts/api-server/.env.example
 M artifacts/api-server/src/authorization/policy.ts
 M artifacts/api-server/src/config.ts
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
 M artifacts/api-server/test/authorization.test.ts
 M artifacts/api-server/test/crm-foundation.test.ts
 M artifacts/api-server/test/domain.test.ts
 M artifacts/api-server/test/hive-definitions.test.ts
 M docs/hive-definitions.md
?? artifacts/api-server/src/db/hive-validators-v6.ts
?? artifacts/api-server/src/db/offer-validators.ts
?? artifacts/api-server/src/db/operating-validators.ts
?? artifacts/api-server/src/domain/offer-methodologies.ts
?? artifacts/api-server/src/domain/offers.ts
?? artifacts/api-server/src/domain/operating-logic.ts
?? artifacts/api-server/src/domain/operating.ts
?? artifacts/api-server/src/routes/offers.ts
?? artifacts/api-server/src/routes/operating.ts
?? artifacts/api-server/src/services/offers.ts
?? artifacts/api-server/src/services/operating.ts
?? artifacts/api-server/test/helpers/offer-parity.ts
?? artifacts/api-server/test/hive-validator-parity.test.ts
?? artifacts/api-server/test/offer-methodologies.test.ts
?? artifacts/api-server/test/offers.test.ts
?? artifacts/api-server/test/operating-authorization.test.ts
?? artifacts/api-server/test/operating-validator-parity.test.ts
?? docs/empress-operating-layer.md
?? docs/investigations/empress-operating-layer-verification.md
?? docs/investigations/hive-definitions-v6-post-migration-verification.md
?? docs/investigations/offer-foundation-v8-pre-migration-verification.md
?? docs/investigations/offering-icp-data-architecture-current-state.md
?? docs/offer-foundation.md
```


## Final verification — authorized validator-parity repair

**PASS — EMPRESS OPERATING-LAYER DATA FOUNDATION READY TO MIGRATE.**

This final section supersedes the earlier stopped results without deleting their history. Schema v9 is still unapplied.

### Confirmed cause and focused repair

`OperatingSchemas` adds the `Buffer.byteLength(JSON.stringify(parsedRecord)) > 200000` refinement after constructing each record schema. The Mongo compiler previously consumed the structural record schemas and omitted that final refinement. This affected **all nine entities**, not only Agent Definitions.

The unchanged contract applies to the **complete parsed domain record**, including root metadata, actors, timestamps, defaults, configuration and nested snapshots. It excludes Mongo `_id`. It measures UTF-8 JSON bytes, not BSON bytes, character count or configuration alone.

Added `src/db/operating-json-size.ts` and applied its expression to all nine proposed validators. The implementation counts schema-known JSON key/colon/comma/bracket overhead, UTF-8 strings and JSON escaping, null/booleans, defaults, ISO dates and numeric serialization. Mongo exponent spellings are normalized to JavaScript's fixed/scientific thresholds. No size limit, Zod acceptance rule or domain semantics was weakened or increased. It does not rely on a client-supplied size field or use `$bsonSize` as an approximation.

Mongo collection validators prohibit `$function`, so the repair uses native expressions rather than server-side JavaScript. See [MongoDB validation restrictions](https://www.mongodb.com/docs/manual/core/schema-validation/specify-query-expression-rules/). Initial expressions exceeded the dev environment's 50-level BSON nesting limit; read-only execution returned code 8000, `Nested BSON depth greater than 50 not allowed`. Required-object expressions were flattened without changing their meaning. Maximum proposed validator nesting is now 46 and all nine execute in the dev environment.

### Additional bounds/parity findings

| Finding | Resolution |
| --- | --- |
| Mongo string maxLength counts code points; Zod counts UTF-16 units | Added the supplementary-code-point contribution to the Mongo length guard, including nested fields/snapshots. |
| JavaScript whitespace-only strings such as BOM/nonbreaking space could pass the inherited nonempty pattern | Added the canonical JavaScript trim-character nonempty guard for bounded text. |
| Inherited datetime regex accepted nonexistent calendar dates | Reused the canonical Zod datetime regex, including calendar/leap-year semantics. |
| BSON Date has a wider representable range than JavaScript Date | Added the JavaScript Date epoch bound. |
| Inherited compiler omitted URL syntax entirely | Added a bounded scheme syntax guard; full WHATWG parsing remains application-owned under the existing Hive/Offer convention, explicitly documented below. |
| Expanded native validator expressions exceeded dev BSON nesting limit | Flattened expressions; no infrastructure change and no migration change required. |

No other unexplained document-level mismatch was found in the reviewed contract or representative fixtures. Schema-level constraints follow the actual canonical declarations; no new uniqueness, treatment, discount or lifecycle rules were invented.

### Systematic nine-entity review

| Entity | Reviewed persisted contract |
| --- | --- |
| Agent Definition | Global ID/key/version, availability/lifecycle, capabilities/dependencies, Hive declarations, bounded configuration/slots/cost drivers, full record cap. |
| Integration Provider | Global identity/version, provider capabilities/auth/account metadata, bounds and cost metadata. |
| Swarm Template | Global identity/version, required/recommended/optional references and declared uniqueness, job/guidance/integration/commercial assumptions. |
| Commercial Policy | Global identity/effectivity, currency, fractions/margins, integer money limits, treatment authority and assumptions. |
| Methodology Availability | Global identity/version, exact code-owned methodology reference and compatible Agent references. |
| Client Agent | Workspace ID/configuration revision, exact Agent Definition reference, typed configuration, instance/capability dependencies, provider/connection bindings and cost treatment. |
| Client Swarm | Workspace identity/revision, optional exact template lineage, agent composition, configuration/job/notes. |
| Pricing Recommendation | Workspace identity, immutable service artifact, policy/configuration/version references and bounded snapshots, costs/recommendations/currency/margins/rationale. |
| Swarm Agreement | Workspace identity, decision and retained recommendation snapshot, recommended/final monetary fields, adjustment structure, treatment, term/billing combinations, effectivity and actors/timestamps. |

All nine were reviewed for required/optional/null fields, strict nested shapes, prefixed IDs, ownership, versions, lifecycle/archive/chronology, string/array bounds, declared duplicates, finite/integer/nonnegative numbers, money/currency and snapshot rules. Shared compiler rules apply recursively to nested occurrences. No unrestricted configuration/metadata object was introduced.

### Intentional application/service-only invariants

These are explicit layered responsibilities, not claims that Mongo independently enforces the entire service:

- trusted identity, current memberships/assignments, central Empress/Queen scope, workspace authority and service-grant semantics;
- foreign-key existence, exact version/catalogue lookup, provider compatibility, connection ownership/state, dependency resolution and readiness;
- recommendation computation, derived commercial consistency, discount authority, approval workflow, overlapping agreement intervals, immutability across updates and historical snapshot creation;
- complete WHATWG URL parsing (IDNA, numeric hosts and port semantics), following the already documented Hive/Offer boundary. Mongo enforces bounded URL/issuer syntax, not a duplicate browser URL parser;
- normalization of incoming data before persistence: trimming/defaults/currency normalization and the existing non-strict source-object normalization. Persisted document fixtures are not raw HTTP input equivalence tests.

The JSON-byte size limit, string bounds, calendar syntax, lifecycle and explicit document-local commercial structures are **not** waived as service-only exceptions. The public service always applies canonical Zod and relationship validation before persistence. Mongo validation alone is not an authorization mechanism.

### Architecture, API and history verification

The reuse/new decisions remain unchanged: Capability is a reusable function; a versioned Agent Definition may provide it. Client Agents are distinct from existing capability instances. Swarm Templates are job/configuration definitions, not commercial packages. Swarm Agreements preserve configured-client terms without fabricating Product subscriptions or payment-provider records. Existing workspace integrations remain the connection store, with no second credential store.

Global resources remain Empress-governed. Workspace resources require independent Partner-derived Queen authority; client admins/viewers and unrelated humans do not gain operating access. Combined Empress/Queen roles use independent valid grants. Service defence and transactional relationships remain intact.

The HTTP workflow test exercises draft creation, publication, immutable published content, Client Agent/Swarm configuration, readiness, effective-policy recommendation, agreement approval and reading an unchanged recommendation after definition retirement. It also verifies Vapp/unauthorized/client-only denial and preserves existing `/hvm/context` access on schema 8 while new operating endpoints return unavailable. New definitions/templates/policies never silently update prior client snapshots.

Readiness tests verify compatible provider alternatives, multiple bindings, foreign-workspace rejection, disconnected/incompatible providers, missing agents and dependency cycles. Integration metadata stores explicit funding treatment independently from connection credentials.

Commercial tests verify percentage/fixed/custom decisions, policy escalation, preserved positive recommendation versus final price, internal/waived zero billed amounts, promotional treatment, monthly terms, annual commitment billed monthly and annual commitment billed annually. £1,000 monthly / £10,800 annual recommendation fixtures retain the original recommendation. No Built Matters/HVM name or ID branch exists. No AI pricing or payment dependency is introduced.

Methodology availability references the code-owned catalogue; Value Equation v1 content is not duplicated. New objects retire rather than gaining hard-delete endpoints. Existing organisation deletion is blocked by the client workspace. External-reference linkage remains an explicit future seam; no speculative provider records/allowlists were added.

See [the architecture document](../empress-operating-layer.md) for the complete routes, schemas, lifecycle, compatibility strategy, relationship diagram, index purpose and non-goals.

### Final validation results

| Validation | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| Complete central authorization suites | 21 | 0 | 0 |
| Operating HTTP/commercial/readiness suite | 11 | 0 | 0 |
| Combined focused authorization/operating run | 32 | 0 | 0 |
| Commercial + workspace integrations + DB setup suites | 62 | 0 | 0 |
| All-nine canonical + read-only Mongo parity | 571 | 0 | 0 |
| Full API suite | 1157 | 0 | 8 |

The live parity run comprises **285 canonical checks + 285 Mongo leaf checks + one parent test**. Counts are overlapping suite results, not additive independent totals. The ordinary API run skips eight opt-in live parity groups; the v9 group was run separately with no skips. The unchanged legacy opt-in groups were not rerun live during this repair.

Exact size boundaries of 199,999, 200,000 and 200,001 bytes pass in both validators. The over-200-KB Agent Definition is rejected by both. Additional boundary fixtures cover escaped/control/multibyte strings, numeric exponent/precision formatting, nonfinite versions and oversized nested recommendation/agreement snapshots.

Workspace typecheck, API lint, API build, API format check and `git diff --check`: **PASS**. No unrelated tests were changed in this validator repair. Earlier intermediate syntax/type/depth failures were resolved before the final checks.

### Secure dev preflight — no apply

The existing `vamberic-admin` / eu-west-2 / `vamberic/dev/api` loader supplied the Mongo URI only to the child process. The command executed was:

```sh
pnpm --filter @workspace/api-server db:setup --dry-run
```

It was executed through the secure loader documented in `docs/hvm-partners.md`, not as a bare shell command. Target: dev `vamberic_studio`.

- Existing schema: **8**.
- Target schema: **9**.
- Compatibility: **upgrade-pending** (expected before apply).
- New collections: **9**.
- Validators to apply: **9**, all on new collections.
- New indexes: **29**.
- Validator conflicts: **0**.
- Incompatible indexes: **0**.
- Unique-index risks: **0**.
- Unique-index diagnostics: **0**.
- Existing-data compatibility: no conflicts reported by the planner.
- Product count: **2**, with no writes performed by this task.

The migration shape remains **9/9/29**, unchanged by the validator repair. Current domain collections remain the 37 existing collections; the nine proposed collections are absent and no records were seeded. No existing validator/index replacement or data backfill is proposed. This dry-run and synthetic predicate verification do not claim that v9 is installed or substitute for post-apply verification.

Exact collections / validators:

- agent_definitions
- integration_providers
- swarm_templates
- commercial_policies
- methodology_availability
- client_agents
- client_swarms
- pricing_recommendations
- swarm_agreements

Exact indexes:

- `agent_definitions.id_unique`
- `agent_definitions.key_version_unique`
- `agent_definitions.available_catalogue`
- `integration_providers.id_unique`
- `integration_providers.key_version_unique`
- `integration_providers.available_catalogue`
- `swarm_templates.id_unique`
- `swarm_templates.key_version_unique`
- `swarm_templates.available_catalogue`
- `commercial_policies.id_unique`
- `commercial_policies.key_version_unique`
- `commercial_policies.available_catalogue`
- `commercial_policies.active_currency_unique`
- `methodology_availability.id_unique`
- `methodology_availability.key_version_unique`
- `methodology_availability.available_catalogue`
- `client_agents.id_unique`
- `client_agents.workspace_id`
- `client_agents.workspace_definition`
- `client_agents.workspace_integration`
- `client_swarms.id_unique`
- `client_swarms.workspace_id`
- `client_swarms.workspace_agent`
- `pricing_recommendations.id_unique`
- `pricing_recommendations.workspace_id`
- `pricing_recommendations.workspace_swarm`
- `swarm_agreements.id_unique`
- `swarm_agreements.workspace_id`
- `swarm_agreements.workspace_swarm_effectivity`

### Files changed in this validator repair

- Added `artifacts/api-server/src/db/operating-json-size.ts`.
- Updated `artifacts/api-server/src/db/operating-validators.ts`.
- Expanded `artifacts/api-server/test/operating-validator-parity.test.ts`.
- Added `artifacts/api-server/test/helpers/operating-fixtures.ts`.
- Added `artifacts/api-server/test/operating.test.ts`.
- Completed `docs/empress-operating-layer.md`.
- Updated this existing verification report, retaining the initial implementation/authorization/size-defect history.

No canonical domain schemas, authorization semantics, existing validators or applied migrations were changed by this focused repair. Other working-tree changes below predate it.

### Final result and environment

No known material blocker remains for the separately authorized additive migration. The intentional service-only boundaries above remain part of the architecture, not a promise of Mongo-only business validation. No schema apply, live data writes, seed/provisioning operation, persistent test record, temporary collection, deployment, staging, commit or push occurred. All database verification used read-only aggregation or dry-run inspection.

**The Empress operating-layer data foundation is ready for migration. After migration and final verification, the next workstream is the HVM operating-layer frontend.**

### Exact final Git status

Includes pre-existing uncommitted work; nothing was staged by this task.

```text
 M artifacts/api-server/.env.example
 M artifacts/api-server/src/authorization/policy.ts
 M artifacts/api-server/src/config.ts
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
 M artifacts/api-server/test/authorization.test.ts
 M artifacts/api-server/test/crm-foundation.test.ts
 M artifacts/api-server/test/domain.test.ts
 M artifacts/api-server/test/hive-definitions.test.ts
 M docs/hive-definitions.md
?? artifacts/api-server/src/db/hive-validators-v6.ts
?? artifacts/api-server/src/db/offer-validators.ts
?? artifacts/api-server/src/db/operating-json-size.ts
?? artifacts/api-server/src/db/operating-validators.ts
?? artifacts/api-server/src/domain/offer-methodologies.ts
?? artifacts/api-server/src/domain/offers.ts
?? artifacts/api-server/src/domain/operating-logic.ts
?? artifacts/api-server/src/domain/operating.ts
?? artifacts/api-server/src/routes/offers.ts
?? artifacts/api-server/src/routes/operating.ts
?? artifacts/api-server/src/services/offers.ts
?? artifacts/api-server/src/services/operating.ts
?? artifacts/api-server/test/helpers/offer-parity.ts
?? artifacts/api-server/test/helpers/operating-fixtures.ts
?? artifacts/api-server/test/hive-validator-parity.test.ts
?? artifacts/api-server/test/offer-methodologies.test.ts
?? artifacts/api-server/test/offers.test.ts
?? artifacts/api-server/test/operating-authorization.test.ts
?? artifacts/api-server/test/operating-validator-parity.test.ts
?? artifacts/api-server/test/operating.test.ts
?? docs/empress-operating-layer.md
?? docs/investigations/empress-operating-layer-verification.md
?? docs/investigations/hive-definitions-v6-post-migration-verification.md
?? docs/investigations/offer-foundation-v8-pre-migration-verification.md
?? docs/investigations/offering-icp-data-architecture-current-state.md
?? docs/offer-foundation.md
```


## Final post-v9 verification — installed dev schema

**PASS — FINAL POST-v9 VERIFICATION.** Verification only; no application, schema, validator, migration or test file was changed. No apply, seed, provisioning, commit, push or deployment ran.

### Live schema, migration history and data preservation

Target: **dev `vamberic_studio`**, accessed through the existing `vamberic-admin` Secrets Manager loader (`vamberic/dev/api`, eu-west-2). The URI stayed in child-process memory/environment; it was not printed or saved.

The actual ledger reports `version = 9`, `schemaVersion = 9`. Migrations 001–009 are present exactly once in sequence. The first eight history entries match the previous v8 baseline, including their original timestamps:

- `001-vapp-v1-baseline`: version 1, applied `2026-09-15T14:32:29.287Z`.
- `002-crm-foundation`: version 2, applied `2026-09-27T09:18:48.931Z`.
- `003-commercial-foundation`: version 3, applied `2026-09-27T11:57:07.499Z`.
- `004-brand-foundation`: version 4, applied `2026-09-27T16:43:30.585Z`.
- `005-hvm-phase1`: version 5, applied `2026-09-28T12:42:21.173Z`.
- `006-hive-definitions`: version 6, applied `2026-09-29T16:37:32.154Z`.
- `007-hive-validator-consistency`: version 7, applied `2026-09-29T17:06:01.813Z`.
- `008-offer-foundation`: version 8, applied `2026-09-30T09:46:17.713Z`.
- `009-empress-operating-foundation`: version 9, applied `2026-09-30T12:00:39.664Z`.

All nine expected new collections exist. The 37 existing v8 domain collections remain; the database has 46 domain collections plus `schema_versions`. No unexpected or missing collection was found.

Existing-data preservation was checked beyond counts. The prior v8 inventory fingerprint includes collection options, indexes and complete records (including their IDs/timestamps). The current inventory was projected onto the old collections, restoring only the expected schema-ledger transition fields in memory: version/schemaVersion 8, original v8 updatedAt, pre-v9 collection list and migrations 001–008. The reconstructed fingerprint exactly matches the saved v8 baseline. This reconstruction made **no database writes**.

- Previous v8 fingerprint: `f78bc5cdf8eb648ce43b479df597cbad6fb9868f3a00ee954072273a7ac249d5`.
- Reconstructed v8 fingerprint: `f78bc5cdf8eb648ce43b479df597cbad6fb9868f3a00ee954072273a7ac249d5`.
- Current full v9 fingerprint before verification: `95f97ab52144f615bc8f2fe82d67acbfea731ac5ef01230901daf6c66d7bb255`.
- Current full v9 fingerprint after verification: `95f97ab52144f615bc8f2fe82d67acbfea731ac5ef01230901daf6c66d7bb255`.

Thus the existing v8 records, options and indexes are unchanged apart from the intentional schema-ledger update, and all verification activity left live v9 state unchanged. No migration/test records or temporary collections were created. All new collections remain empty. All **35 collections with installed validators** were queried read-only for violating records; every result was zero. Collections without an installed validator were not represented as having passed a nonexistent validator.

### Installed validator verification and live parity

`listCollections` supplied the actual validator, validationLevel and validationAction for each new collection. All nine validators are deeply equal to the final source definitions, including nested expressions; all use strict/error enforcement. This comparison includes the JSON-byte cap, Unicode/whitespace/date repairs, numeric and commercial bounds, lifecycle, ownership, references, nested structures and actor contracts.

| Installed collection | Source match | Enforcement | Record count |
| --- | --- | --- | ---: |
| agent_definitions | Exact | strict/error | 0 |
| client_agents | Exact | strict/error | 0 |
| client_swarms | Exact | strict/error | 0 |
| commercial_policies | Exact | strict/error | 0 |
| integration_providers | Exact | strict/error | 0 |
| methodology_availability | Exact | strict/error | 0 |
| pricing_recommendations | Exact | strict/error | 0 |
| swarm_agreements | Exact | strict/error | 0 |
| swarm_templates | Exact | strict/error | 0 |

The unchanged existing parity test file was executed through a temporary verification bootstrap. The bootstrap fetched the live validators, asserted schema v9 and exact source/enforcement matches, then bound the test's **in-process validator registry** to those fetched objects before importing the existing suite. No test file, application file or live validator was edited. The suite's historical title still says “proposed”; its actual `$match` predicates came from the live-installed validator objects, and the bootstrap emitted `validatorSource: LIVE_INSTALLED` for all nine names.

The suite uses collectionless `$documents` → `$match` → `$project` aggregation. It does not insert, update, create collections or run `$out`/`$merge`.

**Installed parity: 571 passed, 0 failed, 0 skipped** (285 canonical checks, 285 installed-Mongo leaf checks and one parent test).

The exact Agent Definition boundaries are verified in both Zod and installed Mongo:

- 199,999 JSON bytes: accepted.
- 200,000 JSON bytes: accepted.
- 200,001 JSON bytes: rejected.

Escaped/control/multibyte strings, exponent/precision-sensitive numbers, nonfinite versions, Unicode whitespace and oversized nested commercial snapshots also passed their expected valid/invalid outcomes. Input-normalization and full WHATWG URL-parser responsibilities remain as documented in the pre-migration repair; installed validation matches the reviewed layered contract rather than claiming Mongo replaces all application rules.

### All 29 installed application indexes

Every index was compared by collection, name, ordered keys, uniqueness, sparse/hidden flags, partial filter, collation and TTL against the canonical definitions. All **29 match**. No extra application index exists on these collections. Mongo's automatic `_id_` indexes are additional and expected. Total application indexes across the database: **143 = 114 previous + 29 new**.

| Collection | Index | Ordered keys | Unique | Partial filter |
| --- | --- | --- | --- | --- |
| agent_definitions | id_unique | `{"id":1}` | yes | `null` |
| agent_definitions | key_version_unique | `{"key":1,"version":1}` | yes | `null` |
| agent_definitions | available_catalogue | `{"status":1,"availability":1,"id":1}` | no | `null` |
| client_agents | id_unique | `{"id":1}` | yes | `null` |
| client_agents | workspace_id | `{"workspaceId":1,"id":1}` | no | `null` |
| client_agents | workspace_definition | `{"workspaceId":1,"data.definition.id":1}` | no | `null` |
| client_agents | workspace_integration | `{"workspaceId":1,"data.bindings.integrationId":1}` | no | `null` |
| client_swarms | id_unique | `{"id":1}` | yes | `null` |
| client_swarms | workspace_id | `{"workspaceId":1,"id":1}` | no | `null` |
| client_swarms | workspace_agent | `{"workspaceId":1,"data.agentInstanceIds":1}` | no | `null` |
| commercial_policies | id_unique | `{"id":1}` | yes | `null` |
| commercial_policies | key_version_unique | `{"key":1,"version":1}` | yes | `null` |
| commercial_policies | available_catalogue | `{"status":1,"availability":1,"id":1}` | no | `null` |
| commercial_policies | active_currency_unique | `{"data.currency":1}` | yes | `{"status":"active"}` |
| integration_providers | id_unique | `{"id":1}` | yes | `null` |
| integration_providers | key_version_unique | `{"key":1,"version":1}` | yes | `null` |
| integration_providers | available_catalogue | `{"status":1,"availability":1,"id":1}` | no | `null` |
| methodology_availability | id_unique | `{"id":1}` | yes | `null` |
| methodology_availability | key_version_unique | `{"key":1,"version":1}` | yes | `null` |
| methodology_availability | available_catalogue | `{"status":1,"availability":1,"id":1}` | no | `null` |
| pricing_recommendations | id_unique | `{"id":1}` | yes | `null` |
| pricing_recommendations | workspace_id | `{"workspaceId":1,"id":1}` | no | `null` |
| pricing_recommendations | workspace_swarm | `{"workspaceId":1,"data.swarmId":1,"id":1}` | no | `null` |
| swarm_agreements | id_unique | `{"id":1}` | yes | `null` |
| swarm_agreements | workspace_id | `{"workspaceId":1,"id":1}` | no | `null` |
| swarm_agreements | workspace_swarm_effectivity | `{"workspaceId":1,"data.swarmId":1,"status":1,"data.decision.effectiveFrom":1}` | no | `null` |
| swarm_templates | id_unique | `{"id":1}` | yes | `null` |
| swarm_templates | key_version_unique | `{"key":1,"version":1}` | yes | `null` |
| swarm_templates | available_catalogue | `{"status":1,"availability":1,"id":1}` | no | `null` |

All 29 are non-sparse. Global business uniqueness is confined to definition key/version and the intended active policy/currency rule. No display-name uniqueness was added. Workspace query indexes include workspaceId; global canonical ID uniqueness is intentional and does not create cross-workspace display-name/business-key uniqueness.

### Central authorization and service defence

The complete unchanged authorization suites passed: **21 passed, 0 failed, 0 skipped**. They were run with the operating suite (32 passing tests total) and within the full API suite.

Central policy checks trusted issued context, known resource/action, malformed scope and `RESOURCE_SCOPES` **before** human/workload grant evaluation.

- Global: `agent_definitions`, `integration_providers`, `swarm_templates`, `commercial_policies`, `methodology_availability`. Workspace scope is invalid.
- Workspace: `client_agents`, `client_swarms`, `pricing_recommendations`, `swarm_agreements`. A specific valid workspace and independent authority are required.

Queen cannot manufacture global authority by adding workspaceId. Empress cannot manufacture workspace access by omitting it and is not a universal workspace superuser. A combined-role human uses independently granted platform and assigned-workspace authority. Client-only membership grants neither Empress nor Queen operating authority. Nonhuman grants cannot repair invalid scope.

Trusted Cognito identity/application mapping and server-configured Empress subjects determine identity; request JSON cannot assign actor/application/authority. Strict request bodies and service-generated metadata prevent caller-controlled persisted actors/scope. Service `access`, scoped relationship queries, exact definition/version checks and fresh Partner/workspace context resolution remain intact. No policy or service checks were weakened during this verification.

### Domain/architecture verification (request sections 7–27)

These confirmations combine actual installed schema inspection, unchanged automated tests and static review. Empty production collections mean historical workflows are demonstrated with synthetic in-memory fixtures, not seeded client records.

| Foundation | Verified behavior and limits |
| --- | --- |
| Agent Definition | Global stable ID/key/version, lifecycle/availability, description/category, provided/required capabilities, agent dependencies, declarative Hive access, bounded configuration/slots/cost drivers. It is not an instance, execution, Swarm, Product or subscription. No dedicated prompt/secret/API-key value fields or executable payload exist; the empty live collection contains none. |
| Agent versus Capability | Capability remains the reusable function. Definitions reference existing capability IDs; Client Agents may reference existing capability instances. Neither existing capability collection was renamed or repurposed. |
| Integration Provider | Global versioned capability/auth/account/cost metadata. `api_key_reference` is an authentication metadata enum, not a credential value. Retirement preserves existing referenced versions and snapshots. No credentials are stored in the empty global registry. |
| Workspace integration reuse | The existing connection is the client's account. Agent slots declare requirements; Client Agent bindings select exact provider versions and connection IDs. Same-workspace queries and compatibility checks reject foreign connections. No duplicate credential store. |
| Multiple providers | Slots declare required/optional capability, minimum provider count and supported alternatives. Bindings are arrays and permit compatible simultaneous connections. No failover/execution is implemented. |
| Client Agent | Workspace-owned configured instance with exact definition/version, typed bounded configuration, integration bindings, dependency/capability-instance references, revision/status and server actors. It is not a run. Published definition data cannot silently mutate it. |
| Swarm Template | Global versioned job/outcome and starting configuration with required/recommended/optional agent references, guidance and integration requirements. Agent dependencies remain in Agent Definitions/instances. A template is not a sellable SKU or Client Swarm. |
| Client Swarm | Workspace-owned job/configuration, optional exact template lineage, selected Client Agents, explicit revision and lifecycle. Optional lineage plus explicit configuration allows template-based, customized and template-free Swarms. No template-update propagation rewrites clients. |
| Readiness | Checks required agents/dependencies/capabilities/configuration, provider compatibility, slot binding, workspace ownership and connected state. Retired/unavailable definitions are rejected for new configuration. Readiness is separate from agreement approval, payment and execution health. |
| Commercial Policy | Global version/effectivity/currency, target/minimum margin, onboarding/annual-discount guidance, Queen discount/custom-price limits, minimums, usage/overage/service-effort assumptions and treatments. Recommendations pin policy identity/version and snapshot. |
| Cost drivers | Bounded descriptive keys, units, quantities and optional unit cost can represent model usage, research/contact/email/campaign/channel/provider/service effort. No fixed retail price per Agent or executable formula/spreadsheet language is required. |
| Integration costs | Explicit `client_funded`, `hvm_funded`, `pass_through`, `included_allowance` with quantity/cost/allowance/overage assumptions. Credentials do not determine treatment. No metering/billing execution. |
| Pricing Recommendation | Immutable persisted configuration/policy snapshot and explicit economic inputs/outputs: operating cost, onboarding/monthly/annual recommendations, margin, assumptions, rationale and uncertainty. Monthly recommendation provides the monthly-equivalent baseline; agreement terms derive final monthly equivalent. Rationale is explicit explanation, not hidden chain-of-thought. No AI pricing or dynamic recomputation. |
| Queen decision | Accept, percentage/fixed discount or authorized custom price, treatment, reason, actor/time and final amounts retain the recommendation separately. Policy exceptions require explicit Empress approval through a valid workspace path. |
| Internal/waived clients | Installed parity accepts positive recommendation and positive operating cost with internal/waived treatment and zero final charges. Service tests derive zero recurring charges and require zero onboarding; policy approval rules still apply. No Built Matters/HVM ID/name special case or payment-provider requirement. |
| Monthly/annual | Monthly/monthly, annual/annual and annual/monthly combinations are supported. Commitment length and billing frequency are separate. The annual recommendation/policy guidance remains distinct from the Queen adjustment/final agreed price. |
| Swarm Agreement | Durable workspace/Swarm/configuration identity, retained recommendation/decision, treatment/currency/onboarding/recurring terms, dates, assumptions, lifecycle and actors. This is canonical commercial truth. Bounded external-reference IDs provide a future seam; no Stripe subscription is canonical or required. |
| Payment independence | Configured/readiness and proposed/approved agreement states are separate. Payment-required/satisfied and runtime-active workflows are not implemented and are not inferred from approval. Internal/waived approval can occur without payment under applicable authority. |
| Methodology | Global availability/lifecycle and exact code-owned methodology ID/version plus compatible Agents. The referenced catalogue carries key/content. Value Equation v1 stages/formula/content remain code-owned and are not copied into a second collection. |
| History | Published definition/template/policy data are immutable; explicit new versions preserve old references. Client configuration revisions and immutable recommendation/agreement snapshots preserve commercial history. Queen prices do not overwrite original recommendations. |

Search of the new operating domain/service/router files found **no** Lead Gen Agent, Lead Generation Agent, LeadGenAgent, lead_gen_agent or CRM Agent concept. Contact Management remains the intended future specialist capability; Lead Generation is a Swarm/job. Existing CRM collection names predate this layer and remain unchanged. `api_key_reference` was the only credential-related term found in that contract search and is metadata, not a stored key.

### Live counts and absence of test data

| Collection | Count |
| --- | ---: |
| products | 2 |
| organisations | 1 |
| crm_workspaces | 1 |
| brands | 1 |
| offerings | 0 |
| ideal_customer_profiles | 0 |
| buyer_profiles | 0 |
| hive_definition_revisions | 0 |
| offer_designs | 0 |
| offers | 0 |
| offer_revisions | 0 |
| agent_definitions | 0 |
| client_agents | 0 |
| client_swarms | 0 |
| commercial_policies | 0 |
| integration_providers | 0 |
| methodology_availability | 0 |
| pricing_recommendations | 0 |
| swarm_agreements | 0 |
| swarm_templates | 0 |

No new registry, client configuration, commercial, payment or provisioning data exists. Other pre-existing Partner/membership/assignment/audit records remain unchanged by the fingerprint comparison. No violating document was found under any installed validator, and no test collection remains.

### Runtime compatibility and final commands

Static inspection confirms active guards:

- Existing HVM context/provisioning: schemas 5, 6, 7, 8, **9**.
- Hive definitions: schemas 6, 7, 8, **9**.
- Offers: schemas 8 and **9**.
- New operating services: exactly **9**.

No active exact-v8 runtime guard rejects v9. Older supported versions retain their deliberate existing behavior; unsupported versions remain rejected. Tests exercise schema-9 operating workflows, existing context behavior, and fail-closed boundaries. This is code/local-runtime verification, not a deployment or a claim that a newly built image is already serving production traffic.

| Check | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| Complete authorization suites | 21 | 0 | 0 |
| Operating workflow/commercial/readiness suite | 11 | 0 | 0 |
| Combined focused run | 32 | 0 | 0 |
| Actual-installed nine-validator parity | 571 | 0 | 0 |
| Full API suite | 1157 | 0 | 8 |

The eight API skips are opt-in live parity groups; installed v9 parity was run separately with zero skips. These overlapping counts are not additive independent totals.

A final secure `db:setup --dry-run` reports:

- Existing schema **9**, expected schema **9**.
- Compatibility **compatible**.
- Collections to create: **0**.
- Validators to apply: **0**.
- Indexes to create: **0**.
- Validator conflicts, incompatible indexes, unique-index risks and diagnostics: **0**.

No pending migration work remains. `git diff --check` passed. No code/tests were changed to obtain these results; no build/typecheck was needed for this verification-only documentation update.

### Final boundary and file integrity

A start-of-task hash manifest of repository files confirmed that no existing file changed during database inspection and automated verification. Only this report and the architecture document's current-status paragraph were then updated to record the post-v9 result. Application code, configuration, schemas, validators, migrations and tests remain byte-for-byte unchanged from task start.

The temporary verification drivers contain no credentials and perform only read-only Mongo operations. The bootstrap substitutes installed predicates only inside its test process; it does not modify source files or install validators.

**No database writes, persistent test/customer records, seeds, provisioning, frontend/agent behavior, commit, push or deployment occurred.** Nothing was staged. Existing unrelated working-tree changes were retained.

### Git status at post-v9 completion

```text
 M artifacts/api-server/.env.example
 M artifacts/api-server/src/authorization/policy.ts
 M artifacts/api-server/src/config.ts
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
 M artifacts/api-server/test/authorization.test.ts
 M artifacts/api-server/test/crm-foundation.test.ts
 M artifacts/api-server/test/domain.test.ts
 M artifacts/api-server/test/hive-definitions.test.ts
 M docs/hive-definitions.md
?? artifacts/api-server/src/db/hive-validators-v6.ts
?? artifacts/api-server/src/db/offer-validators.ts
?? artifacts/api-server/src/db/operating-json-size.ts
?? artifacts/api-server/src/db/operating-validators.ts
?? artifacts/api-server/src/domain/offer-methodologies.ts
?? artifacts/api-server/src/domain/offers.ts
?? artifacts/api-server/src/domain/operating-logic.ts
?? artifacts/api-server/src/domain/operating.ts
?? artifacts/api-server/src/routes/offers.ts
?? artifacts/api-server/src/routes/operating.ts
?? artifacts/api-server/src/services/offers.ts
?? artifacts/api-server/src/services/operating.ts
?? artifacts/api-server/test/helpers/offer-parity.ts
?? artifacts/api-server/test/helpers/operating-fixtures.ts
?? artifacts/api-server/test/hive-validator-parity.test.ts
?? artifacts/api-server/test/offer-methodologies.test.ts
?? artifacts/api-server/test/offers.test.ts
?? artifacts/api-server/test/operating-authorization.test.ts
?? artifacts/api-server/test/operating-validator-parity.test.ts
?? artifacts/api-server/test/operating.test.ts
?? docs/empress-operating-layer.md
?? docs/investigations/empress-operating-layer-verification.md
?? docs/investigations/hive-definitions-v6-post-migration-verification.md
?? docs/investigations/offer-foundation-v8-pre-migration-verification.md
?? docs/investigations/offering-icp-data-architecture-current-state.md
?? docs/offer-foundation.md
```


## Additive HVM context discovery verification — 30 September 2026

**PASS — HVM CONTEXT READY FOR EMPRESS FRONTEND**

The HVM context is ready for the Empress/Queen frontend foundation.
No database migration is required.

`GET /api/v1/hvm/context` adds only `platform: { empress: boolean }`.
The result uses the existing central global `manage agent_definitions` policy
check on the freshly resolved authenticated context. No additional authority
source, grants, allowlist, identity inference or authorization changes were
introduced. Existing Partner membership/roles/assignment IDs, direct client
membership/roles and effective workspace roles remain independently present.
Empress-only users have a true flag and empty workspace/membership arrays;
no-authority users have false and empty arrays. No universal workspace access
is granted. Existing HVMapp's non-strict context parser tolerates the addition.

Action discovery was deliberately deferred: existing authority basis plus the
flag supports initial perspectives, while specific actions still require
record lifecycle and relationship checks. See the authority discovery section
in [the operating-layer document](../empress-operating-layer.md) for contract,
refresh, compatibility and frontend UX-only constraints. Trusted environment
configuration changes take effect through the normal process reload; no new
cache or environment hot-reload mechanism was added.

Eight HTTP regression tests were added in `test/hvm-phase1.test.ts`: no
authority, Empress-only, Queen owner-only, client admin-only, Empress+Queen,
all three authorities, Partner member/onboarder, and spoofing/revocation.
Exact response assertions preserve every existing field; global and workspace
endpoints independently check the same users. Revocation is tested by replacing
the fixture's trusted process configuration and making a fresh request.

| Validation | Pass | Fail | Skip |
| --- | ---: | ---: | ---: |
| HVM Phase 1/context tests | 25 | 0 | 0 |
| Central authorization suites | 21 | 0 | 0 |
| Operating service/HTTP suite | 11 | 0 | 0 |
| Combined focused run | 57 | 0 | 0 |
| Full API suite | 1165 | 0 | 8 |

The full suite has 1173 total tests. The eight skips are existing opt-in live
Mongo parity tests; no live parity or migration is needed for this change.
Node 24.21.0 and pnpm 10.26.1 were used. Workspace typecheck, API lint, API
build, API format check and `git diff --check` all passed (exit 0).

This task changed only:

- `artifacts/api-server/src/services/hvm-context.ts`
- `artifacts/api-server/test/hvm-phase1.test.ts`
- `docs/empress-operating-layer.md`
- `docs/investigations/empress-operating-layer-verification.md`

Pre-existing working-tree changes were preserved. No Mongo connection, database
write, persisted-schema/validator/index/migration change, frontend work,
staging, commit, push or deployment occurred. Test fixtures use memory only.

Exact final Git status (`git status --short --untracked-files=all`):

```text
 M artifacts/api-server/.env.example
 M artifacts/api-server/src/authorization/policy.ts
 M artifacts/api-server/src/config.ts
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
 M artifacts/api-server/test/authorization.test.ts
 M artifacts/api-server/test/crm-foundation.test.ts
 M artifacts/api-server/test/domain.test.ts
 M artifacts/api-server/test/hive-definitions.test.ts
 M artifacts/api-server/test/hvm-phase1.test.ts
 M docs/hive-definitions.md
?? artifacts/api-server/src/db/hive-validators-v6.ts
?? artifacts/api-server/src/db/offer-validators.ts
?? artifacts/api-server/src/db/operating-json-size.ts
?? artifacts/api-server/src/db/operating-validators.ts
?? artifacts/api-server/src/domain/offer-methodologies.ts
?? artifacts/api-server/src/domain/offers.ts
?? artifacts/api-server/src/domain/operating-logic.ts
?? artifacts/api-server/src/domain/operating.ts
?? artifacts/api-server/src/routes/offers.ts
?? artifacts/api-server/src/routes/operating.ts
?? artifacts/api-server/src/services/offers.ts
?? artifacts/api-server/src/services/operating.ts
?? artifacts/api-server/test/helpers/offer-parity.ts
?? artifacts/api-server/test/helpers/operating-fixtures.ts
?? artifacts/api-server/test/hive-validator-parity.test.ts
?? artifacts/api-server/test/offer-methodologies.test.ts
?? artifacts/api-server/test/offers.test.ts
?? artifacts/api-server/test/operating-authorization.test.ts
?? artifacts/api-server/test/operating-validator-parity.test.ts
?? artifacts/api-server/test/operating.test.ts
?? docs/empress-operating-layer.md
?? docs/investigations/empress-operating-layer-verification.md
?? docs/investigations/hive-definitions-v6-post-migration-verification.md
?? docs/investigations/offer-foundation-v8-pre-migration-verification.md
?? docs/investigations/offering-icp-data-architecture-current-state.md
?? docs/offer-foundation.md
```


## Independent Empress Agreement approval correction — 30 September 2026

**PASS — EMPRESS AGREEMENT APPROVAL BACKEND READY**

The backend now supports independent Empress Agreement review and approval
without granting Empress general workspace authority.
HVMapp Workstream 3C may resume.

### Root cause and implementation

The old operating mutation service authorized `swarm_agreements` in workspace
scope before checking Empress, so both Queen and Empress were required. There
was no independent global discovery/detail surface. The fix registers
`agreement_approvals` as a global, human-only Empress resource with `read` and
`approve` actions only. It rejects workspace scope before grants and preserves
ordinary `swarm_agreements` workspace classification. No universal workspace
access or caller-supplied identity is introduced.

Routes added:

- `GET /api/v1/hvm/empress/agreement-approvals`
- `GET /api/v1/hvm/empress/agreement-approvals/:agreementId`
- `POST /api/v1/hvm/empress/agreement-approvals/:agreementId/approve`

See [the exact frontend handoff](../empress-operating-layer.md#frontend-contract-handoff)
for complete DTOs, query bounds, success/error contracts and legacy alias
behavior. List and detail expose selected commercial snapshot values, decision,
escalation reasons, policy limits, workspace ID and frozen Swarm identity only.
No full Agent/configuration/integration snapshot or unrelated business data is
returned. Safe workspace/Organisation display names are omitted rather than
requiring extra cross-workspace reads.

Pending eligibility requires nonarchived proposed state and
`requires_empress_approval`. The service revalidates canonical schemas, Swarm
snapshot identity, commercial outputs and escalation against the frozen
recommendation/policy, not current catalogue prices. Mutation rereads in the
existing transaction, checks expectedUpdatedAt, preserves workspace serialization
and overlap checks, requires a trimmed 1–2000 character reason, and records
server-derived actor/time. The exceptional audit uses the supported event
payload for actor attribution; the event schema drops unknown top-level actor
fields. This task does not rewrite historical events or other operation paths.

An Empress without any Partner membership, assignment or direct membership can
list/read/approve. Queen-only, Partner member/onboarder, client admin/member and
unaffiliated humans cannot. A combined Empress/Queen can use each independent
authority. Queen workspace access remains scoped, and ordinary within-policy
approval still works. Internal and waived cases with positive cost/recommendation
and zero billed amount pass. Standard cases are excluded from exceptional review.
There is no payment or execution dependency, and no client-name/identity special
case. No decline operation existed and none was invented; pending proposals can
be retired/replaced under the existing Queen lifecycle.

### Validation

Node 24.21.0 / pnpm 10.26.1. In-memory transactional fixtures and local HTTP
servers only; no live Mongo connection or persistent test records.

| Suite | Pass | Fail | Skip |
| --- | ---: | ---: | ---: |
| New approval HTTP/service tests | 16 | 0 | 0 |
| Central authorization tests | 22 | 0 | 0 |
| Operating-layer tests | 11 | 0 | 0 |
| Commercial tests | 18 | 0 | 0 |
| Combined focused run | 67 | 0 | 0 |
| Full API suite (1190 total) | 1182 | 0 | 8 |

The eight skips are existing opt-in live Mongo validator-parity tests. Workspace
typecheck, API lint, API build, API formatting and `git diff --check` all pass
(exit 0). Focused tests cover full authenticated Empress-only list → detail →
approval, denied actors, global scope, unchanged workspace boundaries, strict
inputs, bounded projections, pagination, history exclusion, stale timestamp,
concurrent approval, commercial inconsistency, overlapping periods, immutable
snapshots, persisted reason/actor/time and explicit Empress event attribution.

### Database and scope

No persisted schema, domain document contract, validator or index changed. No
v10 migration. **No Mongo schema migration is required.** Existing `id_unique`
supports detail and ordered traversal; list filtering is early-scale work bounded
by result limits, maximum offset and a three-second database timeout. It is not
a claim of constant-cost global pending selection. The architecture document
records the future index-review trigger and exact candidate keys; no index is
created speculatively. Workspace overlap checks retain their existing index.

No changes were made to hvm-app. No live writes, persistent test records,
staging, commits, pushes or deployment. Pre-existing uncommitted work remains.
Task-baseline file hashes confirmed no db/domain schema file changed.

Exact files changed/added in this task:

- `artifacts/api-server/src/authorization/policy.ts`
- `artifacts/api-server/src/routes/operating.ts`
- `artifacts/api-server/src/services/operating.ts`
- `artifacts/api-server/src/services/agreement-approval-contract.ts` (new)
- `artifacts/api-server/test/operating-authorization.test.ts`
- `artifacts/api-server/test/agreement-approvals.test.ts` (new)
- `docs/empress-operating-layer.md`
- `docs/investigations/empress-operating-layer-verification.md`

All final verification gates pass; no outstanding blocker for frontend 3C.
Frontend implementation and deployment remain separate work. Queue scale/index
monitoring is a documented operational limitation, not a current schema change.

Exact final Git status (`git status --short --untracked-files=all`):

```text
 M artifacts/api-server/.env.example
 M artifacts/api-server/src/authorization/policy.ts
 M artifacts/api-server/src/config.ts
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
 M artifacts/api-server/test/authorization.test.ts
 M artifacts/api-server/test/crm-foundation.test.ts
 M artifacts/api-server/test/domain.test.ts
 M artifacts/api-server/test/hive-definitions.test.ts
 M artifacts/api-server/test/hvm-phase1.test.ts
 M docs/hive-definitions.md
?? artifacts/api-server/src/db/hive-validators-v6.ts
?? artifacts/api-server/src/db/offer-validators.ts
?? artifacts/api-server/src/db/operating-json-size.ts
?? artifacts/api-server/src/db/operating-validators.ts
?? artifacts/api-server/src/domain/offer-methodologies.ts
?? artifacts/api-server/src/domain/offers.ts
?? artifacts/api-server/src/domain/operating-logic.ts
?? artifacts/api-server/src/domain/operating.ts
?? artifacts/api-server/src/routes/offers.ts
?? artifacts/api-server/src/routes/operating.ts
?? artifacts/api-server/src/services/agreement-approval-contract.ts
?? artifacts/api-server/src/services/offers.ts
?? artifacts/api-server/src/services/operating.ts
?? artifacts/api-server/test/agreement-approvals.test.ts
?? artifacts/api-server/test/helpers/offer-parity.ts
?? artifacts/api-server/test/helpers/operating-fixtures.ts
?? artifacts/api-server/test/hive-validator-parity.test.ts
?? artifacts/api-server/test/offer-methodologies.test.ts
?? artifacts/api-server/test/offers.test.ts
?? artifacts/api-server/test/operating-authorization.test.ts
?? artifacts/api-server/test/operating-validator-parity.test.ts
?? artifacts/api-server/test/operating.test.ts
?? docs/empress-operating-layer.md
?? docs/investigations/empress-operating-layer-verification.md
?? docs/investigations/hive-definitions-v6-post-migration-verification.md
?? docs/investigations/offer-foundation-v8-pre-migration-verification.md
?? docs/investigations/offering-icp-data-architecture-current-state.md
?? docs/offer-foundation.md
```
