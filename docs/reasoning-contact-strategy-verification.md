# Unapplied v13 foundation — verification

**PASS — local foundation implemented and statically verified. Not deployment or migration authorization.**

## Implementation

Four canonical workspace-owned contracts: Reasoning Context, Decision, scoped Learning,
and versioned Contact Strategy policy. Observation/interaction/outcome reuse Events;
Action reuses CRM task lifecycle with optional Campaign. Exact Offering/ICP/Buyer/Offer
revision references and existing evidence replace knowledge duplication. Organisations,
People and Contact Points remain the Account/Contact model. Existing code-owned
Methodology catalogue and separate availability governance remain unchanged.

The machine Reasoning Engine remains a platform capability, not an Agent. Human Queen
remains human. Local Contact Strategy registration proposals validate through existing
Capability/Agent Definition contracts and are draft/internal, with no implementation,
activation, Client Agent, grants or read/propose authority. No live registration occurred.

Immutable snapshot/supersession contracts, source attribution, bounded evidence,
confidence, validity, policy versions, candidate selection and lifecycle links are
represented. Pure admission checks reject foreign workspace references, missing/exact
revision mismatches, changed evidence and policy-version substitutions. Descriptive
recommendation/delegation/escalation fields do not authorize anything.

No model state, hidden reasoning, learning/strategy algorithm, approval/execution
workflow, UI, orchestration, provider call or PSU execution was implemented or run.
Existing CRM endpoints reject new reasoning links until a future authorized admission
workflow exists. See the foundation document for the precise future writer obligations.

## Required release dependency

**Unreleased v12 → unapplied v13.** Protocol **1.2 / Result 2**, including PSU provenance,
is the accepted current development baseline. This work is not independently releasable
from installed schema 11. No v12 renumbering, alternative migration path or modification
of the v12 protocol migration module. Future release must review/release v12 first.

Migration proposal: `013-reasoning-contact-strategy-foundation`; four empty collections,
nine indexes, six validator applications (four new records plus Events/CRM tasks).
No backfill or registrations. Exact predecessor recognition, read-only planning,
unknown-validator rejection, interruption/retry, migration-history preservation and
idempotent repeated setup were tested **only with in-memory fake databases**.

## Exact verification

| Check | Result |
|---|---|
| Complete API suite | **1,581 total; 1,570 passed; 0 failed; 11 skipped** |
| New foundation/migration tests | **24 passed**, included above |
| API typecheck | PASS |
| API lint (`src`, `test`) | PASS |
| API formatting (`src/**/*.ts`, `test/**/*.ts`) | PASS |
| API production build | PASS |
| Cross-repository protocol artifacts | **120/120 byte-for-byte**, Protocol 1.2 / Result 2 |
| `git diff --check` | PASS |
| Installed Mongo / validator parity | NOT RUN; no database access |
| Migration apply / secure live dry-run | NOT RUN; not authorized in this task |

The 11 skips are the existing opt-in Mongo parity checks (authority, Effectiveness,
Agent, Hive current/snapshot, Offer and operating validators). No claim of installed
v13 parity is made. New Mongo structures compile through the existing fail-closed
compiler; cross-document/semantic admission is not claimed to be enforced by structural
Mongo validation alone.

Tests cover strict/required workspace and bounded fields; cross-proposition contexts;
exact revision, hash, type and identity; reference isolation; exact evidence and embedded
evidence presence; policy version/methodology matching; candidate selection/duplicates;
immutable/self-supersession constraints; learning scope/validity; optional Campaign;
CRM completion semantics; outcome intervals; no generic reasoning write API; and
non-executable Contact Strategy registration. Existing authorization, control-plane,
Effectiveness, PSU, proposal/freshness and routing regressions also passed.

Commands used the installed local Node executable and existing dependency tools:

```sh
# Working directory: vamberic-platform-api/artifacts/api-server
DEPLOYMENT_ENV=test /opt/homebrew/bin/node --import tsx --test test/*.test.ts
/opt/homebrew/bin/node ../../node_modules/.pnpm/typescript@5.9.3/node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
/opt/homebrew/bin/node node_modules/eslint/bin/eslint.js src test
/opt/homebrew/bin/node node_modules/prettier/bin/prettier.cjs --check 'src/**/*.ts' 'test/**/*.ts'
/opt/homebrew/bin/node build.mjs
# Working directory: vamberic-agent-runtime
/opt/homebrew/bin/node --experimental-strip-types scripts/verify-platform-protocol.ts
```

Initial sandboxed HTTP tests could not bind loopback; the successful run allowed local
loopback listeners. Initial dependency restore failed offline; verification used a local
copy of the already-installed schema-11 release dependency cache. No lockfile or package
manifest changed relative to the task baseline. No release-candidate source was edited.
Earlier expected schema-target/index assertions were updated for 13; their negative
cases and historical migration checks remain. Runtime tests were not rerun because no
Runtime source changed; shared artifact verification passed.

## Preservation and exact files

All pre-existing uncommitted work was inventoried before editing. No baseline files
were removed. The v12 protocol migration and all shared protocol artifacts are unchanged.
Runtime, HVMapp and infrastructure have zero task-relative file changes. Existing dirty
work remains; the current development tree is not an isolated deployment artifact.

Only these Platform files changed relative to the task baseline:

- `artifacts/api-server/src/db/collections.ts`
- `artifacts/api-server/src/db/reasoning-foundation.ts`
- `artifacts/api-server/src/db/setup.ts`
- `artifacts/api-server/src/domain/contact-strategy-registration.ts`
- `artifacts/api-server/src/domain/ids.ts`
- `artifacts/api-server/src/domain/reasoning-crm-links.ts`
- `artifacts/api-server/src/domain/reasoning-foundation.ts`
- `artifacts/api-server/src/domain/reasoning-reference-check.ts`
- `artifacts/api-server/src/services/agent-control-plane.ts`
- `artifacts/api-server/src/services/agent-dispatch.ts`
- `artifacts/api-server/src/services/agent-effectiveness.ts`
- `artifacts/api-server/src/services/agent-execution-readiness.ts`
- `artifacts/api-server/src/services/agent-operators.ts`
- `artifacts/api-server/src/services/agent-proposal-freshness.ts`
- `artifacts/api-server/src/services/hive-definitions.ts`
- `artifacts/api-server/src/services/hvm-context.ts`
- `artifacts/api-server/src/services/hvm-provision.ts`
- `artifacts/api-server/src/services/offers.ts`
- `artifacts/api-server/src/services/operating.ts`
- `artifacts/api-server/test/crm-foundation.test.ts`
- `artifacts/api-server/test/domain.test.ts`
- `artifacts/api-server/test/hive-definitions.test.ts`
- `artifacts/api-server/test/reasoning-foundation.test.ts`
- `docs/reasoning-contact-strategy-foundation.md`
- `docs/reasoning-contact-strategy-verification.md`

Evidence outside repositories:

- `release-reviews/reasoning-v13-foundation/baseline.json`: pre-edit hashes and Git status.
- `release-reviews/reasoning-v13-foundation/verification-inventory.json`: task-relative
  changes/removals and **exact final porcelain Git status for all four repositories**.
- `release-reviews/reasoning-v13-foundation/verification-results.json`: test summary,
  quality results and preservation checks.

## Remaining gates

1. Review/release v12 before v13. No v11 shortcut.
2. Review v13 and run authorized secure preflight and synthetic Mongo validator parity
   before requesting migration/deployment authorization. No installed parity was claimed.
3. Future data writers need existing scoped authorization, trusted attribution,
   CRM-extension reference admission, immutable-write/retention enforcement and applicable
   transaction/authority serialization. There is currently no new production write path.
4. Reasoning intelligence, Contact Strategy execution/activation and global learning
   remain outside this foundation and need separate approved work. Existing PSU gates
   remain in force; nothing in this task resumes PSU.

No AWS access/change, live Mongo access/write, migration application, live registration,
permission/membership change, Agent activation, provider call, deployment, staging,
commit or push occurred.
