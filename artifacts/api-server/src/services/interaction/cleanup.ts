import type { MongoService } from "../mongo";
import { lockIcpWorkspace } from "../icp/access";
/** Retain a minimal audit shell; expire visitor text, identity and session secrets. */
export async function expireInteractionContent(mongo: MongoService) {
  if (!mongo.withTransaction) return;
  const db = await mongo.database(),
    now = new Date();
  const rows = await db
    .collection("events")
    .find({
      eventType: {
        $in: ["interaction_session", "interaction_turn", "interaction_enquiry"],
      },
      "payload.expiresAt": { $lte: now.toISOString() },
      "payload.expired": { $ne: true },
    })
    .limit(100)
    .toArray();
  for (const row of rows)
    await mongo.withTransaction(async (db, s) => {
      await lockIcpWorkspace(db, row.workspaceId, s);
      await db.collection("events").updateOne(
        { id: row.id, workspaceId: row.workspaceId },
        {
          $set: {
            archived: true,
            updatedAt: now,
            payload: {
              expired: true,
              expiredAt: now.toISOString(),
              version: row.payload.version || 1,
              status: "expired",
              testOnly: !!row.payload.testOnly,
            },
          },
        },
        { session: s },
      );
    });
}
