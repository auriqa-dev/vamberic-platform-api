/** Review-stage contract only. Neither extraction nor a review selection grants
 * canonical apply/approval authority; Platform must authenticate the reviewer. */
import { z } from 'zod';
import { bounded, digest, digestWithout } from "./json.js";
import { OfferingContentSchema, ProductBindingSchema, } from "./product-service.js";
import { validateInputResponse, } from "./input.js";
import { ReferenceSchema } from "./primitives.js";
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const WebsiteDraftFieldSchema = z
    .strictObject({
    binding: ProductBindingSchema,
    basis: z.enum(['source_claim', 'interpretation']),
    support: z
        .array(z.strictObject({
        pageDigest: hash,
        quote: z.string().min(1).max(2000),
        url: z.url().max(2048),
        retrievedAt: z.iso.datetime(),
    }))
        .min(1)
        .max(3),
})
    .superRefine((item, ctx) => {
    const schema = OfferingContentSchema.shape[item.binding.field];
    const parsed = schema.safeParse(item.binding.value);
    if (!parsed.success || digest(parsed.data) !== digest(item.binding.value))
        ctx.addIssue({
            code: 'custom',
            message: 'Invalid exact Offering field value',
        });
});
export const WebsiteReviewDraftSchema = bounded(z
    .strictObject({
    kind: z.literal('psu_website_review_draft'),
    version: z.literal(1),
    approval: z.literal('not_approved'),
    fields: z.array(WebsiteDraftFieldSchema).max(20),
    unknowns: z.array(z.string().min(1).max(500)).max(20),
    questions: z
        .array(z.strictObject({
        question: z.string().min(1).max(500),
        reason: z.string().min(1).max(1000),
    }))
        .max(3),
    digest: hash,
})
    .refine((v) => new Set(v.fields.map((f) => f.binding.field)).size === v.fields.length, 'Duplicate review field')
    .refine((v) => digestWithout(v, 'digest') === v.digest, 'Draft digest mismatch'), 24576);
export const WebsiteReviewSelectionSchema = bounded(z
    .strictObject({
    kind: z.literal('psu_website_review_selection'),
    version: z.literal(1),
    draftDigest: hash,
    fields: z
        .array(z.strictObject({
        binding: ProductBindingSchema,
        included: z.boolean(),
        confirmedValueDigest: hash.nullable(),
    }))
        .max(20),
})
    .refine((v) => new Set(v.fields.map((f) => f.binding.field)).size === v.fields.length, 'Duplicate selection field'), 24576);
export function startWebsiteReview(raw) {
    const draft = WebsiteReviewDraftSchema.parse(raw);
    return WebsiteReviewSelectionSchema.parse({
        kind: 'psu_website_review_selection',
        version: 1,
        draftDigest: draft.digest,
        fields: draft.fields.map((f) => ({
            binding: f.binding,
            included: true,
            confirmedValueDigest: null,
        })),
    });
}
/** Immutable editor update; changing a value always clears its confirmation. */
export function editWebsiteReview(raw, field, value) {
    const selection = WebsiteReviewSelectionSchema.parse(raw);
    if (!selection.fields.some((f) => f.binding.field === field))
        throw new Error('Unknown review field');
    return WebsiteReviewSelectionSchema.parse({
        ...selection,
        fields: selection.fields.map((f) => f.binding.field === field
            ? { ...f, binding: { ...f.binding, value }, confirmedValueDigest: null }
            : f),
    });
}
/** Exact user selection, not a canonical proposal or trusted actor assertion.
 * Original excerpts remain attributed to the original suggested value on edits. */
export function validateWebsiteReviewSelection(rawDraft, rawSelection) {
    const draft = WebsiteReviewDraftSchema.parse(rawDraft);
    const selection = WebsiteReviewSelectionSchema.parse(rawSelection);
    if (selection.draftDigest !== draft.digest)
        throw new Error('Review draft changed');
    const fields = selection.fields.map((f) => {
        const original = draft.fields.find((d) => d.binding.field === f.binding.field);
        const schema = OfferingContentSchema.shape[f.binding.field];
        if (digest(schema.parse(f.binding.value)) !== digest(f.binding.value))
            throw new Error('Invalid exact reviewed value');
        if (f.included && f.confirmedValueDigest !== digest(f.binding))
            throw new Error('Confirm the current value');
        return {
            ...f,
            edited: !original || digest(f.binding) !== digest(original.binding),
            ...(original ? { originalSuggestion: original } : {}),
        };
    });
    if (!fields.some((f) => f.included))
        throw new Error('No reviewed fields selected');
    return {
        kind: 'psu_website_reviewed_selection',
        approval: 'not_approved',
        draftDigest: draft.digest,
        fields,
    };
}
export const WEBSITE_REVIEW_INPUT = 'psu_website_review_v1';
export const WebsiteReviewCheckpointSchema = bounded(z.strictObject({
    kind: z.literal('psu_website_review_checkpoint'),
    version: z.literal(1),
    inputDigest: hash,
    draft: WebsiteReviewDraftSchema,
    unavailable: z.array(z.string().max(2048)).max(6),
    sourceDigests: z
        .array(z.strictObject({ reference: ReferenceSchema, digest: hash }))
        .max(20),
}), 32768);
export function websiteReviewFields() {
    return [
        ...Array.from({ length: 7 }, (_, i) => ({
            key: `review_${i}`,
            label: 'Reviewed product details',
            type: 'text',
            required: true,
            maxLength: 4000,
        })),
        {
            key: 'confirm',
            label: 'I have reviewed these details and want them independently checked.',
            type: 'boolean',
            required: true,
        },
    ];
}
export function encodeWebsiteReview(raw) {
    const json = JSON.stringify(WebsiteReviewSelectionSchema.parse(raw));
    if (json.length > 28000)
        throw new Error('Review exceeds response bound');
    // Preserve Unicode code points at generic input field boundaries.
    const parts = [];
    let part = '';
    for (const c of json) {
        if (part.length + c.length > 4000) {
            parts.push(part);
            part = '';
        }
        part += c;
    }
    parts.push(part);
    if (parts.length > 7)
        throw new Error('Review exceeds response bound');
    return [
        ...Array.from({ length: 7 }, (_, i) => ({
            key: `review_${i}`,
            value: parts[i] ?? '',
        })),
        { key: 'confirm', value: true },
    ];
}
export function parseWebsiteReviewResponse(request, response, checkpoint) {
    const pin = WebsiteReviewCheckpointSchema.parse(checkpoint);
    validateInputResponse(request, response);
    if (request.schemaKey !== WEBSITE_REVIEW_INPUT ||
        request.schemaVersion !== 1 ||
        digest(request.fields) !== digest(websiteReviewFields()) ||
        response.values.find((v) => v.key === 'confirm')?.value !== true)
        throw new Error('Exact website review confirmation required');
    const json = Array.from({ length: 7 }, (_, i) => response.values.find((v) => v.key === `review_${i}`)?.value).join('');
    return validateWebsiteReviewSelection(pin.draft, JSON.parse(json));
}
//# sourceMappingURL=product-website-review.js.map