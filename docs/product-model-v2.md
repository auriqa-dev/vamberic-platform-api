# Product model expansion

Implementation status: live read-only inspection and the Product v2 dry-run have now completed against `vamberic_studio`, using the existing `vamberic/dev/api` secret supplied only through process memory. One Product was found and would be affected. **No apply has been run**, no live records were changed, and no HVM product was created.

## Findings and scope

The authoritative store is MongoDB, database `vamberic_studio`, collection `products`; `lib/db` is not the Product persistence implementation. Zod domain schemas validate persistence, OpenAPI generates the HTTP validators and React client/types, and Express implements list/create/detail/update. Both create and detail/edit use `ProductForm`.

Previously, Product had `id`, `name`, `slug`, `description`, `status` (`idea`, `validation`, `active`, `paused`, `retired`), free-text `productType` and `commercialModel`, `domains[]`, `oneOffPurchaseAvailable`, `subscriptionAvailable`, optional `currency` and `internalNotes`, plus standard persistence metadata. Currency was already validated against the runtime ISO 4217 list in the backend; the form defaulted to USD. The dashboard counted `status=active`. No Offers or Brand collections were added.

## Database changes and migration

This is an additive document migration, not a collection replacement. New controlled values use application-validated strings and arrays, allowing types to be extended without a database enum alteration. `businessModel` is one optional primary model initially. `revenueModels` is an array of unique controlled strings. Existing ID/slug unique indexes remain unchanged. Unrelated collections are untouched.

`normalizeProduct` is a pure, idempotent read adapter used by detail, list, dashboard, edits, and the migration command. A legacy record receives `productModelVersion=2` and a full `legacyProductData` snapshot (excluding Mongo `_id`, which remains on the record). Existing unknown fields and superseded fields remain stored. Edits use `$set`, not document replacement; concurrent changes return HTTP 409. Migration writes check both the original modification time and migration version.

| Old data                                                      | New representation                                                                                           |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Known product type                                            | Same `productType`                                                                                           |
| Unrecognised type, including `assessment`                     | `productType=null`; original and review notice retained; no guess of software/service/other                  |
| `idea`, `paused`, `retired`                                   | Same `lifecycleStatus`                                                                                       |
| `active`, `validation`, unknown status                        | `lifecycleStatus=null`; original and review notice retained; neither proves a launch stage                   |
| Commercial model exactly matching new business list           | Same `businessModel`                                                                                         |
| Other commercial model, such as freemium/one-off/subscription | `businessModel=null`; original and review notice retained                                                    |
| Purchase boolean true                                         | Add `one_off` to `revenueModels`                                                                             |
| Subscription boolean true                                     | Add `subscription` to `revenueModels`                                                                        |
| Both booleans false or absent                                 | Empty array; never infer `free`                                                                              |
| One domain                                                    | `primaryDomain`; no additional domains                                                                       |
| Multiple domains                                              | Preserve all in their original order as `additionalDomains`; primary remains null pending explicit selection |
| Existing currency or absent currency                          | Preserved; migration never applies GBP                                                                       |
| No historical launch/operating information                    | Null; no invented launch dates or investment mode                                                            |

### Reviewed Energy Health Check exception

The owner explicitly classified the existing diagnostic application as a one-off transactional product. The exception requires ID `product_01m2t4kk2ac6687tb5fxd3q3tb`, name `Energy Health Check`, slug `energy`, status `idea`, product type `software`, commercial model `paid`, purchase enabled and subscription disabled. Only this reviewed legacy state maps `businessModel` to `transactional`. `paid` remains ambiguous for other IDs or changed states. An already migrated record is never reclassified by this exception.

The successful live dry-run proposed `productType=software`, `lifecycleStatus=idea`, `businessModel=transactional`, `revenueModels=[one_off]`, `currency=GBP`, `primaryDomain=null`, and `additionalDomains=[]`, with **no warnings**. Operating mode, launch dates, hypothesis and success measures remain null; no launch or future subscription is inferred. The original document is retained in `legacyProductData` (excluding Mongo `_id`, which remains on the record). Identity, timestamps, existing notes/description and all legacy commercial fields remain unchanged.

Inspection found no pre-existing v2 fields or legacy snapshot on this record, so the proposed new fields do not overwrite existing v2 information. Applying this inspected plan is safe subject to the owner's explicit approval and an unchanged record. A later dry-run must review any changed state or additional products; this finding is not a general approval for future migrations.

Review notices represent migration findings; the original snapshot remains available through the authenticated detail response even after corrections. They are historical and are not automatically dismissed.

With `MONGODB_URI` already set through the environment's normal secret configuration:

```sh
pnpm --filter @workspace/api-server db:migrate-products --dry-run
pnpm --filter @workspace/api-server db:migrate-products --apply
```

First inspect the dry-run inventory and its review notices against the actual portfolio. The command validates every planned record before its first write. Validation failure prevents the apply phase; concurrent edits stop further writes. Already migrated records are skipped on rerun. This is resumable per-document migration, not a multi-document transaction. Take the environment's normal database backup before rollout. Deploy the regenerated client and backend together; callers using the superseded HTTP fields must update to the new contract. Old database documents remain readable before applying the migration.

## Frontend and API

The shared create/edit screen now has Product Identity, Market & Commercial, Launch & Validation, and Internal sections. All new fields are editable, including actual launch date. Controlled fields use dropdowns and revenue models use labelled multi-select checkboxes. Optional fields can be cleared. GBP defaults only for new products; editing a USD product retains USD. The API also defaults omitted currency to GBP on creation only.

Lifecycle and operating mode are independent: `live` plus `listen` is accepted. Dates are nullable calendar-date strings, checked for valid dates and never derived from record creation. Domain strings do not require a URL scheme. Invalid enums, ISO currency values, duplicate revenue models, and invalid dates return 400.

The list uses friendly type/business/lifecycle labels and new lifecycle filters. Portfolio wording now includes services, agencies, and experiments. Dashboard “Live Products” counts lifecycle `live`, including listen/maintain. Its existing `activeProducts` response key is retained for compatibility; `draftOrInactiveProducts` counts everything not confirmed live, including unresolved historical statuses. Product relationships, opportunities, transactions, subscriptions and entitlements already reference generic Product IDs, so no software-only dependencies there required changes.

## Final fields and allowed values

Code and HTTP use the repository's existing camelCase convention. In particular, requested `currency_code` retains the existing `currency` name; it was never stored as `currency_code` here.

| Field                                                                         | Representation / allowed values                                                                                                         |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                                                          | Immutable `product_` platform ID; Mongo also retains its internal `_id`                                                                 |
| `name`                                                                        | Required text, 1–200 characters                                                                                                         |
| `slug`                                                                        | Required unique lowercase slug, 2–100 characters                                                                                        |
| `description`                                                                 | Optional text, up to 10,000 characters                                                                                                  |
| `productType`                                                                 | `software`, `consumer_app`, `marketplace_app`, `service`, `agency`, `content`, `website`, `experiment`, `other`                         |
| `lifecycleStatus`                                                             | `idea`, `building`, `pre_launch`, `live`, `paused`, `retired`                                                                           |
| `operatingMode`                                                               | `active`, `maintain`, `listen`, or null                                                                                                 |
| `businessModel`                                                               | `saas`, `professional_services`, `transactional`, `marketplace`, `advertising`, `content`, `lead_generation`, `other`, or null          |
| `revenueModels`                                                               | Zero or more unique values: `one_off`, `subscription`, `retainer`, `usage`, `marketplace`, `advertising`, `commission`, `free`, `other` |
| `currency`                                                                    | Valid ISO 4217 code; optional/null; GBP default on creation only                                                                        |
| `primaryDomain`                                                               | One string, up to 253 characters, or null                                                                                               |
| `additionalDomains`                                                           | 0–50 strings, each up to 253 characters                                                                                                 |
| `plannedLaunchDate`                                                           | Nullable valid `YYYY-MM-DD` calendar date                                                                                               |
| `actualLaunchDate`                                                            | Nullable valid `YYYY-MM-DD` calendar date                                                                                               |
| `launchHypothesis`                                                            | Nullable text, up to 20,000 characters                                                                                                  |
| `successMeasures`                                                             | Nullable text, up to 20,000 characters                                                                                                  |
| `internalNotes`                                                               | Optional text, up to 20,000 characters                                                                                                  |
| `createdAt`, `updatedAt`                                                      | Server-managed timestamps                                                                                                               |
| `productModelVersion`                                                         | Internal marker `2`                                                                                                                     |
| `legacyProductData`                                                           | Optional preserved pre-migration document snapshot                                                                                      |
| `migrationWarnings`                                                           | Optional historical review notices                                                                                                      |
| `schemaVersion`, `archived`, `archivedAt`, `createdBy`, `updatedBy`, `source` | Existing domain metadata retained; not editable through Product HTTP input                                                              |

New products must supply non-null product type and lifecycle. Nulls for these two fields are reserved for unresolved migrated records; unrelated edits can preserve them. Old records also retain superseded `status`, `commercialModel`, `domains`, `oneOffPurchaseAvailable`, and `subscriptionAvailable` fields as historical data. They are not updated by the new form and are not canonical business fields.

## Validation and limitations

- All 41 API-server tests pass, including authenticated HTTP integration tests using an in-memory Mongo substitute and dedicated migration tests.
- Workspace TypeScript checks pass; API-server ESLint passes; Vapp production build passes.
- Coverage for requested A/B/L uses representative legacy records: load, unrelated edit, preserved ID, timestamps, USD currency, domains, commercial fields, notes, original snapshot, and unknown future fields. Migration tests cover all old statuses plus unknown/dormant and all four combinations of revenue booleans, idempotency, and non-mutation.
- C–K cover Software and Agency create/reload, multiple revenue models, primary/additional domains, GBP for new products, lifecycle and operating mode independence, long text, nullable clearing, planned date without actual date, and setting actual date explicitly.
- M/N cover list/dashboard loading and HTTP rejection of invalid controlled values, duplicate revenues, invalid currency, and impossible calendar dates.
- Live inspection and dry-run are verified for the one existing Energy Health Check record; actual migration and post-migration persistence remain unperformed pending approval. Browser interaction/visual QA was attempted with a temporary local form preview, but the computer-use tool reported no browser available; the preview files and server were removed. Build and API tests do not substitute for those checks.
- The production build reports a JavaScript chunk above 500 kB. This is a bundle-size warning, not a build failure.
- List/filter and dashboard normalization scan the small portfolio in memory during legacy compatibility. Suitable for the requested hundreds of products; introduce database-side filtering/aggregation and pagination if volume grows substantially.
- No legacy-field removal or destructive rollback is included. Before removing legacy fields later, audit external consumers and reconcile all outstanding mappings.

## Future Offers, Brand and metrics

The stable Product ID remains the parent boundary. Future Offers, Brand/settings and structured KPI documents can each reference `productId`, without adding service-specific fields or modifying the core identity. Offers can own pricing, revenue configuration and lead attribution independently. Brand records can reference asset storage URLs/IDs; no image binaries belong in Product. Narrative success measures remain independent of future structured metrics. A future multi-business-model array can be added alongside the initial primary business model and migrated additively.
