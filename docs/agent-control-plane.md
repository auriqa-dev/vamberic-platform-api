# Agent control plane — Workstream 4A.2

1 October 2026. **PASS — PLATFORM CONTROL PLANE READY TO MIGRATE.**

The final completion section below supersedes historical checkpoints. Schema v10
remains unapplied. See the [final verification report](investigations/agent-control-plane-pre-migration-verification.md#final-completion--1-october-2026).
Configure = Queen. Operate = Queen or explicit client Agent Operation Grant.
Apply = independently authorized target edit plus Result access. Approve = existing
canonical approval. The approval supersedes the earlier retained-client-history
and requester-rejection proposals. Migration readiness requires completed verification.
Existing uncommitted Platform work is preserved.

## Implementation status

The approved operator contracts, central policy, grant management/discovery
services and routes, protocol handoff, application execution schemas and a tested
transactional lifecycle core are present. This is still an incomplete workstream.
The lifecycle core has no production Run/workload route composition; readiness,
proposal application/evidence/approval freshness, canonical migration registration
and complete Mongo parity verification remain outstanding. Canonical setup stays
at v9. See [verification evidence](investigations/agent-control-plane-pre-migration-verification.md).
No live database verification or modification has occurred in this implementation
checkpoint. Do not migrate or deploy this unfinished control-plane work.

## Existing boundary and authorization decision

Platform owns canonical data, humans, configuration, grants, Run/Attempt state,
dispatch, accepted outcomes, usage, human proposal application and approval.
Runtime protocol 1.1 describes one bounded execution Attempt and never grants
Mongo access or canonical mutation rights. Workload services must use a distinct
trusted principal; normal HTTP composition must remain closed until 4A.3 supplies
real workload authentication. No header, environment-mode or human-token bypass
is acceptable.

Current central policy has two different authority bases:

| Existing permission | Direct client admin | Partner owner (Partner-basis admin) |
| --- | --- | --- |
| Update Offering draft | yes | yes |
| Read Client Agents | no | yes |
| Update Client Agents | no | yes |
| Read Client Swarms | no | yes |

These results were verified by invoking the actual central policy with synthetic
server-issued contexts, not by inferring permissions from frontend labels.
`hvm-context.ts` preserves `basis: client` versus `basis: partner`; an effective
`admin` role alone does not distinguish them.

The initial Queen-only versus automatic-client-admin choice is superseded by the
user's revised decision of 1 October 2026. A selected client user must be able to
operate a configured Agent/Swarm without becoming Queen. Neither membership role
nor purchase is sufficient on its own. The following is the approved design; implementation/verification status is tracked separately.

## Approved Agent Operator model

### Existing structures and alternatives

`workspace_memberships` already identifies a human by trusted issuer/subject in
one workspace, with `admin|member`, `active|ended`, lifecycle timestamps and a
unique active workspace/human index. Client `member` becomes policy `viewer`;
client `admin` becomes policy `admin`. Partner `owner|member` memberships plus
active Partner assignments independently become Partner-basis `admin|onboarder`.
HVM context preserves these bases, and separately exposes `platform.empress`.

Client Agents pin a definition and have configuration/bindings/dependencies plus
revision and draft/configured/retired lifecycle. Client Swarms have a revision,
configured lifecycle and explicit Agent instance IDs. Neither contains a human
operator ACL. Current member-provision/revoke APIs manage workspace membership;
client admins can manage that membership, so that permission must NOT become
operator-grant management implicitly. There is no existing human-level execution
entitlement to reuse safely. Commercial entitlements describe commercial access,
not which human can spend operational budget or which Run they can control.

| Option | Assessment |
| --- | --- |
| A. New workspace operator role or admin-derived execution | Too broad alone; loses target/operation bounds and makes unrelated configured Agents executable |
| B. Explicit assignments to each Agent/Swarm | Correct scope; embedding per-human ACLs in Agent/Swarm config would couple access changes to configuration revisions and commercial snapshots |
| C. Workspace commercial/operation entitlement | Useful future availability ceiling, but cannot identify selected humans; purchase must not grant every member execution |
| D. Membership plus bounded target assignments | Recommended: reuse human/workspace membership and add explicit grants to exact target revisions/operations; keep commercial/execution policy as separate ceilings |

Queen-only execution cannot support a self-operating client. Making every client
admin an unrestricted operator would also miss selected ordinary client members
and blur administration with spend authority. Recommend D: Agent Operator is a
resolved capability, not a new membership role or a replacement for Queen.

### Persistence: bounded grants on workspace membership

Extend the existing WorkspaceMembership contract with optional
`agentOperationGrants`. Missing or empty means no delegated operation permission.
Existing `admin|member` role/status fields retain their meanings. An active admin
or member can receive a grant; neither receives one automatically.

Proposed exact embedded shape:

```ts
agentOperationGrants?: Array<{
  id: string; // server-issued agentoperatorgrant_<ULID>
  target: { kind: "client_agent" | "client_swarm"; id: string; revision: number };
  operations: string[]; // explicit registered operation keys; no wildcard
  grantedAt: Date;
  grantedBy: { type: "human"; issuer: string; id: string };
  expiresAt?: Date;
}>;
```

Bounds: at most 40 entries per membership, 1–20 unique operation keys per entry,
keys matching existing `^[a-z][a-z0-9_]{0,63}$` convention, positive safe-integer
revision, strict discriminated ID prefixes (`clientagent`/`clientswarm`), canonical
human identity and Date timestamps. Grant time cannot exceed membership updatedAt;
expiry, if supplied, must be after grant time. Unique grant IDs and one entry per
(kind,target ID); replacing access issues a new grant ID. Bound the optional grant
array's serialized representation to 64 KiB. Do not impose a new whole-document
limit on legacy records without compatibility analysis.

Only current assignments are embedded. Revoke removes an entry; replacement or
regrant produces a new ID. Existing Events retain before/after scope and human
attribution so history does not grow the membership document. Run stores the
resolved authorization basis and, for client operators, exact membership ID and
grant ID. Regrant must not silently revive a Run cancelled under an old grant.
Grant expiry is computed on server time, not a TTL deletion. No new collection
is justified at these bounds; exceeding them should produce an explicit limit
error, not silently broaden scope.

The target revision pin prevents permission to use Swarm revision N from silently
covering new Agents/configuration in revision N+1. Agent reconfiguration likewise
requires Queen to reaffirm operator scope for the new revision. Old Runs retain
frozen inputs/history; current grant/revision mismatch stops further execution
under the conservative initial reauthorization rule. No automatic rebase.

Grants belong to the workspace membership, not the granting human's personal
account. Departure of the grantor alone does not delete delegated permissions;
current assigned Queen can revoke them. Ending the recipient membership,
revoking/replacing its grant, expiry, target retirement/revision mismatch or
execution-policy revocation invalidates operation. A newly provisioned membership
for the same human does not inherit grants from an ended membership.

### Who may grant and revoke

Introduce a dedicated workspace-scoped policy resource
`agent_operator_assignments`, action `manage`, requiring current **Partner-basis**
authority for that workspace (owner/admin or member/onboarder, consistent with
current Queen configuration authority). Direct client admin membership management
is insufficient. Empress-only authority is insufficient. A combined actor may
act through independently valid Partner authority.

Queen may assign only active client memberships in the assigned active workspace,
only existing configured Agent/Swarm targets in the same workspace, and only
registered/supported operations available under server execution policy. Validate
current target revision and prevent unreviewed operation keys. Grant/revoke must
serialize with existing workspace/membership writes, require expectedUpdatedAt,
recheck authority and target references transactionally, and audit actor/time/
scope. No endpoint accepts grantedBy, grant time, grant ID or caller-issued grants.

The existing `member-provision` body remains strict and cannot accept grants.
Its idempotent same-member path must preserve existing grants; revocation ends
membership and makes every grant ineffective immediately. Client admins cannot
use general membership operations to self-grant, copy another member's grants,
change the assigned human, or reactivate ended access. They may still revoke
membership under existing rules, thereby reducing access.

### Four independent authorization decisions

| Boundary | Proposed authority |
| --- | --- |
| Configure Agent/Swarm, bindings and commercial arrangement | Existing Partner/Queen policy, unchanged |
| Operate Agent | Active assigned Queen with relevant authority OR active client membership with exact matching Agent grant; both require readiness, server execution policy, provider/budget and source-read authorization |
| Apply output to a draft | Access to the Result plus current canonical target draft/create/update authority, parent/source scope, freshness and handler validation; operator capability alone is never sufficient |
| Approve canonical change | Existing Hive/Offer approval authority and freshness checks, unchanged; operator capability confers none |

Operation permission also cannot expand source-data access. Grant derivation is
an intersection with the actual requester's existing read authority and exact
approved projections. If an operation needs data the client cannot read under
existing policy, creation fails closed; purchasing a Swarm does not solve that
by broadening access. No additional Hive access grants are proposed here.

For the initial Run visibility/control policy, a delegated client operator may
request allowed work and read/respond/cancel **their own** Runs only. Other
clients' Runs are not implied by sharing a target. Client reads, responses and cancellation require the original active membership
and grant as well as own-Run identity. Revocation/expiry removes client access;
being the original requester does not preserve access. Queen retains scoped
historical access.
No new blanket all-Run visibility is inferred from `member` or `admin`.
Queen may read/control Runs in assigned workspaces under current scope plus the
new Run policy. Execution rechecks the original requester's authority even if
another authorized Queen answers input. Shared team Run management is deferred,
not represented by a catch-all flag.

Applying a proposal created by somebody else requires separately authorized
Result access and target edit permission; this design does not share it with
all target editors. Queen and client may consequently be different request,
application and approval actors, with separate audit attribution. Rejecting a
pending proposal is restricted to scoped Queen review;
it does not authorize editing/approving the target or another person's Run.

Recheck requester/operator scope at create, claim, heartbeat, sensitive context,
outcome and input resume. Revocation cancels remaining execution without deleting
history; cancellation races, lost membership and old grant IDs must be tested.
Trusted workload principal plus persisted Run grant remains separate from human
operator access. Browser context is discovery only, never a grant.

### Swarm operation without configuration authority

A `client_swarm` grant permits only that Swarm revision and its registered job
operations. Lead Generation remains a Swarm. It grants neither configuration
rights nor direct arbitrary execution of every constituent Agent.

In 4A.2, direct Agent Run creation still requires an Agent grant (or scoped Queen
authority), even if the caller includes optional clientSwarmId. A Swarm-only
grant does not bypass that check. The grant model can store a Swarm assignment,
but no Swarm execution endpoint or fake job is added until reviewed orchestration
exists. Initially only direct Agent grants are executable; unknown/unavailable
Swarm job keys cannot be granted as executable capabilities.

Future orchestration resolves the exact approved Swarm grant/revision, then derives
child Agent Run authority server-side from the pinned Swarm membership, permitted
job-to-operation mapping, requester scope and policy/budget intersection. Browser
requests cannot choose arbitrary child Agents or mark a Run as orchestrated. This
adds a separate origin/provenance check at that time, without granting the client
Queen configuration authority or requiring a new workspace role.

### Proposed API/context changes (not implemented)

Under `/api/v1/hvm/workspaces/:workspaceId`:

- `POST /member-agent-operation-grant`:
  `{membershipId, expectedUpdatedAt, target:{kind,id,revision}, operations, expiresAt?}`.
  Server creates/replaces the target entry and returns `{membershipId, grantId,
  updatedAt}`. ISO dates on HTTP. Replacement is explicit and uses the membership
  concurrency token, not last-write-wins.
- `POST /member-agent-operation-revoke`:
  `{membershipId, grantId, expectedUpdatedAt}`; response `{membershipId, updatedAt}`.
- `GET /members/:membershipId/agent-operation-grants`: Queen-management view of
  this bounded array plus membership ID/updatedAt; no workspace-wide user dump.
- `GET /agent-operation-context`: self-only server-resolved usable target/operation
  summaries with target ID, safe display name, revision, authority basis and
  readiness. Bounded `limit` 1–100/default 20, `offset` 0–10000/default 0 with
  `{items,hasMore,limit,offset}`. No bindings/configuration, raw grants or other
  users' assignments. Queen discovery uses configured workspace targets;
  client discovery uses only the current human's explicit grants.

These follow the existing flat membership mutation convention. Invalid inputs
return 400, unavailable/unauthorized scope 404, stale tokens/invalid target state
409; expired or missing grants never authorize. Full strict DTOs and tests are
implementation work under the approval. Existing `/hvm/context` roles, memberships,
workspace effective roles and `platform.empress` stay unchanged; the separate
operation-context projection avoids embedding large rosters or false permanent
execution booleans in that response.

Planned Run endpoints use the central Run policy plus exact target/operation/
requester checks. Do not widen `client_agents` or `client_swarms` policy to make
operator discovery work. Query/body IDs, headers or claimed roles cannot override
server membership resolution. No workload HTTP becomes enabled by this design.

### Migration delta and implementation touchpoints

Four new execution collections remain proposed. The operator design additionally
extends **one existing collection**, `workspace_memberships`, with optional grants
and updates its Zod/Mongo validator together. No role enum change, backfill, fake
grants, entitlement record or fifth collection. No extra index is proposed:
existing active-human/workspace and ID indexes locate the one bounded membership
needed for access and mutation. In-document duplicate/size checks belong in the
validator; cross-collection target/current authority checks belong in services.

The planned migration shape is therefore four new control-plane collections,
the already-planned Agent Definition implementation-reference work (including
necessary snapshot-validator review), **plus the membership validator extension**.
Exact total validators/indexes and next migration number remain to be established
from source and secure dry-run during implementation. Source is still v9; no
migration is created by this design. Missing grants deny on old schema; Run
features must fail closed until the new schema is applied, while old HVM remains
compatible. No assumption of user-grant backfill.

Implementation touchpoints: workspace membership schema/validator; embedded
`agentoperatorgrant` prefix; central policy and server-resolved operation context;
new Queen grant/revoke service/routes; existing membership mutation preservation;
Run requester/basis and reauthorization; audit payloads; idempotency/concurrency;
setup planner and validator-parity fixtures. Target retirement/deletion dependency
review must include operator references. Retired targets cannot be operated;
ordinary metadata reads and historical Run retention remain independent.

### Required acceptance tests

- Admin/member without a grant denied; selected client member/admin with exact
  grant allowed. Neither can configure targets, bindings or commercial state.
- Partner owner/member retains scoped configuration and appropriate operation;
  unassigned Partner and Empress-only denied. Combined authorities independent.
- Only scoped Queen grants/revokes; client admin membership-management APIs cannot
  self-escalate or copy/reactivate grants. End/rejoin does not resurrect access.
- Wrong issuer, member, workspace, target kind/ID/revision or operation denied;
  unknown keys, wildcards, duplicates, extra fields, oversized arrays and invalid
  times rejected by Zod/Mongo parity as applicable.
- Grant replacement, expiry, membership end, target revision/retirement and policy
  revocation stop remaining execution at every required recheck; old grant/Run
  identity cannot regain permission through regrant.
- Own Run controls permitted; other client's Run denied; Queen workspace controls
  preserved; revoked operator loses delegated client access, including historical
  reads while active membership persists.
- Operator without target edit may run but cannot apply. Target editor with
  authorized Result access may apply under canonical service checks. Operator
  never auto-approves. Freshness, immutable evidence and actual human attribution
  remain enforced.
- Swarm-only assignment cannot directly dispatch child Agent Runs or configure
  them. Unimplemented orchestration stays unavailable; future child derivation
  must prove pinned membership/job mapping and budget/source intersection.
- Positive grant alone is insufficient without configured target, implementation
  capability, source permission and execution policy/budget. Commercial purchase
  or approved Agreement alone grants no human operation rights.
- Concurrent grant/revoke/request/claim and membership updates serialize safely;
  audit and rollback failure injection cover partial writes. Existing membership
  idempotency preserves grants and no implicit migration grants appear.

**Approval requested for this bounded membership-assignment design, including
own-Run client scope and revision-pinned targets. No authorization implementation
has been made.**

## Runtime-to-Platform contract mapping

The actual public boundary is `@vamberic/agent-runtime/protocol` in the sibling
repository, backed by `contracts/index.ts`; it exports the schemas, types,
canonical digest helpers and input validation. Package 0.1.0 is private and
unpublished; protocol accepts exactly `1.1` (Result schema 2). Generated JSON Schema is structural
and cannot replace the authoritative byte/depth/digest/relationship refinements.

| Runtime contract | Proposed Platform ownership |
| --- | --- |
| DispatchSchema | Derived reference-only dispatch envelope from durable Run intent; generation/dispatch ID prevent stale claims |
| ClaimedWorkSchema | Derived under trusted workload claim, pinned Run/Attempt/fence/lease and current authorization |
| GrantSchema | Bounded authoritative grant embedded on Run, derived from human scope, definition, bindings and server execution policy |
| SourceLineageSchema / ReferenceSchema | Frozen source identity, bounded mutable snapshots and exact approved revision references |
| ImplementationManifestSchema | Trusted capability provider, distinct from Agent Definition metadata; exact manifest/build/protocol/operation pins |
| OutcomeSchema / AgentOutcomeSchema | Accepted immutable Result content and durable submission receipt; atomic Attempt and Run transitions |
| InputRequestSchema / InputResponseSchema | One active request on Run; validated, attributed, idempotently consumed answer; new dispatch generation |
| CheckpointSchema | Bounded active checkpoint on Run and immutable accepted outcome history; no hidden worker state |
| UsageObservationSchema / CostSchema | Append-only observations; exact decimal strings, corrections and restricted late reconciliation |
| ProposalSchema / EvidenceObservationSchema | Immutable candidates/provenance in Result, independently evolving human dispositions; selected evidence applied through canonical services |
| SafeErrorSchema | Sanitized classified errors, never raw provider errors or stack traces |

Proposed temporary consumption: reproducibly generated, versioned protocol-only
artifact with source/dependency hashes and original fixtures, consumed locally
without any production sibling-source import. It must preserve exact validators
and canonical JSON semantics, not hand-recreate them or rely only on JSON Schema.
Artifact generation/drift tests have not been implemented. Before 4A.3, publish
and pin a private immutable protocol package/release artifact; no publication is
authorized here.

## Persistence mapping and implementation boundaries

Retain the requested four-collection model; execution grants, checkpoints, input and dispatch remain embedded. Human operator
assignments extend existing workspace memberships as proposed above, without a
fifth collection:

- `agent_runs`: logical task, requester, workspace/client, frozen configuration,
  implementation pins, lineage, bounded grant/budget, active input/checkpoint,
  dispatch generation/intent, cancellation and active Attempt pointer.
- `agent_attempts`: one initial/retry/resume/continuation segment, ordinal,
  claim identity, worker, lease/fence, terminal state and receipt linkage.
- `agent_results`: accepted protocol envelope plus bounded human proposal
  dispositions; candidate/evidence content remains immutable.
- `agent_usage_observations`: append-only protocol observations, exact costs,
  producer-scoped idempotency and validated correction links.

Candidate persistence prefixes follow existing ULID conventions: `agentrun`,
`agentattempt`, `agentresult`, `agentusage`. They are proposals only; no prefix
registry has changed. Runtime's new execution IDs remain bounded opaque strings;
no change to Runtime IDs is needed.

Run states remain queued/running/awaiting_input/completed/failed/cancelled. Attempt
states remain running/succeeded/paused/yielded/failed/cancelled/expired. Human
review is separate from execution completion. The publisher must use a fake sink
in tests, durable intent and leased reconciliation; claim establishes execution,
not transport uniqueness. Current Mongo service supplies snapshot transactions,
majority writes and bounded commit time; new transitions must preserve atomicity
and include failure-injection tests.

Implementation reference should be optional on new Agent Definition versions.
Published versions stay immutable and existing metadata-only definitions remain
non-executable. Trusted implementation capability and execution-policy seams
must fail closed by default; configuration readiness and Agreement approval do
not establish runtime availability or spend authority.

Proposal handlers must be reviewed code mapping a target kind/schema to canonical
draft services under the actual human. No arbitrary Mongo writer. Result
application linkage can carry originating Run/proposal/source provenance; an
additive approval-time freshness hook must participate in the canonical
transaction. Exact provenance storage/lookup and locking design remains to be
implemented and verified; no claim is made that current Hive/Offer approval
already performs this check.

## Schema and rollout status

Source schema version is 9 with latest migration `009-empress-operating-foundation`.
The previous verification records dev v9; live state has not been re-read in
this task. No new migration number or index count has been finalized.

Existing HVM context accepts reviewed versions through 9, Hive accepts 6–9,
and the operating service requires 9. A future implementation must explicitly
review these guards so the new build can coexist with v9 and the new schema,
while new Run features fail closed until their migration is applied. Changing
Agent Definition structure also requires checking nested historical snapshots
and preserving installed migration history. No guards or validators changed.

Index design, strict persistence schemas, Mongo parity, request/response DTOs,
workload routes, service implementation, complete lifecycle tests and secure dev
dry-run remain outstanding. No endpoint names in the brief are claimed as
implemented by this investigation.

## Non-goals preserved

No SQS, DLQ, Cognito M2M, Fargate integration, AWS changes, model/tool calls,
Product/Service Understanding, Lead Gen Agent, CRM Agent, frontend, execution,
canonical writes, live test records, migration apply or deployment.


## Resumption — Protocol 1.1 and authorization race (1 October 2026)

**FAIL — DO NOT MIGRATE.** This section supersedes earlier checkpoint/version
statements without erasing the earlier investigation. Runtime-only artifacts now
match current Protocol 1.1 / Result schema 2: 81 source/build/schema/fixture files
are hash-verified against the sibling. No Runtime or HVMapp file was modified.

The actual upstream schemas validate required `content.knowledgeGaps` in the
immutable accepted Result envelope. Human Result service projection retains the
whole content and now exposes completeness too. Unknowns remain distinct from
task-relevant missing knowledge. Gaps allow `human_input`, `research`, `capability`
and `unresolved`; capability is descriptive metadata, not an executable selector.
The strict bounds are 40 gaps per Result and 8,192 canonical UTF-8 bytes per gap,
with unique IDs and same-Result evidence/finding/lineage references. Complete
output with a blocking gap is rejected. Partial success completes execution;
only an actual `needs_input` outcome pauses for input. No automatic research,
resolution, dependent Runs, capability dispatch or orchestration was introduced.
The human HTTP Result surface remains unfinished; these are service-level tests.

### New stop condition: snapshot authorization race

`MongoClientService.withTransaction` uses snapshot reads. Queen grant/revoke
writes a workspace CAS token and the membership. The claim path reads both but
writes only the Run, a new Attempt and a distinct audit Event. Therefore these
transactions have no common document write forcing a conflict or retry.

A deterministic local snapshot/write-conflict model now reproduces:

1. Claim establishes a snapshot containing the active client grant.
2. Queen commits revocation on the live in-memory branch.
3. Claim reads the old grant from its snapshot, passes authorization and commits
   its disjoint Run/Attempt/Event writes.
4. The client grant is absent, but a new workload lease has been issued.

The regression intentionally asserts that this must NOT happen and fails. The
ordinary test double serializes entire transactions and hid this interleaving.
This is a source-backed local reproduction, **not a live Mongo concurrency test**.
Mongo documents stale snapshot reads and document-write locking in its
[transaction production considerations](https://www.mongodb.com/docs/manual/core/transactions-production-consideration/).

Section 53 explicitly requires stopping for another material authorization
defect. No race repair, new routes, migration registration, live dry-run or Mongo
parity was attempted after discovery. The approved configure/operate/apply/approve
separation remains unchanged.

Recommended focused repair: give authority-dependent control-plane transitions
and authority mutations a shared transaction serialization boundary, acquiring it
before using authorization state; retry conflicts with newly resolved authority.
Review claim, request, heartbeat, context and acceptance, together with membership,
Partner-assignment and target-revision changes. Do not treat an ordinary snapshot
read or a no-op update as a lock. Decide how this boundary avoids unnecessary
user-visible workspace `updatedAt` churn and serializes all relevant revocations.
Then add interleaving tests and resume all remaining 4A.2 work. No schema v10 is
registered; no migration readiness claim is made.


## Authorization serialization repair — 1 October 2026

The earlier failing revocation/claim regression is retained and now passes.
A second snapshot read was insufficient: the original claim and revocation wrote
different records. The repaired authority-establishing transaction performs a
real bounded CAS increment on the authoritative documents it used. A concurrent
authority reduction writes/deletes those same documents, causing the stale
transaction to conflict rather than issue execution authority.

See [the dependency inventory and mechanism](investigations/agent-authority-serialization.md).
The invariant is: **an execution-authority-establishing transaction must serialize
against authority-reducing mutations that can invalidate that execution.**

Claim commits first: its historical Attempt remains legitimate, while subsequent
revocation stops continued/new work through heartbeat/context reauthorization,
cancellation and lease/fence checks. Revocation commits first: stale establishment
must conflict/retry/revalidate and cannot issue a new lease. The same mechanism
covers Run creation, input resume, retries and yields, exact Client Agent revision,
Queen authority chains, workspace lifecycle and declared persisted readiness
inputs. Time-based expiry and ephemeral implementation readiness remain separate
checks. There is no process lock, timing workaround, global counter or broadened
grant. Internal serialization touches generate no noisy business audit events.

Human route and workload adapter surfaces are wired with fail-closed production
defaults. No client can provide a prepared grant or issue a workload principal.
Actual capability metadata, preparation and workspace execution policy are trusted
server registrations, not browser inputs. Proposal application uses independently
authorized canonical draft mutation, selected observed evidence, source freshness,
audit and disposition in one transaction. Canonical Hive approval rechecks the
consumed sources for applications to that revision. Same-revision edits do not
silently discard those assumptions; a new canonical revision is an explicit
review boundary. Nothing automatically approves proposals or resolves Knowledge
Gaps.

This repair does **not** supersede the migration safety gate: candidate validators,
complete parity, migration registration and secure preflight must all be verified
before a ready-to-migrate result may be issued.


## Final completion — 1 October 2026

The authorization defect is repaired and the remaining 4A.2 foundation is wired.
Historical incomplete/FAIL statements above describe earlier checkpoints, not
current readiness. This is a migration-readiness result, not a deployment or a
claim that production workers already exist.

### API and trusted deployment composition

Human endpoints under `/api/v1/hvm` expose workspace Run create/list and execution
readiness; Run detail, Results, input answers, cancellation and proposal
apply/reject. Existing Agent Operator routes grant/revoke exact revision-pinned
operations. Run creation accepts only client Agent ID/revision, operation,
request key and input. The Platform resolves the registered preparer, normalized
input, frozen configuration, context grants and execution scope. Request replay
is idempotent; changed input under the same key conflicts.

Workload endpoints under `/api/v1/agent-workload` expose claim, heartbeat, context,
outcome, receipt and usage. Trusted workload authentication runs before body
parsing. The default is unavailable/fail-closed, not a human Cognito fallback.
Only principals issued by the trusted workload authority are accepted. Missing
receipts return JSON null. Strict bounded bodies, query validation, safe errors
and request logging exclude credentials and payloads.

Production capability provider, preparation registry, execution policy and
workload authentication must be explicitly composed by trusted server code.
Readiness checks implementation digest/build/protocol/schema, definition
availability, exact Agent revision/configuration, required Agents/capabilities,
integration slot/provider/version/cardinality and workspace policy. Persisted
positive dependencies join authority serialization; worker capacity remains a
trusted ephemeral check. Default registrations do not allow real execution.
These are intentional 4A.3 deployment seams, not browser-configurable authority.

### Proposal, evidence and freshness boundary

Reviewed default handlers support canonical Hive kinds (Offering, ICP and Buyer
Profile). Other kinds require a reviewed server adapter and fail closed today.
Apply requires Result visibility and independent canonical create/update
permission. Reject requires Queen authority. Selected evidence is mapped as
observed evidence with original origin/provider and immutable Run/Result/evidence
lineage plus the actual reviewer. Draft mutation, disposition CAS and audit share
one transaction. No proposal application implies canonical approval.

Current target revision/update token, parent workspace and consumed sources are
checked before apply. Canonical Hive approval checks applied proposal provenance
and consumed-source freshness again. Same-revision edits do not remove that
check; a new canonical revision creates an explicit review boundary. No automatic
superseding, approval or Knowledge Gap routing is implemented.

### Unapplied migration 010-agent-control-plane

Current live schema is 9; proposed schema is 10. Four collections are added:
`agent_runs`, `agent_attempts`, `agent_results`, `agent_usage_observations`.
Four new validators and ten exact-predecessor amendments are planned. Amendments
cover seven execution-serialization anchors plus execution implementation metadata
on Agent Definitions and embedded snapshots in recommendations/agreements.

`executionSerial` is optional, defaults to zero internally, and is a bounded safe
integer on workspaces, workspace memberships, Partners, Partner memberships,
Partner assignments, workspace integrations and capability instances. Existing
operating anchors reuse `referenceVersion`. These are real CAS writes, not
no-op touches. They do not change business timestamps or generate audit noise;
they are hidden from ordinary DTOs and cannot be set by generic CRM patches.
Counter exhaustion fails closed. No backfill is required.

The index source of truth is
`artifacts/api-server/src/db/agent-control-plane-collections.ts`:

| Collection | Index name | Keys (ordered) | Unique | Purpose |
| --- | --- | --- | --- | --- |
| agent_runs | id_unique | id:1 | yes | canonical identity |
| agent_runs | workspace_requester_request_unique | workspaceId:1, requester.issuer:1, requester.id:1, requestKey:1 | yes | human request replay |
| agent_runs | workspace_created | workspaceId:1, createdAt:-1, id:1 | no | Queen list |
| agent_runs | workspace_requester_created | workspaceId:1, requester.issuer:1, requester.id:1, createdAt:-1, id:1 | no | own-Run list |
| agent_attempts | id_unique | id:1 | yes | canonical identity |
| agent_attempts | run_ordinal_unique | runId:1, ordinal:1 | yes | ordered Attempt history |
| agent_attempts | run_generation_unique | runId:1, generation:1 | yes | one Attempt per dispatch generation |
| agent_results | id_unique | id:1 | yes | canonical identity |
| agent_results | run_attempt_unique | runId:1, attemptId:1 | yes | one accepted envelope per Attempt |
| agent_results | workspace_run_created | workspaceId:1, runId:1, createdAt:-1 | no | Result lookup |
| agent_results | workspace_applied_target | workspaceId:1, dispositions.target.resource:1, dispositions.target.id:1 | no | approval provenance |
| agent_usage_observations | id_unique | id:1 | yes | canonical identity |
| agent_usage_observations | run_observation_unique | runId:1, observation.id:1 | yes | observation replay/corrections |
| agent_usage_observations | attempt_run | attemptId:1, runId:1 | no | Attempt usage bounds |

No partial/sparse/TTL indexes, replacements, display-name uniqueness or startup
DDL are added. Control-plane records are not generic CRM CRUD/deletion targets;
existing workspace/Organisation dependency protections remain in force.

Existing HVM remains compatible across the upgrade: HVM/provision accepts schema
5–10, Hive 6–10, Offers 8–10 and operating 9–10. New execution functionality and
implementation metadata require 10. Unknown future schemas fail closed. Drain
old strict-reader application instances before enabling new execution writes.
Do not activate workers merely because the database migration has completed.

### Validator boundaries

Application and Mongo contracts protect required/null semantics, IDs, safe
numbers, timestamps, lifecycle, protocol shape, projections, bounded canonical
JSON, uniqueness, dispositions, Knowledge Gaps and completeness. Runtime text
bounds follow its Zod code-point semantics; Platform Zod fields retain their
UTF-16 semantics. JSON depth/node/string/key/array/byte bounds are explicit.

Intentional service-only checks are cryptographic SHA-256 digest recomputation,
exact WHATWG URL normalization, pre-BSON JavaScript object/prototype/surrogate
properties, cross-collection relationships/authorization, historical transition
immutability and aggregate budgets. Mongo protects the persisted document shape;
it does not replace those service checks. No unexplained parity drift remains
in the verified fixtures.

### 4A.3 handoff

After explicit migration approval, apply and post-migration verification:

- Compose workload M2M authentication, Runtime HTTPS adapter and Fargate worker.
- Add SQS dispatch publisher/reconciliation and test duplicate delivery against
  request/generation/receipt idempotency; never establish authority outside claim.
- Configure claim lease/heartbeat cadence, capability/readiness reporting and
  bounded crash/retry behaviour using the existing control-plane settings.
- Workers must react to cancellation/revocation, stop after lease/fence loss,
  preserve receipt/outcome replay and emit privacy-safe operational metrics.
- Add end-to-end multi-replica revocation races and failure recovery tests.
- Future Swarm child Runs and Knowledge Gap routing must serialize at every new
  authority decision. A stale plan is never an execution grant.

No SQS, M2M, worker deployment, model/external-tool calls, Agent behaviour or Swarm
orchestration is included in 4A.2.
