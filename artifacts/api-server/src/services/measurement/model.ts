import { z } from "zod";
export const outcomeKinds = [
  "awaiting_review",
  "scheduled",
  "sending",
  "accepted",
  "failed",
  "unknown",
  "blocked",
  "cancelled",
  "reply_received",
  "reply_interpreted",
  "no_response",
  "cta_requested",
  "website_view",
  "website_engaged",
  "website_event",
  "interaction_enquiry",
] as const;
const outcomeShape = z
  .object({
    schemaVersion: z.literal(1),
    eventKey: z.string().max(250),
    kind: z.enum(outcomeKinds),
    communicationId: z.string(),
    contactId: z.string(),
    organisationId: z.string().optional(),
    brandId: z.string(),
    campaignId: z.string().optional(),
    offerId: z.string().optional(),
    offerIds: z.array(z.string()).optional(),
    nbaDecisionId: z.string().optional(),
    draftId: z.string(),
    draftVersion: z.number(),
    sourceId: z.string(),
    sourceVersion: z.number(),
    occurredAt: z.string().datetime(),
    provider: z.enum(["google_workspace", "website"]),
    website: z
      .object({
        siteId: z.string(),
        identity: z.enum(["anonymous", "intended_recipient"]),
        automation: z.enum(["unknown", "suspected_bot", "likely_human"]),
        path: z.string(),
        name: z.string().optional(),
        expiresAt: z.string().datetime(),
      })
      .optional(),
    providerId: z.string().optional(),
    conversationId: z.string().optional(),
    fact: z.enum(["observed", "derived"]),
    testOnly: z.boolean(),
    category: z.string().optional(),
    reviewed: z.boolean().optional(),
    associated: z.boolean().optional(),
    replyId: z.string().optional(),
    responseDueAt: z.string().datetime().optional(),
    returnAt: z.string().datetime().optional(),
    cta: z
      .object({ assetId: z.string().optional(), url: z.string().optional() })
      .optional(),
  })
  .strict();
// Mongo persists optional undefined properties as null. Treat only known optional
// properties as absent; required values and unknown keys remain strictly checked.
export const outcome = z.preprocess((raw) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const value = { ...(raw as Record<string, unknown>) };
  for (const key of [
    "organisationId",
    "campaignId",
    "offerId",
    "offerIds",
    "nbaDecisionId",
    "providerId",
    "conversationId",
    "category",
    "reviewed",
    "associated",
    "replyId",
    "responseDueAt",
    "returnAt",
    "cta",
  ]) {
    if (value[key] === null) delete value[key];
  }
  if (value.cta && typeof value.cta === "object" && !Array.isArray(value.cta)) {
    const cta = { ...(value.cta as Record<string, unknown>) };
    for (const key of ["assetId", "url"])
      if (cta[key] === null) delete cta[key];
    value.cta = cta;
  }
  return value;
}, outcomeShape);
export type Outcome = z.infer<typeof outcome>;
export function guidance(e: Outcome) {
  if (e.testOnly)
    return "Test evidence only; excluded from campaign metrics and NBA feedback.";
  if (e.kind === "interaction_enquiry")
    return "Human-reviewed association of a website enquiry. Visitor statements are not verified qualification or permission for marketing. Review suppression and existing engagements before acting.";
  if (e.website)
    return e.website.identity === "anonymous"
      ? "Anonymous browser activity; no contact identity established."
      : "Activity attributed to an email intended for this contact. Forwarding and automated access remain possible. Review alongside replies and contact policy; this is not qualification or sending authority.";
  if (e.kind === "no_response")
    return "Response window elapsed with no captured reply. Recheck history and contact policy before proposing a follow-up.";
  if (e.kind === "accepted")
    return "Wait for a response or the approved response window. Gmail acceptance does not prove delivery or reading.";
  if (e.kind === "reply_received" || e.kind === "reply_interpreted") {
    if (!e.associated)
      return "Review sender identity before attributing this reply. Conflicting outreach is held.";
    if (
      [
        "unsubscribe",
        "not_interested",
        "left_organisation",
        "delivery_failure",
      ].includes(e.category || "")
    )
      return "Outreach restricted. Review the evidence and contact or address restriction; do not send another message.";
    if (!e.reviewed)
      return "Review this interpretation before further engagement. A reply is not qualification.";
    if (e.category === "out_of_office")
      return e.returnAt
        ? `Wait until ${e.returnAt}; reconsider then. This is not positive engagement.`
        : "Temporary absence; confirm a return date before scheduling reconsideration.";
    if (["automated", "delivery_failure"].includes(e.category || ""))
      return "Automated response; do not count as human engagement.";
    if (e.category === "meeting_request")
      return "Review qualification criteria and prepare a booking response. A meeting has not been booked.";
    if (e.category === "wrong_person" || e.category === "referral")
      return "Research the suggested contact; referral is not permission to contact them.";
    return "Reconsider the next action using the reviewed reply, offer and campaign qualification criteria. No automatic sending authority.";
  }
  return "Review delivery status and evidence; do not blindly retry uncertain sends.";
}
export function summarise(events: Outcome[]) {
  const latest = new Map<string, Outcome>();
  for (const e of events) {
    if (e.testOnly) continue;
    const key = e.replyId ? `reply:${e.replyId}` : e.eventKey;
    const old = latest.get(key);
    if (!old || e.sourceVersion > old.sourceVersion) latest.set(key, e);
  }
  const rows = [...latest.values()];
  const metric = (
    key: string,
    label: string,
    predicate: (e: Outcome) => boolean,
  ) => ({
    kind: key,
    label,
    value: new Set(
      rows
        .filter(predicate)
        .map((e) => e.contactId)
        .filter(Boolean),
    ).size,
    unit: "unique contacts",
  });
  return [
    metric("accepted", "Accepted by Gmail", (e) => e.kind === "accepted"),
    metric(
      "replied",
      "Confirmed human replies",
      (e) =>
        !!e.replyId &&
        e.associated === true &&
        e.reviewed === true &&
        [
          "interested",
          "question",
          "objection",
          "meeting_request",
          "not_interested",
          "unsubscribe",
          "wrong_person",
          "referral",
        ].includes(e.category || ""),
    ),
    metric(
      "interested",
      "Positive interest",
      (e) =>
        !!e.reviewed &&
        !!e.associated &&
        ["interested", "meeting_request"].includes(e.category || ""),
    ),
    metric(
      "meeting_requested",
      "Meeting requested",
      (e) => !!e.reviewed && !!e.associated && e.category === "meeting_request",
    ),
    metric(
      "review",
      "Replies needing review",
      (e) => !!e.replyId && (!e.reviewed || !e.associated),
    ),
    metric(
      "clicked",
      "Intended recipients with likely-human CTA activity",
      (e) => e.kind === "website_engaged" && !!e.communicationId,
    ),
    ...[
      "cta_requested",
      "website_view",
      "website_engaged",
      "website_event",
      "interaction_enquiry",
    ].map((kind) => ({
      kind,
      label: (
        {
          cta_requested: "CTA requests (includes scanners)",
          website_view: "Reported page views (includes automation)",
          website_engaged: "Likely-human browser interactions",
          website_event: "Configured website events",
          interaction_enquiry: "Website enquiries",
        } as Record<string, string>
      )[kind],
      value: rows.filter((e) => e.kind === kind).length,
      unit: "events; attribution is not confirmed identity",
    })),
    ...["delivered", "opened"].map((kind) => ({
      kind,
      label:
        kind === "delivered"
          ? "Confirmed delivery"
          : kind === "opened"
            ? "Opened"
            : "Clicked",
      value: null,
      unit: "Unavailable — tracking/provider signal not connected",
    })),
  ];
}
/** Contract only: no endpoint, script or public ingestion is enabled. */
export const websiteSignal = z
  .object({
    schemaVersion: z.literal(1),
    eventId: z.string().uuid(),
    kind: z.enum([
      "cta_clicked",
      "visit",
      "page_view",
      "form_submitted",
      "booking_completed",
      "conversion",
    ]),
    occurredAt: z.string().datetime(),
    correlationToken: z.string().min(32).max(256),
    pageUrl: z
      .string()
      .url()
      .max(2000)
      .refine((v) => /^https?:\/\//i.test(v), "Use an HTTP(S) page URL"),
    identity: z.enum(["anonymous", "attributed", "confirmed"]),
    automation: z.enum(["human", "suspected_bot", "unknown"]),
    evidenceReference: z.string().max(200),
  })
  .strict();
