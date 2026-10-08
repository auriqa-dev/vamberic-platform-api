import { z } from 'zod';
export declare const SourceLineageSchema: z.ZodPipe<z.ZodUnknown, z.ZodObject<{
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
}, z.core.$strict>>;
export type SourceLineage = z.infer<typeof SourceLineageSchema>;
export declare const ProvenanceSchema: z.ZodObject<{
    provider: z.ZodString;
    adapterKey: z.ZodString;
    adapterVersion: z.ZodNumber;
    invocationId: z.ZodString;
    providerRequestId: z.ZodOptional<z.ZodString>;
    model: z.ZodOptional<z.ZodString>;
    modelVersion: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const FindingSchema: z.ZodPipe<z.ZodUnknown, z.ZodObject<{
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
}, z.core.$strict>>;
export declare const EvidenceObservationSchema: z.ZodPipe<z.ZodUnknown, z.ZodObject<{
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
}, z.core.$strict>>;
export declare const ParentSchema: z.ZodObject<{
    relationship: z.ZodString;
    reference: z.ZodObject<{
        resourceType: z.ZodString;
        id: z.ZodString;
        workspaceId: z.ZodString;
        version: z.ZodOptional<z.ZodNumber>;
        revision: z.ZodOptional<z.ZodNumber>;
        contentHash: z.ZodString;
    }, z.core.$strict>;
}, z.core.$strict>;
export declare const ProposalSchema: z.ZodPipe<z.ZodUnknown, z.ZodObject<{
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
}, z.core.$strict>>;
export declare const AssumptionSchema: z.ZodObject<{
    id: z.ZodString;
    statement: z.ZodString;
    evidenceIds: z.ZodArray<z.ZodString>;
    validationQuestion: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const UnknownSchema: z.ZodObject<{
    id: z.ZodString;
    question: z.ZodString;
    impact: z.ZodString;
}, z.core.$strict>;
export declare const WarningSchema: z.ZodObject<{
    code: z.ZodString;
    message: z.ZodString;
}, z.core.$strict>;
export declare const ArtifactReferenceSchema: z.ZodObject<{
    id: z.ZodString;
    mediaType: z.ZodString;
    bytes: z.ZodNumber;
    digest: z.ZodString;
}, z.core.$strict>;
export declare const ResultContentSchema: z.ZodPipe<z.ZodUnknown, z.ZodObject<{
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
export type ResultContent = z.infer<typeof ResultContentSchema>;
export declare function emptyContent(): ResultContent;
export type Finding = z.infer<typeof FindingSchema>;
export type EvidenceObservation = z.infer<typeof EvidenceObservationSchema>;
export type Proposal = z.infer<typeof ProposalSchema>;
export type Provenance = z.infer<typeof ProvenanceSchema>;
