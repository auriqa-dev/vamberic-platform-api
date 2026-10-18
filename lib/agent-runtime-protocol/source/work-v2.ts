import { z } from 'zod';
import { bounded, digest, JsonPayloadSchema, LIMITS } from './json.ts';
import {
  ReferenceSchema,
  WorkspaceIdSchema,
  OpaqueIdSchema as id,
  KeySchema as key,
  VersionSchema as version,
  HashSchema as hash,
  ProjectionSchema,
  ImplementationIdentitySchema,
  ClientIdSchema,
  ResultSchemaVersionSchema,
  TimestampSchema as time,
  platformId,
} from './primitives.ts';
import {
  GrantSchema,
  ResourceGrantSchema,
  ClaimedWorkSchema,
  DispatchSchema,
  ImplementationManifestSchema,
} from './work.ts';
import { SourceLineageSchema } from './content.ts';
import {
  CheckpointSchema,
  InputRequestSchema,
  InputResponseSchema,
  validateInputResponse,
} from './input.ts';
import {
  AnswerProvenanceSchema,
  validateAnswerProvenance,
} from './answer-provenance.ts';
export const WORKSPACE_PROTOCOL_VERSION = '2.0' as const;
export const WorkspaceAgentTargetSchema = z.strictObject({
  kind: z.literal('workspace_agent'),
  workspaceId: WorkspaceIdSchema,
  definition: z.strictObject({
    id: platformId('agentdefinition'),
    key,
    version,
  }),
  implementation: ImplementationIdentitySchema.extend({
    manifestDigest: hash,
    buildDigest: hash,
  }),
});
export type WorkspaceAgentTarget = z.infer<typeof WorkspaceAgentTargetSchema>;
export const ClaimedWorkV2Schema = bounded(
  z
    .strictObject({
      protocolVersion: z.literal('2.0'),
      runId: id,
      attemptId: id,
      generation: version,
      fence: version,
      lease: z.strictObject({ id, workerId: id, expiresAt: time }),
      workspaceId: WorkspaceIdSchema,
      clientId: ClientIdSchema,
      operation: key,
      definition: z.strictObject({
        id: platformId('agentdefinition'),
        key,
        version,
      }),
      implementation: ImplementationIdentitySchema.extend({
        manifestDigest: hash,
        buildDigest: hash,
      }),
      executionTarget: WorkspaceAgentTargetSchema,
      configuration: JsonPayloadSchema,
      configurationOverlay: z
        .strictObject({
          id: platformId('clientagent'),
          revision: version,
          contentHash: hash,
        })
        .optional(),
      context: z.strictObject({
        references: z.array(ResourceGrantSchema).max(80),
        snapshots: z
          .array(
            z.strictObject({
              id,
              reference: ReferenceSchema,
              fields: ProjectionSchema,
              payload: JsonPayloadSchema,
              payloadDigest: hash,
            }),
          )
          .max(20),
      }),
      input: JsonPayloadSchema,
      resume: z
        .discriminatedUnion('kind', [
          z.strictObject({
            kind: z.literal('input'),
            checkpoint: CheckpointSchema,
            request: InputRequestSchema,
            response: InputResponseSchema,
            answerProvenance: AnswerProvenanceSchema.optional(),
          }),
          z.strictObject({
            kind: z.literal('continuation'),
            checkpoint: CheckpointSchema,
          }),
        ])
        .optional(),
      resultSchemaVersion: ResultSchemaVersionSchema,
      checkpointSchemaVersion: version,
      grant: GrantSchema,
      traceId: id,
      lineage: z.array(SourceLineageSchema).max(100),
    })
    .superRefine((v, c) => {
      if (
        v.executionTarget.workspaceId !== v.workspaceId ||
        digest(v.executionTarget.definition) !== digest(v.definition) ||
        digest(v.executionTarget.implementation) !== digest(v.implementation)
      )
        c.addIssue({ code: 'custom', message: 'Execution target mismatch' });
      if (v.runId !== v.grant.runId || v.workspaceId !== v.grant.workspaceId)
        c.addIssue({ code: 'custom', message: 'Work/grant scope mismatch' });
      for (const r of [...v.context.references, ...v.context.snapshots]) {
        const g = v.grant.resources.find(
          (g) => digest(g.reference) === digest(r.reference),
        );
        if (!g || r.fields.some((f) => !g.fields.includes(f)))
          c.addIssue({ code: 'custom', message: 'Context exceeds grant' });
      }
      for (const s of v.context.snapshots)
        if (digest(s.payload) !== s.payloadDigest)
          c.addIssue({ code: 'custom', message: 'Snapshot digest mismatch' });
      for (const lineage of [
        ...v.lineage,
        ...(v.resume?.checkpoint.lineage ?? []),
      ]) {
        if (lineage.source.kind !== 'resource') continue;
        const reference = lineage.source.reference;
        const readGrant = v.grant.resources.find(
          (g) => digest(g.reference) === digest(reference),
        );
        const targetGrant =
          lineage.role === 'proposal_base' &&
          v.grant.proposalTargets.some(
            (g) =>
              g.kind === 'update' && digest(g.reference) === digest(reference),
          );
        if (
          reference.workspaceId !== v.workspaceId ||
          (!readGrant && !targetGrant) ||
          (lineage.fields &&
            !lineage.fields.every((f) => readGrant?.fields.includes(f)))
        ) {
          c.addIssue({
            code: 'custom',
            message: 'Lineage exceeds current grant',
          });
        }
      }
      if (v.resume) {
        const cp = v.resume.checkpoint;
        if (
          cp.runId !== v.runId ||
          cp.schemaVersion !== v.checkpointSchemaVersion ||
          cp.implementation.key !== v.implementation.key ||
          cp.implementation.version !== v.implementation.version
        )
          c.addIssue({
            code: 'custom',
            message: 'Checkpoint identity mismatch',
          });
        if (v.resume.kind === 'input') {
          if (v.protocolVersion === '2.0') {
            try {
              validateAnswerProvenance(v.resume.answerProvenance, {
                ...v,
                protocolVersion: '1.2',
              });
            } catch {
              c.addIssue({
                code: 'custom',
                message: 'Invalid or missing Platform answer provenance',
              });
            }
          }
          if (
            v.resume.request.checkpoint.id !== cp.id ||
            v.resume.request.checkpoint.digest !== cp.digest
          )
            c.addIssue({
              code: 'custom',
              message: 'Input/checkpoint mismatch',
            });
          try {
            validateInputResponse(v.resume.request, v.resume.response);
          } catch {
            c.addIssue({ code: 'custom', message: 'Invalid resumed response' });
          }
        }
      }
    }),
  LIMITS.workBytes,
);

export const RuntimeClaimedWorkSchema = z.union([
  ClaimedWorkSchema,
  ClaimedWorkV2Schema,
]);
export type RuntimeClaimedWork = z.infer<typeof RuntimeClaimedWorkSchema>;
export const DispatchV2Schema = bounded(
  z.strictObject({
    ...DispatchSchema.out.shape,
    protocolVersion: z.literal('2.0'),
  }),
  LIMITS.dispatchBytes,
);
export const RuntimeDispatchSchema = z.union([
  DispatchSchema,
  DispatchV2Schema,
]);
export const ImplementationManifestV2Schema = bounded(
  z
    .strictObject({
      ...ImplementationManifestSchema.out.shape,
      protocolVersions: z
        .array(z.enum(['1.1', '1.2', '2.0']))
        .min(1)
        .max(10),
    })
    .superRefine((v, c) => {
      const { manifestDigest, ...rest } = v;
      if (digest(rest) !== manifestDigest)
        c.addIssue({ code: 'custom', message: 'Manifest digest mismatch' });
    }),
  32768,
);
export const RuntimeImplementationManifestSchema = z.union([
  ImplementationManifestSchema,
  ImplementationManifestV2Schema,
]);

export type RuntimeImplementationManifest = z.infer<
  typeof RuntimeImplementationManifestSchema
>;

export type RuntimeDispatch = z.infer<typeof RuntimeDispatchSchema>;
