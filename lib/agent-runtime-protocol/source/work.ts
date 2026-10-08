import {
  AnswerProvenanceSchema,
  validateAnswerProvenance,
} from './answer-provenance.ts';
import { ResultSchemaVersionSchema } from './primitives.ts';
import { z } from 'zod';
import {
  bounded,
  digest,
  digestWithout,
  JsonPayloadSchema,
  LIMITS,
} from './json.ts';
import {
  ProtocolVersionSchema,
  OpaqueIdSchema as id,
  KeySchema as key,
  VersionSchema as version,
  CounterSchema,
  HashSchema as hash,
  TimestampSchema as time,
  ProjectionSchema,
  ReferenceSchema,
  WorkspaceIdSchema,
  ClientIdSchema,
  platformId,
  ExactDecimalSchema,
  CurrencySchema,
  ImplementationIdentitySchema,
  InstructionSchema,
} from './primitives.ts';
import { SourceLineageSchema, ParentSchema } from './content.ts';
import {
  CheckpointSchema,
  InputRequestSchema,
  InputResponseSchema,
  validateInputResponse,
} from './input.ts';
export const DispatchSchema = bounded(
  z.strictObject({
    protocolVersion: ProtocolVersionSchema,
    environment: z.enum(['local', 'test', 'dev', 'prod']),
    runId: id,
    generation: version,
    dispatchId: id,
    notBefore: time,
    traceId: id,
  }),
  LIMITS.dispatchBytes,
);
export const OperationClassSchema = z.enum([
  'read_only',
  'cost_incurring_read',
  'external_mutation',
]);
export const BudgetLimitsSchema = z.strictObject({
  deadline: time,
  modelCalls: CounterSchema,
  toolCalls: CounterSchema,
  providerCalls: z
    .array(z.strictObject({ provider: key, calls: CounterSchema }))
    .max(20)
    .refine(
      (v) => new Set(v.map((x) => x.provider)).size === v.length,
      'Duplicate provider budget',
    ),
  cost: z.strictObject({
    currency: CurrencySchema,
    amount: ExactDecimalSchema,
  }),
});
export const ResourceGrantSchema = z.strictObject({
  reference: ReferenceSchema,
  fields: ProjectionSchema,
});
export const ToolGrantSchema = z
  .strictObject({
    key,
    version,
    operation: key,
    class: OperationClassSchema,
    provider: key,
    bindingId: platformId('integration').optional(),
    // Future mutation grants must identify a separately approved operation, not merely a class.
    authorizedOperationId: id.optional(),
  })
  .refine(
    (v) =>
      v.class !== 'external_mutation' || v.authorizedOperationId !== undefined,
    'Mutation requires operation authority',
  );
export const ModelGrantSchema = z.strictObject({
  provider: key,
  model: key,
  purpose: key,
});
export const GrantSchema = bounded(
  z
    .strictObject({
      id,
      version,
      runId: id,
      workspaceId: WorkspaceIdSchema,
      expiresAt: time,
      resources: z.array(ResourceGrantSchema).max(80),
      proposalTargets: z
        .array(
          z.discriminatedUnion('kind', [
            z.strictObject({
              kind: z.literal('update'),
              targetKind: key,
              reference: ReferenceSchema,
            }),
            z.strictObject({
              kind: z.literal('create'),
              targetKind: key,
              parents: z.array(ParentSchema).min(1).max(10),
            }),
          ]),
        )
        .max(20),
      tools: z.array(ToolGrantSchema).max(40),
      bindings: z.array(platformId('integration')).max(40),
      models: z.array(ModelGrantSchema).max(20),
      budgets: BudgetLimitsSchema,
    })
    .superRefine((v, c) => {
      if (
        v.resources.some((r) => r.reference.workspaceId !== v.workspaceId) ||
        v.proposalTargets.some((t) =>
          t.kind === 'update'
            ? t.reference.workspaceId !== v.workspaceId
            : t.parents.some((p) => p.reference.workspaceId !== v.workspaceId),
        )
      )
        c.addIssue({ code: 'custom', message: 'Grant scope mismatch' });
      if (v.tools.some((t) => t.bindingId && !v.bindings.includes(t.bindingId)))
        c.addIssue({ code: 'custom', message: 'Unbound tool grant' });
      for (const values of [
        v.resources.map((r) => digest(r.reference)),
        v.tools.map(
          (t) => `${t.key}:${t.version}:${t.operation}:${t.bindingId ?? ''}`,
        ),
        v.models.map((m) => `${m.provider}:${m.model}:${m.purpose}`),
        v.bindings,
      ])
        if (new Set(values).size !== values.length)
          c.addIssue({ code: 'custom', message: 'Duplicate grant entry' });
    }),
  131_072,
);
export const ImplementationManifestSchema = bounded(
  z
    .strictObject({
      implementation: ImplementationIdentitySchema,
      compatibleDefinitions: z
        .array(z.strictObject({ key, version }))
        .min(1)
        .max(30),
      protocolVersions: z.array(ProtocolVersionSchema).min(1).max(10),
      operations: z.array(key).min(1).max(20),
      resultSchemaVersions: z.array(version).min(1).max(10),
      checkpointSchemaVersions: z.array(version).min(1).max(10),
      instruction: InstructionSchema,
      buildDigest: hash,
      manifestDigest: hash,
    })
    .refine(
      (v) => digestWithout(v, 'manifestDigest') === v.manifestDigest,
      'Manifest digest mismatch',
    ),
  32_768,
);
export const ClaimedWorkSchema = bounded(
  z
    .strictObject({
      protocolVersion: ProtocolVersionSchema,
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
      clientAgent: z.strictObject({
        id: platformId('clientagent'),
        revision: version,
        configuration: JsonPayloadSchema,
      }),
      clientSwarm: z
        .strictObject({ id: platformId('clientswarm'), revision: version })
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
          if (
            v.protocolVersion === '1.1' &&
            v.resume.answerProvenance !== undefined
          )
            c.addIssue({
              code: 'unrecognized_keys',
              keys: ['answerProvenance'],
              path: ['resume'],
              message: 'Protocol 1.1 has no answer provenance',
            });
          if (v.protocolVersion === '1.2') {
            try {
              validateAnswerProvenance(v.resume.answerProvenance, v);
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
export type Dispatch = z.infer<typeof DispatchSchema>;
export type ClaimedWork = z.infer<typeof ClaimedWorkSchema>;
export type Grant = z.infer<typeof GrantSchema>;
export type BudgetLimits = z.infer<typeof BudgetLimitsSchema>;
export type ResourceGrant = z.infer<typeof ResourceGrantSchema>;
export type ToolGrant = z.infer<typeof ToolGrantSchema>;
export type ModelGrant = z.infer<typeof ModelGrantSchema>;
export type ImplementationManifest = z.infer<
  typeof ImplementationManifestSchema
>;
