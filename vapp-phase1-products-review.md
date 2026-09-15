# Vapp Phase 1 — Products review

## What is included

Vapp is an internal Vamberic operations application built in the existing monorepo. Phase 1 provides:

- A branded, responsive application shell using the supplied Vamberic lion logo.
- A live operational dashboard backed by MongoDB collection counts.
- A complete Products workflow: search, status filter, create, view, and edit.
- Coming-soon destinations for People, Organisations, Opportunities, Campaigns, Subscriptions, Events, and Settings.
- Loading, empty, error, validation, and mutation feedback states.

Product deletion is intentionally not included.

## Review routes

| Route | Purpose |
| --- | --- |
| `/` | Dashboard summary |
| `/products` | Searchable and filterable product list |
| `/products/new` | Create a product |
| `/products/:id` | View and edit a product |
| `/people` | Coming soon |
| `/organisations` | Coming soon |
| `/opportunities` | Coming soon |
| `/campaigns` | Coming soon |
| `/subscriptions` | Coming soon |
| `/events` | Coming soon |
| `/settings` | Coming soon |

## Product fields

The interface uses the existing MongoDB Product domain model:

- Name and URL-safe slug
- Description
- Lifecycle status: idea, validation, active, paused, or retired
- Product type
- Domains
- Commercial model
- One-off purchase availability
- Subscription availability
- Three-letter currency
- Internal notes
- Server-owned ID, created timestamp, and updated timestamp

## API contract

The frontend consumes generated React Query hooks from the workspace OpenAPI contract. The API implements:

- `GET /api/v1/dashboard/summary`
- `GET /api/v1/products`
- `POST /api/v1/products`
- `GET /api/v1/products/{id}`
- `PATCH /api/v1/products/{id}`

The API validates requests and responses against generated schemas, validates stored records against the existing domain schema, creates prefixed platform IDs, owns timestamps, escapes product search input, and reports duplicate slugs as conflicts.

## Local review setup

1. Configure `MONGODB_URI` for the existing Vamberic MongoDB deployment. Do not paste credentials into source files.
2. Start the API Server and Vapp workflows.
3. Open the Vapp preview.
4. Create a product and confirm it appears in the Products list.
5. Edit its lifecycle status and confirm the product detail and dashboard counts update.
6. Test the product search and status filter.
7. Check the compact navigation at a narrow viewport.

If MongoDB is not configured or reachable, Vapp will show explicit API error states rather than substituting mock data.

## Verification completed

- OpenAPI client and Zod schema generation
- API server typecheck and lint
- API server test suite, including a full product lifecycle and dashboard summary
- Vapp TypeScript check
- Vapp production build
- Workflow log review and visual preview inspection