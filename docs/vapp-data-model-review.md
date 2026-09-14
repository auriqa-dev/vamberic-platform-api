# Vamberic Vapp v1 data model review

## 1. Review scope

This document describes only the current post-refinement implementation. It was regenerated from the TypeScript schemas, collection definitions, setup implementation, command implementation, and tests at implementation commit:

`a2eb34bef1fc20503f1ca516fcece27745f701cb`

The documentation-only commit created after this review is reported separately when the work is completed.

Reviewed implementation:

- `artifacts/api-server/src/domain/ids.ts`
- `artifacts/api-server/src/domain/schemas.ts`
- `artifacts/api-server/src/db/collections.ts`
- `artifacts/api-server/src/db/setup.ts`
- `artifacts/api-server/src/commands/db-setup.ts`
- `artifacts/api-server/test/domain.test.ts`

No Atlas connection or database setup command was used for this review.

## 2. Domain collections

The model defines fourteen domain collections:

1. `products`
2. `people`
3. `contact_points`
4. `organisations`
5. `organisation_relationships`
6. `product_relationships`
7. `marketing_permissions`
8. `opportunities`
9. `subscriptions`
10. `entitlements`
11. `campaigns`
12. `imports`
13. `events`
14. `transactions`

The separate `schema_versions` collection stores database setup metadata and is not a domain collection.

## 3. Application-owned IDs

MongoDB `_id` is deliberately outside the public domain contracts. The Platform API owns application IDs.

### Format

`generateUlid()` returns a 26-character lowercase Crockford Base32 ULID. Its first character is constrained to `0` through `7`, preserving the ULID 128-bit range. It encodes a validated non-negative 48-bit integer timestamp and 80 random bits from Node.js `randomBytes`.

`generatePlatformId(prefix)` and its alias `generateApplicationId(prefix)` return:

`<prefix>_<26-character lowercase Crockford ULID>`

### Exact prefixes

| Record                    | Prefix         |
| ------------------------- | -------------- |
| Product                   | `product`      |
| Person                    | `person`       |
| Contact point             | `contact`      |
| Organisation              | `org`          |
| Organisation relationship | `orgrel`       |
| Product relationship      | `prodrel`      |
| Marketing permission      | `permission`   |
| Opportunity               | `opportunity`  |
| Subscription              | `subscription` |
| Entitlement               | `entitlement`  |
| Campaign                  | `campaign`     |
| Import                    | `import`       |
| Event                     | `event`        |
| Transaction               | `transaction`  |

### Validation

Every persisted domain schema uses its collection-specific platform ID schema. The exact regular expression is:

`^<prefix>_[0-7][0-9abcdefghjkmnpqrstvwxyz]{25}$`

This rejects uppercase characters, ambiguous Crockford characters (`i`, `l`, `o`, and `u`), malformed lengths, unknown prefixes, and valid IDs from the wrong collection. Reference fields use the schema for the referenced collection, not a generic string.

`applicationIdSchema` remains exported as a general lowercase identifier validator, but all fourteen domain record schemas override the base `id` field with a collection-specific platform ID schema.

`isPlatformId(value, prefix?)` validates either any recognized platform prefix or one required prefix.

## 4. Lifecycle and audit actors

All domain records include:

- `createdAt`
- `updatedAt`
- `schemaVersion`, defaulting to `1`
- `archived`, defaulting to `false`
- optional `archivedAt`
- optional `createdBy`
- optional `updatedBy`
- optional `source`

`createdBy` and `updatedBy` use `actorSchema`:

```text
type: human | agent | system | integration
id?: non-empty trimmed string, maximum 300 characters
reference?: trimmed string, maximum 500 characters
```

Insert schemas omit server-managed lifecycle fields, including `createdAt`, `updatedAt`, `schemaVersion`, `archived`, and `archivedAt`. They do not omit `createdBy`, so callers may supply an originating actor. Generic update schemas cannot change `id`, `createdAt`, `createdBy`, or `schemaVersion`; they may set `updatedAt` and `updatedBy`.

## 5. Money

All monetary amounts are non-negative JavaScript safe integers in currency minor units. Decimal and unsafe integer values are rejected.

Currency values are trimmed, uppercased, required to be exactly three letters, and checked against `Intl.supportedValuesOf("currency")`.

Current money fields:

| Collection      | Fields                                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------------------------- |
| `products`      | optional `currency`; no amount field                                                                                |
| `opportunities` | optional `estimatedValueMinor` paired with optional `currency`                                                      |
| `subscriptions` | required `recurringAmountMinor` and required `currency`                                                             |
| `campaigns`     | optional `spendMinor` paired with optional `currency`                                                               |
| `transactions`  | required `grossAmountMinor`; optional `taxAmountMinor`, `feeAmountMinor`, and `netAmountMinor`; required `currency` |

Opportunity `estimatedValueMinor` and campaign `spendMinor` must be supplied together with currency. Product currency does not supply or infer currency for other records.

Transactions may reference `originalTransactionId`, using a transaction-prefixed ID. The current schema permits this reference on any transaction type and does not require it for a refund.

## 6. Customer identity

There is no `customerReference` field in the current model. Subscription, entitlement, and transaction record schemas are strict, so an attempted `customerReference` is rejected.

Internal customer identity uses optional `personId` and `organisationId`, with a refinement requiring at least one. Both may be supplied. Provider-owned identity is represented separately by fields such as `externalCustomerId`, `externalSubscriptionId`, and `externalTransactionId`.

Product relationships similarly require at least one of `personId` or `organisationId`.

## 7. Marketing permissions

Marketing permissions are immutable historical decisions. The model exports a persistence schema and insert schema but no update schema.

Each decision contains:

- optional `personId`
- optional `contactPointId`
- optional `productId`
- `portfolioWide`, defaulting to `false`
- `channel`
- `purpose`: `marketing`, `newsletter`, or `product_communication`
- `lawfulBasis`: `consent`, `legitimate_interest`, `soft_opt_in`, `transactional`, or `other`
- `permitted`
- optional `evidence`
- `effectiveAt`
- optional `supersedesPermissionId`
- optional `reviewAt`
- standard lifecycle and audit fields

At least one of `personId` and `contactPointId` is required. At least one of `productId` and `portfolioWide: true` is required.

`resolveEffectiveMarketingPermission(records, criteria, at)`:

1. Ignores decisions whose `effectiveAt` is later than `at`.
2. Requires exact equality for person, contact point, product, portfolio-wide flag, channel, and purpose.
3. Sorts matching decisions by descending `effectiveAt`.
4. Breaks an effective-time tie by descending `createdAt`.
5. Breaks a remaining tie by descending ID.
6. Returns the first result or `undefined`.

The helper does not traverse or validate a supersession chain. `supersedesPermissionId` records historical linkage, while effective resolution is determined by matching scope and timestamps.

## 8. Event immutability

Events are append-oriented records. The domain surface exports `EventSchema` and `EventInsertSchema`.

There is no `EventUpdateSchema`.

Events may capture type, occurrence time, optional product/person/organisation/campaign references, optional session and external references, and bounded metadata payload.

## 9. Transaction updates and status transitions

`TransactionUpdateSchema` is strict and accepts only:

- required `status`
- optional `updatedAt`
- optional `updatedBy`

It cannot mutate customer identity, product, provider, transaction type, amounts, currency, timestamps, external IDs, attribution, subscription, entitlement, or refund linkage.

Allowed transitions:

| Current     | Allowed next states                        |
| ----------- | ------------------------------------------ |
| `pending`   | `pending`, `completed`, `failed`, `voided` |
| `completed` | `completed`, `refunded`                    |
| `failed`    | `failed`                                   |
| `refunded`  | `refunded`                                 |
| `voided`    | `voided`                                   |

Same-state transitions are idempotent. Terminal states do not reopen.

`canTransitionTransactionStatus` returns a boolean. `assertTransactionStatusTransition` throws for an invalid transition. `transactionStatusUpdateSchema(current)` combines the update contract with transition validation. Plain `TransactionUpdateSchema` validates the shape but does not know the current status.

## 10. Contact normalization and updates

Central contact normalization is implemented by `normalizeContactValue`. `normalizeContact` and its alias `normalizeContactPoint` return the original value and normalized value.

Rules:

- Email: trim surrounding whitespace and lowercase the entire value.
- Phone: trim surrounding whitespace, remove every non-digit formatting character, and retain one leading `+` only when the trimmed input started with `+`.
- Phone: do not infer or add a country code.
- Other: trim surrounding whitespace only.

Persistence and insert schemas verify that `normalizedValue` exactly matches the central normalizer for the supplied type and value.

`ContactPointUpdateSchema` is strict and omits `type`, `value`, and `normalizedValue`. Changing contact identity therefore requires a replacement record. Operational updates may change fields such as primary, validity, deliverability, suppression, organisation departure, validation timestamps, and update audit metadata.

## 11. Index inventory

The implementation declares **52 indexes across 14 domain collections**. This count excludes MongoDB's automatic `_id` indexes and any index on `schema_versions`.

### `products` — 2

1. `id_unique`: `{ id: 1 }`, unique
2. `slug_unique`: `{ slug: 1 }`, unique

### `people` — 1

1. `id_unique`: `{ id: 1 }`, unique

### `contact_points` — 4

1. `id_unique`: `{ id: 1 }`, unique
2. `normalized_value`: `{ normalizedValue: 1 }`
3. `person_type_primary_unique`: `{ personId: 1, type: 1 }`, unique, partial filter `{ primary: true }`
4. `contactability`: `{ validity: 1, deliverability: 1 }`

The partial unique index permits at most one document with `primary: true` for each person/contact-type pair. It does not impose uniqueness on non-primary contacts.

### `organisations` — 3

1. `id_unique`: `{ id: 1 }`, unique
2. `domain`: `{ domain: 1 }`
3. `lifecycle_status`: `{ lifecycleStatus: 1 }`

### `organisation_relationships` — 3

1. `id_unique`: `{ id: 1 }`, unique
2. `person_current`: `{ personId: 1, current: 1 }`
3. `organisation_current`: `{ organisationId: 1, current: 1 }`

### `product_relationships` — 4

1. `id_unique`: `{ id: 1 }`, unique
2. `product_person`: `{ productId: 1, personId: 1 }`
3. `product_organisation`: `{ productId: 1, organisationId: 1 }`
4. `campaign`: `{ campaignId: 1 }`

### `marketing_permissions` — 4

1. `id_unique`: `{ id: 1 }`, unique
2. `person_contact_point`: `{ personId: 1, contactPointId: 1 }`
3. `scope_channel_purpose`: `{ productId: 1, channel: 1, purpose: 1 }`
4. `effective_at`: `{ effectiveAt: -1 }`

### `opportunities` — 4

1. `id_unique`: `{ id: 1 }`, unique
2. `product_pipeline`: `{ productId: 1, status: 1, stage: 1 }`
3. `organisation_status`: `{ organisationId: 1, status: 1 }`
4. `campaign`: `{ campaignId: 1 }`

### `subscriptions` — 4

1. `id_unique`: `{ id: 1 }`, unique
2. `product_status`: `{ productId: 1, status: 1 }`
3. `provider_external_subscription`: `{ provider: 1, externalSubscriptionId: 1 }`, unique and sparse
4. `customer`: `{ personId: 1, organisationId: 1 }`

### `entitlements` — 5

1. `id_unique`: `{ id: 1 }`, unique
2. `product_access_window`: `{ productId: 1, status: 1, activeUntil: 1 }`
3. `customer_status`: `{ personId: 1, organisationId: 1, status: 1 }`
4. `source_subscription`: `{ sourceSubscriptionId: 1 }`
5. `source_transaction`: `{ sourceTransactionId: 1 }`

### `campaigns` — 3

1. `id_unique`: `{ id: 1 }`, unique
2. `product_status`: `{ productId: 1, status: 1 }`
3. `provider_external_reference`: `{ provider: 1, externalReference: 1 }`, sparse

### `imports` — 3

1. `id_unique`: `{ id: 1 }`, unique
2. `provider_imported_at`: `{ provider: 1, importedAt: -1 }`
3. `campaign`: `{ campaignId: 1 }`

### `events` — 7

1. `id_unique`: `{ id: 1 }`, unique
2. `occurred_at`: `{ occurredAt: -1 }`
3. `type_occurred_at`: `{ eventType: 1, occurredAt: -1 }`
4. `product_occurred_at`: `{ productId: 1, occurredAt: -1 }`
5. `person_occurred_at`: `{ personId: 1, occurredAt: -1 }`
6. `organisation_occurred_at`: `{ organisationId: 1, occurredAt: -1 }`
7. `campaign_occurred_at`: `{ campaignId: 1, occurredAt: -1 }`

### `transactions` — 5

1. `id_unique`: `{ id: 1 }`, unique
2. `provider_external_transaction`: `{ provider: 1, externalTransactionId: 1 }`, unique and sparse
3. `product_transacted_at`: `{ productId: 1, transactedAt: -1 }`
4. `status_transacted_at`: `{ status: 1, transactedAt: -1 }`
5. `campaign`: `{ campaignId: 1 }`

## 12. Database schema and migration metadata

Current constants:

- Metadata collection: `schema_versions`
- Supported database schema version: `1`
- Version document ID: `vapp-v1`
- Baseline migration ID: `001-vapp-v1-baseline`

The version document stores:

- `_id`
- `version`
- `schemaVersion`
- `appliedAt`
- optional `updatedAt`
- managed `collections`
- `migrations`, where each entry has `id`, `version`, and `appliedAt`

On first apply, the setup inserts version `1`, all fourteen domain collection names plus `schema_versions`, and the baseline migration entry.

On a compatible existing version document, apply preserves the original `appliedAt` and existing migration entries. It updates metadata only when the stored version is older or the baseline migration entry is missing. A missing baseline entry is appended without replacing prior entries.

No migration later than the v1 baseline is implemented.

## 13. `db:setup --dry-run`

The command accepts exactly one mode argument. With `--dry-run`, it loads configuration, constructs the Mongo client, connects, selects the configured database, and executes `planDatabaseSetup`.

The plan performs read-only operations:

- lists collection names
- reports missing domain collections and `schema_versions`
- lists indexes on existing domain collections
- compares index keys, uniqueness, sparse settings, and partial-filter definitions
- reports missing and incompatible indexes
- counts documents in existing domain collections when the adapter supports counting
- for each missing unique index on a non-empty collection, runs a read-only aggregation to look for duplicate keys
- reads the `vapp-v1` schema-version document when `schema_versions` exists
- classifies compatibility as `new-install`, `compatible`, `upgrade-pending`, or `newer-incompatible`

Duplicate diagnostics distinguish:

- `confirmed-duplicate`
- `no-duplicate-found`
- `unable-to-confirm`

The planner does not call collection creation, index creation, insert, update, delete, or drop operations. It does not create an absent `schema_versions` collection merely by accessing it.

The CLI logs the plan summary with the message `MongoDB schema preflight complete; no changes made`, closes the client, and returns. Driver/configuration errors are not serialized because they could contain credentials.

This review did not execute `--dry-run` against Atlas.

## 14. `db:setup --apply`

With `--apply`, the command connects in the same way and executes `setupDatabase`.

Apply first creates a read-only plan, then:

1. Refuses a stored schema version newer than version `1`.
2. Refuses incompatible existing index definitions.
3. Creates only missing collections.
4. Creates only missing declared indexes.
5. Converts MongoDB `IndexOptionsConflict` failures into `IncompatibleDatabaseSchemaError`.
6. Inserts the v1 version document when absent.
7. Advances older compatible metadata or appends a missing baseline migration entry.
8. Leaves existing domain documents untouched.
9. Does not drop collections or indexes.
10. Does not rewrite existing migration entries.

Repeated apply calls are intended to be idempotent: once collections, indexes, version, and baseline migration metadata exist, subsequent calls report no created collections or indexes and do not alter the migration list.

The plan reports unique-index duplicate risks, but `setupDatabase` does not independently stop on that report. Index creation remains the mutation-time enforcement point and can fail if duplicates exist.

This review did not execute `--apply`.

## 15. Invocation without an explicit mode

`parseSetupMode` accepts exactly one argument: either `--dry-run` or `--apply`.

No argument, both arguments, an unknown argument, or extra arguments cause parsing to fail with usage text. `main` sets exit code `2` and returns before loading configuration, constructing a client, connecting, or performing any mutation.

Runtime setup failures use exit code `1`, log only a fixed safe error message, and attempt to close any client that was created.

## 16. Current automated coverage

The domain test suite contains named coverage for:

- ULID generation and format: `Platform API IDs are prefixed lowercase ULIDs`
- ID uniqueness: the same test generates two product IDs and asserts they differ
- collection-specific ID validation: `application IDs and relationship targets are validated`
- minor-unit money: `money uses non-negative integer minor units and links refunds` and `money requires safe integer amounts, valid currencies, and amount pairing`
- refund linkage: `money uses non-negative integer minor units and links refunds`
- permission resolution: `permission resolution uses the latest effective historical decision`
- event immutability/no update contract: `append-only update contracts are not exported`
- transaction transition rules: `transaction lifecycle accepts only conservative status transitions`
- contact normalization: `contact normalization and partial primary index are explicit`
- primary-contact unique index: the same contact normalization/index test
- dry-run zero mutations: `dry-run planning is read-only and CLI mode is explicit` and `existing-collection dry-run reports counts, conflicts, and duplicate diagnostics`
- no-mode refusal: `no-mode command refusal does not connect`
- apply idempotency: `database setup is repeatable and preserves existing documents` and `apply inserts and then stably backfills the migration ledger`
- compatible metadata backfill: `apply backfills a missing baseline migration on compatible metadata`
- credential leakage: `command failures never log configuration credentials`, plus API readiness/error coverage in `test/api.test.ts`

The exact current test count and validation outcomes are recorded after the review is regenerated and the complete suite is rerun.

## 17. Remaining unresolved decisions

These are genuine open decisions visible from the current implementation:

1. **Currency exponent ownership.** The schemas validate ISO currency codes and integer minor amounts, but they do not convert provider amounts or encode per-currency exponents. Provider adapters must define this behavior.
2. **Refund linkage requirement.** `originalTransactionId` is optional and is not restricted to refunds or adjustments. Decide whether refunds must reference an original transaction and whether other transaction types may use the field.
3. **Financial arithmetic invariants.** The model does not require `netAmountMinor` to equal gross less tax/fees or define sign conventions because all amounts are non-negative. Decide whether these relationships belong in domain validation or provider reconciliation.
4. **Permission scope precedence.** Effective resolution uses exact scope equality. It does not automatically combine person and contact-point decisions or fall back between product-specific and portfolio-wide decisions. Define precedence at the service-policy layer if fallback is required.
5. **Permission supersession integrity.** The model records `supersedesPermissionId` but does not verify that the referenced decision exists, shares scope, precedes the new decision, or forms an acyclic chain.
6. **Transaction transition enforcement boundary.** The transition helper and current-state schema exist, but repositories/services must use them. Plain `TransactionUpdateSchema` cannot validate a transition without the stored current status.
7. **Phone canonicalization.** Formatting is removed without guessing a country. Decide whether ingestion must require E.164, use a trusted country context, or retain nationally formatted identifiers.
8. **Actor identity requirements.** Actor `id` and `reference` are optional for every actor type. Decide which actors require a stable identifier and whether actor type changes validation rules.
9. **Duplicate-risk apply policy.** Dry-run reports confirmed or uncertain unique-index risks, but apply does not proactively refuse them; MongoDB index creation is allowed to fail. Decide whether apply should require a clean preflight or an explicit override.
10. **Future migrations.** Only the v1 baseline exists. Define migration ordering, rollback policy, and deployment coordination before introducing version `2`.
11. **Database-side validation.** Zod enforces contracts in the application, but setup does not install MongoDB collection validators. Decide whether direct database writers must be supported and constrained.
12. **Index validation against production workloads.** The current 52-index set is intentional but has not been validated against Atlas data volume, query plans, write amplification, or actual access patterns.
13. **Existing Atlas compatibility.** Collection names, stored schema metadata, conflicting indexes, document counts, and duplicate risks remain unknown until an explicitly approved read-only Atlas preflight is run.

## 18. Current conclusion

The post-refinement v1 implementation has explicit platform IDs, bounded audit actors, integer minor-unit money, internal customer identity, immutable event and permission contracts, constrained transaction updates, centralized contact normalization, a partial primary-contact uniqueness rule, a complete declared index inventory, and separate read-only planning and explicit apply modes.

The remaining items in section 17 are policy, operational, and future-migration decisions. They are not represented as completed behavior in this document.
