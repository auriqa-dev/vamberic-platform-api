# HVM Swarm Queen / Partner foundation — unapplied schema v3

**Swarm Queen** is the external business role. **Partner** is its neutral domain identity. A Partner may operate several client workspaces and supports several authenticated humans through separate memberships. It is not a user role, a Cognito subject, an agent actor, a subscription customer identifier or the legal owner of client data.

The operating structure is HVM → Partner → assigned client workspaces → Products/future Offers → capability instances and client commercial records. The workspace remains the operational/data boundary.

The four independent decisions are:

- **Partner assignment** defines operating responsibility.
- **Entitlement** defines what capabilities the client may use.
- **Authorization** determines whether the authenticated actor may perform an action.
- **Billing treatment** describes whether/how the client pays.

Ending a Partner relationship does not end the client's subscription, revoke its entitlements, remove its workspace or delete its capability instances. No commercial record receives a Partner-owner field. Queen remuneration, referral commission, revenue share and advisory billing are not implemented.

## Partner account and assignment collections

`hvm_partners` has a canonical `partner_…` ID, required `displayName` and `status`, optional `primaryPersonId`, optional `organisationId`, optional `endedAt`, plus existing creation/update, source/provenance and archive fields. Person/Organisation references reuse the internal registry; names/contact details are not copied. The display name is a Partner-facing label, not a second contact record. No speculative partner type is required.

Statuses: **invited, active, suspended, ended**. Ended status requires `endedAt`; other statuses forbid it. Only ended records may be archived. Historical imported `endedAt` may predate database creation, but cannot postdate `updatedAt`.

`workspace_partner_assignments` has `partnerassignment_…` ID, required `workspaceId`, `partnerId`, `role`, `status`, `assignedAt`, creation/update timestamps, optional human `assignedBy`, and `endedAt` when ended. Roles are **primary** or **supporting**. Statuses are **active** or **ended**; revocation/termination of the relationship is recorded by ending the assignment. No permissions are embedded in these records.

Assigned time cannot postdate update time; end time must be between assigned time and update time. Updated time cannot predate creation. Active assignments cannot be archived. Ended assignments remain historical records and may be archived.

One Partner record can have assignments to many workspaces. Each workspace can have zero or one active primary and multiple active supporting Partners. A Partner cannot simultaneously have two active assignments to the same workspace, even under different roles. Ended history and later reassignment are permitted. A workspace is not required to have a primary at all times.

## Reference integrity and history

`validatePartnerRelationships` is pure proposed-state validation, not a repository or authorization adapter. It checks existing Partner/client-workspace references, internal Person/Organisation registry references, unique identities, active workspace state and active assignment invariants. A client-scoped contact or organisation cannot become a global Partner registry reference. Internal client organisations identify workspace context; their IDs do not grant access.

Ended history may reference archived workspaces. Partner suspension/ending can retain existing assignment rows without rewriting them: partner eligibility and assignment status are distinct checks. A suspended/ended Partner must not receive access merely because an old assignment still says active.

Future writers must authenticate/authorize through the central policy, lock/recheck references and preserve immutable assignment workspace/Partner identity. A handover should end the old assignment and create a new historical relationship rather than reassign the old row. The database uniqueness constraints are the concurrent-write backstop. No assignment edit/delete API is added here.

Existing Vapp hard-delete preview/delete now blocks deletion of a Person or Organisation referenced by any Partner, including archived/ended Partner history. Existing transaction, preview-token and commercial/history safeguards remain. There is no cascade from Partner or assignment termination to client records.

## Human identity, client users and authorization

Partner ID is never `cognitoSub`. `primaryPersonId` identifies a business contact and does not authenticate that person. Team members use separate `hvm_partner_memberships` records; being employed by the Partner organisation is not an automatic grant.

A Queen's actual actions use the verified **human actor** in events, tasks, approvals and logs. `assignedBy` uses the existing human-only `{type: human, id}` metadata shape. The authenticated subject must be supplied/verified by a future trusted writer; schema validation alone cannot prove who performed an action. The Partner record is not substituted for that actor. Human-only CRM owner semantics remain unchanged.

Client workspace membership and Partner responsibility are different relationships. A client user may have access to their own workspace without being a Partner or having any assignment. A Partner user may be authorized for several separately assigned workspaces without owning their data.

The existing central authorization policy and scope filters remain authoritative. HVMapp is still inactive. No membership is inferred and no repository is exposed based on `partnerId`. The authorization resource vocabulary includes the Partner, membership, assignment and integration collections; Vapp still denies workspace-owned records. The internal Partner registry has no new Vapp endpoint and does not expose a roster of client workspaces.

Before enabling HVMapp, a trusted per-request resolver must combine:

1. Verified human identity and trusted HVMapp application binding.
2. Explicit human-to-Partner membership/delegation, or an independent client-user membership.
3. Active, unarchived Partner eligibility and the exact active workspace assignment for Partner users.
4. Active workspace and explicit permitted actions.

`primary`/`supporting` do not automatically map to the authorization policy's viewer/operator permissions. Ending an assignment or suspending a Partner must remove Partner-derived grants on subsequent authorization checks without touching client entitlements. Any independent client-user membership must be evaluated separately. The full resolver, grant revocation/cache behavior remain future work; this task does not retrofit Partner revocation onto existing generic membership configurations.

## Documentation examples only — no seeded data

- **Built Matters:** workspace Built Matters; Partner Aly / HVM Queen; separate Offer, Strategy/ICP and Lead Gen capabilities/instances; entitlement billing treatment internal.
- **Odyssiant:** workspace Odyssiant; an HVM Queen assignment; client commercial package; standard or another explicitly agreed treatment later. No price or remuneration rule is assumed.
- **e-c / Tom:** one Partner record can be assigned to e-c, Agreus and future e-c clients. Each client has a distinct workspace with independent Product contexts, instances, subscriptions and entitlements. Ending one assignment does not affect another client.
- **HVM itself:** uses the same client-workspace and assignment structures. Fee exemption uses entitlement/charge treatment, not a special Partner role or organisation-name rule.

## Indexes and validators

The Partner refinement adds six indexes; none is sparse:

| Collection / name                                                 | Keys                                   | Uniqueness/filter                                  | Concrete query/invariant                                                    |
| ----------------------------------------------------------------- | -------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------- |
| hvm_partners / `id_unique`                                        | `{id:1}`                               | Unique, no filter                                  | Fetch business identity by canonical ID                                     |
| workspace_partner_assignments / `id_unique`                       | `{id:1}`                               | Unique, no filter                                  | Fetch assignment/history by ID                                              |
| workspace_partner_assignments / `partner_status_workspaces`       | `{partnerId:1,status:1,workspaceId:1}` | Non-unique, no filter                              | Which client workspaces does this Partner currently manage?                 |
| workspace_partner_assignments / `workspace_status_roles`          | `{workspaceId:1,status:1,role:1}`      | Non-unique, no filter                              | Primary/supporting roster, including status-specific history                |
| workspace_partner_assignments / `workspace_active_primary_unique` | `{workspaceId:1}`                      | Unique; partial `{status:"active",role:"primary"}` | At most one active primary per workspace                                    |
| workspace_partner_assignments / `workspace_partner_active_unique` | `{workspaceId:1,partnerId:1}`          | Unique; partial `{status:"active"}`                | No redundant simultaneous primary/supporting relationship for the same pair |

There is no standalone Partner-status index until an actual directory query requires one. The partial unique indexes keep ended history outside the constraint; active archived records are rejected by validators rather than silently escaping uniqueness.

New Mongo validators enforce status/role enums, ID/reference shapes, required timestamps, human `assignedBy`, ended/archive consistency and timestamp ordering. Cross-document references and authorization remain trusted service responsibilities. All new collections remain empty after migration; no clients, memberships, assignments or integrations are inferred.

This refines **003-commercial-foundation**, still **2 → 3**, not v4. Including the existing commercial proposal, v3 now proposes **eight new collections, nine validators and twenty-three indexes**, for **27 domain collections / 84 application indexes**. Existing Products, workspaces, entitlements and subscriptions are not rewritten. The existing entitlement validator remains additive; all other existing validators remain unchanged.

Read-only dev preflight on 2026-09-27 confirmed live schema 2, the above plan, no conflicts/incompatible indexes/uniqueness risks, and two existing Products. No Mongo state changed. Dry-run verifies the plan and existing-data compatibility; it does not exercise future write adapters or perform index creation.

See [Partner memberships and workspace onboarding](workspace-onboarding.md) for agency membership, dual Partner/client relationships, integration schemas and the seven additional indexes.

## Secure later apply invocation — not executed

Only after explicit approval, run from the repository root. This uses the existing dev configuration and passes credentials only to the child process. It never prints the secret/URI and does not persist it in a file or shell history.

```sh
python3 - <<'PY'
import json
import os
import subprocess
import sys

result = subprocess.run(
    ['aws', 'secretsmanager', 'get-secret-value',
     '--profile', 'vamberic-admin', '--region', 'eu-west-2',
     '--secret-id', 'vamberic/dev/api', '--output', 'json'],
    capture_output=True, text=True,
)
if result.returncode:
    sys.exit('Could not load dev configuration. Check AWS SSO login; no Mongo command ran.')
try:
    uri = json.loads(json.loads(result.stdout)['SecretString'])['MONGODB_URI']
    assert isinstance(uri, str) and uri.startswith(('mongodb://', 'mongodb+srv://'))
except (KeyError, ValueError, TypeError, AssertionError):
    sys.exit('Existing configuration has no valid MONGODB_URI; no Mongo command ran.')
env = os.environ.copy()
env.update(
    MONGODB_URI=uri,
    DEPLOYMENT_ENV='dev', NODE_ENV='production', AWS_REGION='eu-west-2',
    COGNITO_USER_POOL_ID='eu-west-2_CogD1Prpz',
    COGNITO_CLIENT_ID='4pnadj0nk0chv865shdqtb4p9r',
    NOTIFICATION_EMAIL_ENABLED='false',
)
sys.exit(subprocess.run(
    ['pnpm', '--filter', '@workspace/api-server', 'db:setup', '--apply'],
    env=env,
).returncode)
PY
```

Use `--dry-run` instead of `--apply` for another read-only preflight. No apply or deployment is part of this implementation.
