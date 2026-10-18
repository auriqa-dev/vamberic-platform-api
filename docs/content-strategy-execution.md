# Content Strategy: Execution Briefs and external delivery

This extends the existing Content Strategy implementation. Content Brief is the `content` specialisation of Execution Brief. Other types cover PR, events, research, partnerships, customer evidence, advertising, technical work and other interventions. Non-content briefs do not require content classification or personalisation fields.

## Separate records, shared architecture

- The existing Capability Registry and global Action Types describe available capabilities/interventions. Existing workspace Integrations describe connected applications.
- Strategy recommendations remain `action` records, with their own explicit human approval and source strategy revision. Canonical Action Library handoff creates/updates the same `action_definitions` draft; it is not automatic execution approval.
- A `brief` records business scope, rationale, research/assets/evidence, work description, deliverables, channels/messages where relevant, constraints, optional budget/date context, brand requirements, approval requirements, completion criteria, intended outcomes and success measures. Existing content briefs remain compatible through defaults.
- An `executor` is a workspace/brand operational resource: internal HVM, connected application, human specialist, external agency, Queen or client team. It has named capabilities, optional existing capability references, contact details, constraints and availability. Internal resources require a real registry reference; applications require a connected workspace integration. Human resources cannot masquerade as integrations. Resource creation grants no account access.
- An `execution` pins the exact approved brief revision and chosen executor, and derives its Action Library relationship server-side. It records proposed, approved, assigned, accepted, in progress, awaiting input, completed or cancelled progress; external reference, notes and completion date. Action cards show related execution progress without rewriting an approved recommendation each time progress changes.
- Delivered outputs enter the existing asset inventory, with the execution, approved brief revision, producer, publication/date, file/text/URL, source lineage and usage restrictions. They remain drafts.
- Observations use the existing `effectiveness` record and Events infrastructure, adding execution/asset links and further opportunities. Completion is not evidence of effectiveness or commercial attribution.

## Persistence and authority

Use existing transactional workspace fencing, human authorisation, current approved business/Brand Kit context and protected versioned `content_strategy_record` events. No migration, duplicate agency database or new effectiveness system. Each revision exposes its immutable evidence Event ID; existing EvidenceReference and ScopedLearning structures already support Events and outcomeEventIds. Outcomes are observations for that architecture, not automatically promoted learned facts.

Assignment requires workspace approve authority, a current approved brief, unchanged sources/context, an approved non-blocked recommendation, and an existing non-retired canonical Action Library handoff. It preserves the brief's business scope. Changing the pinned brief or executor requires cancelling and creating another assignment. Completion requires a date; completed/cancelled executions cannot restart. Related records prevent destructive removal. Operational status updates do not falsely invalidate the factual contents of a delivered asset.

## Standard handoff and return

`hvm.execution-brief.v1` generalises `hvm.content-production.v1`, which is retained as the specialised content contract identifier. Export includes workspace, exact brief/version/fingerprint, source versions, approved brand guidance, Action Library identity, actual configured capability/integration metadata and available operational resources/assignments. Metadata is not an execution permission.

Initial execution is manual. Export JSON retains the machine contract; Copy brief produces readable text from that same approved data, without another model call. HVM does not send the brief, select a supplier automatically, authorise payments or agree a budget.

The return contract includes the existing asset JSON Schema and authenticated workspace save endpoint, plus the effectiveness observation schema. Deliveries reference the exact approved brief revision and assignment; files reuse the existing private research document store. Observation Event IDs make outcomes referenceable through existing evidence/learning structures.

Assets expose read-side reuse eligibility only when approved, sources remain current and explicit owned/licensed/reference-only rights and permitted uses are recorded. Unknown/restricted rights or drafts are ineligible. Eligibility is a prerequisite, not a publication, recipient or channel authorisation. Communications and NBA consumers must continue applying their own policies and restrictions. No new distribution consumer, automatic promotion to core truth or autonomous learning is introduced here.

## Initial delivery boundary

Configured internal capabilities and applications can be identified and recorded, but this increment does not add automatic execution adapters, agents, specialist editors, portals, supplier management or sending. Human review determines capability suitability. Existing HVM generation creates strategies and briefs with its existing LLM infrastructure; the plain-text brief export does not make a provider call. External execution still works when no automatic adapter exists.

A fifth Empress-managed Action Type, `external_initiative`, extends the original four (`content_creation`, `content_adaptation`, `content_research`, `content_review`). The initialiser is idempotent and refuses conflicting definitions. None have been initialised live for this release.
