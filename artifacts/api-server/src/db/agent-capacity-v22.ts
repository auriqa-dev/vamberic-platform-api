import {
  CapacityObservationSchema,
  ExecutionSlotSchema,
} from "../domain/agent-capacity";
import { offerMongoStructure } from "./offer-validators";
import type { CollectionDefinition } from "./collections";
export const AGENT_CAPACITY_MIGRATION_ID = "022-agent-execution-capacity";
export const AGENT_CAPACITY_VALIDATORS = Object.fromEntries(
  [
    ["agent_capacity_observations", CapacityObservationSchema],
    ["agent_execution_slots", ExecutionSlotSchema],
  ].map(([name, schema]) => {
    const structure = offerMongoStructure(
      schema as typeof CapacityObservationSchema,
    );
    structure.properties._id = {};
    return [name, { $jsonSchema: structure }];
  }),
);
export const AGENT_CAPACITY_COLLECTIONS: readonly CollectionDefinition[] = [
  {
    name: "agent_capacity_observations",
    reason: "Operational readiness only; no resource authority",
    indexes: [
      { key: { id: 1 }, name: "id_unique", unique: true },
      {
        key: {
          "release.environment": 1,
          "release.workloadClass": 1,
          workerId: 1,
        },
        name: "process_unique",
        unique: true,
      },
      {
        key: { "release.environment": 1, reportedAt: 1 },
        name: "environment_freshness",
      },
    ],
  },
  {
    name: "agent_execution_slots",
    reason: "Durable single dev provider slot; ambiguity cannot expire",
    indexes: [{ key: { id: 1 }, name: "id_unique", unique: true }],
  },
];
