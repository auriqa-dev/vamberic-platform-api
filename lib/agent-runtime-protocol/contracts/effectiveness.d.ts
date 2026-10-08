import { z } from 'zod';
import { type ResultContent } from './content.ts';
export declare const EffectivenessIdentitySchema: z.ZodObject<{
    key: z.ZodString;
    version: z.ZodNumber;
    digest: z.ZodString;
}, z.core.$strict>;
export declare const CriterionSchema: z.ZodObject<{
    id: z.ZodString;
    version: z.ZodNumber;
    category: z.ZodEnum<{
        validity: "validity";
        effectiveness: "effectiveness";
        brand: "brand";
    }>;
    requirement: z.ZodString;
    rationale: z.ZodString;
    importance: z.ZodEnum<{
        mandatory: "mandatory";
        advisory: "advisory";
    }>;
    method: z.ZodEnum<{
        deterministic: "deterministic";
        judgement: "judgement";
    }>;
    methodKey: z.ZodString;
    evidence: z.ZodEnum<{
        required: "required";
        none: "none";
    }>;
    applicabilityRule: z.ZodString;
    consequenceKey: z.ZodString;
    lineageIds: z.ZodArray<z.ZodString>;
}, z.core.$strict>;
export declare const CriteriaSetSchema: z.ZodPipe<z.ZodUnknown, z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    profile: z.ZodObject<{
        key: z.ZodString;
        version: z.ZodNumber;
        digest: z.ZodString;
    }, z.core.$strict>;
    objective: z.ZodString;
    intendedNextAction: z.ZodString;
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
    criteria: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        version: z.ZodNumber;
        category: z.ZodEnum<{
            validity: "validity";
            effectiveness: "effectiveness";
            brand: "brand";
        }>;
        requirement: z.ZodString;
        rationale: z.ZodString;
        importance: z.ZodEnum<{
            mandatory: "mandatory";
            advisory: "advisory";
        }>;
        method: z.ZodEnum<{
            deterministic: "deterministic";
            judgement: "judgement";
        }>;
        methodKey: z.ZodString;
        evidence: z.ZodEnum<{
            required: "required";
            none: "none";
        }>;
        applicabilityRule: z.ZodString;
        consequenceKey: z.ZodString;
        lineageIds: z.ZodArray<z.ZodString>;
    }, z.core.$strict>>;
    digest: z.ZodString;
}, z.core.$strict>>;
export type CriteriaSet = z.infer<typeof CriteriaSetSchema>;
export declare const CandidateSelectorSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"domain_output">;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"proposal">;
    proposalId: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"artifact">;
    artifactId: z.ZodString;
}, z.core.$strict>], "kind">;
export declare const CandidateRefSchema: z.ZodObject<{
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
export type CandidateRef = z.infer<typeof CandidateRefSchema>;
export declare const CriterionAssessmentSchema: z.ZodObject<{
    criterionId: z.ZodString;
    outcome: z.ZodEnum<{
        pass: "pass";
        fail: "fail";
        uncertain: "uncertain";
        not_applicable: "not_applicable";
    }>;
    method: z.ZodEnum<{
        deterministic: "deterministic";
        judgement: "judgement";
    }>;
    methodKey: z.ZodString;
    rationale: z.ZodString;
    evidenceIds: z.ZodArray<z.ZodString>;
    findingIds: z.ZodArray<z.ZodString>;
    lineageIds: z.ZodArray<z.ZodString>;
    gapIds: z.ZodArray<z.ZodString>;
    provenance: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"deterministic">;
        check: z.ZodObject<{
            key: z.ZodString;
            version: z.ZodNumber;
            digest: z.ZodString;
        }, z.core.$strict>;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"model">;
        invocationIds: z.ZodArray<z.ZodString>;
    }, z.core.$strict>], "kind">;
}, z.core.$strict>;
export declare const EvaluationPayloadSchema: z.ZodPipe<z.ZodUnknown, z.ZodObject<{
    kind: z.ZodLiteral<"effectiveness_evaluation">;
    schemaVersion: z.ZodLiteral<1>;
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
    criteriaDigest: z.ZodString;
    policy: z.ZodObject<{
        key: z.ZodString;
        version: z.ZodNumber;
        digest: z.ZodString;
    }, z.core.$strict>;
    requestKey: z.ZodString;
    instruction: z.ZodObject<{
        version: z.ZodNumber;
        hash: z.ZodString;
        key: z.ZodString;
    }, z.core.$strict>;
    assessments: z.ZodArray<z.ZodObject<{
        criterionId: z.ZodString;
        outcome: z.ZodEnum<{
            pass: "pass";
            fail: "fail";
            uncertain: "uncertain";
            not_applicable: "not_applicable";
        }>;
        method: z.ZodEnum<{
            deterministic: "deterministic";
            judgement: "judgement";
        }>;
        methodKey: z.ZodString;
        rationale: z.ZodString;
        evidenceIds: z.ZodArray<z.ZodString>;
        findingIds: z.ZodArray<z.ZodString>;
        lineageIds: z.ZodArray<z.ZodString>;
        gapIds: z.ZodArray<z.ZodString>;
        provenance: z.ZodDiscriminatedUnion<[z.ZodObject<{
            kind: z.ZodLiteral<"deterministic">;
            check: z.ZodObject<{
                key: z.ZodString;
                version: z.ZodNumber;
                digest: z.ZodString;
            }, z.core.$strict>;
        }, z.core.$strict>, z.ZodObject<{
            kind: z.ZodLiteral<"model">;
            invocationIds: z.ZodArray<z.ZodString>;
        }, z.core.$strict>], "kind">;
    }, z.core.$strict>>;
    defects: z.ZodArray<z.ZodObject<{
        criterionId: z.ZodString;
        findingId: z.ZodString;
        type: z.ZodString;
        location: z.ZodString;
        requirement: z.ZodString;
    }, z.core.$strict>>;
    summary: z.ZodString;
}, z.core.$strict>>;
export type EvaluationPayload = z.infer<typeof EvaluationPayloadSchema>;
export declare const ImportedSupportSchema: z.ZodPipe<z.ZodUnknown, z.ZodArray<z.ZodObject<{
    localEvidenceId: z.ZodString;
    sourceResultId: z.ZodString;
    sourceEnvelopeDigest: z.ZodString;
    sourceEvidenceId: z.ZodString;
    sourceEvidenceDigest: z.ZodString;
}, z.core.$strict>>>;
export declare const EvaluationInputSchema: z.ZodPipe<z.ZodUnknown, z.ZodObject<{
    kind: z.ZodLiteral<"effectiveness_evaluation_request">;
    schemaVersion: z.ZodLiteral<1>;
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
    criteria: z.ZodPipe<z.ZodUnknown, z.ZodObject<{
        schemaVersion: z.ZodLiteral<1>;
        profile: z.ZodObject<{
            key: z.ZodString;
            version: z.ZodNumber;
            digest: z.ZodString;
        }, z.core.$strict>;
        objective: z.ZodString;
        intendedNextAction: z.ZodString;
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
        criteria: z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            version: z.ZodNumber;
            category: z.ZodEnum<{
                validity: "validity";
                effectiveness: "effectiveness";
                brand: "brand";
            }>;
            requirement: z.ZodString;
            rationale: z.ZodString;
            importance: z.ZodEnum<{
                mandatory: "mandatory";
                advisory: "advisory";
            }>;
            method: z.ZodEnum<{
                deterministic: "deterministic";
                judgement: "judgement";
            }>;
            methodKey: z.ZodString;
            evidence: z.ZodEnum<{
                required: "required";
                none: "none";
            }>;
            applicabilityRule: z.ZodString;
            consequenceKey: z.ZodString;
            lineageIds: z.ZodArray<z.ZodString>;
        }, z.core.$strict>>;
        digest: z.ZodString;
    }, z.core.$strict>>;
    policy: z.ZodObject<{
        key: z.ZodString;
        version: z.ZodNumber;
        digest: z.ZodString;
    }, z.core.$strict>;
    requestKey: z.ZodString;
    instruction: z.ZodObject<{
        version: z.ZodNumber;
        hash: z.ZodString;
        key: z.ZodString;
    }, z.core.$strict>;
    importedSupport: z.ZodPipe<z.ZodUnknown, z.ZodArray<z.ZodObject<{
        localEvidenceId: z.ZodString;
        sourceResultId: z.ZodString;
        sourceEnvelopeDigest: z.ZodString;
        sourceEvidenceId: z.ZodString;
        sourceEvidenceDigest: z.ZodString;
    }, z.core.$strict>>>;
}, z.core.$strict>>;
export type EvaluationInput = z.infer<typeof EvaluationInputSchema>;
/** Local contract validation only. Platform supplies applicability decisions and
 * independently verifies authoritative source/identity/permission checks. */
export declare function validateEvaluation(contentValue: unknown, inputValue: unknown, options: {
    allowedNotApplicable: readonly string[];
    modelInvocationIds: readonly string[];
}): EvaluationPayload;
/** Import provenance is immutable. This never grants a provider call. */
export declare function importedEvidenceMatches(observation: ResultContent['evidence'][number], input: Pick<EvaluationInput, 'importedSupport'>, sources: readonly {
    resultId: string;
    envelopeDigest: string;
    content: ResultContent;
}[]): boolean;
export declare function selectedCandidate(content: ResultContent, selector: z.infer<typeof CandidateSelectorSchema>): z.core.util.JSONType;
/** Reviewed layers in authority order. Lower layers may add constraints or
 * strengthen advisory to mandatory; they cannot redefine an existing identity. */
export declare function assembleCriteriaSet(metadata: Omit<CriteriaSet, 'criteria' | 'digest'>, layers: readonly (readonly z.infer<typeof CriterionSchema>[])[]): CriteriaSet;
