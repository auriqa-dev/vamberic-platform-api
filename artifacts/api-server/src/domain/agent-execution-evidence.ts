import { z } from "zod";
import { SlotBindingSchema } from "./agent-capacity";
const id = z.string().min(1).max(256);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const ProviderInvocationSchema = z
  .object({
    provider: z.literal("openai"),
    model: z.enum(["gpt-6.1-sol", "gpt-6-astra"]),
    role: z.enum(["maker", "evaluator", "revision"]),
    projectReference: z
      .string()
      .regex(/^proj_[A-Za-z0-9_-]+$/)
      .max(256),
    transportVersion: z.literal("psu_execution_evidence_v1"),
    requestDigest: hash,
  })
  .strict();
export const PrepareInvocationSchema = z
  .object({ binding: SlotBindingSchema, provider: ProviderInvocationSchema })
  .strict();
export const ReceiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    journalId: id,
    binding: SlotBindingSchema,
    correlationId: id,
    requestDigest: hash,
    terminalContract: id,
    status: z.enum(["completed", "failed", "incomplete", "rejected"]),
    source: z.literal("trusted_worker_transport"),
    providerRequestId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,256}$/)
      .optional(),
    providerResponseId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,256}$/)
      .optional(),
    quantities: z
      .array(
        z
          .object({
            unit: z.enum([
              "calls",
              "input_tokens",
              "output_tokens",
              "cached_input_tokens",
              "reasoning_tokens",
            ]),
            quantity: z.number().int().min(0).max(1000000),
          })
          .strict(),
      )
      .max(20),
    cost: z
      .object({
        status: z.literal("estimated"),
        currency: z.literal("USD"),
        amount: z
          .string()
          .regex(/^[0-9]+(?:\.[0-9]{1,8})?$/)
          .max(32),
        source: z.literal("openai_published_conservative"),
        rateCardVersion: z.literal("2026-10-02_standard_cache_write_upper"),
      })
      .strict()
      .optional(),
    measuredInterval: z
      .object({
        startedAt: z.string().datetime(),
        endedAt: z.string().datetime(),
      })
      .strict()
      .optional(),
  })
  .strict();
export const InvocationJournalSchema = z
  .object({
    id,
    schemaVersion: z.literal(1),
    policy: z.literal("psu_execution_evidence_v1"),
    binding: SlotBindingSchema,
    provider: ProviderInvocationSchema,
    correlationId: id,
    preparedAt: z.date(),
    revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    state: z.enum(["prepared", "possibly_sent", "terminal", "no_send"]),
    permissionId: id.optional(),
    permissionAt: z.date().optional(),
    receipt: ReceiptSchema.optional(),
    receiptDigest: hash.optional(),
    receivedAt: z.date().optional(),
    conflictDigest: hash.optional(),
    financialReconciliationPending: z.boolean(),
  })
  .strict();
export const ExecutionControlSchema = z
  .object({
    id: z.literal("dev:agent_runtime"),
    revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    state: z.enum(["open", "integrity_hold"]),
    conflictJournalId: id.optional(),
  })
  .strict();
export type InvocationJournal = z.infer<typeof InvocationJournalSchema>;
export type ExecutionReceipt = z.infer<typeof ReceiptSchema>;
export function validateReceipt(input: unknown): ExecutionReceipt {
  const receipt = ReceiptSchema.parse(input);
  if (
    Buffer.byteLength(JSON.stringify(receipt)) > 16384 ||
    new Set(receipt.quantities.map((q) => q.unit)).size !==
      receipt.quantities.length
  )
    throw new Error("Invalid execution evidence");
  const q = Object.fromEntries(
    receipt.quantities.map((q) => [q.unit, q.quantity]),
  );
  if (
    (q.calls !== undefined && q.calls !== 1) ||
    (q.cached_input_tokens ?? 0) > (q.input_tokens ?? 0) ||
    (q.reasoning_tokens ?? 0) > (q.output_tokens ?? 0)
  )
    throw new Error("Invalid evidence quantities");
  if (
    receipt.measuredInterval &&
    Date.parse(receipt.measuredInterval.endedAt) <
      Date.parse(receipt.measuredInterval.startedAt)
  )
    throw new Error("Invalid evidence interval");
  return receipt;
}
