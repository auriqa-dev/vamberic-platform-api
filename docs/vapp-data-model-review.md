# Vapp v1 MongoDB data-model review

## 1. Implementation status

| Item                     | Status                                                                                       |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| Current commit SHA       | `159172bc112fdfdb25577fa8335906ef8012ee43` (`159172b`)                                       |
| Implementation committed | Yes, locally, as `Add Vapp v1 MongoDB data model`                                            |
| Implementation pushed    | No. The attempted push was rejected by GitHub because the configured credential was invalid. |
| Current branch           | `main`                                                                                       |
| Live Atlas setup run     | No. `db:setup` was not run and this review did not connect to Atlas.                         |

The implementation is complete in the local repository and has passed the
quality checks listed in section 17. The uploaded specifications remain
untracked and are not part of the commit.

## 2. Files added or changed

### Domain/types and validation

- `artifacts/api-server/src/domain/schemas.ts` — defines the common persistence
  conventions, Zod schemas, insert/update schemas, integrity refinements, and
  inferred TypeScript types for all fourteen domain collections.
- `artifacts/api-server/src/domain/index.ts` — exports the public domain schema
  and type surface.

Validation and domain types deliberately share `schemas.ts`: Zod schemas are
the runtime definitions and `z.infer` derives the corresponding TypeScript
persistence types, avoiding a second hand-maintained type model.

### Mongo collection/repository access

- `artifacts/api-server/src/db/collections.ts` — declares collection names,
  the type-to-collection mapping, typed collection accessors, all index
  definitions, and current schema metadata constants.
- `artifacts/api-server/src/db/index.ts` — exports collection and setup APIs.
- `artifacts/api-server/src/services/mongo.ts` — exports the fixed
  `vamberic_studio` database name for both runtime readiness and setup use.

No CRUD repositories were added. `getDomainCollections(db)` is the typed
foundation on which repositories can be added later.

### Database setup, migrations, and versioning

- `artifacts/api-server/src/db/setup.ts` — implements idempotent,
  non-destructive collection/index setup, index compatibility checks, and
  schema-version preflight/recording.
- `artifacts/api-server/src/commands/db-setup.ts` — provides the operator CLI,
  validated configuration loading, Mongo connection lifecycle, safe logging,
  and non-zero failure behavior.

### Tests

- `artifacts/api-server/test/domain.test.ts` — tests all fourteen schemas,
  ID/reference constraints, typed access, index coverage, repeatability,
  preservation of records, newer-version refusal, and incompatible-index
  refusal without Atlas.
- `artifacts/api-server/test/api.test.ts` — pre-existing API tests also verify
  readiness behavior and that Mongo errors/credentials are not returned to
  clients.

### Documentation

- `artifacts/api-server/README.md` — documents the domain architecture,
  collection responsibilities, relationships, setup/versioning, typed access,
  and index strategy.
- `docs/vapp-data-model-review.md` — this consolidated review document; it is
  not part of commit `159172b`.

### Package/config/script changes

- `artifacts/api-server/package.json` — adds the `db:setup` script.

No dependency or lockfile change was required. The official `mongodb` driver
and `zod` were already dependencies.

## 3. Final collection list

All domain records use application field `id` as their primary public
identifier. Every domain schema inherits optional provenance and soft-archive
fields. The behavior classifications below describe intended use; MongoDB does
not enforce immutability or append-only writes.

| Collection                   | Purpose                                                                       | Primary application ID      | Key references                                                                 | Intended behavior                                                           |
| ---------------------------- | ----------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `products`                   | Product/venture portfolio registry and commercial configuration               | `id`                        | None                                                                           | Mutable; soft-archived                                                      |
| `people`                     | Canonical human identity independent of contact details or employers          | `id`                        | None                                                                           | Mutable; soft-archived                                                      |
| `contact_points`             | Email, phone, and other contact channels with deliverability state            | `id`                        | `personId` → `people`                                                          | Mutable operational/history-bearing record; soft-archived                   |
| `organisations`              | Companies and other B2B entities                                              | `id`                        | None                                                                           | Mutable; soft-archived                                                      |
| `organisation_relationships` | Time-bounded person/employer history                                          | `id`                        | `personId` → `people`; `organisationId` → `organisations`                      | Historical but mutable for corrections/current-state closure; soft-archived |
| `product_relationships`      | Person or organisation lifecycle within one product                           | `id`                        | `productId`, optional `personId`, `organisationId`, `campaignId`               | Mutable lifecycle; soft-archived                                            |
| `marketing_permissions`      | Evidence-bearing permission decisions by subject, scope, channel, and purpose | `id`                        | optional `personId`, `contactPointId`, `productId`                             | Historical immutable decisions; soft-archived                               |
| `opportunities`              | Product-scoped B2B pipeline records                                           | `id`                        | `productId`, `organisationId`, `personIds[]`, optional `campaignId`            | Mutable pipeline; soft-archived                                             |
| `subscriptions`              | Recurring billing state independent of provider                               | `id`                        | `productId`; one or more customer references                                   | Mutable operational state; soft-archived                                    |
| `entitlements`               | Durable access rights, including one-off and subscription-derived access      | `id`                        | `productId`; customer; optional source subscription/transaction                | Mutable operational access state; soft-archived                             |
| `campaigns`                  | Product-scoped marketing campaign and attribution metadata                    | `id`                        | `productId`                                                                    | Mutable lifecycle; soft-archived                                            |
| `imports`                    | Import audit records, mappings, row counts, policy, and outcome               | `id`                        | optional `productId`, `campaignId`                                             | Historical/append-oriented with status progression; soft-archived           |
| `events`                     | Extensible product/activity event envelope                                    | `id`                        | optional product, person, organisation, and campaign IDs                       | Append-oriented; no update contract                                         |
| `transactions`               | Provider-neutral financial event records                                      | `id`                        | `productId`; person/organisation; optional subscription, entitlement, campaign | Historical financial records; status-only updates; soft-archived            |
| `schema_versions`            | Records setup compatibility/version metadata                                  | Mongo `_id` value `vapp-v1` | Lists managed collection names                                                 | Mutable only when the supported database schema version advances            |

## 4. ID strategy

The current implementation does **not generate IDs**. Callers must generate
and supply them before insert. No UUID, ULID, ObjectId string, or other concrete
generation algorithm was selected.

Application IDs are validated as trimmed lowercase strings of 2–100 characters:

```ts
z.string()
  .trim()
  .min(2)
  .max(100)
  .regex(/^[a-z0-9][a-z0-9_-]*$/);
```

Examples such as `person_01`, `org_01`, and `product_01` are valid. Spaces,
uppercase characters, and punctuation outside `_`/`-` are rejected.

Mongo `_id` is deliberately absent from the public/domain contracts. Unless a
future repository supplies `_id`, MongoDB generates it as an internal storage
identifier. Application references always use stable application IDs rather
than Mongo `_id`.

Every domain collection has a unique `{ id: 1 }` index named `id_unique`.
Products additionally have a unique slug. Provider IDs for subscriptions and
transactions have sparse compound unique indexes. Insert schemas retain `id`
as required, while update schemas omit it, making IDs immutable through the
intended Zod update path. Direct MongoDB writes could still change `id`; MongoDB
collection-level validation does not prevent that.

## 5. Common document fields

Every domain persistence schema extends:

```ts
{
  id: applicationIdSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
  schemaVersion: z.number().int().positive().default(1),
  archived: z.boolean().default(false),
  archivedAt: z.date().optional(),
  source: {
    system: z.string().trim().min(1).max(100),
    reference: z.string().trim().max(500).optional(),
    importedAt: z.date().optional(),
  }.optional(),
}
```

- Dates are JavaScript `Date` values and therefore persist as MongoDB UTC BSON
  dates. The schemas do not accept ISO strings directly.
- `schemaVersion` is a per-document positive integer, currently defaulting to
  `1`; it is distinct from the database setup version.
- `source` records provenance system, source reference, and optional import
  time.
- `archived`/`archivedAt` provide soft deletion. No schema refinement currently
  requires `archivedAt` when `archived` is true or forbids it when false.
- `createdAt` and `updatedAt` are the only common audit timestamps. There are no
  common `createdBy`, `updatedBy`, request, or actor fields.

The generic insert schema omits lifecycle fields that persistence code should
set:

```ts
schema.omit({
  createdAt: true,
  updatedAt: true,
  schemaVersion: true,
  archived: true,
  archivedAt: true,
});
```

The generic update schema omits `id`, `createdAt`, and `schemaVersion`, makes
remaining fields optional, and permits an optional `updatedAt`.

## 6. Zod validation design

| Collection                   | Persistence schema               | Insert schema                          | Update schema                           | Important validation                                                                                                                                              |
| ---------------------------- | -------------------------------- | -------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `products`                   | `ProductSchema`                  | `ProductInsertSchema`                  | `ProductUpdateSchema`                   | Status: `idea`, `validation`, `active`, `paused`, `retired`; unique-compatible lowercase slug; max 50 domains; product/commercial model remain extensible strings |
| `people`                     | `PersonSchema`                   | `PersonInsertSchema`                   | `PersonUpdateSchema`                    | Required first/last names; lifecycle `active`, `inactive`, `archived`; title/display name optional                                                                |
| `contact_points`             | `ContactPointSchema`             | `ContactPointInsertSchema`             | `ContactPointUpdateSchema`              | Type `email`, `phone`, `other`; separate raw/normalized values; validity and deliverability enums; suppression/left-organisation flags                            |
| `organisations`              | `OrganisationSchema`             | `OrganisationInsertSchema`             | `OrganisationUpdateSchema`              | Type `prospect`, `customer`, `partner`, `vendor`, `other`; optional size/country/region; lifecycle enum                                                           |
| `organisation_relationships` | `OrganisationRelationshipSchema` | `OrganisationRelationshipInsertSchema` | `OrganisationRelationshipUpdateSchema`  | Person and organisation required; optional dated history; `current`; confidence 0–1                                                                               |
| `product_relationships`      | `ProductRelationshipSchema`      | `ProductRelationshipInsertSchema`      | `ProductRelationshipUpdateSchema`       | Product required; at least person or organisation required on persistence/insert; lifecycle status enum; optional campaign/acquisition dates                      |
| `marketing_permissions`      | `MarketingPermissionSchema`      | `MarketingPermissionInsertSchema`      | —                                       | Requires person or contact point and product or `portfolioWide`; effective decision time; optional supersession; purpose/lawful-basis enums                       |
| `opportunities`              | `OpportunitySchema`              | `OpportunityInsertSchema`              | `OpportunityUpdateSchema`               | Product/organisation required; max 100 people; open/won/lost/paused; non-negative value; probability 0–1; stage extensible                                        |
| `subscriptions`              | `SubscriptionSchema`             | `SubscriptionInsertSchema`             | `SubscriptionUpdateSchema`              | Product and one customer reference required; status/billing interval enums; non-negative recurring amount; three-letter uppercase currency                        |
| `entitlements`               | `EntitlementSchema`              | `EntitlementInsertSchema`              | `EntitlementUpdateSchema`               | Product and customer required; one-off/permanent/subscription/time-limited types; active/expired/revoked; optional source IDs/scope/quantity                      |
| `campaigns`                  | `CampaignSchema`                 | `CampaignInsertSchema`                 | `CampaignUpdateSchema`                  | Product required; status enum; type/channel/provider extensible; non-negative spend; bounded attribution metadata                                                 |
| `imports`                    | `ImportSchema`                   | `ImportInsertSchema`                   | `ImportUpdateSchema`                    | Non-negative integer row counts; started/completed/failed/cancelled; bounded field mapping and policy metadata                                                    |
| `events`                     | `EventSchema`                    | `EventInsertSchema`                    | —                                       | Required type/time; event type intentionally extensible; optional entity/campaign references; bounded payload                                                     |
| `transactions`               | `TransactionSchema`              | `TransactionInsertSchema`              | `TransactionUpdateSchema` (status only) | Product and person/organisation required; conservative lifecycle transitions; safe integer minor-unit amounts; supported ISO currency                             |

The intentionally extensible strings include product type, commercial model,
opportunity stage, campaign type/channel, provider names, permission channel,
event type, and entitlement scope values. This avoids hard-coding provider- or
product-specific taxonomies in v1.

Cross-field integrity refinements are reapplied to insert schemas for product
relationships, marketing permissions, subscriptions, entitlements, and
transactions. Update schemas are partial and do **not** reapply these
refinements because a partial patch cannot prove the final stored document is
valid without loading/merging the current record first. A future repository
must validate the merged document.

## 7. Mongo collection-level validation

No MongoDB JSON Schema validators were added to any collection. Validation is
application-level through Zod.

This keeps one TypeScript/Zod source for persistence, inserts, updates, and
inferred types, and avoids automatically applying validator changes that could
reject existing documents. The tradeoff is that direct database writes or
other applications can bypass all validation. If collection validators are
introduced later, they require an explicit, reviewed migration and a policy for
existing non-conforming records.

## 8. Indexes

There are 56 declared indexes across the fourteen domain collections. MongoDB's
automatic `_id_` indexes are not included below. There are no partial indexes.

| Collection                   | Index name                       | Fields                                      | Unique | Sparse | Rationale                                                                  |
| ---------------------------- | -------------------------------- | ------------------------------------------- | -----: | -----: | -------------------------------------------------------------------------- |
| `products`                   | `id_unique`                      | `id: 1`                                     |    Yes |     No | Stable application-ID lookup/boundary                                      |
| `products`                   | `slug_unique`                    | `slug: 1`                                   |    Yes |     No | Product routing/lookup slug must be unique                                 |
| `products`                   | `status`                         | `status: 1`                                 |     No |     No | Portfolio status views                                                     |
| `people`                     | `id_unique`                      | `id: 1`                                     |    Yes |     No | Stable canonical person lookup                                             |
| `people`                     | `lifecycle_status`               | `lifecycleStatus: 1`                        |     No |     No | Filter canonical people without treating email as identity                 |
| `contact_points`             | `id_unique`                      | `id: 1`                                     |    Yes |     No | Stable contact-point lookup                                                |
| `contact_points`             | `normalized_value`               | `normalizedValue: 1`                        |     No |     No | Find contacts by normalized email/phone; intentionally not globally unique |
| `contact_points`             | `person_type`                    | `personId: 1, type: 1`                      |     No |     No | List a person's channels by type                                           |
| `contact_points`             | `contactability`                 | `validity: 1, deliverability: 1`            |     No |     No | Contact eligibility/deliverability filtering                               |
| `organisations`              | `id_unique`                      | `id: 1`                                     |    Yes |     No | Stable organisation lookup                                                 |
| `organisations`              | `domain`                         | `domain: 1`                                 |     No |     No | Organisation discovery/deduplication workflow                              |
| `organisations`              | `lifecycle_status`               | `lifecycleStatus: 1`                        |     No |     No | Organisation lifecycle filtering                                           |
| `organisation_relationships` | `id_unique`                      | `id: 1`                                     |    Yes |     No | Stable relationship lookup                                                 |
| `organisation_relationships` | `person_current`                 | `personId: 1, current: 1`                   |     No |     No | Current and historical employers for a person                              |
| `organisation_relationships` | `organisation_current`           | `organisationId: 1, current: 1`             |     No |     No | Current and historical people for an organisation                          |
| `product_relationships`      | `id_unique`                      | `id: 1`                                     |    Yes |     No | Stable product-relationship lookup                                         |
| `product_relationships`      | `product_person`                 | `productId: 1, personId: 1`                 |     No |     No | Person lifecycle inside a product boundary                                 |
| `product_relationships`      | `product_organisation`           | `productId: 1, organisationId: 1`           |     No |     No | Organisation lifecycle inside a product boundary                           |
| `product_relationships`      | `status`                         | `status: 1`                                 |     No |     No | Cross-product lifecycle filtering                                          |
| `product_relationships`      | `campaign`                       | `campaignId: 1`                             |     No |     No | Acquisition/campaign attribution                                           |
| `marketing_permissions`      | `id_unique`                      | `id: 1`                                     |    Yes |     No | Stable permission-decision lookup                                          |
| `marketing_permissions`      | `person_contact_point`           | `personId: 1, contactPointId: 1`            |     No |     No | Permission history by person/channel identity                              |
| `marketing_permissions`      | `scope_channel_purpose`          | `productId: 1, channel: 1, purpose: 1`      |     No |     No | Product/channel/purpose permission resolution                              |
| `marketing_permissions`      | `effective_at`                   | `effectiveAt: -1`                           |     No |     No | Historical decision resolution by effective time                           |
| `opportunities`              | `id_unique`                      | `id: 1`                                     |    Yes |     No | Stable opportunity lookup                                                  |
| `opportunities`              | `product_pipeline`               | `productId: 1, status: 1, stage: 1`         |     No |     No | Product-scoped pipeline views                                              |
| `opportunities`              | `organisation_status`            | `organisationId: 1, status: 1`              |     No |     No | Organisation opportunity history/state                                     |
| `opportunities`              | `campaign`                       | `campaignId: 1`                             |     No |     No | Campaign attribution                                                       |
| `subscriptions`              | `id_unique`                      | `id: 1`                                     |    Yes |     No | Stable subscription lookup                                                 |
| `subscriptions`              | `product_status`                 | `productId: 1, status: 1`                   |     No |     No | Product subscription state                                                 |
| `subscriptions`              | `provider_external_subscription` | `provider: 1, externalSubscriptionId: 1`    |    Yes |    Yes | Prevent duplicate provider subscriptions when an external ID exists        |
| `subscriptions`              | `customer`                       | `personId: 1, organisationId: 1`            |     No |     No | Customer subscription lookup                                               |
| `entitlements`               | `id_unique`                      | `id: 1`                                     |    Yes |     No | Stable entitlement lookup                                                  |
| `entitlements`               | `product_access_window`          | `productId: 1, status: 1, activeUntil: 1`   |     No |     No | Product access checks and expiry windows                                   |
| `entitlements`               | `customer_status`                | `personId: 1, organisationId: 1, status: 1` |     No |     No | Customer access-state lookup                                               |
| `entitlements`               | `source_subscription`            | `sourceSubscriptionId: 1`                   |     No |     No | Trace subscription-derived access                                          |
| `entitlements`               | `source_transaction`             | `sourceTransactionId: 1`                    |     No |     No | Trace one-off transaction-derived access                                   |
| `campaigns`                  | `id_unique`                      | `id: 1`                                     |    Yes |     No | Stable campaign lookup                                                     |
| `campaigns`                  | `product_status`                 | `productId: 1, status: 1`                   |     No |     No | Product campaign lifecycle                                                 |
| `campaigns`                  | `provider_external_reference`    | `provider: 1, externalReference: 1`         |     No |    Yes | Provider attribution reconciliation when reference exists                  |
| `imports`                    | `id_unique`                      | `id: 1`                                     |    Yes |     No | Stable import lookup                                                       |
| `imports`                    | `provider_imported_at`           | `provider: 1, importedAt: -1`               |     No |     No | Provider/time audit history                                                |
| `imports`                    | `status`                         | `status: 1`                                 |     No |     No | Import operational status                                                  |
| `imports`                    | `campaign`                       | `campaignId: 1`                             |     No |     No | Campaign-linked imports                                                    |
| `events`                     | `id_unique`                      | `id: 1`                                     |    Yes |     No | Stable event identity/idempotency key                                      |
| `events`                     | `occurred_at`                    | `occurredAt: -1`                            |     No |     No | Global time-first activity                                                 |
| `events`                     | `type_occurred_at`               | `eventType: 1, occurredAt: -1`              |     No |     No | Event type/time slices                                                     |
| `events`                     | `product_occurred_at`            | `productId: 1, occurredAt: -1`              |     No |     No | Product activity timeline                                                  |
| `events`                     | `person_occurred_at`             | `personId: 1, occurredAt: -1`               |     No |     No | Person activity timeline                                                   |
| `events`                     | `organisation_occurred_at`       | `organisationId: 1, occurredAt: -1`         |     No |     No | Organisation activity timeline                                             |
| `events`                     | `campaign_occurred_at`           | `campaignId: 1, occurredAt: -1`             |     No |     No | Campaign activity/attribution timeline                                     |
| `transactions`               | `id_unique`                      | `id: 1`                                     |    Yes |     No | Stable transaction lookup                                                  |
| `transactions`               | `provider_external_transaction`  | `provider: 1, externalTransactionId: 1`     |    Yes |    Yes | Prevent duplicate provider transactions when an external ID exists         |
| `transactions`               | `product_transacted_at`          | `productId: 1, transactedAt: -1`            |     No |     No | Product revenue timeline                                                   |
| `transactions`               | `status_transacted_at`           | `status: 1, transactedAt: -1`               |     No |     No | Reconciliation/reporting by state and time                                 |
| `transactions`               | `campaign`                       | `campaignId: 1`                             |     No |     No | Revenue attribution                                                        |

The implementation has product/time and event-type/time indexes, but no single
compound `productId + eventType + occurredAt` index. If queries routinely
filter on all three, that specific index should be considered based on observed
query plans rather than added speculatively.

## 9. Database setup and versioning

From the repository root, the exact command is:

```sh
pnpm --filter @workspace/api-server run db:setup
```

The package script invokes:

```sh
DEPLOYMENT_ENV=${DEPLOYMENT_ENV:-local} tsx src/commands/db-setup.ts
```

`db-setup.ts` loads validated configuration, creates a `MongoClient` from the
required `MONGODB_URI`, connects with five-second connection/selection
timeouts, selects fixed database `vamberic_studio`, calls `setupDatabase`, logs
only safe result fields, and always attempts to close the client.

`setupDatabase`:

1. Lists existing collection names.
2. Creates `schema_versions` if absent.
3. Reads `_id: "vapp-v1"` and refuses a version newer than supported **before**
   creating/mutating domain collections or indexes.
4. Creates only missing domain collections.
5. Lists existing indexes and preflights every expected index by name, keys,
   uniqueness, sparseness, and partial filter.
6. Creates only missing indexes.
7. Inserts the v1 version document if absent, or updates it only when advancing
   from an older version.

Current constants:

```ts
SCHEMA_VERSIONS_COLLECTION = "schema_versions";
DATABASE_SCHEMA_VERSION_ID = "vapp-v1";
DATABASE_SCHEMA_VERSION = 1;
```

The metadata document contains `_id`, `version`, `schemaVersion`, `appliedAt`,
and the managed collection list. A later version update sets `updatedAt`.

Setup is idempotent because existing compatible collections/indexes are left in
place and the version document is not rewritten at the same version. This is a
version compatibility/setup framework, not yet an ordered migration runner:
there is no list of sequential migration functions or record per applied step.

## 10. Safe handling of incompatible changes

- **Same index name, different keys/options:** preflight throws
  `IncompatibleDatabaseSchemaError` before any missing index is created.
- **Unique index cannot be created because duplicates exist:** MongoDB's
  `createIndexes` error propagates. Existing data is not deleted or rewritten.
  Because MongoDB index creation is not wrapped in a transaction, indexes
  created earlier in the loop can remain; rerunning remains safe.
- **Collection already exists:** it is recorded in `existingCollections` and
  left unchanged.
- **Repeated setup:** compatible collections and indexes are skipped, the same
  version document is retained, and no business records are rewritten.
- **Destructive migration required:** setup refuses the incompatible expected
  index and requires a separately reviewed migration.
- **Database version is newer than code:** setup refuses before domain
  collection/index mutation. It may create the missing `schema_versions`
  collection before this check because there can be no version record without
  that collection.

The code never automatically drops collections, drops indexes, or deletes
existing data. It also does not rename collections or rewrite domain
documents.

One nuance: the explicit catch converts Mongo `IndexOptionsConflict` to the
domain-specific incompatibility error. Other driver conflicts, including a
same-key/different-name conflict, can propagate as raw Mongo errors. The CLI
still suppresses those details to avoid credential leakage.

## 11. Relationship integrity

References are stable application IDs and are controlled by the application:

- `contact_points.personId` links a channel to a canonical person.
- `organisation_relationships` require both person and organisation IDs and
  preserve employer history with start/end/current fields.
- `product_relationships` require a product and at least one of person or
  organisation.
- `subscriptions`, `entitlements`, and `transactions` require a product and at
  least one of `personId` or `organisationId`.
- Entitlements may link to source subscriptions/transactions.
- Transactions may link to subscriptions, entitlements, and campaigns.

MongoDB has no foreign-key enforcement here. Zod validates reference shape and
required combinations, not existence. Repositories/services must verify that
targets exist, decide deletion/archive policies, and merge partial updates
before validating full-document integrity.

The model does not enforce exclusive-or semantics: a product relationship may
have both person and organisation, and customer-bearing records may have
multiple customer reference fields. This can represent a person acting for an
organisation, but requires a documented resolution rule in service code.

## 12. People vs contact points

`people` is the canonical identity record and deliberately contains no email
field. A person can own multiple `contact_points`, each with:

- original `value` and queryable `normalizedValue`;
- `primary` designation;
- validity: `unknown`, `valid`, or `invalid`;
- deliverability: `unknown`, `deliverable`, `soft_bounced`, or `hard_bounced`;
- `leftOrganisation` and `suppressed` flags;
- `firstSeenAt` and `lastValidatedAt`;
- source and archive metadata.

Employer changes are separate
`organisation_relationships`. Closing an old relationship with `endDate` and
`current: false` preserves history; a new relationship can represent the next
employer. A contact point can be marked as having left an organisation without
deleting either the person or the address.

History is preserved structurally by separate records and soft archival, but
the database does not prevent overwriting a contact point's deliverability
state or reusing an `id`. There is no separate bounce-event collection beyond
the generic event envelope, no automatic "only one primary" constraint, and no
global uniqueness constraint on normalized contact values.

## 13. Marketing permissions

Each `marketing_permissions` record is an evidence-bearing decision with:

- subject: `personId` and/or `contactPointId`;
- scope: `productId` or `portfolioWide: true`;
- extensible `channel`;
- purpose: `marketing`, `newsletter`, or `product_communication`;
- lawful basis: `consent`, `legitimate_interest`, `soft_opt_in`,
  `transactional`, or `other`;
- `permitted` boolean;
- optional `evidence`, `supersedesPermissionId`, and `reviewAt`;
- required `effectiveAt`;
- common provenance, schema, timestamps, and archive state.

The collection and indexes allow multiple records, so permission decisions can
be retained historically rather than collapsed into CRM lifecycle state.
However, no uniqueness/current-version rule defines which of several matching
records wins. The permission service must resolve the latest/effective decision
and account for withdrawal.

CRM/product lifecycle (`product_relationships.status`) and legal marketing
permission (`marketing_permissions`) are separate concepts. Being a prospect or
customer does not itself grant permission, and withdrawal does not alter CRM
lifecycle.

## 14. Events

The common event envelope requires:

- `id`, `createdAt`, `updatedAt`, document `schemaVersion`, and archive state;
- `eventType` (trimmed non-empty string, maximum 150);
- `occurredAt`;
- optional `productId`, `personId`, `organisationId`, `campaignId`;
- optional `sessionReference` and `externalReference`;
- `payload`, defaulting to `{}`.

`payload` is deliberately extensible (`Record<string, unknown>`) but limited to
50 keys, keys of 1–100 trimmed characters, and at most 16,384 characters after
`JSON.stringify`. This is an approximate serialized-character bound, not an
exact BSON-byte-size calculation. Circular/non-JSON-safe values would also be
problematic before persistence and should not be accepted by event-writing
code.

Representative valid shapes:

```ts
// Email event
{
  id: "event_email_01",
  eventType: "email.hard_bounced",
  occurredAt: new Date(),
  personId: "person_01",
  campaignId: "campaign_01",
  payload: { contactPointId: "contact_01", providerMessageId: "msg_01" }
}

// Purchase event
{
  id: "event_purchase_01",
  eventType: "purchase.completed",
  occurredAt: new Date(),
  productId: "product_01",
  personId: "person_01",
  campaignId: "campaign_01",
  payload: { transactionId: "transaction_01", currency: "GBP", amount: 49 }
}

// Product-usage event
{
  id: "event_usage_01",
  eventType: "product.feature_used",
  occurredAt: new Date(),
  productId: "product_01",
  personId: "person_01",
  sessionReference: "session_01",
  payload: { feature: "report_export", count: 1 }
}
```

Insert callers must also provide `id`; persistence code must add lifecycle
fields. The event model is described and indexed as append-oriented, but
There is no `EventUpdateSchema`; event records are append-oriented and MongoDB
does not independently enforce immutability.

Indexes cover ID, global time, event type/time, and separate
product/person/organisation/campaign timelines. Event schema evolution can use
the document `schemaVersion`, while event-specific evolution can also be
encoded in `eventType`/payload conventions.

## 15. Transactions

Supported financial types are `purchase`, `renewal`, `refund`, `adjustment`,
and `fee`. Statuses are `pending`, `completed`, `failed`, `refunded`, and
`voided`.

Amounts are non-negative safe integer minor units:

- required `grossAmountMinor`;
- optional `taxAmountMinor`, `feeAmountMinor`, and `netAmountMinor`;
- required runtime-supported three-letter ISO 4217 `currency`.

`provider` is required and `externalTransactionId` is optional. When an
external ID is present, the sparse unique compound index on
`provider + externalTransactionId` prevents duplicate ingestion for the same
provider. The application `id_unique` index is a second idempotency boundary.

Transactions require a product and person and/or organisation identity and may
link to `subscriptionId`, `entitlementId`, and `campaignId`. Refunds and
adjustments may link to `originalTransactionId`; direction is represented by
type/status, never a negative amount. Status updates follow the conservative
transition matrix and cannot mutate financial fields.

## 16. Tests

`domain.test.ts` adds eight tests:

1. all fourteen schemas accept representative persistence records;
2. invalid/uppercase IDs and missing relationship/customer targets fail;
3. definitions match exactly the fourteen collection names and each has
   `id_unique`;
4. typed collection access exposes every collection;
5. refined insert schemas retain target-integrity validation;
6. repeated setup is idempotent and preserves an existing business document;
7. a newer database version fails before domain collection mutation;
8. an incompatible same-name index is refused without dropping business data.

The complete test command also runs five API/config tests in `api.test.ts`:

- safe versioned health metadata;
- root health route;
- successful Mongo readiness;
- safe 503 readiness response that excludes a deliberately embedded Mongo URI,
  username, password, hostname, and driver error;
- invalid configuration, missing Mongo URI, non-Mongo URI, and wildcard CORS
  rejection.

Coverage requested by the review:

| Concern                       | Covered                                                                                                     |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Every collection schema       | Yes                                                                                                         |
| Invalid IDs                   | Yes                                                                                                         |
| Index definitions             | Names/coverage and incompatible-index behavior; not every exact key/option individually                     |
| Idempotent setup              | Yes                                                                                                         |
| Repeated setup preserves data | Yes                                                                                                         |
| Incompatible index handling   | Yes                                                                                                         |
| Credential leakage            | Yes for readiness HTTP responses; CLI catch behavior is implemented but not directly log-captured in a test |
| Live Atlas required           | No; setup uses in-memory fakes and API tests inject a fake Mongo service                                    |

The tests do not exercise actual MongoDB index creation behavior, duplicate
data failures, BSON persistence, or Mongo server version compatibility.

## 17. Quality-check results

Results from the local implementation before this review document was added:

| Check               | Command                                                       | Result                                                        |
| ------------------- | ------------------------------------------------------------- | ------------------------------------------------------------- |
| Build               | `pnpm --filter @workspace/api-server run build`               | Passed; bundled `dist/index.mjs` and Pino worker files        |
| Lint                | `pnpm --filter @workspace/api-server run lint`                | Passed with no errors                                         |
| Workspace typecheck | `pnpm run typecheck`                                          | Passed for libraries, API server, mockup sandbox, and scripts |
| Tests               | `pnpm --filter @workspace/api-server run test`                | Passed: 13 tests, 0 failed/skipped/cancelled                  |
| Formatting          | API `format:check` plus README Prettier check                 | Passed after formatting the README                            |
| Diff whitespace     | `git diff --check`                                            | Passed                                                        |
| Docker build        | `docker build --tag vamberic-platform-api:vapp-model-check .` | Passed                                                        |

No quality command connected to Atlas. `db:setup` was not run.

## 18. Modelling decisions and assumptions

1. Application IDs are stable strings independent of Mongo `_id`.
2. ID generation is delegated to callers; only format is specified.
3. Domain types are inferred from Zod to keep runtime/static contracts aligned.
4. Mongo validation remains application-level; no JSON Schema validators are
   installed.
5. Canonical people, contact channels, employer history, product lifecycle, and
   permission decisions are separate records.
6. References are application IDs instead of embedded canonical entities.
7. Product boundaries are explicit in commercial, pipeline, campaign,
   entitlement, event, and transaction records.
8. Subscriptions, entitlements, and transactions support person,
   organisation, or opaque customer references rather than introducing a
   separate customer collection.
9. Permission channel, event type, provider, opportunity stage, campaign type,
   and several product classifications are extensible strings.
10. Event/import metadata is bounded to 50 top-level keys and approximately
    16 KB serialized JSON.
11. Events, financial transactions, imports, relationships, and permission
    decisions are intended to preserve history, but immutability is not
    database-enforced.
12. Missing collections/indexes are safe setup operations; incompatible
    definitions require explicit reviewed migrations.
13. Indexes are query-oriented and intentionally avoid broad speculative
    indexing.
14. Normalized contact values and organisation domains are searchable but not
    unique because duplicates/aliases may be legitimate and need application
    reconciliation.
15. Provider subscription/transaction IDs are sparse unique reconciliation
    boundaries.
16. Financial amounts currently use non-negative JavaScript numbers and
    three-letter currency codes rather than integer minor units or Decimal128.

## 19. Historical unresolved questions or risks

This section records the questions at the initial review point. The
post-refinement resolutions are authoritative in section 21; only the
operational decisions listed there remain open.

Before the refinement pass, the review asked operators to decide or confirm:

1. **ID generation:** UUID, ULID, prefixed ULID, or another strategy; collision
   behavior and service ownership are not defined.
2. **Money representation:** whether amounts should be integer minor units or
   BSON Decimal128 to avoid floating-point ambiguity.
3. **Atlas data audit:** whether existing collections/data/indexes already use
   any of these names and whether unique-index creation would encounter
   duplicates.
4. **Migration strategy:** v1 records one current version but has no ordered,
   resumable migration sequence or per-step ledger.
5. **Partial setup:** index creation is non-transactional; a failure may leave
   earlier missing indexes created.
6. **Index conflicts:** same-key/different-name Mongo errors may propagate
   rather than becoming `IncompatibleDatabaseSchemaError`.
7. **Reference integrity:** no foreign keys/existence checks or archive/delete
   propagation policy exists.
8. **Patch validation:** partial update schemas do not validate the merged
   document's cross-field integrity.
9. **Append-only enforcement:** events/transactions/imports/permission history
   have update schemas and no storage-level immutability.
10. **Permission resolution:** no rule selects the effective record among
    multiple subject/scope/channel/purpose decisions.
11. **Contact normalization:** normalization algorithms, uniqueness,
    source precedence, merge behavior, and primary-contact exclusivity are not
    defined.
12. **Customer identity:** `customerReference` semantics and precedence when
    person/organisation/reference fields coexist need documentation.
13. **Transaction semantics:** refund linkage, sign convention, net/gross/tax
    equations, currency precision, and fee treatment need definition.
14. **Event payload safety:** the bound is JSON character count, not BSON bytes;
    nested depth and sensitive-data policy are not constrained.
15. **Mongo validators:** direct/manual writes can bypass Zod.
16. **Audit actors:** common `createdBy`/`updatedBy`/correlation fields are not
    modeled.
17. **Index/query fit:** validate all 56 indexes against expected workload and
    Atlas query plans, especially event combinations and low-cardinality
    status-only indexes.
18. **Operational execution:** decide where `db:setup` runs and how operators
    review its safe summary before application rollout.
19. **CLI distribution:** the production Docker image contains bundled API
    runtime files only; confirm whether setup will run from source/CI or needs a
    separately bundled production command.
20. **Pushing code:** local commit `159172b` is not on GitHub because
    authentication failed; do not confuse local review with remote availability.

## 20. Recommended next step

Review and resolve the decisions in section 19, with priority on ID generation,
money representation, customer/reference semantics, permission resolution, and
the live Atlas preflight. Then inspect Atlas collection/index metadata
read-only, prepare a reviewed execution plan and rollback/backup position, and
only after explicit approval run:

```sh
pnpm --filter @workspace/api-server run db:setup
```

Do not run setup merely to test connectivity. No setup, Atlas connection,
deployment, or GitHub push is performed by this recommendation.

## 21. Post-review refinements

The pre-Atlas refinement pass supersedes the implementation gaps described
above:

- Platform API ID helpers now generate standard 26-character lowercase
  Crockford ULIDs with collection-specific prefixes and validators. Mongo
  `_id` remains internal.
- Monetary fields are integer minor units with non-negative validation and
  safe-integer validation and runtime-supported ISO 4217 currency codes.
  Optional opportunity/campaign amounts are paired with currency. Transactions support
  `originalTransactionId`; refund direction is represented by transaction
  type.
- `customerReference` was removed. Customer-bearing records use
  `personId`/`organisationId`, while provider IDs remain explicitly external.
- Permission records are historical decisions with `effectiveAt` and optional
  supersession. A deterministic helper resolves the latest applicable
  subject/scope/channel/purpose decision. There is no permission update schema.
- Events have no update schema. Transaction updates are restricted to status
  and audit metadata; the explicit transition matrix permits idempotent
  same-state writes, pending → completed/failed/voided, and completed →
  refunded, with no terminal-state reopening.
- Contact identity (`type`, original `value`, and `normalizedValue`) is
  immutable through updates. Operational contact flags remain mutable; changing
  identity creates a replacement record.
- Common audit metadata now separates `source` provenance from `createdBy` and
  `updatedBy` actors (`human`, `agent`, `system`, or `integration`).
- Email and phone normalization is centralized. Original values remain
  available, normalized values are not globally unique, and a partial unique
  index enforces one primary contact per person/type.
- Setup now has a pure read-only planner for `--dry-run`; it reports counts,
  missing resources, compatibility/version state, incompatible indexes, and
  confirmed or unable-to-confirm duplicate risks from read-only aggregation
  without creating `schema_versions` or any other resource. `--apply` is
  explicit; no mode refuses to run.
- Schema metadata retains a small applied-migrations list with stable ID
  `001-vapp-v1-baseline` for future sequential migrations without introducing a
  migration engine. Apply backfills a missing baseline entry on compatible
  metadata and preserves existing entries. Standalone
  low-cardinality indexes were pruned where their query value was weak.

Remaining decisions before any Atlas mutation are operational: verify current
Atlas data will not collide with the new prefixed IDs or partial unique primary
contact index, agree on each provider's currency minor-unit rules, and review
the dry-run report before a separately approved `--apply`.
