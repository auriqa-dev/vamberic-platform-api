# Workspace billing exemption — unapplied schema v19

Ordered release dependency: **11 → 12 → 13 → 14 → 15 → 16 → 17 → 18 → 19**. v19 is not independently deployable from 11. No migration has been applied by this implementation.

Migration `019-workspace-billing-exemption` updates only the `crm_workspaces` validator. It adds an optional versioned `billingExemption`: internal treatment, active/revoked status, fixed `hvm_platform_and_agent_services` scope, positive revision, reason, approving human/time and required revocation details when revoked. There are no new collections, indexes, backfills or legacy workspace edits. The exact v18 target is frozen; earlier migration targets remain unchanged.

Structural Mongo checks cover the optional shape, allowed treatment/scope/status, required fields and bounds. Cross-field chronology (revocation cannot precede approval), live Empress authorization, expected revision, idempotency, source references and transactional event consistency remain application checks. Synthetic migration planning is not installed-Mongo validator parity; native parity remains a separate release gate.

Server endpoints:

- `GET /api/v1/hvm/empress/workspace-billing/:workspaceId`: minimal governance projection.
- `POST` at that path: approve/revoke with request key, expected revision and reason.
- `GET /api/v1/hvm/workspaces/:workspaceId/billing-treatment`: existing independent Queen workspace authority required.

Empress authority does not imply workspace access. Exemption changes use a real workspace serialization write and existing append-only `events`. Exact retries return the prior receipt; altered request payloads or stale revisions fail. Generic CRM/event writers cannot forge the exemption or reserved event. The app separates Empress governance from Queen read visibility and retains an idempotency key across a failed-response retry.

Active treatment resolves HVM platform/Agent billed amount to zero, including standalone PSU services. Gross usage/provider costs remain recorded; direct third-party charges, budgets and permissions are unaffected. Existing agreement calculation applies the treatment while preserving the gross recommendation/cost snapshot and existing separate commercial approval rules. It does not rewrite historical agreements. Revocation resumes existing commercial terms.

There is no invoice or standalone PSU charging engine in this baseline. `effectiveWorkspaceBilling` is the fail-closed policy seam for a future billing-time consumer, not a claim that invoices were generated or waived in a live external system. No dummy Swarm is required. Billing treatment confers no Agent execution, workspace membership, channel integration, spending or marketing-launch authority.

Local migration artifacts are built by `build-migration-releases.mjs`; their manifest is marked not authorized for application. Native schema/data preflight, backup/recovery review, ordered migrations, immutable release packaging, deployment and live client onboarding all remain separate gates. Tracking remains design-only; its older proposed v19 label is not an implemented migration and must not replace this approved billing v19.
