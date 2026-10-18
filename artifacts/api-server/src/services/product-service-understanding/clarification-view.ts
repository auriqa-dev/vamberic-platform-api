import { productionCaseBudget } from "./execution-policy";
import { z } from "zod";
import {
  digest,
  PRODUCT_CLARIFICATION_MANIFEST,
  GENERAL_CLARIFICATION_POLICY,
  EvaluationPayloadSchema,
} from "@workspace/agent-runtime-protocol";
import type { Db, ClientSession } from "mongodb";
import type { EffectivenessCase } from "../../domain/agent-effectiveness";
import {
  AgentRunSchema,
  AgentResultSchema,
} from "../../domain/agent-control-plane";
import { withoutMongoId } from "../hvm-context";
/** Bounded read projection after ordinary case authorization. It conveys no authority;
 * the creation transaction repeats source, assessment, target and ancestry checks. */
export async function generalClarificationView(
  db: Db,
  c: EffectivenessCase,
  session: ClientSession,
  now: Date,
) {
  if (
    c.status !== "held" ||
    c.activeRunId ||
    c.target.kind !== "workspace_agent" ||
    c.target.implementation.manifestDigest !==
      PRODUCT_CLARIFICATION_MANIFEST.manifestDigest ||
    c.predecessorCase
  )
    return undefined;
  const candidate = c.candidates.at(-1)?.reference,
    er = c.evaluations.at(-1);
  if (
    !candidate ||
    !er?.resultId ||
    er.candidateRevision !== candidate.revision
  )
    return undefined;
  const result = async (id: string) =>
    AgentResultSchema.parse(
      withoutMongoId(
        (await db
          .collection("agent_results")
          .findOne({ id, workspaceId: c.workspaceId }, { session })) ?? {},
      ),
    );
  const cr = await result(candidate.resultId),
    ev = await result(er.resultId);
  const evaluation = EvaluationPayloadSchema.parse(
    ev.envelope.outcome.content.domainOutput,
  );
  if (
    cr.envelope.payloadDigest !== candidate.envelopeDigest ||
    digest(evaluation.candidate) !== digest(candidate) ||
    evaluation.criteriaDigest !== c.criteria.digest ||
    evaluation.defects.length
  )
    return undefined;
  const assessments = evaluation.assessments
    .filter((a) => a.outcome === "uncertain")
    .map((a) => ({ criterionId: a.criterionId, digest: digest(a) }));
  if (!assessments.length) return undefined;
  const support = cr.envelope.outcome.content.evidence
    .flatMap((e) => {
      const candidate = e.candidate as { value?: unknown } | undefined;
      const field =
        typeof candidate?.value === "string"
          ? "candidate.value"
          : typeof e.excerpt === "string" && e.excerpt
            ? "excerpt"
            : "claim";
      const value = field === "candidate.value" ? candidate?.value : e[field];
      return typeof value === "string" &&
        value.length > 0 &&
        value.length <= 1500
        ? [
            {
              evidenceId: e.id,
              evidenceDigest: digest(e),
              field,
              start: 0,
              excerpt: value,
            },
          ]
        : [];
    })
    .slice(0, 4);
  if (!support.length) return undefined;
  const root = AgentRunSchema.parse(
    withoutMongoId(
      (await db
        .collection("agent_runs")
        .findOne(
          { id: c.rootRunId, workspaceId: c.workspaceId },
          { session },
        )) ?? {},
    ),
  );
  const prepared = z
    .object({ request: z.record(z.unknown()) })
    .parse(root.frozen.input);
  // Only the original human preparation fields are projected, never frozen grants or checkpoints.
  const request = z
    .object({
      mode: z.enum(["create", "refresh"]),
      brandId: z.string().optional(),
      offeringId: z.string().optional(),
      expectedUpdatedAt: z.string().optional(),
      workingLabel: z.string(),
      orientation: z.string(),
      websiteUrls: z.array(z.string()).optional(),
      canonicalSupport: z.unknown().optional(),
    })
    .strict()
    .parse(prepared.request);
  return {
    target: c.target,
    operation: c.definition.maker,
    request,
    contractDigest: GENERAL_CLARIFICATION_POLICY.digest,
    assessments,
    support,
    allocation:
      digest(c.totalBudget) ===
      digest(productionCaseBudget(c.totalBudget.deadline))
        ? productionCaseBudget(new Date(now.getTime() + 3600000).toISOString())
        : {
            deadline: new Date(now.getTime() + 3600000).toISOString(),
            modelCalls: 16,
            toolCalls: 6,
            providerCalls: [
              { provider: "fake_provider", calls: 16 },
              { provider: "public_web", calls: 6 },
            ],
            cost: { currency: "GBP", amount: "1" },
          },
  };
}
