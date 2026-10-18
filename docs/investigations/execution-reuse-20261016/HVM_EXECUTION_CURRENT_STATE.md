# HVM execution: current implementation

Audit date: 16 October 2026. Read-only inspection; documentation is the sole output. Scope: API, agent runtime, app and infrastructure. This is a source-backed architecture assessment, not a fresh operational acceptance test. No provider calls, messages, database operations, deployments or dependency installation were performed.

## Evidence and interpretation

**Implemented** means a concrete source path was inspected. **Previously tested** means a retained report describes a check; it is not a claim that this audit reran it. **User reported** is explicitly distinguished. **Gap** means the inspected paths do not implement the required end-to-end behaviour; catalogue names and schemas alone do not count as execution.

Paths below are relative to `/Users/alyrichards/Developer/Vamberic`. API service paths start at `vamberic-platform-api/artifacts/api-server/src/`. Source symbols are supplied where line numbers may change during parallel development. The audit includes the current ICP/Offer/Campaign changes and v29 compatibility repair; recheck affected files before implementation.

### Retained acceptance evidence

| Evidence | What it establishes | What it does not establish |
|---|---|---|
| `release-reviews/app-smoke-20261014/REPORT.md` and `continuation/STATUS.md` | Reported live CRM lifecycle/DNC edits, private Library uploads, ICP persistence/generation, offer review/approval, Content Strategy and manual asset returns; continuation records specific fixes | Not an operational campaign. Continuation still identifies an outstanding live offer-research retest; do not treat an earlier report as a universal all-clear |
| `release-reviews/lusha-research-20261014/TEST-RESULTS.md` and `PROGRESS.md` | 17 API, 19 frontend and one IAM check recorded; live catalogue/connection form/Research UI observed | No paid Lusha request or live promotion acceptance; real account entitlement and credits unqualified |
| `release-reviews/mailbox-20261015/LIVE-PROGRESS.md` | Release and asset verification; initial consent workflow | Later send-and-reply success is user-reported in this chat. It verifies a connection test, not campaign delivery or production reply interpretation |
| `release-reviews/nba-preparation-20261016/RELEASE-STATUS.md` final section | API revision 126, unchanged runtime revision 2, Mongo v29 additive validators and 28 frontend assets verified; health/readiness passed | Authenticated save/reload/approval/ Henry QA remained pending sign-in. No live provider operations or client-record edits in that release |

The v29 release exposed older schema allowlists in active services. The repair passed 58 focused tests and a further 34 execution-evidence tests at v29. This is evidence for coordinated compatibility checking, not a reason to replace the runtime. No new test suite was run for this documentation-only audit.

## Shared foundation worth preserving

| Concern | Concrete source | Finding |
|---|---|---|
| Runtime authority and execution | `vamberic-agent-runtime/src/runtime/executor.ts`; `src/registry/registry.ts` | Implementation versions/digests, schema validation, grants, execution boundaries, checkpoints, provenance and usage recording exist. No NBA implementation was found |
| Durable jobs and recovery | API `services/agent-control-plane.ts` (`publish`, `reconcile`); `services/agent-dispatch.ts` (`createDispatchScheduler`) | Mongo run state, publisher leases, fences, deferred `notBefore`, cancellation, input expiry, retry recovery and SQS publication exist. Scheduler pages nonterminal runs; revisit latency needs measurement before scaling |
| Worker execution | `vamberic-agent-runtime/src/worker/worker.ts`; `src/worker/psu-production.ts`; API `services/agent-deployment.ts` | SQS worker, claim/heartbeat/deadline and shutdown handling exist. Deployed composition retains legacy PSU-specific bindings; NBA is not a configuration toggle on an already-qualified generic worker |
| Capacity and governance | API `services/agent-capacity.ts`, `agent-execution-readiness.ts`, `agent-proposal-freshness.ts`, `agent-execution-reconciliation.ts`; `routes/agent-control-plane.ts` | Workload authentication, capacity and approval/freshness boundaries are reusable. Legacy protocol limits need explicit compatibility work, not bypasses or arbitrary larger quotas |
| Infrastructure | `vamberic-infrastructure/lib/agent-runtime-foundation-stack.ts`, `agent-runtime-stack.ts`, `api-stack.ts`, `observability-stack.ts` | ECS, SQS/DLQ, scoped IAM, CloudWatch logs and queue alarms already available |
| Capability catalogue | API `domain/operating.ts`, `services/operating.ts`; `services/content-strategy/execution.ts` | Existing capability definitions, workspace connections and executor validation. Extend these and service-local adapters; no new capability microservice |
| Context and policy | API `services/brand-context.ts`; `services/contact-strategy/evaluate.ts`, `decision.ts`, `application.ts` | Approved tenant/brand context and policy evaluation exist; unknown evidence does not imply permission. Approval events matter, not merely populated policy text |

Dependencies inspected: runtime Node 24/TypeScript/Zod 4/AWS SDK/parse5; API Express 5/MongoDB driver 7/Zod 3 and 4/AWS SDK/Pino/sharp/parse5; app React 19/Vite 6/TypeScript/ExcelJS/JSZip/Papa Parse/pdfjs/oidc-client-ts; infrastructure CDK. Version ranges are manifest observations, not security certification of installed dependency trees. No LangGraph, CrewAI or Microsoft Agent Framework dependency was found in these primary manifests.

## A. NBA — foundations present; operational agent missing

Entry points: API `services/campaigns/service.ts`, `model.ts`, `measurement.ts`; `commands/nba-preparation.ts`, `db/nba-preparation-v29.ts`; app `hvm-app/src/pages/campaigns.tsx`.

Campaigns retain context, approved links, research objectives, qualification/outcome and meeting/handover preparation. Campaign service explicitly returns **“Awaiting NBA and Communications”**. Its research start path initiates Research, not autonomous prospecting and sending. `test/campaigns.test.ts` exists; v29 release has focused preparation checks, with signed-in acceptance outstanding.

Missing: organisation-first prospecting controller, cross-offer arbitration, managed-contact follow-ups, durable next-decision scheduling connected to campaign lifecycle, account/contact engagement ownership, provider-credit pacing, actionable decision ledger and authorised service dispatch. Existing run scheduling is real; the gap is NBA's business state and its composition into those controls.

**Preserve/enhance** runtime, campaign and contact-policy code. **Build** HVM decision logic. A model should reason over bounded evidence where necessary, not repeatedly poll an entire database or hold a process open waiting for a reply.

## B. Communication Service — contracts and test transport, not production coordination

API `services/mailbox/contracts.ts`, `application.ts`, `google.ts`; `domain/crm-interactions.ts`; `services/crm-foundation.ts`; `services/content-strategy/execution.ts`.

There are outbound/inbound structures, Gmail transport, identity references and content execution contracts. No complete NBA-to-production-communication orchestration path was found. Needed: immutable message preparation, final policy/freshness check, approved sender/template/content binding, atomic dispatch claim, send reconciliation, event correlation and outcome emission. A successful draft or Library return does not authorise sending.

**Enhance** existing interfaces and provider abstraction; **build** a small deterministic coordinator. MCP does not replace the reliability requirements of a provider API.

## C. Interaction Agent — internal Henry exists, public agent does not

API `services/content-strategy/workspace-henry.ts`, `henry-model.ts`; `hvm-app/docs/henry-interaction.md` describe and implement authenticated operator interactions. These are not a tenant-safe public visitor agent.

Missing: public session boundary, knowledge exposure restrictions, anonymous-to-known identity verification, visitor consent, streamed conversation/tool loop, contact collection, handoff and asynchronous continuation after NBA actions. An email entered by a visitor must not unlock that person's CRM history.

**Preserve** Henry's approved context/command paths. **Reuse** an established conversational SDK and chat components for the new public channel; retain HVM permission checks. No live public Interaction acceptance evidence found.

## D. Email — Gmail connection test works; lifecycle largely remains

`services/mailbox/application.ts`: `sendTest` restricts recipients to the connected mailbox/configured test inbox, records `mailbox_test` with `testOnly: true`, handles uncertain sends, and synchronises matching test threads. `worker.ts` schedules polling. `google.ts` supplies OAuth/Gmail request handling, MIME composition and thread reading. `contracts.ts` mentions Microsoft 365 but no corresponding working provider implementation was found.

`test/mailbox-application.test.ts` and `mailbox-contracts.test.ts` cover the bounded implementation. User reports successful test send and reply. Google restricted-scope verification remains an external onboarding dependency in the chat; this audit did not inspect current console approval.

| Lifecycle | Existing | Remaining |
|---|---|---|
| Connect/disconnect | Workspace-bound Google credentials, state/PKCE, refresh and disconnect | Verify final Google approval and production onboarding; Microsoft separately |
| Send | Test-only Gmail send, message identity and unknown-outcome protection | Production request/eligibility/render/send pipeline; sender readiness; preview/test-one-contact route |
| Monitor | Poll matching test threads; dedup reply records | Production thread sync, cursor recovery, bounce/auto-response handling, tenant-safe event intake |
| Interpret | Message bodies and historical CRM interaction schema | Quote/signature isolation, structured intent/evidence, uncertainty/human review, state transitions and NBA wake-up |
| Measure | Test records excluded from metrics | Honest accepted/delivered distinction, tracked links, bot/scanner treatment, optional open signals, suppression and unsubscribe |

No evidence of production Postmark dispatch here. Preserve Gmail; do not reopen a bulk-provider migration for the first individual-email campaign.

## E. Content Creation — strategy/brief/return paths, not asset automation

API `services/content-strategy/{application,model,generate,context,execution,library,library-discovery,library-planning,library-text}.ts`; `docs/content-strategy-execution.md`; `test/content-strategy.test.ts`.

Existing: structured strategy, approved versioned briefs, executor validation through registry/connections, manual brief export and asset return, rights/provenance and Library lifecycle. Library contains private and draft materials as well as approved published assets; it is not safe to expose every asset to a prospect. Research documents use shared private storage (`services/research/documents.ts`), with frontend extraction helpers for supported formats.

Missing: dedicated email asset-generation capability, provider-independent renderer, CTA resolver selecting approved public destinations for the individual offer/message, and operational consumption by Communications. Broader article/social/guide generation can follow. Manual return acceptance is reported in the smoke evidence; a successful website-to-CTA-to-email flow has not been established.

**Preserve** strategy, Library and Brand Kit. **Build** a narrow email generator, **reuse** rendering, then expand supported brief types. No writing studio or multi-agent writer team is needed.

## F. Research — substantial service, integration qualification remains

API `services/research/service.ts` (`start`, `run`), `context.ts`, `evidence-context.ts`, `organisation-dossier.ts`, `candidates.ts`, `candidate-policy.ts`, `documents.ts`, `worker.ts`; `routes/research.ts`; `services/lusha/{provider,connection,secrets,catalogue}.ts`.

Existing: idempotent requests, leased/recoverable execution, context/evidence, dossier history, candidate review, bounded candidate retention, explicit CRM promotion and tenant credentials. Paid Lusha calls are separated from public candidate discovery; enrichment includes match/entitlement and uncertain-charge handling. The code is not proof that a customer's real account permits the intended endpoints or that credits are accurately reconciled in operation.

Research also exists in PSU (`services/psu/research-crawl.ts`, `page-http.ts`, `page-reader.ts`), ICP (`services/icp/discovery.ts`) and Offer (`services/offer-architecture/research.ts`). PSU's crawl/extraction is reusable; Offer has task-specific search/source retrieval. These share needs for URL safety, evidence and expiry but differ in output. Consolidate adapters and evidence reuse when touched, not every orchestration path in one rewrite.

Missing: campaign-wide organisation frontier, cross-campaign ownership checks, fresh-evidence reuse before discovery/enrichment, provider-credit scheduling, repeat-contact discovery policy and demonstrated paid-account operation. Demand-stress should be an evidence-backed research objective, not an invented universal numeric label.

Tests: `test/research-service.test.ts`, `research-candidates.test.ts`, `research-documents.test.ts`, `psu-research-crawl.test.ts`; retained Lusha evidence above. **Preserve** the Research interface and existing controls; consider extraction/rendering libraries only for measured gaps.

## G. Advertising — later adapter work

No operational Google Ads, LinkedIn Ads, Meta Ads or sponsored-agent campaign executor was identified in the inspected API/runtime/app paths. Catalogue extensibility and generic channels do not implement these providers. Required work includes account authority, budget approval, creative/audience validation, provider state reconciliation, reporting and pause controls. **Defer** implementation; keep channel-specific requests/events possible. Official APIs are the starting point, not an autonomous agent with unrestricted ad-account access.

## H. Reporting and observability — projections and infrastructure exist

`services/campaigns/measurement.ts` defines campaign activity, deduplicates event keys and counts unique contacts; unavailable measures remain unavailable. Campaign UI displays funnel/activity views. CRM interactions already distinguish email, call, meeting, note and generic communication with message/thread references. Technical logs/CloudWatch/SQS alarms and runtime usage/outcomes are present.

Missing: reliable production event writers, attribution/denominator definitions, channel-specific reporting, cross-service correlation, redacted trace drilldown and evidence-based analytical recommendations. Existing email-shaped funnel labels should not become mandatory semantics for paid advertising or anonymous website visitors. **Preserve** projections and logs; **reuse** charting/OpenTelemetry selectively. Do not commission a new warehouse before measured volume requires it.

## Audit conclusion and refresh boundary

The reusable foundation is substantial; the commercially operational execution loop is not yet complete. A percentage-complete figure would conceal the production-send, scheduling and feedback gaps. Preserve what exists and implement a single controlled vertical slice. Before building, refresh `agent-deployment.ts`, `agent-dispatch.ts`, campaign/ICP/Offer source, mailbox source and the final v29 acceptance record; working-tree code and deployed code can differ. No existing client content was approved or overwritten during this audit.

## Source snapshot and direct evidence links

Working trees contain earlier uncommitted changes; HEAD alone does not identify audited content. Observed HEADs: API `56080b6`, runtime `422b95e`, app `270f438`, infrastructure `6efffbd`. These hashes are context, not a claim that all inspected work is committed. Key source SHA-256 digests below allow a targeted refresh before implementation.

| Source | SHA-256 |
|---|---|
| [vamberic-agent-runtime/src/runtime/executor.ts](/Users/alyrichards/Developer/Vamberic/vamberic-agent-runtime/src/runtime/executor.ts) | `c6f7f29935398d95ae122b85e29d55a2640c53bc05d497f61cf53fa11f305643` |
| [vamberic-platform-api/artifacts/api-server/src/services/agent-dispatch.ts](/Users/alyrichards/Developer/Vamberic/vamberic-platform-api/artifacts/api-server/src/services/agent-dispatch.ts) | `5080abf3b86da96dc14771011a77211dfe0f018917eb1c888518cd4eb4b7ac86` |
| [vamberic-platform-api/artifacts/api-server/src/services/agent-deployment.ts](/Users/alyrichards/Developer/Vamberic/vamberic-platform-api/artifacts/api-server/src/services/agent-deployment.ts) | `632745f5af16c95cbc3e8f2225252af9a3be3a97cbb8fb4732112bdf36014441` |
| [vamberic-platform-api/artifacts/api-server/src/services/campaigns/service.ts](/Users/alyrichards/Developer/Vamberic/vamberic-platform-api/artifacts/api-server/src/services/campaigns/service.ts) | `28294f1b7d98f5b7a285d54daf1266ee5b3209ab0e21880715a7054ab74d8a56` |
| [vamberic-platform-api/artifacts/api-server/src/services/mailbox/application.ts](/Users/alyrichards/Developer/Vamberic/vamberic-platform-api/artifacts/api-server/src/services/mailbox/application.ts) | `721bf4c5d61f37f63226ec541f20892a5ebcdd7254ae176bc04795d50e3323b9` |
| [vamberic-platform-api/artifacts/api-server/src/services/research/service.ts](/Users/alyrichards/Developer/Vamberic/vamberic-platform-api/artifacts/api-server/src/services/research/service.ts) | `47f59d5fed67209e69c51369c5ffe7822343ac115406a82e018d1fd46ceeb2b4` |
| [vamberic-platform-api/artifacts/api-server/src/services/content-strategy/execution.ts](/Users/alyrichards/Developer/Vamberic/vamberic-platform-api/artifacts/api-server/src/services/content-strategy/execution.ts) | `f8e1758b0ef407c6813f23274f48d8809e2cc28c187fc14d3577a0985e159d77` |
| [release-reviews/nba-preparation-20261016/RELEASE-STATUS.md](/Users/alyrichards/Developer/Vamberic/release-reviews/nba-preparation-20261016/RELEASE-STATUS.md) | `11bc38922ec0c2c7a026d58086402e2bc33364ec5d883b5e02eb4d23842e2df5` |
