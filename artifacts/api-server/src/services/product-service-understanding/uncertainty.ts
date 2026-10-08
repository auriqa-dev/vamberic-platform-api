import { productionCaseBudget } from "./execution-policy";
import { z } from "zod";
import {
  digest,
  digestWithout,
  ApplicabilitySelectionSchema,
  verifyApplicabilitySupport,
  reviewedQuestion,
  BudgetLimitsSchema,
  PsuUncertaintyOriginV2,
  PsuUncertaintyCheckpointV2,
  uncertaintyFields,
  EvaluationPayloadSchema,
  PRODUCT_REVIEWED_UNCERTAINTY_MANIFEST,
  PSU_REVIEWED_INPUT,
} from "@workspace/agent-runtime-protocol";
import { EffectivenessCaseSchema } from "../../domain/agent-effectiveness";
import {
  AgentRunSchema,
  AgentResultSchema,
} from "../../domain/agent-control-plane";
import { withoutMongoId } from "../hvm-context";
import type { EffectivenessProfile } from "../agent-effectiveness";
const selection = z
  .object({
    expectedRevision: z.number().int().positive(),
    gapKey: z.literal("assessment_input_responsibilities"),
    criterionIds: z.tuple([
      z.literal("receipt_and_delivery"),
      z.literal("downstream_sufficiency"),
    ]),
    allocation: z.unknown(),
    applicability: z.unknown(),
  })
  .strict();
/** Same exact target only; called within the owning Effectiveness transaction. */
export async function prepareUncertainty(
  context: Parameters<EffectivenessProfile["prepareCase"]>[0],
  raw: unknown,
  production = false,
) {
  const parsed = selection.parse(raw);
  const selected = {
      ...parsed,
      applicability: ApplicabilitySelectionSchema.parse(parsed.applicability),
    },
    { db, session, predecessor: p } = context;
  if (
    !p ||
    !context.predecessorFresh ||
    p.status !== "held" ||
    p.stateRevision !== selected.expectedRevision ||
    p.target.kind !== "workspace_agent" ||
    p.target.implementation.manifestDigest !==
      PRODUCT_REVIEWED_UNCERTAINTY_MANIFEST.manifestDigest
  )
    throw new Error("Ineligible uncertainty predecessor");
  const candidate = p.candidates.at(-1)?.reference,
    er = p.evaluations.at(-1);
  if (
    !candidate ||
    !er?.resultId ||
    er.candidateRevision !== candidate.revision
  )
    throw new Error("Missing accepted Evaluation");
  const evaluation = AgentResultSchema.parse(
    withoutMongoId(
      (await db
        .collection("agent_results")
        .findOne(
          { id: er.resultId, workspaceId: p.workspaceId },
          { session },
        )) ?? {},
    ),
  );
  const payload = EvaluationPayloadSchema.parse(
    evaluation.envelope.outcome.content.domainOutput,
  );
  if (
    digest(payload.candidate) !== digest(candidate) ||
    payload.criteriaDigest !== p.criteria.digest ||
    payload.policy.digest !== p.policy.identity.digest ||
    selected.criterionIds.some(
      (id) =>
        !payload.assessments.some(
          (a) => a.criterionId === id && a.outcome === "uncertain",
        ),
    ) ||
    payload.defects.length
  )
    throw new Error("Uncertainty origin mismatch");
  if (
    !context.requestAudit ||
    context.requestAudit.actor.id !== context.identity.subject ||
    context.requestAudit.actor.issuer !== context.identity.issuer
  )
    throw new Error("Authenticated applicability review required");
  const candidateResult = AgentResultSchema.parse(
    withoutMongoId(
      (await db
        .collection("agent_results")
        .findOne(
          { id: candidate.resultId, workspaceId: p.workspaceId },
          { session },
        )) ?? {},
    ),
  );
  if (candidateResult.envelope.payloadDigest !== candidate.envelopeDigest)
    throw new Error("Applicability Candidate changed");
  verifyApplicabilitySupport(
    selected.applicability,
    candidateResult.envelope.outcome.content,
  );
  for (const assessment of selected.applicability.assessments)
    if (
      digest(
        payload.assessments.find(
          (a) => a.criterionId === assessment.criterionId,
        ),
      ) !== assessment.digest
    )
      throw new Error("Applicability assessment changed");
  const applicabilityBody = {
    ...selected.applicability,
    kind: "platform_attributed_applicability_v1",
    policy: "psu_source_backed_human_applicability_v1",
    ...context.requestAudit,
    auditAction: "requested_maker",
    independentlyVerified: false,
  };
  const applicability = {
    ...applicabilityBody,
    digest: digestWithout(applicabilityBody, "digest"),
  };
  const label = z
    .object({ workingLabel: z.string() })
    .parse(context.input).workingLabel;
  const ancestors: string[] = [];
  let cursor = p;
  let requests = 0;
  while (true) {
    if (
      ancestors.includes(cursor.id) ||
      ancestors.length >= 3 ||
      digest(cursor.target) !== digest(p.target)
    )
      throw new Error("Clarification ancestry denied");
    ancestors.push(cursor.id);
    const runs = await db
      .collection("agent_runs")
      .find(
        { "effectiveness.caseId": cursor.id, workspaceId: p.workspaceId },
        { session },
      )
      .limit(40)
      .toArray();
    if (
      runs.length >= 40 ||
      cursor.allocations.some((a) => !runs.some((r) => r.id === a.runId)) ||
      !runs.some((r) => r.id === cursor.rootRunId)
    )
      throw new Error("Missing bounded clarification history");
    for (const row of runs) {
      const run = AgentRunSchema.parse(withoutMongoId(row));
      requests += run.inputCycles;
      if (
        run.inputRequest?.schemaKey === PSU_REVIEWED_INPUT ||
        (run.frozen.input as Record<string, unknown>).uncertaintyOrigin
      )
        throw new Error("Repeated uncertainty gap requires Queen review");
    }
    if (!cursor.predecessorCase) break;
    cursor = EffectivenessCaseSchema.parse(
      withoutMongoId(
        (await db
          .collection("agent_effectiveness_cases")
          .findOne(
            { id: cursor.predecessorCase.id, workspaceId: p.workspaceId },
            { session },
          )) ?? {},
      ),
    );
  }
  if (requests >= 3) throw new Error("Clarification request limit");
  const duplicate = await db
    .collection("agent_effectiveness_cases")
    .findOne(
      { "predecessorCase.id": p.id, workspaceId: p.workspaceId },
      { session },
    );
  if (duplicate) throw new Error("Predecessor already has a linked case");
  const allocation = BudgetLimitsSchema.parse(selected.allocation);
  if (
    production
      ? digest(allocation) !== digest(productionCaseBudget(allocation.deadline))
      : allocation.modelCalls !== 16 ||
        allocation.toolCalls !== 6 ||
        digest(allocation.providerCalls) !==
          digest([
            { provider: "fake_provider", calls: 16 },
            { provider: "public_web", calls: 6 },
          ]) ||
        digest(allocation.cost) !== digest({ currency: "GBP", amount: "1" })
  )
    throw new Error("Explicit bounded allocation required");
  const origin = PsuUncertaintyOriginV2.parse({
    kind: "psu_uncertainty_origin_v2",
    applicability,
    questionDigest: digest(reviewedQuestion(label)),
    predecessorCaseId: p.id,
    predecessorRevision: p.stateRevision,
    workspaceId: p.workspaceId,
    targetDigest: digest(p.target),
    candidate,
    evaluationResultId: evaluation.id,
    evaluationEnvelopeDigest: evaluation.envelope.payloadDigest,
    evaluationDigest: digest(payload),
    criteriaDigest: p.criteria.digest,
    profileDigest: p.criteria.profile.digest,
    policyDigest: p.policy.identity.digest,
    criterionIds: selected.criterionIds,
    gapKey: "assessment_input_responsibilities",
    priorRequestCount: requests,
    ancestorCaseIds: ancestors,
  });
  const reservation = await db
    .collection("agent_effectiveness_cases")
    .updateOne(
      { id: p.id, stateRevision: p.stateRevision },
      { $set: { stateRevision: p.stateRevision + 1 } },
      { session },
    );
  if (reservation.matchedCount !== 1)
    throw new Error("Predecessor allocation conflict");
  return { origin, allocation };
}

/** Code-owned question boundary before an Input Request can be persisted. */
export function verifyUncertaintyRequest(
  run: import("../../domain/agent-control-plane").AgentRun,
  envelope: import("@workspace/agent-runtime-protocol").RuntimeOutcome,
) {
  const prepared = run.frozen.input as Record<string, unknown>;
  if (!prepared?.uncertaintyOrigin) return;
  if (
    run.operation !== "understand" ||
    run.manifest.manifestDigest !==
      PRODUCT_REVIEWED_UNCERTAINTY_MANIFEST.manifestDigest
  )
    throw new Error("Uncertainty maker required");
  const admittedOrigin = PsuUncertaintyOriginV2.parse(
    prepared.uncertaintyOrigin,
  );
  const priorContent = run.frozen.context.snapshots.find(
    (s) =>
      s.reference.id === admittedOrigin.candidate.resultId &&
      s.reference.contentHash === admittedOrigin.candidate.envelopeDigest,
  )?.payload;
  if (!priorContent) throw new Error("Missing exact applicability Candidate");
  const { contractDigest, support, assessments, confirmations } =
    admittedOrigin.applicability;
  verifyApplicabilitySupport(
    { contractDigest, support, assessments, confirmations },
    priorContent as unknown as Parameters<typeof verifyApplicabilitySupport>[1],
  );
  if (
    digest(admittedOrigin.applicability.actor) !== digest(run.requester) ||
    admittedOrigin.applicability.capacity !== run.authority.basis
  )
    throw new Error("Applicability authority binding changed");
  if (envelope.outcome.kind !== "needs_input") return;
  const outcome = envelope.outcome,
    pin = PsuUncertaintyCheckpointV2.parse(outcome.checkpoint.payload);
  const gapId = "gap:assessment_input_responsibilities";
  const question = reviewedQuestion(pin.base.scope.workingLabel);
  const slots = [
    { key: "customer_role", target: "customerRole", gapId },
    { key: "supplier_role", target: "supplierRole", gapId },
  ];
  if (
    outcome.checkpoint.schemaVersion !== 3 ||
    pin.inputDigest !== digest(run.frozen.input) ||
    digest(pin.origin) !== digest(prepared.uncertaintyOrigin) ||
    digest(pin.base.scope) !== digest(prepared.scope) ||
    digest(pin.slots) !== digest(slots) ||
    pin.base.inputCycles !== pin.origin.priorRequestCount + 1 ||
    digest(pin.base.questionKeys) !==
      digest(["assessment_input_responsibilities"]) ||
    outcome.inputRequest.schemaKey !== PSU_REVIEWED_INPUT ||
    outcome.inputRequest.schemaVersion !== 2 ||
    outcome.inputRequest.question !== question ||
    digest(outcome.inputRequest.fields) !== digest(uncertaintyFields(slots)) ||
    outcome.inputRequest.expiresAt !== run.frozen.grant.budgets.deadline ||
    digest(pin.base.content) !== digest(outcome.content)
  )
    throw new Error("Uncertainty request differs from reviewed contract");
  const prior = run.frozen.context.snapshots.find(
    (s) =>
      s.reference.id === pin.origin.candidate.resultId &&
      s.reference.contentHash === pin.origin.candidate.envelopeDigest,
  )?.payload as Record<string, unknown> | undefined;
  if (!prior) throw new Error("Missing uncertainty Candidate");
  if (
    digest(pin.origin.applicability.actor) !== digest(run.requester) ||
    pin.origin.applicability.capacity !== run.authority.basis ||
    pin.origin.questionDigest !== digest(question)
  )
    throw new Error("Applicability authority binding changed");
  for (const field of [
    "domainOutput",
    "evidence",
    "assumptions",
    "unknowns",
    "artifacts",
    "warnings",
  ] as const)
    if (digest(pin.base.content[field]) !== digest(prior[field]))
      throw new Error("Uncertainty changed predecessor content");
  const gaps = z.array(z.unknown()).parse(prior.knowledgeGaps);
  const expected = {
    id: gapId,
    question,
    whyRequired:
      "Resolve evaluated receipt/delivery and downstream responsibility uncertainty.",
    severity: "blocking",
    checked: [
      `Exact Candidate ${pin.origin.candidate.resultId}`,
      `Exact Evaluation ${pin.origin.evaluationResultId}`,
    ],
    evidenceIds: [],
    findingIds: [],
    lineageIds: outcome.content.lineage.map((l) => l.id),
    resolution: { kind: "human_input" },
  };
  if (digest(outcome.content.knowledgeGaps) !== digest([...gaps, expected]))
    throw new Error("Uncertainty gap changed");
}
