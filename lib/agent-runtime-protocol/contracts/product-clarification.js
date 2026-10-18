/** Versioned general clarification: exact scalar facts, independent applicability. */
import { z } from 'zod';
import { digest, digestWithout, bounded } from "./json.js";
import { HashSchema } from "./primitives.js";
import { ApplicabilitySupportSchema } from "./product-uncertainty-v2.js";
import { PsuUncertaintyOriginV1, PsuUncertaintyCheckpointV1, uncertaintyFields, PRODUCT_UNCERTAINTY_MANIFEST, } from "./product-uncertainty.js";
import { RuntimeImplementationManifestSchema } from "./work-v2.js";
import { validateInputResponse, } from "./input.js";
export const GENERAL_CLARIFICATION_INPUT = 'psu_general_clarification_v1';
export const GENERAL_CLARIFICATION_GAP = 'product_knowledge';
export const GeneralClarificationSlots = z
    .array(z.strictObject({
    key: z.enum(['what_customer_buys', 'customer_role', 'supplier_role']),
    target: z.enum(['whatCustomerBuys', 'customerRole', 'supplierRole']),
    gapId: z.literal('gap:product_knowledge'),
}))
    .min(1)
    .max(3)
    .refine((v) => new Set(v.map((s) => s.target)).size === v.length &&
    v.every((s) => ({
        what_customer_buys: 'whatCustomerBuys',
        customer_role: 'customerRole',
        supplier_role: 'supplierRole',
    })[s.key] === s.target));
const templates = {
    whatCustomerBuys: 'What exactly does the customer buy or receive?',
    customerRole: 'What must the customer provide or do?',
    supplierRole: 'What must the supplier provide or do?',
};
export const GENERAL_CLARIFICATION_POLICY = {
    key: 'psu_general_exact_scalar_clarification',
    version: 1,
    digest: digest(templates),
};
export function generalQuestion(label, slots) {
    return `For ${label}: ${GeneralClarificationSlots.parse(slots)
        .map((s) => templates[s.target])
        .join(' ')} If something is unknown or not decided, say so.`;
}
const confirmation = z.strictObject({
    confirmed: z.literal(true),
    supportIndexes: z.array(z.number().int().min(0).max(3)).min(1).max(4),
});
export const GeneralApplicabilitySelection = z
    .strictObject({
    contractDigest: z.literal(GENERAL_CLARIFICATION_POLICY.digest),
    slots: GeneralClarificationSlots,
    support: z.array(ApplicabilitySupportSchema).min(1).max(4),
    assessments: z
        .array(z.strictObject({
        criterionId: z.string().min(1).max(100),
        digest: HashSchema,
    }))
        .min(1)
        .max(15),
    confirmations: z.strictObject({
        productRelevance: confirmation,
        unresolvedKnowledge: confirmation,
        selectedTargets: confirmation,
    }),
})
    .refine((v) => new Set(v.assessments.map((a) => a.criterionId)).size ===
    v.assessments.length &&
    Object.values(v.confirmations).every((c) => new Set(c.supportIndexes).size === c.supportIndexes.length &&
        c.supportIndexes.every((i) => !!v.support[i])));
export const GeneralApplicabilityReview = GeneralApplicabilitySelection.safeExtend({
    kind: z.literal('platform_general_applicability_v1'),
    policy: z.literal('psu_general_applicability_v1'),
    actor: z.strictObject({
        type: z.literal('human'),
        issuer: z.string().min(1).max(2000),
        id: z.string().min(1).max(200),
    }),
    capacity: z.enum(['partner', 'client']),
    requestKey: z.string().min(1).max(200),
    confirmedAt: z.iso.datetime(),
    auditAction: z.literal('requested_maker'),
    independentlyVerified: z.literal(false),
    digest: HashSchema,
}).refine((v) => digestWithout(v, 'digest') === v.digest);
export const GeneralClarificationOrigin = bounded(z
    .strictObject({
    ...PsuUncertaintyOriginV1.shape,
    kind: z.literal('psu_general_clarification_origin_v1'),
    gapKey: z.literal('product_knowledge'),
    criterionIds: z.array(z.string().min(1).max(100)).min(1).max(15),
    applicability: GeneralApplicabilityReview,
    questionDigest: HashSchema,
})
    .refine((v) => v.ancestorCaseIds[0] === v.predecessorCaseId &&
    new Set(v.ancestorCaseIds).size === v.ancestorCaseIds.length &&
    v.candidate.caseId === v.predecessorCaseId &&
    new Set(v.criterionIds).size === v.criterionIds.length &&
    digest([...v.criterionIds].sort()) ===
        digest(v.applicability.assessments.map((a) => a.criterionId).sort())), 24576);
export const GeneralClarificationCheckpoint = PsuUncertaintyCheckpointV1.extend({
    kind: z.literal('psu_general_clarification_checkpoint_v1'),
    origin: GeneralClarificationOrigin,
    slots: GeneralClarificationSlots,
}).refine((v) => digest(v.slots) === digest(v.origin.applicability.slots) &&
    v.origin.questionDigest ===
        digest(generalQuestion(v.base.scope.workingLabel, v.slots)));
export function verifyGeneralApplicability(raw, content) {
    const v = GeneralApplicabilitySelection.parse(raw);
    for (const s of v.support) {
        const e = content.evidence.find((e) => e.id === s.evidenceId);
        const text = s.field === 'candidate.value'
            ? e?.candidate?.value
            : e?.[s.field];
        if (!e ||
            digest(e) !== s.evidenceDigest ||
            typeof text !== 'string' ||
            text.slice(s.start, s.start + s.excerpt.length) !== s.excerpt)
            throw Error('Exact applicability support required');
    }
    return v;
}
export function parseGeneralAnswer(request, response, raw) {
    const p = GeneralClarificationCheckpoint.parse(raw);
    validateInputResponse(request, response);
    if (request.schemaKey !== GENERAL_CLARIFICATION_INPUT ||
        request.schemaVersion !== 1 ||
        request.question !== generalQuestion(p.base.scope.workingLabel, p.slots) ||
        digest(request.fields) !== digest(uncertaintyFields(p.slots)))
        throw Error('Exact general question required');
    const answers = p.slots.map((s) => {
        const get = (suffix) => response.values.find((v) => v.key === s.key + suffix)?.value;
        const statement = get('_statement'), epistemic = z
            .enum(['current_claim', 'planned_claim', 'unknown', 'contradicted'])
            .parse(get('_status')), confirmed = z.boolean().parse(get('_confirm')), selected = z.boolean().parse(get('_include'));
        if (typeof statement !== 'string' ||
            statement.length > 1500 ||
            statement !== statement.trim() ||
            !statement.isWellFormed() ||
            Array.from(statement).some((c) => {
                const n = c.codePointAt(0);
                return n < 32 || (n >= 127 && n <= 159);
            }) ||
            (!statement && (confirmed || selected)) ||
            (selected && (!confirmed || epistemic !== 'current_claim')))
            throw Error('Invalid exact answer');
        return { ...s, statement, epistemic, confirmed, selected };
    });
    const nonblank = answers.map((a) => a.statement).filter(Boolean);
    if (new Set(nonblank).size !== nonblank.length)
        throw Error('Duplicate exact answers');
    return answers;
}
export function sameGeneralCheckpoint(a, b) {
    const old = GeneralClarificationCheckpoint.parse(a), next = GeneralClarificationCheckpoint.parse(b);
    if (next.base.content.lineage.length !== old.base.content.lineage.length)
        return false;
    next.base.content.lineage = next.base.content.lineage.map((l, i) => l.id === old.base.content.lineage[i]?.id
        ? { ...l, fetchedAt: old.base.content.lineage[i].fetchedAt }
        : l);
    return digest(old) === digest(next);
}
const body = {
    ...PRODUCT_UNCERTAINTY_MANIFEST,
    implementation: { key: 'product_service_understanding', version: 5 },
    checkpointSchemaVersions: [1, 4],
    instruction: {
        version: 5,
        hash: digest('General source-backed scalar clarification v1; exact receipt and responsibilities; unknown remains unresolved'),
    },
    buildDigest: digest('psu-general-clarification-v5'),
};
export const PRODUCT_CLARIFICATION_MANIFEST = RuntimeImplementationManifestSchema.parse({
    ...body,
    manifestDigest: digestWithout(body, 'manifestDigest'),
});
//# sourceMappingURL=product-clarification.js.map