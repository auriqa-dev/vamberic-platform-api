import type { Db, ClientSession } from "mongodb";
import { outcome, summarise, guidance } from "./model";
export async function readMeasurement(
  db: Db,
  w: string,
  filter: {
    campaignId?: string;
    contactId?: string;
    organisationId?: string;
    communicationId?: string;
    since?: string;
    until?: string;
  } = {},
  session?: ClientSession,
) {
  const query: Record<string, unknown> = {
    workspaceId: w,
    eventType: "measurement_outcome",
    "payload.testOnly": false,
  };
  for (const key of [
    "campaignId",
    "contactId",
    "organisationId",
    "communicationId",
  ] as const)
    if (filter[key]) query[`payload.${key}`] = filter[key];
  const raw = await db
    .collection("events")
    .find(query, { session })
    .sort({ occurredAt: -1 })
    .limit(2001)
    .toArray();
  const parsed = raw.slice(0, 2000).flatMap((r) => {
    const p = outcome.safeParse(r.payload);
    return p.success &&
      (!p.data.website || Date.parse(p.data.website.expiresAt) > Date.now())
      ? [{ id: r.id, ...p.data }]
      : [];
  });
  const since = filter.since ? Date.parse(filter.since) : 0;
  const latestReply = new Map<string, number>();
  for (const e of parsed)
    if (e.replyId)
      latestReply.set(
        e.replyId,
        Math.max(latestReply.get(e.replyId) || 0, e.sourceVersion),
      );
  const events = parsed.filter((e) => Date.parse(e.occurredAt) >= since && (!filter.until || Date.parse(e.occurredAt) < Date.parse(filter.until)));
  const current = events.filter(
    (e) => !e.replyId || latestReply.get(e.replyId) === e.sourceVersion,
  );
  const feedbackQuery: Record<string, unknown> = {
    workspaceId: w,
    eventType: "nba_measurement_feedback",
    "payload.testOnly": false,
  };
  for (const key of ["campaignId", "contactId", "organisationId"] as const)
    if (filter[key]) feedbackQuery[`payload.${key}`] = filter[key];
  const feedbackRaw = await db
    .collection("events")
    .find(feedbackQuery, { session })
    .sort({ updatedAt: -1 })
    .limit(101)
    .toArray();
  const feedback = feedbackRaw.filter(
    (r) =>
      !r.payload.websiteExpiresAt ||
      Date.parse(r.payload.websiteExpiresAt) > Date.now(),
  );
  const contactIds = [
    ...new Set([
      ...events.map((e) => e.contactId),
      ...feedback.map((r) => r.payload.contactId),
    ]),
  ];
  const people = contactIds.length
    ? await db
        .collection("people")
        .find({ workspaceId: w, id: { $in: contactIds } }, { session })
        .toArray()
    : [];
  const names = new Map(
    people.map((p) => [
      p.id,
      [p.firstName, p.lastName].filter(Boolean).join(" ") || "Contact",
    ]),
  );
  const configuredWebsite = await db
    .collection("events")
    .findOne(
      {
        workspaceId: w,
        eventType: "website_tracking_site",
        "payload.enabled": true,
        "payload.revoked": false,
        "payload.testOnly": false,
      },
      { session },
    );
  const hasWebsiteEvidence = current.some((e) => e.provider === "website");
  const metrics = summarise(current).map((m) =>
    !configuredWebsite &&
    !hasWebsiteEvidence &&
    [
      "clicked",
      "cta_requested",
      "website_view",
      "website_engaged",
      "website_event",
    ].includes(m.kind)
      ? {
          ...m,
          value: null,
          unit: "Unavailable — live website tracking is not configured",
        }
      : m,
  );
  return {
    updatedAt: new Date().toISOString(),
    truncated: raw.length > 2000 || feedback.length > 100,
    metrics,
    timeline: events.slice(0, 100).map((e) => ({
      ...e,
      contactName:
        names.get(e.contactId) ||
        (e.contactId ? "Contact" : "Anonymous visitor"),
      guidance: guidance(e),
    })),
    feedback: feedback.slice(0, 100).map((r) => ({
      id: r.id,
      ...r.payload,
      contactName: names.get(r.payload.contactId) || "Contact",
      updatedAt: r.updatedAt.toISOString(),
    })),
    eventCount: events.length,
    contactCount: new Set(events.map((e) => e.contactId).filter(Boolean)).size,
    organisationCount: new Set(
      events.map((e) => e.organisationId).filter(Boolean),
    ).size,
    limitations: [
      "Gmail acceptance does not prove delivery or reading.",
      "Website events are browser-reported. Links identify an intended recipient, not necessarily the visitor. Scanners and forwarded links can affect counts. Email opens are unavailable.",
      "Test traffic is excluded. Counts are unique contacts unless labelled otherwise.",
      "Qualification, bookings and conversions require separate supporting evidence.",
      "Older communications are reconciled progressively; only captured evidence is counted.",
    ],
    windowStart: new Date(since).toISOString(),
    windowEnd: filter.until ?? null,
  };
}
