import type { MongoService } from "../mongo";
import { lockIcpWorkspace } from "../icp/access";
/** Bounded expiry on the existing worker; delivery audit records are untouched. */
export async function expireWebsiteEvidence(mongo: MongoService) {
  if (!mongo.withTransaction) return;
  const db = await mongo.database(),
    now = new Date();
  const rows = await db
    .collection("events")
    .find({
      $or: [
        {
          eventType: "measurement_outcome",
          "payload.provider": "website",
          "payload.website.expiresAt": { $lte: now.toISOString() },
        },
        {
          eventType: "website_tracking_session",
          "payload.expiresAt": { $lte: now },
        },
        {
          eventType: "website_tracking_link",
          "payload.expiresAt": { $lte: now },
          "payload.communicationId": { $type: "string" },
        },
      ],
    })
    .limit(100)
    .toArray();
  for (const row of rows)
    await mongo.withTransaction(async (db, s) => {
      await lockIcpWorkspace(db, row.workspaceId, s);
      if (row.eventType === "website_tracking_link") {
        await db
          .collection("events")
          .updateOne(
            { id: row.id, workspaceId: row.workspaceId },
            { $set: { "payload.communicationId": null } },
            { session: s },
          );
      } else {
        await db
          .collection("events")
          .deleteOne(
            { id: row.id, workspaceId: row.workspaceId },
            { session: s },
          );
        await db.collection("events").deleteMany(
          {
            workspaceId: row.workspaceId,
            eventType: "nba_measurement_feedback",
            "payload.evidenceId": row.id,
            "payload.kind": { $in: ["website_engaged"] },
          },
          { session: s },
        );
      }
    });
}
