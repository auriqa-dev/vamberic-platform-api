import { z } from "zod";
const partnerHumanSchema = z
  .object({
    type: z.literal("human"),
    issuer: z
      .string()
      .url()
      .max(500)
      .regex(/^https?:\/\/[^\s]+$/),
    id: z
      .string()
      .trim()
      .min(1)
      .max(300)
      .refine((id) => !id.startsWith("partner_")),
  })
  .strict();
export const BILLING_EXEMPTION_SCOPE = "hvm_platform_and_agent_services";
const common = {
  version: z.literal(1),
  revision: z.number().int().positive().safe(),
  treatment: z.literal("internal"),
  scope: z.literal(BILLING_EXEMPTION_SCOPE),
  reason: z.string().trim().min(1).max(1000),
  approvedBy: partnerHumanSchema,
  approvedAt: z.date(),
};
export const WorkspaceBillingExemptionSchema = z
  .discriminatedUnion("status", [
    z.object({ ...common, status: z.literal("active") }).strict(),
    z
      .object({
        ...common,
        status: z.literal("revoked"),
        revokedBy: partnerHumanSchema,
        revokedAt: z.date(),
        revocationReason: z.string().trim().min(1).max(1000),
      })
      .strict(),
  ])
  .superRefine((v, c) => {
    if (v.status === "revoked" && v.revokedAt < v.approvedAt)
      c.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Revocation precedes approval",
      });
  });
/** This decision does not confer access or rewrite an immutable agreement.
 * Invoice consumers must resolve it at billing time, preserving gross costs. */
export function effectiveWorkspaceBilling(raw: unknown, amountMinor: number) {
  z.number().int().nonnegative().safe().parse(amountMinor);
  const exemption =
    raw === undefined ? undefined : WorkspaceBillingExemptionSchema.parse(raw);
  return {
    treatment:
      exemption?.status === "active"
        ? ("internal" as const)
        : ("existing_terms" as const),
    scope: BILLING_EXEMPTION_SCOPE,
    exemptionRevision: exemption?.revision ?? null,
    grossAmountMinor: amountMinor,
    billedAmountMinor: exemption?.status === "active" ? 0 : amountMinor,
    providerCostsRetained: true,
    directThirdPartyChargesExcluded: true,
    executionAuthority: false,
  };
}
