import type { Document } from "mongodb";
import frozen from "./frozen-v19-target.json";
export const ACTION_NUMERIC_V20_MIGRATION_ID =
  "020-action-library-numeric-bounds";
/** Exact forward patch; never regenerate historical predicates. */
export const ACTION_NUMERIC_V20_PATHS = [
  ["action_types", "$jsonSchema", "properties", "version", "minimum"],
  [
    "action_definitions",
    "$jsonSchema",
    "properties",
    "definition",
    "properties",
    "actionType",
    "properties",
    "version",
    "minimum",
  ],
  [
    "action_definitions",
    "$jsonSchema",
    "properties",
    "definition",
    "properties",
    "executor",
    "properties",
    "agentDefinition",
    "properties",
    "version",
    "minimum",
  ],
  ["action_definitions", "$jsonSchema", "properties", "revision", "minimum"],
  [
    "action_definitions",
    "$jsonSchema",
    "properties",
    "approvedRevision",
    "minimum",
  ],
  [
    "action_definition_revisions",
    "$jsonSchema",
    "properties",
    "revision",
    "minimum",
  ],
  [
    "action_definition_revisions",
    "$jsonSchema",
    "properties",
    "snapshot",
    "properties",
    "definition",
    "properties",
    "actionType",
    "properties",
    "version",
    "minimum",
  ],
  [
    "action_definition_revisions",
    "$jsonSchema",
    "properties",
    "snapshot",
    "properties",
    "definition",
    "properties",
    "executor",
    "properties",
    "agentDefinition",
    "properties",
    "version",
    "minimum",
  ],
  [
    "action_definition_revisions",
    "$jsonSchema",
    "properties",
    "snapshot",
    "properties",
    "revision",
    "minimum",
  ],
  [
    "action_definition_revisions",
    "$jsonSchema",
    "properties",
    "snapshot",
    "properties",
    "approvedRevision",
    "minimum",
  ],
  [
    "reasoning_decisions",
    "$and",
    "0",
    "$jsonSchema",
    "properties",
    "candidates",
    "items",
    "properties",
    "action",
    "properties",
    "revision",
    "minimum",
  ],
  [
    "crm_tasks",
    "$and",
    "1",
    "$jsonSchema",
    "properties",
    "reasoning",
    "properties",
    "action",
    "properties",
    "revision",
    "minimum",
  ],
] as const;
export const ACTION_NUMERIC_V20_VALIDATORS: Record<string, Document> =
  structuredClone(frozen.validators);
for (const [collection, ...path] of ACTION_NUMERIC_V20_PATHS) {
  let parent: Document = ACTION_NUMERIC_V20_VALIDATORS[collection];
  for (const key of path.slice(0, -1)) parent = parent[key];
  if (
    parent.minimum !== -Number.MAX_SAFE_INTEGER ||
    parent.exclusiveMinimum !== true ||
    parent.multipleOf !== 1 ||
    parent.maximum !== Number.MAX_SAFE_INTEGER
  )
    throw new Error("Unexpected frozen Action numeric boundary");
  parent.minimum = 0;
}
