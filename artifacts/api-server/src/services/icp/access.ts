import type { ClientSession, Db } from "mongodb";
import type { AppConfig } from "../../config";
import type { AuthenticatedUser } from "../../middlewares/auth";
import { resolveHvmContext } from "../hvm-context";
import { AuthorizationDenied } from "../../authorization/policy";
import { platformIdSchema, partnerHumanSchema } from "../../domain";
import { HiveConflict } from "../hive-definitions";
export async function icpAccess(
  db: Db,
  config: AppConfig,
  identity: AuthenticatedUser,
  workspaceId: string,
  action: "read" | "create",
  session?: ClientSession,
) {
  platformIdSchema("workspace").parse(workspaceId);
  const r = await resolveHvmContext(db, config, identity, session);
  if (r.context.application !== "hvmapp" || r.context.actor.type !== "human")
    throw new AuthorizationDenied();
  r.authority.scopeFilter(r.context, action, {
    type: "ideal_customer_profiles",
    workspaceId,
  });
  return partnerHumanSchema.parse(r.context.actor);
}
export async function lockIcpWorkspace(
  db: Db,
  workspaceId: string,
  session: ClientSession,
) {
  const row = await db
    .collection("crm_workspaces")
    .findOne(
      { id: workspaceId, kind: "client", archived: { $ne: true } },
      { session },
    );
  if (!row) throw new AuthorizationDenied();
  const now = new Date(Math.max(Date.now(), row.updatedAt.getTime() + 1));
  const result = await db
    .collection("crm_workspaces")
    .updateOne(
      { id: workspaceId, updatedAt: row.updatedAt },
      { $set: { updatedAt: now } },
      { session },
    );
  if (!result.matchedCount) throw new HiveConflict("Workspace changed");
  return now;
}
