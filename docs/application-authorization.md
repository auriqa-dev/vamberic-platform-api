# Application, actor and workspace authorization

Hive is the shared Vamberic data platform. Vapp is the internal portfolio/operator application. HVMapp is the future application for client marketing operations and HVM agents. Shared storage does not confer access or establish legal ownership. Workspace scope is an operational isolation boundary; human CRM `owner` remains accountable responsibility.

## Trusted identities

The API verifies Cognito RS256 access tokens, issuer, expiry, subject and `client_id`. The configured Cognito issuer/client pair maps to **Vapp only**, in the server composition root. Application headers, workspace headers, custom role claims and actor claims confer no access. Other clients still fail authentication. The original `req.auth` remains compatible; `req.authorization` adds frozen application and actor context.

Human actors use verified Cognito subject plus issuer. Agent and system actors have independent server-registered identities; they do not impersonate people. Swarm Queen is a Partner business role; actions performed by that person retain the verified human actor identity. The Partner record is not an actor or an implicit privileged role. Existing human-only CRM owner schemas remain unchanged; actors may instead appear in task assignment, events and audit history.

`src/authorization/policy.ts` owns the policy. Each authority issues contexts only after its trusted authentication adapter runs; copied JSON and contexts from another authority are rejected. These are process-local integrity checks, not a replacement for authenticating tokens/workloads. Configuration factories must never receive browser input.

## Access matrix

| Application/actor             | Internal Vamberic data                                  | HVM workspace raw data                              |
| ----------------------------- | ------------------------------------------------------- | --------------------------------------------------- |
| Vapp human                    | Operate through existing routes and business safeguards | Deny, including with membership                     |
| HVMapp human (future)         | Deny; any later requirement needs explicit design       | Exact active application/actor/workspace membership |
| System/agent (future)         | Exact service grant                                     | Exact service grant for that workspace              |
| Customer product app (future) | Deny pending explicit policy                            | Deny pending explicit policy                        |

No workspace means **internal only**, never global/shared. Null, empty and malformed workspace IDs fail closed. A Product is not a Workspace: one workspace can contain multiple Products/offers, and a Product can occur in several contexts. Shared Product IDs, client organisation IDs, external/provider IDs and CRM provenance actor fields are never grants. No explicit sharing grants are implemented.

`authorize(context, action, resource)` evaluates actor, application, resource category, action and workspace. `scopeFilter` authorizes first and returns an exact Mongo predicate; future adapters must use it on every lookup/update, including external-ID lookups. A direct record must be authorized with its actual workspace, never a browser-supplied substitute. Creation must bind the authorized scope server-side; updates must not reassign scope.

The current operational middleware explicitly permits only the existing Vapp routes. Unknown operational routes fail closed until mapped. It authorizes internal scope before database access; shared `INTERNAL_SCOPE` predicates keep lists, counts, linked projections, direct IDs and Product CAS updates in that scope. Workspace or missing IDs have the same existing not-found responses. No HVM endpoint is enabled.

## Membership and service foundation

`crm_workspaces` cannot currently express membership. No new storage is needed while HVMapp remains inactive. `WorkspaceMembership` defines the minimum future server-resolved contract: exact actor (including issuer for humans), application, workspaceId, active/inactive status and viewer/operator role. Viewer permits read; operator permits read/create/update. Neither grants hard delete. No queen/admin/approver matrix or cross-workspace wildcard exists.

A future membership store must be read by a trusted adapter per request (including active workspace checks), with explicit revocation behavior. Authority configuration is snapshotted: do not cache membership-bearing authorities across requests after grants can change. Before enabling HVMapp, add that adapter and durable membership lifecycle; do not infer membership from CRM records or token claims.

The server-only service factory requires a registered grant matching actor, application, resource, action and internal or exact workspace scope. Empty grants deny all. A future webhook/import/agent/job adapter must authenticate its workload independently and use the policy before I/O. There is no HTTP system impersonation switch and no default production service grant. Database setup and maintenance remain separately privileged CLI tools, not Vapp endpoints.

## Resource review

All listed categories are covered by the central resource vocabulary. Policy permission does not create an endpoint, relax business invariants or authorize arbitrary cascade deletion.

| Resources                                                                 | Current exposure / handling                                                                                                                       |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Products                                                                  | Internal list/read/create/update; scoped direct lookup and CAS predicate; no delete route                                                         |
| People, Organisations, Opportunities                                      | Internal list/detail; scoped linked projections; existing guarded preview/delete                                                                  |
| Contact points, Product Relationships, Organisation Relationships, Events | Internal projections/enquiry graph only; no generic HTTP CRUD                                                                                     |
| Tasks, Campaigns, Leads, Pipelines                                        | No new HTTP endpoints; internal foundation helpers retain existing scope guards; Leads require workspace by schema and remain unavailable to Vapp |
| Marketing Permissions                                                     | Trusted enquiry consent handling and exact-scope resolution; no new operational endpoint                                                          |
| Entitlements, Subscriptions, Transactions                                 | No new operational endpoints; existing billing/history deletion blockers remain                                                                   |
| External References                                                       | No HTTP external-ID lookup; internal foundation lookup stays internal; future adapter must authorize workspace before lookup                      |
| Workspaces, Import batches                                                | No generic operational endpoint or all-workspaces admin bypass                                                                                    |

Low-level Mongo collections and CRM foundation helpers are trusted backend primitives, not independently authenticated APIs. Source/updatedBy actor metadata is provenance only. Workspace writes in the foundation service remain blocked until an authorized HVM adapter exists. Future integration must bind authorization to the same scope used for reference checks and writes, retaining immutable scope and transaction safeguards.

Public enquiries retain their separate anonymous route before Cognito middleware, strict input allowlist, internal Product lookup and internally constructed record scope. Callers cannot supply workspace or actor fields. Trusted Product/config routing would require a later design; the current path creates only internal records. Existing spam/rate/consent and post-commit notification behavior is unchanged.

Hard-delete and preview first exclude workspace targets, including malformed falsy scope values. Workspace dependencies remain blockers. Existing transactional plan recomputation, confirmation, preview token, CAS and financial/consent/history blockers are unchanged. Application policy never bypasses these safeguards.

## Audit and future work

Mutable operations and delete-preview emit structured best-effort logs containing actor, application, internal workspace scope, action, resource category, validated resource ID when available, timestamp, HTTP status and outcome. Creates attach the generated ID after insertion. Invalid/unavailable IDs are omitted. Request bodies, arbitrary headers, tokens and raw authorization internals are not added. Existing hard-delete audit remains. Routine reads do not create audit events. Logs are not a durable audit ledger; request termination or logging transport failure can lose them.

Vapp may later consume deliberately designed reporting summaries from HVM, not raw client operational data or implicit sharing grants. Next: design HVM membership provisioning/revocation and its authenticated server adapter, including workspace active-state checks and scoped repository integration, before enabling its client or endpoints. No HVM/Lead Gen/agent UI, sharing, public workspace routing, schema migration or deployment is included here.

## Swarm Queen / Partner relationships

The [Partner foundation](hvm-partners.md) adds business identities and workspace operating assignments, not memberships or permissions. `partnerId` is never a Cognito subject and cannot authenticate an actor. A human-to-Partner membership resolver remains future work; client-user memberships remain independent.

A future trusted HVM resolver must combine verified human/application context, explicit human-to-Partner permission, active Partner status, exact active workspace assignment and allowed actions. Primary/supporting assignment roles do not themselves grant viewer/operator permissions. Suspended/ended Partners may retain assignment history but must receive no Partner-derived grants. Reevaluate grants on revocation; do not cache membership-bearing authorities indefinitely.

Assignments never grant entitlements and ending assignments must not delete or revoke client subscriptions, entitlements or instances. Entitlement access remains a separate functional check after authorization. Vapp workspace isolation, server-only grant construction and the closed HTTP route allowlist are unchanged. No Partner-based repository bypass, HVM client activation or membership resolver is added in this task.

### Partner memberships and workspace integrations (unapplied v3)

`hvm_partner_memberships` stores issuer/subject-qualified human membership in an operating account, not a workspace grant. `owner` and `member` are Partner relationship roles, not central authorization permissions. Future resolution must check active/unarchived human membership, Partner eligibility, active workspace assignment, workspace state and explicit permitted actions on every request. Independent client-user membership remains separate. No resolver or HVM route is enabled here.

`workspace_integrations` requires a workspace. Vapp cannot operate its records; future HVMapp reads/writes require central scoped authorization and queries that include workspaceId. Provider names, external account IDs, secret references and Partner membership/assignment are never bearer access grants. Systems/agents need explicit resource/action/workspace grants. Credential-store IAM and provider calls remain deferred; a Mongo reference does not authorize Secrets Manager reads. See [workspace onboarding](workspace-onboarding.md).
