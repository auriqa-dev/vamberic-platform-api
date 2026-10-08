import { z } from "zod";
import { platformIdSchema } from "../domain/schemas";
import {
  DecisionInput,
  RecommendationData,
  CommercialPolicyData,
} from "../domain/operating";
import { partnerHumanSchema } from "../domain/partners";

// Transport-only DTOs; not persisted schemas. Explicit allowlists exclude configuration.
export const ApprovalQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).max(10000).default(0),
  })
  .strict();
export const ApprovalRequest = z
  .object({
    expectedUpdatedAt: z.string().datetime(),
    reason: z.string().trim().min(1).max(2000),
  })
  .strict();
const decision = DecisionInput.innerType()
  .pick({
    treatment: true,
    adjustment: true,
    reason: true,
    onboardingMinor: true,
    commitment: true,
    billingFrequency: true,
    effectiveFrom: true,
    effectiveUntil: true,
  })
  .strict();
export const ApprovalReview = z
  .object({
    id: platformIdSchema("swarmagreement"),
    status: z.literal("proposed"),
    updatedAt: z.string().datetime(),
    workspaceId: platformIdSchema("workspace"),
    swarm: z
      .object({
        id: platformIdSchema("clientswarm"),
        name: z.string().min(1).max(200),
        revision: z.number().int().positive(),
      })
      .strict(),
    recommendation: RecommendationData.pick({
      currency: true,
      expectedOperatingMonthlyMinor: true,
      recommendedOnboardingMinor: true,
      recommendedMonthlyMinor: true,
      recommendedAnnualMinor: true,
      monthlyMargin: true,
    })
      .extend({ id: platformIdSchema("pricingrecommendation") })
      .strict(),
    decision,
    recommendedPeriodMinor: z.number().int().safe().nonnegative(),
    finalRecurringMinor: z.number().int().safe().nonnegative(),
    finalMonthlyEquivalentMinor: z.number().int().safe().nonnegative(),
    policy: z
      .object({
        id: platformIdSchema("commercialpolicy"),
        version: z.number().int().positive(),
        result: z.literal("requires_empress_approval"),
        reasons: z.array(z.string().min(1).max(2000)).min(1).max(40),
        limits: CommercialPolicyData.innerType()
          .pick({
            minimumMargin: true,
            maximumQueenDiscount: true,
            maximumQueenFixedDiscountMinor: true,
            minimumMonthlyPriceMinor: true,
            allowCustomPrice: true,
            permittedQueenTreatments: true,
          })
          .strict(),
      })
      .strict(),
  })
  .strict();
export const ApprovalPage = z
  .object({
    items: z.array(ApprovalReview).max(100),
    hasMore: z.boolean(),
    limit: z.number().int().min(1).max(100),
    offset: z.number().int().min(0).max(10000),
  })
  .strict();
export const ApprovalSuccess = z
  .object({
    id: platformIdSchema("swarmagreement"),
    workspaceId: platformIdSchema("workspace"),
    status: z.literal("approved"),
    updatedAt: z.string().datetime(),
    policyResult: z.literal("approved_by_empress"),
    empressApproval: z
      .object({
        actor: partnerHumanSchema,
        at: z.string().datetime(),
        reason: z.string().min(1).max(2000),
      })
      .strict(),
  })
  .strict();
