import type { Db, Document, ClientSession } from "mongodb";
import { createHash } from "node:crypto";
import { EventSchema, generatePlatformId } from "../../domain";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
/** Review history is append-only in the existing events store, in the same save transaction. */
export async function recordReviewChanges(
  db: Db,
  session: ClientSession | undefined,
  w: string,
  offerId: string,
  designId: string,
  actor: unknown,
  before: Document,
  after: Document,
) {
  const snapshot = (s: Document) => ({
    userInputs: s.userInputs ?? [],
    status: s.status,
    decisionRationale: s.decisionRationale ?? null,
    groups: s.groups ?? [],
    evidence: s.evidence ?? [],
    assumptions: s.assumptions ?? [],
    unknowns: s.unknowns ?? [],
    notes: s.notes ?? [],
  });
  for (const stage of after.stages) {
    const previous = before.stages.find(
      (s: Document) => s.stageKey === stage.stageKey,
    );
    const change = {
      before: previous ? snapshot(previous) : null,
      after: snapshot(stage),
    };
    if (JSON.stringify(change.before) === JSON.stringify(change.after))
      continue;
    const now = new Date(),
      id = generatePlatformId("event"),
      text = JSON.stringify(change),
      parts: string[] = [];
    let offset = 0;
    while (offset < text.length) {
      let length = Math.min(6000, text.length - offset);
      while (
        Buffer.byteLength(JSON.stringify(text.slice(offset, offset + length))) >
        10000
      )
        length = Math.floor(length / 2);
      parts.push(text.slice(offset, offset + length));
      offset += length;
    }
    const base = {
      workspaceId: w,
      occurredAt: now,
      createdAt: now,
      updatedAt: now,
      actor,
      source: { system: "hvm_offer_review" },
    };
    await db
      .collection("events")
      .insertOne(
        EventSchema.parse({
          ...base,
          id,
          eventType: "offer_review_changed",
          payload: {
            offerId,
            designId,
            stageKey: stage.stageKey,
            parts: parts.length,
            hash: hash(text),
          },
        }),
        { session },
      );
    for (let part = 0; part < parts.length; part++)
      await db
        .collection("events")
        .insertOne(
          EventSchema.parse({
            ...base,
            id: generatePlatformId("event"),
            eventType: "offer_review_change_part",
            payload: { reviewId: id, offerId, part, text: parts[part] },
          }),
          { session },
        );
  }
}
export async function readReviewHistory(db: Db, w: string, offerId: string) {
  const changes = await db
    .collection("events")
    .find({
      workspaceId: w,
      eventType: "offer_review_changed",
      "payload.offerId": offerId,
    })
    .sort({ createdAt: -1, id: -1 })
    .limit(30)
    .toArray();
  const parts = changes.length
    ? await db
        .collection("events")
        .find({
          workspaceId: w,
          eventType: "offer_review_change_part",
          "payload.offerId": offerId,
          "payload.reviewId": { $in: changes.map((c) => c.id) },
        })
        .toArray()
    : [];
  return changes.flatMap((c) => {
    const rows = parts
        .filter((p) => p.payload.reviewId === c.id)
        .sort((a, b) => a.payload.part - b.payload.part),
      text = rows.map((r) => r.payload.text).join("");
    if (rows.length !== c.payload.parts || hash(text) !== c.payload.hash)
      return [];
    const change = JSON.parse(text);
    return [
      {
        id: c.id,
        stageKey: c.payload.stageKey,
        at: c.createdAt,
        actor: c.actor,
        ...change,
      },
    ];
  });
}
