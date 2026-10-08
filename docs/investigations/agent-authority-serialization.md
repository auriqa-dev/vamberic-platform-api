# Agent execution authority serialization investigation

The invariant is: an execution-authority-establishing transaction must serialize
against authority-reducing mutations that can invalidate that execution.

Investigation before application changes (repair brief, 1 October 2026):

| Dependency | Current read / mutation | Serialization requirement |
| --- | --- | --- |
| Client grant and membership | `workspace_memberships`; context resolves active membership and exact grant, scope, revision and expiry; grant/revoke and HVM membership mutation write membership and workspace | Conflict on the exact membership plus workspace before establishment |
| Queen authority | `hvm_partner_memberships`, `hvm_partners`, `workspace_partner_assignments`; current context resolves active chain | Conflict on a currently sufficient, exact Partner authority chain; workspace alone does not protect Partner-wide changes |
| Workspace | `crm_workspaces`; client kind, archive and organisation; HVM mutations use updatedAt CAS | Conflict on exact workspace; no global lock |
| Client Agent | `client_agents`; configured, not archived, exact revision; operating mutations use workspace CAS and change the Agent | Conflict on exact Agent; no historical-revision execution after revision replacement |
| Client Swarm | `client_swarms`; exact revision grants exist but no execution | Future orchestration must lock exact Swarm and delegating authority before child creation; no Swarm execution added |
| Definition | `agent_definitions`; execution-policy seam must validate availability and exact implementation | Persisted definition uses existing referenceVersion counter; changes to same definition conflict; ephemeral capacity is not a Mongo authority epoch |
| Binding | Client Agent binding array plus `workspace_integrations`, provider definition | Exact bound documents only; disconnected/replaced connections must fail readiness; unrelated connections are excluded |
| Policy / implementation | Trusted execution policy currently defaults unavailable; full readiness remains unfinished | Persisted policy dependencies must participate; process configuration/capability checks remain fail-closed trusted checks, not client claims |
| Expiry | Platform clock plus grant expiry and lease deadline | Time check remains required independently of document writes |
| Run/Attempt | CAS Run updatedAt, generation, active Attempt/fence/lease | Existing execution fencing complements, but does not replace, authority serialization |

The vulnerable core read authorization under snapshot read concern without writing
these authority documents. Distinct audit events do not create a common conflict.
Run creation, resume, retry/yield and lease renewal had the same class of risk.
The existing serial in-memory transaction double masks it; retain the deterministic
snapshot/write-conflict regression and add reverse-order coverage.

Candidate selected for implementation: use existing authoritative documents as
transactional anchors (no new collection). Existing operating referenceVersion
counters can provide non-no-op writes. Other authority records currently have only
business updatedAt available; touching them would change user-visible concurrency
tokens on every claim/heartbeat. A dedicated optional internal field would avoid
that churn but requires changes to each affected strict validator. This tradeoff
must be resolved before implementation, and all persisted dependencies (including
Partner-wide records) must be covered, not just the workspace anchor.


## Implemented repair

The selected mechanism is a real transactional CAS increment on each exact
positive authority dependency. Existing operating documents reuse
`referenceVersion`. Seven other anchor collections accept optional internal
`executionSerial`: workspace, workspace membership, Partner, Partner membership,
Partner assignment, workspace integration and capability instance. Absent means
zero; nonnegative safe integers are required and exhaustion fails closed. No
business timestamp, grant, historical Run or Attempt is rewritten by the touch.
The counter is an internal serialization write, not a permission epoch or a
caller-supplied credential; Runs do not capture or compare it. Any competing
write/delete of the same authoritative document forces a stale Mongo snapshot
writer to conflict. Driver transaction retries must reauthorize on a new snapshot.

The original failing snapshot regression is retained. The test double now permits
an explicit authority reduction at the first write after stale authorization
reads, then checks write conflicts before commit; it does not serialize the two
transactions behind a process mutex. Claim-first retains the Attempt; subsequent
context/heartbeat detects revocation and Queen/system cancellation remains
available. Reduction-first cannot commit a new Run, lease, input-resume generation,
retry or yield. Expiry is independently checked using Platform time.

Enabled capability prerequisites reuse the existing operating model. The selected
positive Capability Instance is also an anchor: disabling it must conflict with
new execution establishment. A configured capability or commercial agreement
never substitutes for the separate explicit execution policy.

Persisted readiness inputs must be declared by the trusted policy and use one of
the reviewed anchor types. Ephemeral deployment capacity is checked through the
trusted capability provider and defaults unavailable; it is not represented as
an artificial Mongo record. New policy persistence requires an explicit reviewed
anchor before it can authorize execution.

Old documents require no backfill. Control-plane access remains gated on the next
schema version; existing v9 HVM operations remain available. Do not enable the
new execution writes until compatible application instances have replaced older
strict readers. Migration and live validator parity remain separate gates.

Future Swarm child creation and Knowledge Gap routing must lock the current
revision-pinned delegation and all other authority dependencies at each child
execution-establishment boundary. Neither orchestration mechanism is implemented.


## Final verification

The separate migration and parity gates are now green: focused Agent tests
258 passed/0 failed/2 opt-in skips; full API 1459 passed/0 failed/10 opt-in
skips; secure proposed-validator suite 777 passed/0 failed/0 skipped. The
read-only dev plan is schema 9 to 10 with no conflicts. Migration remains
unapplied. See [the full completion report](agent-control-plane-pre-migration-verification.md#final-completion--1-october-2026).
