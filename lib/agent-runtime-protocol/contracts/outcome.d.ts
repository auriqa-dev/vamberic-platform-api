import { z } from 'zod';
export declare const CompletenessSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"complete">;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"partial">;
    omissions: z.ZodArray<z.ZodString>;
    reason: z.ZodString;
}, z.core.$strict>], "kind">;
export declare const AgentOutcomeSchema: z.ZodPipe<z.ZodUnknown, z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"success">;
    completeness: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"complete">;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"partial">;
        omissions: z.ZodArray<z.ZodString>;
        reason: z.ZodString;
    }, z.core.$strict>], "kind">;
    content: z.ZodPipe<z.ZodUnknown, z.ZodObject<{
        domainOutput: z.ZodOptional<z.ZodPipe<z.ZodUnknown, z.ZodJSONSchema>>;
        findings: z.ZodArray<z.ZodPipe<z.ZodUnknown, z.ZodObject<{
            id: z.ZodString;
            kind: z.ZodEnum<{
                unknown: "unknown";
                observed_fact: "observed_fact";
                evidence_backed_finding: "evidence_backed_finding";
                inference: "inference";
                assumption: "assumption";
                recommendation: "recommendation";
            }>;
            statement: z.ZodString;
            evidenceIds: z.ZodArray<z.ZodString>;
            lineageIds: z.ZodArray<z.ZodString>;
            confidence: z.ZodOptional<z.ZodNumber>;
            provenance: z.ZodOptional<z.ZodObject<{
                provider: z.ZodString;
                adapterKey: z.ZodString;
                adapterVersion: z.ZodNumber;
                invocationId: z.ZodString;
                providerRequestId: z.ZodOptional<z.ZodString>;
                model: z.ZodOptional<z.ZodString>;
                modelVersion: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
            payload: z.ZodOptional<z.ZodPipe<z.ZodUnknown, z.ZodJSONSchema>>;
        }, z.core.$strict>>>;
        evidence: z.ZodArray<z.ZodPipe<z.ZodUnknown, z.ZodObject<{
            id: z.ZodString;
            origin: z.ZodEnum<{
                user_supplied: "user_supplied";
                external_evidence: "external_evidence";
                ai_inferred: "ai_inferred";
            }>;
            subject: z.ZodOptional<z.ZodString>;
            claim: z.ZodString;
            candidate: z.ZodOptional<z.ZodPipe<z.ZodUnknown, z.ZodJSONSchema>>;
            provenance: z.ZodObject<{
                provider: z.ZodString;
                adapterKey: z.ZodString;
                adapterVersion: z.ZodNumber;
                invocationId: z.ZodString;
                providerRequestId: z.ZodOptional<z.ZodString>;
                model: z.ZodOptional<z.ZodString>;
                modelVersion: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>;
            source: z.ZodDiscriminatedUnion<[z.ZodObject<{
                kind: z.ZodLiteral<"external">;
                url: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                kind: z.ZodLiteral<"reference">;
                id: z.ZodString;
            }, z.core.$strict>], "kind">;
            observedAt: z.ZodISODateTime;
            retrievedAt: z.ZodISODateTime;
            excerpt: z.ZodOptional<z.ZodString>;
            artifactId: z.ZodOptional<z.ZodString>;
            digest: z.ZodString;
            confidence: z.ZodOptional<z.ZodNumber>;
            verification: z.ZodLiteral<"observed">;
        }, z.core.$strict>>>;
        assumptions: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            statement: z.ZodString;
            evidenceIds: z.ZodArray<z.ZodString>;
            validationQuestion: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
        unknowns: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            question: z.ZodString;
            impact: z.ZodString;
        }, z.core.$strict>>;
        knowledgeGaps: z.ZodArray<z.ZodPipe<z.ZodUnknown, z.ZodObject<{
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
        }, z.core.$strict>>>;
        proposals: z.ZodArray<z.ZodPipe<z.ZodUnknown, z.ZodObject<{
            id: z.ZodString;
            targetKind: z.ZodString;
            target: z.ZodDiscriminatedUnion<[z.ZodObject<{
                kind: z.ZodLiteral<"update">;
                reference: z.ZodObject<{
                    resourceType: z.ZodString;
                    id: z.ZodString;
                    workspaceId: z.ZodString;
                    version: z.ZodOptional<z.ZodNumber>;
                    revision: z.ZodOptional<z.ZodNumber>;
                    contentHash: z.ZodString;
                }, z.core.$strict>;
                expectedUpdatedAt: z.ZodOptional<z.ZodISODateTime>;
            }, z.core.$strict>, z.ZodObject<{
                kind: z.ZodLiteral<"create">;
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
            }, z.core.$strict>], "kind">;
            candidate: z.ZodPipe<z.ZodUnknown, z.ZodJSONSchema>;
            evidenceIds: z.ZodArray<z.ZodString>;
            rationale: z.ZodString;
            lineageIds: z.ZodArray<z.ZodString>;
        }, z.core.$strict>>>;
        artifacts: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            mediaType: z.ZodString;
            bytes: z.ZodNumber;
            digest: z.ZodString;
        }, z.core.$strict>>;
        warnings: z.ZodArray<z.ZodObject<{
            code: z.ZodString;
            message: z.ZodString;
        }, z.core.$strict>>;
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
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"needs_input">;
    completeness: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"complete">;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"partial">;
        omissions: z.ZodArray<z.ZodString>;
        reason: z.ZodString;
    }, z.core.$strict>], "kind">;
    content: z.ZodPipe<z.ZodUnknown, z.ZodObject<{
        domainOutput: z.ZodOptional<z.ZodPipe<z.ZodUnknown, z.ZodJSONSchema>>;
        findings: z.ZodArray<z.ZodPipe<z.ZodUnknown, z.ZodObject<{
            id: z.ZodString;
            kind: z.ZodEnum<{
                unknown: "unknown";
                observed_fact: "observed_fact";
                evidence_backed_finding: "evidence_backed_finding";
                inference: "inference";
                assumption: "assumption";
                recommendation: "recommendation";
            }>;
            statement: z.ZodString;
            evidenceIds: z.ZodArray<z.ZodString>;
            lineageIds: z.ZodArray<z.ZodString>;
            confidence: z.ZodOptional<z.ZodNumber>;
            provenance: z.ZodOptional<z.ZodObject<{
                provider: z.ZodString;
                adapterKey: z.ZodString;
                adapterVersion: z.ZodNumber;
                invocationId: z.ZodString;
                providerRequestId: z.ZodOptional<z.ZodString>;
                model: z.ZodOptional<z.ZodString>;
                modelVersion: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
            payload: z.ZodOptional<z.ZodPipe<z.ZodUnknown, z.ZodJSONSchema>>;
        }, z.core.$strict>>>;
        evidence: z.ZodArray<z.ZodPipe<z.ZodUnknown, z.ZodObject<{
            id: z.ZodString;
            origin: z.ZodEnum<{
                user_supplied: "user_supplied";
                external_evidence: "external_evidence";
                ai_inferred: "ai_inferred";
            }>;
            subject: z.ZodOptional<z.ZodString>;
            claim: z.ZodString;
            candidate: z.ZodOptional<z.ZodPipe<z.ZodUnknown, z.ZodJSONSchema>>;
            provenance: z.ZodObject<{
                provider: z.ZodString;
                adapterKey: z.ZodString;
                adapterVersion: z.ZodNumber;
                invocationId: z.ZodString;
                providerRequestId: z.ZodOptional<z.ZodString>;
                model: z.ZodOptional<z.ZodString>;
                modelVersion: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>;
            source: z.ZodDiscriminatedUnion<[z.ZodObject<{
                kind: z.ZodLiteral<"external">;
                url: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                kind: z.ZodLiteral<"reference">;
                id: z.ZodString;
            }, z.core.$strict>], "kind">;
            observedAt: z.ZodISODateTime;
            retrievedAt: z.ZodISODateTime;
            excerpt: z.ZodOptional<z.ZodString>;
            artifactId: z.ZodOptional<z.ZodString>;
            digest: z.ZodString;
            confidence: z.ZodOptional<z.ZodNumber>;
            verification: z.ZodLiteral<"observed">;
        }, z.core.$strict>>>;
        assumptions: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            statement: z.ZodString;
            evidenceIds: z.ZodArray<z.ZodString>;
            validationQuestion: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
        unknowns: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            question: z.ZodString;
            impact: z.ZodString;
        }, z.core.$strict>>;
        knowledgeGaps: z.ZodArray<z.ZodPipe<z.ZodUnknown, z.ZodObject<{
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
        }, z.core.$strict>>>;
        proposals: z.ZodArray<z.ZodPipe<z.ZodUnknown, z.ZodObject<{
            id: z.ZodString;
            targetKind: z.ZodString;
            target: z.ZodDiscriminatedUnion<[z.ZodObject<{
                kind: z.ZodLiteral<"update">;
                reference: z.ZodObject<{
                    resourceType: z.ZodString;
                    id: z.ZodString;
                    workspaceId: z.ZodString;
                    version: z.ZodOptional<z.ZodNumber>;
                    revision: z.ZodOptional<z.ZodNumber>;
                    contentHash: z.ZodString;
                }, z.core.$strict>;
                expectedUpdatedAt: z.ZodOptional<z.ZodISODateTime>;
            }, z.core.$strict>, z.ZodObject<{
                kind: z.ZodLiteral<"create">;
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
            }, z.core.$strict>], "kind">;
            candidate: z.ZodPipe<z.ZodUnknown, z.ZodJSONSchema>;
            evidenceIds: z.ZodArray<z.ZodString>;
            rationale: z.ZodString;
            lineageIds: z.ZodArray<z.ZodString>;
        }, z.core.$strict>>>;
        artifacts: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            mediaType: z.ZodString;
            bytes: z.ZodNumber;
            digest: z.ZodString;
        }, z.core.$strict>>;
        warnings: z.ZodArray<z.ZodObject<{
            code: z.ZodString;
            message: z.ZodString;
        }, z.core.$strict>>;
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
    inputRequest: z.ZodPipe<z.ZodUnknown, z.ZodObject<{
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
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"yield">;
    completeness: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"complete">;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"partial">;
        omissions: z.ZodArray<z.ZodString>;
        reason: z.ZodString;
    }, z.core.$strict>], "kind">;
    content: z.ZodPipe<z.ZodUnknown, z.ZodObject<{
        domainOutput: z.ZodOptional<z.ZodPipe<z.ZodUnknown, z.ZodJSONSchema>>;
        findings: z.ZodArray<z.ZodPipe<z.ZodUnknown, z.ZodObject<{
            id: z.ZodString;
            kind: z.ZodEnum<{
                unknown: "unknown";
                observed_fact: "observed_fact";
                evidence_backed_finding: "evidence_backed_finding";
                inference: "inference";
                assumption: "assumption";
                recommendation: "recommendation";
            }>;
            statement: z.ZodString;
            evidenceIds: z.ZodArray<z.ZodString>;
            lineageIds: z.ZodArray<z.ZodString>;
            confidence: z.ZodOptional<z.ZodNumber>;
            provenance: z.ZodOptional<z.ZodObject<{
                provider: z.ZodString;
                adapterKey: z.ZodString;
                adapterVersion: z.ZodNumber;
                invocationId: z.ZodString;
                providerRequestId: z.ZodOptional<z.ZodString>;
                model: z.ZodOptional<z.ZodString>;
                modelVersion: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
            payload: z.ZodOptional<z.ZodPipe<z.ZodUnknown, z.ZodJSONSchema>>;
        }, z.core.$strict>>>;
        evidence: z.ZodArray<z.ZodPipe<z.ZodUnknown, z.ZodObject<{
            id: z.ZodString;
            origin: z.ZodEnum<{
                user_supplied: "user_supplied";
                external_evidence: "external_evidence";
                ai_inferred: "ai_inferred";
            }>;
            subject: z.ZodOptional<z.ZodString>;
            claim: z.ZodString;
            candidate: z.ZodOptional<z.ZodPipe<z.ZodUnknown, z.ZodJSONSchema>>;
            provenance: z.ZodObject<{
                provider: z.ZodString;
                adapterKey: z.ZodString;
                adapterVersion: z.ZodNumber;
                invocationId: z.ZodString;
                providerRequestId: z.ZodOptional<z.ZodString>;
                model: z.ZodOptional<z.ZodString>;
                modelVersion: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>;
            source: z.ZodDiscriminatedUnion<[z.ZodObject<{
                kind: z.ZodLiteral<"external">;
                url: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                kind: z.ZodLiteral<"reference">;
                id: z.ZodString;
            }, z.core.$strict>], "kind">;
            observedAt: z.ZodISODateTime;
            retrievedAt: z.ZodISODateTime;
            excerpt: z.ZodOptional<z.ZodString>;
            artifactId: z.ZodOptional<z.ZodString>;
            digest: z.ZodString;
            confidence: z.ZodOptional<z.ZodNumber>;
            verification: z.ZodLiteral<"observed">;
        }, z.core.$strict>>>;
        assumptions: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            statement: z.ZodString;
            evidenceIds: z.ZodArray<z.ZodString>;
            validationQuestion: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
        unknowns: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            question: z.ZodString;
            impact: z.ZodString;
        }, z.core.$strict>>;
        knowledgeGaps: z.ZodArray<z.ZodPipe<z.ZodUnknown, z.ZodObject<{
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
        }, z.core.$strict>>>;
        proposals: z.ZodArray<z.ZodPipe<z.ZodUnknown, z.ZodObject<{
            id: z.ZodString;
            targetKind: z.ZodString;
            target: z.ZodDiscriminatedUnion<[z.ZodObject<{
                kind: z.ZodLiteral<"update">;
                reference: z.ZodObject<{
                    resourceType: z.ZodString;
                    id: z.ZodString;
                    workspaceId: z.ZodString;
                    version: z.ZodOptional<z.ZodNumber>;
                    revision: z.ZodOptional<z.ZodNumber>;
                    contentHash: z.ZodString;
                }, z.core.$strict>;
                expectedUpdatedAt: z.ZodOptional<z.ZodISODateTime>;
            }, z.core.$strict>, z.ZodObject<{
                kind: z.ZodLiteral<"create">;
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
            }, z.core.$strict>], "kind">;
            candidate: z.ZodPipe<z.ZodUnknown, z.ZodJSONSchema>;
            evidenceIds: z.ZodArray<z.ZodString>;
            rationale: z.ZodString;
            lineageIds: z.ZodArray<z.ZodString>;
        }, z.core.$strict>>>;
        artifacts: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            mediaType: z.ZodString;
            bytes: z.ZodNumber;
            digest: z.ZodString;
        }, z.core.$strict>>;
        warnings: z.ZodArray<z.ZodObject<{
            code: z.ZodString;
            message: z.ZodString;
        }, z.core.$strict>>;
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
    reason: z.ZodString;
    notBefore: z.ZodOptional<z.ZodISODateTime>;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"failure">;
    completeness: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"complete">;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"partial">;
        omissions: z.ZodArray<z.ZodString>;
        reason: z.ZodString;
    }, z.core.$strict>], "kind">;
    content: z.ZodPipe<z.ZodUnknown, z.ZodObject<{
        domainOutput: z.ZodOptional<z.ZodPipe<z.ZodUnknown, z.ZodJSONSchema>>;
        findings: z.ZodArray<z.ZodPipe<z.ZodUnknown, z.ZodObject<{
            id: z.ZodString;
            kind: z.ZodEnum<{
                unknown: "unknown";
                observed_fact: "observed_fact";
                evidence_backed_finding: "evidence_backed_finding";
                inference: "inference";
                assumption: "assumption";
                recommendation: "recommendation";
            }>;
            statement: z.ZodString;
            evidenceIds: z.ZodArray<z.ZodString>;
            lineageIds: z.ZodArray<z.ZodString>;
            confidence: z.ZodOptional<z.ZodNumber>;
            provenance: z.ZodOptional<z.ZodObject<{
                provider: z.ZodString;
                adapterKey: z.ZodString;
                adapterVersion: z.ZodNumber;
                invocationId: z.ZodString;
                providerRequestId: z.ZodOptional<z.ZodString>;
                model: z.ZodOptional<z.ZodString>;
                modelVersion: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
            payload: z.ZodOptional<z.ZodPipe<z.ZodUnknown, z.ZodJSONSchema>>;
        }, z.core.$strict>>>;
        evidence: z.ZodArray<z.ZodPipe<z.ZodUnknown, z.ZodObject<{
            id: z.ZodString;
            origin: z.ZodEnum<{
                user_supplied: "user_supplied";
                external_evidence: "external_evidence";
                ai_inferred: "ai_inferred";
            }>;
            subject: z.ZodOptional<z.ZodString>;
            claim: z.ZodString;
            candidate: z.ZodOptional<z.ZodPipe<z.ZodUnknown, z.ZodJSONSchema>>;
            provenance: z.ZodObject<{
                provider: z.ZodString;
                adapterKey: z.ZodString;
                adapterVersion: z.ZodNumber;
                invocationId: z.ZodString;
                providerRequestId: z.ZodOptional<z.ZodString>;
                model: z.ZodOptional<z.ZodString>;
                modelVersion: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>;
            source: z.ZodDiscriminatedUnion<[z.ZodObject<{
                kind: z.ZodLiteral<"external">;
                url: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                kind: z.ZodLiteral<"reference">;
                id: z.ZodString;
            }, z.core.$strict>], "kind">;
            observedAt: z.ZodISODateTime;
            retrievedAt: z.ZodISODateTime;
            excerpt: z.ZodOptional<z.ZodString>;
            artifactId: z.ZodOptional<z.ZodString>;
            digest: z.ZodString;
            confidence: z.ZodOptional<z.ZodNumber>;
            verification: z.ZodLiteral<"observed">;
        }, z.core.$strict>>>;
        assumptions: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            statement: z.ZodString;
            evidenceIds: z.ZodArray<z.ZodString>;
            validationQuestion: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
        unknowns: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            question: z.ZodString;
            impact: z.ZodString;
        }, z.core.$strict>>;
        knowledgeGaps: z.ZodArray<z.ZodPipe<z.ZodUnknown, z.ZodObject<{
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
        }, z.core.$strict>>>;
        proposals: z.ZodArray<z.ZodPipe<z.ZodUnknown, z.ZodObject<{
            id: z.ZodString;
            targetKind: z.ZodString;
            target: z.ZodDiscriminatedUnion<[z.ZodObject<{
                kind: z.ZodLiteral<"update">;
                reference: z.ZodObject<{
                    resourceType: z.ZodString;
                    id: z.ZodString;
                    workspaceId: z.ZodString;
                    version: z.ZodOptional<z.ZodNumber>;
                    revision: z.ZodOptional<z.ZodNumber>;
                    contentHash: z.ZodString;
                }, z.core.$strict>;
                expectedUpdatedAt: z.ZodOptional<z.ZodISODateTime>;
            }, z.core.$strict>, z.ZodObject<{
                kind: z.ZodLiteral<"create">;
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
            }, z.core.$strict>], "kind">;
            candidate: z.ZodPipe<z.ZodUnknown, z.ZodJSONSchema>;
            evidenceIds: z.ZodArray<z.ZodString>;
            rationale: z.ZodString;
            lineageIds: z.ZodArray<z.ZodString>;
        }, z.core.$strict>>>;
        artifacts: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            mediaType: z.ZodString;
            bytes: z.ZodNumber;
            digest: z.ZodString;
        }, z.core.$strict>>;
        warnings: z.ZodArray<z.ZodObject<{
            code: z.ZodString;
            message: z.ZodString;
        }, z.core.$strict>>;
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
    error: z.ZodObject<{
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
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"cancelled">;
    completeness: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"complete">;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"partial">;
        omissions: z.ZodArray<z.ZodString>;
        reason: z.ZodString;
    }, z.core.$strict>], "kind">;
    content: z.ZodPipe<z.ZodUnknown, z.ZodObject<{
        domainOutput: z.ZodOptional<z.ZodPipe<z.ZodUnknown, z.ZodJSONSchema>>;
        findings: z.ZodArray<z.ZodPipe<z.ZodUnknown, z.ZodObject<{
            id: z.ZodString;
            kind: z.ZodEnum<{
                unknown: "unknown";
                observed_fact: "observed_fact";
                evidence_backed_finding: "evidence_backed_finding";
                inference: "inference";
                assumption: "assumption";
                recommendation: "recommendation";
            }>;
            statement: z.ZodString;
            evidenceIds: z.ZodArray<z.ZodString>;
            lineageIds: z.ZodArray<z.ZodString>;
            confidence: z.ZodOptional<z.ZodNumber>;
            provenance: z.ZodOptional<z.ZodObject<{
                provider: z.ZodString;
                adapterKey: z.ZodString;
                adapterVersion: z.ZodNumber;
                invocationId: z.ZodString;
                providerRequestId: z.ZodOptional<z.ZodString>;
                model: z.ZodOptional<z.ZodString>;
                modelVersion: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
            payload: z.ZodOptional<z.ZodPipe<z.ZodUnknown, z.ZodJSONSchema>>;
        }, z.core.$strict>>>;
        evidence: z.ZodArray<z.ZodPipe<z.ZodUnknown, z.ZodObject<{
            id: z.ZodString;
            origin: z.ZodEnum<{
                user_supplied: "user_supplied";
                external_evidence: "external_evidence";
                ai_inferred: "ai_inferred";
            }>;
            subject: z.ZodOptional<z.ZodString>;
            claim: z.ZodString;
            candidate: z.ZodOptional<z.ZodPipe<z.ZodUnknown, z.ZodJSONSchema>>;
            provenance: z.ZodObject<{
                provider: z.ZodString;
                adapterKey: z.ZodString;
                adapterVersion: z.ZodNumber;
                invocationId: z.ZodString;
                providerRequestId: z.ZodOptional<z.ZodString>;
                model: z.ZodOptional<z.ZodString>;
                modelVersion: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>;
            source: z.ZodDiscriminatedUnion<[z.ZodObject<{
                kind: z.ZodLiteral<"external">;
                url: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                kind: z.ZodLiteral<"reference">;
                id: z.ZodString;
            }, z.core.$strict>], "kind">;
            observedAt: z.ZodISODateTime;
            retrievedAt: z.ZodISODateTime;
            excerpt: z.ZodOptional<z.ZodString>;
            artifactId: z.ZodOptional<z.ZodString>;
            digest: z.ZodString;
            confidence: z.ZodOptional<z.ZodNumber>;
            verification: z.ZodLiteral<"observed">;
        }, z.core.$strict>>>;
        assumptions: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            statement: z.ZodString;
            evidenceIds: z.ZodArray<z.ZodString>;
            validationQuestion: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
        unknowns: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            question: z.ZodString;
            impact: z.ZodString;
        }, z.core.$strict>>;
        knowledgeGaps: z.ZodArray<z.ZodPipe<z.ZodUnknown, z.ZodObject<{
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
        }, z.core.$strict>>>;
        proposals: z.ZodArray<z.ZodPipe<z.ZodUnknown, z.ZodObject<{
            id: z.ZodString;
            targetKind: z.ZodString;
            target: z.ZodDiscriminatedUnion<[z.ZodObject<{
                kind: z.ZodLiteral<"update">;
                reference: z.ZodObject<{
                    resourceType: z.ZodString;
                    id: z.ZodString;
                    workspaceId: z.ZodString;
                    version: z.ZodOptional<z.ZodNumber>;
                    revision: z.ZodOptional<z.ZodNumber>;
                    contentHash: z.ZodString;
                }, z.core.$strict>;
                expectedUpdatedAt: z.ZodOptional<z.ZodISODateTime>;
            }, z.core.$strict>, z.ZodObject<{
                kind: z.ZodLiteral<"create">;
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
            }, z.core.$strict>], "kind">;
            candidate: z.ZodPipe<z.ZodUnknown, z.ZodJSONSchema>;
            evidenceIds: z.ZodArray<z.ZodString>;
            rationale: z.ZodString;
            lineageIds: z.ZodArray<z.ZodString>;
        }, z.core.$strict>>>;
        artifacts: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            mediaType: z.ZodString;
            bytes: z.ZodNumber;
            digest: z.ZodString;
        }, z.core.$strict>>;
        warnings: z.ZodArray<z.ZodObject<{
            code: z.ZodString;
            message: z.ZodString;
        }, z.core.$strict>>;
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
    error: z.ZodObject<{
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
}, z.core.$strict>], "kind">>;
export declare const OutcomeSchema: z.ZodPipe<z.ZodUnknown, z.ZodObject<{
    protocolVersion: z.ZodEnum<{
        1.2: "1.2";
        1.1: "1.1";
    }>;
    resultSchemaVersion: z.ZodLiteral<2>;
    runId: z.ZodString;
    attemptId: z.ZodString;
    generation: z.ZodNumber;
    fence: z.ZodNumber;
    submissionId: z.ZodString;
    payloadDigest: z.ZodString;
    implementation: z.ZodObject<{
        key: z.ZodString;
        version: z.ZodNumber;
        manifestDigest: z.ZodString;
        buildDigest: z.ZodString;
    }, z.core.$strict>;
    instruction: z.ZodObject<{
        version: z.ZodNumber;
        hash: z.ZodString;
    }, z.core.$strict>;
    traceId: z.ZodString;
    startedAt: z.ZodISODateTime;
    endedAt: z.ZodISODateTime;
    outcome: z.ZodPipe<z.ZodUnknown, z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"success">;
        completeness: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"complete">;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"partial">;
            omissions: z.ZodArray<z.ZodString>;
            reason: z.ZodString;
        }, z.core.$strict>], "kind">;
        content: z.ZodPipe<z.ZodUnknown, z.ZodObject<{
            domainOutput: z.ZodOptional<z.ZodPipe<z.ZodUnknown, z.ZodJSONSchema>>;
            findings: z.ZodArray<z.ZodPipe<z.ZodUnknown, z.ZodObject<{
                id: z.ZodString;
                kind: z.ZodEnum<{
                    unknown: "unknown";
                    observed_fact: "observed_fact";
                    evidence_backed_finding: "evidence_backed_finding";
                    inference: "inference";
                    assumption: "assumption";
                    recommendation: "recommendation";
                }>;
                statement: z.ZodString;
                evidenceIds: z.ZodArray<z.ZodString>;
                lineageIds: z.ZodArray<z.ZodString>;
                confidence: z.ZodOptional<z.ZodNumber>;
                provenance: z.ZodOptional<z.ZodObject<{
                    provider: z.ZodString;
                    adapterKey: z.ZodString;
                    adapterVersion: z.ZodNumber;
                    invocationId: z.ZodString;
                    providerRequestId: z.ZodOptional<z.ZodString>;
                    model: z.ZodOptional<z.ZodString>;
                    modelVersion: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
                payload: z.ZodOptional<z.ZodPipe<z.ZodUnknown, z.ZodJSONSchema>>;
            }, z.core.$strict>>>;
            evidence: z.ZodArray<z.ZodPipe<z.ZodUnknown, z.ZodObject<{
                id: z.ZodString;
                origin: z.ZodEnum<{
                    user_supplied: "user_supplied";
                    external_evidence: "external_evidence";
                    ai_inferred: "ai_inferred";
                }>;
                subject: z.ZodOptional<z.ZodString>;
                claim: z.ZodString;
                candidate: z.ZodOptional<z.ZodPipe<z.ZodUnknown, z.ZodJSONSchema>>;
                provenance: z.ZodObject<{
                    provider: z.ZodString;
                    adapterKey: z.ZodString;
                    adapterVersion: z.ZodNumber;
                    invocationId: z.ZodString;
                    providerRequestId: z.ZodOptional<z.ZodString>;
                    model: z.ZodOptional<z.ZodString>;
                    modelVersion: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>;
                source: z.ZodDiscriminatedUnion<[z.ZodObject<{
                    kind: z.ZodLiteral<"external">;
                    url: z.ZodString;
                }, z.core.$strict>, z.ZodObject<{
                    kind: z.ZodLiteral<"reference">;
                    id: z.ZodString;
                }, z.core.$strict>], "kind">;
                observedAt: z.ZodISODateTime;
                retrievedAt: z.ZodISODateTime;
                excerpt: z.ZodOptional<z.ZodString>;
                artifactId: z.ZodOptional<z.ZodString>;
                digest: z.ZodString;
                confidence: z.ZodOptional<z.ZodNumber>;
                verification: z.ZodLiteral<"observed">;
            }, z.core.$strict>>>;
            assumptions: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                statement: z.ZodString;
                evidenceIds: z.ZodArray<z.ZodString>;
                validationQuestion: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
            unknowns: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                question: z.ZodString;
                impact: z.ZodString;
            }, z.core.$strict>>;
            knowledgeGaps: z.ZodArray<z.ZodPipe<z.ZodUnknown, z.ZodObject<{
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
            }, z.core.$strict>>>;
            proposals: z.ZodArray<z.ZodPipe<z.ZodUnknown, z.ZodObject<{
                id: z.ZodString;
                targetKind: z.ZodString;
                target: z.ZodDiscriminatedUnion<[z.ZodObject<{
                    kind: z.ZodLiteral<"update">;
                    reference: z.ZodObject<{
                        resourceType: z.ZodString;
                        id: z.ZodString;
                        workspaceId: z.ZodString;
                        version: z.ZodOptional<z.ZodNumber>;
                        revision: z.ZodOptional<z.ZodNumber>;
                        contentHash: z.ZodString;
                    }, z.core.$strict>;
                    expectedUpdatedAt: z.ZodOptional<z.ZodISODateTime>;
                }, z.core.$strict>, z.ZodObject<{
                    kind: z.ZodLiteral<"create">;
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
                }, z.core.$strict>], "kind">;
                candidate: z.ZodPipe<z.ZodUnknown, z.ZodJSONSchema>;
                evidenceIds: z.ZodArray<z.ZodString>;
                rationale: z.ZodString;
                lineageIds: z.ZodArray<z.ZodString>;
            }, z.core.$strict>>>;
            artifacts: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                mediaType: z.ZodString;
                bytes: z.ZodNumber;
                digest: z.ZodString;
            }, z.core.$strict>>;
            warnings: z.ZodArray<z.ZodObject<{
                code: z.ZodString;
                message: z.ZodString;
            }, z.core.$strict>>;
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
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"needs_input">;
        completeness: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"complete">;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"partial">;
            omissions: z.ZodArray<z.ZodString>;
            reason: z.ZodString;
        }, z.core.$strict>], "kind">;
        content: z.ZodPipe<z.ZodUnknown, z.ZodObject<{
            domainOutput: z.ZodOptional<z.ZodPipe<z.ZodUnknown, z.ZodJSONSchema>>;
            findings: z.ZodArray<z.ZodPipe<z.ZodUnknown, z.ZodObject<{
                id: z.ZodString;
                kind: z.ZodEnum<{
                    unknown: "unknown";
                    observed_fact: "observed_fact";
                    evidence_backed_finding: "evidence_backed_finding";
                    inference: "inference";
                    assumption: "assumption";
                    recommendation: "recommendation";
                }>;
                statement: z.ZodString;
                evidenceIds: z.ZodArray<z.ZodString>;
                lineageIds: z.ZodArray<z.ZodString>;
                confidence: z.ZodOptional<z.ZodNumber>;
                provenance: z.ZodOptional<z.ZodObject<{
                    provider: z.ZodString;
                    adapterKey: z.ZodString;
                    adapterVersion: z.ZodNumber;
                    invocationId: z.ZodString;
                    providerRequestId: z.ZodOptional<z.ZodString>;
                    model: z.ZodOptional<z.ZodString>;
                    modelVersion: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
                payload: z.ZodOptional<z.ZodPipe<z.ZodUnknown, z.ZodJSONSchema>>;
            }, z.core.$strict>>>;
            evidence: z.ZodArray<z.ZodPipe<z.ZodUnknown, z.ZodObject<{
                id: z.ZodString;
                origin: z.ZodEnum<{
                    user_supplied: "user_supplied";
                    external_evidence: "external_evidence";
                    ai_inferred: "ai_inferred";
                }>;
                subject: z.ZodOptional<z.ZodString>;
                claim: z.ZodString;
                candidate: z.ZodOptional<z.ZodPipe<z.ZodUnknown, z.ZodJSONSchema>>;
                provenance: z.ZodObject<{
                    provider: z.ZodString;
                    adapterKey: z.ZodString;
                    adapterVersion: z.ZodNumber;
                    invocationId: z.ZodString;
                    providerRequestId: z.ZodOptional<z.ZodString>;
                    model: z.ZodOptional<z.ZodString>;
                    modelVersion: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>;
                source: z.ZodDiscriminatedUnion<[z.ZodObject<{
                    kind: z.ZodLiteral<"external">;
                    url: z.ZodString;
                }, z.core.$strict>, z.ZodObject<{
                    kind: z.ZodLiteral<"reference">;
                    id: z.ZodString;
                }, z.core.$strict>], "kind">;
                observedAt: z.ZodISODateTime;
                retrievedAt: z.ZodISODateTime;
                excerpt: z.ZodOptional<z.ZodString>;
                artifactId: z.ZodOptional<z.ZodString>;
                digest: z.ZodString;
                confidence: z.ZodOptional<z.ZodNumber>;
                verification: z.ZodLiteral<"observed">;
            }, z.core.$strict>>>;
            assumptions: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                statement: z.ZodString;
                evidenceIds: z.ZodArray<z.ZodString>;
                validationQuestion: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
            unknowns: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                question: z.ZodString;
                impact: z.ZodString;
            }, z.core.$strict>>;
            knowledgeGaps: z.ZodArray<z.ZodPipe<z.ZodUnknown, z.ZodObject<{
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
            }, z.core.$strict>>>;
            proposals: z.ZodArray<z.ZodPipe<z.ZodUnknown, z.ZodObject<{
                id: z.ZodString;
                targetKind: z.ZodString;
                target: z.ZodDiscriminatedUnion<[z.ZodObject<{
                    kind: z.ZodLiteral<"update">;
                    reference: z.ZodObject<{
                        resourceType: z.ZodString;
                        id: z.ZodString;
                        workspaceId: z.ZodString;
                        version: z.ZodOptional<z.ZodNumber>;
                        revision: z.ZodOptional<z.ZodNumber>;
                        contentHash: z.ZodString;
                    }, z.core.$strict>;
                    expectedUpdatedAt: z.ZodOptional<z.ZodISODateTime>;
                }, z.core.$strict>, z.ZodObject<{
                    kind: z.ZodLiteral<"create">;
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
                }, z.core.$strict>], "kind">;
                candidate: z.ZodPipe<z.ZodUnknown, z.ZodJSONSchema>;
                evidenceIds: z.ZodArray<z.ZodString>;
                rationale: z.ZodString;
                lineageIds: z.ZodArray<z.ZodString>;
            }, z.core.$strict>>>;
            artifacts: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                mediaType: z.ZodString;
                bytes: z.ZodNumber;
                digest: z.ZodString;
            }, z.core.$strict>>;
            warnings: z.ZodArray<z.ZodObject<{
                code: z.ZodString;
                message: z.ZodString;
            }, z.core.$strict>>;
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
        inputRequest: z.ZodPipe<z.ZodUnknown, z.ZodObject<{
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
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"yield">;
        completeness: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"complete">;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"partial">;
            omissions: z.ZodArray<z.ZodString>;
            reason: z.ZodString;
        }, z.core.$strict>], "kind">;
        content: z.ZodPipe<z.ZodUnknown, z.ZodObject<{
            domainOutput: z.ZodOptional<z.ZodPipe<z.ZodUnknown, z.ZodJSONSchema>>;
            findings: z.ZodArray<z.ZodPipe<z.ZodUnknown, z.ZodObject<{
                id: z.ZodString;
                kind: z.ZodEnum<{
                    unknown: "unknown";
                    observed_fact: "observed_fact";
                    evidence_backed_finding: "evidence_backed_finding";
                    inference: "inference";
                    assumption: "assumption";
                    recommendation: "recommendation";
                }>;
                statement: z.ZodString;
                evidenceIds: z.ZodArray<z.ZodString>;
                lineageIds: z.ZodArray<z.ZodString>;
                confidence: z.ZodOptional<z.ZodNumber>;
                provenance: z.ZodOptional<z.ZodObject<{
                    provider: z.ZodString;
                    adapterKey: z.ZodString;
                    adapterVersion: z.ZodNumber;
                    invocationId: z.ZodString;
                    providerRequestId: z.ZodOptional<z.ZodString>;
                    model: z.ZodOptional<z.ZodString>;
                    modelVersion: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
                payload: z.ZodOptional<z.ZodPipe<z.ZodUnknown, z.ZodJSONSchema>>;
            }, z.core.$strict>>>;
            evidence: z.ZodArray<z.ZodPipe<z.ZodUnknown, z.ZodObject<{
                id: z.ZodString;
                origin: z.ZodEnum<{
                    user_supplied: "user_supplied";
                    external_evidence: "external_evidence";
                    ai_inferred: "ai_inferred";
                }>;
                subject: z.ZodOptional<z.ZodString>;
                claim: z.ZodString;
                candidate: z.ZodOptional<z.ZodPipe<z.ZodUnknown, z.ZodJSONSchema>>;
                provenance: z.ZodObject<{
                    provider: z.ZodString;
                    adapterKey: z.ZodString;
                    adapterVersion: z.ZodNumber;
                    invocationId: z.ZodString;
                    providerRequestId: z.ZodOptional<z.ZodString>;
                    model: z.ZodOptional<z.ZodString>;
                    modelVersion: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>;
                source: z.ZodDiscriminatedUnion<[z.ZodObject<{
                    kind: z.ZodLiteral<"external">;
                    url: z.ZodString;
                }, z.core.$strict>, z.ZodObject<{
                    kind: z.ZodLiteral<"reference">;
                    id: z.ZodString;
                }, z.core.$strict>], "kind">;
                observedAt: z.ZodISODateTime;
                retrievedAt: z.ZodISODateTime;
                excerpt: z.ZodOptional<z.ZodString>;
                artifactId: z.ZodOptional<z.ZodString>;
                digest: z.ZodString;
                confidence: z.ZodOptional<z.ZodNumber>;
                verification: z.ZodLiteral<"observed">;
            }, z.core.$strict>>>;
            assumptions: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                statement: z.ZodString;
                evidenceIds: z.ZodArray<z.ZodString>;
                validationQuestion: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
            unknowns: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                question: z.ZodString;
                impact: z.ZodString;
            }, z.core.$strict>>;
            knowledgeGaps: z.ZodArray<z.ZodPipe<z.ZodUnknown, z.ZodObject<{
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
            }, z.core.$strict>>>;
            proposals: z.ZodArray<z.ZodPipe<z.ZodUnknown, z.ZodObject<{
                id: z.ZodString;
                targetKind: z.ZodString;
                target: z.ZodDiscriminatedUnion<[z.ZodObject<{
                    kind: z.ZodLiteral<"update">;
                    reference: z.ZodObject<{
                        resourceType: z.ZodString;
                        id: z.ZodString;
                        workspaceId: z.ZodString;
                        version: z.ZodOptional<z.ZodNumber>;
                        revision: z.ZodOptional<z.ZodNumber>;
                        contentHash: z.ZodString;
                    }, z.core.$strict>;
                    expectedUpdatedAt: z.ZodOptional<z.ZodISODateTime>;
                }, z.core.$strict>, z.ZodObject<{
                    kind: z.ZodLiteral<"create">;
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
                }, z.core.$strict>], "kind">;
                candidate: z.ZodPipe<z.ZodUnknown, z.ZodJSONSchema>;
                evidenceIds: z.ZodArray<z.ZodString>;
                rationale: z.ZodString;
                lineageIds: z.ZodArray<z.ZodString>;
            }, z.core.$strict>>>;
            artifacts: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                mediaType: z.ZodString;
                bytes: z.ZodNumber;
                digest: z.ZodString;
            }, z.core.$strict>>;
            warnings: z.ZodArray<z.ZodObject<{
                code: z.ZodString;
                message: z.ZodString;
            }, z.core.$strict>>;
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
        reason: z.ZodString;
        notBefore: z.ZodOptional<z.ZodISODateTime>;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"failure">;
        completeness: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"complete">;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"partial">;
            omissions: z.ZodArray<z.ZodString>;
            reason: z.ZodString;
        }, z.core.$strict>], "kind">;
        content: z.ZodPipe<z.ZodUnknown, z.ZodObject<{
            domainOutput: z.ZodOptional<z.ZodPipe<z.ZodUnknown, z.ZodJSONSchema>>;
            findings: z.ZodArray<z.ZodPipe<z.ZodUnknown, z.ZodObject<{
                id: z.ZodString;
                kind: z.ZodEnum<{
                    unknown: "unknown";
                    observed_fact: "observed_fact";
                    evidence_backed_finding: "evidence_backed_finding";
                    inference: "inference";
                    assumption: "assumption";
                    recommendation: "recommendation";
                }>;
                statement: z.ZodString;
                evidenceIds: z.ZodArray<z.ZodString>;
                lineageIds: z.ZodArray<z.ZodString>;
                confidence: z.ZodOptional<z.ZodNumber>;
                provenance: z.ZodOptional<z.ZodObject<{
                    provider: z.ZodString;
                    adapterKey: z.ZodString;
                    adapterVersion: z.ZodNumber;
                    invocationId: z.ZodString;
                    providerRequestId: z.ZodOptional<z.ZodString>;
                    model: z.ZodOptional<z.ZodString>;
                    modelVersion: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
                payload: z.ZodOptional<z.ZodPipe<z.ZodUnknown, z.ZodJSONSchema>>;
            }, z.core.$strict>>>;
            evidence: z.ZodArray<z.ZodPipe<z.ZodUnknown, z.ZodObject<{
                id: z.ZodString;
                origin: z.ZodEnum<{
                    user_supplied: "user_supplied";
                    external_evidence: "external_evidence";
                    ai_inferred: "ai_inferred";
                }>;
                subject: z.ZodOptional<z.ZodString>;
                claim: z.ZodString;
                candidate: z.ZodOptional<z.ZodPipe<z.ZodUnknown, z.ZodJSONSchema>>;
                provenance: z.ZodObject<{
                    provider: z.ZodString;
                    adapterKey: z.ZodString;
                    adapterVersion: z.ZodNumber;
                    invocationId: z.ZodString;
                    providerRequestId: z.ZodOptional<z.ZodString>;
                    model: z.ZodOptional<z.ZodString>;
                    modelVersion: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>;
                source: z.ZodDiscriminatedUnion<[z.ZodObject<{
                    kind: z.ZodLiteral<"external">;
                    url: z.ZodString;
                }, z.core.$strict>, z.ZodObject<{
                    kind: z.ZodLiteral<"reference">;
                    id: z.ZodString;
                }, z.core.$strict>], "kind">;
                observedAt: z.ZodISODateTime;
                retrievedAt: z.ZodISODateTime;
                excerpt: z.ZodOptional<z.ZodString>;
                artifactId: z.ZodOptional<z.ZodString>;
                digest: z.ZodString;
                confidence: z.ZodOptional<z.ZodNumber>;
                verification: z.ZodLiteral<"observed">;
            }, z.core.$strict>>>;
            assumptions: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                statement: z.ZodString;
                evidenceIds: z.ZodArray<z.ZodString>;
                validationQuestion: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
            unknowns: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                question: z.ZodString;
                impact: z.ZodString;
            }, z.core.$strict>>;
            knowledgeGaps: z.ZodArray<z.ZodPipe<z.ZodUnknown, z.ZodObject<{
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
            }, z.core.$strict>>>;
            proposals: z.ZodArray<z.ZodPipe<z.ZodUnknown, z.ZodObject<{
                id: z.ZodString;
                targetKind: z.ZodString;
                target: z.ZodDiscriminatedUnion<[z.ZodObject<{
                    kind: z.ZodLiteral<"update">;
                    reference: z.ZodObject<{
                        resourceType: z.ZodString;
                        id: z.ZodString;
                        workspaceId: z.ZodString;
                        version: z.ZodOptional<z.ZodNumber>;
                        revision: z.ZodOptional<z.ZodNumber>;
                        contentHash: z.ZodString;
                    }, z.core.$strict>;
                    expectedUpdatedAt: z.ZodOptional<z.ZodISODateTime>;
                }, z.core.$strict>, z.ZodObject<{
                    kind: z.ZodLiteral<"create">;
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
                }, z.core.$strict>], "kind">;
                candidate: z.ZodPipe<z.ZodUnknown, z.ZodJSONSchema>;
                evidenceIds: z.ZodArray<z.ZodString>;
                rationale: z.ZodString;
                lineageIds: z.ZodArray<z.ZodString>;
            }, z.core.$strict>>>;
            artifacts: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                mediaType: z.ZodString;
                bytes: z.ZodNumber;
                digest: z.ZodString;
            }, z.core.$strict>>;
            warnings: z.ZodArray<z.ZodObject<{
                code: z.ZodString;
                message: z.ZodString;
            }, z.core.$strict>>;
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
        error: z.ZodObject<{
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
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"cancelled">;
        completeness: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"complete">;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"partial">;
            omissions: z.ZodArray<z.ZodString>;
            reason: z.ZodString;
        }, z.core.$strict>], "kind">;
        content: z.ZodPipe<z.ZodUnknown, z.ZodObject<{
            domainOutput: z.ZodOptional<z.ZodPipe<z.ZodUnknown, z.ZodJSONSchema>>;
            findings: z.ZodArray<z.ZodPipe<z.ZodUnknown, z.ZodObject<{
                id: z.ZodString;
                kind: z.ZodEnum<{
                    unknown: "unknown";
                    observed_fact: "observed_fact";
                    evidence_backed_finding: "evidence_backed_finding";
                    inference: "inference";
                    assumption: "assumption";
                    recommendation: "recommendation";
                }>;
                statement: z.ZodString;
                evidenceIds: z.ZodArray<z.ZodString>;
                lineageIds: z.ZodArray<z.ZodString>;
                confidence: z.ZodOptional<z.ZodNumber>;
                provenance: z.ZodOptional<z.ZodObject<{
                    provider: z.ZodString;
                    adapterKey: z.ZodString;
                    adapterVersion: z.ZodNumber;
                    invocationId: z.ZodString;
                    providerRequestId: z.ZodOptional<z.ZodString>;
                    model: z.ZodOptional<z.ZodString>;
                    modelVersion: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>>;
                payload: z.ZodOptional<z.ZodPipe<z.ZodUnknown, z.ZodJSONSchema>>;
            }, z.core.$strict>>>;
            evidence: z.ZodArray<z.ZodPipe<z.ZodUnknown, z.ZodObject<{
                id: z.ZodString;
                origin: z.ZodEnum<{
                    user_supplied: "user_supplied";
                    external_evidence: "external_evidence";
                    ai_inferred: "ai_inferred";
                }>;
                subject: z.ZodOptional<z.ZodString>;
                claim: z.ZodString;
                candidate: z.ZodOptional<z.ZodPipe<z.ZodUnknown, z.ZodJSONSchema>>;
                provenance: z.ZodObject<{
                    provider: z.ZodString;
                    adapterKey: z.ZodString;
                    adapterVersion: z.ZodNumber;
                    invocationId: z.ZodString;
                    providerRequestId: z.ZodOptional<z.ZodString>;
                    model: z.ZodOptional<z.ZodString>;
                    modelVersion: z.ZodOptional<z.ZodString>;
                }, z.core.$strict>;
                source: z.ZodDiscriminatedUnion<[z.ZodObject<{
                    kind: z.ZodLiteral<"external">;
                    url: z.ZodString;
                }, z.core.$strict>, z.ZodObject<{
                    kind: z.ZodLiteral<"reference">;
                    id: z.ZodString;
                }, z.core.$strict>], "kind">;
                observedAt: z.ZodISODateTime;
                retrievedAt: z.ZodISODateTime;
                excerpt: z.ZodOptional<z.ZodString>;
                artifactId: z.ZodOptional<z.ZodString>;
                digest: z.ZodString;
                confidence: z.ZodOptional<z.ZodNumber>;
                verification: z.ZodLiteral<"observed">;
            }, z.core.$strict>>>;
            assumptions: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                statement: z.ZodString;
                evidenceIds: z.ZodArray<z.ZodString>;
                validationQuestion: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
            unknowns: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                question: z.ZodString;
                impact: z.ZodString;
            }, z.core.$strict>>;
            knowledgeGaps: z.ZodArray<z.ZodPipe<z.ZodUnknown, z.ZodObject<{
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
            }, z.core.$strict>>>;
            proposals: z.ZodArray<z.ZodPipe<z.ZodUnknown, z.ZodObject<{
                id: z.ZodString;
                targetKind: z.ZodString;
                target: z.ZodDiscriminatedUnion<[z.ZodObject<{
                    kind: z.ZodLiteral<"update">;
                    reference: z.ZodObject<{
                        resourceType: z.ZodString;
                        id: z.ZodString;
                        workspaceId: z.ZodString;
                        version: z.ZodOptional<z.ZodNumber>;
                        revision: z.ZodOptional<z.ZodNumber>;
                        contentHash: z.ZodString;
                    }, z.core.$strict>;
                    expectedUpdatedAt: z.ZodOptional<z.ZodISODateTime>;
                }, z.core.$strict>, z.ZodObject<{
                    kind: z.ZodLiteral<"create">;
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
                }, z.core.$strict>], "kind">;
                candidate: z.ZodPipe<z.ZodUnknown, z.ZodJSONSchema>;
                evidenceIds: z.ZodArray<z.ZodString>;
                rationale: z.ZodString;
                lineageIds: z.ZodArray<z.ZodString>;
            }, z.core.$strict>>>;
            artifacts: z.ZodArray<z.ZodObject<{
                id: z.ZodString;
                mediaType: z.ZodString;
                bytes: z.ZodNumber;
                digest: z.ZodString;
            }, z.core.$strict>>;
            warnings: z.ZodArray<z.ZodObject<{
                code: z.ZodString;
                message: z.ZodString;
            }, z.core.$strict>>;
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
        error: z.ZodObject<{
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
    }, z.core.$strict>], "kind">>;
    usage: z.ZodArray<z.ZodPipe<z.ZodUnknown, z.ZodObject<{
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
    }, z.core.$strict>>>;
}, z.core.$strict>>;
export type AgentOutcome = z.infer<typeof AgentOutcomeSchema>;
export type Outcome = z.infer<typeof OutcomeSchema>;
