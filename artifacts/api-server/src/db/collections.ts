import { HIVE_IMPORT_INDEXES } from "./hive-import-indexes";
import { CANONICAL_SUPPORT_INDEX } from "./canonical-support-v18";
import { ACTION_LIBRARY_COLLECTIONS } from "./action-library-v17";
import type { z } from "zod";
import type {
  ActionTypeSchema,
  ActionDefinitionSchema,
  ActionDefinitionRevisionSchema,
  ReasoningDecisionV17Schema,
  ReasoningActionLinkV17Schema,
} from "../domain/action-library";
import { V16_BUDGET_COLLECTIONS } from "./agent-foundation-v16";
import type {
  CommercialTransactionV15,
  CommercialSubscriptionV15,
  CommercialRelationshipV15,
  RelationshipValueV15,
  ReasoningContextV15,
} from "../domain/commercial-outcomes-v15";
import { V15_INDEXES } from "./commercial-outcomes-v15";
import {
  V14_COLLECTION_DEFINITIONS,
  V14_EVENT_IDENTITY_INDEX,
} from "./identity-value-v14";
import type {
  EventV14,
  InteractionIdentity,
  IdentityResolution,
  ContactStrategyPolicyV14,
} from "../domain/identity-value-v14";
import { REASONING_COLLECTION_DEFINITIONS } from "./reasoning-foundation";
import type { ScopedLearning } from "../domain/reasoning-foundation";
import { EFFECTIVENESS_COLLECTION_DEFINITIONS } from "./agent-effectiveness-validators";
import type { EffectivenessCase } from "../domain/agent-effectiveness";
import { AGENT_COLLECTION_DEFINITIONS } from "./agent-control-plane-collections";
import type {
  AgentRun,
  AgentAttempt,
  AgentResult,
  AgentUsage,
} from "../domain/agent-control-plane";
import type { Document } from "mongodb";
import type { OfferDesign, Offer, OfferRevision } from "../domain/offers";
import type {
  Offering,
  IdealCustomerProfile,
  BuyerProfile,
  HiveRevision,
} from "../domain/hive-definitions";
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
  "action_types",
  "action_definitions",
  "action_definition_revisions",
  "execution_budget_policies",
  "execution_budget_windows",
  "execution_budget_reservations",
  "interaction_identities",
  "identity_resolutions",
  "relationship_value_assessments",
  "reasoning_contexts",
  "reasoning_decisions",
  "scoped_learning",
  "contact_strategy_policies",
  "agent_effectiveness_cases",
  "agent_runs",
  "agent_attempts",
  "agent_results",
  "agent_usage_observations",
  "agent_definitions",
  "integration_providers",
  "swarm_templates",
  "commercial_policies",
  "methodology_availability",
  "client_agents",
  "client_swarms",
  "pricing_recommendations",
  "swarm_agreements",

  "offer_designs",
  "offers",
  "offer_revisions",
  "offerings",
  "ideal_customer_profiles",
  "buyer_profiles",
  "hive_definition_revisions",
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
  execution_budget_policies: Document;
  execution_budget_windows: Document;
  execution_budget_reservations: Document;
  action_types: z.infer<typeof ActionTypeSchema>;
  action_definitions: z.infer<typeof ActionDefinitionSchema>;
  action_definition_revisions: z.infer<typeof ActionDefinitionRevisionSchema>;
  interaction_identities: InteractionIdentity;
  identity_resolutions: IdentityResolution;
  relationship_value_assessments: RelationshipValueV15;
  reasoning_contexts: ReasoningContextV15;
  reasoning_decisions: z.infer<typeof ReasoningDecisionV17Schema>;
  scoped_learning: ScopedLearning;
  contact_strategy_policies: ContactStrategyPolicyV14;
  agent_runs: AgentRun;
  agent_attempts: AgentAttempt;
  agent_results: AgentResult;
  agent_usage_observations: AgentUsage;
  agent_effectiveness_cases: EffectivenessCase;
  agent_definitions: Document;
  integration_providers: Document;
  swarm_templates: Document;
  commercial_policies: Document;
  methodology_availability: Document;
  client_agents: Document;
  client_swarms: Document;
  pricing_recommendations: Document;
  swarm_agreements: Document;

  offer_designs: OfferDesign;
  offers: Offer;
  offer_revisions: OfferRevision;
  offerings: Offering;
  ideal_customer_profiles: IdealCustomerProfile;
  buyer_profiles: BuyerProfile;
  hive_definition_revisions: HiveRevision;
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
  crm_tasks: CrmTask & {
    reasoning?: z.infer<typeof ReasoningActionLinkV17Schema>;
  };
  external_references: ExternalReference;
  products: Product;
  people: Person;
  contact_points: ContactPoint;
  organisations: Organisation;
  organisation_relationships: OrganisationRelationship;
  product_relationships: ProductRelationship | CommercialRelationshipV15;
  marketing_permissions: MarketingPermission;
  opportunities: Opportunity;
  subscriptions: Subscription | CommercialSubscriptionV15;
  entitlements: Entitlement;
  campaigns: Campaign;
  imports: ImportRecord;
  events: EventV14 & {
    commercialTransaction?: import("zod").z.infer<
      typeof import("../domain/commercial-outcomes-v15").TransactionReferenceV15
    >;
  };
  transactions: Transaction | CommercialTransactionV15;
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
  name:
    | DomainCollectionName
    | "client_onboardings"
    | "agent_capacity_observations"
    | "agent_execution_slots"
    | "agent_execution_invocations"
    | "agent_execution_controls";
  indexes: IndexDescription[];
  reason: string;
}

const appId = (name = "id"): IndexDescription => ({
  key: { [name]: 1 },
  name: `${name}_unique`,
  unique: true,
});

export const V14_SETUP_COLLECTIONS: readonly CollectionDefinition[] = [
  ...V14_COLLECTION_DEFINITIONS,
  ...REASONING_COLLECTION_DEFINITIONS,
  ...EFFECTIVENESS_COLLECTION_DEFINITIONS,
  ...AGENT_COLLECTION_DEFINITIONS.map((d): CollectionDefinition =>
    d.name === "agent_runs"
      ? {
          ...d,
          indexes: [
            ...d.indexes,
            {
              key: {
                "effectiveness.caseId": 1,
                "effectiveness.transitionKey": 1,
              },
              name: "effectiveness_transition_unique",
              unique: true,
              partialFilterExpression: {
                "effectiveness.caseId": { $exists: true },
              },
            },
            { key: { status: 1, id: 1 }, name: "active_status_id" },
          ],
        }
      : d,
  ),
  {
    name: "agent_definitions",
    indexes: [
      appId(),
      { key: { key: 1, version: 1 }, name: "key_version_unique", unique: true },
      {
        key: { status: 1, availability: 1, id: 1 },
        name: "available_catalogue",
      },
    ],
    reason: "Empress operating-layer agent definitions",
  },
  {
    name: "integration_providers",
    indexes: [
      appId(),
      { key: { key: 1, version: 1 }, name: "key_version_unique", unique: true },
      {
        key: { status: 1, availability: 1, id: 1 },
        name: "available_catalogue",
      },
    ],
    reason: "Empress operating-layer integration providers",
  },
  {
    name: "swarm_templates",
    indexes: [
      appId(),
      { key: { key: 1, version: 1 }, name: "key_version_unique", unique: true },
      {
        key: { status: 1, availability: 1, id: 1 },
        name: "available_catalogue",
      },
    ],
    reason: "Empress operating-layer swarm templates",
  },
  {
    name: "commercial_policies",
    indexes: [
      appId(),
      { key: { key: 1, version: 1 }, name: "key_version_unique", unique: true },
      {
        key: { status: 1, availability: 1, id: 1 },
        name: "available_catalogue",
      },
      {
        key: { "data.currency": 1 },
        name: "active_currency_unique",
        unique: true,
        partialFilterExpression: { status: "active" },
      },
    ],
    reason: "Empress operating-layer commercial policies",
  },
  {
    name: "methodology_availability",
    indexes: [
      appId(),
      { key: { key: 1, version: 1 }, name: "key_version_unique", unique: true },
      {
        key: { status: 1, availability: 1, id: 1 },
        name: "available_catalogue",
      },
    ],
    reason: "Empress operating-layer methodology availability",
  },
  {
    name: "client_agents",
    indexes: [
      appId(),
      { key: { workspaceId: 1, id: 1 }, name: "workspace_id" },
      {
        key: { workspaceId: 1, "data.definition.id": 1 },
        name: "workspace_definition",
      },
      {
        key: { workspaceId: 1, "data.bindings.integrationId": 1 },
        name: "workspace_integration",
      },
    ],
    reason: "Empress operating-layer client agents",
  },
  {
    name: "client_swarms",
    indexes: [
      appId(),
      { key: { workspaceId: 1, id: 1 }, name: "workspace_id" },
      {
        key: { workspaceId: 1, "data.agentInstanceIds": 1 },
        name: "workspace_agent",
      },
    ],
    reason: "Empress operating-layer client swarms",
  },
  {
    name: "pricing_recommendations",
    indexes: [
      appId(),
      { key: { workspaceId: 1, id: 1 }, name: "workspace_id" },
      {
        key: { workspaceId: 1, "data.swarmId": 1, id: 1 },
        name: "workspace_swarm",
      },
    ],
    reason: "Empress operating-layer pricing recommendations",
  },
  {
    name: "swarm_agreements",
    indexes: [
      appId(),
      { key: { workspaceId: 1, id: 1 }, name: "workspace_id" },
      {
        key: {
          workspaceId: 1,
          "data.swarmId": 1,
          status: 1,
          "data.decision.effectiveFrom": 1,
        },
        name: "workspace_swarm_effectivity",
      },
    ],
    reason: "Empress operating-layer swarm agreements",
  },
  {
    name: "offer_designs",
    indexes: [
      appId(),
      {
        key: { workspaceId: 1, offeringId: 1, id: 1 },
        name: "workspace_offering_designs",
      },
    ],
    reason: "Resumable workspace-owned Offer Design sessions.",
  },
  {
    name: "offers",
    indexes: [
      appId(),
      {
        key: { workspaceId: 1, offeringId: 1, id: 1 },
        name: "workspace_offering_offers",
      },
      {
        key: { workspaceId: 1, offerDesignId: 1 },
        name: "workspace_design_offers",
      },
    ],
    reason:
      "Canonical market-facing propositions separate from factual Offerings.",
  },
  {
    name: "offer_revisions",
    indexes: [
      appId(),
      {
        key: { workspaceId: 1, offerId: 1, revision: 1 },
        name: "offer_revision_unique",
        unique: true,
      },
    ],
    reason: "Immutable approved Offers and their completed design artifacts.",
  },
  {
    name: "offerings",
    indexes: [
      appId(),
      { key: { workspaceId: 1, id: 1 }, name: "workspaceId_id" },
      {
        key: { workspaceId: 1, brandId: 1, id: 1 },
        name: "workspaceId_brandId_id",
      },
      { key: { organisationId: 1 }, name: "organisationId" },
    ],
    reason: "Workspace-owned Hive definitions and scoped relationship access.",
  },
  {
    name: "ideal_customer_profiles",
    indexes: [
      appId(),
      {
        key: { workspaceId: 1, offeringId: 1, id: 1 },
        name: "workspaceId_offeringId_id",
      },
    ],
    reason: "Workspace-owned Hive definitions and scoped relationship access.",
  },
  {
    name: "buyer_profiles",
    indexes: [
      appId(),
      {
        key: { workspaceId: 1, offeringId: 1, id: 1 },
        name: "workspaceId_offeringId_id",
      },
      {
        key: { workspaceId: 1, idealCustomerProfileId: 1, id: 1 },
        name: "workspaceId_idealCustomerProfileId_id",
      },
    ],
    reason: "Workspace-owned Hive definitions and scoped relationship access.",
  },
  {
    name: "hive_definition_revisions",
    indexes: [
      appId(),
      {
        key: { workspaceId: 1, entityType: 1, entityId: 1, revision: 1 },
        name: "entity_revision_unique",
        unique: true,
      },
      { key: { "snapshot.organisationId": 1 }, name: "organisation_history" },
    ],
    reason:
      "Immutable approved revision identity and retained business references.",
  },
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
      ...HIVE_IMPORT_INDEXES.filter(
        (i) => i.collection === "organisations",
      ).map((i) => i.index),
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
      ...HIVE_IMPORT_INDEXES.filter((i) => i.collection === "imports").map(
        (i) => i.index,
      ),
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
      ...HIVE_IMPORT_INDEXES.filter((i) => i.collection === "events").map(
        (i) => i.index,
      ),
      V14_EVENT_IDENTITY_INDEX,
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
export const DATABASE_SCHEMA_VERSION = 19;
export const DATABASE_SCHEMA_VERSION_ID = "vapp-v1";
export const DATABASE_MIGRATION_ID = "001-vapp-v1-baseline";

export const CRM_FOUNDATION_MIGRATION_ID = "002-crm-foundation";

export const COMMERCIAL_FOUNDATION_MIGRATION_ID = "003-commercial-foundation";

export const BRAND_FOUNDATION_MIGRATION_ID = "004-brand-foundation";

export const HVM_PHASE1_MIGRATION_ID = "005-hvm-phase1";

export const HIVE_FOUNDATION_MIGRATION_ID = "006-hive-definitions";

export const HIVE_VALIDATOR_CORRECTION_MIGRATION_ID =
  "007-hive-validator-consistency";

export const OFFER_FOUNDATION_MIGRATION_ID = "008-offer-foundation";

export const OPERATING_FOUNDATION_MIGRATION_ID =
  "009-empress-operating-foundation";

export const AGENT_CONTROL_PLANE_MIGRATION_ID = "010-agent-control-plane";

export const EFFECTIVENESS_MIGRATION_ID = "011-agent-effectiveness";

export const PROTOCOL_V12_MIGRATION_ID = "012-answer-provenance-protocol";

export const V15_SETUP_COLLECTIONS: CollectionDefinition[] =
  V14_SETUP_COLLECTIONS.map((definition) => ({
    ...definition,
    indexes: [...definition.indexes, ...(V15_INDEXES[definition.name] ?? [])],
  }));

export const COLLECTION_DEFINITIONS: CollectionDefinition[] = [
  ...V15_SETUP_COLLECTIONS,
  ...V16_BUDGET_COLLECTIONS,
  ...ACTION_LIBRARY_COLLECTIONS,
].map((definition) =>
  definition.name === "events"
    ? {
        ...definition,
        indexes: [...definition.indexes, CANONICAL_SUPPORT_INDEX],
      }
    : definition,
);
