# Administrative CRM hard delete

People, Organisation and Opportunity detail pages now have a separate **Danger zone**. This capability permanently removes records and approved dependents. It does not archive them and cannot be undone. Use it for deliberate test-data cleanup; retain the existing archive/lifecycle semantics for ordinary operations. No automatic deletion or live-data cleanup occurs as part of this implementation.

## Authentication and confirmation

All six routes use the existing Cognito access-token middleware and the configured app client. There is no public equivalent. This repository has no separate administrator-role authorization model: the capability is available to users already authorized to access the private Vapp API, not a newly invented Cognito group. A future narrower role policy belongs in the authorization layer.

| Record       | Preview                                        | Permanent delete                   |
| ------------ | ---------------------------------------------- | ---------------------------------- |
| Person       | `GET /api/v1/people/:id/delete-preview`        | `DELETE /api/v1/people/:id`        |
| Organisation | `GET /api/v1/organisations/:id/delete-preview` | `DELETE /api/v1/organisations/:id` |
| Opportunity  | `GET /api/v1/opportunities/:id/delete-preview` | `DELETE /api/v1/opportunities/:id` |

The preview contains `recordId`, `recordType`, `previewToken`, `willDelete` and `blockedBy`. Each deletion group provides collection, exact count and platform IDs; blockers add a fixed reason/code. It exposes no names, email addresses, message bodies or raw documents. The target is included in the counts. When blockers exist, the displayed scope is a proposal only: **nothing** is deleted.

DELETE requires JSON with both fields:

```json
{
  "confirm": "DELETE",
  "previewToken": "<64-hex-character token from the current preview>"
}
```

The token is a SHA-256 fingerprint of the target and dependency snapshots. It is not an authorization credential and does not replace the exact confirmation. The transaction recomputes the plan and checks blockers/token; changed records or dependencies require a fresh preview and confirmation. Bare DELETE, wrong text, missing token and unknown body properties are rejected with 400. Missing targets return 404; blockers/changed plans return 409; unavailable transactions or failed deletion return a safe 503. The same protections apply to archived records; archiving does not bypass history blockers.

## Discovered dependency graph

| Collection                   | Canonical links relevant to this deletion feature                                                                                 |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `people`                     | Person root; no embedded email or organisation ownership                                                                          |
| `contact_points`             | `personId`                                                                                                                        |
| `organisations`              | Organisation root; customer/partner classification is protected                                                                   |
| `organisation_relationships` | `personId`, `organisationId`                                                                                                      |
| `product_relationships`      | `productId`, optional `personId` / `organisationId`; customer status/history                                                      |
| `opportunities`              | Required Organisation and Product; `personIds` array; optional Campaign                                                           |
| `events`                     | Optional Person/Organisation/Product/Campaign; enquiry `payload.opportunityId`                                                    |
| `marketing_permissions`      | Person and/or Contact Point; Product/portfolio scope; `supersedesPermissionId`; public-enquiry JSON evidence contains `enquiryId` |
| `subscriptions`              | Person/Organisation and Product                                                                                                   |
| `entitlements`               | Person/Organisation and Product; source Transaction/Subscription                                                                  |
| `transactions`               | Person/Organisation and Product; original Transaction, Subscription, Entitlement and Campaign                                     |
| `campaigns`                  | Product; no canonical Person/Organisation/Opportunity foreign key                                                                 |
| `imports`                    | Optional Product/Campaign; no canonical Person/Organisation/Opportunity foreign key                                               |

Products, Campaigns and Imports are never deleted. Arbitrary metadata/free text is not treated as a general foreign-key system. The existing enquiry-to-Opportunity payload and permission-evidence links are explicitly handled; unknown event lifecycle/payload semantics are blocked rather than guessed.

## Cascade and retention rules

**Opportunity:** remove the Opportunity and only its recognised, consistent public-enquiry Events. Preserve People, Organisations, Products, their relationships and unrelated Events. An Event is eligible only when it has `eventType=enquiry_submitted`, `source.system=public_enquiry`, `payload.form=public_product_enquiry`, form version 1 or 2, the same Opportunity/Product/Organisation, a Person on that Opportunity, no campaign/session/external lifecycle reference and only the known enquiry payload keys. Other Events referencing that Opportunity block deletion.

**Person:** remove the Person, all their Contact Points and Organisation Relationships, their eligible Product Relationships, eligible linked Opportunities and safe enquiry Events. Preserve Organisations and other People. A shared Opportunity containing another Person blocks the cascade. Any directly linked Event that is not a safe enquiry Event blocks deletion.

**Organisation:** remove the Organisation, its Organisation Relationships, eligible Product Relationships, eligible Opportunities and safe enquiry Events. Preserve People and their Contact Points. A directly linked Event with other lifecycle significance blocks deletion.

Marketing Permissions are removed only when explicitly marked `source.system=test`, affected by the subject/contact deletion or referencing an Event in the deletion scope, and not shared with another Person/Contact Point during a Person deletion. Retained permission supersession references block deletion. Normal public-enquiry opt-in history is **not** a test marker and is protected, including evidence-only links to an Event. No automatic marking, consent override or inferred test-data classification is implemented.

## Blockers

The policy is intentionally conservative:

- **All** Transactions, Subscriptions and Entitlements associated with the target or the Person/Organisation context of a selected Opportunity block deletion, regardless of status or archived state. Completed/refunded transactions, active subscriptions and entitlements are therefore always protected; ended/failed historical records are also retained.
- Customer, former-customer, trial or partner Product Relationships, and any relationship with `customerSince`, block deletion. Only prospect/engaged relationships are eligible for removal.
- Customer or partner Organisations in the selected context block deletion.
- Opportunities must be open public-enquiry records at stage `enquiry`, with no value/currency (even a recorded zero blocks), won/lost timestamp, internal Campaign reference, probability, expected close or follow-up fields. Other commercial/pipeline history blocks deletion.
- Shared Person opportunities, unknown/inconsistent Events, non-test/shared permission history and retained permission supersession references block deletion.
- More than 1,000 matches in any dependency query, or a malformed related platform ID, requires separate administrative review and returns 409 without deletion.

These checks can protect a prospect enquiry because its Person or Organisation also has commercial history elsewhere. This deliberately favours retaining real history over aggressive cleanup. Blockers cannot be bypassed by changing the preview token or confirmation text.

## Transactions, concurrency and audit

Both preview and deletion use the existing Mongo snapshot/majority transaction adapter. There is **no non-transactional fallback**. Delete reloads the graph, rechecks all blockers and preview content, removes dependent rows in order (test permissions, safe events, opportunities, eligible relationships, contact points), then removes the Person/Organisation target. An Opportunity target follows its dependent permissions/events. A deleted-count mismatch, write conflict, exception or commit failure aborts the operation; the existing transaction driver handles its normal transient retries. Audit success is emitted only after commit.

The current public enquiry writer already updates reused Contact Points and Organisations inside its transaction. Deleting those same documents conflicts with concurrent reuse, so neither operation can silently commit against a removed dependency. A new enquiry accepted after cleanup may legitimately create fresh records. Mongo has no foreign-key enforcement: future independent financial/CRM writers must coordinate parent/dependency writes and recheck existence inside their transactions; this feature does not claim to serialize arbitrary external database writers. Public enquiry persistence and notifications are unchanged.

Application audit logs include authenticated actor subject, target type/platform ID, timestamp, safe success/failure code and per-collection deleted counts. They contain no deleted names, email addresses, enquiry bodies or raw Mongo errors. Failed attempts report no deleted counts. No new Mongo Event references a deleted entity. Application logs provide this tranche's audit; no durable audit/outbox collection is introduced.

## Vapp flow

1. Open a detail page and choose **Delete permanently** in the lower Danger zone.
2. Wait for the current preview. Review every collection count and expandable platform-ID list.
3. Resolve any blockers through a separately reviewed process; the UI cannot bypass them.
4. Type exactly `DELETE`, then use the destructive confirmation button.
5. After successful deletion, related People/Organisations/Opportunities/preview/dashboard React Query caches are cancelled, invalidated and removed; Vapp returns to the relevant list and shows a success toast.

Confirmation is disabled while previewing/deleting or when blockers exist. A 409 refreshes the preview and clears confirmation, exposing new blockers. Failures display fixed, safe UI text rather than raw server/Mongo errors. Cancelled previews cannot restore a closed dialog, and duplicate submits are prevented.

## Recommended HVM test cleanup

For ordinary open test enquiries **without opt-in or commercial history**, the easiest path is to delete the test **Person** after reviewing the preview. This also removes their enquiry Opportunities/Events, Contact Points and eligible relationships. Then delete the remaining test **Organisation**. Alternatively delete the Organisation first, then the retained Person; neither root silently deletes the other.

Deleting an Opportunity first is also supported: its enquiry Event is removed while Person/Organisation remain for deliberate later cleanup. There is no need to manually remove link collections. Products remain intact in every path.

If the test submission created normal marketing opt-in history, the UI deliberately refuses the affected cascade. Do not relabel live consent as test data merely to bypass the blocker. That case requires a separately authorized history/consent review. Current live HVM records were not inspected, so their eligibility is not asserted.

## Validation and scope

No schema/index migration, new collection, infrastructure change or live MongoDB connection is required or performed. Generated clients and validators come from OpenAPI. Validated locally with Node **24.21.0** and pnpm **10.26.1**. API tests use an in-memory transactional substitute, not a real Mongo replica set. UI tests exercise the preview renderer, confirmation workflow, safe blockers/errors and actual React Query cache clearing; browser visual/end-to-end verification is not claimed. Nothing is deployed, committed or pushed.

| Check                                                  | Result                                                                                        |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `PORT=3000 BASE_PATH=/ pnpm run build`                 | Pass; Vapp bundle-size warning above 500 kB remains                                           |
| `pnpm --filter @workspace/api-server run lint`         | Pass                                                                                          |
| `pnpm run typecheck`                                   | Pass                                                                                          |
| `pnpm --filter @workspace/api-server run test`         | **166/166 pass**, including 23 hard-delete tests and all 143 existing tests                   |
| UI workflow/preview renderer and client fetch tests    | **10/10 pass**                                                                                |
| `pnpm --filter @workspace/api-server run format:check` | Pass                                                                                          |
| `pnpm --filter @workspace/api-spec run codegen`        | Pass; repeated generation of all **75 files** has identical SHA-256 hashes (zero differences) |
| `git diff --check`                                     | Pass                                                                                          |

Tests required permission for local HTTP listeners. All deletion/rollback data was in memory. No live MongoDB or SES was used. Existing public enquiry, notification, CRM read, Product, authentication and dashboard tests remain passing.

## Files changed / final git status

The new service contains the dependency planner, blocker policy, transactional delete and safe audit. A private router exposes the six operations. The Danger zone uses a shared confirmation workflow and a tested preview renderer. The transactional test helper now supports rollback-safe deletion. OpenAPI drives all generated changes; generated files were not manually edited. Existing CRM documentation links to these policies.

All changes are unstaged; nothing was committed or pushed.

```text
 M artifacts/api-server/src/routes/index.ts
 M artifacts/api-server/test/helpers/enquiry-db.ts
 M artifacts/vapp/src/pages/crm/index.tsx
 M docs/crm-visibility.md
 M lib/api-client-react/src/generated/api.schemas.ts
 M lib/api-client-react/src/generated/api.ts
 M lib/api-client-react/test/custom-fetch.test.ts
 M lib/api-spec/openapi.yaml
 M lib/api-zod/src/generated/api.ts
 M lib/api-zod/src/generated/types/index.ts
?? artifacts/api-server/src/routes/crm-delete.ts
?? artifacts/api-server/src/services/crm-delete.ts
?? artifacts/api-server/test/crm-delete.test.ts
?? artifacts/vapp/src/pages/crm/delete-danger-zone.tsx
?? artifacts/vapp/src/pages/crm/delete-preview.test.ts
?? artifacts/vapp/src/pages/crm/delete-preview.tsx
?? artifacts/vapp/src/pages/crm/delete-workflow.test.ts
?? artifacts/vapp/src/pages/crm/delete-workflow.ts
?? docs/crm-hard-delete.md
?? lib/api-zod/src/generated/types/crmDeleteBlocker.ts
?? lib/api-zod/src/generated/types/crmDeleteError.ts
?? lib/api-zod/src/generated/types/crmDeleteErrorError.ts
?? lib/api-zod/src/generated/types/crmDeleteGroup.ts
?? lib/api-zod/src/generated/types/crmDeleteInput.ts
?? lib/api-zod/src/generated/types/crmDeleteInputConfirm.ts
?? lib/api-zod/src/generated/types/crmDeletePreview.ts
?? lib/api-zod/src/generated/types/crmDeletePreviewRecordType.ts
?? lib/api-zod/src/generated/types/crmDeleteResult.ts
?? lib/api-zod/src/generated/types/crmDeleteResultRecordType.ts
```
