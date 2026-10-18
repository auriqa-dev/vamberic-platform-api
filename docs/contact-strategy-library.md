# Contact Strategy template library

Implemented 2026-10-09. Contact Strategy defines client business policy; NBA chooses actions. No new Agent registration or parallel workflow engine is introduced.

## Catalogue and Hive

The global, code-versioned catalogue is `src/services/contact-strategy/catalogue.ts`. It contains the 25 agreed templates in six categories: customer lifecycle; communication eligibility/compliance; contact frequency/engagement; opportunity/sales management; proposition/context; human oversight. Descriptions, purpose, applicability context, policy type, configuration prompts, enforcement meaning, precedence and review requirements are client-independent.

- CS-001: Customers don't receive acquisition marketing
- CS-002: Prospects don't receive customer communications
- CS-003: Don't market products already purchased
- CS-004: Cross-sell to existing customers
- CS-005: Respect customer lifecycle stage
- CS-006: Re-engage former customers appropriately
- CS-007: Respect communication preferences
- CS-008: Respect unsubscribe requests
- CS-009: Require appropriate marketing permission
- CS-010: Respect suppression lists
- CS-011: Avoid excessive contact
- CS-012: Don't repeat unanswered messages
- CS-013: Treat inactive contacts differently
- CS-014: Stop irrelevant communications
- CS-015: Respond to buying signals
- CS-016: Prioritise high-value opportunities
- CS-017: Don't interrupt active sales conversations
- CS-018: Escalate sales-ready contacts
- CS-019: Respect existing relationships
- CS-020: Manage existing opportunities carefully
- CS-021: Recognise lost opportunities
- CS-022: Avoid competing propositions
- CS-023: Use relevant context
- CS-024: Prioritise inbound enquiries
- CS-025: Escalate sensitive interactions

Workspace instances reuse canonical `contact_strategy_policies` V14, already supported by schema 27. Immutable key/version snapshots have template/version provenance in `source.reference`, editable plain-English clauses, optional existing objectives and subject scopes, and supersession links. Save appends a draft; approval appends a recorded snapshot and a protected human audit receipt; deactivation/removal appends withdrawal. History is retained. A new draft does not deactivate the prior approved version. A generic `recorded` status is not execution authority. Additional customised clauses are retained on edit.

No new schema migration or collection is required. Template updates do not rewrite instances. Earlier template versions remain preserved and are flagged for reviewed mapping; automatic version upgrades are deliberately absent.

## Provisioning and backfill

`planStrategyTemplates` adds only missing drafts. Any historical adoption, including withdrawal, prevents reinstatement on reruns. Mismatched keys/provenance stop that workspace transaction. Existing non-template recorded policies are reported for semantic comparison; automatic semantic equivalence is not assumed. Existing client policies remain visible in the UI.

Current onboarding uses `queenClientBase`; direct client provisioning uses `initialiseStrategyTemplates`. Both insert drafts within their existing transaction. The older Queen direct writer retains its existing schema gate; it was not widened. All current schema-27 provisioning paths initialise the library.

The operator command is bundled as `dist/backfill-contact-strategies.mjs`. No arguments performs read-only preview of non-archived client workspaces. `--apply-workspaces reviewed-workspace-ids.json` applies only that exact reviewed ID array. It requires dev and schema 27; each workspace is transactional, so earlier workspace commits may survive a later conflict. Re-run preview and retain emitted created IDs. No existing policy, consent or communication record is modified. No automatic strategy approval.

## Queen / client administrator experience

Use the existing Contact Strategy menu. Review 25 templates in categories; filter status or needs-review, sort recent changes, edit/save, approve/activate, deactivate, remove inactive drafts, inspect history. Bulk deactivation/removal reports partial failures and retains failed selection. Saved results display immediately. Client administrators have the same scoped access as assigned Queens; unrelated workspaces and Empress-only identities are not granted access.

Henry accepts a requested change to the selected rule. One structured response proposes wording, explanation, conflicts and questions. Use wording, save and approve are separate actions. The original and any approved version remain unchanged until explicit save/approval. Latest interpretations and usage are retained in protected events and available after reload. Interpretation uses the existing runtime OpenAI project/key with gpt-6-luna, no tools, no automatic retries, bounded response/time, and exact-request deduplication. Failed structured results retain reported usage. No live provider qualification has yet been performed for this function.

## NBA integration boundary and current limits

Precedence: law; consent/objection/suppression; platform restrictions; approved client policies; objectives/preferences; recommendations. `evaluateContactStrategies` combines current policy assessments with mandatory legal/suppression/platform guards, producing permitted/prohibited/deferred/escalated and policy/version/reason/evidence trace. Unknown guard or missing assessment defers. Prohibitions win. Every result has `executionAuthorised: false`.

`recordContactStrategyAssessment` loads workspace policies and approval receipts and writes an assessment event inside a caller-authorised transaction. It binds the trace to an action, product/offer, subject, channel and purpose. A future NBA adapter must resolve fresh authoritative product-specific relationships, transactions, opportunities, interaction history, permissions and evidence, then supply assessments. This is an integration contract, NOT a completed natural-language policy interpreter or live communications enforcement system. It does not calculate live lifecycle, frequency or semantic conflicts itself. No public endpoint accepts assessments; no message sender is connected. The UI states that automatic NBA application is not yet available.

Do not treat template approval or model wording as consent. No universal customer flag substitutes for product-specific ownership. A future execution admission check must recheck suppression and current approval immediately before sending; it must not reuse a stale permitted trace.

## Compliance guidance

Reviewed [ICO business-to-business marketing guidance](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/business-to-business-marketing/) on 2026-10-09. Subscriber type, channel and purpose matter; UK GDPR still applies to personal data used in B2B marketing. Sole traders and some partnerships are individual subscribers. A customer relationship alone is insufficient to establish permission. Objections and suppression remain independent of optional templates. The ICO page notes that guidance is under review following the Data (Use and Access) Act. The future eligibility adapter must use current applicable guidance and authoritative evidence; this increment does not automate a complete legal determination.

## Acceptance boundary

Local checks cover catalogue, idempotency, rollback, isolation, approval/audit, preserved customisations, Henry deduplication/usage and responsive UI. No existing live workspace has yet been populated. Deployment, reviewed ID-scoped backfill, signed-in app verification and user approval remain the release/acceptance steps. No full NBA/Communications Agent is claimed operational.
