import { z } from 'zod';
import { digest, digestWithout } from './json.ts';
import {
  PRODUCT_MANIFEST,
  ProductCheckpointSchema,
} from './product-service.ts';
import { RuntimeImplementationManifestSchema } from './work-v2.ts';
import {
  InputRequestSchema,
  validateInputResponse,
  type InputRequest,
  type InputResponse,
} from './input.ts';
export const PSU_FACT_POLICY = 'psu_human_facts_v2' as const;
export const PSU_FACT_INPUT = 'psu_revision_fact_submission' as const;
export const FactSlotSchema = z.strictObject({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  target: z.enum([
    'whatCustomerBuys',
    'customerRole',
    'supplierRole',
    'explicitExclusions',
  ]),
  defectId: z.string().min(1).max(200),
});
export const FactSlotsSchema = z
  .array(FactSlotSchema)
  .min(1)
  .max(3)
  .superRefine((v, c) => {
    if (
      new Set(v.map((x) => x.key)).size !== v.length ||
      new Set(v.map((x) => x.target)).size !== v.length
    )
      c.addIssue({ code: 'custom', message: 'Duplicate fact slot or target' });
  });
export const FactSubmissionCheckpointSchema = z.strictObject({
  policy: z.literal(PSU_FACT_POLICY),
  base: ProductCheckpointSchema,
  slots: FactSlotsSchema,
  inputDigest: z.string().regex(/^[a-f0-9]{64}$/),
});
const statuses = [
  'current_claim',
  'planned_claim',
  'unknown',
  'contradicted',
] as const;
export function factSubmissionFields(raw: unknown): InputRequest['fields'] {
  return FactSlotsSchema.parse(raw).flatMap((s) => [
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
      label: `${s.target}: include in proposed revision`,
      type: 'boolean' as const,
      required: true,
    },
  ]);
}
/** Shared server/Runtime validation; never trims or interprets a human assertion. */
export function parseFactSubmission(
  request: InputRequest,
  response: InputResponse,
  checkpoint: unknown,
) {
  const pinned = FactSubmissionCheckpointSchema.parse(checkpoint);
  InputRequestSchema.parse(request);
  validateInputResponse(request, response);
  if (
    request.schemaKey !== PSU_FACT_INPUT ||
    request.schemaVersion !== 1 ||
    digest(request.fields) !== digest(factSubmissionFields(pinned.slots))
  )
    throw new Error('Fact submission policy mismatch');
  const entries = pinned.slots.map((slot) => {
    const get = (suffix: string) =>
      response.values.find((v) => v.key === `${slot.key}_${suffix}`)?.value;
    const statement = get('statement'),
      epistemic = get('status'),
      confirmed = get('confirm'),
      selected = get('include');
    if (
      typeof statement !== 'string' ||
      !statuses.includes(epistemic as never) ||
      typeof confirmed !== 'boolean' ||
      typeof selected !== 'boolean'
    )
      throw new Error('Incomplete fact slot');
    if (
      statement.length > 1500 ||
      !statement.isWellFormed() ||
      [...statement].some(
        (character) =>
          character.codePointAt(0)! <= 31 ||
          (character.codePointAt(0)! >= 127 &&
            character.codePointAt(0)! <= 159),
      ) ||
      statement !== statement.trim() ||
      (statement.length === 0 && (confirmed || selected))
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
  const statements = entries.filter((x) => x.statement).map((x) => x.statement);
  if (new Set(statements).size !== statements.length)
    throw new Error('Duplicate statement');
  return entries;
}
const body = {
  ...PRODUCT_MANIFEST,
  implementation: { key: 'product_service_understanding', version: 2 },
  protocolVersions: ['1.2', '2.0'],
  instruction: {
    version: 2,
    hash: digest(
      'PSU bounded general composition v2; psu_human_facts_v2; exact selection; psu_exact_list_append_v1 with persisted admission; canonical_support_context_v1; code-owned maker and resume DTOs; complete psu_evaluation_context_v1 lossless encoding; no authority',
    ),
  },
  buildDigest: digest(
    'psu-general-offline-v2-exact-append-v1-certified-context-v1-maker-resume-v1-lossless-context-v1',
  ),
};
export const PRODUCT_GENERAL_MANIFEST =
  RuntimeImplementationManifestSchema.parse({
    ...body,
    manifestDigest: digestWithout(body, 'manifestDigest'),
  });
