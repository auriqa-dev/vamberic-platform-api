import {
  digest,
  type RuntimeOutcome as Outcome,
} from "@workspace/agent-runtime-protocol";
import type { AgentRun } from "./agent-control-plane";

/** Protocol validity is not authorization. Match accepted source/target identities
 * against the exact persisted grant, never a worker-supplied workspace claim. */
export function outcomeWithinGrant(
  run: AgentRun,
  envelope: Outcome,
  importedEvidence: ReadonlySet<string> = new Set(),
): boolean {
  const grant = run.frozen.grant;
  const content = envelope.outcome.content;
  const checkpointLineage =
    envelope.outcome.kind === "needs_input" || envelope.outcome.kind === "yield"
      ? envelope.outcome.checkpoint.lineage
      : [];
  for (const lineage of [...content.lineage, ...checkpointLineage]) {
    if (lineage.source.kind === "resource") {
      const reference = lineage.source.reference;
      const resource = grant.resources.find(
        (r) => digest(r.reference) === digest(reference),
      );
      const proposalBase =
        lineage.role === "proposal_base" &&
        !lineage.fields &&
        grant.proposalTargets.some(
          (target) =>
            target.kind === "update" &&
            digest(target.reference) === digest(reference),
        );
      if (
        (!resource && !proposalBase) ||
        reference.workspaceId !== run.workspaceId ||
        (lineage.fields ?? []).some((f) => !resource?.fields.includes(f))
      )
        return false;
      if (
        lineage.snapshotId &&
        !run.frozen.context.snapshots.some(
          (s) =>
            s.id === lineage.snapshotId &&
            digest(s.reference) === digest(reference),
        )
      )
        return false;
    } else if (lineage.source.kind === "input") {
      const source = lineage.source;
      const answer = run.inputResponses.find(
        (r) => r.requestId === source.requestId,
      );
      if (
        !answer ||
        ![
          digest(answer),
          ...answer.values.map((v) => digest(v.value)),
        ].includes(source.contentHash)
      )
        return false;
    } else if (lineage.source.kind === "artifact") {
      const source = lineage.source;
      if (
        !content.artifacts.some(
          (a) => a.id === source.artifactId && a.digest === source.contentHash,
        )
      )
        return false;
    }
  }
  for (const proposal of content.proposals) {
    const target = proposal.target;
    const allowed = grant.proposalTargets.some(
      (g) =>
        g.targetKind === proposal.targetKind &&
        g.kind === target.kind &&
        (g.kind === "update" && target.kind === "update"
          ? digest(g.reference) === digest(target.reference)
          : g.kind === "create" &&
            target.kind === "create" &&
            digest(g.parents) === digest(target.parents)),
    );
    if (!allowed) return false;
  }
  const providers = new Set([
    ...grant.models.map((m) => m.provider),
    ...grant.tools.map((t) => t.provider),
  ]);
  for (const observation of content.evidence) {
    if (importedEvidence.has(observation.id)) continue;
    if (observation.provenance.provider === "human_input") {
      const source = observation.source;
      const answer =
        source.kind === "reference" &&
        run.inputResponses.find((r) => r.requestId === source.id);
      if (
        observation.origin !== "user_supplied" ||
        !answer ||
        ![
          digest(answer),
          ...answer.values.map((v) => digest(v.value)),
        ].includes(observation.digest) ||
        observation.observedAt < answer.answeredAt
      )
        return false;
    } else if (!providers.has(observation.provenance.provider)) return false;
  }
  for (const observation of envelope.usage) {
    if (!providers.has(observation.provider)) return false;
    if (
      observation.category === "model" &&
      !grant.models.some(
        (m) =>
          m.provider === observation.provider && m.model === observation.model,
      )
    )
      return false;
    if (
      observation.category === "tool" &&
      !grant.tools.some(
        (t) =>
          t.provider === observation.provider &&
          t.key === observation.tool &&
          t.operation === observation.operation,
      )
    )
      return false;
  }
  if (
    envelope.outcome.kind === "needs_input" ||
    envelope.outcome.kind === "yield"
  ) {
    const checkpoint = envelope.outcome.checkpoint;
    if (
      checkpoint.runId !== run.id ||
      checkpoint.schemaVersion !== run.frozen.checkpointSchemaVersion ||
      digest(checkpoint.implementation) !==
        digest({
          key: run.frozen.implementation.key,
          version: run.frozen.implementation.version,
        })
    )
      return false;
  }
  return true;
}
