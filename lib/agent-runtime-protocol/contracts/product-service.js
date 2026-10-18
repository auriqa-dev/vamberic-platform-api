import { z } from 'zod';
import { ImplementationManifestSchema } from "./work.js";
import { bounded, digest } from "./json.js";
import { OpaqueIdSchema as id, HashSchema as hash, ReferenceSchema, } from "./primitives.js";
import { ResultContentSchema } from "./content.js";
import { ImportedSupportSchema, CriteriaSetSchema } from "./effectiveness.js";
// Exact Offering content mirror; cross-repository parity tests guard drift.
const text = (max = 2000) => z.string().trim().min(1).max(max);
const list = () => z
    .array(text())
    .max(40)
    .refine((v) => new Set(v).size === v.length, 'Duplicate values');
const lists = (keys) => Object.fromEntries(keys.map((k) => [k, list().optional()]));
export const OFFERING_TYPES = [
    'software',
    'installed_technology',
    'physical_product',
    'professional_service',
    'managed_service',
    'outsourced_operation',
    'infrastructure_engineering_service',
    'legal_advisory_service',
    'insurance_financial_product',
    'subscription_media',
    'hybrid',
    'other',
    'unknown',
];
export const DELIVERY_MODES = [
    'digital_self_service',
    'digitally_assisted',
    'installed_deployed',
    'physical_delivery',
    'on_site_service',
    'remote_service',
    'people_led_advisory',
    'managed_outsourced',
    'project_based',
    'ongoing_subscription',
    'hybrid',
    'other',
    'unknown',
];
export const IMPLEMENTATION_MODELS = [
    'customer_implementation',
    'supplier_led_implementation',
    'supplier_mobilisation',
    'light_configuration',
    'no_implementation',
    'other',
    'unknown',
];
export const OFFERING_LIST_FIELDS = [
    'capabilities',
    'deliverables',
    'problemsSolved',
    'desiredOutcomes',
    'differentiators',
    'purchaseConsiderations',
    'industriesServed',
    'regionsServed',
    'competitors',
    'boundaries',
    'explicitExclusions',
    'approvedTerminology',
    'avoidTerminology',
    'approvedClaims',
    'proofPoints',
    'regulatoryContext',
    'unknowns',
];
const common = { name: text(200), description: text(10000) };
export const OfferingContentSchema = z
    .object({
    ...common,
    businessModel: text().optional(),
    primaryOfferingType: z.enum(OFFERING_TYPES).optional(),
    secondaryOfferingTypes: z.array(z.enum(OFFERING_TYPES)).max(13).optional(),
    websiteUrl: z
        .string()
        .max(2048)
        .url()
        .refine((v) => {
        // Zod refinements can run even when .url() has already failed.
        try {
            const u = new URL(v);
            return (['http:', 'https:'].includes(u.protocol) &&
                !u.username &&
                !u.password);
        }
        catch {
            return false;
        }
    })
        .optional(),
    whatItIs: text(10000).optional(),
    whatCustomerBuys: text(10000).optional(),
    deliveryModes: z.array(z.enum(DELIVERY_MODES)).max(13).optional(),
    supplierRole: text().optional(),
    customerRole: text().optional(),
    implementationModel: z.enum(IMPLEMENTATION_MODELS).optional(),
    engagementModel: text().optional(),
    valueProposition: text(10000).optional(),
    commercialModel: text().optional(),
    ...lists(OFFERING_LIST_FIELDS),
})
    .strict();
const ids = z
    .array(id)
    .max(20)
    .refine((v) => new Set(v).size === v.length);
const field = z.enum(Object.keys(OfferingContentSchema.shape));
export const ProductBindingSchema = z.strictObject({
    field,
    value: z.union([text(10000), z.array(text()).max(40)]),
});
export const ProductScopeSchema = z.discriminatedUnion('mode', [
    z.strictObject({
        mode: z.literal('create'),
        brand: ReferenceSchema,
        workingLabel: text(200),
    }),
    z.strictObject({
        mode: z.literal('refresh'),
        target: ReferenceSchema,
        expectedUpdatedAt: z.iso.datetime(),
        workingLabel: text(200),
    }),
]);
export const ProductStatementSchema = z.strictObject({
    id,
    concept: z.enum([
        'identity',
        'substance',
        'receipt',
        'capability',
        'delivery',
        'constraint',
        'commercial',
        'customer',
        'outcome',
        'proof',
    ]),
    findingId: id,
    availability: z.enum([
        'planned',
        'pilot',
        'current',
        'legacy',
        'discontinued',
        'unknown',
    ]),
    canonicalBinding: ProductBindingSchema.optional(),
    qualification: text().optional(),
});
export const ProductOutputSchema = bounded(z
    .strictObject({
    kind: z.literal('product_service_understanding'),
    schemaVersion: z.literal(1),
    scope: ProductScopeSchema,
    proposalId: z.literal('offering_understanding').optional(),
    statements: z.array(ProductStatementSchema).max(20),
    components: z
        .array(z.strictObject({
        id,
        label: text(200),
        relationship: z.enum([
            'included',
            'optional',
            'prerequisite',
            'stage',
            'separately_purchasable',
            'unknown',
        ]),
        statementIds: ids,
    }))
        .max(8),
    currentCommercialReality: z
        .array(z.strictObject({
        id,
        kind: z.enum([
            'price',
            'billing_basis',
            'term',
            'package',
            'guarantee',
            'buying_mechanism',
        ]),
        statementIds: ids,
        amountMinor: z.number().int().nonnegative().safe().optional(),
        currency: z
            .string()
            .regex(/^[A-Z]{3}$/)
            .optional(),
        unit: text(200).optional(),
        interval: text(200).optional(),
        qualifier: text().optional(),
    }))
        .max(8),
    currentCustomerReality: z
        .array(z.strictObject({
        id,
        relationship: z.enum([
            'buyer',
            'payer',
            'user',
            'beneficiary',
            'claimed_audience',
        ]),
        statementIds: ids,
    }))
        .max(8),
    claims: z
        .array(z.strictObject({
        id,
        statementId: id,
        category: z.enum([
            'product_fact',
            'intended_outcome',
            'observed_outcome',
            'comparative_claim',
            'unsupported_marketing_claim',
        ]),
        qualification: text(),
        use: z.enum(['internal_only', 'permission_unknown']),
    }))
        .max(12),
    contradictions: z
        .array(z.strictObject({
        id,
        concept: text(200),
        evidenceIds: ids,
        material: z.boolean(),
        resolutionEvidenceIds: ids,
    }))
        .max(8),
    gapContexts: z
        .array(z.strictObject({
        gapId: id,
        category: z.enum([
            'identity',
            'receipt',
            'capability',
            'delivery',
            'commercial',
            'outcome',
            'proof',
            'constraint',
            'contradiction',
        ]),
        concept: text(200),
        affectedStatementIds: ids,
    }))
        .max(20),
    resolvedPrerequisites: z
        .array(z.strictObject({
        priorRunId: id,
        priorResultId: id.optional(),
        priorGapId: id,
        resolvingEvidenceIds: ids,
        rationale: text(),
    }))
        .max(12),
    changes: z
        .array(z.strictObject({
        field,
        beforeValue: ProductBindingSchema.shape.value.optional(),
        afterValue: ProductBindingSchema.shape.value.optional(),
        kind: z.enum([
            'unchanged',
            'changed',
            'newly_uncertain',
            'omitted',
        ]),
        findingIds: ids,
    }))
        .max(20),
    review: z.strictObject({
        summary: text(),
        confirmationTopics: z.array(text(200)).max(20),
    }),
})
    .superRefine((v, c) => {
    const statements = new Set(v.statements.map((x) => x.id));
    if (statements.size !== v.statements.length)
        c.addIssue({ code: 'custom', message: 'Duplicate statement' });
    if ([
        ...v.components,
        ...v.currentCommercialReality,
        ...v.currentCustomerReality,
    ].some((x) => x.statementIds.some((i) => !statements.has(i))) ||
        v.claims.some((x) => !statements.has(x.statementId)) ||
        v.gapContexts.some((x) => x.affectedStatementIds.some((i) => !statements.has(i))))
        c.addIssue({ code: 'custom', message: 'Unresolved statement' });
}), 32768);
export const ProductHistorySchema = z.strictObject({
    kind: z.literal('product_service_history'),
    schemaVersion: z.literal(1),
    importedSupport: ImportedSupportSchema,
});
export const ProductCheckpointSchema = bounded(z.strictObject({
    schemaVersion: z.literal(1),
    stage: z.enum(['orient', 'gather', 'structure', 'clarify', 'synthesize']),
    scope: ProductScopeSchema,
    content: ResultContentSchema,
    questionKeys: z.array(text(200)).max(9),
    inputCycles: z.number().int().min(0).max(3),
    sourceDigests: z
        .array(z.strictObject({ reference: ReferenceSchema, digest: hash }))
        .max(20),
}), 32768);
/** Structural proof only. Meaning/grounding remains independent judgement. */
export function validateProductContent(value, complete = false) {
    return validateProductContentSupport(value, complete, new Map());
}
/** Structural support seam for the explicitly pinned modern PSU validator.
 * This is not provenance admission or authorization. Legacy callers above
 * never supply composed support. */
export function validateProductContentSupport(value, complete, composed) {
    const content = ResultContentSchema.parse(value);
    const output = ProductOutputSchema.parse(content.domainOutput);
    const fail = (message) => {
        throw new Error(message);
    };
    for (const statement of output.statements) {
        const finding = content.findings.find((f) => f.id === statement.findingId);
        if (!finding)
            fail('Unresolved Product finding');
        const binding = statement.canonicalBinding;
        if (binding) {
            if (!['observed_fact', 'evidence_backed_finding'].includes(finding.kind))
                fail('Weak basis cannot become canonical fact');
            const support = finding.evidenceIds.map((id) => content.evidence.find((e) => e.id === id));
            if (digest(composed.get(finding.id) ?? null) !== digest(binding) &&
                !support.some((e) => e.origin !== 'ai_inferred' &&
                    e.candidate !== undefined &&
                    digest(e.candidate) === digest(binding)))
                fail('Canonical binding lacks exact support');
        }
    }
    for (const c of output.contradictions) {
        if ([...c.evidenceIds, ...c.resolutionEvidenceIds].some((i) => !content.evidence.some((e) => e.id === i)))
            fail('Unresolved contradiction support');
        if (complete && c.material && !c.resolutionEvidenceIds.length)
            fail('Material contradiction unresolved');
    }
    if (output.gapContexts.some((g) => !content.knowledgeGaps.some((x) => x.id === g.gapId)))
        fail('Unresolved Product gap');
    if (content.proposals.length > 1)
        fail('Only one Offering proposal');
    const proposal = content.proposals[0];
    if (proposal) {
        if (proposal.id !== 'offering_understanding' ||
            proposal.targetKind !== 'offerings' ||
            output.proposalId !== proposal.id)
            fail('Product proposal selector mismatch');
        const candidate = OfferingContentSchema.parse(proposal.candidate);
        for (const statement of output.statements) {
            const binding = statement.canonicalBinding;
            if (binding &&
                digest(candidate[binding.field] ?? null) !== digest(binding.value))
                fail('Canonical binding does not match proposal');
            if (binding &&
                statement.availability === 'planned' &&
                !statement.qualification)
                fail('Planned canonical content requires qualification');
        }
        if (proposal.evidenceIds.length > 20)
            fail('Canonical evidence selection exceeds bound');
        for (const [field, value] of Object.entries(candidate)) {
            if (!output.statements.some((s) => s.canonicalBinding?.field === field &&
                digest(s.canonicalBinding.value) === digest(value)))
                fail('Unmapped canonical field');
            if (!output.statements.some((s) => s.canonicalBinding?.field === field &&
                digest(composed.get(s.findingId) ?? null) ===
                    digest({ field, value }) &&
                content.findings
                    .find((f) => f.id === s.findingId)
                    .evidenceIds.every((id) => proposal.evidenceIds.includes(id))) &&
                !proposal.evidenceIds.some((i) => content.evidence.some((e) => e.id === i &&
                    e.candidate !== undefined &&
                    digest(e.candidate) === digest({ field, value }))))
                fail('Required proposal evidence absent');
        }
        if (output.scope.mode === 'create') {
            if (proposal.target.kind !== 'create' ||
                proposal.target.parents.length !== 1 ||
                proposal.target.parents[0].relationship !== 'brand' ||
                digest(proposal.target.parents[0].reference) !==
                    digest(output.scope.brand))
                fail('Create scope mismatch');
        }
        else if (proposal.target.kind !== 'update' ||
            digest(proposal.target.reference) !== digest(output.scope.target) ||
            proposal.target.expectedUpdatedAt !== output.scope.expectedUpdatedAt)
            fail('Refresh scope mismatch');
    }
    if (complete) {
        if (!proposal ||
            content.knowledgeGaps.some((g) => g.severity === 'blocking'))
            fail('Product prerequisite missing');
        for (const concept of [
            'identity',
            'substance',
            'receipt',
            'capability',
            'delivery',
            'constraint',
        ])
            if (!output.statements.some((s) => s.concept === concept && s.canonicalBinding))
                fail('Core Product knowledge missing');
    }
    return content;
}
const criterionRows = [
    [
        'scope_identity',
        'validity',
        'deterministic',
        'psu_scope_v1',
        'validity_hold',
    ],
    [
        'contract_integrity',
        'validity',
        'deterministic',
        'psu_contract_v1',
        'validity_hold',
    ],
    [
        'core_knowledge',
        'validity',
        'deterministic',
        'psu_core_v1',
        'validity_hold',
    ],
    [
        'source_integrity',
        'validity',
        'deterministic',
        'psu_sources_v1',
        'validity_hold',
    ],
    [
        'epistemic_projection',
        'validity',
        'deterministic',
        'psu_projection_v1',
        'validity_hold',
    ],
    [
        'fresh_application_base',
        'validity',
        'deterministic',
        'psu_freshness_v1',
        'validity_hold',
    ],
    ['product_clarity', 'effectiveness', 'judgement', 'psu_clarity_v1', 'repair'],
    [
        'receipt_and_delivery',
        'effectiveness',
        'judgement',
        'psu_delivery_v1',
        'repair',
    ],
    [
        'product_offer_boundary',
        'effectiveness',
        'judgement',
        'psu_boundary_v1',
        'repair',
    ],
    [
        'claim_grounding',
        'effectiveness',
        'judgement',
        'psu_grounding_v1',
        'repair',
    ],
    [
        'constraint_preservation',
        'effectiveness',
        'judgement',
        'psu_constraints_v1',
        'repair',
    ],
    [
        'grouping_coherence',
        'effectiveness',
        'judgement',
        'psu_grouping_v1',
        'structure_review',
    ],
    [
        'downstream_sufficiency',
        'effectiveness',
        'judgement',
        'psu_handoff_v1',
        'repair',
    ],
    [
        'brand_term_preservation',
        'brand',
        'deterministic',
        'psu_terms_v1',
        'repair',
    ],
    [
        'question_economy',
        'effectiveness',
        'judgement',
        'psu_questions_v1',
        'repair',
    ],
];
const requirements = {
    scope_identity: 'One selected thing, exact workspace/target/Brand pins, authorized roles',
    contract_integrity: 'Strict domain/proposal shape, byte bounds, resolved IDs, complete coverage of material bindings',
    core_knowledge: 'Identity, substance, receipt, capability, delivery and material constraints legitimately established; no blocking gaps',
    source_integrity: 'Exact source identities/import mappings, authentic input provenance, no silently substituted content',
    epistemic_projection: 'Every proposed material value has retained basis; no assumption/core inference promoted; required Hive mapping fits',
    fresh_application_base: 'Current target/parent/source and expected application tokens remain valid',
    product_clarity: 'A reader can identify the concrete thing received without interpreting promotional language',
    receipt_and_delivery: 'Deliverables distinct from activity; responsibilities and delivery sufficiently specific for the selected type',
    product_offer_boundary: 'Existing commercial reality is recorded, never redesigned or confused with core product',
    claim_grounding: 'Actual excerpts/answers support assertion meaning and qualifications; intended/observed/guaranteed distinct',
    constraint_preservation: 'Material limits, exclusions, planned state and prerequisites survive synthesis',
    grouping_coherence: 'Confirmed scope/components form one legitimate context; no unresolved strategic split/merge hidden',
    downstream_sufficiency: 'ICP/Offer can consume structured facts/basis without guessing core knowledge or inheriting an ICP/Offer decision',
    brand_term_preservation: 'Existing selected required/avoided terminology respected without overriding facts',
    question_economy: "Evidence-first synthesis, specific justified questions, no repeats after \u201cdon't know\u201d",
};
export const PRODUCT_PROFILE = {
    key: 'product_service_understanding_v1',
    version: 1,
    digest: digest({ criterionRows, requirements }),
};
export function productCriteria() {
    const body = {
        schemaVersion: 1,
        profile: PRODUCT_PROFILE,
        objective: 'Establish what the client actually sells with preserved evidence and uncertainty',
        intendedNextAction: 'Human review of an Offering draft proposal; canonical approval remains separate',
        lineage: [],
        criteria: criterionRows.map(([id, category, method, methodKey, consequenceKey]) => ({
            id,
            version: 1,
            category,
            method,
            methodKey,
            consequenceKey,
            requirement: requirements[id],
            rationale: 'Preserve the reviewed Product understanding and downstream factual boundary',
            importance: id === 'question_economy' ? 'advisory' : 'mandatory',
            evidence: ['core_knowledge', 'claim_grounding'].includes(id)
                ? 'required'
                : 'none',
            applicabilityRule: id === 'brand_term_preservation'
                ? 'selected_terms'
                : id === 'question_economy'
                    ? 'questions_present'
                    : 'always',
            lineageIds: [],
        })),
    };
    return CriteriaSetSchema.parse({ ...body, digest: digest(body) });
}
const manifestBody = {
    implementation: { key: 'product_service_understanding', version: 1 },
    compatibleDefinitions: [{ key: 'product_service_understanding', version: 1 }],
    protocolVersions: ['1.1'],
    operations: ['understand', 'evaluate_understanding', 'revise_understanding'],
    resultSchemaVersions: [2],
    checkpointSchemaVersions: [1],
    instruction: {
        version: 1,
        hash: digest('Product foundation: deterministic fixtures; real provider calibration required'),
    },
    buildDigest: digest('product-service-understanding-foundation-v1'),
};
export const PRODUCT_MANIFEST = ImplementationManifestSchema.parse({
    ...manifestBody,
    manifestDigest: digest(manifestBody),
});
//# sourceMappingURL=product-service.js.map