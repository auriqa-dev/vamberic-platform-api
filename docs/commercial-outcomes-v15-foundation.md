# Commercial outcomes foundation — unapplied v15

2026-10-04. Foundation/data contracts only. Release dependency remains **schema 11 → v12 → v13 → v14 → v15**. Migration `015-commercial-outcomes` is proposed, not applied. No live database, client integration, payment call, Agent execution, campaign or AWS change is part of this work.

## Reviewed architecture and reuse

The existing canonical `transactions` contains Product-centric payment facts: customer Organisation/Person, provider identifiers, money/currency, transaction time/status, original transaction and subscription linkage. `subscriptions` contains external recurring state. `product_relationships` already represents contextual prospect/engaged/trial/customer/former-customer/partner states, but requires a legacy Product. Canonical Offering is a workspace-owned definition with exact immutable Hive revisions, not an interchangeable Product ID. No Product-to-Offering mapping is invented.

The new contracts reuse these same collections and IDs through a strict `commercialVersion: 1` Offering branch. Existing Product records/schemas remain unchanged. No Account, Contact, Sale, Order, Action or billing collection is introduced. Organisations remain economic subjects; People and Contact Points retain their existing meanings. V14 identity/resolution, value and strategy contracts remain frozen.

V13 Context, Decision, Learning, Event outcome and CRM Task/Action concepts are reused unchanged. An Event describes something that happened; the durable Transaction records its commercial meaning. Completion of a Task, a click, a checkout visit or a provider-themed Event is not proof of a purchase.

## Transaction and authoritative provenance

`CommercialTransactionV15Schema` requires workspace, Organisation, exact Offering identity/revision/snapshot/hash, immutable creation timestamps, transaction type/status, quantity/unit, `grossAmountMinor`, ISO currency, transaction time, one-off/recurring context and provenance. Optional Person is a participant on behalf of the Organisation. This initial branch is Organisation-economic; it does not silently reinterpret a Person as the customer. Existing legacy Person-economic records remain valid.

Money is an integer minor-unit **total for the transaction quantity**, not a computed unit price. No tax, fee, settlement, invoice, revenue recognition, entitlement or execution fields are admitted by this branch. `completed` means the commercial occurrence is confirmed; a completed refund is not a new purchase.

Provenance requires source system, source account, external outcome reference, source revision, confirmation time and exact existing evidence references. An external reference identifies the commercial outcome/line, not an entire multi-line order. Those fields are assertions, not credentials or authentication. `checkCommercialV15References` fails closed for a new Transaction/Subscription unless a separately supplied trusted server verifier confirms the exact assertion. No production verifier or integration is implemented; the always-successful verifier appears only in synthetic tests.

A future client/payment integration must authenticate its source, independently verify the occurrence, authorize workspace scope, handle replay/idempotency and consistency, and atomically admit the fact plus associated Event/state. A browser assertion, source label, click, caller-supplied boolean or raw Event cannot stand in for that boundary. Existing generic CRM write contracts reject the new Offering-only records.

## Event linkage, economic identity and lifecycle

An existing Event may carry `commercialTransaction: {collection, id, digest}`. The transaction payload is not copied. Event admission checks exact fact digest, workspace, Organisation, optional participating Person and occurrence time. The fact must already be known when the Event is recorded. The fact's provenance can point to prior source evidence; it does not require a circular digest reference to the purchase Event.

`CommercialRelationshipV15Schema` is an immutable assertion in `product_relationships`, scoped to workspace + Organisation + Offering, with exact Offering revision, effective time, evidence, transaction references and optional exact supersession reference. Customer/former-customer assertions require canonical purchase/renewal history in the same Organisation/Offering. Customer state for A confers no customer state for B. Absence remains unknown; explicit unknown is also representable. Organisation.type and Person.lifecycleStatus are not rewritten.

Historical assertions do not themselves compute present relationship state. Future retrieval must handle supersession, freshness, authorized scope and concurrent competing assertions. A refund does not automatically decide whether an ongoing commercial relationship has ended. No such lifecycle policy or execution engine is introduced here.

## Realised value and recurring commitments

`RelationshipValueV15Schema` extends the existing assessment with optional bounded `realisedTransactions` references. The assessment must have the same Organisation economic subject and exact Offering scope. Amounts remain on the canonical facts; no independent realised total or mutable score is admitted in this extension. V14 estimated potential, known, strategic priority and assumption dimensions are preserved. Existing `known` dimensions are not silently reclassified as realised revenue.

Corrections/refunds may be included in the referenced history. Consumers must account for their meaning before claiming a current net value; summing every row would be incorrect. No aggregation, currency conversion, LTV or scoring engine is supplied.

`CommercialSubscriptionV15Schema` stores an immutable externally confirmed commitment assertion in `subscriptions`: active/cancelled/ended state, exact Offering, Organisation, quantity/unit, amount in minor units **per unit per interval**, currency, interval and effective time. £295/month/site is representable without a billing schedule. An active commitment is not realised income. A recurring purchase/renewal references an exact active commitment assertion; no entitlement or access follows from either.

Subscription changes append a new assertion with exact `supersedes` and source revision, retaining source identity. New Offering branches do not set the legacy top-level provider/externalSubscriptionId fields. Their source identifiers live in explicit provenance, so legacy sparse unique provider indexes remain unchanged and do not collide with immutable assertion history. New workspace-scoped source/revision uniqueness covers the new branches.

## Corrections and retained history

Refund, reversal, correction and cancellation Transactions require an exact `originalTransaction` reference. They retain Organisation, exact Offering revision and currency, and advance recorded history. The original row remains unchanged. Monetary values are nonnegative magnitudes; the transaction type explains the occurrence. A correction records corrected commercial facts; it is not implicitly an additional sale. Netting, partial-refund policy and lifecycle effects are future consumer responsibilities, not hidden arithmetic in this foundation.

Subscription and relationship snapshots likewise append exact supersession links. No update/delete workflow is added. Mongo document validation cannot enforce append-only behavior across writes; a future trusted writer must enforce immutability, transactional reference consistency and concurrency. Existing Organisation/Person hard-delete blockers continue to see retained Transactions/Subscriptions through their canonical subject fields.

## Context, strategy and authority

`ReasoningContextV15Schema` adds bounded exact references to transactions, commercial relationships and recurring commitments. Existing Organisation/Person, exact knowledge, policy, value, identity and evidence references remain authoritative. No purchase history is copied into Context. Referenced commercial facts must match the Context's Organisation and exact Offering knowledge. Digests exclude Mongo `_id`, following the existing canonical convention.

Contact Strategy can combine current admitted relationship assertions, historical purchases, active commitment assertions and potential assessments with its existing versioned policy. This allows future acquisition-suppression/customer-protection/subsequent-proposition reasoning, without implementing suppression or proposition algorithms. Existing Decisions and Learning can continue to reference Contexts and outcome Events. No additional Decision/Learning store or execution authority is created.

Reference admission checks workspace, identity, dates, exact Offering revisions, evidence digests, corrections and supersession. Traversal is limited to 200 resolved references and 16 history levels. These bounds fail closed; pagination/history projection for larger histories is future work. A resolver must return trusted, admitted canonical records. Schema validation alone does not authorize reading those records.

Empress, Queen/Partner, client membership, grant, Run/Attempt/fence and canonical approval boundaries remain unchanged. No value, relationship state, source assertion, policy or Effectiveness PASS confers execution or workspace authority.

## Migration and preservation

Proposed v14 → v15: **zero new collections, seven new indexes, six validator applications**, with no seeds/backfill. Validators: `transactions`, `subscriptions`, `product_relationships`, `events`, `relationship_value_assessments`, `reasoning_contexts`. The first three had no canonical Mongo validator in v14; their unmarked legacy branch retains that prior behavior. The new marked branch is strict. The other three require exact v14 predecessor validators; arbitrary drift fails preflight.

New indexes:

- `transactions.workspace_organisation_offering_history`
- `transactions.workspace_commercial_source_revision_unique`
- `transactions.workspace_original_transaction_history`
- `subscriptions.workspace_organisation_offering_history`
- `subscriptions.workspace_commercial_source_revision_unique`
- `product_relationships.workspace_organisation_offering_history`
- `events.workspace_commercial_transaction`

Commercial-record indexes are partial on `commercialVersion: 1`; the Event index is partial on the fact-reference field existing. Canonical definitions are in `src/db/commercial-outcomes-v15.ts`. The existing 58 collections become 190 application indexes. No existing index is dropped or altered.

The setup runner now accepts an internal code-owned target for historical test verification. The normal CLI still targets only the current schema. The v14 migration test changes its import only; every original assertion remains byte-for-byte equivalent, verified by hash. A fingerprint covers the complete compiled v14 validator/collection target, and protected v14 contracts/tests/reports retain their original hashes. Shared older migration tests also use the frozen v14 target instead of silently changing their historical expectations.

The v15 preflight requires the exact, once-only ordered migration ledger through the installed version.
Existing installed schemas 11–13 are explicitly rejected by the v15 setup target: their reviewed releases must establish schema 14 first. Empty synthetic setup remains supported for testing. No independent schema-11 release path is added.

Mongo structure checks are not claimed to equal the complete semantic/reference verifier. Actual Mongo validator execution and secure installed-schema preflight remain release gates; only local synthetic verification was run.

## Synthetic Atlas scenario and remaining gates

Offline tests represent Atlas as prospect, Sarah as participant, an evidence-based higher potential assessment, a confirmed £1,995 purchase, separate purchase Event and customer assertion, three additional sites for £5,985, a £295/month/site active commitment and a simultaneous prospect relationship for another Offering. Canonical entities/revisions are referenced, not duplicated. No Built Matters-specific live record exists from this task.

Before production commercial ingestion: review/apply the ordered releases under separate authorization; verify validators against real Mongo synthetically; implement authenticated commercial confirmation, transactional append-only/idempotent admission and authorized bounded retrieval; define current-state/supersession and refund/net-value consumption policy where needed. These are separate from PSU provider/execution gates. This foundation neither authorizes PSU to resume nor makes campaign execution ready.
