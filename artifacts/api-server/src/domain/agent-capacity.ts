import { z } from "zod";
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().min(1).max(256);
export const CapacityReleaseSchema = z
  .object({
    environment: z.literal("dev"),
    workloadClass: z.literal("agent_runtime"),
    workloadClientId: id,
    manifestDigest: digest,
    buildDigest: digest,
    policyDigest: digest,
    serviceArn: id,
    taskDefinitionArn: id,
    imageDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  })
  .strict();
export const CapacityObservationSchema = z
  .object({
    id,
    release: CapacityReleaseSchema,
    workerId: z.string().regex(/^worker:[a-f0-9-]{36}$/),
    taskArn: id,
    roles: z.array(z.enum(["maker", "evaluator", "revision"])).length(3),
    ready: z.boolean(),
    reportedAt: z.date(),
    observedAt: z.date().optional(),
    deploymentMatches: z.boolean(),
    revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
export const SlotBindingSchema = z
  .object({
    runId: id,
    attemptId: id,
    workspaceId: id,
    generation: z.number().int().positive(),
    fence: z.number().int().positive(),
    leaseId: id,
    workloadClientId: id,
    workerId: id,
    invocationId: id,
    release: CapacityReleaseSchema,
  })
  .strict();
export const ExecutionSlotSchema = z
  .object({
    id: z.literal("dev:agent_runtime"),
    state: z.enum(["occupied", "quarantined", "released"]),
    binding: SlotBindingSchema,
    revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    updatedAt: z.date(),
  })
  .strict();
export type CapacityRelease = z.infer<typeof CapacityReleaseSchema>;
export type CapacityObservation = z.infer<typeof CapacityObservationSchema>;
export type SlotBinding = z.infer<typeof SlotBindingSchema>;
export type ExecutionSlot = z.infer<typeof ExecutionSlotSchema>;
/** Platform receipt times only; readiness never grants resource authority. */
export function capacityFresh(row: CapacityObservation, now: Date): boolean {
  const fresh = (time: Date | undefined) =>
    !!time && time <= now && now.getTime() - time.getTime() < 30_000;
  return (
    row.ready &&
    row.deploymentMatches &&
    new Set(row.roles).size === 3 &&
    fresh(row.reportedAt) &&
    fresh(row.observedAt)
  );
}
