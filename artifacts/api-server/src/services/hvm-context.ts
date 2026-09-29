import type { Db, ClientSession, Document } from "mongodb";
import {
  CrmWorkspaceSchema,
  HvmPartnerSchema,
  HvmPartnerMembershipSchema,
  WorkspacePartnerAssignmentSchema,
  WorkspaceMembershipSchema,
} from "../domain";
import {
  createAuthorizationAuthority,
  type WorkspaceMembership,
} from "../authorization/policy";
import type { AppConfig } from "../config";
import type { AuthenticatedUser } from "../middlewares/auth";
export function humanClients(config: AppConfig) {
  return [
    {
      issuer: config.cognito.issuer,
      clientId: config.cognito.clientId,
      application: "vapp" as const,
    },
    ...(config.cognito.hvmClientId
      ? [
          {
            issuer: config.cognito.issuer,
            clientId: config.cognito.hvmClientId,
            application: "hvmapp" as const,
          },
        ]
      : []),
  ];
}
export function withoutMongoId(row: Document) {
  const { _id, ...rest } = row;
  void _id;
  return rest;
}
/** Fresh server reads on every request/write transaction; never token claims or cached rosters. */
export async function resolveHvmContext(
  db: Db,
  config: AppConfig,
  identity: AuthenticatedUser,
  session?: ClientSession,
) {
  if (
    !config.cognito.hvmClientId ||
    identity.clientId !== config.cognito.hvmClientId ||
    identity.issuer !== config.cognito.issuer
  )
    throw new Error("HVM identity required");
  const ledger = await db
    .collection("schema_versions")
    .findOne({ _id: "vapp-v1" } as Document, { session });
  if (![5, 6].includes(ledger?.version))
    throw new Error("HVM requires reviewed/applied schema v5 or v6");
  const human = {
    type: "human",
    id: identity.subject,
    issuer: identity.issuer,
  } as const;
  const options = { session };
  const active = { status: "active", archived: { $ne: true } };
  const identityFilter = {
    "human.type": "human",
    "human.id": human.id,
    "human.issuer": human.issuer,
    ...active,
  };
  const partnerContexts: {
    id: string;
    displayName: string;
    role: string;
    workspaceIds: string[];
  }[] = [];
  const clientContexts: { workspaceId: string; role: "admin" | "member" }[] =
    [];
  const grants: WorkspaceMembership[] = [];
  const workspaces = new Map<string, { id: string; name: string }>();
  async function workspace(id: string) {
    const row = await db
      .collection("crm_workspaces")
      .findOne({ id, kind: "client", archived: { $ne: true } }, options);
    if (!row) return undefined;
    const parsed = CrmWorkspaceSchema.safeParse(withoutMongoId(row));
    if (!parsed.success) return undefined;
    workspaces.set(id, { id, name: parsed.data.name });
    return parsed.data;
  }
  const partnerRows = await db
    .collection("hvm_partner_memberships")
    .find(identityFilter, options)
    .limit(201)
    .toArray();
  const clientRows = await db
    .collection("workspace_memberships")
    .find(identityFilter, options)
    .limit(201)
    .toArray();
  if (partnerRows.length > 200 || clientRows.length > 200)
    throw new Error("Membership scope exceeds bound");
  for (const row of partnerRows) {
    const membership = HvmPartnerMembershipSchema.safeParse(
      withoutMongoId(row),
    );
    if (!membership.success) continue;
    const record = await db
      .collection("hvm_partners")
      .findOne({ id: membership.data.partnerId, ...active }, options);
    const partner =
      record && HvmPartnerSchema.safeParse(withoutMongoId(record));
    if (!partner || !partner.success) continue;
    const assignments = await db
      .collection("workspace_partner_assignments")
      .find({ partnerId: partner.data.id, ...active }, options)
      .limit(201)
      .toArray();
    if (assignments.length > 200)
      throw new Error("Assignment scope exceeds bound");
    const workspaceIds: string[] = [];
    for (const assignment of assignments) {
      const parsed = WorkspacePartnerAssignmentSchema.safeParse(
        withoutMongoId(assignment),
      );
      if (!parsed.success || !(await workspace(parsed.data.workspaceId)))
        continue;
      workspaceIds.push(parsed.data.workspaceId);
      grants.push({
        actor: human,
        application: "hvmapp",
        workspaceId: parsed.data.workspaceId,
        role: membership.data.role === "owner" ? "admin" : "onboarder",
        status: "active",
      });
    }
    partnerContexts.push({
      id: partner.data.id,
      displayName: partner.data.displayName,
      role: membership.data.role,
      workspaceIds,
    });
  }
  for (const row of clientRows) {
    const parsed = WorkspaceMembershipSchema.safeParse(withoutMongoId(row));
    if (!parsed.success || !(await workspace(parsed.data.workspaceId)))
      continue;
    clientContexts.push({
      workspaceId: parsed.data.workspaceId,
      role: parsed.data.role,
    });
    grants.push({
      actor: human,
      application: "hvmapp",
      workspaceId: parsed.data.workspaceId,
      status: "active",
      role: parsed.data.role === "admin" ? "admin" : "viewer",
    });
  }
  const authority = createAuthorizationAuthority({
    humanClients: humanClients(config),
    memberships: grants,
  });
  const context = authority.authenticatedHuman(identity);
  return {
    authority,
    context,
    response: {
      application: "hvmapp",
      human,
      partners: partnerContexts,
      clients: clientContexts,
      workspaces: [...workspaces.values()].map((w) => ({
        ...w,
        role: grants.some((g) => g.workspaceId === w.id && g.role === "admin")
          ? "admin"
          : grants.some((g) => g.workspaceId === w.id && g.role === "onboarder")
            ? "onboarder"
            : "viewer",
      })),
    },
  };
}
