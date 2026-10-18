import type { CollectionDefinition } from "./collections";
export const LIBRARY_MIGRATION_ID = "028-library-discovery";
export const LIBRARY_COLLECTIONS: readonly CollectionDefinition[] = [
  {
    name: "library_discovery",
    reason:
      "Resumable workspace-scoped metadata discovery; assets retain existing Content Strategy revisions",
    indexes: [
      { key: { id: 1 }, name: "id_unique", unique: true },
      { key: { workspaceId: 1, createdAt: -1 }, name: "workspace_discovery" },
      {
        key: { workspaceId: 1, "payload.requestKey": 1 },
        name: "workspace_request_unique",
        unique: true,
      },
    ],
  },
  {
    name: "library_text",
    reason:
      "Immutable full extracted Library text, scoped by workspace and asset",
    indexes: [
      { key: { id: 1 }, name: "id_unique", unique: true },
      { key: { workspaceId: 1, assetId: 1 }, name: "workspace_asset" },
    ],
  },
];
export const LIBRARY_VALIDATORS = {
  library_text: {
    $jsonSchema: {
      bsonType: "object",
      required: ["id", "workspaceId", "assetId", "text", "createdAt"],
      properties: {
        id: { bsonType: "string" },
        workspaceId: { bsonType: "string" },
        assetId: { bsonType: "string" },
        text: { bsonType: "string", maxLength: 180000 },
        createdAt: { bsonType: "date" },
      },
    },
  },
  library_discovery: {
    $jsonSchema: {
      bsonType: "object",
      required: ["id", "workspaceId", "createdAt", "updatedAt", "payload"],
      properties: {
        id: { bsonType: "string" },
        workspaceId: { bsonType: "string" },
        createdAt: { bsonType: "date" },
        updatedAt: { bsonType: "date" },
        payload: {
          bsonType: "object",
          required: ["version", "requestKey", "state"],
          properties: {
            version: { bsonType: ["int", "long", "double"], minimum: 1 },
            requestKey: { bsonType: "string" },
            state: {
              bsonType: "object",
              required: ["origin", "root", "brandId", "pages", "status"],
              properties: {
                brandId: { bsonType: "string" },
                pages: { bsonType: "array", maxItems: 5000 },
                status: { enum: ["running", "complete", "paused"] },
              },
            },
          },
        },
      },
    },
  },
};
