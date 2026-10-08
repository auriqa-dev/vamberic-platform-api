import type { Db, Document, ClientSession } from "mongodb";

/** Read-only preview. The mutation repeats these checks under the definition's
 * write lock in the same transaction as removal and its audit event. */
export async function agentDefinitionRemovalReview(
  db: Db,
  row: Document,
  operation: "delete" | "retire",
  session?: ClientSession,
) {
  const blockers: string[] = [];
  const id = row.id;
  if (row.archived) blockers.push("This definition is already archived.");
  if (operation === "delete" && row.status !== "draft")
    blockers.push(
      "Published definitions must be archived to preserve their history.",
    );
  const checks: [string, Document, string][] = [
    [
      "workspace_memberships",
      { "agentOperationGrants.target.definition.id": id },
      "Workspace execution permissions reference this definition.",
    ],
    [
      "action_definitions",
      { "definition.executor.agentDefinition.id": id },
      "Action definitions reference this definition.",
    ],
    [
      "action_definition_revisions",
      { "snapshot.definition.executor.agentDefinition.id": id },
      "Action history references this definition.",
    ],
    [
      "reasoning_decisions",
      { "candidates.agentDefinitionId": id },
      "Decision history references this definition.",
    ],
    [
      "crm_tasks",
      { "reasoning.agentDefinitionId": id },
      "Tasks reference this definition.",
    ],
    [
      "client_agents",
      { "data.definition.id": id },
      "Client configurations still reference this definition.",
    ],
    [
      "agent_definitions",
      {
        $or: [
          { "data.requiredAgents.id": id },
          { "data.recommendedAgents.id": id },
        ],
      },
      "Other Agent definitions reference this definition.",
    ],
    [
      "swarm_templates",
      {
        $or: ["requiredAgents", "recommendedAgents", "optionalAgents"].map(
          (k) => ({ [`data.${k}.id`]: id }),
        ),
      },
      "Workflow templates reference this definition.",
    ],
    [
      "methodology_availability",
      { "data.compatibleAgents.id": id },
      "Methodology configuration references this definition.",
    ],
    [
      "pricing_recommendations",
      { "data.configurationSnapshot.agents.configuration.definition.id": id },
      "Pricing history references this definition.",
    ],
    [
      "swarm_agreements",
      { "data.configurationSnapshot.agents.configuration.definition.id": id },
      "Agreement history references this definition.",
    ],
  ];
  for (const [collection, filter, message] of checks) {
    // Historical configuration may remain after archive, but never after delete.
    if (
      await db
        .collection(collection)
        .findOne(
          {
            ...filter,
            ...(operation === "retire" ? { archived: { $ne: true } } : {}),
          },
          { session, projection: { _id: 1 } },
        )
    )
      blockers.push(message);
  }
  // Completed runs can still have reviewable results or quarantine obligations.
  // Do not infer completion of review from a terminal execution status.
  if (
    await db
      .collection("agent_runs")
      .findOne(
        {
          $or: [{ "frozen.definition.id": id }, { "target.definition.id": id }],
        },
        { session, projection: { _id: 1 } },
      )
  )
    blockers.push(
      "Execution history exists. Review its results and recovery obligations before archiving; this screen cannot remove it safely.",
    );
  if (
    operation === "delete" &&
    (await db.collection("events").findOne(
      {
        "payload.resource": "agent_definitions",
        "payload.resourceId": id,
        "payload.operation": { $in: ["publish", "retire"] },
      },
      { session, projection: { _id: 1 } },
    ))
  )
    blockers.push(
      "Publication history exists. Archive this definition instead.",
    );
  return { id, operation, allowed: blockers.length === 0, blockers };
}
