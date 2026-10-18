import type { Document } from "mongodb";
import { isDeepStrictEqual } from "node:util";
import {
  checkReasoningReferences,
  reasoningEvidenceDigest,
  type FoundationReferenceResolver,
} from "./reasoning-reference-check";
import { getOfferMethodology } from "./offer-methodologies";
import {
  parseV14,
  parseIdentityEventV14,
  ReasoningContextV14Schema,
  ContactStrategyPolicyV14Schema,
  type V14Collection,
} from "./identity-value-v14";

const withoutMongoId = (row: Document): Document =>
  Object.fromEntries(Object.entries(row).filter(([key]) => key !== "_id"));

/** Trusted repository resolution only. Callers still need independent workspace/operation authorization. */
export async function checkV14References(
  collection: V14Collection,
  input: unknown,
  workspaceId: string,
  resolve: FoundationReferenceResolver,
) {
  const row = parseV14(collection, input);
  if (row.workspaceId !== workspaceId) throw new Error("Workspace mismatch");
  const get = async (name: string, id: string) => {
    const found = await resolve(name, id, workspaceId);
    if (!found || found.id !== id || found.workspaceId !== workspaceId)
      throw new Error("Unavailable workspace reference");
    if (found.createdAt instanceof Date && found.createdAt > row.createdAt)
      throw new Error("Future knowledge is unavailable");
    return withoutMongoId(found);
  };
  if (collection === "reasoning_contexts") {
    const base = ReasoningContextV14Schema.parse(row);
    delete base.inputs;
    await checkReasoningReferences(
      "reasoning_contexts",
      base,
      workspaceId,
      resolve,
    );
  }
  if (collection === "contact_strategy_policies") {
    const base = ContactStrategyPolicyV14Schema.parse(row);
    delete base.strategy;
    await checkReasoningReferences(
      "contact_strategy_policies",
      base,
      workspaceId,
      resolve,
    );
  }
  async function walk(input: unknown): Promise<void> {
    if (Array.isArray(input)) {
      for (const item of input) await walk(item);
      return;
    }
    if (!input || typeof input !== "object" || input instanceof Date) return;
    const v = input as Document;
    if (v.collection && (v.digest || v.contentHash)) {
      const target = await get(v.collection, v.id);
      if (reasoningEvidenceDigest(target) !== (v.digest ?? v.contentHash))
        throw new Error("Exact state/evidence digest mismatch");
      if (
        v.evidenceId &&
        !(target.snapshot?.evidence ?? target.evidence)?.some(
          (e: Document) => e.id === v.evidenceId,
        )
      )
        throw new Error("Missing embedded evidence");
    }
    if (v.snapshotId) {
      const target = await get(
        v.kind === "offer" ? "offer_revisions" : "hive_definition_revisions",
        v.snapshotId,
      );
      const type = (
        {
          offering: "offerings",
          icp: "ideal_customer_profiles",
          buyer_profile: "buyer_profiles",
        } as Record<string, string>
      )[v.kind];
      if (
        (target.entityId ?? target.offerId) !== v.entityId ||
        target.revision !== v.revision ||
        target.snapshot?.contentHash !== v.contentHash ||
        (v.kind !== "offer" && target.entityType !== type)
      )
        throw new Error("Exact knowledge revision mismatch");
    }
    const singles: Record<string, string> = {
      identityId: "interaction_identities",
      personId: "people",
      organisationId: "organisations",
      intendedPersonId: "people",
      intendedContactPointId: "contact_points",
      taskId: "crm_tasks",
      eventId: "events",
      resultId: "agent_results",
    };
    for (const [key, value] of Object.entries(v)) {
      if (singles[key] && typeof value === "string")
        await get(singles[key], value);
      if (key === "influencingPersonIds")
        for (const id of value as string[]) await get("people", id);
      if (key === "methodologies")
        for (const ref of value as Document[])
          if (!getOfferMethodology(ref.id, ref.version))
            throw new Error("Unknown methodology version");
      await walk(value);
    }
  }
  await walk(row);
  if ("supersedesId" in row && row.supersedesId) {
    const old = await get(collection, row.supersedesId);
    if (old.createdAt >= row.createdAt)
      throw new Error("Supersession must advance recorded history");
    if (
      "identityId" in row &&
      (old.identityId !== row.identityId ||
        old.relationship !== row.relationship)
    )
      throw new Error(
        "Resolution supersession must retain identity/relationship",
      );
    if (
      "identityId" in row &&
      row.status === "revoked" &&
      old.personId !== row.personId
    )
      throw new Error("Revocation must retain the asserted Person");
    if (
      "subject" in row &&
      (!isDeepStrictEqual(old.subject, row.subject) ||
        old.key !== row.key ||
        old.version >= row.version)
    )
      throw new Error(
        "Value supersession must retain subject/key and advance version",
      );
  }
  if (
    "communication" in row &&
    row.communication?.intendedContactPointId &&
    row.communication.intendedPersonId
  ) {
    const point = await get(
      "contact_points",
      row.communication.intendedContactPointId,
    );
    if (point.personId !== row.communication.intendedPersonId)
      throw new Error("Intended recipient/contact mismatch");
  }
  if ("inputs" in row && row.inputs) {
    for (const ref of row.inputs.resolutions) {
      const resolution = await get(ref.collection, ref.id);
      if (!row.inputs.identities.some((i) => i.id === resolution.identityId))
        throw new Error(
          "Context resolution requires corresponding identity reference",
        );
    }
    for (const ref of row.inputs.objectiveReferences) {
      const policy = await get("contact_strategy_policies", ref.policyId);
      const parsed = ContactStrategyPolicyV14Schema.parse(policy);
      if (
        parsed.version !== ref.version ||
        !parsed.strategy?.objectives.some((o) => o.key === ref.objectiveKey)
      )
        throw new Error("Exact objective/policy reference required");
      if (
        !row.policies.some(
          (p) => p.id === ref.policyId && p.version === ref.version,
        )
      )
        throw new Error("Objective must belong to context policy");
    }
  }
  return row;
}
/** No retroactive join or rewriting: verifies only the assertion known when this Event occurred. */
export async function checkIdentityEventV14(
  input: unknown,
  workspaceId: string,
  resolve: FoundationReferenceResolver,
) {
  const row = parseIdentityEventV14(input);
  if (row.workspaceId !== workspaceId) throw new Error("Workspace mismatch");
  const identity = await resolve(
    "interaction_identities",
    row.identityObservation.identityId,
    workspaceId,
  );
  if (
    !identity ||
    identity.id !== row.identityObservation.identityId ||
    identity.workspaceId !== workspaceId ||
    !(identity.createdAt instanceof Date) ||
    identity.createdAt > row.occurredAt
  )
    throw new Error("Identity unavailable at event time");
  parseV14("interaction_identities", withoutMongoId(identity));
  if (row.identityObservation.resolutionId) {
    const r = await resolve(
      "identity_resolutions",
      row.identityObservation.resolutionId,
      workspaceId,
    );
    if (
      !r ||
      r.id !== row.identityObservation.resolutionId ||
      r.workspaceId !== workspaceId ||
      r.identityId !== identity.id ||
      r.status !== "resolved" ||
      !(r.createdAt instanceof Date) ||
      r.createdAt > row.occurredAt ||
      r.validFrom > row.occurredAt ||
      (r.validUntil && r.validUntil <= row.occurredAt)
    )
      throw new Error("Resolution unavailable at event time");
    parseV14("identity_resolutions", withoutMongoId(r));
    if (
      (row.personId || row.personIds?.length) &&
      (r.relationship !== "observed_person" ||
        (row.personId && row.personId !== r.personId) ||
        row.personIds?.some((id) => id !== r.personId))
    )
      throw new Error("Intended recipient does not prove observed Person");
  }
  return row;
}
