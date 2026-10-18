import { z } from 'zod';
export const ERROR_CODES = [
    'invalid_work',
    'unauthorized_or_revoked',
    'configuration_error',
    'provider_transient',
    'provider_rate_limited',
    'model_output_invalid',
    'tool_failure',
    'implementation_failure',
    'timeout',
    'cancelled',
    'budget_exhausted',
];
export const SafeErrorSchema = z
    .strictObject({
    code: z.enum(ERROR_CODES),
    message: z.string().min(1).max(200),
    retryable: z.boolean(),
    retryAfterMs: z.number().int().min(0).max(3_600_000).optional(),
    details: z
        .strictObject({
        phase: z
            .enum([
            'validation',
            'context',
            'model',
            'tool',
            'execution',
            'output',
        ])
            .optional(),
    })
        .optional(),
})
    .refine((v) => !v.retryable ||
    [
        'provider_transient',
        'provider_rate_limited',
        'timeout',
        'tool_failure',
    ].includes(v.code), 'Non-retryable error class');
//# sourceMappingURL=errors.js.map