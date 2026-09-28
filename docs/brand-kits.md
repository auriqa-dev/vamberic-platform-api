# Shared Brand and Brand Kit foundation — proposed schema v4

Hive stores canonical shared Brand Kits. A Brand is a customer-facing identity distinct from its operating Organisation and from a Product sold under it. Workspaces are the client operational/data boundary, not a statement of legal ownership. Content, Social, Web, Campaign, Advertising and Email agents consume the kit; none owns it.

No existing Brand collection, file registry or reusable application S3 asset model was found. Existing S3 configuration is for deployment assets, not client uploads. This proposal adds two domain collections and embedded object references, not a file subsystem or provider-specific storage collection.

The intended relationship is Organisation/business → Brand → Products/future Offers → shared Brand Kit → channels/accounts → data connections → swarm configuration → authorized agents. Partner/Queen relationships define authorized operators through central authorization; changing Partner does not move brand data or assets.

## Brand

`brands`: canonical `brand_…` ID; required workspaceId, organisationId, name, workspace-scoped slug, status (`active | retired`), creation/update times; optional primaryDomain, description, human audit actors, provenance/archive fields. Every Brand has an explicit workspace, including internal clients. No implicit internal scope gives Vapp operational edit access.

Organisation may be an internal registry identity or belong to the same workspace; cross-workspace Organisation references are rejected. Products gain optional `brandId` in the persistence/domain model only. A linked Product must share the exact Brand workspace. Existing portfolio Products remain unchanged and unlinked; no inference from name/domain is made. Existing Vapp Product HTTP contracts are unchanged and do not provide Brand linking. A future trusted writer must validate relationships transactionally.

One Brand may serve multiple Products. Products store the reference, never kit copies. Offers have no canonical model yet; their eventual Brand reference should obey the same scope rule. Product/Offer overrides are deferred.

## Canonical Brand Kit

`brand_kits`: canonical `brandkit_…` ID, workspaceId, brandId, `draft | approved | retired` status, timestamps, human-only createdBy/updatedBy, optional provenance/archive fields. Human identity is issuer + subject, not a Partner ID. Approved status requires approvedAt and approvedBy; approval date cannot predate creation or exceed update time; archived kits cannot be approved. Schemas validate identities structurally; trusted writers must authenticate the human.

At most one **current approved** kit per workspace/Brand is enforced. `approved` means current; `draft` is a candidate revision and `retired` is retained history. Multiple drafts and retired records may coexist. No current flag, revision counter or full history subsystem is needed. Retiring a kit frees the approved slot for its replacement. `schemaVersion` remains document shape version, not an editorial revision counter. Future writers should prepare a separate draft while the old approved kit remains current, then atomically retire the old kit and approve the replacement in a transaction with concurrency checks. A non-atomic retirement leaves no current kit until approval, never two. Editing content must require fresh human approval; scope remains immutable. No write API exists in this task.

Supported categories:

- **Assets:** logos/brand marks, photography, product imagery, icon sets, illustrations, graphics, backgrounds, email header/footer assets. Variants primary, compact, light, dark, monochrome, favicon and other (descriptive name required).
- **Colours:** semantic role (`primary | secondary | accent | surface | text`), name, six/eight-digit hex and optional usage guidance; up to 100 entries rather than a fixed palette size.
- **Typography:** primary/secondary/heading/body roles, family, optional numeric weights, normal/italic/oblique styles and usage notes. No font binaries.
- **Visual rules:** layout, spacing, borders/radius, image treatment, icon/illustration guidance, do/don’t notes.
- **Voice:** descriptors, principles, writing guidance, avoided/preferred terms and audience-specific notes.
- **Terminology:** approved Product/capability names, use/avoid terms, acronyms and naming conventions.
- **Descriptions:** short/long brand copy, tagline, About, company/legal copy, footer and approved Product descriptions. Product copy references must belong to this Brand/workspace. Temporary campaign copy remains outside the kit.
- **Imagery guidance:** photography, Product imagery, icons, illustrations, motifs and backgrounds.
- **Email defaults:** display name, reply-to label and optional existing same-workspace ContactPoint reference, footer, signature, legal text and unsubscribe styling notes. Provider/account setup stays in workspace integrations. No sender credentials, tokens or provider objects are accepted.

All nested structures are strict, arrays/text bounded; domain validation also limits a kit to 200KB of serialized data. Mongo validates the document/nested shapes, enum/colour patterns, arrays and lifecycle dates; cross-document references and aggregate size remain trusted writer checks. `brandKitReadiness` derives simple presence booleans for logo, colours, typography, voice, descriptions and email defaults. Presence is neither approval nor a quality score and is not persisted as stale duplicated state.

## Asset reference and future upload boundary

Each embedded asset carries type, optional variant, name, optional alt text, approved/retired status and strict `object: {store: "s3", bucket, key, versionId?}`. No raw binary, base64, data URLs, font data, signed URLs, arbitrary metadata or credential fields. Object keys reject traversal and accept a bounded conservative character set. Version IDs can pin approved assets to immutable S3 versions; no S3 resource is provisioned or assumed to exist.

Future upload flow must authorize workspace/Brand, allocate a server-chosen bucket/key in a permitted workspace prefix, issue a short-lived upload grant, validate content/type/size and security checks, then persist the reviewed object reference. Asset download/signing must reauthorize scope and allowlist bucket/key; a syntactically valid reference is not permission to fetch an arbitrary object. Mutable unversioned objects must not silently change approved branding. No upload, signing, image processing, file UI or S3 call is implemented here.

## Agent consumption and isolation

`readCurrentBrandKit` is a read-only service seam, not a public endpoint. It requires central read authorization for both Brands and Brand Kits in the requested workspace, verifies the workspace is not archived, then queries the active Brand and approved, unarchived kit using the exact workspace predicate. It reads at most two matching records and fails closed if multiple approved kits are found (defence if the index is absent/corrupt). It validates returned records, excludes retired assets, and returns Brand + kit + derived readiness. Draft/retired kits return no current kit. Asset references do not fetch object contents or authorize downloads.

Vapp remains denied client-workspace operational data. HVMapp needs trusted workspace membership resolution. Every agent/system consumer needs explicit scoped resource/action grants; knowing a Brand ID, Organisation ID or Partner assignment grants nothing. Planned consumers: Content Strategy, Content Creation, Campaign Orchestration, Web Channel, Social, Email Channel, AI Advertising, Paid Media and measurement/reporting presentation. No agent is implemented.

Technical onboarding can later offer “Set up your Brand Kit” using these structures. Before UI: implement authenticated transactional writers/ref-integrity checks, human approval/draft transitions with concurrency control, HVM membership resolution, asset upload/download policy, content validation, immutable asset references and generated API contracts. Keep provider connections separate.

## Built Matters example — not seeded

Organisation: Vamberic Studio Ltd. Brand: Built Matters. Product: Estate Performance Check. A future approved kit can reference existing logos, forest/mint palette, DM Sans, visual rules, tone/voice, approved descriptions, imagery and email defaults. Actual colours/assets/copy require approval; this task does not invent or seed them. Content Strategy, Content Creation, Web, Social, Campaign Orchestration, Email and Advertising consume that same kit.

## Migration and indexes

Dev schema v3 is already applied. This is the next additive migration, `004-brand-foundation`, **3 → 4**. Only `brands` and `brand_kits` are created, both empty with validators. Five indexes are added; no existing collection validator/index is changed. Existing Products and all other domain records are not rewritten. No seeds, apply, deploy, commit or push.

| Collection / index                               | Keys                               | Unique | Access pattern                                                             |
| ------------------------------------------------ | ---------------------------------- | ------ | -------------------------------------------------------------------------- |
| brands / id_unique                               | `{id:1}`                           | Yes    | Canonical Brand identity                                                   |
| brands / workspace_brand_slug_unique             | `{workspaceId:1,slug:1}`           | Yes    | Workspace list and unique slug lookup                                      |
| brands / workspace_organisation_brands           | `{workspaceId:1,organisationId:1}` | No     | Brands of an Organisation within authorized workspace                      |
| brand_kits / id_unique                           | `{id:1}`                           | Yes    | Canonical kit identity                                                     |
| brand_kits / workspace_brand_approved_kit_unique | `{workspaceId:1,brandId:1}`        | Yes    | One approved kit per workspace/Brand; partial filter `{status:"approved"}` |

The approved-kit index is partial on `{status:"approved"}`; all other indexes have no partial filter. None is sparse. Archived approved kits remain invalid, so archive state cannot bypass uniqueness. Total target: 29 domain collections and 89 application indexes, excluding Mongo `_id`. References to Organisations and reply-to ContactPoints are protected by existing CRM hard-delete blockers. No cascades are added.

The exact secure future apply invocation is the loader in [hvm-partners.md](hvm-partners.md#secure-later-apply-invocation--not-executed), whose child command is `pnpm --filter @workspace/api-server db:setup --apply`. It loads `vamberic/dev/api` through `vamberic-admin` in eu-west-2, passing credentials only to the child process. It now targets the current schema v4; run only after explicit approval. Substitute `--dry-run` for read-only verification. Do not run the bare apply command without the loader.

## Verified preflight and validation

Read-only secure dev preflight on 2026-09-27 succeeded against `vamberic_studio`: current schema 3, proposed schema 4, compatibility `upgrade-pending`. Exactly two collections, two validators and five indexes are proposed; validator conflicts, incompatible indexes, uniqueness risks and risk diagnostics are empty. Existing Product count remains two and all other current domain collections are empty. No Mongo writes were performed. New-collection DDL is proposed, not executed by dry-run.

Validation: 241 API tests, 20 client tests and 17 deployment tests passed; workspace typecheck/build, API lint/formatting, documentation formatting and diff checks passed. Root has no lint/test script, so canonical API lint and API/client/deployment suites were used. The existing Vapp bundle-size warning remains. No apply, deploy, commit or push was performed.

[HVM Phase 1](hvm-phase1-backend.md) now provides scoped draft/create/update/approve/retire APIs, optimistic timestamp checks and transactional replacement. Raw asset uploads/references remain deferred; approved source-kit references may be cloned within the same Brand.
