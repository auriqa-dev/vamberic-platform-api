# Reasoning and Contact Strategy — unapplied v13 foundation

## Release dependency

This work extends the current development baseline, including **unreleased v12,
Protocol 1.2 / Result 2 and PSU answer provenance**. The release dependency is
**v12 → v13**. The last reported installed dev schema is 11; this task did not
connect to or inspect it. Review/release the existing v12 migration before v13.
This is not an independently releasable schema-11 repair. No alternative migration
path, renumbering or modification of the v12 protocol migration was introduced.

The existing ordered ledger gains `013-reasoning-contact-strategy-foundation`
after `012-answer-provenance-protocol`. Setup now targets 13. Existing feature
schema checks explicitly accept additive successor 13 alongside their previous
versions. Protocol 1.2 execution requires 12 or 13; unknown future versions fail
closed. Nothing is activated by these compatibility checks.

## Reused canonical primitives

- Observations, interactions and measured outcomes reuse append-only **events**.
- Actions reuse **crm_tasks** with existing subject, assignment, status and completion
  rules. Campaign is optional. No separate Action store or dispatch mechanism.
- Accounts are Organisations; Contacts are People with Contact Points. No new
  ownership/membership model.
- Offering, ICP, Buyer and Offer knowledge uses exact immutable revision identity,
  revision number and content hash. Existing parent relationships remain unchanged;
  contexts can reference several independent propositions/campaigns.
- Existing evidence is referenced, not copied. Its digest covers the exact persisted
  document with Dates encoded as ISO and Mongo `_id` excluded, plus an optional
  embedded evidence ID. Hive/Offer embedded evidence lives inside the snapshot.
- The immutable, versioned code-owned Methodology catalogue and exact lookup are
  reused. Availability governance stays separate from content and authority.
- Contact Strategy registration uses existing capabilities and Agent Definitions.
  The Reasoning Engine is a future platform capability, **not an Agent**.

## Canonical contracts and lifecycle

| New collection | Purpose |
|---|---|
| `reasoning_contexts` | Workspace objective; bounded references to Organisations, People, Contact Points, Campaigns, exact knowledge revisions, observations, evidence, methodologies, policies, learning and current-state evidence. No mandatory Offering/Campaign parent. |
| `reasoning_decisions` | Context, candidate actions, selected candidate, explanation, evidence, confidence, priority, constraints/policies, descriptive authority level, source, timestamp/status and supersession. |
| `scoped_learning` | Workspace-owned claim/evidence/confidence/validity/source, limitations, context/decision/outcome lineage and supersession. |
| `contact_strategy_policies` | Immutable key/version policy snapshots with bounded declarative contact, proposition and priority clauses, subjects, evidence and supersession. |

All four require workspace ownership and strict bounded structures. Records are
immutable snapshots (`updatedAt = createdAt`), with `supersedesId` for subsequent
records. Superseding history is found by reverse lookup. Future persistence must
allow inserts only: a Mongo document validator cannot enforce historical immutability.

The lifecycle is **Observation → Context → Decision → Action → Outcome → Learning**:
existing Event → Context → Decision → CRM task with reasoning links → outcome Event
with measurements/units/time period → scoped Learning referencing evidence/history.
There is no outcome calculation, automatic learning, policy update or execution.
Agent Effectiveness evaluation outcomes remain distinct from observed business outcomes.

Learning scopes include workspace, Offering, ICP, Buyer, Contact Strategy, capability
and methodology, always inside a workspace. Global/cross-client learning is rejected.
A separately governed future version can add generalized learning; absence of workspace
is never interpreted as global permission.

Policy clauses can describe pressure, channels, consent, suppression, precedence,
opportunity/customer rules, human review, proposition compatibility/conflict/priority,
sequencing and intent/value/recency/fatigue without encoding those algorithms. There is
no executable policy language or override of existing marketing permissions.

## Authority, model independence and admission

Human Queen remains the accountable human supervisor. Model/provider state, prompts,
embeddings and hidden reasoning are not persisted here. `explanation` is a bounded
business explanation. Specialist Agents remain capability providers.

Recommendation, delegated-decision history and human-escalation values are descriptive.
Delegated history requires evidence but grants no permission. Source attribution is
data, not an authenticated principal; a future writer must derive it from its trusted
server-side actor and independently authorize access.

`checkReasoningReferences` uses a trusted repository resolver to check workspace,
exact revision/type/identity/hash, evidence, policy version and code-owned methodology.
Global catalogue references are checked separately. This helper does not authorize,
persist, execute, select latest revisions or rebase. A future adapter must enforce
existing workspace authorization and transaction/consistency requirements first.

Task/Event parse helpers preserve existing CRM contracts and describe their optional
`reasoning` persistence extension. **Existing CRM mutation schemas reject this field**:
no generic write path is opened for fabricated provenance. Before exposing a writer,
implement authorized CRM reference admission, immutable-history enforcement, retention
checks and applicable authority serialization. These are future workflow gates, not
new permissions granted by this foundation.

No HTTP routes, permissions, grants, Client Agents, activation or schedules are added.
Empress, Queen/Partner, client membership and Agent Operator remain independent.
A Decision, policy, Learning, Effectiveness PASS or capability reference cannot confer
canonical approval, execution, communication authority or unrelated workspace access.
Existing Run/Attempt/fence, proposal, Knowledge Gap and Effectiveness contracts remain.

## Local Contact Strategy registration

`contactStrategyRegistration` creates a **local validated registration proposal**:
one workspace-scoped Capability and a draft/internal `contact_strategy` Agent Definition
referencing it. No execution implementation, Client Agent, read/propose resources or
grants. The helper does not persist, publish or activate. Repeated calls create new
proposal IDs; actual later registration must use the existing authorized catalogue
service with duplicate/version review. No live registration happened.

No Contact Strategy algorithm, Reasoning Engine intelligence, Agent implementation,
model call, orchestration/NBA, UI, training or autonomous communication is implemented.

## Proposed persistence changes

Four new empty collections above, each with:

- `id_unique`: `{ id: 1 }`, unique;
- `workspace_created`: `{ workspaceId: 1, createdAt: -1, id: 1 }`.

Policies also have `workspace_key_version_unique`:
`{ workspaceId: 1, key: 1, version: 1 }`, unique. Total **nine new indexes**.

Six validator applications: the four new collections, `crm_tasks`, and `events`.
The exact v12 task validator is the accepted predecessor; unknown/weak validators or
incompatible data fail preflight. Events previously had no canonical Mongo validator;
the additive validator preserves legacy Events without reasoning. There is no backfill,
rewrite, seed or default registration. Structural validation reuses the existing
fail-closed Zod-to-Mongo compiler. Cross-document/semantic checks remain explicit
admission obligations and must not be confused with structural Mongo validation.

The normal ordered setup ledger remains intact. The qualified upgrade is v12 → v13;
do not use setup to bypass the v12 release review. Protocol migration definitions and
all 120 shared artifacts remain byte-for-byte unchanged.

## Release gates

See the companion verification report. Installed-validator parity is **not claimed**:
no database was accessed. Before release: review v12, review v13, secure read-only
preflight and synthetic Mongo validator parity, then explicit migration/deployment
authorization. Foundation data must not be written through future adapters until the
admission and immutability requirements above are implemented and tested.

PSU was not resumed. Existing PSU/provider authorization gates remain independent.
Reasoning intelligence, Contact Strategy execution and generalized learning require
separate approved designs and implementation scopes.
