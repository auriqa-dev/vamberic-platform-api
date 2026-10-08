import type { Document, IndexDescription } from "mongodb";
import type { CollectionDefinition } from "./collections";
import { REASONING_SCHEMAS } from "../domain/reasoning-foundation";
import {
  ReasoningActionLinkSchema,
  ReasoningEventLinkSchema,
} from "../domain/reasoning-crm-links";
import { offerMongoStructure } from "./offer-validators";
import { CRM_MONGO_VALIDATORS } from "./crm-validators";
export const REASONING_MIGRATION_ID =
  "013-reasoning-contact-strategy-foundation";
export const REASONING_COLLECTION_DEFINITIONS: CollectionDefinition[] =
  Object.keys(REASONING_SCHEMAS).map((name) => ({
    name: name as keyof typeof REASONING_SCHEMAS,
    indexes: [
      { key: { id: 1 }, name: "id_unique", unique: true },
      {
        key: { workspaceId: 1, createdAt: -1, id: 1 },
        name: "workspace_created",
      },
      ...(name === "contact_strategy_policies"
        ? [
            {
              key: { workspaceId: 1, key: 1, version: 1 },
              name: "workspace_key_version_unique",
              unique: true,
            },
          ]
        : []),
    ] as IndexDescription[],
    reason:
      "Workspace-owned immutable reasoning foundation; no execution authority.",
  }));
export const REASONING_V12_PREDECESSORS: Record<string, Document> = {
  crm_tasks: CRM_MONGO_VALIDATORS.crm_tasks,
};
function extend(name: string, link: Document): Document {
  const previous = REASONING_V12_PREDECESSORS[name];
  return {
    $and: [
      ...(previous ? [previous] : []),
      {
        $jsonSchema: {
          bsonType: "object",
          properties: { reasoning: link },
        },
      },
      {
        $expr: {
          $or: [
            { $eq: [{ $type: "$reasoning" }, "missing"] },
            { $eq: [{ $type: "$workspaceId" }, "string"] },
          ],
        },
      },
    ],
  };
}
export const REASONING_VALIDATORS: Record<string, Document> = {
  ...Object.fromEntries(
    Object.entries(REASONING_SCHEMAS).map(([name, schema]) => {
      const structure = offerMongoStructure(schema);
      structure.properties._id = {};
      return [
        name,
        {
          $and: [
            { $jsonSchema: structure },
            {
              $expr: {
                $and: [
                  { $eq: ["$createdAt", "$updatedAt"] },
                  { $ne: ["$id", { $ifNull: ["$supersedesId", ""] }] },
                ],
              },
            },
          ],
        },
      ];
    }),
  ),
  crm_tasks: extend(
    "crm_tasks",
    offerMongoStructure(ReasoningActionLinkSchema),
  ),
  events: extend("events", offerMongoStructure(ReasoningEventLinkSchema)),
};
