import { z } from "zod";
import { acceptedLushaEmail, lushaContact } from "../lusha/provider";
export const employmentReview = z
  .object({
    sourceUrl: z.string().url().max(2048),
    observedAt: z.string().datetime(),
    quote: z.string().trim().min(10).max(2000),
    currentEmployment: z.literal(true),
    roleMatches: z.literal(true),
  })
  .strict();
export function normaliseIdentity(v: string) {
  return v.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}
export function verifyLushaMatch(
  candidate: { firstName: string; lastName: string; domain: string },
  raw: unknown,
) {
  const contact = lushaContact.parse(raw);
  const same =
    !contact.error &&
    normaliseIdentity(contact.firstName ?? "") ===
      normaliseIdentity(candidate.firstName) &&
    normaliseIdentity(contact.lastName ?? "") ===
      normaliseIdentity(candidate.lastName) &&
    normaliseIdentity(contact.company?.domain ?? "").replace(/^www\./, "") ===
      normaliseIdentity(candidate.domain).replace(/^www\./, "");
  return {
    matched: same,
    email: same ? acceptedLushaEmail(contact) : null,
    providerId: contact.id,
  };
}
