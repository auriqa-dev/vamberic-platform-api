import { z } from 'zod';
export declare const WORKSPACE_PROTOCOL_VERSION: "2.0";
export declare const WorkspaceAgentTargetSchema: z.ZodObject<{
    kind: z.ZodLiteral<"workspace_agent">;
    workspaceId: z.ZodString;
    definition: z.ZodObject<{
        id: z.ZodString;
        key: z.ZodString;
        version: z.ZodNumber;
    }, z.core.$strict>;
    implementation: z.ZodObject<{
        key: z.ZodString;
        version: z.ZodNumber;
        manifestDigest: z.ZodString;
        buildDigest: z.ZodString;
    }, z.core.$strict>;
}, z.core.$strict>;
export type WorkspaceAgentTarget = z.infer<typeof WorkspaceAgentTargetSchema>;
export declare const ClaimedWorkV2Schema: z.ZodPipe<z.ZodUnknown, z.ZodObject<{
    protocolVersion: z.ZodLiteral<"2.0">;
    runId: z.ZodString;
    attemptId: z.ZodString;
    generation: z.ZodNumber;
    fence: z.ZodNumber;
    lease: z.ZodObject<{
        id: z.ZodString;
        workerId: z.ZodString;
        expiresAt: z.ZodISODateTime;
    }, z.core.$strict>;
    workspaceId: z.ZodString;
    clientId: z.ZodString;
    operation: z.ZodString;
    definition: z.ZodObject<{
        id: z.ZodString;
        key: z.ZodString;
        version: z.ZodNumber;
    }, z.core.$strict>;
    implementation: z.ZodObject<{
        key: z.ZodString;
        version: z.ZodNumber;
        manifestDigest: z.ZodString;
        buildDigest: z.ZodString;
    }, z.core.$strict>;
    executionTarget: z.ZodObject<{
        kind: z.ZodLiteral<"workspace_agent">;
        workspaceId: z.ZodString;
        definition: z.ZodObject<{
            id: z.ZodString;
            key: z.ZodString;
            version: z.ZodNumber;
        }, z.core.$strict>;
        implementation: z.ZodObject<{
            key: z.ZodString;
            version: z.ZodNumber;
            manifestDigest: z.ZodString;
            buildDigest: z.ZodString;
        }, z.core.$strict>;
    }, z.core.$strict>;
    configuration: z.ZodPipe<z.ZodUnknown, z.ZodJSONSchema>;
    configurationOverlay: z.ZodOptional<z.ZodObject<{
        id: z.ZodString;
        revision: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>>;
    context: z.ZodObject<{
        references: z.ZodArray<z.ZodObject<{
            reference: z.ZodObject<{
                resourceType: z.ZodString;
                id: z.ZodString;
                workspaceId: z.ZodString;
                version: z.ZodOptional<z.ZodNumber>;
                revision: z.ZodOptional<z.ZodNumber>;
                contentHash: z.ZodString;
            }, z.core.$strict>;
            fields: z.ZodArray<z.ZodString>;
        }, z.core.$strict>>;
        snapshots: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            reference: z.ZodObject<{
                resourceType: z.ZodString;
                id: z.ZodString;
                workspaceId: z.ZodString;
                version: z.ZodOptional<z.ZodNumber>;
                revision: z.ZodOptional<z.ZodNumber>;
                contentHash: z.ZodString;
            }, z.core.$strict>;
            fields: z.ZodArray<z.ZodString>;
            payload: z.ZodPipe<z.ZodUnknown, z.ZodJSONSchema>;
            payloadDigest: z.ZodString;
        }, z.core.$strict>>;
    }, z.core.$strict>;
    input: z.ZodPipe<z.ZodUnknown, z.ZodJSONSchema>;
    resume: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"input">;
        checkpoint: z.ZodPipe<z.ZodUnknown, z.ZodObject<{
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
        request: z.ZodPipe<z.ZodUnknown, z.ZodObject<{
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
        response: z.ZodPipe<z.ZodUnknown, z.ZodObject<{
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
        answerProvenance: z.ZodOptional<z.ZodPipe<z.ZodUnknown, z.ZodObject<{
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
        }, z.core.$strict>>>;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"continuation">;
        checkpoint: z.ZodPipe<z.ZodUnknown, z.ZodObject<{
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
    }, z.core.$strict>], "kind">>;
    resultSchemaVersion: z.ZodLiteral<2>;
    checkpointSchemaVersion: z.ZodNumber;
    grant: z.ZodPipe<z.ZodUnknown, z.ZodObject<{
        id: z.ZodString;
        version: z.ZodNumber;
        runId: z.ZodString;
        workspaceId: z.ZodString;
        expiresAt: z.ZodISODateTime;
        resources: z.ZodArray<z.ZodObject<{
            reference: z.ZodObject<{
                resourceType: z.ZodString;
                id: z.ZodString;
                workspaceId: z.ZodString;
                version: z.ZodOptional<z.ZodNumber>;
                revision: z.ZodOptional<z.ZodNumber>;
                contentHash: z.ZodString;
            }, z.core.$strict>;
            fields: z.ZodArray<z.ZodString>;
        }, z.core.$strict>>;
        proposalTargets: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"update">;
            targetKind: z.ZodString;
            reference: z.ZodObject<{
                resourceType: z.ZodString;
                id: z.ZodString;
                workspaceId: z.ZodString;
                version: z.ZodOptional<z.ZodNumber>;
                revision: z.ZodOptional<z.ZodNumber>;
                contentHash: z.ZodString;
            }, z.core.$strict>;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"create">;
            targetKind: z.ZodString;
            parents: z.ZodArray<z.ZodObject<{
                relationship: z.ZodString;
                reference: z.ZodObject<{
                    resourceType: z.ZodString;
                    id: z.ZodString;
                    workspaceId: z.ZodString;
                    version: z.ZodOptional<z.ZodNumber>;
                    revision: z.ZodOptional<z.ZodNumber>;
                    contentHash: z.ZodString;
                }, z.core.$strict>;
            }, z.core.$strict>>;
        }, z.core.$strict>], "kind">>;
        tools: z.ZodArray<z.ZodObject<{
            key: z.ZodString;
            version: z.ZodNumber;
            operation: z.ZodString;
            class: z.ZodEnum<{
                read_only: "read_only";
                cost_incurring_read: "cost_incurring_read";
                external_mutation: "external_mutation";
            }>;
            provider: z.ZodString;
            bindingId: z.ZodOptional<z.ZodString>;
            authorizedOperationId: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
        bindings: z.ZodArray<z.ZodString>;
        models: z.ZodArray<z.ZodObject<{
            provider: z.ZodString;
            model: z.ZodString;
            purpose: z.ZodString;
        }, z.core.$strict>>;
        budgets: z.ZodObject<{
            deadline: z.ZodISODateTime;
            modelCalls: z.ZodNumber;
            toolCalls: z.ZodNumber;
            providerCalls: z.ZodArray<z.ZodObject<{
                provider: z.ZodString;
                calls: z.ZodNumber;
            }, z.core.$strict>>;
            cost: z.ZodObject<{
                currency: z.ZodString;
                amount: z.ZodString;
            }, z.core.$strict>;
        }, z.core.$strict>;
    }, z.core.$strict>>;
    traceId: z.ZodString;
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
}, z.core.$strict>>;
export declare const RuntimeClaimedWorkSchema: z.ZodUnion<readonly [z.ZodPipe<z.ZodUnknown, z.ZodObject<{
    protocolVersion: z.ZodEnum<{
        1.2: "1.2";
        1.1: "1.1";
    }>;
    runId: z.ZodString;
    attemptId: z.ZodString;
    generation: z.ZodNumber;
    fence: z.ZodNumber;
    lease: z.ZodObject<{
        id: z.ZodString;
        workerId: z.ZodString;
        expiresAt: z.ZodISODateTime;
    }, z.core.$strict>;
    workspaceId: z.ZodString;
    clientId: z.ZodString;
    operation: z.ZodString;
    definition: z.ZodObject<{
        id: z.ZodString;
        key: z.ZodString;
        version: z.ZodNumber;
    }, z.core.$strict>;
    implementation: z.ZodObject<{
        key: z.ZodString;
        version: z.ZodNumber;
        manifestDigest: z.ZodString;
        buildDigest: z.ZodString;
    }, z.core.$strict>;
    clientAgent: z.ZodObject<{
        id: z.ZodString;
        revision: z.ZodNumber;
        configuration: z.ZodPipe<z.ZodUnknown, z.ZodJSONSchema>;
    }, z.core.$strict>;
    clientSwarm: z.ZodOptional<z.ZodObject<{
        id: z.ZodString;
        revision: z.ZodNumber;
    }, z.core.$strict>>;
    context: z.ZodObject<{
        references: z.ZodArray<z.ZodObject<{
            reference: z.ZodObject<{
                resourceType: z.ZodString;
                id: z.ZodString;
                workspaceId: z.ZodString;
                version: z.ZodOptional<z.ZodNumber>;
                revision: z.ZodOptional<z.ZodNumber>;
                contentHash: z.ZodString;
            }, z.core.$strict>;
            fields: z.ZodArray<z.ZodString>;
        }, z.core.$strict>>;
        snapshots: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            reference: z.ZodObject<{
                resourceType: z.ZodString;
                id: z.ZodString;
                workspaceId: z.ZodString;
                version: z.ZodOptional<z.ZodNumber>;
                revision: z.ZodOptional<z.ZodNumber>;
                contentHash: z.ZodString;
            }, z.core.$strict>;
            fields: z.ZodArray<z.ZodString>;
            payload: z.ZodPipe<z.ZodUnknown, z.ZodJSONSchema>;
            payloadDigest: z.ZodString;
        }, z.core.$strict>>;
    }, z.core.$strict>;
    input: z.ZodPipe<z.ZodUnknown, z.ZodJSONSchema>;
    resume: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"input">;
        checkpoint: z.ZodPipe<z.ZodUnknown, z.ZodObject<{
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
        request: z.ZodPipe<z.ZodUnknown, z.ZodObject<{
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
        response: z.ZodPipe<z.ZodUnknown, z.ZodObject<{
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
        answerProvenance: z.ZodOptional<z.ZodPipe<z.ZodUnknown, z.ZodObject<{
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
        }, z.core.$strict>>>;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"continuation">;
        checkpoint: z.ZodPipe<z.ZodUnknown, z.ZodObject<{
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
    }, z.core.$strict>], "kind">>;
    resultSchemaVersion: z.ZodLiteral<2>;
    checkpointSchemaVersion: z.ZodNumber;
    grant: z.ZodPipe<z.ZodUnknown, z.ZodObject<{
        id: z.ZodString;
        version: z.ZodNumber;
        runId: z.ZodString;
        workspaceId: z.ZodString;
        expiresAt: z.ZodISODateTime;
        resources: z.ZodArray<z.ZodObject<{
            reference: z.ZodObject<{
                resourceType: z.ZodString;
                id: z.ZodString;
                workspaceId: z.ZodString;
                version: z.ZodOptional<z.ZodNumber>;
                revision: z.ZodOptional<z.ZodNumber>;
                contentHash: z.ZodString;
            }, z.core.$strict>;
            fields: z.ZodArray<z.ZodString>;
        }, z.core.$strict>>;
        proposalTargets: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"update">;
            targetKind: z.ZodString;
            reference: z.ZodObject<{
                resourceType: z.ZodString;
                id: z.ZodString;
                workspaceId: z.ZodString;
                version: z.ZodOptional<z.ZodNumber>;
                revision: z.ZodOptional<z.ZodNumber>;
                contentHash: z.ZodString;
            }, z.core.$strict>;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"create">;
            targetKind: z.ZodString;
            parents: z.ZodArray<z.ZodObject<{
                relationship: z.ZodString;
                reference: z.ZodObject<{
                    resourceType: z.ZodString;
                    id: z.ZodString;
                    workspaceId: z.ZodString;
                    version: z.ZodOptional<z.ZodNumber>;
                    revision: z.ZodOptional<z.ZodNumber>;
                    contentHash: z.ZodString;
                }, z.core.$strict>;
            }, z.core.$strict>>;
        }, z.core.$strict>], "kind">>;
        tools: z.ZodArray<z.ZodObject<{
            key: z.ZodString;
            version: z.ZodNumber;
            operation: z.ZodString;
            class: z.ZodEnum<{
                read_only: "read_only";
                cost_incurring_read: "cost_incurring_read";
                external_mutation: "external_mutation";
            }>;
            provider: z.ZodString;
            bindingId: z.ZodOptional<z.ZodString>;
            authorizedOperationId: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
        bindings: z.ZodArray<z.ZodString>;
        models: z.ZodArray<z.ZodObject<{
            provider: z.ZodString;
            model: z.ZodString;
            purpose: z.ZodString;
        }, z.core.$strict>>;
        budgets: z.ZodObject<{
            deadline: z.ZodISODateTime;
            modelCalls: z.ZodNumber;
            toolCalls: z.ZodNumber;
            providerCalls: z.ZodArray<z.ZodObject<{
                provider: z.ZodString;
                calls: z.ZodNumber;
            }, z.core.$strict>>;
            cost: z.ZodObject<{
                currency: z.ZodString;
                amount: z.ZodString;
            }, z.core.$strict>;
        }, z.core.$strict>;
    }, z.core.$strict>>;
    traceId: z.ZodString;
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
}, z.core.$strict>>, z.ZodPipe<z.ZodUnknown, z.ZodObject<{
    protocolVersion: z.ZodLiteral<"2.0">;
    runId: z.ZodString;
    attemptId: z.ZodString;
    generation: z.ZodNumber;
    fence: z.ZodNumber;
    lease: z.ZodObject<{
        id: z.ZodString;
        workerId: z.ZodString;
        expiresAt: z.ZodISODateTime;
    }, z.core.$strict>;
    workspaceId: z.ZodString;
    clientId: z.ZodString;
    operation: z.ZodString;
    definition: z.ZodObject<{
        id: z.ZodString;
        key: z.ZodString;
        version: z.ZodNumber;
    }, z.core.$strict>;
    implementation: z.ZodObject<{
        key: z.ZodString;
        version: z.ZodNumber;
        manifestDigest: z.ZodString;
        buildDigest: z.ZodString;
    }, z.core.$strict>;
    executionTarget: z.ZodObject<{
        kind: z.ZodLiteral<"workspace_agent">;
        workspaceId: z.ZodString;
        definition: z.ZodObject<{
            id: z.ZodString;
            key: z.ZodString;
            version: z.ZodNumber;
        }, z.core.$strict>;
        implementation: z.ZodObject<{
            key: z.ZodString;
            version: z.ZodNumber;
            manifestDigest: z.ZodString;
            buildDigest: z.ZodString;
        }, z.core.$strict>;
    }, z.core.$strict>;
    configuration: z.ZodPipe<z.ZodUnknown, z.ZodJSONSchema>;
    configurationOverlay: z.ZodOptional<z.ZodObject<{
        id: z.ZodString;
        revision: z.ZodNumber;
        contentHash: z.ZodString;
    }, z.core.$strict>>;
    context: z.ZodObject<{
        references: z.ZodArray<z.ZodObject<{
            reference: z.ZodObject<{
                resourceType: z.ZodString;
                id: z.ZodString;
                workspaceId: z.ZodString;
                version: z.ZodOptional<z.ZodNumber>;
                revision: z.ZodOptional<z.ZodNumber>;
                contentHash: z.ZodString;
            }, z.core.$strict>;
            fields: z.ZodArray<z.ZodString>;
        }, z.core.$strict>>;
        snapshots: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            reference: z.ZodObject<{
                resourceType: z.ZodString;
                id: z.ZodString;
                workspaceId: z.ZodString;
                version: z.ZodOptional<z.ZodNumber>;
                revision: z.ZodOptional<z.ZodNumber>;
                contentHash: z.ZodString;
            }, z.core.$strict>;
            fields: z.ZodArray<z.ZodString>;
            payload: z.ZodPipe<z.ZodUnknown, z.ZodJSONSchema>;
            payloadDigest: z.ZodString;
        }, z.core.$strict>>;
    }, z.core.$strict>;
    input: z.ZodPipe<z.ZodUnknown, z.ZodJSONSchema>;
    resume: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"input">;
        checkpoint: z.ZodPipe<z.ZodUnknown, z.ZodObject<{
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
        request: z.ZodPipe<z.ZodUnknown, z.ZodObject<{
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
        response: z.ZodPipe<z.ZodUnknown, z.ZodObject<{
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
        answerProvenance: z.ZodOptional<z.ZodPipe<z.ZodUnknown, z.ZodObject<{
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
        }, z.core.$strict>>>;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"continuation">;
        checkpoint: z.ZodPipe<z.ZodUnknown, z.ZodObject<{
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
    }, z.core.$strict>], "kind">>;
    resultSchemaVersion: z.ZodLiteral<2>;
    checkpointSchemaVersion: z.ZodNumber;
    grant: z.ZodPipe<z.ZodUnknown, z.ZodObject<{
        id: z.ZodString;
        version: z.ZodNumber;
        runId: z.ZodString;
        workspaceId: z.ZodString;
        expiresAt: z.ZodISODateTime;
        resources: z.ZodArray<z.ZodObject<{
            reference: z.ZodObject<{
                resourceType: z.ZodString;
                id: z.ZodString;
                workspaceId: z.ZodString;
                version: z.ZodOptional<z.ZodNumber>;
                revision: z.ZodOptional<z.ZodNumber>;
                contentHash: z.ZodString;
            }, z.core.$strict>;
            fields: z.ZodArray<z.ZodString>;
        }, z.core.$strict>>;
        proposalTargets: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"update">;
            targetKind: z.ZodString;
            reference: z.ZodObject<{
                resourceType: z.ZodString;
                id: z.ZodString;
                workspaceId: z.ZodString;
                version: z.ZodOptional<z.ZodNumber>;
                revision: z.ZodOptional<z.ZodNumber>;
                contentHash: z.ZodString;
            }, z.core.$strict>;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"create">;
            targetKind: z.ZodString;
            parents: z.ZodArray<z.ZodObject<{
                relationship: z.ZodString;
                reference: z.ZodObject<{
                    resourceType: z.ZodString;
                    id: z.ZodString;
                    workspaceId: z.ZodString;
                    version: z.ZodOptional<z.ZodNumber>;
                    revision: z.ZodOptional<z.ZodNumber>;
                    contentHash: z.ZodString;
                }, z.core.$strict>;
            }, z.core.$strict>>;
        }, z.core.$strict>], "kind">>;
        tools: z.ZodArray<z.ZodObject<{
            key: z.ZodString;
            version: z.ZodNumber;
            operation: z.ZodString;
            class: z.ZodEnum<{
                read_only: "read_only";
                cost_incurring_read: "cost_incurring_read";
                external_mutation: "external_mutation";
            }>;
            provider: z.ZodString;
            bindingId: z.ZodOptional<z.ZodString>;
            authorizedOperationId: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
        bindings: z.ZodArray<z.ZodString>;
        models: z.ZodArray<z.ZodObject<{
            provider: z.ZodString;
            model: z.ZodString;
            purpose: z.ZodString;
        }, z.core.$strict>>;
        budgets: z.ZodObject<{
            deadline: z.ZodISODateTime;
            modelCalls: z.ZodNumber;
            toolCalls: z.ZodNumber;
            providerCalls: z.ZodArray<z.ZodObject<{
                provider: z.ZodString;
                calls: z.ZodNumber;
            }, z.core.$strict>>;
            cost: z.ZodObject<{
                currency: z.ZodString;
                amount: z.ZodString;
            }, z.core.$strict>;
        }, z.core.$strict>;
    }, z.core.$strict>>;
    traceId: z.ZodString;
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
}, z.core.$strict>>]>;
export type RuntimeClaimedWork = z.infer<typeof RuntimeClaimedWorkSchema>;
export declare const DispatchV2Schema: z.ZodPipe<z.ZodUnknown, z.ZodObject<{
    protocolVersion: z.ZodLiteral<"2.0">;
    environment: z.ZodEnum<{
        local: "local";
        test: "test";
        dev: "dev";
        prod: "prod";
    }>;
    runId: z.ZodString;
    generation: z.ZodNumber;
    dispatchId: z.ZodString;
    notBefore: z.ZodISODateTime;
    traceId: z.ZodString;
}, z.core.$strict>>;
export declare const RuntimeDispatchSchema: z.ZodUnion<readonly [z.ZodPipe<z.ZodUnknown, z.ZodObject<{
    protocolVersion: z.ZodEnum<{
        1.2: "1.2";
        1.1: "1.1";
    }>;
    environment: z.ZodEnum<{
        local: "local";
        test: "test";
        dev: "dev";
        prod: "prod";
    }>;
    runId: z.ZodString;
    generation: z.ZodNumber;
    dispatchId: z.ZodString;
    notBefore: z.ZodISODateTime;
    traceId: z.ZodString;
}, z.core.$strict>>, z.ZodPipe<z.ZodUnknown, z.ZodObject<{
    protocolVersion: z.ZodLiteral<"2.0">;
    environment: z.ZodEnum<{
        local: "local";
        test: "test";
        dev: "dev";
        prod: "prod";
    }>;
    runId: z.ZodString;
    generation: z.ZodNumber;
    dispatchId: z.ZodString;
    notBefore: z.ZodISODateTime;
    traceId: z.ZodString;
}, z.core.$strict>>]>;
export declare const ImplementationManifestV2Schema: z.ZodPipe<z.ZodUnknown, z.ZodObject<{
    protocolVersions: z.ZodArray<z.ZodEnum<{
        1.2: "1.2";
        1.1: "1.1";
        "2.0": "2.0";
    }>>;
    implementation: z.ZodObject<{
        key: z.ZodString;
        version: z.ZodNumber;
    }, z.core.$strict>;
    compatibleDefinitions: z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        version: z.ZodNumber;
    }, z.core.$strict>>;
    operations: z.ZodArray<z.ZodString>;
    resultSchemaVersions: z.ZodArray<z.ZodNumber>;
    checkpointSchemaVersions: z.ZodArray<z.ZodNumber>;
    instruction: z.ZodObject<{
        version: z.ZodNumber;
        hash: z.ZodString;
    }, z.core.$strict>;
    buildDigest: z.ZodString;
    manifestDigest: z.ZodString;
}, z.core.$strict>>;
export declare const RuntimeImplementationManifestSchema: z.ZodUnion<readonly [z.ZodPipe<z.ZodUnknown, z.ZodObject<{
    implementation: z.ZodObject<{
        key: z.ZodString;
        version: z.ZodNumber;
    }, z.core.$strict>;
    compatibleDefinitions: z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        version: z.ZodNumber;
    }, z.core.$strict>>;
    protocolVersions: z.ZodArray<z.ZodEnum<{
        1.2: "1.2";
        1.1: "1.1";
    }>>;
    operations: z.ZodArray<z.ZodString>;
    resultSchemaVersions: z.ZodArray<z.ZodNumber>;
    checkpointSchemaVersions: z.ZodArray<z.ZodNumber>;
    instruction: z.ZodObject<{
        version: z.ZodNumber;
        hash: z.ZodString;
    }, z.core.$strict>;
    buildDigest: z.ZodString;
    manifestDigest: z.ZodString;
}, z.core.$strict>>, z.ZodPipe<z.ZodUnknown, z.ZodObject<{
    protocolVersions: z.ZodArray<z.ZodEnum<{
        1.2: "1.2";
        1.1: "1.1";
        "2.0": "2.0";
    }>>;
    implementation: z.ZodObject<{
        key: z.ZodString;
        version: z.ZodNumber;
    }, z.core.$strict>;
    compatibleDefinitions: z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        version: z.ZodNumber;
    }, z.core.$strict>>;
    operations: z.ZodArray<z.ZodString>;
    resultSchemaVersions: z.ZodArray<z.ZodNumber>;
    checkpointSchemaVersions: z.ZodArray<z.ZodNumber>;
    instruction: z.ZodObject<{
        version: z.ZodNumber;
        hash: z.ZodString;
    }, z.core.$strict>;
    buildDigest: z.ZodString;
    manifestDigest: z.ZodString;
}, z.core.$strict>>]>;
export type RuntimeImplementationManifest = z.infer<typeof RuntimeImplementationManifestSchema>;
export type RuntimeDispatch = z.infer<typeof RuntimeDispatchSchema>;
