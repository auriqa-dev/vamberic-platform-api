import { z } from 'zod';
import { bounded, digest, digestWithout } from './json.ts';
import {
  InputRequestSchema,
  InputResponseSchema,
  validateInputResponse,
} from './input.ts';
import {
  OpaqueIdSchema,
  WorkspaceIdSchema,
  KeySchema,
  HashSchema,
  TimestampSchema,
  VersionSchema,
} from './primitives.ts';
import type { ClaimedWork } from './work.ts';

/** Integrity is not a signature. Only the authenticated Platform workload
 * response may supply this object; models, tools and callers cannot author it. */
export const AnswerProvenanceSchema = bounded(
  z
    .strictObject({
      kind: z.literal('platform_answer_provenance'),
      schemaVersion: z.literal(1),
      submissionId: HashSchema,
      workspaceId: WorkspaceIdSchema,
      runId: OpaqueIdSchema,
      operation: KeySchema,
      action: z.literal('respond'),
      requestId: OpaqueIdSchema,
      requestDigest: HashSchema,
      checkpoint: z.strictObject({ id: OpaqueIdSchema, digest: HashSchema }),
      submissionGeneration: VersionSchema,
      resumeGeneration: VersionSchema,
      responseDigest: HashSchema,
      actor: z.strictObject({
        type: z.literal('human'),
        issuer: z.string().min(1).max(500),
        id: OpaqueIdSchema,
      }),
      capacity: z.enum(['partner', 'client']),
      submittedAt: TimestampSchema,
      digest: HashSchema,
    })
    .superRefine((v, c) => {
      if (
        v.digest !== digestWithout(v, 'digest') ||
        v.resumeGeneration !== v.submissionGeneration + 1 ||
        v.submissionId !== answerSubmissionId(v)
      )
        c.addIssue({
          code: 'custom',
          message: 'Answer provenance integrity mismatch',
        });
    }),
  4096,
);
export type AnswerProvenance = z.infer<typeof AnswerProvenanceSchema>;
export function answerSubmissionId(v: {
  workspaceId: string;
  runId: string;
  requestId: string;
  responseDigest: string;
}) {
  return digest({
    workspaceId: v.workspaceId,
    runId: v.runId,
    requestId: v.requestId,
    responseDigest: v.responseDigest,
  });
}
export function validateAnswerProvenance(
  value: unknown,
  work: Pick<
    ClaimedWork,
    | 'protocolVersion'
    | 'workspaceId'
    | 'runId'
    | 'operation'
    | 'generation'
    | 'resume'
  >,
): AnswerProvenance {
  const p = AnswerProvenanceSchema.parse(value);
  const r = work.resume;
  if (work.protocolVersion !== '1.2' || r?.kind !== 'input')
    throw new Error('Protocol 1.2 input required');
  InputRequestSchema.parse(r.request);
  InputResponseSchema.parse(r.response);
  validateInputResponse(r.request, r.response);
  if (
    p.workspaceId !== work.workspaceId ||
    p.runId !== work.runId ||
    p.operation !== work.operation ||
    p.requestId !== r.request.id ||
    p.requestDigest !== digest(r.request) ||
    p.responseDigest !== digest(r.response) ||
    p.actor.id !== r.response.actorReference ||
    p.submittedAt !== r.response.answeredAt ||
    p.checkpoint.id !== r.checkpoint.id ||
    p.checkpoint.digest !== r.checkpoint.digest ||
    r.checkpoint.runId !== work.runId ||
    digest(p.checkpoint) !== digest(r.request.checkpoint) ||
    p.resumeGeneration > work.generation
  )
    throw new Error('Answer provenance binding mismatch');
  // Retries may advance the execution generation after the accepting transition.
  // Platform checks the recorded transition exactly when reading the audit event.
  return p;
}
