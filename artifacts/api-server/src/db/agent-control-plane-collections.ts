import type { IndexDescription } from "mongodb";
/** No TTLs: Attempts, Results, usage and their audit lineage are retained. */
export const AGENT_COLLECTION_DEFINITIONS: readonly {
  name:
    | "agent_runs"
    | "agent_attempts"
    | "agent_results"
    | "agent_usage_observations";
  indexes: IndexDescription[];
  reason: string;
}[] = [
  {
    name: "agent_runs",
    indexes: [
      { key: { id: 1 }, name: "id_unique", unique: true },
      {
        key: {
          workspaceId: 1,
          "requester.issuer": 1,
          "requester.id": 1,
          requestKey: 1,
        },
        name: "workspace_requester_request_unique",
        unique: true,
      },
      {
        key: { workspaceId: 1, createdAt: -1, id: 1 },
        name: "workspace_created",
      },
      {
        key: {
          workspaceId: 1,
          "requester.issuer": 1,
          "requester.id": 1,
          createdAt: -1,
          id: 1,
        },
        name: "workspace_requester_created",
      },
    ],
    reason:
      "Run identity, human request idempotency, Queen workspace and Client own-Run lists.",
  },
  {
    name: "agent_attempts",
    indexes: [
      { key: { id: 1 }, name: "id_unique", unique: true },
      {
        key: { runId: 1, ordinal: 1 },
        name: "run_ordinal_unique",
        unique: true,
      },
      {
        key: { runId: 1, generation: 1 },
        name: "run_generation_unique",
        unique: true,
      },
    ],
    reason:
      "Attempt identity, bounded Run history and at most one Attempt per dispatch generation.",
  },
  {
    name: "agent_results",
    indexes: [
      { key: { id: 1 }, name: "id_unique", unique: true },
      {
        key: { runId: 1, attemptId: 1 },
        name: "run_attempt_unique",
        unique: true,
      },
      {
        key: { workspaceId: 1, runId: 1, createdAt: -1 },
        name: "workspace_run_created",
      },
      {
        key: {
          workspaceId: 1,
          "dispositions.target.resource": 1,
          "dispositions.target.id": 1,
        },
        name: "workspace_applied_target",
      },
    ],
    reason:
      "One accepted immutable envelope per Attempt, Result list and approval-time target provenance lookup.",
  },
  {
    name: "agent_usage_observations",
    indexes: [
      { key: { id: 1 }, name: "id_unique", unique: true },
      {
        key: { runId: 1, "observation.id": 1 },
        name: "run_observation_unique",
        unique: true,
      },
      { key: { attemptId: 1, runId: 1 }, name: "attempt_run" },
    ],
    reason:
      "Run-scoped observation dedupe/correction lookup, Run budget accounting and per-Attempt bound checks.",
  },
];
