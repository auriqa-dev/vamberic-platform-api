import { PUBLIC_ENQUIRY_INDEXES } from "./enquiry-indexes";
import type { IndexDescription } from "mongodb";
import type { Collection, Db } from "mongodb";
import type {
  Campaign,
  ContactPoint,
  Entitlement,
  Event,
  ImportRecord,
  MarketingPermission,
  Opportunity,
  Organisation,
  OrganisationRelationship,
  Person,
  Product,
  ProductRelationship,
  Subscription,
  Transaction,
} from "../domain/schemas";

export const COLLECTION_NAMES = [
  "products",
  "people",
  "contact_points",
  "organisations",
  "organisation_relationships",
  "product_relationships",
  "marketing_permissions",
  "opportunities",
  "subscriptions",
  "entitlements",
  "campaigns",
  "imports",
  "events",
  "transactions",
] as const;

export type DomainCollectionName = (typeof COLLECTION_NAMES)[number];

/**
 * The persistence type associated with each Mongo collection. Keeping this
 * mapping explicit prevents a repository from accidentally returning a
 * collection with an unrelated document type.
 */
export interface DomainPersistenceByCollection {
  products: Product;
  people: Person;
  contact_points: ContactPoint;
  organisations: Organisation;
  organisation_relationships: OrganisationRelationship;
  product_relationships: ProductRelationship;
  marketing_permissions: MarketingPermission;
  opportunities: Opportunity;
  subscriptions: Subscription;
  entitlements: Entitlement;
  campaigns: Campaign;
  imports: ImportRecord;
  events: Event;
  transactions: Transaction;
}

export type DomainCollection<
  TName extends DomainCollectionName = DomainCollectionName,
> = Collection<DomainPersistenceByCollection[TName]>;

export type DomainCollections = {
  [TName in DomainCollectionName]: DomainCollection<TName>;
};

export function getDomainCollections(db: Db): DomainCollections {
  return Object.fromEntries(
    COLLECTION_NAMES.map((name) => [name, db.collection(name)]),
  ) as DomainCollections;
}

/** Short alias for repositories that already use the generic collections name. */
export const getCollections = getDomainCollections;

export interface CollectionDefinition {
  name: DomainCollectionName;
  indexes: IndexDescription[];
  reason: string;
}

const appId = (name = "id"): IndexDescription => ({
  key: { [name]: 1 },
  name: `${name}_unique`,
  unique: true,
});

export const COLLECTION_DEFINITIONS: readonly CollectionDefinition[] = [
  {
    name: "products",
    indexes: [appId(), { key: { slug: 1 }, name: "slug_unique", unique: true }],
    reason:
      "IDs and slugs are lookup/uniqueness boundaries; low-cardinality status is filtered after the product boundary.",
  },
  {
    name: "people",
    indexes: [appId()],
    reason:
      "People are canonical records; lifecycle is low-cardinality and filtered without an index or email identity.",
  },
  {
    name: "contact_points",
    indexes: [
      appId(),
      { key: { normalizedValue: 1 }, name: "normalized_value" },
      ...PUBLIC_ENQUIRY_INDEXES.filter(
        (item) => item.collection === "contact_points",
      ).map((item) => item.index),
      {
        key: { personId: 1, type: 1 },
        name: "person_type_primary_unique",
        unique: true,
        partialFilterExpression: { primary: true },
      },
      { key: { validity: 1, deliverability: 1 }, name: "contactability" },
    ],
    reason:
      "Normalized values find contacts while person/type supports contact management.",
  },
  {
    name: "organisations",
    indexes: [
      appId(),
      { key: { domain: 1 }, name: "domain" },
      ...PUBLIC_ENQUIRY_INDEXES.filter(
        (item) => item.collection === "organisations",
      ).map((item) => item.index),
      { key: { lifecycleStatus: 1 }, name: "lifecycle_status" },
    ],
    reason:
      "Domain and lifecycle support deduplication workflows and organisation filtering.",
  },
  {
    name: "organisation_relationships",
    indexes: [
      appId(),
      { key: { personId: 1, current: 1 }, name: "person_current" },
      { key: { organisationId: 1, current: 1 }, name: "organisation_current" },
    ],
    reason:
      "Both directions and current employment are common history queries.",
  },
  {
    name: "product_relationships",
    indexes: [
      appId(),
      { key: { productId: 1, personId: 1 }, name: "product_person" },
      {
        key: { productId: 1, organisationId: 1 },
        name: "product_organisation",
      },
      { key: { campaignId: 1 }, name: "campaign" },
    ],
    reason:
      "Product boundaries and campaign attribution are explicit; both customer target types are supported.",
  },
  {
    name: "marketing_permissions",
    indexes: [
      appId(),
      { key: { personId: 1, contactPointId: 1 }, name: "person_contact_point" },
      {
        key: { productId: 1, channel: 1, purpose: 1 },
        name: "scope_channel_purpose",
      },
      { key: { effectiveAt: -1 }, name: "effective_at" },
    ],
    reason:
      "Permission history is queried by subject, scope, channel, and effective state.",
  },
  {
    name: "opportunities",
    indexes: [
      appId(),
      { key: { productId: 1, status: 1, stage: 1 }, name: "product_pipeline" },
      { key: { organisationId: 1, status: 1 }, name: "organisation_status" },
      { key: { campaignId: 1 }, name: "campaign" },
    ],
    reason:
      "Pipeline views are product/stage scoped and organisations provide the B2B anchor.",
  },
  {
    name: "subscriptions",
    indexes: [
      appId(),
      { key: { productId: 1, status: 1 }, name: "product_status" },
      {
        key: { provider: 1, externalSubscriptionId: 1 },
        name: "provider_external_subscription",
        unique: true,
        sparse: true,
      },
      { key: { personId: 1, organisationId: 1 }, name: "customer" },
    ],
    reason:
      "Provider IDs prevent duplicate recurring records while product/customer supports access queries.",
  },
  {
    name: "entitlements",
    indexes: [
      appId(),
      {
        key: { productId: 1, status: 1, activeUntil: 1 },
        name: "product_access_window",
      },
      {
        key: { personId: 1, organisationId: 1, status: 1 },
        name: "customer_status",
      },
      { key: { sourceSubscriptionId: 1 }, name: "source_subscription" },
      { key: { sourceTransactionId: 1 }, name: "source_transaction" },
    ],
    reason:
      "Access checks need product/customer/status and source references support durable one-off access.",
  },
  {
    name: "campaigns",
    indexes: [
      appId(),
      { key: { productId: 1, status: 1 }, name: "product_status" },
      {
        key: { provider: 1, externalReference: 1 },
        name: "provider_external_reference",
        sparse: true,
      },
    ],
    reason:
      "Campaigns are product-scoped and external references support attribution reconciliation.",
  },
  {
    name: "imports",
    indexes: [
      appId(),
      { key: { provider: 1, importedAt: -1 }, name: "provider_imported_at" },
      { key: { campaignId: 1 }, name: "campaign" },
    ],
    reason:
      "Import operations are audited by provider/time and status; source files stay outside Mongo.",
  },
  {
    name: "events",
    indexes: [
      appId(),
      { key: { occurredAt: -1 }, name: "occurred_at" },
      { key: { eventType: 1, occurredAt: -1 }, name: "type_occurred_at" },
      { key: { productId: 1, occurredAt: -1 }, name: "product_occurred_at" },
      { key: { personId: 1, occurredAt: -1 }, name: "person_occurred_at" },
      {
        key: { organisationId: 1, occurredAt: -1 },
        name: "organisation_occurred_at",
      },
      { key: { campaignId: 1, occurredAt: -1 }, name: "campaign_occurred_at" },
    ],
    reason:
      "Append-oriented activity is time-first, with event type and product/entity slices.",
  },
  {
    name: "transactions",
    indexes: [
      appId(),
      {
        key: { provider: 1, externalTransactionId: 1 },
        name: "provider_external_transaction",
        unique: true,
        sparse: true,
      },
      {
        key: { productId: 1, transactedAt: -1 },
        name: "product_transacted_at",
      },
      { key: { status: 1, transactedAt: -1 }, name: "status_transacted_at" },
      { key: { campaignId: 1 }, name: "campaign" },
    ],
    reason:
      "External transaction IDs are reconciliation keys; product/time and status/time support revenue reporting.",
  },
];

export const SCHEMA_VERSIONS_COLLECTION = "schema_versions";
export const DATABASE_SCHEMA_VERSION = 1;
export const DATABASE_SCHEMA_VERSION_ID = "vapp-v1";
export const DATABASE_MIGRATION_ID = "001-vapp-v1-baseline";
