import { z } from 'zod';
import { type InputRequest, type InputResponse } from './input.ts';
import { type ResultContent } from './content.ts';
export declare const PSU_REVIEWED_INPUT: "psu_uncertainty_answer_v2";
export declare const PSU_REVIEWED_QUESTION: Readonly<{
    digest: string;
    key: string;
    version: number;
    applicabilityPolicy: string;
    gapKey: string;
    template: string;
    substitutions: string[];
    slots: ({
        required: boolean;
        key: "customer_role";
        target: "customerRole";
        gapId: "gap:assessment_input_responsibilities";
    } | {
        required: boolean;
        key: "supplier_role";
        target: "supplierRole";
        gapId: "gap:assessment_input_responsibilities";
    })[];
    fields: ({
        type: "text";
        maxLength: number;
        key: string;
        label: string;
        required: boolean;
    } | {
        type: "choice";
        options: {
            value: string;
            label: string;
        }[];
        key: string;
        label: string;
        required: boolean;
    } | {
        type: "boolean";
        key: string;
        label: string;
        required: boolean;
    } | {
        type: "number";
        minimum: number;
        maximum: number;
        key: string;
        label: string;
        required: boolean;
    })[];
}>;
export declare function reviewedQuestion(label: string): string;
export declare const ApplicabilitySupportSchema: z.ZodObject<{
    evidenceId: z.ZodString;
    evidenceDigest: z.ZodString;
    field: z.ZodEnum<{
        claim: "claim";
        excerpt: "excerpt";
        "candidate.value": "candidate.value";
    }>;
    start: z.ZodNumber;
    excerpt: z.ZodString;
}, z.core.$strict>;
export declare const ApplicabilitySelectionSchema: z.ZodObject<{
    contractDigest: z.ZodLiteral<string>;
    support: z.ZodArray<z.ZodObject<{
        evidenceId: z.ZodString;
        evidenceDigest: z.ZodString;
        field: z.ZodEnum<{
            claim: "claim";
            excerpt: "excerpt";
            "candidate.value": "candidate.value";
        }>;
        start: z.ZodNumber;
        excerpt: z.ZodString;
    }, z.core.$strict>>;
    assessments: z.ZodTuple<[z.ZodObject<{
        criterionId: z.ZodLiteral<"receipt_and_delivery">;
        digest: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        criterionId: z.ZodLiteral<"downstream_sufficiency">;
        digest: z.ZodString;
    }, z.core.$strict>], null>;
    confirmations: z.ZodObject<{
        meterAssessment: z.ZodObject<{
            confirmed: z.ZodLiteral<true>;
            supportIndexes: z.ZodArray<z.ZodNumber>;
        }, z.core.$strict>;
        dataSupplyUncertainty: z.ZodObject<{
            confirmed: z.ZodLiteral<true>;
            supportIndexes: z.ZodArray<z.ZodNumber>;
        }, z.core.$strict>;
        bothResponsibilitySlots: z.ZodObject<{
            confirmed: z.ZodLiteral<true>;
            supportIndexes: z.ZodArray<z.ZodNumber>;
        }, z.core.$strict>;
    }, z.core.$strict>;
}, z.core.$strict>;
export declare const ApplicabilityReviewSchema: z.ZodObject<{
    contractDigest: z.ZodLiteral<string>;
    support: z.ZodArray<z.ZodObject<{
        evidenceId: z.ZodString;
        evidenceDigest: z.ZodString;
        field: z.ZodEnum<{
            claim: "claim";
            excerpt: "excerpt";
            "candidate.value": "candidate.value";
        }>;
        start: z.ZodNumber;
        excerpt: z.ZodString;
    }, z.core.$strict>>;
    assessments: z.ZodTuple<[z.ZodObject<{
        criterionId: z.ZodLiteral<"receipt_and_delivery">;
        digest: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        criterionId: z.ZodLiteral<"downstream_sufficiency">;
        digest: z.ZodString;
    }, z.core.$strict>], null>;
    confirmations: z.ZodObject<{
        meterAssessment: z.ZodObject<{
            confirmed: z.ZodLiteral<true>;
            supportIndexes: z.ZodArray<z.ZodNumber>;
        }, z.core.$strict>;
        dataSupplyUncertainty: z.ZodObject<{
            confirmed: z.ZodLiteral<true>;
            supportIndexes: z.ZodArray<z.ZodNumber>;
        }, z.core.$strict>;
        bothResponsibilitySlots: z.ZodObject<{
            confirmed: z.ZodLiteral<true>;
            supportIndexes: z.ZodArray<z.ZodNumber>;
        }, z.core.$strict>;
    }, z.core.$strict>;
    kind: z.ZodLiteral<"platform_attributed_applicability_v1">;
    policy: z.ZodLiteral<"psu_source_backed_human_applicability_v1">;
    actor: z.ZodObject<{
        type: z.ZodLiteral<"human">;
        issuer: z.ZodString;
        id: z.ZodString;
    }, z.core.$strict>;
    capacity: z.ZodEnum<{
        partner: "partner";
        client: "client";
    }>;
    requestKey: z.ZodString;
    confirmedAt: z.ZodISODateTime;
    auditAction: z.ZodLiteral<"requested_maker">;
    independentlyVerified: z.ZodLiteral<false>;
    digest: z.ZodString;
}, z.core.$strict>;
export declare const PsuUncertaintyOriginV2: z.ZodPipe<z.ZodUnknown, z.ZodObject<{
    kind: z.ZodLiteral<"psu_uncertainty_origin_v2">;
    applicability: z.ZodObject<{
        contractDigest: z.ZodLiteral<string>;
        support: z.ZodArray<z.ZodObject<{
            evidenceId: z.ZodString;
            evidenceDigest: z.ZodString;
            field: z.ZodEnum<{
                claim: "claim";
                excerpt: "excerpt";
                "candidate.value": "candidate.value";
            }>;
            start: z.ZodNumber;
            excerpt: z.ZodString;
        }, z.core.$strict>>;
        assessments: z.ZodTuple<[z.ZodObject<{
            criterionId: z.ZodLiteral<"receipt_and_delivery">;
            digest: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            criterionId: z.ZodLiteral<"downstream_sufficiency">;
            digest: z.ZodString;
        }, z.core.$strict>], null>;
        confirmations: z.ZodObject<{
            meterAssessment: z.ZodObject<{
                confirmed: z.ZodLiteral<true>;
                supportIndexes: z.ZodArray<z.ZodNumber>;
            }, z.core.$strict>;
            dataSupplyUncertainty: z.ZodObject<{
                confirmed: z.ZodLiteral<true>;
                supportIndexes: z.ZodArray<z.ZodNumber>;
            }, z.core.$strict>;
            bothResponsibilitySlots: z.ZodObject<{
                confirmed: z.ZodLiteral<true>;
                supportIndexes: z.ZodArray<z.ZodNumber>;
            }, z.core.$strict>;
        }, z.core.$strict>;
        kind: z.ZodLiteral<"platform_attributed_applicability_v1">;
        policy: z.ZodLiteral<"psu_source_backed_human_applicability_v1">;
        actor: z.ZodObject<{
            type: z.ZodLiteral<"human">;
            issuer: z.ZodString;
            id: z.ZodString;
        }, z.core.$strict>;
        capacity: z.ZodEnum<{
            partner: "partner";
            client: "client";
        }>;
        requestKey: z.ZodString;
        confirmedAt: z.ZodISODateTime;
        auditAction: z.ZodLiteral<"requested_maker">;
        independentlyVerified: z.ZodLiteral<false>;
        digest: z.ZodString;
    }, z.core.$strict>;
    questionDigest: z.ZodString;
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
}, z.core.$strict>>;
export declare const PsuUncertaintyCheckpointV2: z.ZodObject<{
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
    kind: z.ZodLiteral<"psu_uncertainty_checkpoint_v2">;
    origin: z.ZodPipe<z.ZodUnknown, z.ZodObject<{
        kind: z.ZodLiteral<"psu_uncertainty_origin_v2">;
        applicability: z.ZodObject<{
            contractDigest: z.ZodLiteral<string>;
            support: z.ZodArray<z.ZodObject<{
                evidenceId: z.ZodString;
                evidenceDigest: z.ZodString;
                field: z.ZodEnum<{
                    claim: "claim";
                    excerpt: "excerpt";
                    "candidate.value": "candidate.value";
                }>;
                start: z.ZodNumber;
                excerpt: z.ZodString;
            }, z.core.$strict>>;
            assessments: z.ZodTuple<[z.ZodObject<{
                criterionId: z.ZodLiteral<"receipt_and_delivery">;
                digest: z.ZodString;
            }, z.core.$strict>, z.ZodObject<{
                criterionId: z.ZodLiteral<"downstream_sufficiency">;
                digest: z.ZodString;
            }, z.core.$strict>], null>;
            confirmations: z.ZodObject<{
                meterAssessment: z.ZodObject<{
                    confirmed: z.ZodLiteral<true>;
                    supportIndexes: z.ZodArray<z.ZodNumber>;
                }, z.core.$strict>;
                dataSupplyUncertainty: z.ZodObject<{
                    confirmed: z.ZodLiteral<true>;
                    supportIndexes: z.ZodArray<z.ZodNumber>;
                }, z.core.$strict>;
                bothResponsibilitySlots: z.ZodObject<{
                    confirmed: z.ZodLiteral<true>;
                    supportIndexes: z.ZodArray<z.ZodNumber>;
                }, z.core.$strict>;
            }, z.core.$strict>;
            kind: z.ZodLiteral<"platform_attributed_applicability_v1">;
            policy: z.ZodLiteral<"psu_source_backed_human_applicability_v1">;
            actor: z.ZodObject<{
                type: z.ZodLiteral<"human">;
                issuer: z.ZodString;
                id: z.ZodString;
            }, z.core.$strict>;
            capacity: z.ZodEnum<{
                partner: "partner";
                client: "client";
            }>;
            requestKey: z.ZodString;
            confirmedAt: z.ZodISODateTime;
            auditAction: z.ZodLiteral<"requested_maker">;
            independentlyVerified: z.ZodLiteral<false>;
            digest: z.ZodString;
        }, z.core.$strict>;
        questionDigest: z.ZodString;
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
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare function verifyApplicabilitySupport(raw: unknown, content: Pick<ResultContent, 'evidence'>): {
    contractDigest: string;
    support: {
        evidenceId: string;
        evidenceDigest: string;
        field: "claim" | "excerpt" | "candidate.value";
        start: number;
        excerpt: string;
    }[];
    assessments: [{
        criterionId: "receipt_and_delivery";
        digest: string;
    }, {
        criterionId: "downstream_sufficiency";
        digest: string;
    }];
    confirmations: {
        meterAssessment: {
            confirmed: true;
            supportIndexes: number[];
        };
        dataSupplyUncertainty: {
            confirmed: true;
            supportIndexes: number[];
        };
        bothResponsibilitySlots: {
            confirmed: true;
            supportIndexes: number[];
        };
    };
};
export declare function parseReviewedAnswer(request: InputRequest, response: InputResponse, raw: unknown): {
    statement: string;
    epistemic: "unknown" | "current_claim" | "planned_claim" | "contradicted";
    confirmed: boolean;
    selected: boolean;
    key: "customer_role" | "supplier_role";
    target: "supplierRole" | "customerRole";
    gapId: string;
}[];
export declare function sameReviewedCheckpoint(retained: unknown, current: unknown): boolean;
export declare const PRODUCT_REVIEWED_UNCERTAINTY_MANIFEST: {
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
