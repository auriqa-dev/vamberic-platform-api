import { z } from 'zod';
import { digest, digestWithout } from './json.ts';
import { CandidateRefSchema } from './effectiveness.ts';
import { ProductCheckpointSchema } from './product-service.ts';
import { PRODUCT_GENERAL_MANIFEST } from './product-fact-submission.ts';
import { RuntimeImplementationManifestSchema } from './work-v2.ts';
import {
  InputRequestSchema,
  validateInputResponse,
  type InputRequest,
  type InputResponse,
} from './input.ts';
import { HashSchema, OpaqueIdSchema } from './primitives.ts';
export const PSU_UNCERTAINTY_INPUT = 'psu_uncertainty_answer_v1' as const;
export const PSU_UNCERTAINTY_GAP = 'assessment_input_responsibilities' as const;
export const PsuUncertaintyOriginV1 = z
  .strictObject({
    kind: z.literal('psu_uncertainty_origin_v1'),
    predecessorCaseId: OpaqueIdSchema,
    predecessorRevision: z.number().int().positive(),
    workspaceId: OpaqueIdSchema,
    targetDigest: HashSchema,
    candidate: CandidateRefSchema,
    evaluationResultId: OpaqueIdSchema,
    evaluationEnvelopeDigest: HashSchema,
    evaluationDigest: HashSchema,
    criteriaDigest: HashSchema,
    profileDigest: HashSchema,
    policyDigest: HashSchema,
    criterionIds: z.tuple([
      z.literal('receipt_and_delivery'),
      z.literal('downstream_sufficiency'),
    ]),
    gapKey: z.literal(PSU_UNCERTAINTY_GAP),
    priorRequestCount: z.number().int().min(0).max(2),
    ancestorCaseIds: z.array(OpaqueIdSchema).min(1).max(3),
  })
  .refine(
    (v) =>
      new Set(v.ancestorCaseIds).size === v.ancestorCaseIds.length &&
      v.ancestorCaseIds[0] === v.predecessorCaseId &&
      v.candidate.caseId === v.predecessorCaseId,
    'Invalid bounded ancestry',
  );
export const PsuUncertaintySlotsV1 = z
  .array(
    z.strictObject({
      key: z.enum(['customer_role', 'supplier_role']),
      target: z.enum(['customerRole', 'supplierRole']),
      gapId: OpaqueIdSchema,
    }),
  )
  .min(1)
  .max(2)
  .superRefine((slots, c) => {
    if (
      new Set(slots.map((s) => s.target)).size !== slots.length ||
      new Set(slots.map((s) => s.key)).size !== slots.length ||
      slots.some(
        (s) => (s.key === 'customer_role') !== (s.target === 'customerRole'),
      )
    )
      c.addIssue({ code: 'custom', message: 'Invalid uncertainty slots' });
  });
export const PsuUncertaintyCheckpointV1 = z.strictObject({
  kind: z.literal('psu_uncertainty_checkpoint_v1'),
  origin: PsuUncertaintyOriginV1,
  inputDigest: HashSchema,
  base: ProductCheckpointSchema,
  slots: PsuUncertaintySlotsV1,
});
const statuses = [
  'current_claim',
  'planned_claim',
  'unknown',
  'contradicted',
] as const;
export function uncertaintyFields(raw: unknown): InputRequest['fields'] {
  return PsuUncertaintySlotsV1.parse(raw).flatMap((s) => [
    {
      key: `${s.key}_statement`,
      label: `${s.target}: exact statement`,
      type: 'text' as const,
      required: true,
      maxLength: 1500,
    },
    {
      key: `${s.key}_status`,
      label: `${s.target}: epistemic status`,
      type: 'choice' as const,
      required: true,
      options: statuses.map((value) => ({ value, label: value })),
    },
    {
      key: `${s.key}_confirm`,
      label: `${s.target}: confirm exact statement and status`,
      type: 'boolean' as const,
      required: true,
    },
    {
      key: `${s.key}_include`,
      label: `${s.target}: include in proposed understanding`,
      type: 'boolean' as const,
      required: true,
    },
  ]);
}
export const PsuUncertaintyAnswerRequestV1 = InputRequestSchema.refine(
  (v) => v.schemaKey === PSU_UNCERTAINTY_INPUT && v.schemaVersion === 1,
  'Uncertainty request version required',
);
export function parseUncertaintyAnswer(
  request: InputRequest,
  response: InputResponse,
  checkpoint: unknown,
) {
  const pin = PsuUncertaintyCheckpointV1.parse(checkpoint);
  PsuUncertaintyAnswerRequestV1.parse(request);
  validateInputResponse(request, response);
  if (digest(request.fields) !== digest(uncertaintyFields(pin.slots)))
    throw new Error('Uncertainty fields changed');
  const entries = pin.slots.map((slot) => {
    const get = (suffix: string) =>
      response.values.find((v) => v.key === `${slot.key}_${suffix}`)?.value;
    const statement = get('statement'),
      epistemic = get('status'),
      confirmed = get('confirm'),
      selected = get('include');
    if (
      typeof statement !== 'string' ||
      typeof confirmed !== 'boolean' ||
      typeof selected !== 'boolean' ||
      !statuses.includes(epistemic as never)
    )
      throw new Error('Incomplete uncertainty answer');
    if (
      statement.length > 1500 ||
      statement !== statement.trim() ||
      !statement.isWellFormed() ||
      [...statement].some(
        (c) =>
          c.codePointAt(0)! <= 31 ||
          (c.codePointAt(0)! >= 127 && c.codePointAt(0)! <= 159),
      ) ||
      (!statement && (confirmed || selected))
    )
      throw new Error('Invalid exact statement');
    if (selected && (!confirmed || epistemic !== 'current_claim'))
      throw new Error('Selection requires confirmed current claim');
    return {
      ...slot,
      statement,
      epistemic: epistemic as (typeof statuses)[number],
      confirmed,
      selected,
    };
  });
  const texts = entries.filter((s) => s.statement).map((s) => s.statement);
  if (new Set(texts).size !== texts.length)
    throw new Error('Duplicate statement');
  return entries;
}
const body = {
  ...PRODUCT_GENERAL_MANIFEST,
  implementation: { key: 'product_service_understanding', version: 3 },
  checkpointSchemaVersions: [1, 2],
  instruction: {
    version: 3,
    hash: digest(
      'PSU same-target uncertainty clarification v1; exact provenance; bounded linked maker; no cross-version grants',
    ),
  },
  buildDigest: digest('psu-uncertainty-local-v3'),
};
export const PRODUCT_UNCERTAINTY_MANIFEST =
  RuntimeImplementationManifestSchema.parse({
    ...body,
    manifestDigest: digestWithout(body, 'manifestDigest'),
  });
