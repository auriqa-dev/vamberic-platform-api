import { z } from 'zod';
export declare const CheckpointSchema: z.ZodPipe<z.ZodUnknown, z.ZodObject<{
    id: z.ZodString;
    schemaVersion: z.ZodNumber;
    implementation: z.ZodObject<{
        key: z.ZodString;
        version: z.ZodNumber;
    }, z.core.$strict>;
    runId: z.ZodString;
    createdAt: z.ZodISODateTime;
    payload: z.ZodPipe<z.ZodUnknown, z.ZodJSONSchema>;
    lineage: z.ZodArray<z.ZodPipe<z.ZodUnknown, z.ZodObject<{
        id: z.ZodString;
        role: z.ZodEnum<{
            requested: "requested";
            consumed: "consumed";
            proposal_base: "proposal_base";
        }>;
        purpose: z.ZodString;
        source: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"resource">;
            reference: z.ZodObject<{
                resourceType: z.ZodString;
                id: z.ZodString;
                workspaceId: z.ZodString;
                version: z.ZodOptional<z.ZodNumber>;
                revision: z.ZodOptional<z.ZodNumber>;
                contentHash: z.ZodString;
            }, z.core.$strict>;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"external">;
            url: z.ZodString;
            contentHash: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"artifact">;
            artifactId: z.ZodString;
            contentHash: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"input">;
            requestId: z.ZodString;
            contentHash: z.ZodString;
        }, z.core.$strict>], "kind">;
        observedAt: z.ZodISODateTime;
        fetchedAt: z.ZodISODateTime;
        fields: z.ZodOptional<z.ZodArray<z.ZodString>>;
        snapshotId: z.ZodOptional<z.ZodString>;
        artifactId: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>>;
    completedInvocationIds: z.ZodArray<z.ZodString>;
    digest: z.ZodString;
}, z.core.$strict>>;
export type Checkpoint = z.infer<typeof CheckpointSchema>;
export declare const InputFieldSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    type: z.ZodLiteral<"text">;
    maxLength: z.ZodNumber;
    key: z.ZodString;
    label: z.ZodString;
    required: z.ZodBoolean;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"choice">;
    options: z.ZodArray<z.ZodObject<{
        value: z.ZodString;
        label: z.ZodString;
    }, z.core.$strict>>;
    key: z.ZodString;
    label: z.ZodString;
    required: z.ZodBoolean;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"boolean">;
    key: z.ZodString;
    label: z.ZodString;
    required: z.ZodBoolean;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"number">;
    minimum: z.ZodNumber;
    maximum: z.ZodNumber;
    key: z.ZodString;
    label: z.ZodString;
    required: z.ZodBoolean;
}, z.core.$strict>], "type">;
export declare const InputRequestSchema: z.ZodPipe<z.ZodUnknown, z.ZodObject<{
    id: z.ZodString;
    schemaKey: z.ZodString;
    schemaVersion: z.ZodNumber;
    question: z.ZodString;
    reason: z.ZodString;
    fields: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
        type: z.ZodLiteral<"text">;
        maxLength: z.ZodNumber;
        key: z.ZodString;
        label: z.ZodString;
        required: z.ZodBoolean;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"choice">;
        options: z.ZodArray<z.ZodObject<{
            value: z.ZodString;
            label: z.ZodString;
        }, z.core.$strict>>;
        key: z.ZodString;
        label: z.ZodString;
        required: z.ZodBoolean;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"boolean">;
        key: z.ZodString;
        label: z.ZodString;
        required: z.ZodBoolean;
    }, z.core.$strict>, z.ZodObject<{
        type: z.ZodLiteral<"number">;
        minimum: z.ZodNumber;
        maximum: z.ZodNumber;
        key: z.ZodString;
        label: z.ZodString;
        required: z.ZodBoolean;
    }, z.core.$strict>], "type">>;
    expiresAt: z.ZodISODateTime;
    checkpoint: z.ZodObject<{
        id: z.ZodString;
        digest: z.ZodString;
    }, z.core.$strict>;
}, z.core.$strict>>;
export declare const InputResponseSchema: z.ZodPipe<z.ZodUnknown, z.ZodObject<{
    requestId: z.ZodString;
    schemaKey: z.ZodString;
    schemaVersion: z.ZodNumber;
    values: z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        value: z.ZodUnion<readonly [z.ZodString, z.ZodBoolean, z.ZodNumber]>;
    }, z.core.$strict>>;
    answeredAt: z.ZodISODateTime;
    actorReference: z.ZodString;
}, z.core.$strict>>;
export type InputRequest = z.infer<typeof InputRequestSchema>;
export type InputResponse = z.infer<typeof InputResponseSchema>;
export declare function validateInputResponse(request: InputRequest, response: InputResponse): void;
