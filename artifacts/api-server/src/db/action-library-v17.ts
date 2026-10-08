import type { Document } from "mongodb";
import type { CollectionDefinition } from "./collections";
import frozen from "./frozen-v16-target.json";
import {
  ACTION_LIBRARY_SCHEMAS,
  ReasoningDecisionV17Schema,
  ReasoningActionLinkV17Schema,
} from "../domain/action-library";
import { offerMongoStructure } from "./offer-validators";
export const ACTION_LIBRARY_V17_MIGRATION_ID = "017-action-library-foundation";
export const ACTION_LIBRARY_COLLECTIONS: CollectionDefinition[] = Object.keys(
  ACTION_LIBRARY_SCHEMAS,
).map((name): CollectionDefinition => ({
  name: name as keyof typeof ACTION_LIBRARY_SCHEMAS,
  reason:
    "Independent non-authorizing Action Library definitions and immutable approved revisions.",
  indexes: [
    { key: { id: 1 }, name: "id_unique", unique: true },
    ...(name === "action_types"
      ? [
          {
            key: { key: 1, version: 1 },
            name: "key_version_unique",
            unique: true,
          },
          {
            key: { status: 1, availability: 1, key: 1 },
            name: "status_availability",
          },
        ]
      : name === "action_definitions"
        ? [
            {
              key: { workspaceId: 1, status: 1, id: 1 },
              name: "workspace_status",
            },
          ]
        : [
            {
              key: { workspaceId: 1, definitionId: 1, revision: 1 },
              name: "workspace_definition_revision_unique",
              unique: true,
            },
          ]),
  ],
}));
const structure = (schema: Parameters<typeof offerMongoStructure>[0]) => {
  const s = offerMongoStructure(schema);
  s.properties._id = {};
  return { $jsonSchema: s };
};
const decision = structuredClone(
  frozen.validators.reasoning_decisions,
) as Document;
decision.$and[0] = structure(ReasoningDecisionV17Schema);
const task = structuredClone(frozen.validators.crm_tasks) as Document;
// Keep all legacy task predicates and replace only the closed reasoning-link shape.
function extendLinks(v: Document) {
  if (v?.properties?.reasoning)
    v.properties.reasoning = offerMongoStructure(ReasoningActionLinkV17Schema);
  for (const child of Object.values(v))
    if (child && typeof child === "object") extendLinks(child as Document);
}
extendLinks(task);
export const ACTION_LIBRARY_V17_VALIDATORS: Record<string, Document> = {
  ...Object.fromEntries(
    Object.entries(ACTION_LIBRARY_SCHEMAS).map(([name, schema]) => [
      name,
      structure(schema),
    ]),
  ),
  reasoning_decisions: decision,
  crm_tasks: task,
};
