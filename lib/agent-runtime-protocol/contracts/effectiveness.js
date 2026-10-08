import { z } from 'zod';
import { bounded, digest, digestWithout, JsonPayloadSchema } from "./json.js";
import { OpaqueIdSchema as id, KeySchema as key, VersionSchema as version, HashSchema as hash, TextSchema as text, InstructionSchema, } from "./primitives.js";
import { SourceLineageSchema, ResultContentSchema, } from "./content.js";
const ids = () => z
    .array(id)
    .max(20)
    .refine((v) => new Set(v).size === v.length, 'Duplicate support');
export const EffectivenessIdentitySchema = z.strictObject({
    key,
    version,
    digest: hash,
});
export const CriterionSchema = z.strictObject({
    id: key,
    version,
    category: z.enum(['validity', 'effectiveness', 'brand']),
    requirement: text,
    rationale: text,
    importance: z.enum(['mandatory', 'advisory']),
    method: z.enum(['deterministic', 'judgement']),
    methodKey: key,
    evidence: z.enum(['none', 'required']),
    applicabilityRule: key,
    consequenceKey: key,
    lineageIds: ids(),
});
export const CriteriaSetSchema = bounded(z
    .strictObject({
    schemaVersion: z.literal(1),
    profile: EffectivenessIdentitySchema,
    objective: text,
    intendedNextAction: text,
    lineage: z.array(SourceLineageSchema).max(20),
    criteria: z.array(CriterionSchema).min(1).max(40),
    digest: hash,
})
    .superRefine((v, c) => {
    if (digestWithout(v, 'digest') !== v.digest)
        c.addIssue({ code: 'custom', message: 'Criteria digest mismatch' });
    if (new Set(v.criteria.map((x) => x.id)).size !== v.criteria.length ||
        new Set(v.lineage.map((x) => x.id)).size !== v.lineage.length)
        c.addIssue({ code: 'custom', message: 'Duplicate criteria identity' });
    if (v.criteria.some((x) => x.lineageIds.some((i) => !v.lineage.some((l) => l.id === i))))
        c.addIssue({ code: 'custom', message: 'Unresolved criterion source' });
}), 24_576);
export const CandidateSelectorSchema = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('domain_output') }),
    z.strictObject({ kind: z.literal('proposal'), proposalId: id }),
    z.strictObject({ kind: z.literal('artifact'), artifactId: id }),
]);
export const CandidateRefSchema = z.strictObject({
    caseId: id,
    revision: version.max(3),
    runId: id,
    attemptId: id,
    resultId: id,
    envelopeDigest: hash,
    contentDigest: hash,
    selector: CandidateSelectorSchema,
});
export const CriterionAssessmentSchema = z.strictObject({
    criterionId: key,
    outcome: z.enum(['pass', 'fail', 'uncertain', 'not_applicable']),
    method: z.enum(['deterministic', 'judgement']),
    methodKey: key,
    rationale: text,
    evidenceIds: ids(),
    findingIds: ids(),
    lineageIds: ids(),
    gapIds: ids(),
    provenance: z.discriminatedUnion('kind', [
        z.strictObject({
            kind: z.literal('deterministic'),
            check: EffectivenessIdentitySchema,
        }),
        z.strictObject({
            kind: z.literal('model'),
            invocationIds: ids().refine((v) => v.length > 0, 'Model invocation required'),
        }),
    ]),
});
export const EvaluationPayloadSchema = bounded(z
    .strictObject({
    kind: z.literal('effectiveness_evaluation'),
    schemaVersion: z.literal(1),
    candidate: CandidateRefSchema,
    criteriaDigest: hash,
    policy: EffectivenessIdentitySchema,
    requestKey: id,
    instruction: InstructionSchema.extend({ key }),
    assessments: z.array(CriterionAssessmentSchema).min(1).max(40),
    defects: z
        .array(z.strictObject({
        criterionId: key,
        findingId: id,
        type: key,
        location: key,
        requirement: text,
    }))
        .max(40),
    summary: text,
})
    .superRefine((v, c) => {
    if (new Set(v.assessments.map((a) => a.criterionId)).size !==
        v.assessments.length)
        c.addIssue({ code: 'custom', message: 'Duplicate assessment' });
    if (v.defects.some((d) => !v.assessments.some((a) => a.criterionId === d.criterionId &&
        a.outcome === 'fail' &&
        a.findingIds.includes(d.findingId))))
        c.addIssue({
            code: 'custom',
            message: 'Defect must explain failed criterion',
        });
}), 32_768);
export const ImportedSupportSchema = bounded(z
    .array(z.strictObject({
    localEvidenceId: id,
    sourceResultId: id,
    sourceEnvelopeDigest: hash,
    sourceEvidenceId: id,
    sourceEvidenceDigest: hash,
}))
    .max(20)
    .refine((v) => new Set(v.map((x) => x.localEvidenceId)).size === v.length, 'Duplicate import'), 8192);
export const EvaluationInputSchema = bounded(z.strictObject({
    kind: z.literal('effectiveness_evaluation_request'),
    schemaVersion: z.literal(1),
    candidate: CandidateRefSchema,
    criteria: CriteriaSetSchema,
    policy: EffectivenessIdentitySchema,
    requestKey: id,
    instruction: InstructionSchema.extend({ key }),
    importedSupport: ImportedSupportSchema,
}), 32_768);
/** Local contract validation only. Platform supplies applicability decisions and
 * independently verifies authoritative source/identity/permission checks. */
export function validateEvaluation(contentValue, inputValue, options) {
    const content = ResultContentSchema.parse(contentValue);
    const input = EvaluationInputSchema.parse(inputValue);
    const evaluation = EvaluationPayloadSchema.parse(content.domainOutput);
    if (digest(evaluation.candidate) !== digest(input.candidate) ||
        evaluation.criteriaDigest !== input.criteria.digest ||
        digest(evaluation.policy) !== digest(input.policy) ||
        evaluation.requestKey !== input.requestKey ||
        digest(evaluation.instruction) !== digest(input.instruction))
        throw new Error('Evaluation binding mismatch');
    if (content.proposals.length)
        throw new Error('Evaluator cannot propose candidate changes');
    if (evaluation.assessments.length !== input.criteria.criteria.length)
        throw new Error('Incomplete criterion coverage');
    for (const a of evaluation.assessments) {
        const criterion = input.criteria.criteria.find((c) => c.id === a.criterionId);
        if (!criterion ||
            a.method !== criterion.method ||
            a.methodKey !== criterion.methodKey)
            throw new Error('Criterion method mismatch');
        if (a.outcome === 'not_applicable' &&
            !options.allowedNotApplicable.includes(a.criterionId))
            throw new Error('Applicability denied');
        for (const [refs, rows] of [
            [a.evidenceIds, content.evidence],
            [a.findingIds, content.findings],
            [a.lineageIds, content.lineage],
            [a.gapIds, content.knowledgeGaps],
        ])
            if (refs.some((i) => !rows.some((r) => r.id === i)))
                throw new Error('Unresolved assessment support');
        if ((a.method === 'judgement' && a.provenance.kind !== 'model') ||
            (a.method === 'deterministic' && a.provenance.kind !== 'deterministic'))
            throw new Error('Assessment provenance mismatch');
        if (a.provenance.kind === 'model' &&
            a.provenance.invocationIds.some((i) => !options.modelInvocationIds.includes(i)))
            throw new Error('Unrecorded evaluator invocation');
        if (criterion.evidence === 'required' &&
            a.outcome === 'pass' &&
            !a.evidenceIds.length)
            throw new Error('Required evidence absent');
        if (a.gapIds.some((i) => content.knowledgeGaps.some((g) => g.id === i && g.severity === 'blocking')) &&
            a.outcome === 'pass')
            throw new Error('Blocking gap cannot pass');
    }
    return evaluation;
}
/** Import provenance is immutable. This never grants a provider call. */
export function importedEvidenceMatches(observation, input, sources) {
    const link = input.importedSupport.find((x) => x.localEvidenceId === observation.id);
    if (!link)
        return false;
    const source = sources.find((x) => x.resultId === link.sourceResultId &&
        x.envelopeDigest === link.sourceEnvelopeDigest);
    const evidence = source?.content.evidence.find((x) => x.id === link.sourceEvidenceId);
    return (!!evidence &&
        digest(evidence) === link.sourceEvidenceDigest &&
        digest({ ...observation, id: evidence.id }) === digest(evidence));
}
export function selectedCandidate(content, selector) {
    const selected = selector.kind === 'domain_output'
        ? content.domainOutput
        : selector.kind === 'proposal'
            ? content.proposals.find((p) => p.id === selector.proposalId)?.candidate
            : undefined;
    if (selected === undefined)
        throw new Error('Candidate absent or artifact reader unavailable');
    return JsonPayloadSchema.parse(selected);
}
/** Reviewed layers in authority order. Lower layers may add constraints or
 * strengthen advisory to mandatory; they cannot redefine an existing identity. */
export function assembleCriteriaSet(metadata, layers) {
    const merged = new Map();
    for (const layer of layers)
        for (const value of layer) {
            const next = CriterionSchema.parse(value);
            const prior = merged.get(next.id);
            if (prior) {
                if (prior.importance === 'mandatory' && next.importance !== 'mandatory')
                    throw new Error('Mandatory criterion cannot be weakened');
                if (digest({ ...prior, importance: 'mandatory' }) !==
                    digest({ ...next, importance: 'mandatory' }))
                    throw new Error('Conflicting criterion identity');
            }
            merged.set(next.id, next);
        }
    const body = {
        ...metadata,
        criteria: [...merged.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    };
    return CriteriaSetSchema.parse({ ...body, digest: digest(body) });
}
//# sourceMappingURL=effectiveness.js.map