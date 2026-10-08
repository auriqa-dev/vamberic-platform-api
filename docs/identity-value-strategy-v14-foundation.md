# Identity, relationship value and Contact Strategy objectives — unapplied v14

## Scope and release dependency

Local data foundation only, dated 2026-10-04. No live records or migrations.
Required release dependency: **schema 11 → v12 → v13 → v14**. V12's unreleased
Protocol 1.2 / Result 2 and PSU provenance remain prerequisites. V13 is frozen:
its contracts, migration module, original foundation tests, documentation and
verification baseline are preserved. New v14 modules import and extend the
existing contracts rather than editing them. Shared current-target registration,
version guards and setup-test expectations advance to 14.

The next migration is `014-identity-relationship-value-strategy`. It is unapplied.
The qualified migration test starts at v13, preserves the ledger through 13 and
appends 14 exactly once. There is no separate schema-11 release path. Release v12,
then the reviewed v13, then v14; do not use the development head to bypass those
reviews. No live installed-schema state was inspected during this task.

## Architecture reviewed and reused

The review covered v13 Context, Decision, Learning, Contact Strategy and reference
admission; canonical setup/preflight/predecessor/index conventions; Events and
CRM Tasks; People, Organisations and Contact Points; Organisation/Product
relationships; Campaigns and opportunities; marketing permissions and contact
suppression; HVM application/workspace authorization; canonical knowledge revisions,
evidence, the immutable Methodology catalogue and separate availability governance.

Existing primitives already represent:

- append-only Events with optional Person, session/external references and interactions;
- current CRM tasks/actions, with completion distinct from evidence an action occurred;
- account-level opportunities, estimated money/probability, buying-role People and
  commercial priority; these are not lifetime relationship value;
- Organisation lifecycle/customer type, Person lifecycle and organisation relationships;
- exact-scoped historical marketing permissions and contact-point suppression;
- authenticated human principals derived from issuer/subject, independently of domain
  contact identity; workload identity and Partner membership are also separate.

None is a canonical anonymous interaction identity or multidimensional relationship
assessment. Three new collections fill those gaps. No duplicate Account, Contact,
Event, Campaign, Action, Context, Decision, Learning or strategy-policy store is added.
Existing permission is not a tracking or history-linking authorization by implication.

## Identity and resolution

`interaction_identities` is workspace-owned and does not have a Person field. It can
remain unresolved indefinitely as a domain state, subject to future retention policy.
Extensible `kind`, `namespace` and optional channel keys support anonymous, browser/session,
communication-recipient, contact-derived, authenticated and channel-derived identities.
Evidence references locate channel facts in existing canonical history.

An optional communication context references a CRM task and/or Event plus the intended
Person and/or Contact Point. It does not contain public URLs, tokens, credentials,
cookies or duplicate contact data. Future opaque-link adapters must map their opaque
public token to this private context without exposing PII. No token generation,
redirect, browser tracking, advertising integration or transport is implemented.

`identity_resolutions` holds immutable assertions with identity, optional Person,
status (`unresolved`, `resolved`, `revoked`), extensible method, deterministic or
non-deterministic basis, confidence, evidence, source, validity and supersession.
Resolved/revoked assertions require Person and evidence; unresolved assertions cannot
supply a Person or a known basis. Revocation references a prior assertion and retains
its identity, relationship type and Person. Corrections append new assertions, with
evidence; no identity merge or matching algorithm is provided. A non-deterministic
basis is representable historical data, not an implemented inference capability.

`relationship` distinguishes **observed person** from **intended recipient**. A link
assigned to Sarah identifies a communication context; it does not prove Sarah was the
clicker. Intended-recipient evidence cannot be used to assert an observed Person on
an Event. Authenticated-kind metadata is also not an authenticated Platform principal.

## Anonymous → known continuity

Events gain an optional `identityObservation` extension containing the interaction
identity, `knowledgeAtEvent` and an exact resolution ID only when already recorded.
The original Event schema/service and v13 reasoning extension remain unchanged.
The v14 parser delegates to the existing Event contract; the generic CRM mutation API
rejects this new field until a separately authorized ingestion/admission workflow exists.

- T1: an Event points to Identity A with `knowledgeAtEvent: unresolved`, no Person.
- T2: a new resolution assertion links A to a Person with evidence and validity.
- T3: a Context can reference both the unchanged T1 Event and the exact T2 assertion.

The test explicitly preserves the T1 object byte-for-byte in memory. The event-admission
helper rejects future, expired, revoked, foreign-workspace or mismatched resolution
references. No retrieval/join service or destructive Person backfill is implemented.
Future journey consumers must evaluate current authorization, privacy, validity,
revocation/supersession and evidence; they must display what was known at each time.

Privacy context records purpose, exact permission references, evidence and history-use
restriction: not assessed, prohibited, or requiring current authorization. There is no
`allowed` grant. These records do not decide lawful basis or override suppression,
consent, workspace access or retention. Unknown is preferable to incorrect identity.

## Relationship value

`relationship_value_assessments` is an immutable, versioned assessment series scoped to
workspace and a declared economic subject: Organisation, Person or overall workspace
relationship. Organisation is first-class; fourteen influencing People remain attached
to one account assessment, rather than becoming fourteen economic relationships.
A Person may be the economic subject where appropriate, but cannot simultaneously be
an Organisation subject. Exact Offering revisions optionally scope proposition value.

Extensible dimensions carry a statement, optional measurement/unit/currency, confidence,
evidence and assumptions. Their basis explicitly distinguishes **known value**, **estimated
potential**, **strategic priority** and **assumption**. Evidence is required except for
an explicitly documented assumption. No mutable magic score, LTV calculation, propensity
or scoring algorithm is added. Existing Opportunity and Organisation financial fields
remain authoritative for their own facts.

Assessments reference exact Methodology versions, validity periods, source and prior
assessment. Supersession preserves the economic subject and assessment key and increases
version. Each account can use the same key/version independently. No update writer is
introduced: future persistence must enforce append-only history and reference consistency.

## Contact Strategy objectives and priorities

`ContactStrategyPolicyV14Schema` extends the **same** `contact_strategy_policies` records
and IDs through optional `strategy`; existing v13 clauses are reused. V13 records remain
valid. The extension contains:

- extensible objective keys, descriptions and evidence;
- directed higher/lower precedence references to objectives or existing policy clauses,
  with rationale and effective periods;
- exact Offering revision references, optional numeric priority annotations, extensible
  proposition relationships (compatibility, conflict, cross-sell, entry/subsequent, etc.)
  and effective periods for temporary priorities.

Precedence validates existing endpoints, rejects self-links/cycles and enforces bounded
size. This is graph integrity, not priority evaluation; cycles are rejected even across
disjoint effective periods. Numeric priority is descriptive input; no scoring or conflict
resolution algorithm consumes it. Existing clauses express contact pressure, channels,
recent/human sales contact, active opportunities, customer status, suppression, human
precedence, mandatory escalation and no-action conditions. None authorizes a deviation
from consent, suppression or human authority.

## Reasoning Context integration and decision-time evidence

`ReasoningContextV14Schema` extends **reasoning_contexts**, retaining its ID and all v13
fields. Optional `inputs` references identity/resolution records, relationship values,
Organisations/People/relationships, tasks/opportunities/Campaigns and exact policy-version
objective keys. It does not copy those records into Context. Objective references must
belong to a policy/version already referenced by that Context.

New state references pin the exact persisted-record digest using v13's canonical evidence
digest convention. Changed records fail closed: no latest substitution. Mutable tasks,
opportunities or relationship records are not magically historical snapshots; if they
have changed, historical reconstruction needs retained canonical Event evidence. The
foundation does not fabricate or promise a new snapshot store.

Decision, Learning and Contact Strategy Agent registration remain the frozen v13 concepts.
A v13 Decision references the same Context ID and records its candidates/explanation;
no second decision concept is introduced. New admission helpers preserve the v13 checks
and additionally verify workspace, exact state digests, identity linkage, objective
versions, supersession and event-time knowledge. They are not authorization services.

## Authority and scope boundaries

Human Queen remains human. The Reasoning Engine remains a platform capability, not an
Agent. Contact Strategy remains a specialist policy capability, not a communication
executor. Identity Resolution is platform/domain data, not a Channel/Interaction Agent's
private identity system. NBA and Inbound Interaction remain future capabilities.

No new HTTP endpoint, ingestion writer, workspace permission, membership, execution grant,
activation, Agent implementation or scheduler is added. Declared source, confidence,
policy, identity, value, priority and Effectiveness PASS confer no execution or canonical
approval authority. Model/provider state and hidden reasoning are absent. No cross-client
learning, provider call, real PSU run or campaign execution occurred.

## Migration proposal

New collections and application indexes:

| Collection                       | Indexes                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------ |
| `interaction_identities`         | `id_unique`; `workspace_created`                                                           |
| `identity_resolutions`           | `id_unique`; `workspace_created`; `workspace_identity_history`; `workspace_person_history` |
| `relationship_value_assessments` | `id_unique`; `workspace_created`; `workspace_subject_key_version_unique`                   |
| Existing `events`                | new partial `workspace_identity_occurred`                                                  |

Total: **three new collections, ten indexes**. Identity history supports future bounded,
workspace-scoped lookup without rewriting Events. Exact definitions are code-owned in
`src/db/identity-value-v14.ts`; value uniqueness includes workspace, subject kind, subject
Organisation/Person IDs, assessment key and version.

Six validator applications: the three new collections, `reasoning_contexts`,
`contact_strategy_policies`, and `events`. V14 recognizes only exact strict/error v13
predecessors for amended validators; unknown/weakened validators or incompatible records
block preflight. Existing document validation and original Event constraints are retained.
V13 validator/index fingerprints are regression-tested. No seed, backfill or live write.

Structural Mongo validation is not a substitute for semantic/reference admission or
append-only write enforcement. Before a production writer exists it must use the full
parse/reference checks plus independently authorized transactions/consistency, retention,
privacy and concurrency controls. Direct privileged Mongo access is not tenant isolation.

## Synthetic compatibility scenario and release gates

Local fixtures cover a fictional manufacturing-account efficiency opportunity, account
potential with evidence, a relevant Person, acquisition/protection objectives, intended
communication identity, unresolved Event, later resolution and a Context combining exact
identity/value/activity/policy references. Campaign is optional. Separate tests cover
canonical proposition priorities, no-action/human review representation and unchanged
v13 Decision semantics. No Built Matters-specific record or campaign is created.

Remaining gates: release v12 then v13; review v14; authorized secure preflight and actual
Mongo synthetic validator parity; explicit migration/deployment authorization. Future
matching, tracking, join/privacy decisions, scoring, NBA, execution and writable workflows
require separate approved work. This foundation alone is not campaign-execution readiness.
See the companion verification report for exact results and task-relative Git inventory.
