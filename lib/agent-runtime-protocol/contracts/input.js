import { z } from 'zod';
import { bounded, digestWithout, JsonPayloadSchema, LIMITS } from "./json.js";
import { OpaqueIdSchema as id, KeySchema as key, HashSchema as hash, TimestampSchema as time, TextSchema as text, VersionSchema, ImplementationIdentitySchema, } from "./primitives.js";
import { SourceLineageSchema } from "./content.js";
export const CheckpointSchema = bounded(z
    .strictObject({
    id,
    schemaVersion: VersionSchema,
    implementation: ImplementationIdentitySchema,
    runId: id,
    createdAt: time,
    payload: JsonPayloadSchema,
    lineage: z.array(SourceLineageSchema).max(100),
    completedInvocationIds: z.array(id).max(200),
    digest: hash,
})
    .refine((v) => new Set(v.completedInvocationIds).size ===
    v.completedInvocationIds.length, 'Duplicate invocation')
    .refine((v) => digestWithout(v, 'digest') === v.digest, 'Checkpoint digest mismatch'), LIMITS.checkpointBytes);
const base = { key, label: text, required: z.boolean() };
export const InputFieldSchema = z.discriminatedUnion('type', [
    z.strictObject({
        ...base,
        type: z.literal('text'),
        maxLength: z.number().int().min(1).max(4_000),
    }),
    z.strictObject({
        ...base,
        type: z.literal('choice'),
        options: z
            .array(z.strictObject({ value: key, label: text }))
            .min(2)
            .max(20),
    }),
    z.strictObject({ ...base, type: z.literal('boolean') }),
    z.strictObject({
        ...base,
        type: z.literal('number'),
        minimum: z.number().min(-1e9).max(1e9),
        maximum: z.number().min(-1e9).max(1e9),
    }),
]);
export const InputRequestSchema = bounded(z
    .strictObject({
    id,
    schemaKey: key,
    schemaVersion: VersionSchema,
    question: text,
    reason: text,
    fields: z.array(InputFieldSchema).min(1).max(12),
    expiresAt: time,
    checkpoint: z.strictObject({ id, digest: hash }),
})
    .superRefine((v, c) => {
    if (new Set(v.fields.map((f) => f.key)).size !== v.fields.length)
        c.addIssue({ code: 'custom', message: 'Duplicate input field' });
    for (const f of v.fields) {
        if (f.type === 'choice' &&
            new Set(f.options.map((o) => o.value)).size !== f.options.length)
            c.addIssue({ code: 'custom', message: 'Duplicate option' });
        if (f.type === 'number' && f.minimum > f.maximum)
            c.addIssue({ code: 'custom', message: 'Invalid number bounds' });
    }
}), 32_768);
export const InputResponseSchema = bounded(z
    .strictObject({
    requestId: id,
    schemaKey: key,
    schemaVersion: VersionSchema,
    values: z
        .array(z.strictObject({
        key,
        value: z.union([
            z.string().max(4_000),
            z.boolean(),
            z.number().min(-1e9).max(1e9),
        ]),
    }))
        .max(12),
    answeredAt: time,
    actorReference: id,
})
    .refine((v) => new Set(v.values.map((x) => x.key)).size === v.values.length, 'Duplicate response field'), 32_768);
export function validateInputResponse(request, response) {
    InputRequestSchema.parse(request);
    InputResponseSchema.parse(response);
    if (request.id !== response.requestId ||
        request.schemaKey !== response.schemaKey ||
        request.schemaVersion !== response.schemaVersion ||
        response.answeredAt >= request.expiresAt)
        throw new TypeError('Input response identity or expiry');
    if (response.values.some((v) => !request.fields.some((f) => f.key === v.key)))
        throw new TypeError('Unknown response field');
    for (const f of request.fields) {
        const v = response.values.find((v) => v.key === f.key);
        if (!v) {
            if (f.required)
                throw new TypeError('Required response missing');
            continue;
        }
        const value = v.value;
        if ((f.type === 'text' &&
            (typeof value !== 'string' || value.length > f.maxLength)) ||
            (f.type === 'boolean' && typeof value !== 'boolean') ||
            (f.type === 'number' &&
                (typeof value !== 'number' ||
                    value < f.minimum ||
                    value > f.maximum)) ||
            (f.type === 'choice' && !f.options.some((o) => o.value === value)))
            throw new TypeError('Invalid response value');
    }
}
//# sourceMappingURL=input.js.map