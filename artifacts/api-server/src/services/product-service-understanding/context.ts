import { digest, JsonPayloadSchema } from "@workspace/agent-runtime-protocol";
import { HiveRevisionSchema } from "../../domain/hive-definitions";

/** Pure bounded projection after the caller's independently authorized exact
 * canonical-history read. This function grants no Result or database access. */
export function approvedProductContext(value: unknown, workspaceId: string) {
  const revision = HiveRevisionSchema.parse(value);
  if (
    revision.entityType !== "offerings" ||
    revision.workspaceId !== workspaceId
  )
    throw new Error("Product context scope mismatch");
  const row = revision.snapshot;
  const facts = Object.entries(row.definition).map(([field, value]) => {
    const observations = row.evidence.filter(
      (e) =>
        e.field === field &&
        e.verification !== "rejected" &&
        digest(e.value) === digest(value),
    );
    return {
      field,
      value,
      knowledgeStatus: observations.length
        ? "attributed_observation"
        : "canonical_unsubstantiated",
      observations: observations.map((e) => ({
        origin: e.origin,
        provider: e.provider,
        sourceReference: e.sourceReference,
        observedAt: e.observedAt.toISOString(),
        verification: e.verification,
        actor: e.actor,
      })),
      publicationPermission: "unknown",
    };
  });
  return JsonPayloadSchema.parse({
    kind: "product_service_context",
    schemaVersion: 1,
    workspaceId,
    offeringId: row.id,
    revision: row.revision,
    contentHash: row.contentHash,
    evidenceHash: digest(JSON.parse(JSON.stringify(row.evidence))),
    facts,
    limitations: [
      "Canonical approval is not independent factual verification or publication permission.",
      "Raw Result access is not implied. Unsubstantiated fields require clarification before evidence-dependent use.",
    ],
  });
}
