# Commercial outcomes v15 — independent review and release qualification

2026-10-04 — **PASS WITH GAPS — DO NOT APPLY**.

This review inspected the actual development trees and did not treat the earlier local PASS
as migration qualification. Three implementation defects were repaired within the approved
foundation. Actual Mongo validator parity remains unverified because no Mongo configuration
is supplied to the process and a new credential read was not performed.

## Findings and repairs

1. **Legacy Mongo branch bypass (high).** The original three commercial validators accepted
   every document without `commercialVersion`. Removing that discriminator from an Offering
   fact bypassed all strict v15 shape constraints. The legacy branch now also excludes the
   v15-only root fields `offering`, `provenance`, `commercialKind`, `originalTransaction`,
   `subscription`, `supersedes` and `transactions`. Existing canonical Product contracts do
   not declare these fields. Marked records must pass the strict branch; unknown/null
   versions cannot fall back to legacy. Regression coverage checks the reserved field guard
   and prepares missing-marker cases for actual Mongo execution.
2. **Duplicate commercial references (medium).** Relationship transaction lists, realised
   value references and Context commercial lists accepted repeated transaction/record IDs,
   including potential different digests for one ID. Admission now rejects repeated
   collection/ID identities within each list. This prevents consumers receiving duplicated
   fact entries from those admitted lists; it is not an aggregate/net-value engine. Mongo's
   structural validator does not perform this identity-level check, so trusted application
   admission remains mandatory.
3. **Contradictory schema ledger fields (medium).** Setup preferred `version` and ignored a
   conflicting `schemaVersion`. Current v15 setup now rejects disagreement before any
   writes. A regression invokes the production setup export against synthetic schema-14
   metadata with `schemaVersion: 11` and verifies zero mutations.

No new functionality, integration, production writer, strategy logic or domain policy was
introduced. V14 code-owned contracts, migration definitions and reviewed reports remain
unchanged. This review's changes are distinct from the preceding implementation inventory.

## Architecture and authority conclusions

- Transactions, Subscriptions and Product Relationships reuse their existing collections,
  application ID prefixes and subject fields. Offering revisions are not substituted for
  legacy Product identities. The legacy CRM Product projection explicitly excludes the
  Offering-only branch.
- A new transaction/subscription requires the caller's independently trusted confirmation
  verifier. Source labels and evidence/Event shape alone cannot satisfy this. No production
  integration implements that verifier; current production imports use contracts for
  persistence metadata, not a new public ingestion endpoint. Referenced persisted facts
  require a trusted resolver returning already-admitted canonical records. These are
  explicit preconditions, not cryptographic attestation supplied by these contracts.
- Existing CRM mutations reject workspace-owned records. A regression exercises the actual
  update helper with a commercial relationship and observes rejection before any write.
  Existing transaction/subscription routes are not introduced by v15. Normal APIs cannot
  create commercial facts by adding fields to an existing generic CRM patch.
- Organisation remains the economic subject; Person is optional participation. Scope and
  exact Offering/evidence/digest checks are independent of actor authority. Empress,
  Queen/Partner, client memberships, grants and execution authority remain unchanged.
- Correction/supersession contracts retain original facts. No aggregation computes realised
  totals, so refunds/corrections must not simply be summed as positive purchases. The new
  duplicate-reference rejection is an integrity guard, not netting policy.
- An exact historical customer or active commitment assertion is not automatically current
  state. No current-state retrieval/strategy consumer was introduced. Supersession selection,
  concurrent conflicting assertions, freshness and net-value consumption remain prerequisites
  before those consumers can operate. Existing contracts do not implement automatic purchase
  to customer transitions, acquisition suppression or campaign execution.
- Context references copy no transaction history. Historical commercial admission checks
  workspace, exact identities/digests, evidence and bounded history. They do not authorize
  reading records, spending, execution or approval.

## Migration and historical harness review

The dependency remains **11 → 12 → 13 → 14 → 15**, with no applied migration.
`015-commercial-outcomes` still proposes zero new collections, seven indexes and six
validator applications. This review strengthens three proposed validators, not v14.

Tests use the current production v15 exports for upgrade/preflight/retry qualification.
They exercise exact v14 predecessors, interruption/retry, duplicate/index/data conflicts,
unknown or weakened validators, old-version bypass, ordered/missing/duplicate/wrong-ID
migration history and inconsistent version fields. Domain records remain unchanged in the
in-memory migration fixture. Existing indexes are not dropped.

The historical harness remains separate: the original v14 test assertions are protected by
an import-normalized text hash; all compiled v14 collection/index/validator definitions have
an exact fingerprint. Older shared migration tests use the historical target, while the
new v15 migration tests exercise the current production target. This does not imply that
v12–v14 have been operationally qualified against the actual installed database. Their
reviewed releases must still run in order. Migration execution must be an exclusive,
reviewed operational activity; synthetic retry tests do not prove concurrent DDL safety.

Legacy compatibility is established for the canonical contracts and synthetic scenarios,
not every actual installed document. Previously stored noncanonical documents using one of
the newly reserved root fields would now fail preflight and require review. No backfill,
coercion or live repair was performed to conceal such a conflict.

## Verification and application/Mongo differences

Final results:

| Check                                                           | Result                                                 |
| --------------------------------------------------------------- | ------------------------------------------------------ |
| Complete Platform suite                                         | 1,773 total; **1,761 passed**, zero failed, 12 skipped |
| New review test file                                            | 73 passed; one credential-gated Mongo test skipped     |
| Complete Runtime suite                                          | **468 passed**, zero failed/skipped                    |
| Shared protocol artifacts                                       | **120/120**; Protocol 1.2 / Result 2 unchanged         |
| Both repositories: typecheck, lint, format, production build    | PASS                                                   |
| Runtime generated schema checks; both diff checks               | PASS                                                   |
| Frozen v12/v13/v14 checks and original v14 migration assertions | PASS                                                   |
| Actual Mongo parity                                             | **NOT RUN**                                            |

The 12 skipped tests comprise 11 pre-existing opt-in Mongo gates plus the new v15 parity
runner. The new parity corpus contains **71 synthetic cases across all six v15 validator
applications**. It covers valid structures, optional Person, Mongo transport identity,
workspace/Offering IDs, marker removal/null/unknown versions, money/currency/quantity,
provenance/evidence requirements, mutation timestamps, legacy branches and deliberate
application-only semantic boundaries. Its application expectations passed locally. The
Mongo expectations are prepared but unverified; structural guard inspection is not a Mongo
query-engine test.

Intentional application-only checks include confirmation chronology, correction original
links, customer purchase-history requirements and duplicate fact identities. Cross-document
workspace/Offering/provenance, trusted-source verification, append-only persistence and
current-state freshness cannot be established by these document validators alone. Six
cases explicitly distinguish Mongo-structural acceptance expectations from application
rejection, rather than presenting those checks as equivalent.

The prepared Mongo test invokes the existing `agentMongoParity` helper, which uses only
collectionless `$documents` → `$match` → `$project` over synthetic literals. It neither
creates records nor installs validators. It explicitly refuses installed-validator mode:
v15 is unapplied, so its proposed code-owned validators must be tested.

## Credential boundary and remaining gates

Only the presence of process-supplied `MONGODB_URI` was checked: absent. No value was read.
The existing reviewed capture-and-pass pattern in
`release-reviews/hvm-schema11-deployment-2026-10-03/secure-read.py` obtains configuration via
AWS Secrets Manager (`vamberic/dev/api`, profile `vamberic-admin`, region `eu-west-2`).
Its existing payload fingerprints live collections, so it was neither executed nor reused
unchanged for this task. A fresh secret read is needed to adapt that secure boundary for the
prepared synthetic parity runner; no secret read or AWS call was made here.

Required next authorization is narrowly: read the existing dev API secret into process
memory using that secure pattern, pass only the Mongo URI to the test process, and run:

```text
COMMERCIAL_V15_MONGO_PARITY=1 DEPLOYMENT_ENV=test node --import tsx --test test/commercial-v15-review.test.ts
```

This command assumes securely supplied configuration; never paste a URI/key into chat,
repository files or a shell command. The launcher must capture/sanitize failures and must
not print the secret. No schema application, collection write, provider call or AWS mutation
is required. If SSO renewal is needed it must be handled separately without exposing tokens.

After parity, review real read-only compatibility/preflight for the ordered v12–v15 releases,
then request separate migration authorization. Trusted ingestion, transactional immutable
writes, source replay/idempotency and bounded current-state/history retrieval remain later
work. None is implicitly authorized by a migration-readiness result. PSU and campaign
execution remain stopped.

## Preservation and exact changes

Changed files for this review are in the task-relative inventory under
`release-reviews/commercial-v15-review/inventory.json`, with complete Git status for all four
repositories in `git-status.txt`. Pre-existing dirty trees were preserved; no files were
removed. Runtime, HVMapp and infrastructure have no task-relative changes.

No credential values, live Mongo records, AWS resources, permissions, memberships,
activation state or deployed services were accessed/changed by an operation in this review.
No migration, live test CRUD, Agent/PSU execution, provider call, staging, commit, push or
deployment occurred. Local builds produced their normal ignored outputs only.

## Authorized Mongo parity attempt — 2026-10-04

**PASS WITH GAPS — DO NOT APPLY. Credential gate blocked; parity remains unverified.**

The user authorized one secure read of `vamberic/dev/api`, solely for the prepared 71
synthetic cases. The established capture-and-pass pattern was adapted to a dedicated
read-only runner; the original live-collection fingerprint payload was not executed.

The single AWS CLI attempt failed with an expired/invalid SSO-session condition. Only that
sanitized classification was retained. No secret value was retrieved, displayed, logged or
persisted. No retry was attempted. **Zero of 71 Mongo cases executed; zero Mongo queries.**
There are consequently no observed Mongo acceptances/rejections or new parity conclusions.
The six documented application-only differences remain expectations, not Mongo observations.

Before the credential attempt, a configuration-absent local runner check confirmed that the
runner loads and exits safely without contacting Mongo. An earlier check from the workspace
root could not resolve `tsx`; the launcher uses the API repository's correct working directory.
Neither check accessed credentials or ran a database query. No implementation defect was
found by a provider/database response; no production code was changed and no local suites
were rerun. Earlier suite results above remain historical results, not new verification.

Manual renewal command:

```sh
aws sso login --profile vamberic-admin
```

After renewal, explicit authorization for a replacement secure-read attempt is needed; the
single authorized attempt has been consumed. Do not paste credentials or tokens into chat.
Migration application remains unauthorized. The next attempt must remain limited to the
proposed validators over synthetic `$documents`, without installing validators or records.

Evidence, runner, safe attempt result and exact task-relative Git inventory are retained in
`release-reviews/commercial-v15-mongo-parity/`. No AWS resources, Mongo records, permissions,
memberships or activation state were modified. No deployment, Agent/PSU execution,
provider call, staging, commit or push occurred.

## Authorized replacement Mongo parity run — 2026-10-04

**PASS — 71/71 proposed v15 Mongo boundary cases verified.**

Following manual SSO renewal, the user explicitly authorized one replacement secure-read
attempt. That single attempt succeeded. The existing dev API secret was captured without
printing it; only its Mongo URI was supplied to the validator process in memory. Neither
secret nor URI was written to a file or log. The credential-bearing processes have exited.
The prior blocked attempt remains recorded above and in `attempt-1.json`.

The runner executed all 71 prepared synthetic cases against the Mongo query engine, using
code-owned **proposed** v15 validators over collectionless `$documents` literals. No installed
validator or schema version was queried or inferred. This closes the proposed-validator
execution gap; it is not installed-validator parity or live-data migration preflight.

| Proposed validator             |  Cases | Accepted as expected | Rejected as expected | Unexpected |
| ------------------------------ | -----: | -------------------: | -------------------: | ---------: |
| transactions                   |     21 |                    6 |                   15 |          0 |
| subscriptions                  |     20 |                    5 |                   15 |          0 |
| product_relationships          |     14 |                    5 |                    9 |          0 |
| events                         |      4 |                    2 |                    2 |          0 |
| relationship_value_assessments |      6 |                    3 |                    3 |          0 |
| reasoning_contexts             |      6 |                    3 |                    3 |          0 |
| Total                          | **71** |               **24** |               **47** |      **0** |

All 68 cases with application expectations also matched their expected application result.
The three legacy Mongo-only cases have no v15 application-acceptance expectation. The six
intentional differences were observed exactly as documented: Mongo accepted the structural
document while application validation rejected (1–2) future confirmation on a Transaction
or Subscription, (3) refund without original linkage, (4) customer without purchase history,
(5) duplicate Context transaction identity, and (6) duplicate realised-value fact. These
are mandatory application-layer checks; a structural Mongo pass is not authoritative
commercial admission or an authorization grant.

**Every unexpected acceptance/rejection: none.** No implementation repair was needed.
The full offline suites were not repeated because this attempt changed no implementation
or test contracts; their preceding results remain historical and are not relabelled as
fresh runs. Application parsers were executed by this runner for the 68 applicable cases.

Observed driver command counts: **71 `aggregate`, 1 `endSessions`**. All aggregate pipelines
were `$documents` → `$match` → `$project` over synthetic literals. No insert, update, delete,
collection creation, index command, validator installation, setup/apply call or live record
query was issued by the runner. One Secrets Manager read was attempted in this replacement
run, with AWS retry attempts limited to one; no further credential read occurred.

Safe case-by-case evidence is in
`release-reviews/commercial-v15-mongo-parity/attempt-2.json` (also `result.json`). The new
replacement baseline, exact task-relative file inventory and four-repository Git status are
in `replacement-baseline.json`, `replacement-inventory.json` and `replacement-git-status.txt`
in that directory. The earlier attempt and review history are preserved.

Remaining release gates are unchanged except for the now-passed proposed-validator check:
consolidated readiness/deployment-dependency review and read-only real-data compatibility
assessment for **11 → 12 → 13 → 14 → 15**, then separate explicit migration authorization.
Actual installed-validator verification is a later post-apply gate. This result does not
qualify every earlier migration against current data or authorize application of any version.
Trusted ingestion, transactional immutable persistence and authorized current-state/history
retrieval remain separate implementation prerequisites. PSU/campaign execution is not
resumed.

No API secret was displayed or persisted. No AWS resource, database record, installed schema,
validator, index, membership, authority, Agent activation or deployment was changed. No
provider call, staging, commit or push occurred. Only review documentation changed inside
the repositories during this replacement attempt.
