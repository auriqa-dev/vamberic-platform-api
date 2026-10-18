# NBA foundation — implementation status, 16 October 2026

Status: local foundation build completed; prepared for coordinated dev deployment and real-app acceptance. Not deployed or activated. Local fixture success is not proof of live AWS/Mongo/provider behaviour.

## Completed locally

- Approved campaign, product, offer, ICP, buyer, Brand Kit, contact history and policy context feeds the existing structured generation function. British English, assumptions/evidence and client isolation remain enforced. Persist the request before generation; retain instructions on interruption/failure.
- Append-only decision history, optimistic edits, idempotency, human approval, pause/resume/cancel/reject and explicit reconsideration. Elapsed paused timers resume at the newly approved time without rewriting their history.
- Organisation/person ownership claims acquired atomically with native work. Competing decisions cannot hold the same claim; release is owner-specific. Cancellation stops linked pending Research and native work. No automatic expiry takes over another decision's claim.
- Native `nba_foundation/reconsider` registered behind the exact reviewed shared-worker release binding. Timers yield durable native checkpoints. Dispatch, heartbeat and result admission recheck current workspace authority, approved context and claims. Timer work has no provider/model/tool grants.
- API reconciliation of native completion, failed work and interrupted generation. Existing Research receives an idempotent, permission-rechecked handoff; completed/partial outcomes and organisation discoveries are retained. Context changes and due events require fresh review, never implicit execution permission.
- Durable frontier records with canonical organisation/domain identity, evidence and explicit revisit state. Preview shows bounded recent memory; this is not yet a continuously searching acquisition loop.
- Standard capability request/result contract, exact tenant/decision/version binding, duplicate-receipt handling and stale/uncertain result disposition. Internal-only reserved events cannot be forged through generic public writes.
- Contact Strategy evaluation is recomputed from current policy context at admission. Missing engagement assessments remain deferred and cannot authorise outreach. Internal research remains distinct from permission to contact anyone.
- Client administrators use the existing workspace-authority path; native authority serialisation now locks their active membership rather than requiring a delegated Queen assignment. Revocation stops continuation.
- NBA UI includes campaign and optional Hive organisation/contact selection, immediate saved results, progress/status, editable recommendations, approval/pause/resume/cancel, bulk pause/cancel with partial failures, history, reconsideration and links to Campaigns/Research. Henry shares current workspace context through the existing binding.

## Scope boundary

This is the review-led NBA foundation. Timers/context changes return work for review; they do not automatically run another model or send messages. Research currently uses existing Hive context, not Lusha/web acquisition. Continuous discovery/enrichment, automatic follow-up arbitration, email composition/delivery, reply handling and measurement remain their planned later increments. Unknown legal/contact-policy evidence never becomes outreach permission. No replacement framework or arbitrary recurring AI quotas were introduced.

## Verification

- 26 focused API NBA tests and one existing PSU production-composition regression pass: guards/contracts, persistence, interruption recovery, claims, tenant isolation, stale authority/context, native admission/claim, restricted Empress registration/publication, idempotent Research start/cancellation and elapsed timer resume.
- The production-composition test caught and fixed a nested-transaction readiness deadlock; approval now uses the existing transaction. Existing PSU composition still passes.
- Four native finite-turn tests pass; three UI workflow tests pass; six infrastructure release-input/synthesis tests pass.
- API, app and runtime builds and TypeScript checks pass; infrastructure TypeScript passes. Runtime/API protocol copy verifies all 163 artifacts. Focused app lint passes. Existing app bundle/JSZip warnings remain.
- Synthetic rendered UI inspected at 1440, 768, 375 and 320 CSS pixels; no page overflow at checked narrow widths. Approval/pause states inspected; resume/reconsider/edit/failure retention tested locally. This is not a full accessibility audit or authenticated live-app acceptance.
- Tests use in-memory Mongo fixtures; one native terminal result is simulated to exercise Research handoff. Real control-plane admission and claim are exercised locally, but SQS delivery/ECS restart and live Mongo durability still require release acceptance.
- No live provider calls, AWS writes, Mongo changes, messages or real-client edits performed in this build.

## Release gate

See `/Users/alyrichards/Developer/Vamberic/release-reviews/nba-foundation-20261016/PLAN.md` for exact resources, bounded synthetic acceptance, registration, dispatcher preflight and rollback. Obtain that approval before deployment. Capture new image/task pins during the approved build/release; do not invent them in advance.
