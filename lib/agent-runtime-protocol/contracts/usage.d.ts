import { z } from 'zod';
export declare const CostSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    status: z.ZodLiteral<"unknown">;
}, z.core.$strict>, z.ZodObject<{
    status: z.ZodEnum<{
        estimated: "estimated";
        provider_confirmed: "provider_confirmed";
    }>;
    amount: z.ZodString;
    currency: z.ZodString;
    source: z.ZodString;
    rateCardVersion: z.ZodOptional<z.ZodString>;
}, z.core.$strict>], "status">;
export declare const UsageObservationSchema: z.ZodPipe<z.ZodUnknown, z.ZodObject<{
    id: z.ZodString;
    runId: z.ZodString;
    attemptId: z.ZodString;
    workspaceId: z.ZodString;
    clientAgentId: z.ZodOptional<z.ZodString>;
    invocationId: z.ZodString;
    category: z.ZodEnum<{
        model: "model";
        tool: "tool";
    }>;
    provider: z.ZodString;
    model: z.ZodOptional<z.ZodString>;
    tool: z.ZodOptional<z.ZodString>;
    operation: z.ZodString;
    quantities: z.ZodArray<z.ZodObject<{
        unit: z.ZodString;
        quantity: z.ZodString;
    }, z.core.$strict>>;
    startedAt: z.ZodISODateTime;
    endedAt: z.ZodISODateTime;
    durationMs: z.ZodNumber;
    cost: z.ZodDiscriminatedUnion<[z.ZodObject<{
        status: z.ZodLiteral<"unknown">;
    }, z.core.$strict>, z.ZodObject<{
        status: z.ZodEnum<{
            estimated: "estimated";
            provider_confirmed: "provider_confirmed";
        }>;
        amount: z.ZodString;
        currency: z.ZodString;
        source: z.ZodString;
        rateCardVersion: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>], "status">;
    retryOf: z.ZodOptional<z.ZodString>;
    supersedes: z.ZodOptional<z.ZodString>;
}, z.core.$strict>>;
export type UsageObservation = z.infer<typeof UsageObservationSchema>;
export type Cost = z.infer<typeof CostSchema>;
