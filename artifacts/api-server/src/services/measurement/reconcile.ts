import type { MongoService } from "../mongo";
import { lockIcpWorkspace } from "../icp/access";
import { recordOutcome } from "./store";
/** Recover older/interrupted outcome projection and elapsed approved response windows.
 * Reuses the API worker; never sends, generates content or calls a provider. */
export function measurementReconciler(
  mongo: MongoService,
  onError: () => void = () => {},
) {
  let after: string | undefined;
  return {
    async tick() {
      if (!mongo.withTransaction) return;
      const db = await mongo.database();
      const rows = await db
        .collection("events")
        .find({
          eventType: "communication",
          ...(after ? { id: { $gt: after } } : {}),
        })
        .sort({ id: 1 })
        .limit(30)
        .toArray();
      after = rows.length === 30 ? rows.at(-1)!.id : undefined;
      for (const r of rows)
        await mongo
          .withTransaction(async (d, s) => {
            await lockIcpWorkspace(d, r.workspaceId, s);
            const current = await d.collection("events").findOne(
              {
                id: r.id,
                workspaceId: r.workspaceId,
                eventType: "communication",
              },
              { session: s },
            );
            if (!current) return;
            await recordOutcome(d, s, current);
            const replies = await d
              .collection("events")
              .find(
                {
                  workspaceId: r.workspaceId,
                  eventType: "communication_reply",
                  "payload.communicationId": r.id,
                },
                { session: s },
              )
              .toArray();
            for (const reply of replies)
              await recordOutcome(d, s, current, reply);
            const p = current.payload;
            if (
              !p.testOnly &&
              p.status === "accepted" &&
              p.responseDueAt &&
              Date.parse(p.responseDueAt) <= Date.now() &&
              Date.parse(p.syncedAt || "") >= Date.parse(p.responseDueAt) &&
              !replies.length
            )
              await recordOutcome(d, s, current, undefined, "no_response");
          })
          .catch(onError);
      // Waiting feedback becomes reviewable at the confirmed return time, not a send.
      await db.collection("events").updateMany(
        {
          eventType: "nba_measurement_feedback",
          "payload.state": "waiting",
          "payload.kind": "reply_interpreted",
          "payload.dueAt": {
            $type: "string",
            $lte: new Date().toISOString(),
          },
        },
        {
          $set: { "payload.state": "review_required", updatedAt: new Date() },
        },
      );
    },
  };
}
