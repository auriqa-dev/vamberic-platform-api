import { z } from 'zod';
/** Immutable unresolved observation; identity is scoped to the Run/Result. */
export declare const KnowledgeGapSchema: z.ZodPipe<z.ZodUnknown, z.ZodObject<{
    id: z.ZodString;
    question: z.ZodString;
    whyRequired: z.ZodString;
    severity: z.ZodEnum<{
        blocking: "blocking";
        non_blocking: "non_blocking";
    }>;
    checked: z.ZodArray<z.ZodString>;
    evidenceIds: z.ZodArray<z.ZodString>;
    findingIds: z.ZodArray<z.ZodString>;
    lineageIds: z.ZodArray<z.ZodString>;
    resolution: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"human_input">;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"research">;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"capability">;
        requiredCapability: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"unresolved">;
    }, z.core.$strict>], "kind">;
    context: z.ZodOptional<z.ZodObject<{
        subject: z.ZodOptional<z.ZodString>;
        scope: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
}, z.core.$strict>>;
export type KnowledgeGap = z.infer<typeof KnowledgeGapSchema>;
