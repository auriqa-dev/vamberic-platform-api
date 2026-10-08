import { currentAgentSource } from "./agent-proposal-freshness";
import type { ClientSession, Db } from "mongodb";
import {
  digest,
  digestWithout,
  AnswerProvenanceSchema,
  type SourceLineage,
} from "@workspace/agent-runtime-protocol";
import {
  AgentResultSchema,
  AgentRunSchema,
  AgentAttemptSchema,
} from "../domain/agent-control-plane";
import {
  SupportReferenceSchema,
  canonicalDigest,
  type SupportApplication,
} from "../domain/canonical-support";
import { withoutMongoId } from "./hvm-context";

type Reference = Extract<
  SourceLineage["source"],
  { kind: "resource" }
>["reference"];
/** Internal approval/reuse integrity traversal. It grants no access and performs
 * no freshness substitution. Callers independently authorize and check the
 * complete returned independent dependency set inside their transaction. */
export async function collectSupportGraph(
  db: Db,
  workspaceId: string,
  session: ClientSession,
  roots: string[],
  transition: { before: Reference; resultIds: ReadonlySet<string> } | undefined,
  criteria: SourceLineage[],
  traversal?: Set<string>,
): Promise<
  Pick<
    SupportApplication,
    | "witnesses"
    | "selfEdges"
    | "independent"
    | "proofDigests"
    | "inputWitnesses"
    | "independentSnapshots"
  >
> {
  const witnesses: SupportApplication["witnesses"] = [],
    selfEdges: SupportApplication["selfEdges"] = [],
    independent: SupportApplication["independent"] = [],
    proofDigests: string[] = [];
  const inputWitnesses: SupportApplication["inputWitnesses"] = [];
  const seen = new Set<string>(),
    active = new Set<string>();
  function independentEdge(reference: Reference) {
    const parsed = SupportReferenceSchema.parse(reference);
    if (parsed.workspaceId !== workspaceId)
      throw new Error("Support scope mismatch");
    if (!independent.some((r) => digest(r) === digest(parsed)))
      independent.push(parsed);
    if (independent.length > 40) throw new Error("Support dependency bound");
  }
  async function visit(id: string, expected?: string) {
    if (active.has(id)) throw new Error("Support cycle");
    if (seen.has(id)) {
      if (
        expected &&
        witnesses.find((w) => w.id === id)?.envelopeDigest !== expected
      )
        throw new Error("Support witness mismatch");
      return;
    }
    if (seen.size >= 20) throw new Error("Support witness bound");
    if (traversal) {
      const key = `witness:${id}`;
      if (
        !traversal.has(key) &&
        [...traversal].filter((k) => !k.startsWith("dependency:")).length >= 20
      )
        throw new Error("Aggregate support traversal bound");
      traversal.add(key);
    }
    active.add(id);
    seen.add(id);
    const raw = await db
      .collection("agent_results")
      .findOne({ id, workspaceId }, { session });
    if (!raw) throw new Error("Missing support witness");
    const r = AgentResultSchema.parse(withoutMongoId(raw));
    if (
      r.envelope.payloadDigest !== digestWithout(r.envelope, "payloadDigest") ||
      (expected && r.envelope.payloadDigest !== expected)
    )
      throw new Error("Support envelope mismatch");
    witnesses.push({ id, envelopeDigest: r.envelope.payloadDigest });
    for (const finding of r.envelope.outcome.content.findings)
      if (finding.payload !== undefined)
        proofDigests.push(digest(finding.payload));
    if (proofDigests.length > 20) throw new Error("Support proof bound");
    for (const edge of r.envelope.outcome.content.lineage) {
      if (edge.role !== "consumed") continue;
      if (edge.source.kind === "input") {
        const source = edge.source;
        const rawRun = await db
          .collection("agent_runs")
          .findOne({ id: r.runId, workspaceId }, { session });
        const rawAttempt = await db
          .collection("agent_attempts")
          .findOne({ id: r.attemptId, workspaceId }, { session });
        if (!rawRun || !rawAttempt)
          throw new Error("Support input owner missing");
        const run = AgentRunSchema.parse(withoutMongoId(rawRun)),
          attempt = AgentAttemptSchema.parse(withoutMongoId(rawAttempt));
        const response = run.inputResponses.find(
          (x) => x.requestId === source.requestId,
        );
        const events = await db
          .collection("events")
          .find(
            {
              workspaceId,
              eventType: "agent_run_changed",
              "payload.operation": "input_answered",
              "payload.runId": run.id,
              "payload.answerProvenance.requestId": source.requestId,
            },
            { session },
          )
          .limit(2)
          .toArray();
        if (
          !response ||
          digest(response) !== source.contentHash ||
          events.length !== 1 ||
          attempt.runId !== run.id
        )
          throw new Error("Support response mismatch");
        const event = events[0]!,
          a = AnswerProvenanceSchema.parse(event.payload.answerProvenance);
        if (
          a.workspaceId !== workspaceId ||
          a.runId !== run.id ||
          a.operation !== run.operation ||
          a.requestId !== source.requestId ||
          a.responseDigest !== source.contentHash ||
          a.resumeGeneration !== attempt.generation ||
          digest(a.actor) !== digest(event.payload.actor) ||
          a.resumeGeneration !== event.payload.generation ||
          a.checkpoint.digest !== attempt.consumedCheckpointDigest ||
          attempt.consumedInputRequestId !== source.requestId
        )
          throw new Error("Support attestation mismatch");
        const witness = {
          eventId: event.id,
          eventDigest: canonicalDigest(withoutMongoId(event)),
          runId: run.id,
          requestId: source.requestId,
          responseDigest: source.contentHash,
        };
        if (!inputWitnesses.some((x) => x.eventId === event.id))
          inputWitnesses.push(witness);
        if (inputWitnesses.length > 20) throw new Error("Support input bound");
        continue;
      }
      if (edge.source.kind !== "resource") {
        // No external freshness policy is inferred from stored provenance.
        throw new Error(
          "Support needs a reviewed non-resource admission policy",
        );
      }
      const ref = edge.source.reference;
      if (ref.workspaceId !== workspaceId)
        throw new Error("Support scope mismatch");
      if (ref.resourceType === "agent_result_projection") {
        if (
          ref.revision !== undefined ||
          ref.version !== undefined ||
          !ref.contentHash
        )
          throw new Error("Support projection identity");
        await visit(ref.id, ref.contentHash);
      } else if (
        transition?.resultIds.has(id) &&
        digest(ref) === digest(transition.before)
      ) {
        if (
          selfEdges.some(
            (edge) =>
              edge.resultId === id && digest(edge.reference) === digest(ref),
          )
        )
          throw new Error("Ambiguous self-transition roles");
        selfEdges.push({
          resultId: id,
          lineageId: edge.id,
          reference: SupportReferenceSchema.parse(ref),
        });
        if (selfEdges.length > 40) throw new Error("Support edge bound");
      } else independentEdge(ref);
    }
    active.delete(id);
  }
  for (const id of roots) await visit(id);
  for (const edge of criteria) {
    if (edge.source.kind !== "resource")
      throw new Error("Criteria support currentness is unproven");
    const ref = edge.source.reference;
    // Criteria are an independent obligation, even when they refer to a Result
    // already visited through the controlled application graph.
    await currentAgentSource(db, workspaceId, ref, session);
    if (ref.resourceType === "agent_result_projection")
      await visit(ref.id, ref.contentHash);
    else independentEdge(ref);
  }
  const independentSnapshots = [];
  for (const reference of independent) {
    const row = await currentAgentSource(db, workspaceId, reference, session);
    independentSnapshots.push({
      reference,
      digest: canonicalDigest(withoutMongoId(row)),
    });
  }
  return {
    witnesses,
    selfEdges,
    independent,
    proofDigests,
    inputWitnesses,
    independentSnapshots,
  };
}
