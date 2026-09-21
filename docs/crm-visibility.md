# Read-only CRM visibility

Vapp now has searchable People and Organisations pages, an Opportunities page with status, exact-stage and Product filters, and linked detail pages. Existing dashboard counts, Campaigns, Subscriptions and the standalone Events placeholder are unchanged. No new collections, persistence schemas, indexes or migration are required.

## Private API

All routes require the existing Cognito access token. There are no public CRM read routes. Responses use `Cache-Control: no-store` and explicit response projections; Mongo `_id`, audit metadata, raw source references, consent evidence and arbitrary event payloads are not returned.

| List                        | Detail                          | Search / filters                                                                           |
| --------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------ |
| `GET /api/v1/people`        | `GET /api/v1/people/:id`        | `search`: literal case-insensitive first name, last name, display name or email            |
| `GET /api/v1/organisations` | `GET /api/v1/organisations/:id` | `search`: literal case-insensitive name or domain                                          |
| `GET /api/v1/opportunities` | `GET /api/v1/opportunities/:id` | `search`: name; `status`: open/won/lost/paused; `stage`: exact existing value; `productId` |

Lists return `{ items, total, limit, offset }`. The default limit is 50 (1–100); offset defaults to 0 (maximum 100,000). Records sort by newest creation then ID. Vapp uses 25 records per page. Invalid filters/IDs return 400, absent or archived detail records return 404, and missing authentication returns 401. Archived primary records and archived relationships/contact points are excluded.

People expose their recorded identity, primary email where designated, source system, created date and current organisation relationships with recorded job titles. Multiple current organisations are retained. Person detail includes contact points, associated Product relationships, opportunities and the most recent 10 events. Historical missing surnames are displayed without inventing values.

Organisation people counts are **distinct, non-archived People with a current, non-ended organisation relationship**; opportunity counts include all non-archived statuses. Detail shows the corresponding people and opportunities, plus recorded Product relationships. Historical ended employment is not counted as current employment.

Opportunities show Product, Organisation and Person links, actual status/stage, timestamps and source system. Amount and currency appear only when both are recorded; an actual zero is retained. No monetary value or pipeline stage is invented. Detail shows up to 10 `enquiry_submitted` events linked through the existing `payload.opportunityId`, including message, service interest and attribution. Other person event types expose only type, time and references. Missing or archived Product/Organisation references retain the ID as a fallback label.

All list association data is derived at read time; nothing is denormalized or written. Detail relationship lists are complete; only recent events are capped. These minimal views use existing collection queries and are intended for the current small CRM. Larger datasets may warrant additional query/index optimisation; no live database inspection or index changes were performed.

## Public enquiry identity change

The same public endpoint now requires `firstName` and `lastName`, each a trimmed nonempty string of at most 100 characters. Neither field is split. `displayName` joins the submitted values with one space. The old `name` property is rejected; this avoids ambiguous compatibility behaviour for the single known consumer.

Existing Person identity and historical enquiry events are preserved. Persistence still accepts historical missing surnames, and email reuse does not replace an existing person's names. New events use `formVersion: "2"` and explicit submitted first/last names. No data migration is required.

HVM must collect and send the two fields and remove `name`, coordinating its release with this breaking API contract. Endpoint, Product ID (`product_01m2wffbf3p9p19d3nd1s2fp3x`), consent evidence and attribution remain as documented in [Public enquiries](public-enquiries.md). No HVM website files are changed here.

## Validation

Validation uses Node 24.21.0 and pnpm 10.26.1. API integration tests use an in-memory database and local HTTP listeners, with no live MongoDB connection. The CRM tests cover all six authentication boundaries, lists/details, empty states, 404s, invalid filters, literal search, pagination, current relationship counts, Product/Person/Organisation linkage, read-only behaviour and safe bounded event projections. Enquiry tests cover explicit names, missing/empty/oversized names, legacy payload rejection, historical identity preservation and existing dedupe/consent/CORS/transaction/attribution behaviour.

| Check                                                  | Result                                                                            |
| ------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `PORT=3000 BASE_PATH=/ pnpm run build`                 | Pass; existing Vapp bundle warning above 500 kB                                   |
| `pnpm --filter @workspace/api-server run lint`         | Pass                                                                              |
| `pnpm run typecheck`                                   | Pass                                                                              |
| `pnpm --filter @workspace/api-server run test`         | 97/97 pass (7 new CRM tests and 7 net additional enquiry tests)                   |
| `pnpm --filter @workspace/api-server run format:check` | Pass                                                                              |
| `pnpm --filter @workspace/api-spec run codegen`        | Pass; repeated generation has identical SHA-256 hashes for all 65 generated files |
| `git diff --check`                                     | Pass                                                                              |
| Generated client fetch/authentication tests            | 2/2 pass                                                                          |

Local HTTP tests required sandbox permission to listen on loopback. No live MongoDB was used. Browser visual verification and live end-to-end validation are not claimed. Nothing has been committed, pushed or deployed.

## Changed files and final working tree

The API work is in `src/routes/crm.ts`, `src/services/crm.ts`, router registration and the existing enquiry service. Vapp changes are in `src/pages/crm/index.tsx` and `App.tsx`. OpenAPI drives the regenerated React client and Zod schemas/types. Tests cover the new read routes and updated contract; the in-memory helper now supports the corresponding read filters, sorting and pagination. Documentation records the HVM handoff and validation.

All changes below are unstaged; there are no deletions. Generated files were produced by codegen, not manually edited.

```text
 M artifacts/api-server/src/routes/index.ts
 M artifacts/api-server/src/services/enquiries.ts
 M artifacts/api-server/test/helpers/enquiry-db.ts
 M artifacts/api-server/test/public-enquiries.test.ts
 M artifacts/vapp/src/App.tsx
 M docs/public-enquiries.md
 M lib/api-client-react/src/generated/api.schemas.ts
 M lib/api-client-react/src/generated/api.ts
 M lib/api-client-react/test/custom-fetch.test.ts
 M lib/api-spec/openapi.yaml
 M lib/api-zod/src/generated/api.ts
 M lib/api-zod/src/generated/types/index.ts
 M lib/api-zod/src/generated/types/publicEnquiryInput.ts
?? artifacts/api-server/src/routes/crm.ts
?? artifacts/api-server/src/services/crm.ts
?? artifacts/api-server/test/crm.test.ts
?? artifacts/vapp/src/pages/crm/index.tsx
?? docs/crm-visibility.md
?? lib/api-zod/src/generated/types/crmContactPoint.ts
?? lib/api-zod/src/generated/types/crmEvent.ts
?? lib/api-zod/src/generated/types/crmOpportunitiesPage.ts
?? lib/api-zod/src/generated/types/crmOpportunity.ts
?? lib/api-zod/src/generated/types/crmOpportunityDetail.ts
?? lib/api-zod/src/generated/types/crmOpportunityStatus.ts
?? lib/api-zod/src/generated/types/crmOrganisation.ts
?? lib/api-zod/src/generated/types/crmOrganisationDetail.ts
?? lib/api-zod/src/generated/types/crmOrganisationLink.ts
?? lib/api-zod/src/generated/types/crmOrganisationsPage.ts
?? lib/api-zod/src/generated/types/crmPeoplePage.ts
?? lib/api-zod/src/generated/types/crmPerson.ts
?? lib/api-zod/src/generated/types/crmPersonDetail.ts
?? lib/api-zod/src/generated/types/crmProductLink.ts
?? lib/api-zod/src/generated/types/crmReference.ts
?? lib/api-zod/src/generated/types/listOpportunitiesParams.ts
?? lib/api-zod/src/generated/types/listOpportunitiesStatus.ts
?? lib/api-zod/src/generated/types/listOrganisationsParams.ts
?? lib/api-zod/src/generated/types/listPeopleParams.ts
```

## Permanent administrative cleanup

People, Organisation and Opportunity detail pages now include a separate preview-and-confirm Danger zone. See [CRM hard delete](crm-hard-delete.md) for exact cascades, history blockers, consent policy and transactional guarantees. The existing read routes and dashboard counts are unchanged.
