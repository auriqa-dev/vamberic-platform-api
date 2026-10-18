import type { CollectionDefinition } from "./collections";
import type { Document } from "mongodb";
import old from "./frozen-v15-validators.json";
import { offerMongoStructure } from "./offer-validators";
import { protocolMongoStructure } from "./agent-protocol-validators";
import WorkV2 from "@workspace/agent-runtime-protocol/json-schema/ClaimedWorkV2" with { type: "json" };
import OutcomeV2 from "@workspace/agent-runtime-protocol/json-schema/OutcomeV2" with { type: "json" };
import ManifestV2 from "@workspace/agent-runtime-protocol/json-schema/ImplementationManifestV2" with { type: "json" };
import { WorkspaceAgentTarget } from "../domain/agent-operator";
import {
  ExecutionBudgetPolicySchema,
  ExecutionBudgetWindowSchema,
  ExecutionBudgetReservationSchema,
} from "../domain/execution-budgets";
export const V16_MIGRATION_ID = "016-agent-availability-channel-budgets";
export const V16_BUDGET_SCHEMAS = {
  execution_budget_policies: ExecutionBudgetPolicySchema,
  execution_budget_windows: ExecutionBudgetWindowSchema,
  execution_budget_reservations: ExecutionBudgetReservationSchema,
};
export const V16_BUDGET_COLLECTIONS = (
  Object.keys(V16_BUDGET_SCHEMAS) as (keyof typeof V16_BUDGET_SCHEMAS)[]
).map((name): CollectionDefinition => ({
  name,
  reason:
    "Non-authorizing execution budget foundation; no human administration",
  indexes: [
    name === "execution_budget_policies"
      ? { key: { id: 1, version: 1 }, name: "id_version_unique", unique: true }
      : { key: { id: 1 }, name: "id_unique", unique: true },
    { key: { workspaceId: 1 }, name: "workspace" },
    ...(name === "execution_budget_policies"
      ? [
          {
            key: { workspaceId: 1, id: 1, version: 1 },
            name: "workspace_policy_version_unique",
            unique: true,
          },
        ]
      : name === "execution_budget_windows"
        ? [
            {
              key: { workspaceId: 1, policyId: 1, start: 1, end: 1 },
              name: "workspace_policy_window_unique",
              unique: true,
            },
          ]
        : [
            {
              key: { workspaceId: 1, "logicalOperation.id": 1 },
              name: "workspace_operation_unique",
              unique: true,
            },
          ]),
  ],
}));
function rewrite(value: unknown): unknown {
  if (typeof value === "string")
    return value.replace(".clientAgent.configuration", ".configuration");
  if (Array.isArray(value)) return value.map(rewrite);
  if (value && typeof value === "object") {
    const v = value as Document;
    if (JSON.stringify(v) === '{"$eq":["$target.kind","client_agent"]}')
      return { $eq: ["$target.kind", "workspace_agent"] };
    if (JSON.stringify(v) === '{"$eq":["$frozen.clientAgent.id","$target.id"]}')
      return {
        $eq: ["$frozen.executionTarget.definition", "$target.definition"],
      };
    if (
      JSON.stringify(v) ===
      '{"$eq":["$frozen.clientAgent.revision","$target.revision"]}'
    )
      return {
        $eq: [
          "$frozen.executionTarget.implementation",
          "$target.implementation",
        ],
      };
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => [k, rewrite(x)]),
    );
  }
  return value;
}
/** Exact old branch retained. New protocol/target branch retains the old predicates,
 * replacing only the identity/configuration fields changed by Protocol 2. */
export function v16IdentityValidators(): Record<string, Document> {
  const run = rewrite(old.agent_runs) as Document;
  const work = protocolMongoStructure(WorkV2);
  for (const name of ["attemptId", "generation", "fence", "lease", "resume"]) {
    delete work.properties[name];
    work.required = work.required.filter((n: string) => n !== name);
  }
  run.$and[0].$jsonSchema.properties.frozen = work;
  run.$and[0].$jsonSchema.properties.manifest =
    protocolMongoStructure(ManifestV2);
  run.$and[0].$jsonSchema.properties.target =
    offerMongoStructure(WorkspaceAgentTarget);
  run.$and.push({
    $expr: {
      $and: [
        { $eq: ["$target.workspaceId", "$workspaceId"] },
        { $eq: ["$target.revision", "$frozen.definition.version"] },
      ],
    },
  });
  const result = structuredClone(old.agent_results) as Document;
  result.$and[0].$jsonSchema.properties.envelope =
    protocolMongoStructure(OutcomeV2);
  const effectiveness = rewrite(old.agent_effectiveness_cases) as Document;
  effectiveness.$and[0].$jsonSchema.properties.target =
    offerMongoStructure(WorkspaceAgentTarget);
  effectiveness.$and.push({
    $expr: { $eq: ["$target.workspaceId", "$workspaceId"] },
  });
  return {
    agent_runs: {
      $or: [
        old.agent_runs,
        { $and: [{ "frozen.protocolVersion": "2.0" }, run] },
      ],
    },
    agent_results: {
      $or: [
        old.agent_results,
        { $and: [{ "envelope.protocolVersion": "2.0" }, result] },
      ],
    },
    agent_effectiveness_cases: {
      $or: [
        old.agent_effectiveness_cases,
        { $and: [{ "target.kind": "workspace_agent" }, effectiveness] },
      ],
    },
  };
}
export const V16_BUDGET_VALIDATORS: Record<string, Document> =
  Object.fromEntries(
    Object.entries(V16_BUDGET_SCHEMAS).map(([name, schema]) => {
      const structure = offerMongoStructure(schema);
      structure.properties._id = {};
      return [name, { $jsonSchema: structure }];
    }),
  );
