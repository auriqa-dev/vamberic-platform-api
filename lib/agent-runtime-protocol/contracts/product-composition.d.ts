import { z } from 'zod';
import { ImportedSupportSchema } from './effectiveness.ts';
import { type ResultContent } from './content.ts';
import { AnswerProvenanceSchema } from './answer-provenance.ts';
import { FactSubmissionCheckpointSchema } from './product-fact-submission.ts';
import type { InputRequest, InputResponse } from './input.ts';
export declare const ProductRevisionPinSchema: z.ZodObject<{
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
    evaluation: z.ZodObject<{
        resultId: z.ZodString;
        envelopeDigest: z.ZodString;
    }, z.core.$strict>;
}, z.core.$strict>;
/** Integrity only: a digest never authenticates an author or supplies authority. */
export declare const ProductAppendProofSchema: z.ZodPipe<z.ZodUnknown, z.ZodObject<{
    kind: z.ZodLiteral<"psu_exact_list_append_v1">;
    version: z.ZodLiteral<1>;
    field: z.ZodLiteral<"explicitExclusions">;
    prior: z.ZodObject<{
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
        evaluation: z.ZodObject<{
            resultId: z.ZodString;
            envelopeDigest: z.ZodString;
        }, z.core.$strict>;
    }, z.core.$strict>;
    priorListDigest: z.ZodString;
    resultListDigest: z.ZodString;
    retained: z.ZodArray<z.ZodObject<{
        index: z.ZodNumber;
        evidenceIndex: z.ZodNumber;
        support: z.ZodObject<{
            localEvidenceId: z.ZodString;
            sourceResultId: z.ZodString;
            sourceEnvelopeDigest: z.ZodString;
            sourceEvidenceId: z.ZodString;
            sourceEvidenceDigest: z.ZodString;
        }, z.core.$strict>;
    }, z.core.$strict>>;
    additions: z.ZodArray<z.ZodObject<{
        index: z.ZodNumber;
        evidenceId: z.ZodString;
        factId: z.ZodString;
        slotKey: z.ZodString;
        requestId: z.ZodString;
        responseDigest: z.ZodString;
        attestationDigest: z.ZodString;
    }, z.core.$strict>>;
    digest: z.ZodString;
}, z.core.$strict>>;
export type ProductAppendProof = z.infer<typeof ProductAppendProofSchema>;
export type ProductAppendMaterial = {
    /** Independently resolve these values from trusted prepared/persisted state. */
    pin: z.infer<typeof ProductRevisionPinSchema>;
    priorContent: ResultContent;
    imports: z.infer<typeof ImportedSupportSchema>;
    answer: {
        request: InputRequest;
        response: InputResponse;
        checkpoint: z.infer<typeof FactSubmissionCheckpointSchema>;
        provenance: z.infer<typeof AnswerProvenanceSchema>;
    };
};
/** Pure ordered-composition proof. Independently verify manifest, persisted
 * Candidate/Evaluation/answer, authority, fence and freshness before using it.
 * Self-asserted material supplies no trust. This is not an admission handler. */
export declare function validateProductAppend(value: unknown, findingId: string, material: ProductAppendMaterial): ProductAppendProof;
/** Local structure only; persisted admission must also call validateProductAppend
 * against independently resolved material for every newly produced proof. */
export declare function productAppendValue(content: ResultContent, findingId: string): string[];
export declare function validateModernProductContent(value: unknown, complete?: boolean): ResultContent;
/** Authenticated Platform context only. Witness observations stay byte-identical;
 * historical Result identities are attribution, never ordinary read grants. */
export declare const ProductCanonicalContextSchema: z.ZodPipe<z.ZodUnknown, z.ZodObject<{
    kind: z.ZodLiteral<"canonical_support_context">;
    schemaVersion: z.ZodLiteral<1>;
    root: z.ZodObject<{
        resourceType: z.ZodString;
        id: z.ZodString;
        workspaceId: z.ZodString;
        version: z.ZodOptional<z.ZodNumber>;
        revision: z.ZodOptional<z.ZodNumber>;
        contentHash: z.ZodString;
    }, z.core.$strict>;
    certificateId: z.ZodString;
    certificateDigest: z.ZodString;
    snapshotDigest: z.ZodString;
    evidenceDigest: z.ZodString;
    dependencies: z.ZodArray<z.ZodObject<{
        resourceType: z.ZodString;
        id: z.ZodString;
        workspaceId: z.ZodString;
        version: z.ZodOptional<z.ZodNumber>;
        revision: z.ZodOptional<z.ZodNumber>;
        contentHash: z.ZodString;
    }, z.core.$strict>>;
    composed: z.ZodArray<z.ZodObject<{
        field: z.ZodLiteral<"explicitExclusions">;
        value: z.ZodArray<z.ZodString>;
        findingJson: z.ZodString;
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
    }, z.core.$strict>>;
}, z.core.$strict>>;
export declare function canonicalProductFinding(item: z.infer<typeof ProductCanonicalContextSchema>['composed'][number]): {
    id: string;
    kind: "unknown" | "observed_fact" | "evidence_backed_finding" | "inference" | "assumption" | "recommendation";
    statement: string;
    evidenceIds: string[];
    lineageIds: string[];
    confidence?: number | undefined;
    provenance?: {
        provider: string;
        adapterKey: string;
        adapterVersion: number;
        invocationId: string;
        providerRequestId?: string | undefined;
        model?: string | undefined;
        modelVersion?: string | undefined;
    } | undefined;
    payload?: z.core.util.JSONType | undefined;
};
