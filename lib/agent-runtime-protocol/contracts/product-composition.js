import { z } from 'zod';
import { bounded, digest, digestWithout } from "./json.js";
import { ReferenceSchema, HashSchema as hash, OpaqueIdSchema as id, } from "./primitives.js";
import { CandidateRefSchema, ImportedSupportSchema, selectedCandidate, } from "./effectiveness.js";
import { ResultContentSchema, FindingSchema, EvidenceObservationSchema, emptyContent, } from "./content.js";
import { ProductOutputSchema, validateProductContentSupport, } from "./product-service.js";
import { AnswerProvenanceSchema } from "./answer-provenance.js";
import { FactSubmissionCheckpointSchema, parseFactSubmission, } from "./product-fact-submission.js";
const position = z.number().int().min(0).max(39);
const imported = z.strictObject({
    localEvidenceId: id,
    sourceResultId: id,
    sourceEnvelopeDigest: hash,
    sourceEvidenceId: id,
    sourceEvidenceDigest: hash,
});
export const ProductRevisionPinSchema = z.strictObject({
    candidate: CandidateRefSchema,
    evaluation: z.strictObject({ resultId: id, envelopeDigest: hash }),
});
/** Integrity only: a digest never authenticates an author or supplies authority. */
export const ProductAppendProofSchema = bounded(z
    .strictObject({
    kind: z.literal('psu_exact_list_append_v1'),
    version: z.literal(1),
    field: z.literal('explicitExclusions'),
    prior: ProductRevisionPinSchema,
    priorListDigest: hash,
    resultListDigest: hash,
    retained: z
        .array(z.strictObject({
        index: position,
        evidenceIndex: position,
        support: imported,
    }))
        .max(40),
    additions: z
        .array(z.strictObject({
        index: position,
        evidenceId: id,
        factId: hash,
        slotKey: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
        requestId: id,
        responseDigest: hash,
        attestationDigest: hash,
    }))
        .min(1)
        .max(3),
    digest: hash,
})
    .refine((p) => p.digest === digestWithout(p, 'digest'), 'Proof digest'), 12288);
function same(a, b, message) {
    if (digest(a) !== digest(b))
        throw new Error(message);
}
function list(value) {
    return z
        .array(z.string().min(1).max(2000))
        .max(40)
        .refine((a) => new Set(a).size === a.length, 'Duplicate exclusion')
        .parse(value);
}
function binding(content, evidenceId) {
    const evidence = content.evidence.find((e) => e.id === evidenceId);
    if (!evidence || evidence.origin === 'ai_inferred')
        throw new Error('Missing factual append support');
    const candidate = z
        .strictObject({
        field: z.literal('explicitExclusions'),
        value: z.unknown(),
    })
        .parse(evidence.candidate);
    return { evidence, values: list(candidate.value) };
}
/** Pure ordered-composition proof. Independently verify manifest, persisted
 * Candidate/Evaluation/answer, authority, fence and freshness before using it.
 * Self-asserted material supplies no trust. This is not an admission handler. */
export function validateProductAppend(value, findingId, material) {
    const content = ResultContentSchema.parse(value);
    const finding = content.findings.find((f) => f.id === findingId);
    if (!finding || finding.kind !== 'evidence_backed_finding')
        throw new Error('Append finding absent');
    const proof = ProductAppendProofSchema.parse(finding.payload);
    const pin = ProductRevisionPinSchema.parse(material.pin);
    same(proof.prior, pin, 'Prepared revision pin mismatch');
    if (pin.candidate.selector.kind !== 'proposal' ||
        pin.candidate.selector.proposalId !== 'offering_understanding')
        throw new Error('Wrong prior selector');
    const prior = ResultContentSchema.parse(material.priorContent);
    const priorCandidate = selectedCandidate(prior, pin.candidate.selector);
    if (pin.candidate.contentDigest !== digest(priorCandidate))
        throw new Error('Prior Candidate digest mismatch');
    const priorList = list(priorCandidate.explicitExclusions ?? []);
    const proposal = content.proposals.find((p) => p.id === 'offering_understanding' && p.targetKind === 'offerings');
    if (!proposal)
        throw new Error('Append proposal absent');
    const resultList = list(proposal.candidate.explicitExclusions);
    if (proof.priorListDigest !== digest(priorList) ||
        proof.resultListDigest !== digest(resultList) ||
        proof.retained.length !== priorList.length ||
        resultList.length !== proof.retained.length + proof.additions.length)
        throw new Error('Append coverage mismatch');
    const priorOutput = ProductOutputSchema.parse(prior.domainOutput);
    const priorStatement = priorOutput.statements.filter((s) => s.canonicalBinding?.field === 'explicitExclusions');
    if (priorList.length &&
        (priorStatement.length !== 1 ||
            digest(priorStatement[0].canonicalBinding.value) !== digest(priorList)))
        throw new Error('Prior exclusion statement missing or ambiguous');
    const priorFinding = prior.findings.find((f) => f.id === priorStatement[0]?.findingId);
    const priorProof = priorFinding?.payload === undefined
        ? undefined
        : ProductAppendProofSchema.parse(priorFinding.payload);
    const output = ProductOutputSchema.parse(content.domainOutput);
    const mapped = output.statements.filter((s) => s.canonicalBinding?.field === 'explicitExclusions');
    if (mapped.length !== 1 ||
        mapped[0].findingId !== findingId ||
        digest(mapped[0].canonicalBinding.value) !== digest(resultList))
        throw new Error('Append statement mapping mismatch');
    same(output.scope, priorOutput.scope, 'Revision scope changed');
    same(proposal.target, prior.proposals.find((p) => p.id === 'offering_understanding').target, 'Revision proposal target changed');
    const imports = ImportedSupportSchema.parse(material.imports);
    const evidenceIds = [];
    for (const [index, retained] of proof.retained.entries()) {
        if (retained.index !== index || resultList[index] !== priorList[index])
            throw new Error('Retained order/value mismatch');
        const support = retained.support;
        if (support.sourceResultId !== pin.candidate.resultId ||
            support.sourceEnvelopeDigest !== pin.candidate.envelopeDigest ||
            !imports.some((i) => digest(i) === digest(support)))
            throw new Error('Exact Candidate import required');
        const source = binding(prior, support.sourceEvidenceId), local = binding(content, support.localEvidenceId);
        if (digest(source.evidence) !== support.sourceEvidenceDigest ||
            source.values[retained.evidenceIndex] !== priorList[index])
            throw new Error('Retained observation mismatch');
        same({ ...source.evidence, id: local.evidence.id }, local.evidence, 'Imported observation mutated');
        if (!prior.proposals
            .find((p) => p.id === 'offering_understanding')
            .evidenceIds.includes(source.evidence.id))
            throw new Error('Unselected prior support');
        if (!priorFinding?.evidenceIds.includes(source.evidence.id))
            throw new Error('Unmapped prior observation');
        if (priorProof) {
            const original = priorProof.retained.find((r) => r.index === index);
            const addition = priorProof.additions.find((a) => a.index === index);
            if (original
                ? original.support.localEvidenceId !== source.evidence.id ||
                    original.evidenceIndex !== retained.evidenceIndex
                : !addition ||
                    addition.evidenceId !== source.evidence.id ||
                    retained.evidenceIndex !== 0)
                throw new Error('Prior flattened support mismatch');
        }
        else if (digest(source.values) !== digest(priorList) ||
            retained.evidenceIndex !== index)
            throw new Error('Generic union support is forbidden');
        evidenceIds.push(local.evidence.id);
    }
    const answer = material.answer, attestation = AnswerProvenanceSchema.parse(answer.provenance), checkpoint = FactSubmissionCheckpointSchema.parse(answer.checkpoint);
    same(selectedCandidate(checkpoint.base.content, pin.candidate.selector), priorCandidate, 'Checkpoint Candidate mismatch');
    if (attestation.operation !== 'revise_understanding')
        throw new Error('Revision answer required');
    const scopeWorkspace = output.scope.mode === 'create'
        ? output.scope.brand.workspaceId
        : output.scope.target.workspaceId;
    if (scopeWorkspace !== attestation.workspaceId)
        throw new Error('Answer workspace mismatch');
    const slots = parseFactSubmission(answer.request, answer.response, checkpoint);
    if (attestation.requestId !== answer.request.id ||
        attestation.requestDigest !== digest(answer.request) ||
        attestation.responseDigest !== digest(answer.response) ||
        attestation.checkpoint.id !== answer.request.checkpoint.id ||
        attestation.checkpoint.digest !== answer.request.checkpoint.digest)
        throw new Error('Accepted answer binding mismatch');
    const selected = slots.filter((s) => s.target === 'explicitExclusions' && s.confirmed && s.selected);
    if (selected.length !== proof.additions.length)
        throw new Error('Selected addition coverage mismatch');
    for (const [offset, addition] of proof.additions.entries()) {
        const index = priorList.length + offset, slot = selected[offset];
        const fields = {
            policyVersion: checkpoint.policy,
            target: slot.target,
            statement: slot.statement,
            epistemic: slot.epistemic,
            confirmed: slot.confirmed,
            selected: slot.selected,
            sourceClassification: attestation.capacity === 'client'
                ? 'client_operator_statement'
                : 'partner_statement',
            independentExternalEvidence: false,
            answerKey: slot.key,
            answerDigest: digest(slot),
            provenance: attestation,
        };
        if (prior.evidence.some((e) => e.id === addition.evidenceId))
            throw new Error('Addition reuses prior observation identity');
        const observation = binding(content, addition.evidenceId).evidence;
        if (addition.index !== index ||
            addition.slotKey !== slot.key ||
            addition.factId !== digest(fields) ||
            addition.requestId !== attestation.requestId ||
            addition.responseDigest !== attestation.responseDigest ||
            addition.attestationDigest !== attestation.digest ||
            resultList[index] !== slot.statement ||
            observation.origin !== 'user_supplied' ||
            observation.claim !== slot.statement ||
            observation.digest !== attestation.responseDigest ||
            observation.observedAt !== attestation.submittedAt ||
            observation.retrievedAt !== attestation.submittedAt ||
            observation.source.kind !== 'reference' ||
            observation.source.id !== attestation.requestId ||
            observation.provenance.provider !== 'human_input' ||
            observation.provenance.adapterKey !== checkpoint.policy ||
            observation.provenance.adapterVersion !== 2 ||
            observation.provenance.invocationId !== `answer:${slot.key}`)
            throw new Error('Exact admitted addition mismatch');
        same(observation.candidate, { field: 'explicitExclusions', value: [slot.statement] }, 'New answer must support only its own addition');
        evidenceIds.push(observation.id);
    }
    const expected = new Set(evidenceIds);
    if (finding.evidenceIds.length !== expected.size ||
        new Set(finding.evidenceIds).size !== expected.size ||
        finding.evidenceIds.some((id) => !expected.has(id)))
        throw new Error('Finding support closure');
    if (evidenceIds.some((id) => !proposal.evidenceIds.includes(id)))
        throw new Error('Proposal support closure');
    const sources = [
        {
            kind: 'resource',
            reference: {
                resourceType: 'agent_result_projection',
                workspaceId: attestation.workspaceId,
                id: pin.candidate.resultId,
                contentHash: pin.candidate.envelopeDigest,
            },
        },
        {
            kind: 'input',
            requestId: attestation.requestId,
            contentHash: attestation.responseDigest,
        },
    ];
    for (const source of sources) {
        const matches = content.lineage.filter((l) => l.role === 'consumed' && digest(l.source) === digest(source));
        if (matches.length !== 1 ||
            !finding.lineageIds.includes(matches[0].id) ||
            !proposal.lineageIds.includes(matches[0].id))
            throw new Error('Append lineage closure');
    }
    return proof;
}
/** Local structure only; persisted admission must also call validateProductAppend
 * against independently resolved material for every newly produced proof. */
export function productAppendValue(content, findingId) {
    const finding = content.findings.find((f) => f.id === findingId);
    if (!finding || finding.kind !== 'evidence_backed_finding')
        throw new Error('Append finding absent');
    const proof = ProductAppendProofSchema.parse(finding.payload);
    const values = [];
    const evidenceIds = [];
    for (const [index, r] of proof.retained.entries()) {
        const observation = binding(content, r.support.localEvidenceId);
        const value = observation.values[r.evidenceIndex];
        if (r.index !== index ||
            value === undefined ||
            r.support.sourceResultId !== proof.prior.candidate.resultId ||
            r.support.sourceEnvelopeDigest !== proof.prior.candidate.envelopeDigest ||
            digest({ ...observation.evidence, id: r.support.sourceEvidenceId }) !==
                r.support.sourceEvidenceDigest)
            throw new Error('Invalid retained append support');
        values.push(value);
        evidenceIds.push(observation.evidence.id);
    }
    if (digest(values) !== proof.priorListDigest)
        throw new Error('Prior list digest mismatch');
    for (const a of proof.additions) {
        const observation = binding(content, a.evidenceId);
        if (a.index !== values.length ||
            observation.values.length !== 1 ||
            observation.evidence.origin !== 'user_supplied' ||
            observation.evidence.digest !== a.responseDigest ||
            observation.evidence.source.kind !== 'reference' ||
            observation.evidence.source.id !== a.requestId)
            throw new Error('Invalid singleton append support');
        values.push(observation.values[0]);
        evidenceIds.push(a.evidenceId);
    }
    list(values);
    if (digest(values) !== proof.resultListDigest ||
        new Set(finding.evidenceIds).size !== finding.evidenceIds.length ||
        finding.evidenceIds.length !== new Set(evidenceIds).size ||
        finding.evidenceIds.some((id) => !evidenceIds.includes(id)))
        throw new Error('Append support closure mismatch');
    return values;
}
export function validateModernProductContent(value, complete = false) {
    const content = ResultContentSchema.parse(value);
    const composed = new Map();
    for (const f of content.findings)
        if (f.payload !== undefined)
            composed.set(f.id, {
                field: 'explicitExclusions',
                value: productAppendValue(content, f.id),
            });
    return validateProductContentSupport(content, complete, composed);
}
/** Authenticated Platform context only. Witness observations stay byte-identical;
 * historical Result identities are attribution, never ordinary read grants. */
export const ProductCanonicalContextSchema = bounded(z.strictObject({
    kind: z.literal('canonical_support_context'),
    schemaVersion: z.literal(1),
    root: ReferenceSchema,
    certificateId: id,
    certificateDigest: hash,
    snapshotDigest: hash,
    evidenceDigest: hash,
    dependencies: z.array(ReferenceSchema).max(40),
    composed: z
        .array(z.strictObject({
        field: z.literal('explicitExclusions'),
        value: z.array(z.string()).max(40),
        findingJson: z.string().min(1).max(16000),
        evidence: z.array(EvidenceObservationSchema).max(20),
    }))
        .max(1),
}), 19000).superRefine((v, c) => {
    for (const item of v.composed) {
        try {
            const finding = FindingSchema.parse(JSON.parse(item.findingJson));
            const content = {
                ...emptyContent(),
                findings: [finding],
                evidence: item.evidence,
            };
            if (digest(productAppendValue(content, finding.id)) !== digest(item.value))
                throw new Error('Binding');
        }
        catch {
            c.addIssue({ code: 'custom', message: 'Invalid canonical composition' });
        }
    }
});
export function canonicalProductFinding(item) {
    return FindingSchema.parse(JSON.parse(item.findingJson));
}
//# sourceMappingURL=product-composition.js.map