/** Review-stage contract only. Neither extraction nor a review selection grants
 * canonical apply/approval authority; Platform must authenticate the reviewer. */
import { z } from 'zod';
import { type InputRequest, type InputResponse } from './input.ts';
export declare const WebsiteDraftFieldSchema: z.ZodObject<{
    binding: z.ZodObject<{
        field: z.ZodEnum<{
            [x: string]: string;
        }>;
        value: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>;
    }, z.core.$strict>;
    basis: z.ZodEnum<{
        source_claim: "source_claim";
        interpretation: "interpretation";
    }>;
    support: z.ZodArray<z.ZodObject<{
        pageDigest: z.ZodString;
        quote: z.ZodString;
        url: z.ZodURL;
        retrievedAt: z.ZodISODateTime;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const WebsiteReviewDraftSchema: z.ZodPipe<z.ZodUnknown, z.ZodObject<{
    kind: z.ZodLiteral<"psu_website_review_draft">;
    version: z.ZodLiteral<1>;
    approval: z.ZodLiteral<"not_approved">;
    fields: z.ZodArray<z.ZodObject<{
        binding: z.ZodObject<{
            field: z.ZodEnum<{
                [x: string]: string;
            }>;
            value: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>;
        }, z.core.$strict>;
        basis: z.ZodEnum<{
            source_claim: "source_claim";
            interpretation: "interpretation";
        }>;
        support: z.ZodArray<z.ZodObject<{
            pageDigest: z.ZodString;
            quote: z.ZodString;
            url: z.ZodURL;
            retrievedAt: z.ZodISODateTime;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    unknowns: z.ZodArray<z.ZodString>;
    questions: z.ZodArray<z.ZodObject<{
        question: z.ZodString;
        reason: z.ZodString;
    }, z.core.$strict>>;
    digest: z.ZodString;
}, z.core.$strict>>;
export type WebsiteReviewDraft = z.infer<typeof WebsiteReviewDraftSchema>;
export declare const WebsiteReviewSelectionSchema: z.ZodPipe<z.ZodUnknown, z.ZodObject<{
    kind: z.ZodLiteral<"psu_website_review_selection">;
    version: z.ZodLiteral<1>;
    draftDigest: z.ZodString;
    fields: z.ZodArray<z.ZodObject<{
        binding: z.ZodObject<{
            field: z.ZodEnum<{
                [x: string]: string;
            }>;
            value: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>;
        }, z.core.$strict>;
        included: z.ZodBoolean;
        confirmedValueDigest: z.ZodNullable<z.ZodString>;
    }, z.core.$strict>>;
}, z.core.$strict>>;
export type WebsiteReviewSelection = z.infer<typeof WebsiteReviewSelectionSchema>;
export declare function startWebsiteReview(raw: unknown): WebsiteReviewSelection;
/** Immutable editor update; changing a value always clears its confirmation. */
export declare function editWebsiteReview(raw: unknown, field: string, value: string | string[]): {
    kind: "psu_website_review_selection";
    version: 1;
    draftDigest: string;
    fields: {
        binding: {
            field: string;
            value: string | string[];
        };
        included: boolean;
        confirmedValueDigest: string | null;
    }[];
};
/** Exact user selection, not a canonical proposal or trusted actor assertion.
 * Original excerpts remain attributed to the original suggested value on edits. */
export declare function validateWebsiteReviewSelection(rawDraft: unknown, rawSelection: unknown): {
    kind: "psu_website_reviewed_selection";
    approval: "not_approved";
    draftDigest: string;
    fields: {
        originalSuggestion?: {
            binding: {
                field: string;
                value: string | string[];
            };
            basis: "source_claim" | "interpretation";
            support: {
                pageDigest: string;
                quote: string;
                url: string;
                retrievedAt: string;
            }[];
        };
        edited: boolean;
        binding: {
            field: string;
            value: string | string[];
        };
        included: boolean;
        confirmedValueDigest: string | null;
    }[];
};
export declare const WEBSITE_REVIEW_INPUT = "psu_website_review_v1";
export declare const WebsiteReviewCheckpointSchema: z.ZodPipe<z.ZodUnknown, z.ZodObject<{
    kind: z.ZodLiteral<"psu_website_review_checkpoint">;
    version: z.ZodLiteral<1>;
    inputDigest: z.ZodString;
    draft: z.ZodPipe<z.ZodUnknown, z.ZodObject<{
        kind: z.ZodLiteral<"psu_website_review_draft">;
        version: z.ZodLiteral<1>;
        approval: z.ZodLiteral<"not_approved">;
        fields: z.ZodArray<z.ZodObject<{
            binding: z.ZodObject<{
                field: z.ZodEnum<{
                    [x: string]: string;
                }>;
                value: z.ZodUnion<readonly [z.ZodString, z.ZodArray<z.ZodString>]>;
            }, z.core.$strict>;
            basis: z.ZodEnum<{
                source_claim: "source_claim";
                interpretation: "interpretation";
            }>;
            support: z.ZodArray<z.ZodObject<{
                pageDigest: z.ZodString;
                quote: z.ZodString;
                url: z.ZodURL;
                retrievedAt: z.ZodISODateTime;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
        unknowns: z.ZodArray<z.ZodString>;
        questions: z.ZodArray<z.ZodObject<{
            question: z.ZodString;
            reason: z.ZodString;
        }, z.core.$strict>>;
        digest: z.ZodString;
    }, z.core.$strict>>;
    unavailable: z.ZodArray<z.ZodString>;
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
export declare function websiteReviewFields(): InputRequest['fields'];
export declare function encodeWebsiteReview(raw: unknown): InputResponse['values'];
export declare function parseWebsiteReviewResponse(request: InputRequest, response: InputResponse, checkpoint: unknown): {
    kind: "psu_website_reviewed_selection";
    approval: "not_approved";
    draftDigest: string;
    fields: {
        originalSuggestion?: {
            binding: {
                field: string;
                value: string | string[];
            };
            basis: "source_claim" | "interpretation";
            support: {
                pageDigest: string;
                quote: string;
                url: string;
                retrievedAt: string;
            }[];
        };
        edited: boolean;
        binding: {
            field: string;
            value: string | string[];
        };
        included: boolean;
        confirmedValueDigest: string | null;
    }[];
};
