import { z } from 'zod';
import { bounded, LIMITS } from "./json.js";
import { OpaqueIdSchema as id, KeySchema as key, TimestampSchema as time, ExactDecimalSchema as decimal, CurrencySchema, WorkspaceIdSchema, platformId, } from "./primitives.js";
export const CostSchema = z.discriminatedUnion('status', [
    z.strictObject({ status: z.literal('unknown') }),
    z.strictObject({
        status: z.enum(['estimated', 'provider_confirmed']),
        amount: decimal,
        currency: CurrencySchema,
        source: key,
        rateCardVersion: z.string().min(1).max(100).optional(),
    }),
]);
export const UsageObservationSchema = bounded(z
    .strictObject({
    id,
    runId: id,
    attemptId: id,
    workspaceId: WorkspaceIdSchema,
    clientAgentId: platformId('clientagent').optional(),
    invocationId: id,
    category: z.enum(['model', 'tool']),
    provider: key,
    model: key.optional(),
    tool: key.optional(),
    operation: key,
    quantities: z
        .array(z.strictObject({ unit: key, quantity: decimal }))
        .min(1)
        .max(20),
    startedAt: time,
    endedAt: time,
    durationMs: z.number().int().min(0).max(86_400_000),
    cost: CostSchema,
    retryOf: id.optional(),
    supersedes: id.optional(),
})
    .superRefine((v, c) => {
    if (Date.parse(v.endedAt) - Date.parse(v.startedAt) !== v.durationMs)
        c.addIssue({ code: 'custom', message: 'Usage time mismatch' });
    if (v.supersedes === v.id || v.retryOf === v.id)
        c.addIssue({ code: 'custom', message: 'Self-reference' });
    if (new Set(v.quantities.map((q) => q.unit)).size !== v.quantities.length)
        c.addIssue({ code: 'custom', message: 'Duplicate quantity unit' });
    if ((v.category === 'model' && !v.model) ||
        (v.category === 'tool' && !v.tool))
        c.addIssue({ code: 'custom', message: 'Usage classifier missing' });
}), LIMITS.observationBytes);
//# sourceMappingURL=usage.js.map