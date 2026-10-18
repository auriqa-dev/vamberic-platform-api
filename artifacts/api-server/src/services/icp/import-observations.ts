import { z } from "zod";
import type { Db, ClientSession, Document } from "mongodb";
export const originSchema = z
  .object({
    sheet: z.string().min(1).max(200),
    row: z.number().int().positive(),
    scope: z.enum(["organisation", "notification"]),
    notification: z.string().max(100).optional(),
    relatedRegistration: z.string().max(100).optional(),
    relatedName: z.string().max(300).optional(),
  })
  .strict();
export function typedObservation(label: string, raw: string) {
  const text = raw.trim();
  if (!text || /^(?:-|n\/a|not applicable)$/i.test(text))
    return { label, raw, type: "empty", value: null };
  if (/registration|\bcode\b|\bid\b|postcode|phone/i.test(label))
    return { label, raw, type: "text", value: text };
  if (/^(yes|no)$/i.test(text))
    return { label, raw, type: "boolean", value: text.toLowerCase() === "yes" };
  const match = text.match(
    /^(£)?\s*([-+]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?)\s*(kWh|MWh|%|GBP)?$/,
  );
  if (match) {
    const value = Number(match[2]!.replace(/,/g, ""));
    if (Number.isFinite(value))
      return {
        label,
        raw,
        type: "number",
        value,
        unit: match[1] ? "GBP" : (match[3] ?? null),
      };
  }
  if (
    /^\d{4}-\d{2}-\d{2}$/.test(text) ||
    /^\d{1,2} [A-Za-z]{3} \d{4}$/.test(text)
  ) {
    const date = new Date(text);
    if (!Number.isNaN(date.valueOf()))
      return {
        label,
        raw,
        type: "date",
        value: date.toISOString().slice(0, 10),
      };
  }
  return { label, raw, type: "text", value: text };
}
export async function importedFacts(
  db: Db,
  w: string,
  companyId: string,
  session?: ClientSession,
  budget = 6000,
  subject: "company" | "contact" = "company",
) {
  // Observations remain source-specific. Notification totals are deliberately excluded from company facts.
  const rows = await db
    .collection("events")
    .find(
      {
        workspaceId: w,
        eventType: "hive_import_observations",
        [subject === "company" ? "payload.companyId" : "payload.personId"]:
          companyId,
        "payload.origin.scope": "organisation",
      },
      { session },
    )
    .sort({ occurredAt: -1 })
    .limit(100)
    .toArray();
  const facts: Document[] = [];
  let bytes = 0;
  for (const row of rows) {
    // Legacy structure observations contain both reporting-group and member
    // columns. Retain the evidence, but do not present this mixed-subject row
    // as facts about the member until subject-specific projection is available.
    if (
      row.payload.origin?.notification &&
      row.payload.origin?.sheet === "Organisation Structure"
    )
      continue;
    for (const field of row.payload.fields ?? []) {
      if (field.type === "empty") continue;
      const fact = { ...field, source: row.payload.origin };
      const length = Buffer.byteLength(JSON.stringify(fact));
      if (bytes + length > budget) return { facts, truncated: true };
      bytes += length;
      facts.push(fact);
    }
  }
  return { facts, truncated: rows.length === 100 };
}
