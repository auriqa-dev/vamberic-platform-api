import { z } from "zod";
import { platformIdSchema } from "./schemas";
import { decimalUnits } from "./agent-budget";
const key = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const serial = z.number().int().safe().nonnegative();
const amount = z.string().regex(/^(0|[1-9][0-9]{0,14})(\.[0-9]{1,12})?$/);
const version = z.number().int().safe().positive();
export const BudgetMeasureSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("quantity"), unit: key }).strict(),
  z
    .object({
      kind: z.literal("money"),
      currency: z.string().regex(/^[A-Z]{3}$/),
    })
    .strict(),
]);
export const BudgetScopeSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("configuration"),
      configurationId: platformIdSchema("clientagent"),
      binding: key,
    })
    .strict(),
  z
    .object({
      kind: z.literal("account"),
      integrationId: platformIdSchema("integration"),
      verifiedAccountDigest: digest,
    })
    .strict(),
]);
export const ExecutionBudgetPolicySchema = z
  .object({
    id: platformIdSchema("budgetpolicy"),
    workspaceId: platformIdSchema("workspace"),
    version,
    scope: BudgetScopeSchema,
    measure: BudgetMeasureSchema,
    operations: z.array(key).min(1).max(20),
    limit: amount,
    effectiveFrom: z.date(),
    effectiveUntil: z.date(),
    createdAt: z.date(),
    sourceEventId: platformIdSchema("event"),
  })
  .strict()
  .superRefine((v, c) => {
    if (
      v.effectiveUntil <= v.effectiveFrom ||
      new Set(v.operations).size !== v.operations.length ||
      (v.measure.kind === "quantity" &&
        (!/^\d+$/.test(v.limit) ||
          BigInt(v.limit) > BigInt(Number.MAX_SAFE_INTEGER)))
    )
      c.addIssue({ code: "custom", message: "Invalid budget policy" });
  });
export const ExecutionBudgetWindowSchema = z
  .object({
    id: platformIdSchema("budgetwindow"),
    workspaceId: platformIdSchema("workspace"),
    policyId: platformIdSchema("budgetpolicy"),
    policyVersion: version,
    start: z.date(),
    end: z.date(),
    reserved: amount,
    consumed: amount,
    executionSerial: serial,
    blocked: z.boolean(),
  })
  .strict()
  .refine((v) => v.end > v.start, "Invalid budget interval");
export const BudgetOperationSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
    workspaceId: platformIdSchema("workspace"),
    runId: platformIdSchema("agentrun"),
    attemptId: platformIdSchema("agentattempt"),
    fence: version,
    configurationId: platformIdSchema("clientagent"),
    configurationRevision: version,
    binding: key,
    integrationId: platformIdSchema("integration"),
    integrationSerial: serial,
    operation: key,
    payloadDigest: digest,
    expiresAt: z.date(),
  })
  .strict();
export const ExecutionBudgetReservationSchema = z
  .object({
    id: platformIdSchema("budgetreservation"),
    workspaceId: platformIdSchema("workspace"),
    logicalOperation: BudgetOperationSchema,
    allocations: z
      .array(
        z
          .object({ windowId: platformIdSchema("budgetwindow"), amount })
          .strict(),
      )
      .min(1)
      .max(20),
    state: z.enum(["reserved", "unknown", "settled"]),
    settlement: z
      .object({ receiptId: digest, amounts: z.array(amount).min(1).max(20) })
      .strict()
      .optional(),
    executionSerial: serial,
  })
  .strict()
  .superRefine((v, c) => {
    if (
      v.workspaceId !== v.logicalOperation.workspaceId ||
      new Set(v.allocations.map((a) => a.windowId)).size !==
        v.allocations.length ||
      (v.state === "settled") !== Boolean(v.settlement) ||
      (v.settlement && v.settlement.amounts.length !== v.allocations.length)
    )
      c.addIssue({ code: "custom", message: "Invalid reservation binding" });
  });
export type BudgetPolicy = z.infer<typeof ExecutionBudgetPolicySchema>;
export type BudgetWindow = z.infer<typeof ExecutionBudgetWindowSchema>;
export type BudgetOperation = z.infer<typeof BudgetOperationSchema>;
export type BudgetReservation = z.infer<
  typeof ExecutionBudgetReservationSchema
>;
export function validateBudgetAmount(policy: BudgetPolicy, value: string) {
  amount.parse(value);
  if (
    policy.measure.kind === "quantity" &&
    (!/^\d+$/.test(value) || BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER))
  )
    throw new Error("Invalid quantity");
  return decimalUnits(value);
}
/** No human budget-management endpoints or permission grants exist in this foundation. */
export const HUMAN_BUDGET_ADMINISTRATION = false as const;
