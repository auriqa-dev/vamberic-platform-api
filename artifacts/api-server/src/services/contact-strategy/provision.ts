import { withoutMongoId } from "../hvm-context";
import type { Db, ClientSession } from "mongodb";
import { generatePlatformId, platformIdSchema } from "../../domain";
import { ContactStrategyPolicyV14Schema } from "../../domain/identity-value-v14";
import { validateReasoningSemantics } from "../../domain/reasoning-foundation";
import { CONTACT_STRATEGY_TEMPLATES } from "./catalogue";

export const TEMPLATE_SOURCE = "hvm_contact_strategy_template";
export function templateSource(id: string, version: number) {
  return `${TEMPLATE_SOURCE}:${id}:v${version}`;
}
/** Existing versions, including withdrawn snapshots, are durable adoption receipts.
 * Never reconstruct a deleted/withdrawn strategy by running provisioning again.
 * Call within the workspace provisioning transaction; no HTTP/read side effects.
 */
export function planStrategyTemplates(
  workspaceId: string,
  existing: unknown[],
  now: Date,
) {
  platformIdSchema("workspace").parse(workspaceId);
  const policies = existing.map((row) => {
    const value = ContactStrategyPolicyV14Schema.parse(
      withoutMongoId(row as Record<string, unknown>),
    );
    if (value.workspaceId !== workspaceId)
      throw new Error("Workspace mismatch");
    return value;
  });
  const created = [],
    skipped = [],
    conflicts = [];
  for (const t of CONTACT_STRATEGY_TEMPLATES) {
    const adopted = policies.filter((p) =>
      p.source.reference.startsWith(`${TEMPLATE_SOURCE}:${t.id}:v`),
    );
    const keyed = policies.filter((p) => p.key === t.key);
    if (
      adopted.some((p) => p.key !== t.key) ||
      (adopted.length && keyed.some((p) => !adopted.includes(p)))
    ) {
      conflicts.push({
        templateId: t.id,
        reason: "Template lineage and policy key disagree; review mapping",
      });
      continue;
    }
    if (adopted.length) {
      skipped.push({
        templateId: t.id,
        reason: "Already adopted; preserve all versions and customisations",
      });
      continue;
    }
    if (keyed.length) {
      conflicts.push({
        templateId: t.id,
        reason:
          "Existing policy uses this key without template provenance; review mapping",
      });
      continue;
    }
    const record = ContactStrategyPolicyV14Schema.parse({
      id: generatePlatformId("contactstrategy"),
      workspaceId,
      key: t.key,
      version: 1,
      createdAt: now,
      updatedAt: now,
      source: { kind: "platform", reference: templateSource(t.id, t.version) },
      status: "draft",
      organisationIds: [],
      personIds: [],
      contactPointIds: [],
      campaignIds: [],
      knowledge: [],
      clauses: [
        {
          key: "policy",
          category: t.type === "prioritisation" ? "priority" : "contact",
          statement: t.description,
          evidence: [],
        },
      ],
    });
    validateReasoningSemantics("contact_strategy_policies", record);
    created.push(record);
  }
  const reviewRequired = policies
    .filter(
      (p) =>
        p.status === "recorded" &&
        !p.source.reference.startsWith(`${TEMPLATE_SOURCE}:`),
    )
    .map((p) => ({
      policyId: p.id,
      key: p.key,
      version: p.version,
      reason:
        "Existing client policy retained; compare its meaning with the new drafts before approval",
    }));
  return { created, skipped, conflicts, reviewRequired };
}
export async function initialiseStrategyTemplates(
  db: Db,
  session: ClientSession,
  workspaceId: string,
  now: Date,
) {
  const rows = await db
    .collection("contact_strategy_policies")
    .find({ workspaceId }, { session })
    .toArray();
  const plan = planStrategyTemplates(workspaceId, rows, now);
  if (plan.conflicts.length)
    throw new Error(
      "Contact Strategy template identity conflict; review before provisioning",
    );
  for (const record of plan.created)
    await db
      .collection("contact_strategy_policies")
      .insertOne(record, { session });
  return plan;
}
