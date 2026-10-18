import { verifyWebsiteReview } from "./website-review";
import { PRODUCT_WEBSITE_MANIFEST } from "@workspace/agent-runtime-protocol";
import { verifyGeneralClarificationRequest } from "./general-clarification";
import { verifyUncertaintyRequest } from "./uncertainty";
import { projectCanonicalSupport } from "../canonical-support";
import { SupportReferenceSchema } from "../../domain/canonical-support";
import type { Db, ClientSession } from "mongodb";
import {
  ProductCanonicalContextSchema,
  canonicalProductFinding,
  selectedCandidate,
  digest,
  digestWithout,
  PRODUCT_GENERAL_MANIFEST,
  PRODUCT_UNCERTAINTY_MANIFEST,
  PRODUCT_REVIEWED_UNCERTAINTY_MANIFEST,
  PRODUCT_CLARIFICATION_MANIFEST,
  ProductRevisionPinSchema,
  ProductHistorySchema,
  ProductAppendProofSchema,
  FactSubmissionCheckpointSchema,
  AnswerProvenanceSchema,
  validateAnswerProvenance,
  validateProductAppend,
  validateModernProductContent,
  validateProductContent,
  EvaluationPayloadSchema,
  type RuntimeOutcome,
} from "@workspace/agent-runtime-protocol";
import {
  AgentRunSchema,
  AgentResultSchema,
  AgentAttemptSchema,
  type AgentRun,
} from "../../domain/agent-control-plane";
import { EffectivenessCaseSchema } from "../../domain/agent-effectiveness";
import { withoutMongoId } from "../hvm-context";

/** Internal integrity admission, not an authorization/freshness substitute.
 * Call inside the existing serialized outcome/application/approval transaction.
 * Resolve immutable witnesses by exact IDs; never select latest. */
export async function verifyProductSupport(
  db: Db,
  run: AgentRun,
  envelope: RuntimeOutcome,
  session: ClientSession,
  seen = new Set<string>(),
) {
  if (
    run.frozen.implementation.key !== "product_service_understanding" ||
    run.operation === "evaluate_understanding"
  )
    return;
  if (
    run.manifest.manifestDigest === PRODUCT_WEBSITE_MANIFEST.manifestDigest &&
    run.operation === "understand"
  )
    await verifyWebsiteReview(db, run, envelope, session);
  if (
    run.manifest.manifestDigest ===
    PRODUCT_CLARIFICATION_MANIFEST.manifestDigest
  )
    verifyGeneralClarificationRequest(run, envelope);
  else verifyUncertaintyRequest(run, envelope);
  const content = envelope.outcome.content;
  if (content.domainOutput === undefined) return;
  const modern = [
    PRODUCT_GENERAL_MANIFEST.manifestDigest,
    PRODUCT_WEBSITE_MANIFEST.manifestDigest,
    PRODUCT_UNCERTAINTY_MANIFEST.manifestDigest,
    PRODUCT_REVIEWED_UNCERTAINTY_MANIFEST.manifestDigest,
    PRODUCT_CLARIFICATION_MANIFEST.manifestDigest,
  ].includes(run.manifest.manifestDigest);
  (modern ? validateModernProductContent : validateProductContent)(
    content,
    envelope.outcome.kind === "success" &&
      envelope.outcome.completeness.kind === "complete",
  );
  const canonical = await verifyProductCanonicalSnapshots(
    db,
    run,
    session,
    (ref) => {
      if (ref.workspaceId !== run.workspaceId)
        throw new Error("Canonical scope mismatch");
    },
    seen,
  );
  const proofs = content.findings
    .filter((f) => f.payload !== undefined)
    .filter((f) => {
      const matches = canonical
        .flatMap((c) => c.composed)
        .filter((c) => {
          const strip = ({ lineageIds, ...rest }: typeof f) => {
            void lineageIds;
            return rest;
          };
          return digest(strip(canonicalProductFinding(c))) === digest(strip(f));
        });
      if (!matches.length) return true;
      if (
        matches.length !== 1 ||
        matches[0]!.evidence.some(
          (e) =>
            digest(content.evidence.find((x) => x.id === e.id) ?? null) !==
            digest(e),
        )
      )
        throw new Error("Canonical support observation mismatch");
      const root = canonical.find((c) =>
        c.composed.includes(matches[0]!),
      )!.root;
      const edge = content.lineage.find(
        (l) =>
          l.role === "consumed" &&
          l.source.kind === "resource" &&
          digest(l.source.reference) === digest(root),
      );
      if (!edge || !f.lineageIds.includes(edge.id))
        throw new Error("Canonical support lineage missing");
      return false;
    });
  if (!proofs.length) return;
  if (!modern || run.operation !== "revise_understanding" || !run.effectiveness)
    throw new Error("Product proof implementation mismatch");
  const identity = `${run.id}:${envelope.attemptId}`;
  if (
    seen.has(identity) ||
    [...seen].filter((k) => !k.startsWith("dependency:")).length >= 20
  )
    throw new Error("Product proof traversal bound");
  seen.add(identity);
  const rawInput = run.frozen.input as Record<string, unknown>;
  const input = {
    revisionPin: ProductRevisionPinSchema.parse(rawInput.revisionPin),
    history: ProductHistorySchema.parse(rawInput.history),
  };
  const pin = input.revisionPin;
  const c = EffectivenessCaseSchema.parse(
    withoutMongoId(
      (await db
        .collection("agent_effectiveness_cases")
        .findOne(
          { id: run.effectiveness.caseId, workspaceId: run.workspaceId },
          { session },
        )) ?? {},
    ),
  );
  if (
    pin.candidate.caseId !== c.id ||
    !c.candidates.some((x) => digest(x.reference) === digest(pin.candidate)) ||
    !c.evaluations.some(
      (x) =>
        x.resultId === pin.evaluation.resultId &&
        x.candidateRevision === pin.candidate.revision,
    )
  )
    throw new Error("Persisted revision case mismatch");
  const load = async (id: string) =>
    AgentResultSchema.parse(
      withoutMongoId(
        (await db
          .collection("agent_results")
          .findOne({ id, workspaceId: run.workspaceId }, { session })) ?? {},
      ),
    );
  const prior = await load(pin.candidate.resultId),
    evaluation = await load(pin.evaluation.resultId);
  const evaluationPayload = EvaluationPayloadSchema.parse(
    evaluation.envelope.outcome.content.domainOutput,
  );
  if (
    prior.envelope.payloadDigest !== pin.candidate.envelopeDigest ||
    digest(
      selectedCandidate(prior.envelope.outcome.content, pin.candidate.selector),
    ) !== pin.candidate.contentDigest ||
    evaluationPayload.criteriaDigest !== c.criteria.digest ||
    digest(evaluationPayload.policy) !== digest(c.policy.identity) ||
    prior.runId !== pin.candidate.runId ||
    prior.attemptId !== pin.candidate.attemptId ||
    evaluation.envelope.payloadDigest !== pin.evaluation.envelopeDigest ||
    digest(evaluationPayload.candidate) !== digest(pin.candidate) ||
    prior.envelope.payloadDigest !==
      digestWithout(prior.envelope, "payloadDigest") ||
    evaluation.envelope.payloadDigest !==
      digestWithout(evaluation.envelope, "payloadDigest")
  )
    throw new Error("Persisted revision witness mismatch");
  const priorRun = AgentRunSchema.parse(
    withoutMongoId(
      (await db
        .collection("agent_runs")
        .findOne(
          { id: prior.runId, workspaceId: run.workspaceId },
          { session },
        )) ?? {},
    ),
  );
  await verifyProductSupport(db, priorRun, prior.envelope, session, seen);
  const priorContent = prior.envelope.outcome.content;
  for (const finding of proofs) {
    const old = priorContent.findings.find((f) => f.id === finding.id);
    if (old) {
      const strip = ({ lineageIds, ...rest }: typeof finding) => {
        void lineageIds;
        return rest;
      };
      if (digest(strip(old)) !== digest(strip(finding)))
        throw new Error("Inherited Product proof changed");
      continue;
    }
    const proof = ProductAppendProofSchema.parse(finding.payload);
    if (digest(proof.prior) !== digest(pin))
      throw new Error("Prepared Product pin mismatch");
    const requestId = proof.additions[0]!.requestId;
    const paused = (
      await db
        .collection("agent_results")
        .find({ runId: run.id, workspaceId: run.workspaceId }, { session })
        .limit(21)
        .toArray()
    )
      .map((r) => AgentResultSchema.parse(withoutMongoId(r)))
      .filter(
        (r) =>
          r.envelope.outcome.kind === "needs_input" &&
          r.envelope.outcome.inputRequest.id === requestId,
      );
    if (paused.length !== 1)
      throw new Error("Missing or ambiguous Product input witness");
    const outcome = paused[0]!.envelope.outcome;
    if (outcome.kind !== "needs_input")
      throw new Error("Product input witness kind");
    const checkpoint = FactSubmissionCheckpointSchema.parse(
      outcome.checkpoint.payload,
    );
    if (checkpoint.inputDigest !== digest(run.frozen.input))
      throw new Error("Product checkpoint input changed");
    const response = run.inputResponses.find((r) => r.requestId === requestId);
    if (!response) throw new Error("Accepted Product response missing");
    const events = await db
      .collection("events")
      .find(
        {
          workspaceId: run.workspaceId,
          eventType: "agent_run_changed",
          "payload.operation": "input_answered",
          "payload.runId": run.id,
          "payload.answerProvenance.requestId": requestId,
        },
        { session },
      )
      .limit(2)
      .toArray();
    if (events.length !== 1)
      throw new Error("Product attestation witness mismatch");
    const event = events[0]!,
      provenance = AnswerProvenanceSchema.parse(event.payload.answerProvenance);
    const attempt = AgentAttemptSchema.parse(
      withoutMongoId(
        (await db.collection("agent_attempts").findOne(
          {
            id: envelope.attemptId,
            runId: run.id,
            workspaceId: run.workspaceId,
          },
          { session },
        )) ?? {},
      ),
    );
    if (
      attempt.fence !== envelope.fence ||
      attempt.generation !== envelope.generation ||
      attempt.consumedCheckpointDigest !== outcome.checkpoint.digest ||
      attempt.consumedInputRequestId !== requestId ||
      digest(event.payload.actor) !== digest(provenance.actor) ||
      event.payload.generation !== provenance.resumeGeneration
    )
      throw new Error("Product Attempt/answer binding mismatch");
    validateAnswerProvenance(provenance, {
      ...run.frozen,
      protocolVersion: "1.2",
      generation: attempt.generation,
      resume: {
        kind: "input",
        checkpoint: outcome.checkpoint,
        request: outcome.inputRequest,
        response,
        answerProvenance: provenance,
      },
    });
    validateProductAppend(content, finding.id, {
      pin,
      priorContent,
      imports: input.history.importedSupport,
      answer: {
        checkpoint,
        request: outcome.inputRequest,
        response,
        provenance,
      },
    });
  }
}

/** Re-resolve every selected certificate at existing workload freshness boundaries.
 * The caller independently checks current scoped read authority. */
export async function verifyProductCanonicalSnapshots(
  db: Db,
  run: AgentRun,
  session: ClientSession,
  authorize: (r: ReturnType<typeof SupportReferenceSchema.parse>) => void,
  seen = new Set<string>(),
) {
  const projections: ReturnType<typeof ProductCanonicalContextSchema.parse>[] =
    [];
  for (const snapshot of run.frozen.context.snapshots) {
    if (!snapshot.fields.includes("canonicalSupport")) continue;
    if (
      ![
        PRODUCT_GENERAL_MANIFEST.manifestDigest,
        PRODUCT_WEBSITE_MANIFEST.manifestDigest,
        PRODUCT_UNCERTAINTY_MANIFEST.manifestDigest,
        PRODUCT_REVIEWED_UNCERTAINTY_MANIFEST.manifestDigest,
        PRODUCT_CLARIFICATION_MANIFEST.manifestDigest,
      ].includes(run.manifest.manifestDigest) ||
      snapshot.reference.resourceType !== "offerings" ||
      projections.length
    )
      throw new Error("Canonical projection policy bound");
    const definition = await db.collection("agent_definitions").findOne(
      {
        id: run.frozen.definition.id,
        version: run.frozen.definition.version,
        archived: { $ne: true },
        status: "active",
      },
      { session },
    );
    if (!definition) throw new Error("Canonical reader Definition unavailable");
    const reference = SupportReferenceSchema.parse(snapshot.reference);
    const projection = await projectCanonicalSupport(
      db,
      run.workspaceId,
      session,
      reference,
      (ref) => {
        if (
          !definition.data.hiveAccess.readResources.includes(ref.resourceType)
        )
          throw new Error("Canonical dependency outside Definition read scope");
        authorize(ref);
      },
      seen,
    );
    const canonical = await db
      .collection("offerings")
      .findOne({ id: reference.id, workspaceId: run.workspaceId }, { session });
    if (!canonical) throw new Error("Canonical source absent");
    const expected = {
      definition: canonical.definition,
      evidence: canonical.evidence,
      revision: canonical.revision,
      status: canonical.status,
      canonicalSupport: projection,
    };
    if (
      digest(JSON.parse(JSON.stringify(expected))) !== snapshot.payloadDigest ||
      digest(snapshot.payload) !== snapshot.payloadDigest ||
      digest(snapshot.fields) !== digest(Object.keys(expected))
    )
      throw new Error("Canonical frozen projection changed");
    projections.push(projection);
  }
  return projections;
}
