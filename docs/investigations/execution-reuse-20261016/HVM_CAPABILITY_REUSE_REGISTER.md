# HVM capability reuse register

Research date: 16 October 2026. Official project repositories/documentation were consulted; no packages were installed or benchmarked. Ratings are architectural judgements for HVM's existing stack, not measured product comparisons. Release observations are not dependency pins: verify the exact package, licence, advisories and Node compatibility before adoption. A monorepo release number is not the version of every package.

## Selection method

Weights: fit 25%, development time saved 20%, integration simplicity 15%, security/tenant compatibility 15%, maintenance 10%, operating cost/licensing 10%, portability 5%. Use H/M/L desirability (high is better); no artificial numerical total. Licensing, tenant authority and governance are hard gates regardless of scores. Savings below identify work avoided, not invented days or percentages. Hosted products incur charges and data-processing review even where the corresponding library is permissively licensed.

## Runtime and conversational candidates

| Candidate/type | Verified facts and maintenance | HVM fit, effort and recommendation |
|---|---|---|
| **Existing HVM control plane** / native | Mongo state, SQS, ECS, leases, checkpoints, delayed dispatch, authority and usage; current source inspected | Best initial NBA substrate. Medium work to compose/register NBA and qualify lifecycle; low migration risk. HVM maintains its business logic. Existing AWS/database costs. **PRESERVE + ENHANCE** |
| **LangGraph JS** / framework | MIT; TypeScript/JavaScript durable graph/checkpoint/HITL. Release observed `@langchain/langgraph@1.5.0`, 12 Oct 2026. [Repository](https://github.com/langchain-ai/langgraphjs), [releases](https://github.com/langchain-ai/langgraphjs/releases) | Strong branching/resume fit, but duplicates existing run state if used indiscriminately. Medium/high integration; checkpointer storage and model costs, no mandatory hosted platform. **Conditional POC for complex Interaction**, not NBA migration |
| **Microsoft Agent Framework** / framework | MIT; .NET/Python rather than native TypeScript. Release page includes .NET 1.22.0 and Python 1.19.0; independent release tracks. [Repository](https://github.com/microsoft/agent-framework), [releases](https://github.com/microsoft/agent-framework/releases), [licence](https://github.com/microsoft/agent-framework/blob/main/LICENSE) | Workflow/agent features useful, but a second language/service and translated HVM contracts raise cost. Model/hosting charges remain. **DEFER**, no first-release benefit demonstrated |
| **CrewAI** / framework | MIT; Python Crews/Flows; latest observed 1.15.28, 14 Oct 2026. [Repository](https://github.com/crewAIInc/crewAI), [releases](https://github.com/crewAIInc/crewAI/releases) | Multi-agent delegation is not the missing business capability. High integration/operational burden relative to current TS stack. Review telemetry settings and hosted options separately. **DEFER** |
| **Temporal TypeScript** / durable workflow | MIT SDK; v1.24.0 observed, 15 Sep 2026. Durable workflows require Temporal service plus workers. [SDK](https://github.com/temporalio/sdk-typescript), [releases](https://github.com/temporalio/sdk-typescript/releases), [development](https://docs.temporal.io/develop/typescript), [cloud pricing](https://temporal.io/pricing) | Credible alternative if native long-duration recovery demonstrably fails requirements. High migration: replay/versioning, new service/storage or hosted processing, workflow coupling. **DEFER pending evidence**, not layer on top of every HVM run |
| **Vercel AI SDK** / conversational SDK | Apache 2.0, TypeScript streaming/tool/model adapters. `ai@7.0.142` observed 15 Oct 2026; older majors also maintained on release page. [Repository](https://github.com/vercel/ai), [licence](https://github.com/vercel/ai/blob/main/LICENSE), [releases](https://github.com/vercel/ai/releases) | **First Interaction POC candidate**: reuse conversational machinery, HVM supplies persistence and guarded tools. Medium integration; direct provider usage does not require Vercel hosting. Check provider-specific parsing/accounting and disable unwanted telemetry |
| **OpenAI Agents SDK** / alternative conversational SDK | Official TypeScript/Python SDK for agents/tools/handoffs/traces. [Official SDK guide](https://developers.openai.com/api/docs/guides/agents/sdk) | Consider if it fits existing provider contracts better than AI SDK. No benchmark or exact package licence/release qualification in this audit, so **not an adoption recommendation yet**. Avoid running two SDK loops; preserve provider portability and explicit trace-data controls |
| **assistant-ui** / chat components | MIT; React/TypeScript. Release list includes `@assistant-ui/react@0.15.29`; separate package versions. [Repository](https://github.com/assistant-ui/assistant-ui), [releases](https://github.com/assistant-ui/assistant-ui/releases) | **REUSE candidate** for streaming chat/status/accessibility, styled with HVM tokens. Low/medium integration. Browser components do not provide server authorisation; use HVM storage instead of adopting hosted conversation storage by default |

### Weighted fit profiles

| Option and decision context | Fit 25 | Time 20 | Simplicity 15 | Security fit 15 | Maintenance 10 | Cost/licence 10 | Portability 5 | Gate/result |
|---|---|---|---|---|---|---|---|---|
| Existing runtime for first NBA | H | H | H | H | M | H | H | Preferred; qualify NBA bindings/recovery |
| LangGraph replacing NBA runtime | H | L | L | M | H | M | H | Not justified by current gaps |
| Microsoft framework replacing runtime | M | L | L | M | H | M | M | Language/operational overhead |
| CrewAI replacing runtime | M | L | L | M | H | M | M | No requirement for agent teams |
| Temporal replacing runtime | H | L | L | H | H | M | M | Strong durability, unnecessary migration now |
| AI SDK for new Interaction | H | H | H | M | H | H | H | POC required: tenant-safe tools and resume |
| LangGraph for new Interaction | H | M | M | M | H | M | H | Alternative if branching/recovery warrants it |

Security-fit M means HVM must supply and verify isolation; it is not a finding that the library is insecure. Current runtime H reflects existing controls, not an NBA live-test pass. Do not build a second conversational runtime while postponing this SDK evaluation.

## Communication, parsing and content

| Candidate/type | Licence/status/runtime | Coverage, cost, risks and decision |
|---|---|---|
| **Google Gmail API** / existing service | Commercial API terms; existing Node adapter. [Push/history guide](https://developers.google.com/workspace/gmail/api/guides/push) | **PRESERVE + ENHANCE**. Production send/thread reconciliation first; push notifications later if polling volume justifies Pub/Sub and renewal. Gmail acceptance is not delivery/open telemetry. Google sees mailbox data by design; HVM scopes minimise processing. Verification remains an external gate |
| **Microsoft Graph** / service | Commercial API; REST/SDK options. [Outlook notifications](https://learn.microsoft.com/en-us/graph/outlook-change-notifications-overview) | **INTEGRATE later** through existing mailbox interface. Subscription renewal, cursor reconciliation, tenant OAuth and sender policy required. Microsoft hosting/licensing and rate limits; do not assume enum support means implementation |
| **React Email** / renderer | MIT; JS/TS/React; main `react-email@6.11.1` observed 6 Oct 2026. [Repository](https://github.com/resend/react-email), [releases](https://github.com/resend/react-email/releases) | **REUSE first** for approved HTML/plain-text templates. No requirement to send via Resend. Rendering local; no external data processor added. Low/medium integration; visual inbox tests, escaped content, stable version and plain-text alternative still required |
| **MailParser** / parser | MIT, Node streaming MIME; v3.9.37 observed 8 Oct 2026. [Documentation](https://nodemailer.com/extras/mailparser), [releases](https://github.com/nodemailer/mailparser/releases) | **REUSE where raw MIME needs parsing**. Low integration, no SaaS costs, reduced custom encoding/attachment handling. It is not a sanitizer, reply-intent classifier or guaranteed quote stripper; bound memory and attachment handling |
| **Talon** / reply extraction | Apache 2.0; Python quotation/signature extraction. Latest stable/active release cadence not established in this audit. [Official repository](https://github.com/mailgun/talon) | **DEFER/benchmark only**. Helpful specialised extraction but extra runtime and uncertain maintenance fit. Keep full original alongside extracted text. Do not adopt merely to remove signatures; test multilingual/forwarded/HTML examples first |
| **Postmark** / sending service | Commercial service and permission-based terms. [Terms](https://postmarkapp.com/terms-of-service) | **DEFER** for a later qualifying subscription/bulk use case. It is not a substitute for the chosen connected-mailbox first campaign; avoid assuming one-at-a-time sending changes provider eligibility |
| **docx** / document generator | MIT, TS/JS. Current repository inspected; exact latest stable not established. [Repository](https://github.com/dolanmiu/docx), [licence](https://github.com/dolanmiu/docx/blob/master/LICENSE) | **REUSE in phase 4** for downloadable guides/reports. Local generation, no new processor. Medium template integration, visual QA needed; no new document editor |

Email/content AI classification should reuse HVM's structured generation and current approved Brand Kit rather than adopt a specialist autonomous email agent. No independently verified external content agent demonstrated better HVM fit. Return editable assets and evidence; schema checks stay local. This saves orchestration and maintenance compared with multiple writer/reviewer agents, but requires representative quality testing before claiming latency or accuracy gains.

## Research and extraction

| Candidate/type | Licence/status/runtime | Recommendation and constraints |
|---|---|---|
| **Existing Research + Lusha** / native + service | Current source and retained tests inspected; customer-specific Lusha accounts, paid calls/entitlements | **PRESERVE** service, qualify account integration. HVM pays no shared-client credit pool by default. External contact data goes only to approved tenant/account; reserve and reconcile usage. Avoid repeat enrichment using current Hive evidence |
| **Mozilla Readability** / extractor | Apache 2.0; JS. Current repository inspected; latest stable not reliably established. [Repository](https://github.com/mozilla/readability) | **Conditional REUSE** behind existing page reader for article-like content. Small integration, no external processor; DOM parsing/sanitisation still required. Could discard pricing tables or structured product data, so compare with existing extraction first |
| **Crawlee** / crawler library | Apache 2.0; Node/TS; repository states Node 22.13+ requirement. Exact stable release not pinned. [Repository](https://github.com/apify/crawlee) | **Conditional REUSE** for proven JS-rendering/queue gaps. Medium/high operational impact if browsers needed; isolated worker resource/egress controls. Keep current robots/URL/SSRF rules and evidence model. Does not require Apify hosting |
| **Firecrawl** / crawler/service | AGPL-3.0 core with separately licensed components/SDKs; hosted offering differs. [Repository/licensing](https://github.com/firecrawl/firecrawl) | **DEFER**. Not a blanket permissive library drop-in. Hosted usage adds data processor/usage charges; self-hosting adds operations and licence obligations. Needs demonstrated extraction benefit and licence review |
| **GPT Researcher** / research framework | Apache 2.0, Python. Official project inspected; exact stable release not established. [Repository](https://github.com/assafelovic/gpt-researcher) | **DEFER**, potentially an isolated report provider. Adds model/search calls, source/quality variation and Python ops. Must return HVM evidence contract; do not replace Research or grant direct Hive writes |

Expected savings are concentrated in standards-heavy extraction/rendering, not in replacing HVM's customer-specific research objectives. Public websites and imported documents remain untrusted inputs. A browser crawler does not justify bypassing access restrictions or treating all found contact data as current employment evidence.

## Measurement and observability

| Candidate/type | Licence/status | Fit and decision |
|---|---|---|
| **Apache ECharts** / browser charting | Apache 2.0; latest observed 6.1.0. [Repository](https://github.com/apache/echarts), [releases](https://github.com/apache/echarts/releases) | **REUSE** for richer funnels/trends when data exists. Local UI, low/medium integration, no new processor. HVM still owns denominators, accessible table alternatives and metric semantics |
| **OpenTelemetry JS** / instrumentation | Apache 2.0; stable v2.12.0 observed 6 Oct 2026; experimental packages version separately. [Repository](https://github.com/open-telemetry/opentelemetry-js), [releases](https://github.com/open-telemetry/opentelemetry-js/releases) | **REUSE incrementally** with existing logs/CloudWatch. Medium instrumentation work; exporter/storage costs depend on backend. Redaction and tenant-filtered operator access mandatory; do not export complete prompts/messages by default |
| **Langfuse** / AI observability platform | MIT outside enterprise directories; enterprise components separate licence. Exact latest release not qualified. [Licence](https://github.com/langfuse/langfuse/blob/main/LICENSE), [repository](https://github.com/langfuse/langfuse) | **DEFER** until existing usage/traces prove insufficient. Hosted processing or self-host operational cost; pin component licences. Helpful eval/debug UI, but another platform is not required for first campaign |
| **Existing Mongo projections + SQS + CloudWatch** / native and managed services | Already integrated, AWS usage charges | **PRESERVE/ENHANCE** event/outbox/inbox processing and materialised metrics. Avoid Kafka, warehouse or bespoke chart engine without measured need. AI analysis can consume authorised aggregate queries and explain evidence rather than run arbitrary SQL/code |

## Advertising, MCP and A2A

Official provider APIs should precede agent marketplaces for advertising. [Google Ads client-library/API documentation](https://developers.google.com/google-ads/api/docs/client-libs), [Meta Business Node SDK](https://github.com/facebook/facebook-nodejs-business-sdk) and [LinkedIn Marketing access](https://learn.microsoft.com/en-us/linkedin/marketing/increasing-access) provide the integration starting points. Access tiers, SDK licences and current pinned versions must be qualified in the later channel build; no advertising SDK is approved for installation here. HVM needs per-client account authority, budget controls and provider-state reconciliation. Paid media spend remains separately authorised. Direct API integration has medium/high effort and provider lock-in, but clearer contracts than an unqualified third-party agent.

[OpenAI Ads documentation](https://developers.openai.com/ads) now describes advertiser integration capabilities. Do not assume that every sponsored-agent format is generally accessible or that it is exposed through A2A. **DEFER** until eligibility, execution contract, identity, measurement and commercial terms are confirmed for HVM. This is not a claim that OpenAI advertising does not exist.

[MCP](https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices) can standardise tool invocation. The [MCP Registry](https://registry.modelcontextprotocol.io/docs) is a discovery source, not a security certification or entitlement grant. Protocol/SDK licensing does not license a server's underlying data/service. For now preserve direct Gmail/Lusha APIs; use an allowlisted MCP adapter only when a specific maintained server removes meaningful integration work. Require OAuth audience/scope validation, credential isolation, pinned tool schemas, destination controls and auditability. Do not pass HVM tokens through to arbitrary servers.

[A2A's specification](https://a2a-protocol.org/latest/specification/) supplies interoperable task/artifact exchange. It does not establish provider reliability, licence, cost or permission to operate on customer data. Registry/marketplace listings are leads for diligence, not production execution choices. No external A2A agent was qualified in this audit against HVM's evidence, cancellation, tenant, retention and spend requirements. Keep a service-local adapter seam; defer a gateway, agent marketplace and automatic provider selection.

## Shortlist and proof required

1. React Email: compare rendered HTML/plain text in Gmail and Outlook; freeze approved template/version.
2. MailParser: representative MIME encodings/attachments, malformed/oversized payloads and safe display; use only where needed.
3. AI SDK + assistant-ui: a new public Interaction slice with tenant isolation, guarded tools, stream interruption and resume. LangGraph is the alternative if durable branching needs justify it.
4. OpenTelemetry + ECharts: redacted correlated events and trustworthy projections before decorative dashboards.
5. Readability/Crawlee only after a failing extraction fixture demonstrates a gap.

These are recommendations for review, not authorisation to add dependencies. A pinned dependency licence/advisory check and compatibility test is an implementation gate; permissive licensing does not remove hosted-service terms or data-processing obligations.
