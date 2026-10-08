import { z } from "zod";
import { digest } from "@workspace/agent-runtime-protocol";
export const CERTIFICATE_EVENT = "canonical_support_certified";
export const canonicalDigest = (value: unknown) =>
  digest(JSON.parse(JSON.stringify(value)));
const hash = z.string().regex(/^[a-f0-9]{64}$/),
  id = z.string().min(1).max(100);
export const SupportReferenceSchema = z
  .object({
    resourceType: z.enum([
      "offerings",
      "ideal_customer_profiles",
      "buyer_profiles",
      "offers",
      "offer_designs",
      "brands",
      "brand_kits",
    ]),
    id,
    workspaceId: id,
    contentHash: hash,
    revision: z.number().int().positive().optional(),
    version: z.number().int().positive().optional(),
  })
  .strict();
export const SupportWitnessSchema = z
  .object({ id, envelopeDigest: hash })
  .strict();
export const SelfEdgeSchema = z
  .object({ resultId: id, lineageId: id, reference: SupportReferenceSchema })
  .strict();
export const SupportApplicationSchema = z
  .object({
    runId: id,
    attemptId: id,
    resultId: id,
    envelopeDigest: hash,
    proposalId: id,
    caseId: id,
    candidateDigest: hash,
    evaluationResultId: id,
    evaluationDigest: hash,
    criteriaDigest: hash,
    policyDigest: hash,
    definitionId: id,
    manifestDigest: hash,
    appliedDraftDigest: hash,
    witnesses: z.array(SupportWitnessSchema).min(1).max(20),
    selfEdges: z.array(SelfEdgeSchema).max(40),
    independent: z.array(SupportReferenceSchema).max(40),
    independentSnapshots: z
      .array(
        z.object({ reference: SupportReferenceSchema, digest: hash }).strict(),
      )
      .max(40),
    proofDigests: z.array(hash).max(20),
    inputWitnesses: z
      .array(
        z
          .object({
            eventId: id,
            eventDigest: hash,
            runId: id,
            requestId: id,
            responseDigest: hash,
          })
          .strict(),
      )
      .max(20),
  })
  .strict();
export const SupportCertificateBodySchema = z
  .object({
    kind: z.literal("canonical_support_certificate"),
    schemaVersion: z.literal(1),
    policyVersion: z.literal(1),
    verifier: z.literal("canonical_support_v1"),
    workspaceId: id,
    resource: z.literal("offerings"),
    entityId: id,
    revision: z.number().int().positive(),
    snapshotId: id,
    contentHash: hash,
    snapshotDigest: hash,
    evidenceDigest: hash,
    approvedAt: z.string().datetime(),
    approver: z
      .object({
        type: z.literal("human"),
        issuer: z.string().min(1).max(500),
        id: z.string().min(1).max(300),
      })
      .strict(),
    applications: z.array(SupportApplicationSchema).min(1).max(20),
  })
  .strict();
export const SupportCertificateSchema = SupportCertificateBodySchema.extend({
  digest: hash,
}).superRefine((v, c) => {
  const { digest: checksum, ...body } = v;
  if (
    new Set(v.applications.map((a) => a.resultId + "/" + a.proposalId)).size !==
      v.applications.length ||
    v.applications.reduce((n, a) => n + a.witnesses.length, 0) > 20 ||
    v.applications.reduce((n, a) => n + a.independent.length, 0) > 40 ||
    v.applications.reduce((n, a) => n + a.selfEdges.length, 0) > 40 ||
    v.applications.reduce((n, a) => n + a.inputWitnesses.length, 0) > 20 ||
    canonicalDigest(body) !== checksum ||
    Buffer.byteLength(JSON.stringify(v)) > 16384
  )
    c.addIssue({
      code: "custom",
      message: "Invalid certificate digest or bound",
    });
});
export type SupportApplication = z.infer<typeof SupportApplicationSchema>;
export type SupportCertificate = z.infer<typeof SupportCertificateSchema>;
