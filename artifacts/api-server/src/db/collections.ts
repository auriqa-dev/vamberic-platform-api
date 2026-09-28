import type { ClientWorkspaceMembership } from "../domain/workspace-memberships";
import type { Brand, BrandKit } from "../domain/brands";
import type {
  HvmPartner,
  HvmPartnerMembership,
  WorkspacePartnerAssignment,
} from "../domain/partners";
import type { WorkspaceIntegration } from "../domain/workspace-integrations";
import type {
  Capability,
  CapabilityInstance,
  CommercialPackage,
  CommercialCharge,
} from "../domain/commercial-records";
import type {
  CrmPipeline,
  CrmWorkspace,
  CrmLead,
  CrmTask,
  ExternalReference,
} from "../domain/crm-records";
import {
  PUBLIC_ENQUIRY_INDEXES,
  WORKSPACE_ENQUIRY_INDEXES,
} from "./enquiry-indexes";
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
  "workspace_memberships",
  "brands",
  "brand_kits",
  "hvm_partner_memberships",
  "workspace_integrations",
  "hvm_partners",
  "workspace_partner_assignments",
  "capabilities",
  "capability_instances",
  "commercial_packages",
  "commercial_charges",
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
  "crm_pipelines",
  "crm_workspaces",
  "crm_leads",
  "crm_tasks",
  "external_references",
] as const;

export type DomainCollectionName = (typeof COLLECTION_NAMES)[number];

/**
 * The persistence type associated with each Mongo collection. Keeping this
 * mapping explicit prevents a repository from accidentally returning a
 * collection with an unrelated document type.
 */
export interface DomainPersistenceByCollection {
  workspace_memberships: ClientWorkspaceMembership;
  brands: Brand;
  brand_kits: BrandKit;
  hvm_partners: HvmPartner;
  hvm_partner_memberships: HvmPartnerMembership;
  workspace_integrations: WorkspaceIntegration;
  workspace_partner_assignments: WorkspacePartnerAssignment;
  capabilities: Capability;
  capability_instances: CapabilityInstance;
  commercial_packages: CommercialPackage;
  commercial_charges: CommercialCharge;
  crm_pipelines: CrmPipeline;
  crm_workspaces: CrmWorkspace;
  crm_leads: CrmLead;
  crm_tasks: CrmTask;
  external_references: ExternalReference;
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
    name: "workspace_memberships",
    indexes: [
      appId(),
      {
        key: { "human.issuer": 1, "human.id": 1, status: 1 },
        name: "human_status_workspaces",
      },
      { key: { workspaceId: 1, status: 1 }, name: "workspace_status_members" },
      {
        key: { workspaceId: 1, "human.issuer": 1, "human.id": 1 },
        name: "workspace_human_active_unique",
        unique: true,
        partialFilterExpression: { status: "active" },
      },
    ],
    reason:
      "Resolve verified client access, list team and enforce one active membership per human/workspace.",
  },
  {
    name: "brands",
    indexes: [
      appId(),
      {
        key: { workspaceId: 1, slug: 1 },
        name: "workspace_brand_slug_unique",
        unique: true,
      },
      {
        key: { workspaceId: 1, organisationId: 1 },
        name: "workspace_organisation_brands",
      },
    ],
    reason:
      "Workspace brand listing/slug uniqueness and brands for an Organisation within an authorized workspace.",
  },
  {
    name: "brand_kits",
    indexes: [
      appId(),
      {
        key: { workspaceId: 1, brandId: 1 },
        name: "workspace_brand_approved_kit_unique",
        unique: true,
        partialFilterExpression: { status: "approved" },
      },
    ],
    reason:
      "One current approved kit per workspace Brand; drafts and retired history may coexist.",
  },
  {
    name: "hvm_partner_memberships",
    indexes: [
      appId(),
      { key: { partnerId: 1, status: 1 }, name: "partner_status_members" },
      {
        key: { "human.issuer": 1, "human.id": 1, status: 1 },
        name: "human_status_partners",
      },
      {
        key: { partnerId: 1, "human.issuer": 1, "human.id": 1 },
        name: "partner_human_active_unique",
        unique: true,
        partialFilterExpression: { status: "active" },
      },
    ],
    reason:
      "Partner roster, issuer-scoped human memberships and race-safe active pair uniqueness; ended history remains.",
  },
  {
    name: "workspace_integrations",
    indexes: [
      appId(),
      {
        key: { workspaceId: 1, status: 1 },
        name: "workspace_status_integrations",
      },
      {
        key: { workspaceId: 1, provider: 1 },
        name: "workspace_provider_integrations",
      },
    ],
    reason:
      "Workspace operational connection list and provider lookup; multiple accounts/connections allowed with canonical IDs.",
  },
  {
    name: "hvm_partners",
    indexes: [appId()],
    reason:
      "Partner registry identity; no speculative status/list indexes before a consumer.",
  },
  {
    name: "workspace_partner_assignments",
    indexes: [
      appId(),
      {
        key: { partnerId: 1, status: 1, workspaceId: 1 },
        name: "partner_status_workspaces",
      },
      {
        key: { workspaceId: 1, status: 1, role: 1 },
        name: "workspace_status_roles",
      },
      {
        key: { workspaceId: 1 },
        name: "workspace_active_primary_unique",
        unique: true,
        partialFilterExpression: { status: "active", role: "primary" },
      },
      {
        key: { workspaceId: 1, partnerId: 1 },
        name: "workspace_partner_active_unique",
        unique: true,
        partialFilterExpression: { status: "active" },
      },
    ],
    reason:
      "Partner workspace roster, workspace primary/supporting roster and race-safe active relationship uniqueness; ended history remains.",
  },
  {
    name: "capabilities",
    indexes: [appId()],
    reason: "Reusable capability catalogue by canonical identity.",
  },
  {
    name: "capability_instances",
    indexes: [
      appId(),
      {
        key: {
          workspaceId: 1,
          scopeType: 1,
          scopeProductId: 1,
          capabilityId: 1,
        },
        name: "workspace_scope_capability",
      },
    ],
    reason:
      "List configured capabilities for one workspace/Product; bindings use canonical IDs.",
  },
  {
    name: "commercial_packages",
    indexes: [
      appId(),
      {
        key: { workspaceId: 1, scopeType: 1, scopeProductId: 1 },
        name: "workspace_scope_packages",
      },
    ],
    reason: "List packages for a workspace or Product context.",
  },
  {
    name: "commercial_charges",
    indexes: [
      appId(),
      {
        key: {
          workspaceId: 1,
          capabilityInstanceId: 1,
          status: 1,
          chargeType: 1,
        },
        name: "workspace_instance_charges",
      },
      {
        key: {
          workspaceId: 1,
          commercialPackageId: 1,
          status: 1,
          chargeType: 1,
        },
        name: "workspace_package_charges",
      },
    ],
    reason:
      "Find one-off/active recurring components for an instance or package without reading payment state.",
  },

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
      ...[...PUBLIC_ENQUIRY_INDEXES, ...WORKSPACE_ENQUIRY_INDEXES]
        .filter((item) => item.collection === "contact_points")
        .map((item) => item.index),
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
      ...[...PUBLIC_ENQUIRY_INDEXES, ...WORKSPACE_ENQUIRY_INDEXES]
        .filter((item) => item.collection === "organisations")
        .map((item) => item.index),
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
        key: {
          workspaceId: 1,
          capabilityInstanceId: 1,
          status: 1,
          activeUntil: 1,
        },
        name: "workspace_instance_access_window",
      },
      {
        key: { workspaceId: 1, capabilityId: 1, status: 1, activeUntil: 1 },
        name: "workspace_capability_access_window",
      },
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
  {
    name: "crm_pipelines",
    indexes: [appId()],
    reason: "Product pipeline selection including archive state.",
  },
  {
    name: "crm_workspaces",
    indexes: [appId()],
    reason: "Ownership root lookup; no implied access grants.",
  },
  {
    name: "crm_leads",
    indexes: [appId()],
    reason:
      "Workspace qualification identity; queue indexes deferred until consumers exist.",
  },
  {
    name: "crm_tasks",
    indexes: [appId()],
    reason:
      "Product owner queues and opportunity follow-up, overdue derived at read time.",
  },
  {
    name: "external_references",
    indexes: [
      appId(),
      {
        key: {
          workspaceId: 1,
          provider: 1,
          providerAccountId: 1,
          objectType: 1,
          externalId: 1,
        },
        name: "workspace_provider_account_object_external_unique",
        unique: true,
      },
      { key: { entityType: 1, entityId: 1 }, name: "entity_references" },
    ],
    reason:
      "Account-scoped external identity dedupe and reverse mapping lookup.",
  },
];

export const SCHEMA_VERSIONS_COLLECTION = "schema_versions";
export const DATABASE_SCHEMA_VERSION = 5;
export const DATABASE_SCHEMA_VERSION_ID = "vapp-v1";
export const DATABASE_MIGRATION_ID = "001-vapp-v1-baseline";

export const CRM_FOUNDATION_MIGRATION_ID = "002-crm-foundation";

export const COMMERCIAL_FOUNDATION_MIGRATION_ID = "003-commercial-foundation";

export const BRAND_FOUNDATION_MIGRATION_ID = "004-brand-foundation";

export const HVM_PHASE1_MIGRATION_ID = "005-hvm-phase1";
