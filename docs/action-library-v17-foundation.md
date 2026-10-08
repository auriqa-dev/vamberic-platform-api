# Action Library — unapplied v17 foundation

The Action Library describes independent possibilities. It does not choose an action, execute it, or confer authority. Content Strategy retains its name. NBA, UI, workflow chains, journeys, sequences, event management, ingestion and Agent activation are out of scope.

## Canonical model

- `action_types`: global versioned catalogue, exact key/version/content hash, draft/active/retired lifecycle and separate internal/queens/experimental availability. No final taxonomy is seeded. Published semantic content requires a new version.
- `action_definitions`: workspace-owned draft/approved/retired definitions, human audit and approval metadata, exact Action Type reference, bounded purpose, constraints and optional resources/executor/channel context. Approved content is immutable; reopen an exact successor draft before editing.
- `action_definition_revisions`: exact approved snapshots, unique workspace/definition/revision. Future writers must enforce insert-only persistence; a pure comparison helper is not a database immutability guarantee.
- Reasoning Decision candidates and CRM task reasoning links can optionally reference an exact approved Action snapshot. A linked task must match the selected candidate's exact reference. Existing records without Action links remain valid; Campaign remains optional.

Resources can reference canonical Offer/Offering/ICP/Buyer revisions, existing evidence, or a bounded external asset/experience descriptor. Knowledge is referenced, never duplicated. External descriptors do not retrieve anything; URL locators exclude credentials, query strings and fragments. Resources and executors are optional, so wait, no action, suppression, research and human escalation do not require outbound activity.

Dates and bounded text describe availability, registration deadlines, prerequisites, eligibility and approval requirements. They are declarative data, not an executable expression language or an eligibility engine. Historical approved references do not imply current availability.

## Integrity and authority

Pure reference admission verifies workspace identity, exact revision/hash, approved knowledge snapshots, evidence digests, global Action Type identity and optional Agent Definition version. Capabilities reuse the existing global unversioned registry; the Action Library does not invent versioned capability content. No latest-version substitution occurs.

Mongo checks structure and retains predecessor validator predicates. Application checks add hash correctness, chronology, lifecycle transitions, snapshot equality, duplicate detection, byte bounds and resolved-reference semantics. Neither structural acceptance nor these pure helpers authorizes a mutation or execution. Later writers must call the checks inside the existing authorization/serialization architecture and enforce concurrency and snapshot immutability transactionally.

Proposed authority mapping for later review, **not implemented or granted**: platform catalogue governance through the existing platform authority boundary; workspace authoring/approval through explicit resource-scoped Queen/authorized human policy. Client membership, Agent Operator access, Empress authority, a referenced capability or an approval-requirement string supplies no implicit permission. Empress remains independent of workspace access. Future execution still requires the existing integration permissions, budgets and execution grants.

## Migration boundary

Ordered dependency: **11 → 12 → 13 → 14 → 15 → 16 → 17**. Migration `017-action-library-foundation` is unapplied. No alternative path, backfill, live records or business-data rewrite is introduced. Targets 12–16 remain byte-for-byte equal to their captured pre-change compiled definitions; v16 is frozen in `frozen-v16-target.json`.

Three collections and seven indexes:

- `action_types.id_unique`
- `action_types.key_version_unique`
- `action_types.status_availability`
- `action_definitions.id_unique`
- `action_definitions.workspace_status`
- `action_definition_revisions.id_unique`
- `action_definition_revisions.workspace_definition_revision_unique`

Five validator applications: the three new collections, `reasoning_decisions`, and `crm_tasks`. The latter two retain predecessor predicates and add only optional exact Action links. Latest target totals: 64 collections, 206 indexes.

The built commands are tested against synthetic storage, including ordered upgrades, repeat planning, interruption recovery, conflict refusal and data preservation. Native Mongo `$documents` parity cases are prepared but have not been run. Native checks need separate authorization; no credentials were read.

Existing serving schema guards, including HVM context, still stop at 16. This foundation does **not** qualify the serving API for schema 17. Review and verify service compatibility before any migration or deployment. No login, Empress, Queen or Client behavior was changed.

## Verification

See `release-reviews/action-library-v17/REVIEW.md` in the shared workspace for exact results, history, changes and release gates. PSU execution and its independent release gates remain untouched.
