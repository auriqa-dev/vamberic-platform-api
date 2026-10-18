import { z } from "zod";
/** Server-written events only. No public ingestion endpoint is exposed by Campaigns. */
export const campaignActivity = z
  .object({
    eventKey: z.string().min(1),
    kind: z.enum([
      "managed",
      "sent",
      "delivered",
      "opened",
      "clicked",
      "engaged",
      "qualified",
      "customer",
    ]),
    personId: z.string().min(1),
    offerId: z.string().min(1),
    channel: z.enum(["email", "website", "linkedin", "chat"]),
    occurredAt: z.string().datetime(),
  })
  .strict();
export const metricLabels = {
  managed: "Contacts under management",
  sent: "Emails sent",
  delivered: "Emails delivered",
  opened: "Opened",
  clicked: "Clicked",
  engaged: "Engaging",
  qualified: "Qualified",
  customer: "Signed up / customer",
} as const;
export function campaignMeasurement(
  raw: unknown[],
  since: Date,
  until: Date = new Date(),
) {
  const seen = new Set<string>();
  const events = raw.flatMap((r) => {
    const parsed = campaignActivity.safeParse(r);
    if (!parsed.success) return [];
    const e = parsed.data;
    if (
      seen.has(e.eventKey) ||
      Date.parse(e.occurredAt) < since.getTime() ||
      Date.parse(e.occurredAt) > until.getTime()
    )
      return [];
    seen.add(e.eventKey);
    return [e];
  });
  return Object.entries(metricLabels).map(([kind, label]) => ({
    kind,
    label,
    unit: "unique contacts",
    value: events.some((e) => e.kind === kind)
      ? new Set(events.filter((e) => e.kind === kind).map((e) => e.personId))
          .size
      : null,
  }));
}
