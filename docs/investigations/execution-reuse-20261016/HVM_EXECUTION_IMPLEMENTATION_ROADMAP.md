# HVM execution implementation roadmap

Proposal dated 16 October 2026. Audit only; no implementation or campaign activation performed. See [current state](HVM_EXECUTION_CURRENT_STATE.md), [reuse options](HVM_CAPABILITY_REUSE_REGISTER.md), [target architecture](HVM_EXECUTION_TARGET_ARCHITECTURE.md) and [decisions](HVM_BUILD_VS_REUSE_DECISIONS.md).

## Shortest reliable route

Finish authenticated acceptance of the current ICP/Offer/Campaign increment, then connect existing Research, Hive and policy to an NBA decision and a production communication request. Include the minimum Email Content Creation and Library CTA work **before** the first outbound send. Broader Content Creation remains phase 4. Qualify one-contact preview/send/reply/re-evaluation before enabling campaign acquisition. Do not wait for advertising, Microsoft, a new framework or an analytics warehouse.

Google verification and a real customer Lusha entitlement/credit check are external readiness gates. The first controlled email test can use an authorised existing Hive contact while paid acquisition is being qualified; that does not establish the complete discovery route. Keep the existing external demo booking page initially. Booked is not automatically qualified, attended or customer.

## Phase 1 — Preserve and complete the foundation

**Deliverables:** current ICP/Offer/Campaign save/reload/approval acceptance; approved context and lifecycle version references; NBA decision/request/event contracts; qualified native runtime composition; due-time/event scheduling, cancellation and policy recheck; identity and engagement ownership rules. Extend existing registry and service-local interfaces, not a new service layer.

**Prerequisites:** review decisions D01–D06; refresh source/deployed differences and v29 release status. Existing recovery process is accepted; capture scoped migration compatibility and rollback only where a change needs it. Resolve approved goal/outcome/qualification/booking settings through Henry without making the user configure technical rule IDs.

**Reuse:** Mongo transactions/versions, SQS, ECS, existing runtime and dispatch, contact policies, approved context, Brand Kit.

**HVM-specific build:** durable NBA business state and two modes; organisation frontier, management claims and cross-offer arbitration. Retain arbitrary business types and multiple offerings.

**Risks/dependencies:** deployed worker remains PSU-bound; delayed dispatch latency; stale approvals; optional fields must not break saved designs. New schemas require API/runtime compatibility together.

**Acceptance:** approved context survives reload; missing required context explains a blocked action; two competing decisions do not create duplicate engagement; tenant crossover rejected; process restart preserves due work; cancellation prevents undispatched work. No live email yet. A mock provider must show one external effect under duplicate delivery.

**Quick win:** expose clear campaign readiness and “what will happen next” from actual state, not a misleading active label.

## Phase 2 — Odyssiant outbound, delivered in vertical slices

### 2A. Library and minimum email asset readiness

Consume authorised site content into the existing Library, verify extraction and provenance, and select approved public CTA destinations for each offer/stage. Test both a public page and an internal uploaded item; only the public permitted destination can become a prospect link. Produce email subject/body/CTA through the existing brief contract and fresh approved Brand Kit. Render HTML/plain text with a reusable template and display the saved result immediately.

Prerequisites: approved campaign/offer/ICP and an explicit preview/test authority. Reuse Library and content execution; evaluate React Email. Risks: missing or stale CTA, private data leak, brand drift. Acceptance: no invented URL, no automatic publication, distinct offer copy, editable draft, actual preview matches sent rendering. This is part of the critical path, not deferred to phase 4.

### 2B. One-contact execution and replies

Provide a user route to select an authorised contact, inspect NBA's proposed action, preview the message and send to an approved test destination before real execution. Build deterministic Communications, final suppression checks, dispatch claim and ambiguous-send reconciliation. Extend Gmail sync from test-only records to production communications. Add MIME parsing where needed and evidence-backed reply interpretation.

Reuse Gmail, message IDs, CRM histories, policy evaluation and structured generation. Risks: duplicate send, unclear delivery status, misclassified reply and leaking quoted content into instructions. Acceptance: send once; receive/correlate a reply; store interpretation and evidence; NBA proposes the next action; opt-out immediately prevents future dispatch; disconnect/pause blocks execution. Do not auto-approve client content for the test.

### 2C. Acquisition and managed-contact loop

NBA starts from suitable organisations. Research checks Hive/history and missing evidence before Lusha. Record verified candidates through existing promotion paths, claim campaign/offer engagement, create approved messages and resume managed-contact decisions on events/due dates. Add customer-specific credit reservations, daily limits and verified refresh resume. An exhausted enrichment balance pauses paid discovery, not all follow-ups to existing contacts.

Dependencies: phases 1, 2A/2B, Lusha account qualification and explicit campaign activation authority. Risks: duplicated discovery/paid calls, overlapping offers, repeated approaches to an organisation and stale contact employment. Acceptance: full reference scenario below, including pre-existing organisation/contact branch and paid-enrichment branch, with clear costs and recoverable failures.

### 2D. Measurement and website handoff

Wire durable events into current campaign projections. Add scoped tracking redirects and sufficient website/booking outcome capture to support the campaign objective. Preserve unknown delivery/open status. Use reusable charts only once event counts reconcile. Include pending/failed work and a human escalation queue.

Risks: bot clicks, forwarded links, attribution confusion and duplicate webhooks. Acceptance: dashboard agrees with communication/event records; test sends excluded; anonymous events remain anonymous; booking and qualification separate; playback of duplicate/out-of-order events does not inflate totals.

**First operational release gate:** bounded authorised live end-to-end tests pass in the real app, including restart/uncertain outcome recovery. Then the user approves campaign activation and its autonomy policy. A health check or an isolated Gmail send is not sufficient.

## Phase 3 — Interaction Agent

Deliver tenant-branded visitor chat, approved public retrieval, natural structured data collection, verified contact continuity, guide delivery through Communications, qualification and human handoff. Use AI SDK/assistant-ui POC; use LangGraph only if a demonstrated state/branching requirement makes it simpler. Do not write a bespoke conversational SDK.

Prerequisites: phase 2 communication/events and public-versus-private Library boundary. HVM builds guarded tools and identity transitions; reused SDK handles streaming/tool mechanics. Risks: prompt injection, spoofed contact identity, accidental operator privileges, interrupted streams and inappropriate auto-actions.

Acceptance: anonymous visitor cannot retrieve CRM history; two tenants never share context; requested guide delivery is recorded and governed; chat resumes after asynchronous action; operator handoff works; opt-out/permission respected; tools cannot exceed approved scope. Native NBA and Interaction share authority/events, not necessarily a single framework's state engine.

Quick win: approved-knowledge Q&A with a clear handoff, before enabling autonomous contact updates.

## Phase 4 — Broader Content Creation

Extend the proven email brief/asset path to articles, landing-page text, social/ad copy, repurposing and downloadable guides. Reuse local document generators and manual external production; preserve Library version/rights/approval. No writing studio, graphics editor or multi-agent writer team by default.

Prerequisites: reliable briefs, Brand Kit, evidence and content review from phase 2. Risks: weak substantiation, format mismatch and output incorrectly becoming authoritative. Acceptance: each asset retains approved source/context versions and gaps; replacing a draft does not rewrite historic approvals; external returns validate; private assets never become public solely through generation. Rendered guides require visual QA.

Quick win: repurpose one approved asset into a reviewed email/social draft with source links; no automatic distribution.

## Phase 5 — Extended channels and analytics

Microsoft mailbox adapter, additional permitted communication channels, official advertising integrations, advanced analytical recommendations and later external AI channels. Reuse provider SDKs/APIs, OpenTelemetry/ECharts and current Mongo projections. Consider a new analytics store or workflow service only after a measured limitation.

Prerequisites: stable event/authority boundaries and provider access. Advertising needs separate client accounts, budget approval and provider state reconciliation; platforms retain bidding optimisation. MCP/A2A integration requires a specifically qualified provider rather than a generic marketplace build.

Acceptance: channel-specific metrics/consent, approved spend limits, cancellation/reconciliation, tenant-scoped credentials, no duplicate actions, analytical recommendations supported by data and human authority. Do not equate impressions, visits and contacts. Quick win: read-only channel performance before write-enabled campaign automation.

## Mandatory end-to-end scenario and gap map

This table is an architecture validation, **not a report of an executed campaign**.

| Step | Existing building block | Work remaining / acceptance evidence |
|---|---|---|
| Campaign activated | Campaign records, approved links and readiness | Separate approval from actual activation; lifecycle triggers finite NBA run |
| NBA determines prospecting need | Runtime and context/policy | Goal/capacity arbitration and durable decision, no repeated full-database model polling |
| Discover organisations | Research request/evidence service | Campaign frontier with freshness/revisit policy; organisation-first objective |
| Check Hive | CRM records/dossier | Tenant-scoped identity match; existing organisation is reused rather than duplicated |
| Assess contacts/history | CRM interactions, lifecycle and suppression | Management ownership/cross-offer arbitration; reuse eligible relationship instead of cold restart |
| Research missing evidence | Existing crawl/search and dossiers | Fresh evidence reused; unknown facts remain gaps; employment validated |
| Lusha if justified | Per-client connection/candidate adapter | Real endpoint/credit qualification, reservation/reconciliation; no repeat charge on uncertain response |
| NBA selects action | Policy evaluation and approval structures | Evidence-linked action, timing, offer and required human approval |
| Prepare communication | Brief/Library/manual execution paths | Email draft + public CTA + template + current policy/version check |
| Provider sends | Gmail connection-test transport | Production send claim, stable identity, reconcile unknown, do not retry blindly |
| Capture events | Campaign projection schema, mailbox polling | Production intake/outbox/inbox, deduplication and truthful status |
| Interpret reply | Test-thread body retrieval, CRM history | New-message parsing, structured evidence/uncertainty, deterministic suppression |
| Update Hive | CRM authority paths | Scoped transitions and provenance; do not erase former employment or fabricate identity |
| Next NBA action | Run scheduler/control plane | Event/due-time wakeup, pause/cancel, wait/research/follow-up/human handoff |
| Dashboard reflects state | Campaign measurements/UI | Real producers, consistent denominators, separate testing/anonymous events |

## Failure cases required before autonomous acquisition

- Duplicate queue delivery/concurrent workers: one engagement claim and one communication effect.
- Provider sends but response or DB save fails: mark unknown, reconcile before any retry.
- Opt-out arrives after draft approval: final dispatch check blocks it; no stale queued send.
- Research repeats an existing organisation: reuse identity and evaluate history; do not spend Lusha credits automatically.
- A second contact at the same organisation: coordinate with the current relationship, not blanket permanent exclusion.
- Credit exhaustion/unknown charge: durable pause; authorised follow-ups continue where eligible; refresh resumes only verified availability.
- Process dies during wait: due action survives; expired approval or changed campaign triggers re-evaluation.
- Forged/misrouted event or hostile retrieved page: authentication, tenant mapping and evidence boundaries reject authority claims.
- Out-of-office, departed employee, unsubscribe and human objection: distinct outcomes; ambiguous classification goes to review.
- Bot clicks, forwarded links, missing delivery, cancelled demo and no-show: do not inflate engagement/qualification/customer figures.
- Missing public CTA or unpublished evidence: hold the message with an actionable gap.

## Independent work and review checkpoints

After phase 1 contracts are agreed, template rendering, Library ingestion/CTA qualification, provider-account readiness and reply fixtures can progress independently. Production dispatcher and NBA integration depend on those contracts. Marketing projections can be built against fixtures in parallel, but become accepted only with real event producers. Interaction framework evaluation need not block first outbound.

Review checkpoint 1: native runtime and contract decisions. Checkpoint 2: one-contact preview/send/reply and Library acceptance. Checkpoint 3: organisation acquisition with paid-account qualification and credit recovery. Checkpoint 4: bounded operational campaign before wider automation. These are concrete increments for the user and Codex, not an ownership-matrix programme.

No defensible calendar estimate or percentage saving follows from repository inspection alone. Estimate after one vertical slice reveals provider readiness, render compatibility and recovery work. Keep local tests focused and use the real app as the acceptance milestone with explicit authority for messages, provider costs and deployment.
