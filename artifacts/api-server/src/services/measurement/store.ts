import { releaseEngagement } from "../nba/coordination";
import type { Db, ClientSession, Document } from "mongodb";
import { EventSchema, generatePlatformId } from "../../domain";
import { outcome, guidance, type Outcome } from "./model";
// Caller holds the existing workspace transaction lock. No second event store.
export async function recordOutcome(
  db: Db,
  s: ClientSession | undefined,
  r: Document,
  reply?: Document,
  kindOverride?: "no_response",
) {
  const p = r.payload,
    d = p.draft;
  if (!d) return;
  const rp = reply?.payload;
  const kind =
    kindOverride ??
    (reply ? (rp.reviewed ? "reply_interpreted" : "reply_received") : p.status);
  const version = reply ? rp.version : p.version;
  const eventKey = `${reply ? reply.id : r.id}:${kind}:${reply ? version : kindOverride ? p.responseDueAt || "none" : "observed"}`;
  const existing = await db.collection("events").findOne(
    {
      workspaceId: r.workspaceId,
      eventType: "measurement_outcome",
      "payload.eventKey": eventKey,
    },
    { session: s },
  );
  if (existing) return;
  const at = kindOverride
    ? new Date().toISOString()
    : reply
      ? rp.reviewed
        ? reply.updatedAt
        : reply.occurredAt
      : kind === "accepted"
        ? (p.acceptedAt ?? r.updatedAt)
        : r.updatedAt;
  const value = outcome.parse({
    schemaVersion: 1,
    eventKey,
    kind,
    communicationId: r.id,
    contactId: d.contactId,
    organisationId: p.organisationId || undefined,
    brandId: d.brandId,
    campaignId: d.campaignId || undefined,
    offerId: d.offerId || undefined,
    offerIds: p.offerIds ?? [],
    nbaDecisionId: d.nbaDecisionId || undefined,
    draftId: d.id,
    draftVersion: d.version,
    sourceId: reply?.id ?? r.id,
    sourceVersion: version,
    occurredAt: new Date(at).toISOString(),
    responseDueAt: p.responseDueAt || undefined,
    provider: "google_workspace",
    providerId: rp?.providerId ?? p.providerId,
    conversationId: p.threadId,
    fact: kind === "reply_interpreted" || kindOverride ? "derived" : "observed",
    testOnly: !!p.testOnly,
    ...(reply
      ? {
          replyId: reply.id,
          category: rp.interpretation?.category,
          reviewed: !!rp.reviewed,
          associated: !!rp.associated,
          returnAt: rp.returnAt,
        }
      : {}),
    cta: {
      assetId: d.content?.ctaAssetId || undefined,
      url: d.ctaUrl || undefined,
    },
  });
  const now = new Date();
  const row = EventSchema.parse({
    id: generatePlatformId("event"),
    workspaceId: r.workspaceId,
    ...(d.campaignId ? { campaignId: d.campaignId } : {}),
    personIds: [d.contactId],
    eventType: "measurement_outcome",
    occurredAt: new Date(value.occurredAt),
    createdAt: now,
    updatedAt: now,
    payload: value,
  });
  await db.collection("events").insertOne(row, { session: s });
  if (value.testOnly) return;
  if (
    [
      "accepted",
      "reply_received",
      "reply_interpreted",
      "no_response",
      "failed",
      "unknown",
      "blocked",
      "cancelled",
    ].includes(kind)
  )
    await queueFeedback(db, s, r.workspaceId, value, row.id);
}
export async function queueFeedback(
  db: Db,
  s: ClientSession | undefined,
  w: string,
  e: Outcome,
  evidenceId: string,
) {
  // One durable coalesced request per engagement, regardless of delivery count.
  const key = `${e.campaignId || "unassigned"}:${e.contactId}`;
  const prior = await db.collection("events").findOne(
    {
      workspaceId: w,
      eventType: "nba_measurement_feedback",
      "payload.key": key,
    },
    { session: s },
  );
  if (
    prior?.payload.occurredAt &&
    Date.parse(prior.payload.occurredAt) > Date.parse(e.occurredAt)
  )
    return;
  // Website signals must never clear reply restrictions, absence waits or review holds.
  if (
    (e.website || e.kind === "interaction_enquiry") &&
    prior &&
    ["reply_received", "reply_interpreted", "unknown", "blocked"].includes(
      prior.payload.kind,
    )
  )
    return;
  const now = new Date(),
    due =
      e.category === "out_of_office" && e.reviewed
        ? e.returnAt
        : e.kind === "accepted"
          ? e.responseDueAt
          : undefined;
  const payload = {
    key,
    version: (prior?.payload.version ?? 0) + 1,
    campaignId: e.campaignId,
    contactId: e.contactId,
    organisationId: e.organisationId,
    brandId: e.brandId,
    sourceId: e.sourceId,
    evidenceId,
    occurredAt: e.occurredAt,
    kind: e.kind,
    category: e.category,
    reason: guidance(e),
    state:
      e.kind === "accepted" || (due && Date.parse(due) > Date.now())
        ? "waiting"
        : "review_required",
    dueAt: due ?? null,
    testOnly: false,
    ...(e.website ? { websiteExpiresAt: e.website.expiresAt } : {}),
  };
  if (prior)
    await db
      .collection("events")
      .updateOne(
        { workspaceId: w, id: prior.id },
        { $set: { payload, updatedAt: now } },
        { session: s },
      );
  else
    await db.collection("events").insertOne(
      EventSchema.parse({
        id: generatePlatformId("event"),
        workspaceId: w,
        eventType: "nba_measurement_feedback",
        createdAt: now,
        updatedAt: now,
        occurredAt: now,
        payload,
      }),
      { session: s },
    );
  // Invalidate approved work across campaigns for this person. The native worker
  // also rechecks the evidence fingerprint before any capability execution.
  if (e.kind === "reply_received" || e.kind === "reply_interpreted") {
    const rows = await db
      .collection("events")
      .find(
        {
          workspaceId: w,
          eventType: "nba_decision",
          "payload.subject.type": "person",
          "payload.subject.id": e.contactId,
        },
        { session: s },
      )
      .sort({ "payload.version": -1 })
      .toArray();
    const seen = new Set<string>();
    for (const r of rows) {
      const p = r.payload;
      if (seen.has(p.decisionId)) continue;
      seen.add(p.decisionId);
      if (!["scheduled", "waiting", "running", "proposed"].includes(p.state))
        continue;
      if (s)
        await releaseEngagement(
          db,
          s,
          w,
          r.campaignId,
          p.decisionId,
          p.claimKeys ?? [],
          r.createdBy,
          "Communication evidence requires renewed review",
          now,
        );
      await db.collection("events").insertOne(
        EventSchema.parse({
          id: generatePlatformId("event"),
          workspaceId: w,
          campaignId: r.campaignId,
          eventType: "nba_decision",
          createdAt: now,
          updatedAt: now,
          occurredAt: now,
          createdBy: r.createdBy,
          payload: {
            ...p,
            version: p.version + 1,
            state: "review_required",
            blockers: [guidance(e)],
            measurementEvidenceId: evidenceId,
          },
        }),
        { session: s },
      );
    }
  }
}
