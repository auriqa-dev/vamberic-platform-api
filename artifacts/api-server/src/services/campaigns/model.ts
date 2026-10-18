import { z } from "zod";
const text = (max: number) => z.string().trim().max(max);
const ref = z
  .object({ id: text(100).min(1), revision: z.number().int().positive() })
  .strict();
export const campaignSetup = z
  .object({
    operatingMode: z.enum(["opportunity_development", "engagement_management", "both"]).optional(),
    organisationPriorities: text(2000).optional(),
    researchRefresh: text(2000).optional(),
    bookingUrl: z.union([z.literal(""), z.string().url().max(2048).refine(v => v.startsWith("https://"), "Use an HTTPS booking URL")]).optional(),
    meetingPurpose: text(1000).optional(),
    handoverRecipient: text(200).optional(),
    enrichmentPolicy: text(2000).optional(),
    dailyEmailFetchLimit: z.number().int().positive().optional(),
    monthlyCreditAllocation: z.number().int().positive().optional(),
    name: text(200).min(1),
    objective: text(2000),
    purpose: z.enum(["acquisition", "retention", "reactivation", "education", "cross_sell", "other"]).default("acquisition"),
    brandId: text(100).min(1),
    products: z.array(ref).max(20),
    offers: z.array(ref).max(20),
    audiences: z.array(ref).max(20),
    source: z.enum(["existing", "discovery", "both"]),
    researchPriority: text(2000),
    urls: z.array(z.string().url().max(2048)).max(10),
    channels: z.array(z.enum(["email", "website", "linkedin", "chat"])).max(4),
    goal: text(1000),
    target: z.number().int().positive().nullable(),
    owner: text(200),
    timezone: text(100).refine((v) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: v });
        return true;
      } catch {
        return false;
      }
    }, "Choose a valid timezone"),
    startDate: text(10),
    endDate: text(10),
    schedule: text(500),
    contentRecordIds: z.array(text(100)).max(20).default([]),
    assetIds: z.array(text(100)).max(20),
    overlapPolicy: text(2000),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (JSON.stringify(v).length > 12500)
      ctx.addIssue({
        code: "custom",
        message: "Shorten the campaign setup to fit the saved record.",
      });
    if (v.startDate && v.endDate && v.endDate < v.startDate)
      ctx.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "End date must follow start date",
      });
  });
export type CampaignSetup = z.infer<typeof campaignSetup>;
export const campaignMutation = z
  .object({
    requestKey: z.string().uuid(),
    expectedVersion: z.number().int().nonnegative(),
    action: z.enum(["save", "approve", "pause", "archive", "delete"]),
    setup: campaignSetup.optional(),
  })
  .strict();
export const overlapStatement =
  "Where an organisation or contact fits more than one offer, consider its needs, operating complexity, adoption readiness, existing relationships and current engagement. Avoid competing acquisition approaches. If evidence does not establish an appropriate offer, gather further evidence or request review rather than choosing arbitrarily.";
export function campaignReadiness(v: CampaignSetup) {
  return [
    !v.operatingMode && "Choose how NBA should work on this campaign.",
    v.operatingMode !== "engagement_management" && v.source !== "existing" && !v.researchPriority && "Describe the research objective for new organisations.",
    !v.objective && "Describe the commercial objective.",
    !v.products.length && "Select an approved product.",
    !v.offers.length && "Select at least one approved offer.",
    !v.audiences.length && "Select the approved ICPs for the offers.",
    !v.goal && "Define the outcome to measure.",
  ].filter((s): s is string => Boolean(s));
}

export const meetingMutation = z.object({
 requestKey: z.string().uuid(), expectedVersion:z.number().int().nonnegative(),
 id:z.string().optional(), personId:z.string().min(1).max(100), offerId:z.string().min(1).max(100),
 status:z.enum(["confirmed","rescheduled","cancelled","attended","no_show","voided"]),
 startsAt:z.string().datetime(), notes:text(2000), providerReference:text(300).optional(),
}).strict();
