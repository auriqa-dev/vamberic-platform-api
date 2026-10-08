# Agent Effectiveness — Workstream 4A.4

Implemented locally on 2026-10-01 against the authoritative [Effectiveness architecture](../../vamberic-agent-runtime/docs/effectiveness-protocol-architecture.md). This is a foundation for reviewed Agent implementations. No production Agent, Learning system, live AWS activation or database migration was performed.

## Execution and authority

A reviewed server `EffectivenessProfile` binds an implementation manifest to three distinct operations: maker, evaluator and revision. Published Agent Definition metadata pins the required profile and policy. Registration alone is insufficient: existing readiness, current definition, Client Agent revision, original requester and explicit operation permissions remain required. Removing case metadata cannot bypass a code-owned required profile. Production composition has an empty profile registry.

Case acceptance derives criteria through trusted preparation and merges the reviewed mandatory floor. Lower layers may add constraints or strengthen advisory criteria; they cannot remove mandatory criteria or change their meaning under an existing identity. The resulting set is sorted, versioned, hashed and frozen. Client prose is input data, never an executable policy or source of authority.

Every execution is an ordinary persisted Run with its own Attempt, fence, grant, deadline and usage. Case transitions create a new Run and its existing dispatch intent in the same database transaction as the accepted Result and case update. Neither SQS nor providers are called inside that transaction. Each role requires its explicit existing operation permission. The original requester is retained; neither a Queen request nor a maker grant delegates evaluator/revision authority.

The 4A.3 workload class, process/session worker identity, claim binding, lease controller, receipts, worker and infrastructure remain in place. Case ownership does not replace workloadClientId + workerId + Attempt + fence checks. Case CAS writes serialize control changes with claim, heartbeat, outcome and consequential use. Current authority anchors continue to serialize membership, Partner chain, definition, target and execution-policy changes.

## Persistence and limits

`agent_effectiveness_cases` is the only new collection. A case stores workspace/requester/authority/target pins; original request identity; immutable criteria and policy snapshots; total budget/deadline; allocations; Candidate/Evaluation references; deterministic decisions; bounded Queen dispositions; active Run and state revision. A new frozen case may explicitly link its predecessor case and prior candidate/criteria digests.

Bounds are three candidates, eight evaluation requests, eight human dispositions, eleven allocated Runs, sixteen decisions, and 192 KiB canonical JSON. At most two revision Runs can be allocated, including revision Runs that fail technically. A case's immutable deadline bounds every child deadline and grant expiry. Per-Run monetary, model, tool and provider ceilings are allocated without recycling unused or unknown spend. Exhaustion cannot silently create more budget.

Candidates select one accepted Result's domain output or proposal candidate and pin its Run, Attempt, Result, envelope digest and selected-content digest. Artifact selectors fail closed until a reviewed artifact reader exists. Revisions record predecessor content digest, triggering evaluation and requested defect identifiers. These links do not assert that a defect was fixed: the next independent evaluation determines that.

Evaluations live in immutable Result envelopes. Case state references them; it never edits their observations. Technical rejection/failure, partial completion and Knowledge Gaps cannot fabricate a Candidate, Evaluation or provenance. Completed partial maker work is retained as a Result with the case held.

## Contracts and decisions

Runtime exports independently versioned CriteriaSet, CandidateRef, EvaluationInput and EvaluationPayload contracts and JSON Schema artifacts. Protocol remains **1.1**, Result schema remains **2**. The Platform handoff contains 89 byte-identical source/build/schema/fixture artifacts, checked by `vamberic-agent-runtime/scripts/verify-platform-protocol.ts`.

Criteria cover validity, effectiveness and brand, with exact methods, applicability rules, consequences and evidence requirements. Evaluation validation checks exact candidate/criteria/policy/request/instruction pins, complete unique criterion coverage, permitted N/A decisions, deterministic versus model provenance, actual evaluator model invocation IDs, same-Result support references and Knowledge Gaps. Evaluators cannot submit proposals or an overall approval/decision field. The Runtime helper runs through the ordinary executor; same-model evaluation remains a separate invocation with separate input/instructions and usage.

Platform computes PASS/REVISE/HOLD/ESCALATE deterministically from validated assessments and reviewed policy. Mandatory uncertainty is never PASS. Blocking gaps hold; consequential uncertainty and policy-directed failures escalate. Remediable failure can allocate a bounded revision. Repeated candidate content, repeated normalized defect sets and exhausted revisions stop automatic cycling. A failed technical evaluation never counts as a negative quality assessment.

Historical evidence may be imported only by a declared mapping to an exact, currently authorized Result projection. Its original observation bytes, provider/invocation identity, source and verification state remain unchanged except for the evaluator's local evidence ID. The projection must explicitly include evidence. Imports create neither provider grants nor new usage. Fixed projection fields are domainOutput, findings, evidence, knowledgeGaps, proposals and lineage; there is no generic collection lookup or unrestricted context API.

Current source hashes/revisions, profile/policy availability and source permissions are rechecked. Changed context or criteria requires newly frozen work in an explicitly linked case; historical evaluations remain readable. PASS is separate from proposal application, canonical approval and execution authority. Proposal application requires the existing human target authority plus current Effectiveness eligibility. Canonical approval retains source-freshness checks at both v10 and v11, and rechecks the linked case and published policy after draft application. A Queen hold cannot race through the case CAS guard.

## Human API

All paths below are mounted under the existing authenticated HVM human boundary. Workload tokens cannot review cases; bodies cannot supply authority, criteria, policy, grants or decisions.

| Method | Path                                                 | Purpose                                                                                            |
| ------ | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| POST   | `/workspaces/:workspaceId/agent-effectiveness-cases` | Authorized root creation; stable request key; optional predecessor case                            |
| GET    | `/workspaces/:workspaceId/agent-effectiveness-cases` | Scoped bounded list; status filter and cursor                                                      |
| GET    | `/agent-effectiveness-cases/:caseId`                 | Authorized case and current freshness                                                              |
| POST   | `/agent-effectiveness-cases/:caseId/re-evaluate`     | Explicit evaluator Run after checking expected revision, authority, freshness and remaining budget |
| POST   | `/agent-effectiveness-cases/:caseId/revise`          | Explicit revision against recorded defects under the same controls                                 |
| POST   | `/agent-effectiveness-cases/:caseId/review`          | Assigned Queen hold or close, with reason and immutable disposition pins                           |
| POST   | `/agent-effectiveness-cases/:caseId/cancel`          | Atomic closure and child cancellation                                                              |

Manual effectiveness overrides are disabled in contracts and policy. Client Agent Operators cannot act as Queens. Closed cases cannot reopen. Review and execution requests use stable idempotency keys; changed input conflicts. Case lists use the proposed scoped time/ID indexes with a 100-record cap and query time limit. Mutable exception queues should be refreshed between pagination sessions.

## Proposed v11 migration — NOT APPLIED

Migration identifier: `011-agent-effectiveness`. Fresh schema definitions now describe 51 collections and 164 indexes. The exact v10→v11 plan adds one empty collection, seven indexes and six validator applications: cases, Runs, Results, Agent Definitions, Pricing Recommendations and Swarm Agreements. The last two retain strict metadata validation in nested immutable definition snapshots. No Result or business-data backfill occurs. Attempts and Usage retain their existing schemas.

The seven indexes are five scoped case identity/list/lineage indexes, one partial unique Run case/transition index, and one Run status/ID index. The dispatcher uses the nonterminal status/ID query only at v11 and retains the bounded v10 fallback. No dispatcher or worker is activated by these code changes.

V10 Run/Result schemas and operating-validator variants remain separately frozen. The setup planner accepts only exact recognized strict/error predecessors, preflights existing records and uniqueness, refuses unknown/weakened validators, and supports interruption/retry. All existing version gates were audited, including HVM provisioning and canonical Agent-proposal freshness. Effectiveness writes require v11; ordinary compatible functionality still supports v10.

Mongo enforces structural/text/byte/count/date/identity/lineage constraints, revision and role limits, local case/decision consistency, and conditional tagged Evaluation structure. Cryptographic digest recomputation, cross-record Result equality, criteria assembly, current authorization, model invocation attribution, provider scope, budget allocation and deterministic policy remain service checks. These cannot be inferred from document shape or Mongo JSON Schema. Source parity was verified with synthetic `$documents` expressions in local Mongo; no business collection or migration was applied. Installed production validators, execution plans and deployment ordering remain release gates.

See the [full verification report](../../vamberic-agent-runtime/docs/workstream-4a4-verification.md) and [exact Git inventory](../../vamberic-agent-runtime/docs/workstream-4a4-git-status.txt).
