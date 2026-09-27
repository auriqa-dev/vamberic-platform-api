import { z } from "zod";
import { domainToASCII } from "node:url";
import { platformIdPattern } from "./ids";

export const webUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .url()
  .refine((v) => {
    const url = new URL(v);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  }, "must be an HTTP(S) URL without credentials");
export const socialProfilesSchema = z
  .array(
    z
      .object({
        network: z.enum(["linkedin", "x", "facebook", "instagram", "other"]),
        url: webUrlSchema,
      })
      .strict(),
  )
  .max(10);
export const linkedinUrlSchema = webUrlSchema.refine((v) => {
  const host = new URL(v).hostname.toLowerCase();
  return host === "linkedin.com" || host.endsWith(".linkedin.com");
}, "must be a LinkedIn URL");
export function normalizeOrganisationDomain(value: string): string {
  return domainToASCII(value.trim().toLowerCase().replace(/\.$/, ""));
}
export const normalizedDomainSchema = z
  .string()
  .max(253)
  .refine(
    (v) =>
      v === normalizeOrganisationDomain(v) &&
      /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(v) &&
      v.split(".").every((part) => part.length <= 63),
    "must be a normalized hostname (not a URL)",
  );
export const crmActorSchema = z
  .object({
    type: z.enum(["human", "agent", "system", "integration"]),
    id: z.string().trim().min(1).max(300),
  })
  .strict();
/** Account responsibility only; operational agents act through tasks/events/audit. */
export const crmOwnerSchema = z
  .object({
    type: z.literal("human"),
    id: z.string().trim().min(1).max(300),
  })
  .strict();
export const prioritySchema = z.enum(["low", "normal", "high", "urgent"]);
export const attributionSchema = z
  .object({
    channel: z.enum([
      "direct",
      "organic_search",
      "paid_search",
      "social",
      "email",
      "referral",
      "event",
      "outbound",
      "other",
      "unknown",
    ]),
    source: z.string().max(300).optional(),
    medium: z.string().max(100).optional(),
    campaignId: z.string().regex(platformIdPattern("campaign")).optional(),
    landingUrl: webUrlSchema.optional(),
    referrerUrl: webUrlSchema.optional(),
    observedAt: z.date(),
  })
  .strict();
// Vamberic choices, not inferred HubSpot option values. Omission means unknown.
export const qualificationFields = {
  salesLifecycleStage: z
    .enum([
      "lead",
      "qualified",
      "opportunity",
      "customer",
      "advocate",
      "disqualified",
    ])
    .optional(),
  leadStatus: z
    .enum([
      "new",
      "researching",
      "ready",
      "contacted",
      "responded",
      "nurture",
      "closed",
    ])
    .optional(),
  owner: crmOwnerSchema.optional(),
  ownerAssignedAt: z.date().optional(),
  targetAccount: z.boolean().optional(),
  icpTier: z.enum(["tier_1", "tier_2", "tier_3", "outside_icp"]).optional(),
  persona: z
    .object({
      reference: z.string().min(1).max(300).optional(),
      label: z.string().min(1).max(200),
    })
    .strict()
    .optional(),
  qualificationReason: z.string().max(2000).optional(),
  disqualificationReason: z.string().max(2000).optional(),
  nextAction: z.string().max(1000).optional(),
  nextActionAt: z.date().optional(),
  firstAttribution: attributionSchema.optional(),
  latestAttribution: attributionSchema.optional(),
};
export const fieldEvidenceSchema = z
  .object({
    field: z
      .string()
      .regex(/^[a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*){0,2}$/)
      .max(150),
    // Candidate observation is retained separately; service validates against the field's schema.
    value: z.union([
      z.string().max(10000),
      z.number().finite(),
      z.boolean(),
      z.date(),
      socialProfilesSchema,
      z
        .record(
          z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*$/),
          z.union([
            z.string().max(10000),
            z.number().finite(),
            z.boolean(),
            z.date(),
          ]),
        )
        .refine((v) => Object.keys(v).length <= 20),
    ]),
    provider: z.string().trim().min(1).max(100),
    sourceReference: z.string().trim().min(1).max(500),
    observedAt: z.date(),
    verification: z.enum([
      "observed",
      "provider_verified",
      "human_verified",
      "rejected",
    ]),
    confidence: z.number().min(0).max(1).optional(),
  })
  .strict();
export const fieldEvidenceListSchema = z.array(fieldEvidenceSchema).max(200);
export type FieldEvidence = z.infer<typeof fieldEvidenceSchema>;
