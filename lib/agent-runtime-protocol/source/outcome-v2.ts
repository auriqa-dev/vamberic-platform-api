import { ResultSchemaVersionSchema } from './primitives.ts';
import { z } from 'zod';
import { bounded, digestWithout, LIMITS } from './json.ts';
import {
  OpaqueIdSchema as id,
  VersionSchema as version,
  HashSchema as hash,
  TimestampSchema as time,
  ImplementationIdentitySchema,
  InstructionSchema,
  TextSchema,
} from './primitives.ts';
import { ResultContentSchema } from './content.ts';
import { CheckpointSchema, InputRequestSchema } from './input.ts';
import { SafeErrorSchema } from './errors.ts';
import { UsageObservationSchema } from './usage.ts';
export const CompletenessSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('complete') }),
  z.strictObject({
    kind: z.literal('partial'),
    omissions: z.array(TextSchema).min(1).max(40),
    reason: TextSchema,
  }),
]);
export const AgentOutcomeSchema = bounded(
  z
    .discriminatedUnion('kind', [
      z.strictObject({
        kind: z.literal('success'),
        completeness: CompletenessSchema,
        content: ResultContentSchema,
      }),
      z.strictObject({
        kind: z.literal('needs_input'),
        completeness: CompletenessSchema,
        content: ResultContentSchema,
        checkpoint: CheckpointSchema,
        inputRequest: InputRequestSchema,
      }),
      z.strictObject({
        kind: z.literal('yield'),
        completeness: CompletenessSchema,
        content: ResultContentSchema,
        checkpoint: CheckpointSchema,
        reason: TextSchema,
        notBefore: time.optional(),
      }),
      z.strictObject({
        kind: z.literal('failure'),
        completeness: CompletenessSchema,
        content: ResultContentSchema,
        error: SafeErrorSchema,
      }),
      z.strictObject({
        kind: z.literal('cancelled'),
        completeness: CompletenessSchema,
        content: ResultContentSchema,
        error: SafeErrorSchema,
      }),
    ])
    .superRefine((v, c) => {
      if (
        v.completeness.kind === 'complete' &&
        v.content.knowledgeGaps.some((gap) => gap.severity === 'blocking')
      )
        c.addIssue({
          code: 'custom',
          message: 'Complete output cannot contain a blocking Knowledge Gap',
        });
      if (v.kind !== 'success' && v.completeness.kind !== 'partial')
        c.addIssue({ code: 'custom', message: 'Non-success is partial' });
      if (v.kind === 'cancelled' && v.error.code !== 'cancelled')
        c.addIssue({ code: 'custom', message: 'Cancellation error required' });
      if (v.kind === 'failure' && v.error.code === 'cancelled')
        c.addIssue({ code: 'custom', message: 'Use cancelled outcome' });
      if (
        v.kind === 'needs_input' &&
        (v.inputRequest.checkpoint.id !== v.checkpoint.id ||
          v.inputRequest.checkpoint.digest !== v.checkpoint.digest)
      )
        c.addIssue({ code: 'custom', message: 'Input checkpoint mismatch' });
    }),
  LIMITS.outcomeBytes,
);
export const OutcomeV2Schema = bounded(
  z
    .strictObject({
      protocolVersion: z.literal('2.0'),
      resultSchemaVersion: ResultSchemaVersionSchema,
      runId: id,
      attemptId: id,
      generation: version,
      fence: version,
      submissionId: id,
      payloadDigest: hash,
      implementation: ImplementationIdentitySchema.extend({
        manifestDigest: hash,
        buildDigest: hash,
      }),
      instruction: InstructionSchema,
      traceId: id,
      startedAt: time,
      endedAt: time,
      outcome: AgentOutcomeSchema,
      usage: z.array(UsageObservationSchema).max(200),
    })
    .superRefine((v, c) => {
      if (v.startedAt > v.endedAt)
        c.addIssue({ code: 'custom', message: 'Outcome time order' });
      if (digestWithout(v, 'payloadDigest') !== v.payloadDigest)
        c.addIssue({ code: 'custom', message: 'Outcome digest mismatch' });
      if (
        v.usage.some(
          (u) => u.runId !== v.runId || u.attemptId !== v.attemptId,
        ) ||
        new Set(v.usage.map((u) => u.id)).size !== v.usage.length
      )
        c.addIssue({ code: 'custom', message: 'Usage identity mismatch' });
      const o = v.outcome;
      if (
        'checkpoint' in o &&
        (o.checkpoint.runId !== v.runId ||
          o.checkpoint.implementation.key !== v.implementation.key ||
          o.checkpoint.implementation.version !== v.implementation.version)
      )
        c.addIssue({
          code: 'custom',
          message: 'Outcome checkpoint identity mismatch',
        });
      if (o.kind === 'needs_input' && o.inputRequest.expiresAt <= v.endedAt)
        c.addIssue({ code: 'custom', message: 'Input already expired' });
    }),
  LIMITS.outcomeBytes,
);
export type OutcomeV2 = z.infer<typeof OutcomeV2Schema>;

import { OutcomeSchema } from './outcome.ts';
export const RuntimeOutcomeSchema = z.union([OutcomeSchema, OutcomeV2Schema]);
export type RuntimeOutcome = z.infer<typeof RuntimeOutcomeSchema>;
