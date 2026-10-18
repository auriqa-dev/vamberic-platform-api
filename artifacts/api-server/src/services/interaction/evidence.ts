import type { Db, ClientSession } from "mongodb";
/** Internal NBA evidence only; never supplied to the public assistant. */
export async function readInteractionEvidence(
  db: Db,
  w: string,
  brandId: string,
  contactId: string,
  session?: ClientSession,
) {
  const rows = await db
    .collection("events")
    .find(
      {
        workspaceId: w,
        eventType: "interaction_enquiry",
        archived: { $ne: true },
        "payload.contactId": contactId,
        "payload.brandId": brandId,
        "payload.identityConfidence": "human_reviewed_association",
        "payload.testOnly": false,
        "payload.expiresAt": { $gt: new Date().toISOString() },
      },
      { session },
    )
    .sort({ updatedAt: -1 })
    .limit(10)
    .toArray();
  return rows.map((r) => ({
    id: r.id,
    version: r.payload.version,
    message: r.payload.visitor.message,
    claimedOrganisation: r.payload.visitor.organisation,
    reviewNote: r.payload.reviewNote || "",
    qualification:
      "Visitor statements, not verified qualification or marketing permission",
    occurredAt: r.occurredAt,
  }));
}
