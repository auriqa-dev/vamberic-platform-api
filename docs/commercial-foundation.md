# Commercial and capability foundation — refined schema v3 proposal

**Not applied.** This replaces the earlier unapplied Product-based capability/package proposal. Dev was checked read-only on 2026-09-27: live schema remains **2**, with two Products and no other domain records. No pricing, clients, capabilities, packages, entitlements or dependency graph is seeded.

See [Swarm Queen / Partner relationships](hvm-partners.md) for the two additional relationship collections. Assignment, authorization, entitlement and billing remain separate.

## Concepts and reuse

Hive stores shared platform data. Vapp operates internal portfolio records. Future HVMapp operates explicitly authorized client workspaces. Workspace is an operational/client isolation boundary, not legal ownership. Product remains a portfolio/customer-facing business or product; a workspace can use many Products. Product identity never grants workspace access.

Capabilities are now generic definitions, **not Products**. This avoids populating the portfolio with agent catalogue entries or confusing a client's marketed Product with the agent operating on it. The proposed `Product.commercialDefinition` field and Product validator have been removed before apply. Existing Product records are not rewritten.

Existing entitlements, subscriptions, transactions, workspaces, IDs/audit conventions and provider-neutral external references are reused. Four commercial collections are necessary because they have distinct identities and lifecycles (the Partner refinement adds two separate relationship collections):

| Collection             | Meaning and why existing records are unsuitable                                                                                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `capabilities`         | Reusable catalogue definition, supported scopes and technical prerequisite rules. Products describe businesses/products; CRM relationships describe customer relationships. Neither is an agent catalogue.    |
| `capability_instances` | Configured use in one workspace/Product context, with independent state, dependency bindings, configuration and output. A grant or payment cannot hold the identity/lifecycle of configured agent work.       |
| `commercial_packages`  | Workspace commercial grouping of capability definitions and optional concrete instance bindings. Composition is neither an executable Product nor a technical dependency.                                     |
| `commercial_charges`   | One-off/recurring/usage components attached to instances and/or packages. Transactions are payment facts; subscriptions are external recurring state, so neither should be used for unpriced setup proposals. |

No generic CRUD or HVM endpoints are introduced. These are domain schemas, canonical Mongo setup declarations and pure validation/access helpers for future trusted adapters.

## Capability and configured instance

A definition has a `capability_…` ID, name, supported scope types and optional dependencies. It is an internal catalogue record without workspace scope, not a running actor. Mission, Offer, Strategy/ICP and Lead Gen can be separate definitions; the final catalogue is not fixed by an enum.

An instance has a `capinstance_…` ID, required `workspaceId`, `capabilityId`, `status: draft | enabled | disabled`, and:

- `scopeType: workspace`: no `scopeProductId`. Mission can be shared across the client relationship without per-Product duplication.
- `scopeType: product`: requires `scopeProductId`. Offer/Strategy/Lead Gen instances can be independent for Products A and B.

`offer` scope is **reserved, not accepted yet**. There is no formal Offer object in this repository. A future additive extension can introduce a validated `scopeOfferId` and Offer-to-Product/workspace relationship. Current Offer Agent work uses Product scope; no free-text or fabricated Offer reference is accepted.

Optional bounded `configuration` and `output` objects (50 keys/16KB each through domain validation) attach configuration/results to the instance's exact context. Large research documents should later use an authorized artifact/reference adapter. No agent execution, proprietary book content, workflow or orchestration engine is implemented.

More than one instance per capability/context is structurally possible; canonical instance IDs make selection explicit. A future UI must select the intended instance rather than assuming the first query result. There is no global workspace `offer_agent` flag.

## Dependencies versus package composition

Definitions can declare `{capabilityId, scope: same_scope | workspace}` dependencies. Instances bind those rules through `dependencyInstanceIds`.

- `same_scope` requires the same workspace, scope type and Product reference. Product A's Strategy cannot satisfy Product B's Lead Gen dependency.
- `workspace` requires a workspace-scoped instance in the same workspace. This can express shared Mission context for Product instances when explicitly configured later.

`validateCommercialModel` validates a complete proposal: canonical shape, unique identities, referenced workspaces/Products/capabilities, supported scopes, exact instance bindings and dependency cycles. Enabled instances require every prerequisite binding. Draft instances may be incomplete, but any bindings supplied must be valid. Unrequested dependencies, missing references, cross-workspace links and incompatible Product contexts fail.

Lead Gen → Strategy/ICP is demonstrated only in tests/documentation, using the generic dependency rule. Offer is not implicitly required for Lead Gen. Strategy can operate independently and feed other capabilities. Workspace Mission context is also explicit, not an automatically granted prerequisite.

A package has a `package_…` ID, required workspace and workspace/Product scope, `capabilityIds`, optional `capabilityInstanceIds`, and draft/active/retired status. Product packages may contain same-Product instances and shared workspace-level instances. Workspace packages may group several Products, but cannot cross workspaces. Package membership never creates an instance, grants access or substitutes for a required dependency. No nested package, coupon, discount or proration model is added.

## Entitlements and billing treatment

An entitlement has **exactly one** target:

1. Existing `productId`: legacy Product access; existing records remain valid.
2. `capabilityId`: explicit workspace-level capability access, requiring workspace scope.
3. `capabilityInstanceId`: exact configured instance access, requiring workspace scope.

Product-scoped instances require exact instance grants. Capability-level grants can serve workspace-scoped instances only; they never enable every Product's Offer/Lead Gen instance. This conservative foundation deliberately avoids implicit workspace-wide Product entitlements. No target is inferred from payment, package membership or an external ID.

`hasCapabilityInstanceEntitlement` is a pure functional check requiring trusted catalogue/context records. It checks exact workspace, enabled/unarchived instance and capability, active entitlement window, then recursively checks each bound prerequisite's entitlement. Activation is inclusive; expiry exclusive. Revoked/expired prerequisites disable dependent access at evaluation time without rewriting records. Archived workspaces fail closed.

The helper checks whole-instance access only. Person/organisation-restricted, feature/site/usage-limited and zero-quantity grants cannot expand into unrestricted instance access. Legacy Product access remains structurally compatible; no legacy access workflow is replaced. New insert validation rejects inverted access windows while historical record parsing remains compatible.

Billing treatment remains `standard | bundled | waived | internal | promotional`:

| Value         | Meaning                                             |
| ------------- | --------------------------------------------------- |
| `standard`    | Normal billable use                                 |
| `bundled`     | Included, not charged separately                    |
| `waived`      | Normal charge deliberately waived                   |
| `internal`    | No intended charge for internal/related-company use |
| `promotional` | Temporary no-charge or discounted treatment         |

It is optional on entitlements and packages; missing means unspecified, never an inferred default. Each new charge explicitly specifies its own treatment. No inheritance or cascading changes are implied. Optional bounded `billingReason` and human-only `approvedBy` are supported on entitlements/charges. Approval metadata is provenance; future writers must verify it against authenticated human context.

An internal, waived or bundled grant passes exactly the same functional checks as standard access. Charged does not mean entitled; unbilled does not mean denied. Neither package/charge status nor subscription/payment state participates in the functional helper. Optional entitlement `commercialPackageId` records provenance and must reference a package containing the targeted capability/instance in compatible scope.

## Charges, subscriptions and Stripe

A `charge_…` record targets a capability instance, a package, or both. If both are supplied, the instance must be a member of that package in the same workspace. It has an explicit treatment, name, draft/active/retired state and:

- `chargeType: one_off`: no recurring interval or usage unit.
- `chargeType: recurring`: requires `billingInterval: month | year`.
- `chargeType: usage`: requires a `usageUnit`; metering is deferred.

Optional `amountMinor` and currency must be supplied together; no price is inferred. Separate one-off and recurring records may point to the same instance/package. This supports initial Offer Definition and ongoing Offer Intelligence without Offer-specific billing code. It also permits different treatments for initial setup and ongoing use.

Existing subscriptions/transactions remain external state/payment records. Optional charge `sourceSubscriptionId` / `sourceTransactionId` links to them in the same workspace. No new billing engine, scheduler or payment integration is built.

Existing `external_references` now accepts capabilities, capability instances, packages and charges as canonical targets, in addition to subscriptions, entitlements, transactions and existing entities. Its provider/account/object/external-ID uniqueness and workspace isolation remain unchanged. No new `stripe_*` fields are introduced.

Future flow: commercial package/charge → provider-neutral Stripe mapping → authenticated subscription/payment event → authorized, idempotent entitlement provisioning/revocation. Stripe owns external payment/subscription state; Hive owns commercial meaning and access. Knowing a Stripe/customer/price/subscription ID never grants entitlement or workspace access.

## Isolation and write boundary

Application authorization remains a prerequisite, separate from functional entitlement. The authorization vocabulary includes the four collections; Vapp still denies all workspace-owned operational data. No HVM client, service grant or browser system impersonation is enabled.

Instances, packages and charges always require workspace scope. Product references must resolve to either the internal catalogue or the same workspace; another client's Product is rejected. An internal Product reference describes context and does not grant rights to edit that Product or read other workspaces. Future adapters must authorize reference resolution explicitly.

Mongo validators enforce local field shape; they cannot enforce cross-document references, cycles, concurrent changes or actor permissions. Pure validation is not an authenticated repository. Before exposing any write path, a trusted adapter must authorize, validate the complete proposed graph and lock/recheck references in the same transaction, preserving immutable workspace/capability/context identity. The current generic CRM workspace-write guard remains in place.

New records do not add direct people/organisation links: client context is through workspace and existing subscription/transaction references. Existing hard-delete blockers for workspaces, entitlements and financial history remain intact. Nothing cascades these commercial records.

## Non-priced examples — not seeded records

**Built Matters:** one workspace Mission; Product Built Matters has distinct Offer, Strategy/ICP and Lead Gen instances. Each has an explicit internal entitlement. Lead Gen binds that Product's Strategy instance.

**e-c / Tom:** one workspace Mission. Product A has an Offer instance with a standard one-off initial-definition component and a recurring intelligence component. Strategy/ICP is separately entitled with bundled treatment; Lead Gen is separately entitled and may have a recurring component. Its dependency points to Product A's Strategy instance.

Product B can be added in the same workspace with separate Offer and Strategy instances/configuration/output and optional Lead Gen. Product A's grants/configuration are unchanged. Product B needs its own instance grants and compatible dependency bindings. Separate recurring components can later link to separate subscriptions.

Offer remains distinct from Strategy/ICP. Future original B2B offer-development work may address target customer, expensive problem, desired outcome, value equation, likelihood, time to value, effort, differentiation, risk reversal, genuine urgency, pricing/packaging, revenue architecture, messaging and product improvements. No agent or copyrighted framework content is implemented here.

## Migration and indexes

This refines **unapplied** migration `003-commercial-foundation`, version **2 → 3**. It does not introduce v4 because dev still runs v2. The final target has **27 domain collections / 84 application indexes** (excluding automatic Mongo `_id` indexes).

Create eight collections with validators (four commercial plus Partner, membership, assignment and workspace integration); apply one additive optional-field validator to existing entitlements. Existing Product, subscription, transaction and CRM validators remain unchanged. No Product or other domain record is rewritten, no treatment inferred, no existing index dropped/replaced. If an earlier proposal was applied in another environment, validator/index drift is reported as a conflict for review rather than silently rewritten.

| Collection/index                                   | Keys                                                                   | Purpose                                                  |
| -------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------- |
| Each of the four new collections: `id_unique`      | `{id: 1}`                                                              | Canonical identity lookup and duplicate prevention       |
| capability_instances: `workspace_scope_capability` | `{workspaceId: 1, scopeType: 1, scopeProductId: 1, capabilityId: 1}`   | Find configurations for one workspace/Product/capability |
| commercial_packages: `workspace_scope_packages`    | `{workspaceId: 1, scopeType: 1, scopeProductId: 1}`                    | List workspace/Product packages                          |
| commercial_charges: `workspace_instance_charges`   | `{workspaceId: 1, capabilityInstanceId: 1, status: 1, chargeType: 1}`  | Find setup/active recurring components for an instance   |
| commercial_charges: `workspace_package_charges`    | `{workspaceId: 1, commercialPackageId: 1, status: 1, chargeType: 1}`   | Find commercial components for a package                 |
| entitlements: `workspace_instance_access_window`   | `{workspaceId: 1, capabilityInstanceId: 1, status: 1, activeUntil: 1}` | Exact-instance active access window                      |
| entitlements: `workspace_capability_access_window` | `{workspaceId: 1, capabilityId: 1, status: 1, activeUntil: 1}`         | Workspace-level capability access window                 |

The ten commercial indexes above have no sparse or partial filters; only their four `id_unique` indexes are unique. The six additional Partner/assignment indexes, including two partial uniqueness constraints, are documented in [Partner relationships](hvm-partners.md). Seven further membership/integration indexes are documented in [workspace onboarding](workspace-onboarding.md). `activeFrom` remains a residual access-window check. Dependency/package bindings are retrieved by canonical IDs; no speculative reverse-graph indexes are added.

The canonical `db:setup` preflight checks conflicts before any writes. Apply creates only missing collections/indexes/validators, then records the migration ledger. A partial interruption is retryable when installed definitions match; arbitrary drift is refused. Tests cover record preservation and repeated setup.

**Verified dev dry-run:** schema 2 → 3, eight new collections, nine validators, twenty-three indexes; no validator conflicts, incompatible indexes or uniqueness risks. Two Products remain unchanged. This was a read-only run using the existing secret `vamberic/dev/api`, AWS profile `vamberic-admin`, region `eu-west-2`; credentials were passed only to the process and not printed.

With that secure dev environment loaded:

```sh
pnpm --filter @workspace/api-server db:setup --dry-run
# Only after explicit approval, not run in this task:
pnpm --filter @workspace/api-server db:setup --apply
```

Next: review/approve this data-model proposal, then implement HVM membership plus transactional, scoped instance/package/entitlement provisioning and revocation before enabling HVM endpoints. Validate offers and actual catalogue/prices separately.
