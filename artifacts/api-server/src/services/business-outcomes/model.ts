import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { platformIdSchema } from "../../domain";
export const hash = (v: string) => createHash("sha256").update(v).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");
export function validToken(token: string, expected: string) {
  const actual = Buffer.from(hash(token));
  const target = Buffer.from(expected);
  return actual.length === target.length && timingSafeEqual(actual, target);
}
const field = z
  .string()
  .trim()
  .max(160)
  .regex(/^[a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*$/)
  .refine(
    (v) =>
      !v
        .split(".")
        .some((p) => ["__proto__", "prototype", "constructor"].includes(p)),
  );
export const mapping = z
  .object({
    eventId: field,
    subjectId: field,
    occurredAt: field,
    eventType: field,
    campaignId: field.optional(),
  })
  .strict();
export const definition = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(2000),
    brandId: platformIdSchema("brand"),
    campaignId: platformIdSchema("campaign").nullable(),
    sourceName: z.string().trim().min(1).max(120),
    expectedEvent: z.string().trim().min(1).max(120),
    mapping,
  })
  .strict();
export type Definition = z.infer<typeof definition>;
function valueAt(raw: unknown, path: string) {
  let v = raw;
  for (const part of path.split(".")) {
    if (
      !v ||
      typeof v !== "object" ||
      Array.isArray(v) ||
      !Object.hasOwn(v, part)
    )
      return undefined;
    v = (v as Record<string, unknown>)[part];
  }
  return v;
}
const reference = z
  .union([z.string().trim().min(1).max(250), z.number().finite()])
  .transform(String);
/** Discard the raw body. References are hashed; no email address or payment details are retained. */
export function mapEvidence(d: Definition, raw: unknown, now = new Date()) {
  const id = reference.parse(valueAt(raw, d.mapping.eventId));
  const subject = reference.parse(valueAt(raw, d.mapping.subjectId));
  if (valueAt(raw, d.mapping.eventType) !== d.expectedEvent)
    throw new Error("Event type does not match this outcome.");
  const occurredAt = z
    .string()
    .datetime({ offset: true })
    .parse(valueAt(raw, d.mapping.occurredAt));
  if (+new Date(occurredAt) > +now + 300000)
    throw new Error("Outcome time is in the future.");
  const claimed = d.mapping.campaignId
    ? valueAt(raw, d.mapping.campaignId)
    : undefined;
  const attributed = !!d.campaignId && claimed === d.campaignId;
  return {
    eventHash: hash(id),
    subjectHash: hash(subject),
    occurredAt: new Date(occurredAt).toISOString(),
    campaignId: attributed ? d.campaignId : null,
    attribution: attributed
      ? "Source supplied the configured campaign reference."
      : "No matching campaign reference supplied; unattributed.",
  };
}
