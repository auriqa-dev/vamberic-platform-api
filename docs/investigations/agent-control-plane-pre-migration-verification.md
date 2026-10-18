# Agent control-plane implementation and pre-migration verification

1 October 2026. **PASS — PLATFORM CONTROL PLANE READY TO MIGRATE.**

See [final completion](#final-completion--1-october-2026) for the current result.
Earlier FAIL/incomplete sections are retained as verification history.

Current resumption findings are appended below. Earlier test/version counts are
historical and are not the current verification result.

The Agent Operator design is approved. No further decision on client roles is
pending. Configure = Queen; operate = Queen or explicit client grant; apply =
independent target edit plus Result visibility; approve = existing canonical
approval. The approval requires active grants for client historical reads and
does not grant proposal rejection to client operators.

## Current implementation checkpoint

Implemented locally:

- Membership grant contracts (40 grants, 20 operation keys per grant, 64-KiB
  grant-array bound), revision pins, expiry, server-attributed grant/revoke,
  optimistic concurrency and transactional audit rollback.
- Central Queen assignment policy and own-Run client authorization, with no
  admin-derived execution or Swarm-to-direct-Agent escalation.
- Workspace-scoped grant management and self-discovery HTTP endpoints, gated on
  future schema v10 and an explicit trusted operation catalogue. The default
  catalogue is unavailable; it does not advertise fake production capabilities.
- Unchanged Runtime protocol 1.0 source/build/schema/fixture handoff, exact Zod
  dependency and a 63-file provenance/drift check. No production sibling import.
- Strict application Run/Attempt/Result/Usage schemas and a transactional lifecycle
  core: claims, leases/fences, outcome receipts, scoped frozen snapshots, input,
  cancellation, dispatch publisher leases, reconciliation and usage acceptance.
- Trusted workload principal seam, exact decimal arithmetic and bounded attempt
  reservations. No production workload authentication/transport is installed.
- Optional Agent Definition implementation metadata and retained v9 predecessor
  schemas. Implementation metadata writes require v10. Existing functionality
  remains available on its previously supported schema versions.

**This is not the completed Workstream 4A.2 deliverable.** The lifecycle core is
not mounted as a production Run/workload API. The complete readiness/grant
construction, human Run API, proposal handler/application/rejection/evidence
boundary, canonical approval freshness seam, guarded deletion dependencies,
four-collection migration/index registration, complete Mongo validators and
validator parity verification remain unfinished. Additional adversarial/lifecycle
coverage is required. No claim of complete protocol/security verification is made.

Canonical `db:setup` remains on **v9** with the v9 operating validators. Proposed
operator and implementation-metadata validators are separate candidates, not an
applyable migration. No collection/index/validator totals for a completed v10
migration are claimed. Do not interpret a v9-compatible dry-run as verification
of the control plane.

## Validation evidence

- Full API run: **1,224 tests; 1,216 passed; 0 failed; 8 skipped**. The skips are
  existing opt-in live parity tests; they are not evidence of Mongo parity.
- New focused coverage: 6 operator-policy/contract, 5 operator-service, 14 actual
  Runtime golden/digest, 2 workload/budget and 7 lifecycle tests (34 total).
- Protocol artifact check: **63 files match the Runtime handoff**.
- Workspace typecheck, API typecheck/lint/build/format check and `git diff --check`
  passed after the final local changes.
- **No secure dev dry-run, live Mongo parity check or AWS SSO check was run.**
  The migration implementation must be completed before the requested live
  verification can establish readiness.
- No Mongo writes, migration apply, deployment, staging, commit or push occurred.

The earlier investigation below is retained as historical evidence. Its
approval-pending and documentation-only statements describe that earlier
checkpoint, not the current approved decision or code state.

## Historical pre-approval investigation — superseded by approval

Only documentation changed in this follow-up. The initial stop/investigation
record below is retained as history, not the active product choice.

### Recommendation

Reuse active `workspace_memberships` for issuer/subject and workspace identity;
add an optional bounded `agentOperationGrants` array assigning exact Client Agent
or Client Swarm revisions and explicit operation keys. No new workspace role,
automatic admin execution, purchase-derived user rights or separate ACL collection.
Absent grants confer no client operation authority. Both admin and ordinary member
can be selected. The architecture document specifies the proposed strict shape,
40-grant/20-operation bounds, expiry, 64-KiB grant-array bound and server-issued
embedded grant identity.

Role-only access is too broad; commercial entitlement alone does not select a
human; putting human rosters on Agent/Swarm configuration would couple permissions
to configuration snapshots. Combining existing membership with exact assignments
is the minimum bounded model recommended here.

Queen (active assigned Partner owner/member) manages access through a dedicated
`agent_operator_assignments:manage` check. Existing client-admin membership
management does not grant that check. Audit actor/time and grant IDs are server-
derived; mutations use expectedUpdatedAt and transactions. Ended membership,
revoked/replaced/expired grant, target revision mismatch/retirement or disabled
execution policy denies future work; original Run snapshots/history are retained.
Grants are workspace-owned and do not automatically disappear when the original
granting human leaves, but current Queen can revoke them.

Client operators control their own allowed Runs; another client's Runs are not
shared implicitly. Active membership can retain own historical Run/result reads
after operation revocation. Queen remains workspace-scoped. These are explicit
proposed visibility rules requiring approval with the design, not pre-existing
Run permissions. Empress alone gains none.

### Independent authority checks

1. Configuration remains existing Queen/Partner authority.
2. Operation requires scoped Queen authority or exact client grant, intersected
   with readiness, current source-read permission, provider policy and budgets.
3. Application requires separately authorized Result access and actual canonical
   target draft/edit permission. Operator status alone cannot apply a proposal.
4. Canonical approval remains current Hive/Offer authority plus the planned
   provenance/freshness checks. No operator-derived approval.

A Swarm grant names a Swarm revision/job, not general child-Agent access. 4A.2
adds no orchestration; direct Agent Runs still require direct Agent authority.
Future server-owned orchestration derives bounded child work from the exact job,
pinned Swarm membership and requester/policy/budget intersection. Unknown or
unimplemented job operations remain unavailable. Lead Generation is a Swarm.

### Proposed API and schema delta

Under `/api/v1/hvm/workspaces/:workspaceId`, propose:

- `POST /member-agent-operation-grant`
- `POST /member-agent-operation-revoke`
- `GET /members/:membershipId/agent-operation-grants` (Queen management)
- `GET /agent-operation-context` (own bounded safe target/operation discovery)

The architecture document contains request/response outlines, concurrency rules,
bounds and safe error behavior. Existing HVM context and membership roles remain
unchanged. New discovery must not expose configuration/bindings or another user's
grants. Existing member-provision/revoke paths must be tested against escalation
and accidental grant removal/resurrection.

Migration design now includes the four proposed execution collections, the
already-planned Agent Definition implementation-reference/snapshot review, and
an additive validator extension for existing `workspace_memberships`. No fifth
collection, new commercial entitlement, role backfill or additional operator
index is proposed. Existing membership identity/workspace indexes support the
bounded lookups. Add `agentoperatorgrant` as an embedded canonical ID prefix.
Exact total migration counts/version are not yet finalized; no migration exists
from this follow-up and no database operation was performed.

### Required tests and approval gate

Required coverage is detailed in the architecture document: selected/unselected
client admins and members; Queen/Empress separation; wrong scope, target,
revision and operation; self-grant escalation; revoke/expiry/rejoin; own/other Run
control; target-edit and approval independence; future Swarm child restrictions;
readiness/source/budget intersections; transaction races, audit, rollback and
Zod/Mongo parity for bounds/lifecycle/duplicates.

These are future tests, not reported passes. Only document/link/whitespace checks
were run for this documentation-only follow-up. Earlier protocol/auth test counts
below belong to the initial investigation. No implementation, full API suite,
build or migration validation is claimed for this proposal.

**Await approval of the bounded membership-grant model, own-Run client control and
revision-pinned target semantics before resuming 4A.2.** This approval gate comes
from section 8 of the user's revised brief: “Do not implement the authorization
model yet. Return the recommended design for approval before resuming 4A.2.”

No code, configuration, dependency, Mongo schema/validator/index, migration,
Runtime or HVMapp change. No database connection/write, AWS action, staging,
commit, push or deploy.

## Initial investigation history (superseded policy question)

### Original stop condition

The brief says: “If current Partner member/admin semantics conflict with the
architecture recommendation, document and STOP before making a new product
decision.”

Actual central-policy probes show direct client admins can update Offering drafts
but cannot read/update Client Agents or read Client Swarms. Partner-basis admins
can do both. Consequently, “admin with relevant draft/edit authority” is not an
existing uniform Agent permission. The new Run permission would need an explicit
choice: Partner/Queen-only initially, or separate execution authority for direct
client admins while configuration remains Partner/Queen-only. No spend or
workspace authority has been broadened pending that answer.

This is not evidence of a defective Runtime protocol or an inability to implement
four-collection persistence. It is a policy ambiguity under the brief's stop rule.
The two concrete choices have been presented to the user.

## Baseline and checks actually completed

- Platform source schema: **9**, latest migration
  `009-empress-operating-foundation`.
- Live schema: prior verification records v9; **not queried in this task**.
- Runtime public package: private/unpublished 0.1.0, protocol exactly 1.0.
- Read actual exported contracts, generated Dispatch JSON Schema, golden manifest,
  and golden-fixture/protocol tests alongside the Runtime architecture/foundation
  documents. Generated schemas alone omit semantic validation.
- Runtime `test/protocol.test.ts`: **47 passed, 0 failed, 0 skipped**. This includes
  actual golden fixture parsing and replay/digest/version tests. It is not a
  Platform cross-repository integration test.
- Existing Platform authorization suites: **22 passed, 0 failed, 0 skipped**.
- Direct synthetic central-policy probe confirmed client/Partner admin difference.
- `git diff --check`: passed.

No Agent Run implementation, dispatch/claim, heartbeat/context, outcome/input/
cancel, proposal/evidence, readiness, workload authorization, migration/parity
or Platform-generated protocol contract tests exist from this task yet. Full API,
build, typecheck, lint and format gates were not rerun for documentation-only
changes. No completion or parity claim is made.

## Proposed mapping, not a migration

The four requested collections remain the proposed model: `agent_runs`,
`agent_attempts`, `agent_results`, `agent_usage_observations`. Embedded active
input/checkpoint/grant/dispatch state remains appropriate. Candidate canonical
prefixes are recorded in the architecture mapping. No collection/index/validator
was added and no target version or exact migration counts have been selected.

Protocol consumption can use a reproducible versioned protocol-only artifact
with provenance and original fixtures until private immutable publication before
4A.3. This strategy is proposed, not implemented. Production sibling-source
imports are not proposed. Existing old-schema compatibility and nested snapshot
validators must be handled during implementation, not assumed safe.

No existing-data compatibility, conflict or uniqueness preflight has run. The
secure dev dry-run remains outstanding because the brief permits it only after
local code/parity validation passes. AWS SSO/Secrets Manager were not invoked.
There is no apply-ready migration or safe migration recommendation at this point.

## Changes and safety

Only these documentation files were created:

- `docs/agent-control-plane.md`
- `docs/investigations/agent-control-plane-pre-migration-verification.md`

Pre-existing working-tree changes were preserved. No application/configuration,
validator, index, dependency, migration or persisted domain code changed. No
staging, commit, push, deploy, live database write, persistent test record, AWS
infrastructure change, Runtime source change or HVMapp change occurred. Tests
used synthetic in-memory data only. No SQS, M2M, worker, real provider/tool, billing
or product Agent functionality was added.

Once the authority choice is resolved, implementation and all requested
verification gates still need to be completed before migration or 4A.3.

## Exact Git status at the initial checkpoint

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
?? docs/agent-control-plane.md
?? docs/empress-operating-layer.md
?? docs/investigations/agent-control-plane-pre-migration-verification.md
?? docs/investigations/empress-operating-layer-verification.md
?? docs/investigations/hive-definitions-v6-post-migration-verification.md
?? docs/investigations/offer-foundation-v8-pre-migration-verification.md
?? docs/investigations/offering-icp-data-architecture-current-state.md
?? docs/offer-foundation.md
```

## Exact Git status after revised-design documentation

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
?? docs/agent-control-plane.md
?? docs/empress-operating-layer.md
?? docs/investigations/agent-control-plane-pre-migration-verification.md
?? docs/investigations/empress-operating-layer-verification.md
?? docs/investigations/hive-definitions-v6-post-migration-verification.md
?? docs/investigations/offer-foundation-v8-pre-migration-verification.md
?? docs/investigations/offering-icp-data-architecture-current-state.md
?? docs/offer-foundation.md
```

Nothing staged (`git diff --cached --stat` is empty). Only the two requested
documents were edited in this follow-up; the remaining dirty paths predate it.

## Working tree at this checkpoint

The tree includes pre-existing uncommitted foundation work. Nothing was staged.

```text
 M artifacts/api-server/.env.example
 M artifacts/api-server/package.json
 M artifacts/api-server/src/authorization/policy.ts
 M artifacts/api-server/src/config.ts
 M artifacts/api-server/src/db/collections.ts
 M artifacts/api-server/src/db/hive-validators.ts
 M artifacts/api-server/src/db/setup.ts
 M artifacts/api-server/src/domain/hive-definitions.ts
 M artifacts/api-server/src/domain/ids.ts
 M artifacts/api-server/src/domain/index.ts
 M artifacts/api-server/src/domain/workspace-memberships.ts
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
 M pnpm-lock.yaml
?? artifacts/api-server/src/authorization/agent-workload.ts
?? artifacts/api-server/src/db/agent-operator-validators.ts
?? artifacts/api-server/src/db/hive-validators-v6.ts
?? artifacts/api-server/src/db/offer-validators.ts
?? artifacts/api-server/src/db/operating-json-size.ts
?? artifacts/api-server/src/db/operating-validators.ts
?? artifacts/api-server/src/domain/agent-budget.ts
?? artifacts/api-server/src/domain/agent-control-plane.ts
?? artifacts/api-server/src/domain/agent-operator.ts
?? artifacts/api-server/src/domain/agent-outcome-scope.ts
?? artifacts/api-server/src/domain/offer-methodologies.ts
?? artifacts/api-server/src/domain/offers.ts
?? artifacts/api-server/src/domain/operating-logic.ts
?? artifacts/api-server/src/domain/operating.ts
?? artifacts/api-server/src/routes/agent-operators.ts
?? artifacts/api-server/src/routes/offers.ts
?? artifacts/api-server/src/routes/operating.ts
?? artifacts/api-server/src/services/agent-control-plane.ts
?? artifacts/api-server/src/services/agent-operators.ts
?? artifacts/api-server/src/services/agreement-approval-contract.ts
?? artifacts/api-server/src/services/offers.ts
?? artifacts/api-server/src/services/operating.ts
?? artifacts/api-server/test/agent-control-plane.test.ts
?? artifacts/api-server/test/agent-operator-service.test.ts
?? artifacts/api-server/test/agent-operator.test.ts
?? artifacts/api-server/test/agent-runtime-protocol.test.ts
?? artifacts/api-server/test/agent-workload-budget.test.ts
?? artifacts/api-server/test/agreement-approvals.test.ts
?? artifacts/api-server/test/helpers/agent-operator-fixture.ts
?? artifacts/api-server/test/helpers/offer-parity.ts
?? artifacts/api-server/test/helpers/operating-fixtures.ts
?? artifacts/api-server/test/hive-validator-parity.test.ts
?? artifacts/api-server/test/offer-methodologies.test.ts
?? artifacts/api-server/test/offers.test.ts
?? artifacts/api-server/test/operating-authorization.test.ts
?? artifacts/api-server/test/operating-validator-parity.test.ts
?? artifacts/api-server/test/operating.test.ts
?? docs/agent-control-plane.md
?? docs/empress-operating-layer.md
?? docs/investigations/
?? docs/offer-foundation.md
?? lib/agent-runtime-protocol/
?? scripts/check-runtime-protocol.mjs
```


## Resumption report — 1 October 2026

**FAIL — DO NOT MIGRATE. Stopped under section 53: newly reproduced authorization race.**

### Protocol reconciliation and Knowledge Gaps

The previous copy accepted exact Protocol 1.0 / Result 1. The current copy accepts
exact Protocol 1.1 / Result 2 and rejects the historical profile; there is no lossy
adapter or missing-gap default. All 81 vendored protocol source/build/fixture/JSON
schema artifacts match the current Runtime sibling by SHA-256. The dependency
remains isolated Zod 4.6.5; Platform domain contracts continue using Zod 3.

`content.knowledgeGaps` is preserved inside accepted immutable Result envelopes.
The human Result service exposes it losslessly, alongside newly exposed
completeness. The common upstream validator protects the 40-gap/8,192-byte bounds,
strict resolution union, support IDs, duplicate rejection and complete/blocking
invariant. Unknowns are separate; successful partial knowledge still completes
execution. Actual `needs_input` controls pause/resume, not gap intent. No text is
interpreted as an instruction, grant, provider choice or executable selector. No
resolution lifecycle or automatic research/orchestration was added. HTTP Result
wiring and Mongo parity are not yet complete.

### New security finding and evidence

A claim transaction can read an active client grant from its snapshot, while a
concurrent Queen revocation commits to membership/workspace documents. Claim then
writes only `agent_runs`, `agent_attempts` and a separate `events` document.
These disjoint writes do not force reauthorization after the revocation.
The result is a newly issued lease after the grant has been removed.

The new local snapshot-interleaving regression executes the actual services,
models document-level write-conflict detection, and asserts that stale lease
issuance must be prevented. It fails with:

```text
Revoked client received a new lease; claim writes: events, agent_runs, agent_attempts
true !== false
```

This is a deterministic local model plus source inspection, not an observation
against live Mongo. The existing test database globally serializes transactions;
it could not exercise this interleaving. Mongo's documented stale transaction
reads support the identified failure mechanism; see the source link in
`docs/agent-control-plane.md`.

The serialization contract for overlapping revocation and claim must be explicit.
Recommended repair is a shared transaction serialization boundary before using
authority, covering both authority mutations and execution transitions; conflicts
must retry with freshly resolved authority. Review workspace-token churn and all
revocation sources, not only the grant array. Snapshot read concern alone is not
a substitute. No authorization repair was made after reaching the stop condition.

### Completion matrix at stop

| Requested area | Current result |
| --- | --- |
| Agent Operator | Existing bounded membership grants, Queen grant/revoke, exact revision/expiry/own-Run checks retained; concurrent revocation safety fails |
| Authority separation | Configure = Queen; operate = Queen/explicit grant; apply requires independent canonical edit; approve remains canonical human approval |
| Run / Attempt | Existing lifecycle core, frozen pins, attempts, leases/fences, input/cancellation/retry/yield retained; not migration-ready |
| Dispatch | Existing persisted intent, generation and fake sink/publisher/reconciliation seams retained; no queue/background deployment |
| Workload | Existing issued-principal service seam retained; HTTP contracts/wiring incomplete; no production M2M adapter |
| Input / resume | Existing input schema/server attribution and resume tests pass; full remaining scope not claimed complete |
| Readiness | Exact implementation metadata profile updated to 1.1; full provider/readiness/policy wiring incomplete |
| Proposals / evidence | Full controlled application/rejection and canonical evidence/freshness linkage incomplete |
| Approval freshness | Additive seam still pending; no canonical lifecycle redesign attempted |
| Usage | Existing exact arithmetic, observation dedup/corrections/late-report seams retained; no billing or provider calls |
| Persistence | Four proposed collections remain unregistered; membership validator candidate retained; no Knowledge Gap/operator collection added |
| Schema compatibility | Canonical repository migration remains v9; next migration not registered; existing compatibility work preserved |
| Mongo parity | Not run: local security regression fails, four validators unfinished |
| Secure dry-run / existing data | Not run: prerequisite local validation is not green; live schema/counts/conflicts not asserted |
| Migration readiness | FAIL; do not apply |

### Validation at stop

| Gate | Result |
| --- | --- |
| Protocol fixture/semantic tests | 29 passed, 0 failed, 0 skipped |
| Lifecycle tests including gap persistence | 13 passed, 1 failed (new security regression), 0 skipped |
| Full API suite | 1,246 total: 1,237 passed, 1 failed, 8 skipped, 0 cancelled |
| Workspace typecheck | PASS |
| API lint | PASS |
| API build | PASS |
| API format check | PASS |
| Protocol drift check against Runtime | PASS — 81 files |
| `git diff --check` | PASS |

The eight skips are existing opt-in live validator-parity tests, not successful
live verification. No test was weakened or skipped to hide the new race.
The failing regression is intentionally retained as the repair acceptance test.

### Files touched by this resumption

- `artifacts/api-server/src/domain/operating.ts`: implementation protocol literal 1.1.
- `artifacts/api-server/src/services/agent-control-plane.ts`: dispatch 1.1 and Result completeness exposure.
- `artifacts/api-server/test/agent-runtime-protocol.test.ts`: refreshed fixtures and Knowledge Gap semantic cases.
- `artifacts/api-server/test/agent-control-plane.test.ts`: dispatch profile, lossless gap acceptance, failing revocation regression.
- `artifacts/api-server/test/helpers/agent-snapshot-db.ts`: new local interleaving/write-conflict model.
- `scripts/check-runtime-protocol.mjs`: current v1.1 fixture source path.
- `lib/agent-runtime-protocol/README.md` and `provenance.json`: current handoff profile and hashes.
- `lib/agent-runtime-protocol/{contracts,source,fixtures,json-schema}`: upstream artifact refresh; the exact imported file inventory follows (some files remain byte-identical).
- `docs/agent-control-plane.md` and this verification report: appended current findings, preserving previous checkpoints.

Imported artifact inventory:

```text
lib/agent-runtime-protocol/contracts/content.d.ts
lib/agent-runtime-protocol/contracts/content.js
lib/agent-runtime-protocol/contracts/content.js.map
lib/agent-runtime-protocol/contracts/errors.d.ts
lib/agent-runtime-protocol/contracts/errors.js
lib/agent-runtime-protocol/contracts/errors.js.map
lib/agent-runtime-protocol/contracts/index.d.ts
lib/agent-runtime-protocol/contracts/index.js
lib/agent-runtime-protocol/contracts/index.js.map
lib/agent-runtime-protocol/contracts/input.d.ts
lib/agent-runtime-protocol/contracts/input.js
lib/agent-runtime-protocol/contracts/input.js.map
lib/agent-runtime-protocol/contracts/json.d.ts
lib/agent-runtime-protocol/contracts/json.js
lib/agent-runtime-protocol/contracts/json.js.map
lib/agent-runtime-protocol/contracts/knowledge-gap.d.ts
lib/agent-runtime-protocol/contracts/knowledge-gap.js
lib/agent-runtime-protocol/contracts/knowledge-gap.js.map
lib/agent-runtime-protocol/contracts/outcome.d.ts
lib/agent-runtime-protocol/contracts/outcome.js
lib/agent-runtime-protocol/contracts/outcome.js.map
lib/agent-runtime-protocol/contracts/primitives.d.ts
lib/agent-runtime-protocol/contracts/primitives.js
lib/agent-runtime-protocol/contracts/primitives.js.map
lib/agent-runtime-protocol/contracts/usage.d.ts
lib/agent-runtime-protocol/contracts/usage.js
lib/agent-runtime-protocol/contracts/usage.js.map
lib/agent-runtime-protocol/contracts/work.d.ts
lib/agent-runtime-protocol/contracts/work.js
lib/agent-runtime-protocol/contracts/work.js.map
lib/agent-runtime-protocol/source/content.ts
lib/agent-runtime-protocol/source/errors.ts
lib/agent-runtime-protocol/source/index.ts
lib/agent-runtime-protocol/source/input.ts
lib/agent-runtime-protocol/source/json.ts
lib/agent-runtime-protocol/source/knowledge-gap.ts
lib/agent-runtime-protocol/source/outcome.ts
lib/agent-runtime-protocol/source/primitives.ts
lib/agent-runtime-protocol/source/usage.ts
lib/agent-runtime-protocol/source/work.ts
lib/agent-runtime-protocol/fixtures/cancelled.json
lib/agent-runtime-protocol/fixtures/claimedWork.json
lib/agent-runtime-protocol/fixtures/dispatch.json
lib/agent-runtime-protocol/fixtures/evidence.json
lib/agent-runtime-protocol/fixtures/failure.json
lib/agent-runtime-protocol/fixtures/finding.json
lib/agent-runtime-protocol/fixtures/gapBlocking.json
lib/agent-runtime-protocol/fixtures/gapCapability.json
lib/agent-runtime-protocol/fixtures/gapHuman.json
lib/agent-runtime-protocol/fixtures/gapNonBlocking.json
lib/agent-runtime-protocol/fixtures/gapResearch.json
lib/agent-runtime-protocol/fixtures/gapResearchResolved.json
lib/agent-runtime-protocol/fixtures/gapUnresolved.json
lib/agent-runtime-protocol/fixtures/invalidCompleteBlocking.json
lib/agent-runtime-protocol/fixtures/invalidEvidenceReference.json
lib/agent-runtime-protocol/fixtures/invalidFindingReference.json
lib/agent-runtime-protocol/fixtures/invalidLineageReference.json
lib/agent-runtime-protocol/fixtures/invalidMalformedCapability.json
lib/agent-runtime-protocol/fixtures/invalidMissingCapability.json
lib/agent-runtime-protocol/fixtures/manifest.json
lib/agent-runtime-protocol/fixtures/needsInput.json
lib/agent-runtime-protocol/fixtures/proposal.json
lib/agent-runtime-protocol/fixtures/success.json
lib/agent-runtime-protocol/fixtures/unsupportedMajor.json
lib/agent-runtime-protocol/fixtures/usage.json
lib/agent-runtime-protocol/fixtures/yield.json
lib/agent-runtime-protocol/json-schema/Checkpoint.json
lib/agent-runtime-protocol/json-schema/ClaimedWork.json
lib/agent-runtime-protocol/json-schema/Dispatch.json
lib/agent-runtime-protocol/json-schema/EvidenceObservation.json
lib/agent-runtime-protocol/json-schema/Finding.json
lib/agent-runtime-protocol/json-schema/Grant.json
lib/agent-runtime-protocol/json-schema/ImplementationManifest.json
lib/agent-runtime-protocol/json-schema/InputRequest.json
lib/agent-runtime-protocol/json-schema/InputResponse.json
lib/agent-runtime-protocol/json-schema/KnowledgeGap.json
lib/agent-runtime-protocol/json-schema/Outcome.json
lib/agent-runtime-protocol/json-schema/Proposal.json
lib/agent-runtime-protocol/json-schema/SafeError.json
lib/agent-runtime-protocol/json-schema/SourceLineage.json
lib/agent-runtime-protocol/json-schema/UsageObservation.json
```

### Environment and non-goals

No Mongo connection, live write, persistent fixture, migration apply, AWS command,
infrastructure change, deployment, staging, commit or push occurred. No Runtime
or HVMapp sibling was edited. No SQS, DLQ, Cognito M2M, Fargate worker, live provider,
external tool, Agent execution/orchestration or domain Agent was introduced.
4A.3 is not ready to begin: first resolve the authorization race, finish remaining
4A.2, pass full validation, then secure dry-run/parity before migration approval.

### Final Git status at this stop

The working tree includes substantial preserved earlier work. This is the full
`git status --short`, not a claim that every entry was created during resumption.
The index is empty (`git diff --cached --stat` has no output).

```text
 M artifacts/api-server/.env.example
 M artifacts/api-server/package.json
 M artifacts/api-server/src/authorization/policy.ts
 M artifacts/api-server/src/config.ts
 M artifacts/api-server/src/db/collections.ts
 M artifacts/api-server/src/db/hive-validators.ts
 M artifacts/api-server/src/db/setup.ts
 M artifacts/api-server/src/domain/hive-definitions.ts
 M artifacts/api-server/src/domain/ids.ts
 M artifacts/api-server/src/domain/index.ts
 M artifacts/api-server/src/domain/workspace-memberships.ts
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
 M pnpm-lock.yaml
?? artifacts/api-server/src/authorization/agent-workload.ts
?? artifacts/api-server/src/db/agent-operator-validators.ts
?? artifacts/api-server/src/db/hive-validators-v6.ts
?? artifacts/api-server/src/db/offer-validators.ts
?? artifacts/api-server/src/db/operating-json-size.ts
?? artifacts/api-server/src/db/operating-validators.ts
?? artifacts/api-server/src/domain/agent-budget.ts
?? artifacts/api-server/src/domain/agent-control-plane.ts
?? artifacts/api-server/src/domain/agent-operator.ts
?? artifacts/api-server/src/domain/agent-outcome-scope.ts
?? artifacts/api-server/src/domain/offer-methodologies.ts
?? artifacts/api-server/src/domain/offers.ts
?? artifacts/api-server/src/domain/operating-logic.ts
?? artifacts/api-server/src/domain/operating.ts
?? artifacts/api-server/src/routes/agent-operators.ts
?? artifacts/api-server/src/routes/offers.ts
?? artifacts/api-server/src/routes/operating.ts
?? artifacts/api-server/src/services/agent-control-plane.ts
?? artifacts/api-server/src/services/agent-operators.ts
?? artifacts/api-server/src/services/agreement-approval-contract.ts
?? artifacts/api-server/src/services/offers.ts
?? artifacts/api-server/src/services/operating.ts
?? artifacts/api-server/test/agent-control-plane.test.ts
?? artifacts/api-server/test/agent-operator-service.test.ts
?? artifacts/api-server/test/agent-operator.test.ts
?? artifacts/api-server/test/agent-runtime-protocol.test.ts
?? artifacts/api-server/test/agent-workload-budget.test.ts
?? artifacts/api-server/test/agreement-approvals.test.ts
?? artifacts/api-server/test/helpers/agent-operator-fixture.ts
?? artifacts/api-server/test/helpers/agent-snapshot-db.ts
?? artifacts/api-server/test/helpers/offer-parity.ts
?? artifacts/api-server/test/helpers/operating-fixtures.ts
?? artifacts/api-server/test/hive-validator-parity.test.ts
?? artifacts/api-server/test/offer-methodologies.test.ts
?? artifacts/api-server/test/offers.test.ts
?? artifacts/api-server/test/operating-authorization.test.ts
?? artifacts/api-server/test/operating-validator-parity.test.ts
?? artifacts/api-server/test/operating.test.ts
?? docs/agent-control-plane.md
?? docs/empress-operating-layer.md
?? docs/investigations/
?? docs/offer-foundation.md
?? lib/agent-runtime-protocol/
?? scripts/check-runtime-protocol.mjs
```


## Final completion — 1 October 2026

### 1. Final result

**PASS — PLATFORM CONTROL PLANE READY TO MIGRATE.** Migration is not applied.
This section supersedes earlier checkpoints while retaining their evidence.

### 2. Security defect

Claim read an active grant from a Mongo snapshot but wrote Run/Attempt/Event
records disjoint from revocation. Both could commit, establishing a new lease
after revocation. Another read in the same snapshot cannot fix this. Equivalent
establishment boundaries include Run creation, resume and retry/yield, and the
same dependency issue applies to Queen chains and lifecycle/readiness inputs.

### 3. Serialization repair

Real transactional CAS increments on the exact positive authority dependencies
force shared-document write conflicts with concurrent changes/deletions. Existing
operating `referenceVersion` is reused; seven other anchors gain optional bounded
`executionSerial`, absent=0. No new serialization collection, global counter,
process-local lock, delay, authority expansion, timestamp churn or audit noise.
Counter exhaustion fails closed. Exact published predecessor validators remain
available for migration recognition; there is no historical validator rewrite.

### 4. Commit order

Deterministic local snapshot barriers retain the original failing regression:
revocation-first causes stale establishment to conflict, and fresh authorization
denies it. Claim-first legitimately creates an Attempt; subsequent revocation
blocks heartbeat/context/continued authority and permits Queen cancellation.
These are local transaction-model tests, not a live Mongo race experiment.

### 5. Authority dependencies

- Client: exact membership, grant, operation, target revision and authoritative
  expiry; no role-derived grant.
- Queen: selected sufficient active Partner membership, Partner and workspace
  assignment chain, plus workspace lifecycle.
- Client Agent: current revision/lifecycle/configuration, locked operating row.
- Client Swarm: supported revision-pinned authority anchor; direct execution and
  orchestration are intentionally not implemented.
- Required integration/provider/capability-instance and Agent Definition rows:
  validated and included as persisted readiness dependencies.
- Execution policy: trusted fail-closed registration declares reviewed persisted
  dependencies. No browser policy input or silently permissive default.
- Implementation capacity/readiness: trusted ephemeral provider, separately
  rechecked; not misrepresented as a persisted Mongo health lock.

### 6–10. Establishment and continued execution

Run creation, claim, input resume and retry/yield use the same authority
serialization boundary. Both create/revoke orders are tested. Resume cannot
queue a fresh generation after revocation wins. Retry/yield cannot continue
revoked work. Attempts retain their provenance; generations/fences reject stale
workers, heartbeat/context reauthorize, and Queen/system cancellation remains
possible. Tests also cover Queen assignment/membership/Partner changes, Agent
revision/workspace lifecycle, definition/integration/capability dependencies and
time-based grant expiry without a revocation write.

### 11. Agent Operator

Configure=Queen; operate=Queen or explicit active operation grant; apply=separate
target permission plus Result access; approve=canonical approval. Grants remain
revision pinned, expiring and revocable. Client reads remain own-Run and require
current grant; client admin is not automatic execution authority. No Swarm grant
silently permits a direct Agent Run.

### 12–13. Protocol and Knowledge Gaps

Protocol 1.1 / Result schema 2 verified against all 81 upstream artifacts. Accepted
immutable Result content and human APIs preserve Knowledge Gaps losslessly.
Completeness/blocking-gap invariants remain enforced; partial success is not an
input pause. No gap routing, research or child execution is triggered.

### 14. Execution readiness

Explicit server capability/preparation/policy registrations validate manifest,
implementation, frozen config and context grants, exact definition/revision,
dependencies, integrations and capacity. Real production execution remains
fail-closed until those trusted 4A.3 deployment components are configured.

### 15–16. API surfaces

Human create/list/detail/readiness, Results, input, cancellation and proposal
review are wired, alongside existing grant/revoke routes. Workload claim,
heartbeat, context, outcome, receipt and usage use independently issued trusted
principals; default workload auth returns unavailable before parsing. Human JWTs,
body claims and forged principal objects cannot grant workload authority. Missing
receipt is JSON null. HTTP tests cover all six workload actions and human scope.

### 17. Proposals, evidence and freshness

Apply/reject are transactional and idempotent with disposition CAS/audit. Default
reviewed canonical Hive handlers support Offerings/ICP/Buyer Profiles; unknown
kinds fail closed pending reviewed adapters. Apply checks independent canonical
permission, target/parent/source freshness, and stores selected observed evidence
with origin/provider and human/Run/Result lineage. No auto-approval. Canonical Hive
approval rechecks consumed sources for that revision; a new canonical revision
is the explicit review boundary. Human input evidence must match stored answers.

### 18. Database

Live 9 → proposed 10, migration `010-agent-control-plane`. Four new collections:
`agent_runs`, `agent_attempts`, `agent_results`, `agent_usage_observations`.
Four new validators; ten amended validators:

- agent_definitions
- pricing_recommendations
- swarm_agreements
- crm_workspaces
- capability_instances
- hvm_partners
- workspace_partner_assignments
- hvm_partner_memberships
- workspace_integrations
- workspace_memberships

Fourteen new indexes, zero replacements; exact names/keys/purposes are in
[the architecture index table](../agent-control-plane.md#unapplied-migration-010-agent-control-plane).
Existing schema 9 functionality remains available to the new build; new execution
requires 10. No backfill. Old strict readers must be drained before new execution
writes are enabled. No startup DDL or seeded grants/execution records.

### 19. Validator parity and correction history

Final secure read-only proposed-validator suite: **777 passed, 0 failed, 0
skipped**. This includes 99 core Agent fixture comparisons, 75 authority fixture
comparisons and 300 operating fixture comparisons against actual Mongo validator
semantics (plus local cases and test wrappers). Synthetic `$documents` pipelines
were used; no temporary collections or persisted fixture records.

The first combined run had 747 passed/2 failed; the second had 748 passed/1 failed.
Investigation found the candidate membership grant revision minimum had been
overwritten by a generic safe-number bound, and an optional Result actor field
was being treated as required by a trim predicate. Candidate-only fixes intersect
numeric bounds and guard optional fields; published predecessor contracts were
not changed. A local Unicode fixture also corrected Runtime code-point versus
Platform UTF-16 text-bound handling. Final expanded cases include checkpoints,
input, terminal lifecycle, unsafe numbers and JSON byte boundaries. All pass.

Intentional service-only rules: SHA-256 recomputation, exact URL normalization,
pre-BSON JavaScript object properties, cross-collection authority/relationships,
history immutability, aggregate budgets and transition concurrency. These are
explicit layers, not unexplained document-contract drift.

### 20. Tests

| Run | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| Initial security repair full API gate | 1255 | 0 | 8 |
| Final focused Agent tests (security, operators, authorization, protocol, lifecycle, workload, proposals, validators) | 258 | 0 | 2 |
| Final full API (includes setup/migration and existing HVM/Hive/Offering/ICP/Buyer/Offer regressions) | 1459 | 0 | 10 |
| Secure proposed-validator parity | 777 | 0 | 0 |

The ordinary API skips are opt-in Mongo parity suites: two Agent, six Hive,
one Offer and one operating. The three proposed Agent/authority/operating suites
were run securely and passed separately. Unchanged historical Hive/Offer parity
was not rerun against live Mongo in this task. The original failing security test
remains and passes; no unrelated tests were weakened. Canonical collection/index
count assertions were updated from 46/143 to the actual additive 50/157.

### 21. Quality

Workspace typecheck, API lint, API build, API formatting, Protocol 1.1 artifact
drift (81 files) and git diff --check all pass. Build produced normal bundle-size
output, with no build failure. No unrelated formatting sweep.

### 22. Secure dry-run and data

AWS SSO identity check succeeded using `vamberic-admin`. Existing
`vamberic/dev/api` secret in eu-west-2 supplied the URI only to child processes;
no URI/credentials were printed or written to disk. Secure `db:setup --dry-run`
was repeated after candidate-validator repairs.

Target dev `vamberic_studio`: current9/target10, upgrade-pending, four collections
absent and proposed, fourteen indexes to create, fourteen validators to apply
(four new/ten updated), no incompatible indexes, no validator conflicts, no
unique-index risks and no existing-data incompatibilities. No replacements.
Products remain 2. Organisation, workspace, Partner, Partner membership,
assignment, workspace membership, Brand and Event each remain 1. All existing
operating and Hive/Offer collections are empty; integrations, capability
instances and Brand Kits are empty. Existing membership passes its amended
validator without automatic grants or a required serialization backfill.

### 23. Documentation

Updated `docs/agent-control-plane.md`, this verification history and
`docs/investigations/agent-authority-serialization.md`. The architecture includes
rollout, exact indexes, service-only invariants and the 4A.3 handoff. Earlier
failures and partial checkpoints remain visible.

### 24–25. Files and Git

The following complete working-tree status includes preserved pre-existing work
as well as this completion; it is not a claim that every listed file originated
in this turn. No files staged, committed or pushed. Untracked directories are
expanded below to provide the exact file inventory.

```text
 M artifacts/api-server/.env.example
 M artifacts/api-server/package.json
 M artifacts/api-server/src/app.ts
 M artifacts/api-server/src/authorization/policy.ts
 M artifacts/api-server/src/config.ts
 M artifacts/api-server/src/db/collections.ts
 M artifacts/api-server/src/db/hive-validators.ts
 M artifacts/api-server/src/db/setup.ts
 M artifacts/api-server/src/domain/commercial-records.ts
 M artifacts/api-server/src/domain/crm-records.ts
 M artifacts/api-server/src/domain/hive-definitions.ts
 M artifacts/api-server/src/domain/ids.ts
 M artifacts/api-server/src/domain/index.ts
 M artifacts/api-server/src/domain/partners.ts
 M artifacts/api-server/src/domain/workspace-integrations.ts
 M artifacts/api-server/src/domain/workspace-memberships.ts
 M artifacts/api-server/src/routes/hive-definitions.ts
 M artifacts/api-server/src/routes/hvm.ts
 M artifacts/api-server/src/services/crm-foundation.ts
 M artifacts/api-server/src/services/hive-definitions.ts
 M artifacts/api-server/src/services/hvm-context.ts
 M artifacts/api-server/src/services/hvm-provision.ts
 M artifacts/api-server/test/authorization.test.ts
 M artifacts/api-server/test/crm-foundation.test.ts
 M artifacts/api-server/test/domain.test.ts
 M artifacts/api-server/test/helpers/enquiry-db.ts
 M artifacts/api-server/test/hive-definitions.test.ts
 M artifacts/api-server/test/hvm-phase1.test.ts
 M artifacts/api-server/tsconfig.json
 M docs/hive-definitions.md
 M pnpm-lock.yaml
?? artifacts/api-server/src/authorization/agent-workload.ts
?? artifacts/api-server/src/db/agent-control-plane-collections.ts
?? artifacts/api-server/src/db/agent-control-plane-validators.ts
?? artifacts/api-server/src/db/agent-json-integrity.ts
?? artifacts/api-server/src/db/agent-operator-validators.ts
?? artifacts/api-server/src/db/agent-protocol-validators.ts
?? artifacts/api-server/src/db/execution-serialization-validators.ts
?? artifacts/api-server/src/db/hive-validators-v6.ts
?? artifacts/api-server/src/db/offer-validators.ts
?? artifacts/api-server/src/db/operating-json-size.ts
?? artifacts/api-server/src/db/operating-validators.ts
?? artifacts/api-server/src/domain/agent-budget.ts
?? artifacts/api-server/src/domain/agent-context-projection.ts
?? artifacts/api-server/src/domain/agent-control-plane.ts
?? artifacts/api-server/src/domain/agent-operator.ts
?? artifacts/api-server/src/domain/agent-outcome-scope.ts
?? artifacts/api-server/src/domain/execution-serialization.ts
?? artifacts/api-server/src/domain/offer-methodologies.ts
?? artifacts/api-server/src/domain/offers.ts
?? artifacts/api-server/src/domain/operating-logic.ts
?? artifacts/api-server/src/domain/operating.ts
?? artifacts/api-server/src/routes/agent-control-plane.ts
?? artifacts/api-server/src/routes/agent-operators.ts
?? artifacts/api-server/src/routes/offers.ts
?? artifacts/api-server/src/routes/operating.ts
?? artifacts/api-server/src/services/agent-authority-serialization.ts
?? artifacts/api-server/src/services/agent-control-plane.ts
?? artifacts/api-server/src/services/agent-execution-readiness.ts
?? artifacts/api-server/src/services/agent-operators.ts
?? artifacts/api-server/src/services/agent-proposal-freshness.ts
?? artifacts/api-server/src/services/agent-proposals.ts
?? artifacts/api-server/src/services/agent-run-requests.ts
?? artifacts/api-server/src/services/agent-subsystem.ts
?? artifacts/api-server/src/services/agreement-approval-contract.ts
?? artifacts/api-server/src/services/offers.ts
?? artifacts/api-server/src/services/operating.ts
?? artifacts/api-server/test/agent-authority-parity.test.ts
?? artifacts/api-server/test/agent-authority-serialization.test.ts
?? artifacts/api-server/test/agent-control-plane.test.ts
?? artifacts/api-server/test/agent-operator-service.test.ts
?? artifacts/api-server/test/agent-operator.test.ts
?? artifacts/api-server/test/agent-runtime-protocol.test.ts
?? artifacts/api-server/test/agent-validator-parity.test.ts
?? artifacts/api-server/test/agent-workload-budget.test.ts
?? artifacts/api-server/test/agreement-approvals.test.ts
?? artifacts/api-server/test/helpers/agent-mongo-parity.ts
?? artifacts/api-server/test/helpers/agent-operator-fixture.ts
?? artifacts/api-server/test/helpers/agent-snapshot-db.ts
?? artifacts/api-server/test/helpers/offer-parity.ts
?? artifacts/api-server/test/helpers/operating-fixtures.ts
?? artifacts/api-server/test/hive-validator-parity.test.ts
?? artifacts/api-server/test/offer-methodologies.test.ts
?? artifacts/api-server/test/offers.test.ts
?? artifacts/api-server/test/operating-authorization.test.ts
?? artifacts/api-server/test/operating-validator-parity.test.ts
?? artifacts/api-server/test/operating.test.ts
?? docs/agent-control-plane.md
?? docs/empress-operating-layer.md
?? docs/investigations/agent-authority-serialization.md
?? docs/investigations/agent-control-plane-pre-migration-verification.md
?? docs/investigations/empress-operating-layer-verification.md
?? docs/investigations/hive-definitions-v6-post-migration-verification.md
?? docs/investigations/offer-foundation-v8-pre-migration-verification.md
?? docs/investigations/offering-icp-data-architecture-current-state.md
?? docs/offer-foundation.md
?? lib/agent-runtime-protocol/README.md
?? lib/agent-runtime-protocol/contracts/content.d.ts
?? lib/agent-runtime-protocol/contracts/content.js
?? lib/agent-runtime-protocol/contracts/content.js.map
?? lib/agent-runtime-protocol/contracts/errors.d.ts
?? lib/agent-runtime-protocol/contracts/errors.js
?? lib/agent-runtime-protocol/contracts/errors.js.map
?? lib/agent-runtime-protocol/contracts/index.d.ts
?? lib/agent-runtime-protocol/contracts/index.js
?? lib/agent-runtime-protocol/contracts/index.js.map
?? lib/agent-runtime-protocol/contracts/input.d.ts
?? lib/agent-runtime-protocol/contracts/input.js
?? lib/agent-runtime-protocol/contracts/input.js.map
?? lib/agent-runtime-protocol/contracts/json.d.ts
?? lib/agent-runtime-protocol/contracts/json.js
?? lib/agent-runtime-protocol/contracts/json.js.map
?? lib/agent-runtime-protocol/contracts/knowledge-gap.d.ts
?? lib/agent-runtime-protocol/contracts/knowledge-gap.js
?? lib/agent-runtime-protocol/contracts/knowledge-gap.js.map
?? lib/agent-runtime-protocol/contracts/outcome.d.ts
?? lib/agent-runtime-protocol/contracts/outcome.js
?? lib/agent-runtime-protocol/contracts/outcome.js.map
?? lib/agent-runtime-protocol/contracts/primitives.d.ts
?? lib/agent-runtime-protocol/contracts/primitives.js
?? lib/agent-runtime-protocol/contracts/primitives.js.map
?? lib/agent-runtime-protocol/contracts/usage.d.ts
?? lib/agent-runtime-protocol/contracts/usage.js
?? lib/agent-runtime-protocol/contracts/usage.js.map
?? lib/agent-runtime-protocol/contracts/work.d.ts
?? lib/agent-runtime-protocol/contracts/work.js
?? lib/agent-runtime-protocol/contracts/work.js.map
?? lib/agent-runtime-protocol/fixtures/cancelled.json
?? lib/agent-runtime-protocol/fixtures/claimedWork.json
?? lib/agent-runtime-protocol/fixtures/dispatch.json
?? lib/agent-runtime-protocol/fixtures/evidence.json
?? lib/agent-runtime-protocol/fixtures/failure.json
?? lib/agent-runtime-protocol/fixtures/finding.json
?? lib/agent-runtime-protocol/fixtures/gapBlocking.json
?? lib/agent-runtime-protocol/fixtures/gapCapability.json
?? lib/agent-runtime-protocol/fixtures/gapHuman.json
?? lib/agent-runtime-protocol/fixtures/gapNonBlocking.json
?? lib/agent-runtime-protocol/fixtures/gapResearch.json
?? lib/agent-runtime-protocol/fixtures/gapResearchResolved.json
?? lib/agent-runtime-protocol/fixtures/gapUnresolved.json
?? lib/agent-runtime-protocol/fixtures/invalidCompleteBlocking.json
?? lib/agent-runtime-protocol/fixtures/invalidEvidenceReference.json
?? lib/agent-runtime-protocol/fixtures/invalidFindingReference.json
?? lib/agent-runtime-protocol/fixtures/invalidLineageReference.json
?? lib/agent-runtime-protocol/fixtures/invalidMalformedCapability.json
?? lib/agent-runtime-protocol/fixtures/invalidMissingCapability.json
?? lib/agent-runtime-protocol/fixtures/manifest.json
?? lib/agent-runtime-protocol/fixtures/needsInput.json
?? lib/agent-runtime-protocol/fixtures/proposal.json
?? lib/agent-runtime-protocol/fixtures/success.json
?? lib/agent-runtime-protocol/fixtures/unsupportedMajor.json
?? lib/agent-runtime-protocol/fixtures/usage.json
?? lib/agent-runtime-protocol/fixtures/yield.json
?? lib/agent-runtime-protocol/json-schema/Checkpoint.json
?? lib/agent-runtime-protocol/json-schema/ClaimedWork.json
?? lib/agent-runtime-protocol/json-schema/Dispatch.json
?? lib/agent-runtime-protocol/json-schema/EvidenceObservation.json
?? lib/agent-runtime-protocol/json-schema/Finding.json
?? lib/agent-runtime-protocol/json-schema/Grant.json
?? lib/agent-runtime-protocol/json-schema/ImplementationManifest.json
?? lib/agent-runtime-protocol/json-schema/InputRequest.json
?? lib/agent-runtime-protocol/json-schema/InputResponse.json
?? lib/agent-runtime-protocol/json-schema/KnowledgeGap.json
?? lib/agent-runtime-protocol/json-schema/Outcome.json
?? lib/agent-runtime-protocol/json-schema/Proposal.json
?? lib/agent-runtime-protocol/json-schema/SafeError.json
?? lib/agent-runtime-protocol/json-schema/SourceLineage.json
?? lib/agent-runtime-protocol/json-schema/UsageObservation.json
?? lib/agent-runtime-protocol/package.json
?? lib/agent-runtime-protocol/provenance.json
?? lib/agent-runtime-protocol/source/content.ts
?? lib/agent-runtime-protocol/source/errors.ts
?? lib/agent-runtime-protocol/source/index.ts
?? lib/agent-runtime-protocol/source/input.ts
?? lib/agent-runtime-protocol/source/json.ts
?? lib/agent-runtime-protocol/source/knowledge-gap.ts
?? lib/agent-runtime-protocol/source/outcome.ts
?? lib/agent-runtime-protocol/source/primitives.ts
?? lib/agent-runtime-protocol/source/usage.ts
?? lib/agent-runtime-protocol/source/work.ts
?? scripts/check-runtime-protocol.mjs
```

### 26. Environment

Migration NOT applied. No live Mongo writes, persistent fixtures, AWS
infrastructure changes, deployment, staging, commit or push. Runtime sibling and
HVMapp unchanged by this task. Products were read only and not rewritten.

### 27. Non-goals and handoff

No SQS, Cognito M2M, Fargate worker, real model/external-tool calls, automatic
Knowledge Gap routing, Swarm orchestration, Product/Service Understanding,
Research Agent, Lead Gen Agent or CRM Agent. 4A.3 must preserve shared authority
serialization on all establishment paths, integrate trusted worker auth and
Runtime HTTPS, configure heartbeat/lease/reconciliation, handle duplicate delivery
and fencing, and add crash/retry and end-to-end revocation races.

The Platform Agent Run/control-plane foundation is ready for migration.
The authorization serialization defect is repaired, Protocol 1.1
Knowledge Gaps and Agent Operator authority are preserved, and the
migration remains unapplied. After migration and post-migration
verification, Workstream 4A.3 can begin.


## POST-v10 MIGRATION VERIFICATION

1 October 2026. **PASS — PLATFORM CONTROL PLANE v10 VERIFIED.**
This post-apply result supersedes readiness-only status above. All earlier
investigation, authorization stops, race reproduction, CAS repair, parity
corrections and secure 9 → 10 preflight remain preserved.

### 1–5. Apply, history, collections, indexes and installed validators

The operator supplied successful apply output: schemaVersion 10; four created
collections (`agent_runs`, `agent_attempts`, `agent_results`,
`agent_usage_observations`) and all fourteen expected indexes. This verification
did not run apply again.

Read-only inspection of dev `vamberic_studio` independently confirms live version
10. Migration `010-agent-control-plane` is recorded at
`2026-10-01T12:54:51.900Z`. All migrations 001–010 occur exactly once in canonical
version order with nondecreasing timestamps. Prior migration entries are retained:

```json
[
  {
    "id": "001-vapp-v1-baseline",
    "version": 1,
    "appliedAt": "2026-09-15T14:32:29.287Z"
  },
  {
    "id": "002-crm-foundation",
    "version": 2,
    "appliedAt": "2026-09-27T09:18:48.931Z"
  },
  {
    "id": "003-commercial-foundation",
    "version": 3,
    "appliedAt": "2026-09-27T11:57:07.499Z"
  },
  {
    "id": "004-brand-foundation",
    "version": 4,
    "appliedAt": "2026-09-27T16:43:30.585Z"
  },
  {
    "id": "005-hvm-phase1",
    "version": 5,
    "appliedAt": "2026-09-28T12:42:21.173Z"
  },
  {
    "id": "006-hive-definitions",
    "version": 6,
    "appliedAt": "2026-09-29T16:37:32.154Z"
  },
  {
    "id": "007-hive-validator-consistency",
    "version": 7,
    "appliedAt": "2026-09-29T17:06:01.813Z"
  },
  {
    "id": "008-offer-foundation",
    "version": 8,
    "appliedAt": "2026-09-30T09:46:17.713Z"
  },
  {
    "id": "009-empress-operating-foundation",
    "version": 9,
    "appliedAt": "2026-09-30T12:00:39.664Z"
  },
  {
    "id": "010-agent-control-plane",
    "version": 10,
    "appliedAt": "2026-10-01T12:54:51.900Z"
  }
]
```

All 50 managed domain collections exist, including all 46 previous collections.
The four new collections contain exactly the expected indexes plus Mongo `_id_`.
Names, ordered keys, uniqueness, sparse/partial settings and absence of TTL were
compared to the canonical source. All fourteen match; no extra conflicting
indexes on new collections, replacements or incompatible indexes were found.
The exact installed index inventory is:

```json
[
  {
    "collection": "agent_runs",
    "name": "id_unique",
    "key": {
      "id": 1
    },
    "unique": true,
    "sparse": false
  },
  {
    "collection": "agent_runs",
    "name": "workspace_requester_request_unique",
    "key": {
      "workspaceId": 1,
      "requester.issuer": 1,
      "requester.id": 1,
      "requestKey": 1
    },
    "unique": true,
    "sparse": false
  },
  {
    "collection": "agent_runs",
    "name": "workspace_created",
    "key": {
      "workspaceId": 1,
      "createdAt": -1,
      "id": 1
    },
    "unique": false,
    "sparse": false
  },
  {
    "collection": "agent_runs",
    "name": "workspace_requester_created",
    "key": {
      "workspaceId": 1,
      "requester.issuer": 1,
      "requester.id": 1,
      "createdAt": -1,
      "id": 1
    },
    "unique": false,
    "sparse": false
  },
  {
    "collection": "agent_attempts",
    "name": "id_unique",
    "key": {
      "id": 1
    },
    "unique": true,
    "sparse": false
  },
  {
    "collection": "agent_attempts",
    "name": "run_ordinal_unique",
    "key": {
      "runId": 1,
      "ordinal": 1
    },
    "unique": true,
    "sparse": false
  },
  {
    "collection": "agent_attempts",
    "name": "run_generation_unique",
    "key": {
      "runId": 1,
      "generation": 1
    },
    "unique": true,
    "sparse": false
  },
  {
    "collection": "agent_results",
    "name": "id_unique",
    "key": {
      "id": 1
    },
    "unique": true,
    "sparse": false
  },
  {
    "collection": "agent_results",
    "name": "run_attempt_unique",
    "key": {
      "runId": 1,
      "attemptId": 1
    },
    "unique": true,
    "sparse": false
  },
  {
    "collection": "agent_results",
    "name": "workspace_run_created",
    "key": {
      "workspaceId": 1,
      "runId": 1,
      "createdAt": -1
    },
    "unique": false,
    "sparse": false
  },
  {
    "collection": "agent_results",
    "name": "workspace_applied_target",
    "key": {
      "workspaceId": 1,
      "dispositions.target.resource": 1,
      "dispositions.target.id": 1
    },
    "unique": false,
    "sparse": false
  },
  {
    "collection": "agent_usage_observations",
    "name": "id_unique",
    "key": {
      "id": 1
    },
    "unique": true,
    "sparse": false
  },
  {
    "collection": "agent_usage_observations",
    "name": "run_observation_unique",
    "key": {
      "runId": 1,
      "observation.id": 1
    },
    "unique": true,
    "sparse": false
  },
  {
    "collection": "agent_usage_observations",
    "name": "attempt_run",
    "key": {
      "attemptId": 1,
      "runId": 1
    },
    "unique": false,
    "sparse": false
  }
]
```

The full affected validator set was derived from current migration sources, not
assumed from the previous count. All fourteen structurally match canonical v10,
with strict validation/error action:

- crm_workspaces
- capability_instances
- hvm_partners
- workspace_partner_assignments
- hvm_partner_memberships
- workspace_integrations
- workspace_memberships
- agent_definitions
- pricing_recommendations
- swarm_agreements
- agent_runs
- agent_attempts
- agent_results
- agent_usage_observations

### 6. Knowledge Gap installed semantics

The installed Result validator matches Protocol 1.1 / Result schema 2 and was
used directly in synthetic Mongo `$documents` parity. Tests cover no gaps,
non-blocking gaps, blocking partial Results, human_input/research/capability/
unresolved, strict fields, missing required capability, malformed capability key,
duplicate IDs/support, dangling support, text bounds, required knowledgeGaps,
40 valid/41 invalid gaps, exactly 8,192 valid/8,193 invalid canonical gap bytes,
and complete plus blocking gap rejection. All pass. Canonical-source structural
comparison also confirms ID/enums/checked/reference/context bounds.

Digest recomputation, exact URL normalization, pre-BSON JavaScript object
properties and cross-collection authorization/freshness remain service-only.
Document-local support-reference and completeness checks in the installed
validator are not classified away as service-only. No automatic routing occurs.

### 7–8. Agent Operator and authority serialization

Installed workspace_memberships accepts optional bounded agentOperationGrants
with exact target kind/ID/revision, allowed operations, attribution, expiry and
chronology. Installed authority parity passes. Existing live membership has
neither grants nor executionSerial, remains valid, and gains no role-derived
authority. No grants were created.

All seven optional executionSerial validator amendments are installed; existing
operating referenceVersion anchors remain canonical. Absence defaults internally
to zero; real bounded transactional CAS writes serialize establishment against
reductions. No backfill is needed. Existing v10-compatible runtime guards and
local concurrency/authorization regressions remain green.

### 9–10. Counts and preservation evidence

All four new collections are empty. Counts match pre-migration observations:
Products 2; Organisation, workspace, Brand, workspace membership, Partner,
Partner membership, assignment and Event each 1. Client Agents, Client Swarms,
all Hive/Offer collections, integrations and capability instances remain empty.
Full counts:

```json
{
  "agent_runs": 0,
  "agent_attempts": 0,
  "agent_results": 0,
  "agent_usage_observations": 0,
  "agent_definitions": 0,
  "integration_providers": 0,
  "swarm_templates": 0,
  "commercial_policies": 0,
  "methodology_availability": 0,
  "client_agents": 0,
  "client_swarms": 0,
  "pricing_recommendations": 0,
  "swarm_agreements": 0,
  "offer_designs": 0,
  "offers": 0,
  "offer_revisions": 0,
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
```

No pre-apply document fingerprints were captured in the preceding verification;
therefore a byte-for-byte pre/post-apply equality claim cannot be made. Available
preservation evidence is unchanged counts, compatible data, exact additive
schema/index changes, and source inspection showing only DDL and schema-ledger
writes (no business-document updates). There is no evidence of a business rewrite.

This verification captured SHA-256 over `_id`-sorted canonical Extended JSON
collection documents, repeated inspection at completion, and confirmed all 50
fingerprints unchanged during verification. Nonempty collection fingerprints:

```json
{
  "workspace_memberships": "a61234373ff0659d06abc4a8215ed06de8c8f2bf804d3af099ea36f518e0ac71",
  "brands": "cf6fe1b4145f5ad342637c0ad22c82b75aaa4149fd14ee282bbd682fa232fa90",
  "hvm_partner_memberships": "8c762d7ed2cea15c8c9d6fb75c951bf1d4512f313a3dcf05ad8ae3637cac629a",
  "hvm_partners": "87240858725d397172e3a8a73ebcbaea48b62bc8bac07e0186aac2096487d4ff",
  "workspace_partner_assignments": "ddab814925cbc2f792495aa7f2d9fe98c8e6dfb1a4883e11c2272bccbcd308e8",
  "products": "5bedfe12e2f13874dfa9bd3d4f7b6d2a809139f66c677b2ace3b79be15ba373a",
  "organisations": "0bf53df63d1ee35f63e047e5645a4c5ea8b555b3300c6cdb9407bd379e397f24",
  "events": "7cb8982ff585e199e64248328e9200350bd79ff1322ccb7fcfd6a64e9e73df95",
  "crm_workspaces": "9fc1f0fcfc0ea634cb7ea58c3e25870b6839753442f49c668912033708a8cd33"
}
```

### 11. Actual installed-validator parity

Repository application/domain/test code was unchanged. Temporary verification
copies under `/tmp/post-v10` fetch validators with listCollections and use those
actual installed definitions in `$match`; they do not substitute proposed source
validators. Source-to-installed structural comparison is separate. Synthetic
`$documents` pipelines persist nothing.

The unchanged fixture suite against installed validators passed **777 / 0 / 0**
(pass/fail/skip). Seven explicit Knowledge Gap boundary probes then expanded it
to **784 / 0 / 0**. This includes new control-plane, authority/grant and operating
validators. No installed-validator failure or unexplained drift was found.

### 12–17. Local security, protocol and service regressions

Focused Agent suite: **258 passed, 0 failed, 2 skipped**. The skips are opt-in
Mongo checks run separately above. Original stale-snapshot regression, reverse
commit order, Run creation, input resume, Queen/Partner, Agent revision/lifecycle
and retry/yield tests pass. No live concurrency reproduction was attempted.

Protocol drift: **81 Protocol 1.1 artifacts verified** against the read-only
Runtime sibling, including Result schema 2, KnowledgeGapSchema, golden fixtures
and canonical digest contracts. Protocol tests pass.

Readiness retains separate configuration/execution checks, trusted implementation
and capability/operation support, valid bindings, workspace policy/provider/model
and budget constraints, client state and explicit grants where applicable.
Human configure/operate/apply/approve separation, own-Run/revision/expiry rules,
no automatic admin/member authority and no Empress-only workspace execution pass.
Workload scope/projection/implementation/lease/fence bounds and forged-principal
rejection pass; production HTTP remains fail-closed pending 4A.3 M2M composition.
Proposal apply/reject, target authority, evidence provenance, stale target/source
and canonical approval freshness tests pass. Operation grants do not grant
canonical edit/approval permissions.

### 18–20. Full suite, quality and secure dry-run

| Check | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| Full API | 1459 | 0 | 10 |
| Focused Agent | 258 | 0 | 2 |
| Installed parity, original fixtures | 777 | 0 | 0 |
| Installed parity, expanded gap boundaries | 784 | 0 | 0 |

Full API skips: two Agent Mongo parity, six historical Hive Mongo parity, one
Offer Mongo parity and one operating Mongo parity. Current Agent/authority/
operating installed suites ran separately; unchanged historical Hive/Offer Mongo
fixtures were not rerun. Their local regressions pass in the full API suite.

Workspace typecheck, API lint/build/formatting, protocol drift and git diff --check
all pass. No formatting/code changes were required.

Secure dev loader used vamberic-admin and the existing eu-west-2
vamberic/dev/api secret in memory only. Post-migration db:setup --dry-run confirms
**10 → 10, compatible**, zero collections, validators or indexes pending; zero
validator conflicts, incompatible indexes or uniqueness risks. No apply ran.

### 21–24. Documentation, exact task changes and Git

Only this repository file was edited in this post-migration task:
`docs/investigations/agent-control-plane-pre-migration-verification.md`.
Temporary read-only verification scripts/logs are outside the repository. No
application/domain/test/config changes. Existing uncommitted work was preserved.
Nothing staged, committed or pushed. Complete final working-tree inventory
(includes pre-existing work):

```text
 M artifacts/api-server/.env.example
 M artifacts/api-server/package.json
 M artifacts/api-server/src/app.ts
 M artifacts/api-server/src/authorization/policy.ts
 M artifacts/api-server/src/config.ts
 M artifacts/api-server/src/db/collections.ts
 M artifacts/api-server/src/db/hive-validators.ts
 M artifacts/api-server/src/db/setup.ts
 M artifacts/api-server/src/domain/commercial-records.ts
 M artifacts/api-server/src/domain/crm-records.ts
 M artifacts/api-server/src/domain/hive-definitions.ts
 M artifacts/api-server/src/domain/ids.ts
 M artifacts/api-server/src/domain/index.ts
 M artifacts/api-server/src/domain/partners.ts
 M artifacts/api-server/src/domain/workspace-integrations.ts
 M artifacts/api-server/src/domain/workspace-memberships.ts
 M artifacts/api-server/src/routes/hive-definitions.ts
 M artifacts/api-server/src/routes/hvm.ts
 M artifacts/api-server/src/services/crm-foundation.ts
 M artifacts/api-server/src/services/hive-definitions.ts
 M artifacts/api-server/src/services/hvm-context.ts
 M artifacts/api-server/src/services/hvm-provision.ts
 M artifacts/api-server/test/authorization.test.ts
 M artifacts/api-server/test/crm-foundation.test.ts
 M artifacts/api-server/test/domain.test.ts
 M artifacts/api-server/test/helpers/enquiry-db.ts
 M artifacts/api-server/test/hive-definitions.test.ts
 M artifacts/api-server/test/hvm-phase1.test.ts
 M artifacts/api-server/tsconfig.json
 M docs/hive-definitions.md
 M pnpm-lock.yaml
?? artifacts/api-server/src/authorization/agent-workload.ts
?? artifacts/api-server/src/db/agent-control-plane-collections.ts
?? artifacts/api-server/src/db/agent-control-plane-validators.ts
?? artifacts/api-server/src/db/agent-json-integrity.ts
?? artifacts/api-server/src/db/agent-operator-validators.ts
?? artifacts/api-server/src/db/agent-protocol-validators.ts
?? artifacts/api-server/src/db/execution-serialization-validators.ts
?? artifacts/api-server/src/db/hive-validators-v6.ts
?? artifacts/api-server/src/db/offer-validators.ts
?? artifacts/api-server/src/db/operating-json-size.ts
?? artifacts/api-server/src/db/operating-validators.ts
?? artifacts/api-server/src/domain/agent-budget.ts
?? artifacts/api-server/src/domain/agent-context-projection.ts
?? artifacts/api-server/src/domain/agent-control-plane.ts
?? artifacts/api-server/src/domain/agent-operator.ts
?? artifacts/api-server/src/domain/agent-outcome-scope.ts
?? artifacts/api-server/src/domain/execution-serialization.ts
?? artifacts/api-server/src/domain/offer-methodologies.ts
?? artifacts/api-server/src/domain/offers.ts
?? artifacts/api-server/src/domain/operating-logic.ts
?? artifacts/api-server/src/domain/operating.ts
?? artifacts/api-server/src/routes/agent-control-plane.ts
?? artifacts/api-server/src/routes/agent-operators.ts
?? artifacts/api-server/src/routes/offers.ts
?? artifacts/api-server/src/routes/operating.ts
?? artifacts/api-server/src/services/agent-authority-serialization.ts
?? artifacts/api-server/src/services/agent-control-plane.ts
?? artifacts/api-server/src/services/agent-execution-readiness.ts
?? artifacts/api-server/src/services/agent-operators.ts
?? artifacts/api-server/src/services/agent-proposal-freshness.ts
?? artifacts/api-server/src/services/agent-proposals.ts
?? artifacts/api-server/src/services/agent-run-requests.ts
?? artifacts/api-server/src/services/agent-subsystem.ts
?? artifacts/api-server/src/services/agreement-approval-contract.ts
?? artifacts/api-server/src/services/offers.ts
?? artifacts/api-server/src/services/operating.ts
?? artifacts/api-server/test/agent-authority-parity.test.ts
?? artifacts/api-server/test/agent-authority-serialization.test.ts
?? artifacts/api-server/test/agent-control-plane.test.ts
?? artifacts/api-server/test/agent-operator-service.test.ts
?? artifacts/api-server/test/agent-operator.test.ts
?? artifacts/api-server/test/agent-runtime-protocol.test.ts
?? artifacts/api-server/test/agent-validator-parity.test.ts
?? artifacts/api-server/test/agent-workload-budget.test.ts
?? artifacts/api-server/test/agreement-approvals.test.ts
?? artifacts/api-server/test/helpers/agent-mongo-parity.ts
?? artifacts/api-server/test/helpers/agent-operator-fixture.ts
?? artifacts/api-server/test/helpers/agent-snapshot-db.ts
?? artifacts/api-server/test/helpers/offer-parity.ts
?? artifacts/api-server/test/helpers/operating-fixtures.ts
?? artifacts/api-server/test/hive-validator-parity.test.ts
?? artifacts/api-server/test/offer-methodologies.test.ts
?? artifacts/api-server/test/offers.test.ts
?? artifacts/api-server/test/operating-authorization.test.ts
?? artifacts/api-server/test/operating-validator-parity.test.ts
?? artifacts/api-server/test/operating.test.ts
?? docs/agent-control-plane.md
?? docs/empress-operating-layer.md
?? docs/investigations/agent-authority-serialization.md
?? docs/investigations/agent-control-plane-pre-migration-verification.md
?? docs/investigations/empress-operating-layer-verification.md
?? docs/investigations/hive-definitions-v6-post-migration-verification.md
?? docs/investigations/offer-foundation-v8-pre-migration-verification.md
?? docs/investigations/offering-icp-data-architecture-current-state.md
?? docs/offer-foundation.md
?? lib/agent-runtime-protocol/README.md
?? lib/agent-runtime-protocol/contracts/content.d.ts
?? lib/agent-runtime-protocol/contracts/content.js
?? lib/agent-runtime-protocol/contracts/content.js.map
?? lib/agent-runtime-protocol/contracts/errors.d.ts
?? lib/agent-runtime-protocol/contracts/errors.js
?? lib/agent-runtime-protocol/contracts/errors.js.map
?? lib/agent-runtime-protocol/contracts/index.d.ts
?? lib/agent-runtime-protocol/contracts/index.js
?? lib/agent-runtime-protocol/contracts/index.js.map
?? lib/agent-runtime-protocol/contracts/input.d.ts
?? lib/agent-runtime-protocol/contracts/input.js
?? lib/agent-runtime-protocol/contracts/input.js.map
?? lib/agent-runtime-protocol/contracts/json.d.ts
?? lib/agent-runtime-protocol/contracts/json.js
?? lib/agent-runtime-protocol/contracts/json.js.map
?? lib/agent-runtime-protocol/contracts/knowledge-gap.d.ts
?? lib/agent-runtime-protocol/contracts/knowledge-gap.js
?? lib/agent-runtime-protocol/contracts/knowledge-gap.js.map
?? lib/agent-runtime-protocol/contracts/outcome.d.ts
?? lib/agent-runtime-protocol/contracts/outcome.js
?? lib/agent-runtime-protocol/contracts/outcome.js.map
?? lib/agent-runtime-protocol/contracts/primitives.d.ts
?? lib/agent-runtime-protocol/contracts/primitives.js
?? lib/agent-runtime-protocol/contracts/primitives.js.map
?? lib/agent-runtime-protocol/contracts/usage.d.ts
?? lib/agent-runtime-protocol/contracts/usage.js
?? lib/agent-runtime-protocol/contracts/usage.js.map
?? lib/agent-runtime-protocol/contracts/work.d.ts
?? lib/agent-runtime-protocol/contracts/work.js
?? lib/agent-runtime-protocol/contracts/work.js.map
?? lib/agent-runtime-protocol/fixtures/cancelled.json
?? lib/agent-runtime-protocol/fixtures/claimedWork.json
?? lib/agent-runtime-protocol/fixtures/dispatch.json
?? lib/agent-runtime-protocol/fixtures/evidence.json
?? lib/agent-runtime-protocol/fixtures/failure.json
?? lib/agent-runtime-protocol/fixtures/finding.json
?? lib/agent-runtime-protocol/fixtures/gapBlocking.json
?? lib/agent-runtime-protocol/fixtures/gapCapability.json
?? lib/agent-runtime-protocol/fixtures/gapHuman.json
?? lib/agent-runtime-protocol/fixtures/gapNonBlocking.json
?? lib/agent-runtime-protocol/fixtures/gapResearch.json
?? lib/agent-runtime-protocol/fixtures/gapResearchResolved.json
?? lib/agent-runtime-protocol/fixtures/gapUnresolved.json
?? lib/agent-runtime-protocol/fixtures/invalidCompleteBlocking.json
?? lib/agent-runtime-protocol/fixtures/invalidEvidenceReference.json
?? lib/agent-runtime-protocol/fixtures/invalidFindingReference.json
?? lib/agent-runtime-protocol/fixtures/invalidLineageReference.json
?? lib/agent-runtime-protocol/fixtures/invalidMalformedCapability.json
?? lib/agent-runtime-protocol/fixtures/invalidMissingCapability.json
?? lib/agent-runtime-protocol/fixtures/manifest.json
?? lib/agent-runtime-protocol/fixtures/needsInput.json
?? lib/agent-runtime-protocol/fixtures/proposal.json
?? lib/agent-runtime-protocol/fixtures/success.json
?? lib/agent-runtime-protocol/fixtures/unsupportedMajor.json
?? lib/agent-runtime-protocol/fixtures/usage.json
?? lib/agent-runtime-protocol/fixtures/yield.json
?? lib/agent-runtime-protocol/json-schema/Checkpoint.json
?? lib/agent-runtime-protocol/json-schema/ClaimedWork.json
?? lib/agent-runtime-protocol/json-schema/Dispatch.json
?? lib/agent-runtime-protocol/json-schema/EvidenceObservation.json
?? lib/agent-runtime-protocol/json-schema/Finding.json
?? lib/agent-runtime-protocol/json-schema/Grant.json
?? lib/agent-runtime-protocol/json-schema/ImplementationManifest.json
?? lib/agent-runtime-protocol/json-schema/InputRequest.json
?? lib/agent-runtime-protocol/json-schema/InputResponse.json
?? lib/agent-runtime-protocol/json-schema/KnowledgeGap.json
?? lib/agent-runtime-protocol/json-schema/Outcome.json
?? lib/agent-runtime-protocol/json-schema/Proposal.json
?? lib/agent-runtime-protocol/json-schema/SafeError.json
?? lib/agent-runtime-protocol/json-schema/SourceLineage.json
?? lib/agent-runtime-protocol/json-schema/UsageObservation.json
?? lib/agent-runtime-protocol/package.json
?? lib/agent-runtime-protocol/provenance.json
?? lib/agent-runtime-protocol/source/content.ts
?? lib/agent-runtime-protocol/source/errors.ts
?? lib/agent-runtime-protocol/source/index.ts
?? lib/agent-runtime-protocol/source/input.ts
?? lib/agent-runtime-protocol/source/json.ts
?? lib/agent-runtime-protocol/source/knowledge-gap.ts
?? lib/agent-runtime-protocol/source/outcome.ts
?? lib/agent-runtime-protocol/source/primitives.ts
?? lib/agent-runtime-protocol/source/usage.ts
?? lib/agent-runtime-protocol/source/work.ts
?? scripts/check-runtime-protocol.mjs
```

### 25–27. Environment, limitations and 4A.3

No live CRUD fixtures, grants, AWS infrastructure changes, deployment, staging,
commit or push. Runtime sibling and HVMapp unchanged by this task. No 4A.3 work
was implemented. All read-only fingerprints remained stable.

No blocking implementation/schema/authorization gap found. The only historical
evidence limitation is the absent pre-apply fingerprint; it is not concealed as
an asserted byte-for-byte comparison. Production worker/M2M/queue composition
remains intentionally deferred to 4A.3.

The Platform Agent Run/control-plane foundation is live and verified on
schema v10. Workstream 4A.3 may begin: SQS dispatch, Cognito M2M
workload authentication and the Fargate Agent Runtime worker.
