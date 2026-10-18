import type { Db, ClientSession } from "mongodb";
import { ContactStrategyPolicyV14Schema } from "../../domain/identity-value-v14";
import { withoutMongoId } from "../hvm-context";
import { currentContactStrategies } from "./evaluate";

/** Draft edits do not replace approved versions; withdrawal does. Never trust
 * a recorded status without its matching workspace approval event. */
export async function readApprovedContactStrategies(db: Db, workspaceId: string, session?: ClientSession) {
  const rows = await db.collection("contact_strategy_policies").find({ workspaceId }, { session }).toArray();
  const current = currentContactStrategies(rows.map(r => ContactStrategyPolicyV14Schema.parse(withoutMongoId(r))));
  const approvals = await db.collection("events").find({ workspaceId,
    eventType: "contact_strategy_changed", "payload.operation": "approve" }, { session }).toArray();
  const approved = current.filter(p => approvals.some(e => e.payload.policyId === p.id && e.payload.version === p.version));
  return { approved, missingApproval: current.filter(p => !approved.includes(p)).map(p => p.id) };
}
