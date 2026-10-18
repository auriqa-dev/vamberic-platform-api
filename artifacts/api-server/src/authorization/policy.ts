import {
  grantPermits,
  type AgentOperationGrant,
  type AgentTarget,
} from "../domain/agent-operator";
import { isPlatformId } from "../domain/ids";

export type Application = "vapp" | "hvmapp" | "system" | `product:${string}`;
export type Actor =
  | Readonly<{ type: "human"; id: string; issuer: string }>
  | Readonly<{ type: "agent" | "system"; id: string }>;
export const RESOURCES = [
  "content_strategy",
  "action_types",
  "action_definitions",
  "contact_strategy_policies",
  "agent_operator_assignments",
  "agent_runs",
  "agent_definitions",
  "integration_providers",
  "swarm_templates",
  "commercial_policies",
  "methodology_availability",
  "client_agents",
  "client_swarms",
  "pricing_recommendations",
  "swarm_agreements",
  "agreement_approvals",

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
  "hvm_partners",
  "hvm_partner_memberships",
  "workspace_integrations",
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
  "opportunities",
  "events",
  "crm_tasks",
  "campaigns",
  "crm_leads",
  "marketing_permissions",
  "entitlements",
  "subscriptions",
  "external_references",
  "crm_pipelines",
  "crm_workspaces",
  "transactions",
  "import_batches",
] as const;
export type ResourceType = (typeof RESOURCES)[number];

/** Scope validity precedes every human/workload grant. Legacy dual-scope
 * resources retain their existing Vapp-internal/HVM-workspace semantics.
 */
export const RESOURCE_SCOPES = {
  content_strategy: "workspace",
  action_types: "global",
  action_definitions: "workspace",
  contact_strategy_policies: "workspace",
  agent_operator_assignments: "workspace",
  agent_runs: "workspace",
  agent_definitions: "global",
  integration_providers: "global",
  swarm_templates: "global",
  commercial_policies: "global",
  methodology_availability: "global",
  client_agents: "workspace",
  client_swarms: "workspace",
  pricing_recommendations: "workspace",
  swarm_agreements: "workspace",
  agreement_approvals: "global",
  offer_designs: "legacy_internal_or_workspace",
  offers: "legacy_internal_or_workspace",
  offer_revisions: "legacy_internal_or_workspace",
  offerings: "legacy_internal_or_workspace",
  ideal_customer_profiles: "legacy_internal_or_workspace",
  buyer_profiles: "legacy_internal_or_workspace",
  hive_definition_revisions: "legacy_internal_or_workspace",
  workspace_memberships: "legacy_internal_or_workspace",
  brands: "legacy_internal_or_workspace",
  brand_kits: "legacy_internal_or_workspace",
  hvm_partners: "legacy_internal_or_workspace",
  hvm_partner_memberships: "legacy_internal_or_workspace",
  workspace_integrations: "legacy_internal_or_workspace",
  workspace_partner_assignments: "legacy_internal_or_workspace",
  capabilities: "legacy_internal_or_workspace",
  capability_instances: "legacy_internal_or_workspace",
  commercial_packages: "legacy_internal_or_workspace",
  commercial_charges: "legacy_internal_or_workspace",
  products: "legacy_internal_or_workspace",
  people: "legacy_internal_or_workspace",
  contact_points: "legacy_internal_or_workspace",
  organisations: "legacy_internal_or_workspace",
  organisation_relationships: "legacy_internal_or_workspace",
  product_relationships: "legacy_internal_or_workspace",
  opportunities: "legacy_internal_or_workspace",
  events: "legacy_internal_or_workspace",
  crm_tasks: "legacy_internal_or_workspace",
  campaigns: "legacy_internal_or_workspace",
  crm_leads: "legacy_internal_or_workspace",
  marketing_permissions: "legacy_internal_or_workspace",
  entitlements: "legacy_internal_or_workspace",
  subscriptions: "legacy_internal_or_workspace",
  external_references: "legacy_internal_or_workspace",
  crm_pipelines: "legacy_internal_or_workspace",
  crm_workspaces: "legacy_internal_or_workspace",
  transactions: "legacy_internal_or_workspace",
  import_batches: "legacy_internal_or_workspace",
} as const satisfies Record<
  ResourceType,
  "global" | "workspace" | "legacy_internal_or_workspace"
>;

export type Action =
  | "read"
  | "create"
  | "update"
  | "delete"
  | "delete-preview"
  | "approve"
  | "manage";
export interface Resource {
  type: ResourceType;
  id?: string;
  workspaceId?: string;
}
export interface AuthorizationContext {
  readonly actor: Actor;
  readonly application: Application;
}
/** Server-resolved membership contract, not a browser claim or persistence schema. */
export interface WorkspaceMembership {
  basis?: "partner" | "client";
  actor: Actor;
  application: Application;
  workspaceId: string;
  status: "active" | "inactive";
  role: "viewer" | "operator" | "admin" | "onboarder";
}
export interface ServiceGrant {
  application: Application;
  actor: Exclude<Actor, { type: "human" }>;
  resource: ResourceType;
  action: Action;
  scope: { kind: "internal" } | { kind: "workspace"; workspaceId: string };
}
export const INTERNAL_SCOPE = Object.freeze({
  workspaceId: Object.freeze({ $exists: false as const }),
});
export class AuthorizationDenied extends Error {
  constructor() {
    super("Resource not found");
  }
}
function sameActor(a: Actor, b: Actor): boolean {
  return (
    a.type === b.type &&
    a.id === b.id &&
    (a.type !== "human" || (b.type === "human" && a.issuer === b.issuer))
  );
}
/** Construct only at a trusted composition root. No HTTP input belongs in this config.
 * Future membership adapters must resolve current grants server-side per request.
 */
export function createAuthorizationAuthority(config: {
  humanClients: readonly {
    issuer: string;
    clientId: string;
    application: Application;
  }[];
  memberships?: readonly WorkspaceMembership[];
  serviceGrants?: readonly ServiceGrant[];
  operatorGrants?: readonly {
    actor: Extract<Actor, { type: "human" }>;
    workspaceId: string;
    membershipId: string;
    grant: AgentOperationGrant;
  }[];
  empressHumans?: readonly { issuer: string; id: string }[];
}) {
  // Snapshot configuration: later mutation of a caller-owned object cannot grant access.
  const trusted = structuredClone(config);
  const issued = new WeakSet<AuthorizationContext>();
  function issue(actor: Actor, application: Application): AuthorizationContext {
    const context = Object.freeze({
      actor: Object.freeze({ ...actor }),
      application,
    });
    issued.add(context);
    return context;
  }
  function authorize(
    context: AuthorizationContext | undefined,
    action: Action,
    resource: Resource,
  ): boolean {
    if (
      !context ||
      !issued.has(context) ||
      !RESOURCES.includes(resource.type) ||
      ![
        "read",
        "create",
        "update",
        "delete",
        "delete-preview",
        "approve",
        "manage",
      ].includes(action)
    )
      return false;
    // Null/empty/malformed scopes are never treated as legacy internal records.
    if (
      resource.workspaceId !== undefined &&
      !isPlatformId(resource.workspaceId, "workspace")
    )
      return false;
    const scope = RESOURCE_SCOPES[resource.type];
    if (
      (scope === "global" && resource.workspaceId !== undefined) ||
      (scope === "workspace" && resource.workspaceId === undefined)
    )
      return false;
    const { actor, application } = context;
    // This projection is human-only and supports only review and approval.
    if (
      resource.type === "agreement_approvals" &&
      (actor.type !== "human" || !["read", "approve"].includes(action))
    )
      return false;
    if (
      ["agent_operator_assignments", "agent_runs"].includes(resource.type) &&
      actor.type !== "human"
    )
      return false;
    if (actor.type !== "human") {
      return (trusted.serviceGrants ?? []).some(
        (g) =>
          sameActor(g.actor, actor) &&
          g.application === application &&
          g.resource === resource.type &&
          g.action === action &&
          (g.scope.kind === "internal"
            ? resource.workspaceId === undefined
            : isPlatformId(g.scope.workspaceId, "workspace") &&
              g.scope.workspaceId === resource.workspaceId),
      );
    }
    if (scope !== "legacy_internal_or_workspace") {
      if (application !== "hvmapp" || actor.type !== "human") return false;
      const empress = (trusted.empressHumans ?? []).some(
        (h) => h.id === actor.id && h.issuer === actor.issuer,
      );
      if (scope === "global") return empress;
      // Direct client administrators operate their own workspace as its Queen.
      // Global Empress authority remains separately checked above.
      return (trusted.memberships ?? []).some(
        (m) =>
          (m.basis === "partner" ||
            (m.basis === "client" && m.role === "admin")) &&
          m.application === application &&
          m.status === "active" &&
          m.workspaceId === resource.workspaceId &&
          sameActor(m.actor, actor) &&
          ["admin", "onboarder"].includes(m.role) &&
          (resource.type === "agent_operator_assignments"
            ? ["read", "manage"].includes(action)
            : resource.type === "agent_runs"
              ? ["read", "create", "update"].includes(action)
              : ["read", "create", "update", "approve"].includes(action)),
      );
    }
    if (application === "vapp") return resource.workspaceId === undefined;
    // Future customer apps default deny. HVM internal access and sharing are not implemented.
    if (application !== "hvmapp" || !resource.workspaceId) return false;
    return (trusted.memberships ?? []).some(
      (m) =>
        m.status === "active" &&
        m.application === application &&
        sameActor(m.actor, actor) &&
        m.workspaceId === resource.workspaceId &&
        (m.role === "viewer"
          ? action === "read"
          : m.role === "admin"
            ? action === "read" ||
              (["offerings", "campaigns"].includes(resource.type) && action === "delete") ||
              ([
                "campaigns",
                "offer_designs",
                "offers",
                "offerings",
                "ideal_customer_profiles",
                "people",
                "organisations",
                "buyer_profiles",
                "brands",
                "brand_kits",
                "workspace_integrations",
                "crm_workspaces",
              ].includes(resource.type) &&
                ["create", "update", "approve"].includes(action)) ||
              (resource.type === "workspace_memberships" && action === "manage")
            : m.role === "operator"
              ? ["read", "create", "update"].includes(action)
              : m.role === "onboarder" &&
                ["read", "create", "update"].includes(action) &&
                (action === "read" ||
                  [
                    "campaigns",
                "offer_designs",
                    "offers",
                    "offerings",
                    "ideal_customer_profiles",
                    "people",
                    "organisations",
                    "buyer_profiles",
                    "brands",
                    "brand_kits",
                    "workspace_integrations",
                    "crm_workspaces",
                  ].includes(resource.type))),
    );
  }
  return {
    /** Input must be the result of successful token verification, never decoded claims alone. */
    authenticatedHuman(identity: {
      issuer: string;
      clientId: string;
      subject: string;
    }) {
      const binding = trusted.humanClients.find(
        (c) => c.issuer === identity.issuer && c.clientId === identity.clientId,
      );
      if (!binding || !identity.subject.trim()) throw new AuthorizationDenied();
      return issue(
        { type: "human", id: identity.subject, issuer: identity.issuer },
        binding.application,
      );
    },
    /** Server-only entry point. The caller must first authenticate the workload. */
    service(
      actor: Exclude<Actor, { type: "human" }>,
      application: Application,
    ) {
      if (
        !(trusted.serviceGrants ?? []).some(
          (g) => sameActor(g.actor, actor) && g.application === application,
        )
      )
        throw new AuthorizationDenied();
      return issue(actor, application);
    },
    authorizeAgentOperation(
      context: AuthorizationContext,
      request: {
        workspaceId: string;
        target: AgentTarget;
        operation: string;
        action: "request" | "read" | "respond" | "cancel";
        requester?: Actor;
        membershipId?: string;
        grantId?: string;
      },
      now: Date,
    ) {
      if (
        request.target.kind === "workspace_agent" &&
        request.target.workspaceId !== request.workspaceId
      )
        return undefined;
      if (
        !issued.has(context) ||
        context.application !== "hvmapp" ||
        context.actor.type !== "human"
      )
        return undefined;
      if (
        authorize(
          context,
          request.action === "request"
            ? "create"
            : request.action === "read"
              ? "read"
              : "update",
          { type: "agent_runs", workspaceId: request.workspaceId },
        )
      )
        return { basis: "partner" as const };
      if (
        request.action !== "request" &&
        (!request.requester ||
          !sameActor(context.actor, request.requester) ||
          !request.membershipId ||
          !request.grantId)
      )
        return undefined;
      const found = (trusted.operatorGrants ?? []).find(
        (g) =>
          sameActor(g.actor, context.actor) &&
          g.workspaceId === request.workspaceId &&
          (!request.membershipId || request.membershipId === g.membershipId) &&
          (!request.grantId || request.grantId === g.grant.id) &&
          grantPermits(g.grant, request.target, request.operation, now),
      );
      return found
        ? {
            basis: "client" as const,
            membershipId: found.membershipId,
            grantId: found.grant.id,
          }
        : undefined;
    },
    authorize,
    scopeFilter(
      context: AuthorizationContext | undefined,
      action: Action,
      resource: Resource,
    ) {
      if (!authorize(context, action, resource))
        throw new AuthorizationDenied();
      return resource.workspaceId === undefined
        ? INTERNAL_SCOPE
        : { workspaceId: resource.workspaceId };
    },
  };
}
export type AuthorizationAuthority = ReturnType<
  typeof createAuthorizationAuthority
>;
