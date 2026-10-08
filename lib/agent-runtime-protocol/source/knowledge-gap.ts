import { z } from 'zod';
import { bounded } from './json.ts';
import { OpaqueIdSchema, KeySchema, TextSchema } from './primitives.ts';
const references = z
  .array(OpaqueIdSchema)
  .max(20)
  .refine(
    (ids) => new Set(ids).size === ids.length,
    'Duplicate gap support reference',
  );
/** Immutable unresolved observation; identity is scoped to the Run/Result. */
export const KnowledgeGapSchema = bounded(
  z.strictObject({
    id: OpaqueIdSchema,
    question: TextSchema,
    whyRequired: TextSchema,
    severity: z.enum(['blocking', 'non_blocking']),
    checked: z.array(z.string().min(1).max(500)).min(1).max(10),
    evidenceIds: references,
    findingIds: references,
    lineageIds: references,
    resolution: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('human_input') }),
      z.strictObject({ kind: z.literal('research') }),
      z.strictObject({
        kind: z.literal('capability'),
        requiredCapability: KeySchema,
      }),
      z.strictObject({ kind: z.literal('unresolved') }),
    ]),
    context: z
      .strictObject({
        subject: z.string().min(1).max(500).optional(),
        scope: z.string().min(1).max(500).optional(),
      })
      .optional(),
  }),
  8_192,
);
export type KnowledgeGap = z.infer<typeof KnowledgeGapSchema>;
