import { z } from 'zod';
export declare const ERROR_CODES: readonly ["invalid_work", "unauthorized_or_revoked", "configuration_error", "provider_transient", "provider_rate_limited", "model_output_invalid", "tool_failure", "implementation_failure", "timeout", "cancelled", "budget_exhausted"];
export declare const SafeErrorSchema: z.ZodObject<{
    code: z.ZodEnum<{
        invalid_work: "invalid_work";
        unauthorized_or_revoked: "unauthorized_or_revoked";
        configuration_error: "configuration_error";
        provider_transient: "provider_transient";
        provider_rate_limited: "provider_rate_limited";
        model_output_invalid: "model_output_invalid";
        tool_failure: "tool_failure";
        implementation_failure: "implementation_failure";
        timeout: "timeout";
        cancelled: "cancelled";
        budget_exhausted: "budget_exhausted";
    }>;
    message: z.ZodString;
    retryable: z.ZodBoolean;
    retryAfterMs: z.ZodOptional<z.ZodNumber>;
    details: z.ZodOptional<z.ZodObject<{
        phase: z.ZodOptional<z.ZodEnum<{
            output: "output";
            context: "context";
            model: "model";
            validation: "validation";
            tool: "tool";
            execution: "execution";
        }>>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type SafeError = z.infer<typeof SafeErrorSchema>;
