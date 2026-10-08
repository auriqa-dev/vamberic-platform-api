# Commercial outcomes v15 verification

2026-10-04 — **PASS: local foundation implementation and offline verification.**
Unapplied, not deployment or activation approval. Required ordered release chain:
**schema 11 → v12 → v13 → v14 → v15**.

## Implemented and reviewed

See [the foundation](commercial-outcomes-v15-foundation.md) for the complete domain model,
confirmed-source boundary, transaction/Event distinction, contextual lifecycle,
realised/potential separation, recurring commitments, correction semantics, Context and
Contact Strategy integration, synthetic Atlas scenario and future writer responsibilities.

Existing canonical Transactions, Subscriptions and Product Relationships were reused with
an explicit Offering commercial branch; no parallel store or new collection was added.
Organisation is the economic subject, optional Person the participant. Existing financial,
CRM and canonical-knowledge contracts remain intact. Current schema guards additionally
accept 15; they retain all previous accepted versions. The legacy Product projection filters
Offering-only relationships instead of interpreting them as Products. No commercial UI,
HTTP ingestion route, billing, accounting, strategy algorithm or Agent implementation exists
from this change.

Migration `015-commercial-outcomes`: 14 → 15; zero collections; seven indexes; six validator
applications. Exact definitions and predecessor validators are recorded in
`release-reviews/commercial-v15-foundation/proposed-migration.json` at the workspace root.
New source/revision indexes are workspace-scoped and partial. Existing indexes are retained.
Preflight rejects unknown/weakened validators, incompatible data/indexes, duplicate source
keys, installed 11–13 predecessor bypass, and incomplete/reordered/duplicate/wrong-ID migration
ledgers. Synthetic interruption/retry appends v15 once and preserves all domain records.
No actual schema application or live installed-schema verification was performed.

## Frozen history and isolation

The v14 migration test's only change is its setup import. An SHA-256 regression restores
that import in memory and proves the original test text is identical. A complete compiled
v14 setup-target fingerprint protects all reviewed collection/index/validator definitions.
Original v14 domain/migration modules, reference checker, foundation tests, preservation
tests and both reports remain byte-for-byte unchanged. Existing v12/v13 preservation tests
also pass. Older shared migration tests use that historical target rather than changing
historical assertions to the latest schema.

The setup factory is code-owned test infrastructure, not an HTTP or CLI migration selector.
The normal setup command always uses the current target. No alternative schema-11 path is
introduced. Existing target-14 verification artifacts remain historical evidence.

## Exact results

| Check                                                   | Result                                                               |
| ------------------------------------------------------- | -------------------------------------------------------------------- |
| Full Platform suite                                     | **1,699 total; 1,688 passed; 0 failed; 11 skipped**                  |
| New v15 tests within Platform suite                     | **62 passed**                                                        |
| Full Runtime suite                                      | **468 passed; 0 failed; 0 skipped**                                  |
| Runtime/Platform protocol artifacts                     | **120/120 byte-for-byte matches; Protocol 1.2 / Result 2 unchanged** |
| Platform TypeScript, ESLint, Prettier, production build | PASS                                                                 |
| Runtime TypeScript, ESLint, Prettier, production build  | PASS                                                                 |
| Runtime generated schema artifacts                      | PASS                                                                 |
| Platform and Runtime `git diff --check`                 | PASS                                                                 |
| Actual installed Mongo parity / live dry-run            | **Not run — unapplied foundation, no live access**                   |

The eleven skipped Platform tests are existing opt-in Mongo parity gates. The new migration
checks use an in-memory fake database. They prove setup planning, preservation and retry
behavior, not real Mongo query-engine acceptance. The structural Mongo validators do not
replace application semantic/reference admission, authorization or append-only enforcement.

Tests cover required value/currency/provenance, absent/wrong subjects, optional Person,
exact Offering/evidence references, one-off/recurring constraints, unknown fields and
execution-authority rejection, independent confirmation refusal, refunds/reversals/corrections/
cancellations, recurring supersession, workspace isolation, Event/fact linkage, customer
scope across Offerings, potential plus transaction-backed realised value, Context/policy
consumption, legacy writer rejection, migration conflicts and frozen-v14 regression.

The fictional Atlas scenario represents £1,995 initial purchase, three further sites at
£5,985 total, a £295/month/site recurring commitment, Sarah as participant, higher remaining
potential and prospect status for a second Offering. No aggregation engine or automatic
customer-state transition was executed. All records exist only inside local synthetic tests.

Commands used, with Node v24.21.0 and existing dependencies:

```text
Platform (artifacts/api-server):
DEPLOYMENT_ENV=test node --import tsx --test test/*.test.ts
node ../../node_modules/.pnpm/typescript@5.9.3/node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
node node_modules/eslint/bin/eslint.js src test
node node_modules/prettier/bin/prettier.cjs --check 'src/**/*.ts' 'test/**/*.ts'
node build.mjs

Runtime:
node --experimental-strip-types --test test/*.test.ts
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js .
node node_modules/prettier/bin/prettier.cjs --check .
node node_modules/typescript/bin/tsc -p tsconfig.build.json
node --experimental-strip-types scripts/schema-artifacts.ts --check
node --experimental-strip-types scripts/verify-platform-protocol.ts

git diff --check (both repositories)
```

Early full-suite verification found an overly broad legacy-projection filter and an outdated
next-schema rejection expectation. Both were corrected before the final full passing run.
A final migration review added explicit ordered-ledger rejection tests and repeated the
complete Platform suite successfully. Runtime and shared artifacts were not changed.

## Exact changes and release gates

Task-relative changes: **28 Platform files; 0 Runtime; 0 HVMapp; 0 infrastructure**.
The exact changed-file inventory, hashes and complete Git status for all four repositories
are recorded in `release-reviews/commercial-v15-foundation/inventory.json`; a readable copy
is in `git-status.txt`. These distinguish this task from substantial pre-existing uncommitted
work. No pre-existing files were deleted. Review evidence outside the repositories comprises
the baseline, frozen v14 target, proposed v15 target, results and inventory/status files.

Remaining gates: ordered release qualification, secure preflight and real Mongo synthetic
validator parity, explicit migration/deployment authorization, authenticated source adapters,
transactional append-only/idempotent persistence and bounded authorized current-state/history
retrieval. Refund/net-value consumption and competing relationship assertions need explicit
policy when those consumers are implemented; this foundation does not choose those policies.
PSU and campaign execution retain their separate authorization/readiness gates.

No AWS or credentials were accessed. No live records, database migration, memberships,
authorities, activation state or deployed service was changed. No provider call, PSU execution,
Agent activation, staging, commit, push or deployment occurred.

## Subsequent independent review — 2026-10-04

The original local results above remain historical evidence. The subsequent
[release-qualification review](commercial-outcomes-v15-review.md) found and repaired an
unmarked legacy-validator bypass, duplicate commercial references and contradictory schema
version metadata. Its conclusion is **PASS WITH GAPS — DO NOT APPLY**: full local verification
passes, but the prepared 71-case read-only Mongo parity run still requires securely supplied
configuration and authorization for a fresh credential read. Do not treat the original
local PASS as permission to apply migrations.

### Mongo query-engine verification completed — 2026-10-04

The separately authorized replacement credential read succeeded after SSO renewal.
**71/71 proposed-validator boundary cases passed** with zero unexpected acceptances or
rejections, including all six intended application-only differences. See the appended
replacement-run section in [the review](commercial-outcomes-v15-review.md) and safe
`release-reviews/commercial-v15-mongo-parity/attempt-2.json` evidence. No schema/data writes
occurred. This resolves the proposed-validator execution gap only; consolidated ordered
release preflight and separate migration authorization remain required.
