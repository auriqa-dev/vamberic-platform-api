import { KnowledgeGapSchema } from './knowledge-gap.ts';
import { z } from 'zod';
import { bounded, JsonPayloadSchema, LIMITS } from './json.ts';
import {
  OpaqueIdSchema as id,
  KeySchema as key,
  VersionSchema,
  HashSchema as hash,
  TimestampSchema as time,
  TextSchema as text,
  ProjectionSchema,
  ReferenceSchema,
  ExternalReferenceSchema,
} from './primitives.ts';
export const SourceLineageSchema = bounded(
  z
    .strictObject({
      id,
      role: z.enum(['requested', 'consumed', 'proposal_base']),
      purpose: text,
      source: z.discriminatedUnion('kind', [
        z.strictObject({
          kind: z.literal('resource'),
          reference: ReferenceSchema,
        }),
        z.strictObject({
          kind: z.literal('external'),
          url: ExternalReferenceSchema,
          contentHash: hash,
        }),
        z.strictObject({
          kind: z.literal('artifact'),
          artifactId: id,
          contentHash: hash,
        }),
        z.strictObject({
          kind: z.literal('input'),
          requestId: id,
          contentHash: hash,
        }),
      ]),
      observedAt: time,
      fetchedAt: time,
      fields: ProjectionSchema.optional(),
      snapshotId: id.optional(),
      artifactId: id.optional(),
    })
    .refine((v) => v.observedAt <= v.fetchedAt, 'Source time order'),
  8_192,
);
export type SourceLineage = z.infer<typeof SourceLineageSchema>;
export const ProvenanceSchema = z.strictObject({
  provider: key,
  adapterKey: key,
  adapterVersion: VersionSchema,
  invocationId: id,
  providerRequestId: id.optional(),
  model: key.optional(),
  modelVersion: z.string().min(1).max(100).optional(),
});
export const FindingSchema = bounded(
  z
    .strictObject({
      id,
      kind: z.enum([
        'observed_fact',
        'evidence_backed_finding',
        'inference',
        'assumption',
        'unknown',
        'recommendation',
      ]),
      statement: text,
      evidenceIds: z.array(id).max(40),
      lineageIds: z.array(id).max(40),
      confidence: z.number().min(0).max(1).optional(),
      provenance: ProvenanceSchema.optional(),
      payload: JsonPayloadSchema.optional(),
    })
    .refine(
      (v) =>
        !['observed_fact', 'evidence_backed_finding', 'inference'].includes(
          v.kind,
        ) || v.evidenceIds.length > 0,
      'Evidence required for claims',
    ),
  16_384,
);
export const EvidenceObservationSchema = bounded(
  z
    .strictObject({
      id,
      origin: z.enum(['user_supplied', 'external_evidence', 'ai_inferred']),
      subject: text.optional(),
      claim: text,
      candidate: JsonPayloadSchema.optional(),
      provenance: ProvenanceSchema,
      source: z.discriminatedUnion('kind', [
        z.strictObject({
          kind: z.literal('external'),
          url: ExternalReferenceSchema,
        }),
        z.strictObject({ kind: z.literal('reference'), id }),
      ]),
      observedAt: time,
      retrievedAt: time,
      excerpt: z.string().min(1).max(8_000).optional(),
      artifactId: id.optional(),
      digest: hash,
      confidence: z.number().min(0).max(1).optional(),
      verification: z.literal('observed'),
    })
    .refine((v) => v.observedAt <= v.retrievedAt, 'Evidence time order'),
  LIMITS.observationBytes,
);
export const ParentSchema = z.strictObject({
  relationship: key,
  reference: ReferenceSchema,
});
export const ProposalSchema = bounded(
  z.strictObject({
    id,
    targetKind: key,
    target: z.discriminatedUnion('kind', [
      z.strictObject({
        kind: z.literal('update'),
        reference: ReferenceSchema,
        expectedUpdatedAt: time.optional(),
      }),
      z.strictObject({
        kind: z.literal('create'),
        parents: z.array(ParentSchema).min(1).max(10),
      }),
    ]),
    candidate: JsonPayloadSchema,
    evidenceIds: z.array(id).max(40),
    rationale: text,
    lineageIds: z.array(id).min(1).max(40),
  }),
  49_152,
);
export const AssumptionSchema = z.strictObject({
  id,
  statement: text,
  evidenceIds: z.array(id).max(40),
  validationQuestion: text.optional(),
});
export const UnknownSchema = z.strictObject({
  id,
  question: text,
  impact: text,
});
export const WarningSchema = z.strictObject({ code: key, message: text });
export const ArtifactReferenceSchema = z.strictObject({
  id,
  mediaType: z.string().min(1).max(100),
  bytes: z.number().int().min(0).max(100_000_000),
  digest: hash,
});
export const ResultContentSchema = bounded(
  z
    .strictObject({
      domainOutput: JsonPayloadSchema.optional(),
      findings: z.array(FindingSchema).max(100),
      evidence: z.array(EvidenceObservationSchema).max(100),
      assumptions: z.array(AssumptionSchema).max(40),
      unknowns: z.array(UnknownSchema).max(40),
      knowledgeGaps: z.array(KnowledgeGapSchema).max(40),
      proposals: z.array(ProposalSchema).max(20),
      artifacts: z.array(ArtifactReferenceSchema).max(20),
      warnings: z.array(WarningSchema).max(40),
      lineage: z.array(SourceLineageSchema).max(100),
    })
    .superRefine((v, ctx) => {
      const unique = (items: { id: string }[]) =>
        new Set(items.map((x) => x.id)).size === items.length;
      if (
        ![
          v.findings,
          v.evidence,
          v.assumptions,
          v.unknowns,
          v.knowledgeGaps,
          v.proposals,
          v.artifacts,
          v.lineage,
        ].every(unique)
      )
        ctx.addIssue({ code: 'custom', message: 'Duplicate content identity' });
      const findings = new Set(v.findings.map((x) => x.id));
      const evidence = new Set(v.evidence.map((x) => x.id));
      const lineage = new Set(v.lineage.map((x) => x.id));
      if (
        [
          ...v.findings,
          ...v.proposals,
          ...v.assumptions,
          ...v.knowledgeGaps,
        ].some((x) => x.evidenceIds.some((i) => !evidence.has(i))) ||
        v.knowledgeGaps.some((x) =>
          x.findingIds.some((i) => !findings.has(i)),
        ) ||
        [...v.findings, ...v.proposals, ...v.knowledgeGaps].some((x) =>
          x.lineageIds.some((i) => !lineage.has(i)),
        )
      )
        ctx.addIssue({
          code: 'custom',
          message: 'Unresolved evidence, finding or lineage reference',
        });
    }),
  LIMITS.outcomeBytes,
);
export type ResultContent = z.infer<typeof ResultContentSchema>;
export function emptyContent(): ResultContent {
  return {
    findings: [],
    evidence: [],
    assumptions: [],
    unknowns: [],
    knowledgeGaps: [],
    proposals: [],
    artifacts: [],
    warnings: [],
    lineage: [],
  };
}
export type Finding = z.infer<typeof FindingSchema>;
export type EvidenceObservation = z.infer<typeof EvidenceObservationSchema>;
export type Proposal = z.infer<typeof ProposalSchema>;
export type Provenance = z.infer<typeof ProvenanceSchema>;
