import { digest } from "@workspace/agent-runtime-protocol";
import type { Document } from "mongodb";
import {
  ActionDefinitionSchema,
  ActionDefinitionRevisionSchema,
  ActionTypeSchema,
  ActionRevisionReferenceSchema,
  ReasoningDecisionV17Schema,
  parseActionTask,
} from "./action-library";
import {
  checkReasoningReferences,
  reasoningEvidenceDigest,
  type FoundationReferenceResolver,
} from "./reasoning-reference-check";
/** Pure reference admission, not authorization, availability selection, fetching or execution. */
export function actionReferenceChecks(
  workspaceId: string,
  resolve: FoundationReferenceResolver,
) {
  const scoped = async (collection: string, id: string) => {
    const row = await resolve(collection, id, workspaceId);
    if (!row || row.id !== id || row.workspaceId !== workspaceId)
      throw new Error("Unavailable workspace reference");
    return row;
  };
  const global = async (collection: string, id: string) => {
    const row = await resolve(collection, id, workspaceId);
    if (!row || row.id !== id || row.workspaceId !== undefined)
      throw new Error("Invalid global reference");
    return row;
  };
  const evidence = async (ref: Document) => {
    const row = await scoped(ref.collection, ref.id);
    if (
      reasoningEvidenceDigest(row) !== ref.contentHash ||
      (ref.evidenceId &&
        !(row.snapshot?.evidence ?? row.evidence)?.some(
          (e: Document) => e.id === ref.evidenceId,
        ))
    )
      throw new Error("Evidence mismatch");
  };
  async function definition(input: unknown) {
    const row = ActionDefinitionSchema.parse(input);
    if (row.workspaceId !== workspaceId) throw new Error("Workspace mismatch");
    const ref = row.definition.actionType,
      type = ActionTypeSchema.parse(await global("action_types", ref.id));
    if (
      type.key !== ref.key ||
      type.version !== ref.version ||
      type.contentHash !== ref.contentHash ||
      type.status === "draft"
    )
      throw new Error("Exact published Action type required");
    for (const id of type.data.capabilityIds) await global("capabilities", id);
    const executor = row.definition.executor;
    if (executor?.capabilityId)
      await global("capabilities", executor.capabilityId);
    if (executor?.agentDefinition) {
      const d = await global("agent_definitions", executor.agentDefinition.id);
      if (d.version !== executor.agentDefinition.version)
        throw new Error("Exact Agent version required");
    }
    for (const r of row.definition.resources) {
      if (r.kind === "evidence") await evidence(r.reference);
      if (r.kind === "knowledge") {
        const k = r.reference,
          snapshot = await scoped(
            k.kind === "offer"
              ? "offer_revisions"
              : "hive_definition_revisions",
            k.snapshotId,
          );
        const entityType = {
          offering: "offerings",
          icp: "ideal_customer_profiles",
          buyer_profile: "buyer_profiles",
          offer: "offers",
        }[k.kind];
        if (
          (snapshot.entityId ?? snapshot.offerId) !== k.entityId ||
          snapshot.revision !== k.revision ||
          snapshot.snapshot?.contentHash !== k.contentHash ||
          snapshot.snapshot?.workspaceId !== workspaceId ||
          snapshot.snapshot?.status !== "approved" ||
          (k.kind !== "offer" && snapshot.entityType !== entityType)
        )
          throw new Error("Exact approved knowledge revision required");
      }
    }
    for (const ref of row.definition.evidence) await evidence(ref);
    return row;
  }
  async function revision(value: unknown) {
    const ref = ActionRevisionReferenceSchema.parse(value),
      snapshot = ActionDefinitionRevisionSchema.parse(
        await scoped("action_definition_revisions", ref.snapshotId),
      );
    if (
      snapshot.definitionId !== ref.definitionId ||
      snapshot.revision !== ref.revision ||
      snapshot.snapshot.contentHash !== ref.contentHash
    )
      throw new Error("Action revision mismatch");
    const parent = ActionDefinitionSchema.parse(
      await scoped("action_definitions", ref.definitionId),
    );
    if (parent.revision < snapshot.revision)
      throw new Error("Snapshot exceeds current revision");
    await definition(snapshot.snapshot);
    return snapshot;
  }
  return {
    definition,
    revision,
    async decision(input: unknown) {
      const row = ReasoningDecisionV17Schema.parse(input);
      const legacy = {
        ...row,
        candidates: row.candidates.map(({ action, ...c }) => {
          void action;
          return c;
        }),
      };
      await checkReasoningReferences(
        "reasoning_decisions",
        legacy,
        workspaceId,
        resolve,
      );
      for (const c of row.candidates) if (c.action) await revision(c.action);
      return row;
    },
    async task(input: unknown) {
      const row = parseActionTask(input);
      if (row.workspaceId !== workspaceId)
        throw new Error("Workspace mismatch");
      const context = await scoped(
        "reasoning_contexts",
        row.reasoning.contextId,
      );
      const decision = await scoped(
        "reasoning_decisions",
        row.reasoning.decisionId,
      );
      if (decision.contextId !== context.id)
        throw new Error("Decision context mismatch");
      if (row.reasoning.action) {
        await revision(row.reasoning.action);
        const d = ReasoningDecisionV17Schema.parse(decision);
        const selected = d.candidates.find(
          (c) => c.key === d.selectedCandidateKey,
        );
        if (
          !selected?.action ||
          digest(selected.action) !== digest(row.reasoning.action)
        )
          throw new Error("Task must reference exact selected Action");
      }
      return row;
    },
  };
}
