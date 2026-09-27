import { z } from "zod";

export const BILLING_TREATMENTS = [
  "standard",
  "bundled",
  "waived",
  "internal",
  "promotional",
] as const;
export const billingTreatmentSchema = z.enum(BILLING_TREATMENTS);
