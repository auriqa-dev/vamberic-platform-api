import {
  InvocationJournalSchema,
  ExecutionControlSchema,
} from "../domain/agent-execution-evidence";
import { offerMongoStructure } from "./offer-validators";
import type { CollectionDefinition } from "./collections";
export const EXECUTION_EVIDENCE_MIGRATION_ID = "023-agent-execution-evidence";
export const EXECUTION_EVIDENCE_VALIDATORS = Object.fromEntries(
  [
    ["agent_execution_invocations", InvocationJournalSchema],
    ["agent_execution_controls", ExecutionControlSchema],
  ].map(([name, schema]) => {
    const structure = offerMongoStructure(
      schema as typeof InvocationJournalSchema,
    );
    structure.properties._id = {};
    return [name, { $jsonSchema: structure }];
  }),
);
export const EXECUTION_EVIDENCE_COLLECTIONS: readonly CollectionDefinition[] = [
  {
    name: "agent_execution_invocations",
    reason: "Bounded exact operational evidence, no execution authority",
    indexes: [
      { key: { id: 1 }, name: "id_unique", unique: true },
      {
        key: {
          "binding.release.environment": 1,
          "binding.release.workloadClass": 1,
          "binding.runId": 1,
          "binding.attemptId": 1,
          "binding.invocationId": 1,
        },
        name: "binding_invocation_unique",
        unique: true,
      },
      { key: { correlationId: 1 }, name: "correlation_unique", unique: true },
    ],
  },
  {
    name: "agent_execution_controls",
    reason: "Serialize admission and reconciliation; no resource authority",
    indexes: [{ key: { id: 1 }, name: "id_unique", unique: true }],
  },
];
