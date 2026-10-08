import { z } from 'zod';
import type { ClaimedWork } from './work.ts';
/** Integrity is not a signature. Only the authenticated Platform workload
 * response may supply this object; models, tools and callers cannot author it. */
export declare const AnswerProvenanceSchema: z.ZodPipe<z.ZodUnknown, z.ZodObject<{
    kind: z.ZodLiteral<"platform_answer_provenance">;
    schemaVersion: z.ZodLiteral<1>;
    submissionId: z.ZodString;
    workspaceId: z.ZodString;
    runId: z.ZodString;
    operation: z.ZodString;
    action: z.ZodLiteral<"respond">;
    requestId: z.ZodString;
    requestDigest: z.ZodString;
    checkpoint: z.ZodObject<{
        id: z.ZodString;
        digest: z.ZodString;
    }, z.core.$strict>;
    submissionGeneration: z.ZodNumber;
    resumeGeneration: z.ZodNumber;
    responseDigest: z.ZodString;
    actor: z.ZodObject<{
        type: z.ZodLiteral<"human">;
        issuer: z.ZodString;
        id: z.ZodString;
    }, z.core.$strict>;
    capacity: z.ZodEnum<{
        partner: "partner";
        client: "client";
    }>;
    submittedAt: z.ZodISODateTime;
    digest: z.ZodString;
}, z.core.$strict>>;
export type AnswerProvenance = z.infer<typeof AnswerProvenanceSchema>;
export declare function answerSubmissionId(v: {
    workspaceId: string;
    runId: string;
    requestId: string;
    responseDigest: string;
}): string;
export declare function validateAnswerProvenance(value: unknown, work: Pick<ClaimedWork, 'protocolVersion' | 'workspaceId' | 'runId' | 'operation' | 'generation' | 'resume'>): AnswerProvenance;
