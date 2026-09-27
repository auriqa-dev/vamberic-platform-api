import { isPlatformId } from "../domain/ids";

export type Application = "vapp" | "hvmapp" | "system" | `product:${string}`;
export type Actor =
  | Readonly<{ type: "human"; id: string; issuer: string }>
  | Readonly<{ type: "agent" | "system"; id: string }>;
export const RESOURCES = [
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
export type Action = "read" | "create" | "update" | "delete" | "delete-preview";
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
  actor: Actor;
  application: Application;
  workspaceId: string;
  status: "active" | "inactive";
  role: "viewer" | "operator";
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
      !["read", "create", "update", "delete", "delete-preview"].includes(action)
    )
      return false;
    // Null/empty/malformed scopes are never treated as legacy internal records.
    if (
      resource.workspaceId !== undefined &&
      !isPlatformId(resource.workspaceId, "workspace")
    )
      return false;
    const { actor, application } = context;
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
          : m.role === "operator" &&
            ["read", "create", "update"].includes(action)),
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
