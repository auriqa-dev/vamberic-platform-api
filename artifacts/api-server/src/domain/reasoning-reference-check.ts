import { digest } from "@workspace/agent-runtime-protocol";
import type { Document } from "mongodb";
import { getOfferMethodology } from "./offer-methodologies";
import {
  validateReasoningSemantics,
  type REASONING_SCHEMAS,
} from "./reasoning-foundation";
/** Exact digest of persisted evidence, excluding Mongo's transport identity; Dates encode as ISO strings. */
export function reasoningEvidenceDigest(row: Document): string {
  return digest(
    JSON.parse(
      JSON.stringify(
        Object.fromEntries(
          Object.entries(row).filter(([key]) => key !== "_id"),
        ),
      ),
    ),
  );
}
/** Trusted, workspace-filtered repository resolver; not a user-supplied provenance assertion. */
export type FoundationReferenceResolver = (
  collection: string,
  id: string,
  workspaceId: string,
) => Promise<Document | null>;
/** Pure admission proof for future adapters. Does not authorize, persist, execute or substitute latest revisions. */
export async function checkReasoningReferences(
  collection: keyof typeof REASONING_SCHEMAS,
  input: unknown,
  workspaceId: string,
  resolve: FoundationReferenceResolver,
) {
  const record = validateReasoningSemantics(collection, input);
  if (record.workspaceId !== workspaceId) throw new Error("Workspace mismatch");
  const get = async (collection: string, id: string) => {
    const row = await resolve(collection, id, workspaceId);
    if (!row || row.id !== id || row.workspaceId !== workspaceId)
      throw new Error("Unavailable workspace reference");
    return row;
  };
  const globalReference = async (
    name: string,
    id: string,
    version?: number,
  ) => {
    const row = await resolve(name, id, workspaceId);
    if (
      !row ||
      row.id !== id ||
      row.workspaceId !== undefined ||
      row.archived ||
      (version !== undefined && row.version !== version)
    )
      throw new Error("Unavailable global catalogue reference");
  };
  async function walk(value: unknown): Promise<void> {
    if (Array.isArray(value)) {
      for (const item of value) await walk(item);
      return;
    }
    if (!value || typeof value !== "object" || value instanceof Date) return;
    const v = value as Document;
    if (v.snapshotId) {
      const row = await get(
        v.kind === "offer" ? "offer_revisions" : "hive_definition_revisions",
        v.snapshotId,
      );
      if (
        row.revision !== v.revision ||
        (v.kind !== "offer" &&
          row.entityType !==
            (
              {
                offering: "offerings",
                icp: "ideal_customer_profiles",
                buyer_profile: "buyer_profiles",
              } as Record<string, string>
            )[v.kind]) ||
        row.snapshot?.contentHash !== v.contentHash ||
        (row.entityId ?? row.offerId) !== v.entityId
      )
        throw new Error("Exact knowledge revision mismatch");
    }
    if (v.collection && v.contentHash) {
      const row = await get(v.collection, v.id);
      if (
        reasoningEvidenceDigest(row) !== v.contentHash ||
        (v.evidenceId &&
          !(row.snapshot?.evidence ?? row.evidence)?.some(
            (e: Document) => e.id === v.evidenceId,
          ))
      )
        throw new Error("Exact evidence mismatch");
    }
    if (v.capabilityId) await globalReference("capabilities", v.capabilityId);
    if (v.agentDefinitionId)
      await globalReference(
        "agent_definitions",
        v.agentDefinitionId,
        v.agentDefinitionVersion,
      );
    if (v.resultId) await get("agent_results", v.resultId);
    for (const [key, item] of Object.entries(v)) {
      const names: Record<string, string> = {
        organisationIds: "organisations",
        personIds: "people",
        contactPointIds: "contact_points",
        campaignIds: "campaigns",
        observationIds: "events",
        learningIds: "scoped_learning",
        contextIds: "reasoning_contexts",
        contextId: "reasoning_contexts",
        decisionIds: "reasoning_decisions",
        outcomeEventIds: "events",
      };
      if (key === "capabilityIds")
        for (const id of item as string[])
          await globalReference("capabilities", id);
      if (names[key])
        for (const id of Array.isArray(item) ? item : [item])
          await get(names[key]!, id);
      if (key === "policies")
        for (const ref of item as Document[]) {
          if (
            (await get("contact_strategy_policies", ref.id)).version !==
            ref.version
          )
            throw new Error("Policy version mismatch");
        }
      if (key === "methodologies")
        for (const ref of item as Document[]) {
          if (!getOfferMethodology(ref.id, ref.version))
            throw new Error("Unknown exact methodology");
        }
      await walk(item);
    }
  }
  if (record.supersedesId) await get(collection, record.supersedesId);
  await walk(record);
  return record;
}
