import { z } from 'zod';
import { type InputRequest, type InputResponse } from './input.ts';
export declare const PSU_FACT_POLICY: "psu_human_facts_v2";
export declare const PSU_FACT_INPUT: "psu_revision_fact_submission";
export declare const FactSlotSchema: z.ZodObject<{
    key: z.ZodString;
    target: z.ZodEnum<{
        explicitExclusions: "explicitExclusions";
        whatCustomerBuys: "whatCustomerBuys";
        supplierRole: "supplierRole";
        customerRole: "customerRole";
    }>;
    defectId: z.ZodString;
}, z.core.$strict>;
export declare const FactSlotsSchema: z.ZodArray<z.ZodObject<{
    key: z.ZodString;
    target: z.ZodEnum<{
        explicitExclusions: "explicitExclusions";
        whatCustomerBuys: "whatCustomerBuys";
        supplierRole: "supplierRole";
        customerRole: "customerRole";
    }>;
    defectId: z.ZodString;
}, z.core.$strict>>;
export declare const FactSubmissionCheckpointSchema: z.ZodObject<{
    policy: z.ZodLiteral<"psu_human_facts_v2">;
    base: z.ZodPipe<z.ZodUnknown, z.ZodObject<{
        schemaVersion: z.ZodLiteral<1>;
        stage: z.ZodEnum<{
            orient: "orient";
            gather: "gather";
            structure: "structure";
            clarify: "clarify";
            synthesize: "synthesize";
        }>;
        scope: z.ZodDiscriminatedUnion<[z.ZodObject<{
            mode: z.ZodLiteral<"create">;
            brand: z.ZodObject<{
                resourceType: z.ZodString;
                id: z.ZodString;
                workspaceId: z.ZodString;
                version: z.ZodOptional<z.ZodNumber>;
                revision: z.ZodOptional<z.ZodNumber>;
                contentHash: z.ZodString;
            }, z.core.$strict>;
            workingLabel: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            mode: z.ZodLiteral<"refresh">;
            target: z.ZodObject<{
                resourceType: z.ZodString;
                id: z.ZodString;
                workspaceId: z.ZodString;
                version: z.ZodOptional<z.ZodNumber>;
                revision: z.ZodOptional<z.ZodNumber>;
                contentHash: z.ZodString;
            }, z.core.$strict>;
            expectedUpdatedAt: z.ZodISODateTime;
            workingLabel: z.ZodString;
        }, z.core.$strict>], "mode">;
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
        questionKeys: z.ZodArray<z.ZodString>;
        inputCycles: z.ZodNumber;
        sourceDigests: z.ZodArray<z.ZodObject<{
            reference: z.ZodObject<{
                resourceType: z.ZodString;
                id: z.ZodString;
                workspaceId: z.ZodString;
                version: z.ZodOptional<z.ZodNumber>;
                revision: z.ZodOptional<z.ZodNumber>;
                contentHash: z.ZodString;
            }, z.core.$strict>;
            digest: z.ZodString;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    slots: z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        target: z.ZodEnum<{
            explicitExclusions: "explicitExclusions";
            whatCustomerBuys: "whatCustomerBuys";
            supplierRole: "supplierRole";
            customerRole: "customerRole";
        }>;
        defectId: z.ZodString;
    }, z.core.$strict>>;
    inputDigest: z.ZodString;
}, z.core.$strict>;
declare const statuses: readonly ["current_claim", "planned_claim", "unknown", "contradicted"];
export declare function factSubmissionFields(raw: unknown): InputRequest['fields'];
/** Shared server/Runtime validation; never trims or interprets a human assertion. */
export declare function parseFactSubmission(request: InputRequest, response: InputResponse, checkpoint: unknown): {
    statement: string;
    epistemic: (typeof statuses)[number];
    confirmed: boolean;
    selected: boolean;
    key: string;
    target: "explicitExclusions" | "whatCustomerBuys" | "supplierRole" | "customerRole";
    defectId: string;
}[];
export declare const PRODUCT_GENERAL_MANIFEST: {
    implementation: {
        key: string;
        version: number;
    };
    compatibleDefinitions: {
        key: string;
        version: number;
    }[];
    protocolVersions: ("1.2" | "1.1")[];
    operations: string[];
    resultSchemaVersions: number[];
    checkpointSchemaVersions: number[];
    instruction: {
        version: number;
        hash: string;
    };
    buildDigest: string;
    manifestDigest: string;
} | {
    protocolVersions: ("1.2" | "1.1" | "2.0")[];
    implementation: {
        key: string;
        version: number;
    };
    compatibleDefinitions: {
        key: string;
        version: number;
    }[];
    operations: string[];
    resultSchemaVersions: number[];
    checkpointSchemaVersions: number[];
    instruction: {
        version: number;
        hash: string;
    };
    buildDigest: string;
    manifestDigest: string;
};
export {};
