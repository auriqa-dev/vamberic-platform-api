import {
  digest,
  PRODUCT_WEBSITE_MANIFEST,
  WebsiteReviewCheckpointSchema,
  WEBSITE_REVIEW_INPUT,
  websiteReviewFields,
  parseWebsiteReviewResponse,
  AnswerProvenanceSchema,
  validateAnswerProvenance,
  type RuntimeOutcome,
} from "@workspace/agent-runtime-protocol";
import type { Db, ClientSession } from "mongodb";
import {
  AgentAttemptSchema,
  AgentResultSchema,
  type AgentRun,
} from "../../domain/agent-control-plane";
import { withoutMongoId } from "../hvm-context";
export function websiteReviewPin(run: AgentRun, payload: unknown) {
  const pin = WebsiteReviewCheckpointSchema.parse(payload);
  if (
    run.frozen.protocolVersion !== "2.0" ||
    run.operation !== "understand" ||
    run.manifest.manifestDigest !== PRODUCT_WEBSITE_MANIFEST.manifestDigest ||
    pin.inputDigest !== digest(run.frozen.input) ||
    pin.sourceDigests.length !== run.frozen.context.snapshots.length ||
    pin.sourceDigests.some(
      (s) =>
        !run.frozen.context.snapshots.some(
          (snapshot) =>
            digest(snapshot.reference) === digest(s.reference) &&
            snapshot.payloadDigest === s.digest,
        ),
    )
  )
    throw new Error("Website review context changed");
  return pin;
}
/** Resolve accepted human testimony from persisted audit/attempt witnesses,
 * never from worker-supplied provenance alone. Existing transaction/fence checks
 * and independent effectiveness/apply/approval remain in force. */
export async function verifyWebsiteReview(
  db: Db,
  run: AgentRun,
  envelope: RuntimeOutcome,
  session: ClientSession,
) {
  if (run.operation !== "understand")
    throw new Error("Website review maker required");
  const outcome = envelope.outcome;
  if (outcome.kind === "needs_input") {
    websiteReviewPin(run, outcome.checkpoint.payload);
    if (
      outcome.inputRequest.schemaKey !== WEBSITE_REVIEW_INPUT ||
      outcome.inputRequest.schemaVersion !== 1 ||
      digest(outcome.inputRequest.fields) !== digest(websiteReviewFields()) ||
      outcome.content.proposals.length ||
      outcome.content.findings.length ||
      outcome.content.evidence.length
    )
      throw new Error("Invalid website review request");
    return;
  }
  if (
    !outcome.content.proposals.length &&
    !outcome.content.evidence.length &&
    !outcome.content.findings.length
  )
    return;
  const witnesses = (
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
        r.envelope.outcome.inputRequest.schemaKey === WEBSITE_REVIEW_INPUT,
    );
  if (witnesses.length !== 1)
    throw new Error("Exact website review witness required");
  const paused = witnesses[0]!.envelope.outcome;
  if (paused.kind !== "needs_input") throw new Error("Review witness kind");
  const pin = websiteReviewPin(run, paused.checkpoint.payload);
  const response = run.inputResponses.find(
    (r) => r.requestId === paused.inputRequest.id,
  );
  if (!response) throw new Error("Accepted website review absent");
  const events = await db
    .collection("events")
    .find(
      {
        workspaceId: run.workspaceId,
        eventType: "agent_run_changed",
        "payload.operation": "input_answered",
        "payload.runId": run.id,
        "payload.answerProvenance.requestId": response.requestId,
      },
      { session },
    )
    .limit(2)
    .toArray();
  if (events.length !== 1) throw new Error("Website review attestation absent");
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
    attempt.consumedCheckpointDigest !== paused.checkpoint.digest ||
    attempt.consumedInputRequestId !== response.requestId ||
    digest(event.payload.actor) !== digest(provenance.actor) ||
    event.payload.generation !== provenance.resumeGeneration
  )
    throw new Error("Website review attempt binding mismatch");
  validateAnswerProvenance(provenance, {
    ...run.frozen,
    protocolVersion: "1.2",
    generation: attempt.generation,
    resume: {
      kind: "input",
      checkpoint: paused.checkpoint,
      request: paused.inputRequest,
      response,
      answerProvenance: provenance,
    },
  });
  const selected = parseWebsiteReviewResponse(
    paused.inputRequest,
    response,
    pin,
  ).fields.filter((f) => f.included);
  const expected = Object.fromEntries(
    selected.map((f) => [f.binding.field, f.binding.value]),
  );
  if (
    outcome.content.proposals.some(
      (p) => digest(p.candidate) !== digest(expected),
    ) ||
    outcome.content.evidence.length !== selected.length ||
    outcome.content.findings.length !== selected.length
  )
    throw new Error("Website review output differs from accepted response");
  for (const f of selected) {
    const id = `review:${f.binding.field}`;
    const e = outcome.content.evidence.find((e) => e.id === id),
      finding = outcome.content.findings.find((f) => f.id === id);
    if (
      !e ||
      e.excerpt !==
        (f.originalSuggestion
          ? JSON.stringify({
              supports: "original_suggestion_only",
              basis: f.originalSuggestion.basis,
              edited: f.edited,
              support: f.originalSuggestion.support,
            })
          : undefined) ||
      digest(e.candidate) !== digest(f.binding) ||
      e.origin !== "user_supplied" ||
      e.source.kind !== "reference" ||
      e.source.id !== response.requestId ||
      e.digest !== provenance.responseDigest ||
      e.observedAt !== provenance.submittedAt ||
      e.retrievedAt !== provenance.submittedAt ||
      digest(e.provenance) !==
        digest({
          provider: "human_input",
          adapterKey: "psu_website_human_review",
          adapterVersion: 1,
          invocationId: provenance.submissionId,
        }) ||
      !finding ||
      finding.kind !== "evidence_backed_finding" ||
      finding.payload !== undefined ||
      digest(finding.evidenceIds) !== digest([id])
    )
      throw new Error("Website review evidence mismatch");
  }
}
