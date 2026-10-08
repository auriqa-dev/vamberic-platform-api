import { z } from "zod";
import { digest } from "@workspace/agent-runtime-protocol";
import { platformIdSchema } from "./schemas";
import { partnerHumanSchema } from "./partners";
import { BILLING_EXEMPTION_SCOPE } from "./workspace-billing";

const revision = z.number().int().positive().safe();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const label = z.string().trim().min(1).max(200);
/** Prospect declarations, not independently verified facts or a retrieval grant.
 * Growth is retained verbatim until a versioned tariff defines its metric/horizon. */
export const ClientOnboardingIntakeSchema = z
  .object({
    organisationName: label,
    websiteUrl: z.string().url().max(2048),
    currentMarketingPlatform: label.optional(),
    currentContactCount: z.number().int().nonnegative().safe().optional(),
    contactCountDescription: z.string().trim().min(1).max(1000).optional(),
    growthExpectation: z.string().trim().min(1).max(1000).optional(),
    otherTools: z.array(label).max(40),
  })
  .strict();
export const ClientOnboardingBindingSchema = z
  .object({
    onboardingId: z.string().regex(/^clientonboarding_[0-9a-hjkmnp-tv-z]{26}$/),
    partnerId: platformIdSchema("partner"),
    intakeRevision: revision,
    intakeDigest: hash,
    quoteRevision: revision,
    quoteDigest: hash,
  })
  .strict();
/** Exemptions remain active until revoked. Legacy expiry is retained only as history.
 * The transactional service still verifies the issuer and exact client binding. */
export const PreclientExemptionSchema = z
  .object({
    version: z.literal(1),
    revision,
    status: z.enum(["active", "revoked"]),
    binding: ClientOnboardingBindingSchema,
    treatment: z.literal("internal"),
    scope: z.literal(BILLING_EXEMPTION_SCOPE),
    reason: z.string().trim().min(1).max(1000),
    approvedBy: partnerHumanSchema,
    approvedAt: z.date(),
    validUntil: z.date().optional(),
  })
  .strict()
  .superRefine((v, c) => {
    if (v.validUntil && v.validUntil <= v.approvedAt)
      c.addIssue({ code: "custom", message: "Invalid approval interval" });
  });
export type ClientOnboardingBinding = z.infer<
  typeof ClientOnboardingBindingSchema
>;
/** Called only after fresh Partner and Empress checks and serialization by the
 * future persistence service. A successful check alone grants no authority. */
export function requireCurrentPreclientExemption(
  raw: unknown,
  expected: ClientOnboardingBinding,
  now: Date,
) {
  const approval = PreclientExemptionSchema.parse(raw);
  const binding = ClientOnboardingBindingSchema.parse(expected);
  z.date().parse(now);
  if (
    approval.status !== "active" ||
    now < approval.approvedAt ||
    digest(approval.binding) !== digest(binding)
  ) {
    throw new Error("Onboarding exemption is not current");
  }
  return approval;
}
/** Reuse the workspace exemption representation; preserve original approver and
 * time. Caller must persist the exact pre-client binding in append-only audit
 * alongside the workspace creation in the same transaction. */
export function preclientWorkspaceExemption(
  raw: unknown,
  binding: ClientOnboardingBinding,
  now: Date,
) {
  const approval = requireCurrentPreclientExemption(raw, binding, now);
  return {
    version: 1 as const,
    revision: 1,
    status: "active" as const,
    treatment: approval.treatment,
    scope: approval.scope,
    reason: approval.reason,
    approvedBy: approval.approvedBy,
    approvedAt: approval.approvedAt,
  };
}

export const OnboardingDetailsSchema = z
  .object({
    intake: ClientOnboardingIntakeSchema,
    workspaceName: label,
    brandName: label,
    brandSlug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/),
  })
  .strict();
export const ExemptProposalSchema = z
  .object({
    version: z.literal(1),
    treatment: z.literal("internal"),
    scope: z.literal(BILLING_EXEMPTION_SCOPE),
    customerChargeMinor: z.literal(0),
    basis: z.literal("empress_exemption_required"),
    externalServicesIncluded: z.literal(false),
  })
  .strict();
export const ProvisionedClientSchema = z
  .object({
    organisationId: platformIdSchema("org"),
    workspaceId: platformIdSchema("workspace"),
    brandId: platformIdSchema("brand"),
    partnerId: platformIdSchema("partner"),
  })
  .strict();
export const ClientOnboardingSchema = z
  .object({
    id: platformIdSchema("clientonboarding"),
    partnerId: platformIdSchema("partner"),
    createScope: hash,
    createDigest: hash,
    revision,
    executionSerial: z.number().int().nonnegative().safe(),
    details: OnboardingDetailsSchema,
    proposal: ExemptProposalSchema,
    binding: ClientOnboardingBindingSchema,
    approval: PreclientExemptionSchema.optional(),
    result: ProvisionedClientSchema.optional(),
    createdBy: partnerHumanSchema,
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();
export type ClientOnboarding = z.infer<typeof ClientOnboardingSchema>;
export const OnboardingRequestSchema = z
  .object({
    requestKey: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/),
    expectedRevision: z.number().int().nonnegative().safe(),
    action: z.enum(["save", "approve", "revoke", "provision"]),
    details: OnboardingDetailsSchema.optional(),
    reason: z.string().trim().min(1).max(1000).optional(),
  })
  .strict()
  .superRefine((v, c) => {
    if (
      (v.action === "save") !== (v.details !== undefined) ||
      ["approve", "revoke"].includes(v.action) !== (v.reason !== undefined)
    )
      c.addIssue({ code: "custom", message: "Fields do not match operation" });
  });
export function onboardingBinding(
  id: string,
  partnerId: string,
  revision: number,
  details: z.infer<typeof OnboardingDetailsSchema>,
) {
  const proposal = ExemptProposalSchema.parse({
    version: 1,
    treatment: "internal",
    scope: BILLING_EXEMPTION_SCOPE,
    customerChargeMinor: 0,
    basis: "empress_exemption_required",
    externalServicesIncluded: false,
  });
  return {
    proposal,
    binding: ClientOnboardingBindingSchema.parse({
      onboardingId: id,
      partnerId,
      intakeRevision: revision,
      intakeDigest: digest(details),
      quoteRevision: revision,
      quoteDigest: digest({ proposal, details }),
    }),
  };
}
