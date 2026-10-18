import { z } from 'zod';
import { type InputRequest, type InputResponse } from './input.ts';
export declare const PSU_UNCERTAINTY_INPUT: "psu_uncertainty_answer_v1";
export declare const PSU_UNCERTAINTY_GAP: "assessment_input_responsibilities";
export declare const PsuUncertaintyOriginV1: z.ZodObject<{
    kind: z.ZodLiteral<"psu_uncertainty_origin_v1">;
    predecessorCaseId: z.ZodString;
    predecessorRevision: z.ZodNumber;
    workspaceId: z.ZodString;
    targetDigest: z.ZodString;
    candidate: z.ZodObject<{
        caseId: z.ZodString;
        revision: z.ZodNumber;
        runId: z.ZodString;
        attemptId: z.ZodString;
        resultId: z.ZodString;
        envelopeDigest: z.ZodString;
        contentDigest: z.ZodString;
        selector: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"domain_output">;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"proposal">;
            proposalId: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"artifact">;
            artifactId: z.ZodString;
        }, z.core.$strict>], "kind">;
    }, z.core.$strict>;
    evaluationResultId: z.ZodString;
    evaluationEnvelopeDigest: z.ZodString;
    evaluationDigest: z.ZodString;
    criteriaDigest: z.ZodString;
    profileDigest: z.ZodString;
    policyDigest: z.ZodString;
    criterionIds: z.ZodTuple<[z.ZodLiteral<"receipt_and_delivery">, z.ZodLiteral<"downstream_sufficiency">], null>;
    gapKey: z.ZodLiteral<"assessment_input_responsibilities">;
    priorRequestCount: z.ZodNumber;
    ancestorCaseIds: z.ZodArray<z.ZodString>;
}, z.core.$strict>;
export declare const PsuUncertaintySlotsV1: z.ZodArray<z.ZodObject<{
    key: z.ZodEnum<{
        customer_role: "customer_role";
        supplier_role: "supplier_role";
    }>;
    target: z.ZodEnum<{
        supplierRole: "supplierRole";
        customerRole: "customerRole";
    }>;
    gapId: z.ZodString;
}, z.core.$strict>>;
export declare const PsuUncertaintyCheckpointV1: z.ZodObject<{
    kind: z.ZodLiteral<"psu_uncertainty_checkpoint_v1">;
    origin: z.ZodObject<{
        kind: z.ZodLiteral<"psu_uncertainty_origin_v1">;
        predecessorCaseId: z.ZodString;
        predecessorRevision: z.ZodNumber;
        workspaceId: z.ZodString;
        targetDigest: z.ZodString;
        candidate: z.ZodObject<{
            caseId: z.ZodString;
            revision: z.ZodNumber;
            runId: z.ZodString;
            attemptId: z.ZodString;
            resultId: z.ZodString;
            envelopeDigest: z.ZodString;
            contentDigest: z.ZodString;
            selector: z.ZodDiscriminatedUnion<[z.ZodObject<{
                kind: z.ZodLiteral<"domain_output">;
            }, z.core.$strict>, z.ZodObject<{
                kind: z.ZodLiteral<"proposal">;
                proposalId: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                kind: z.ZodLiteral<"artifact">;
                artifactId: z.ZodString;
            }, z.core.$strict>], "kind">;
        }, z.core.$strict>;
        evaluationResultId: z.ZodString;
        evaluationEnvelopeDigest: z.ZodString;
        evaluationDigest: z.ZodString;
        criteriaDigest: z.ZodString;
        profileDigest: z.ZodString;
        policyDigest: z.ZodString;
        criterionIds: z.ZodTuple<[z.ZodLiteral<"receipt_and_delivery">, z.ZodLiteral<"downstream_sufficiency">], null>;
        gapKey: z.ZodLiteral<"assessment_input_responsibilities">;
        priorRequestCount: z.ZodNumber;
        ancestorCaseIds: z.ZodArray<z.ZodString>;
    }, z.core.$strict>;
    inputDigest: z.ZodString;
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
        key: z.ZodEnum<{
            customer_role: "customer_role";
            supplier_role: "supplier_role";
        }>;
        target: z.ZodEnum<{
            supplierRole: "supplierRole";
            customerRole: "customerRole";
        }>;
        gapId: z.ZodString;
    }, z.core.$strict>>;
}, z.core.$strict>;
declare const statuses: readonly ["current_claim", "planned_claim", "unknown", "contradicted"];
export declare function uncertaintyFields(raw: unknown): InputRequest['fields'];
export declare const PsuUncertaintyAnswerRequestV1: z.ZodPipe<z.ZodUnknown, z.ZodObject<{
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
export declare function parseUncertaintyAnswer(request: InputRequest, response: InputResponse, checkpoint: unknown): {
    statement: string;
    epistemic: (typeof statuses)[number];
    confirmed: boolean;
    selected: boolean;
    key: "customer_role" | "supplier_role";
    target: "supplierRole" | "customerRole";
    gapId: string;
}[];
export declare const PRODUCT_UNCERTAINTY_MANIFEST: {
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
