import { z } from 'zod';
import { digest, digestWithout, bounded } from './json.ts';
import { HashSchema, OpaqueIdSchema } from './primitives.ts';
import {
  PsuUncertaintyOriginV1,
  PsuUncertaintyCheckpointV1,
  uncertaintyFields,
  parseUncertaintyAnswer,
  PRODUCT_UNCERTAINTY_MANIFEST,
} from './product-uncertainty.ts';
import { RuntimeImplementationManifestSchema } from './work-v2.ts';
import {
  validateInputResponse,
  type InputRequest,
  type InputResponse,
} from './input.ts';
import { type ResultContent } from './content.ts';
export const PSU_REVIEWED_INPUT = 'psu_uncertainty_answer_v2' as const;
const slots = [
  {
    key: 'customer_role',
    target: 'customerRole',
    gapId: 'gap:assessment_input_responsibilities',
  },
  {
    key: 'supplier_role',
    target: 'supplierRole',
    gapId: 'gap:assessment_input_responsibilities',
  },
] as const;
const questionBody = {
  key: 'meter_input_responsibilities',
  version: 2,
  applicabilityPolicy: 'psu_source_backed_human_applicability_v1',
  gapKey: 'assessment_input_responsibilities',
  template:
    'For {label}, who is responsible for obtaining and supplying the meter data needed for the assessment, and what must the customer and supplier each provide? If this is unknown or not yet decided, please say so.',
  substitutions: ['label'],
  slots: slots.map((s) => ({ ...s, required: true })),
  fields: uncertaintyFields(slots),
};
export const PSU_REVIEWED_QUESTION = Object.freeze({
  ...questionBody,
  digest: digest(questionBody),
});
export function reviewedQuestion(label: string) {
  return questionBody.template.replace('{label}', label);
}
export const ApplicabilitySupportSchema = z.strictObject({
  evidenceId: OpaqueIdSchema,
  evidenceDigest: HashSchema,
  field: z.enum(['claim', 'excerpt', 'candidate.value']),
  start: z.number().int().min(0).max(8000),
  excerpt: z.string().min(1).max(1500),
});
const confirmation = z.strictObject({
  confirmed: z.literal(true),
  supportIndexes: z
    .array(z.number().int().min(0).max(3))
    .min(1)
    .max(4)
    .refine((v) => new Set(v).size === v.length),
});
export const ApplicabilitySelectionSchema = z
  .strictObject({
    contractDigest: z.literal(PSU_REVIEWED_QUESTION.digest),
    support: z.array(ApplicabilitySupportSchema).min(1).max(4),
    assessments: z.tuple([
      z.strictObject({
        criterionId: z.literal('receipt_and_delivery'),
        digest: HashSchema,
      }),
      z.strictObject({
        criterionId: z.literal('downstream_sufficiency'),
        digest: HashSchema,
      }),
    ]),
    confirmations: z.strictObject({
      meterAssessment: confirmation,
      dataSupplyUncertainty: confirmation,
      bothResponsibilitySlots: confirmation,
    }),
  })
  .superRefine((v, c) => {
    if (
      Object.values(v.confirmations).some((x) =>
        x.supportIndexes.some((i) => !v.support[i]),
      ) ||
      new Set(v.support.map((x) => digest(x))).size !== v.support.length
    )
      c.addIssue({
        code: 'custom',
        message: 'Invalid applicability support mapping',
      });
  });
export const ApplicabilityReviewSchema =
  ApplicabilitySelectionSchema.safeExtend({
    kind: z.literal('platform_attributed_applicability_v1'),
    policy: z.literal('psu_source_backed_human_applicability_v1'),
    actor: z.strictObject({
      type: z.literal('human'),
      issuer: z.string().min(1).max(2000),
      id: OpaqueIdSchema,
    }),
    capacity: z.enum(['partner', 'client']),
    requestKey: z.string().min(1).max(200),
    confirmedAt: z.iso.datetime(),
    auditAction: z.literal('requested_maker'),
    independentlyVerified: z.literal(false),
    digest: HashSchema,
  }).refine(
    (v) => digestWithout(v, 'digest') === v.digest,
    'Applicability digest mismatch',
  );
export const PsuUncertaintyOriginV2 = bounded(
  z
    .strictObject({
      ...PsuUncertaintyOriginV1.shape,
      kind: z.literal('psu_uncertainty_origin_v2'),
      applicability: ApplicabilityReviewSchema,
      questionDigest: HashSchema,
    })
    .refine(
      (v) =>
        new Set(v.ancestorCaseIds).size === v.ancestorCaseIds.length &&
        v.ancestorCaseIds[0] === v.predecessorCaseId &&
        v.candidate.caseId === v.predecessorCaseId,
      'Invalid bounded ancestry',
    ),
  24576,
);
export const PsuUncertaintyCheckpointV2 = PsuUncertaintyCheckpointV1.extend({
  kind: z.literal('psu_uncertainty_checkpoint_v2'),
  origin: PsuUncertaintyOriginV2,
}).superRefine((v, c) => {
  if (
    digest(v.slots) !== digest(slots) ||
    v.origin.questionDigest !==
      digest(reviewedQuestion(v.base.scope.workingLabel))
  )
    c.addIssue({ code: 'custom', message: 'Question contract changed' });
});
export function verifyApplicabilitySupport(
  raw: unknown,
  content: Pick<ResultContent, 'evidence'>,
) {
  const review = ApplicabilitySelectionSchema.parse(raw);
  for (const s of review.support) {
    const e = content.evidence.find((e) => e.id === s.evidenceId);
    const text =
      s.field === 'candidate.value'
        ? (e?.candidate as { value?: unknown } | undefined)?.value
        : e?.[s.field];
    if (
      !e ||
      digest(e) !== s.evidenceDigest ||
      typeof text !== 'string' ||
      text.slice(s.start, s.start + s.excerpt.length) !== s.excerpt
    )
      throw new Error('Unresolved exact applicability support');
  }
  return review;
}
export function parseReviewedAnswer(
  request: InputRequest,
  response: InputResponse,
  raw: unknown,
) {
  const pin = PsuUncertaintyCheckpointV2.parse(raw);
  validateInputResponse(request, response);
  if (
    request.schemaKey !== PSU_REVIEWED_INPUT ||
    request.schemaVersion !== 2 ||
    request.question !== reviewedQuestion(pin.base.scope.workingLabel)
  )
    throw new Error('Reviewed question required');
  // Reuse the exact v1 field parser only after v2 origin/question/slot admission.
  const { applicability, questionDigest, ...oldOrigin } = pin.origin;
  void applicability;
  void questionDigest;
  return parseUncertaintyAnswer(
    { ...request, schemaKey: 'psu_uncertainty_answer_v1', schemaVersion: 1 },
    { ...response, schemaKey: 'psu_uncertainty_answer_v1', schemaVersion: 1 },
    {
      ...pin,
      kind: 'psu_uncertainty_checkpoint_v1',
      origin: { ...oldOrigin, kind: 'psu_uncertainty_origin_v1' },
    },
  );
}
export function sameReviewedCheckpoint(retained: unknown, current: unknown) {
  const saved = PsuUncertaintyCheckpointV2.parse(retained),
    next = PsuUncertaintyCheckpointV2.parse(current);
  const a = saved.base.content.lineage,
    b = next.base.content.lineage;
  if (
    a.length !== b.length ||
    new Set(a.map((x) => x.id)).size !== a.length ||
    new Set(b.map((x) => x.id)).size !== b.length
  )
    return false;
  next.base.content.lineage = b.map((x, i) =>
    x.id === a[i]?.id ? { ...x, fetchedAt: a[i]!.fetchedAt } : x,
  );
  return digest(saved) === digest(next);
}
const body = {
  ...PRODUCT_UNCERTAINTY_MANIFEST,
  implementation: { key: 'product_service_understanding', version: 4 },
  checkpointSchemaVersions: [1, 3],
  instruction: {
    version: 4,
    hash: digest(
      'PSU exact attributed applicability v1; independent required slots v2; fetchedAt-only comparison',
    ),
  },
  buildDigest: digest('psu-reviewed-uncertainty-local-v4'),
};
export const PRODUCT_REVIEWED_UNCERTAINTY_MANIFEST =
  RuntimeImplementationManifestSchema.parse({
    ...body,
    manifestDigest: digestWithout(body, 'manifestDigest'),
  });
