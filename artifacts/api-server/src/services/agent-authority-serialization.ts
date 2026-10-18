import { WorkspaceMembershipSchema } from "../domain/workspace-memberships";
import {
  HvmPartnerMembershipSchema,
  HvmPartnerSchema,
  WorkspacePartnerAssignmentSchema,
} from "../domain/partners";
import { withoutMongoId } from "./hvm-context";
import type { ClientSession, Db, Document } from "mongodb";
import { ExecutionSerialSchema } from "../domain/execution-serialization";
import { AuthorizationDenied } from "../authorization/policy";
import type { AgentRun } from "../domain/agent-control-plane";

export class AgentAuthorityConflict extends Error {}
export const AUTHORITY_ANCHORS = [
  "crm_workspaces",
  "workspace_memberships",
  "hvm_partners",
  "hvm_partner_memberships",
  "workspace_partner_assignments",
  "workspace_integrations",
  "capability_instances",
  "client_agents",
  "client_swarms",
  "agent_definitions",
  "integration_providers",
] as const;
export type AuthorityAnchor = {
  collection: (typeof AUTHORITY_ANCHORS)[number];
  id: string;
};
const operating = new Set([
  "client_agents",
  "client_swarms",
  "agent_definitions",
  "integration_providers",
]);

/** A real document write is essential: a snapshot reread or no-op is not a lock.
 * Mongo retries a conflicting transaction from a new snapshot; callers must not
 * swallow that conflict as an ordinary authorization denial. */
export async function lockAuthorityDocument(
  db: Db,
  anchor: AuthorityAnchor,
  session: ClientSession,
) {
  if (!AUTHORITY_ANCHORS.includes(anchor.collection))
    throw new AuthorizationDenied();
  const collection = db.collection(anchor.collection);
  const row = await collection.findOne({ id: anchor.id }, { session });
  if (!row) throw new AuthorizationDenied();
  const field = operating.has(anchor.collection)
    ? "referenceVersion"
    : "executionSerial";
  const previous = ExecutionSerialSchema.parse(row[field] ?? 0);
  if (previous === Number.MAX_SAFE_INTEGER)
    throw new AgentAuthorityConflict("Authority serialization token exhausted");
  const result = await collection.updateOne(
    {
      id: row.id,
      [field]: row[field] === undefined ? { $exists: false } : previous,
    },
    { $set: { [field]: previous + 1 } },
    { session },
  );
  if (!result.matchedCount)
    throw new AgentAuthorityConflict("Authority changed");
  return row;
}

/** Exact positive dependencies only. New memberships cannot revoke an existing
 * sufficient chain; deletions/changes of the chosen chain conflict on its rows.
 * The trusted readiness policy supplies any further persisted dependencies. */
export async function serializeAgentAuthority(
  db: Db,
  run: Pick<AgentRun, "workspaceId" | "requester" | "authority" | "target">,
  session: ClientSession,
  extra: readonly AuthorityAnchor[] = [],
  lockTarget = true,
) {
  const anchors: AuthorityAnchor[] = [
    { collection: "crm_workspaces", id: run.workspaceId },
    ...(lockTarget
      ? [
          {
            collection: (run.target.kind === "workspace_agent"
              ? "agent_definitions"
              : run.target.kind === "client_agent"
                ? "client_agents"
                : "client_swarms") as AuthorityAnchor["collection"],
            id:
              run.target.kind === "workspace_agent"
                ? run.target.definition.id
                : run.target.id,
          },
        ]
      : []),
    ...extra,
  ];
  if (run.authority.basis === "client") {
    anchors.push({
      collection: "workspace_memberships",
      id: run.authority.membershipId,
    });
  } else {
    const memberships = await db
      .collection("hvm_partner_memberships")
      .find(
        {
          "human.type": "human",
          "human.issuer": run.requester.issuer,
          "human.id": run.requester.id,
          status: "active",
          archived: { $ne: true },
        },
        { session },
      )
      .limit(201)
      .toArray();
    if (memberships.length > 200) throw new AuthorizationDenied();
    let chain: Document | undefined;
    for (const membership of memberships) {
      if (
        !HvmPartnerMembershipSchema.safeParse(withoutMongoId(membership))
          .success
      )
        continue;
      const partner = await db.collection("hvm_partners").findOne(
        {
          id: membership.partnerId,
          status: "active",
          archived: { $ne: true },
        },
        { session },
      );
      const assignment =
        partner &&
        (await db.collection("workspace_partner_assignments").findOne(
          {
            partnerId: partner.id,
            workspaceId: run.workspaceId,
            status: "active",
            archived: { $ne: true },
          },
          { session },
        ));
      if (
        partner &&
        assignment &&
        HvmPartnerSchema.safeParse(withoutMongoId(partner)).success &&
        WorkspacePartnerAssignmentSchema.safeParse(withoutMongoId(assignment))
          .success
      ) {
        chain = { membership, partner, assignment };
        break;
      }
    }
    if (!chain) {
      // Legacy management authority is labelled "partner" in persisted runs.
      // Direct client administrators have the same management permission but
      // must serialize their own current membership, not a delegated chain.
      const member = await db.collection("workspace_memberships").findOne(
        {
          workspaceId: run.workspaceId,
          "human.type": "human",
          "human.id": run.requester.id,
          "human.issuer": run.requester.issuer,
          role: "admin",
          status: "active",
          archived: { $ne: true },
        },
        { session },
      );
      if (
        !member ||
        !WorkspaceMembershipSchema.safeParse(withoutMongoId(member)).success
      )
        throw new AuthorizationDenied();
      anchors.push({ collection: "workspace_memberships", id: member.id });
    } else
      anchors.push(
        { collection: "hvm_partner_memberships", id: chain.membership.id },
        { collection: "hvm_partners", id: chain.partner.id },
        {
          collection: "workspace_partner_assignments",
          id: chain.assignment.id,
        },
      );
  }
  const unique = new Map(anchors.map((a) => [a.collection + ":" + a.id, a]));
  if (unique.size > 100)
    throw new AgentAuthorityConflict("Authority dependency limit");
  for (const [, anchor] of [...unique].sort(([a], [b]) => a.localeCompare(b)))
    await lockAuthorityDocument(db, anchor, session);
}
