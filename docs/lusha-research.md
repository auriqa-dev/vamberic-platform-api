# Lusha and evidence-led Research

Local implementation, 14 October 2026. Not deployed or qualified against a live Lusha account.

## Existing application boundaries

Research remains application functionality. Existing PSU, ICP, offers, Library and Henry generation paths stay intact. No autonomous Agent registration, replacement capability framework, NBA, outreach or campaign sending is introduced.

Empress can prepare a versioned Lusha definition using its existing catalogue/editor; publication remains an explicit action. Workspace Integrations connects the client's own account. Keys are sent only to the dedicated authenticated endpoint, held in Secrets Manager under `hvm/<environment>/lusha/<workspaceId>/`, and never returned or included in generation context. The API task role is opt-in and prefix-scoped. Old credentials receive a seven-day recovery window after replacement; cleanup failures are logged without credential values.

Research, supplementary discovery and enrichment permissions are independently recorded. Each paid operation is explicitly requested. No unattended Lusha calls are scheduled. Existing app AI work receives no new monetary or call quotas. Actual provider credits are recorded separately; a missing billing response is unknown, never free.

## Candidate flow

1. Research produces expiring candidates, findings and proposed campaign assessments. Discovery alone creates neither managed contacts nor execution authority.
2. Review the organisation's existing Hive dossier: identity, contacts, contact restrictions, research and campaign evidence, plus coverage limits. Select and explicitly save an organisation if needed.
3. Research relevant people using the selected approved buyer roles and public sources. Review a source quotation and attest current employment and role. This is a human review, not a claim that a page retrieval timestamp proves employment.
4. Request Lusha search and then email reveal. Exact name/domain identity matching is required. Waterfall is disabled; only explicit Lusha A+ work emails qualify. Private, lower-grade, unknown-grade and third-party waterfall addresses do not qualify.
5. Save the verified candidate through existing Contact Management. Promotion is transactional, tenant-scoped and idempotent. The record appears immediately, with the original candidate/lookup available as provenance.

Supplementary discovery is a separate explicit operation after a completed public-source people search for the same organisation and approved context. It requests one page of at most 20 profiles. Those results are suggestions without employment verification or accepted email; they re-enter the public-source review flow. It is not an exhaustive search or an automatically repeated job.

Unaccepted working candidates expire after 30 days (proposed platform default). Read projections redact expired data even before the existing Research worker sweeps it. Rejected identities are scrubbed immediately. Promoted records retain provenance. Paid-lookup identity keys expire with candidate retention; charge/audit history remains. Original research evidence retains its existing evidence policy.

## Failure and recovery

Workspace locks, per-person lookup keys, state checks and connection revision checks prevent automatic duplicate paid requests. A network timeout or ambiguous response is held for review; it is never blindly retried. Disconnect blocks later stages, but cannot cancel a request already received by Lusha. Known charges and uncertainty remain recorded. A fresh automatic retry is not a recovery mechanism: uncertain charges require reconciliation with the provider before a new authorised lookup.

Provider contract source: https://docs.lusha.com/openapi.json, retrieved 14 October 2026. V3 `/account/usage`, `/contacts/search`, `/contacts/enrich` and `/contacts/prospecting` are implemented. Account/plan entitlement and actual confidence availability are unverified until bounded live testing. An account connection test is not a claim that paid capabilities are qualified.

## Future NBA handoff

Consumers should reuse the authorised Research request: requestKey/idempotency, workspace/brand, campaign version, approved offer/ICP revisions, objective, destinations, requested missing intelligence and freshness. The dossier exposes current restrictions and coverage. Results contain job status/progress, evidence, candidate identity/matches, proposed assessments, unknowns, lookup outcome and readiness for review.

NBA must re-read current approved context, suppression/contact strategy and identity, deduplicate organisation/contact research, and acquire management ownership before execution. A candidate, A+ address, accepted finding or completed Research job is never an outreach permission. Current management evidence is historical; absence is not proof of eligibility. Do not add arbitration or sending to this integration.
