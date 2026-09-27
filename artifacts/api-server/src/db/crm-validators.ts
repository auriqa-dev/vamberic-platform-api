import type { Document } from "mongodb";
const string = { bsonType: "string" };
const date = { bsonType: "date" };
const properties = {
  id: string,
  createdAt: date,
  updatedAt: date,
  archived: { bsonType: "bool" },
  workspaceId: {
    bsonType: "string",
    pattern: "^workspace_[0-7][0-9abcdefghjkmnpqrstvwxyz]{25}$",
  },
};
const record = (
  required: string[],
  fields: Document,
  extra: Document = {},
) => ({
  $jsonSchema: {
    bsonType: "object",
    required: ["id", "createdAt", "updatedAt", ...required],
    properties: { ...properties, ...fields },
    ...extra,
  },
});
const id = (prefix: string) => ({
  bsonType: "string",
  pattern: `^${prefix}_[0-7][0-9abcdefghjkmnpqrstvwxyz]{25}$`,
});
/** Deliberately additive: unknown legacy fields remain allowed; references are service checks. */
export const CRM_MONGO_VALIDATORS: Record<string, Document> = {
  people: {
    $jsonSchema: {
      bsonType: "object",
      properties: {
        preferredLanguage: string,
        timezone: string,
        socialProfiles: { bsonType: "array", maxItems: 10 },
        fieldEvidence: { bsonType: "array", maxItems: 200 },
      },
    },
  },
  organisations: {
    $jsonSchema: {
      bsonType: "object",
      properties: {
        normalizedDomain: string,
        website: string,
        foundedYear: {
          bsonType: ["int", "long", "double"],
          minimum: 1,
          maximum: 9999,
        },
        annualRevenue: {
          bsonType: "object",
          required: ["amountMinor", "currency", "observedAt"],
          properties: {
            amountMinor: { bsonType: ["int", "long", "double"], minimum: 0 },
            currency: { bsonType: "string", pattern: "^[A-Z]{3}$" },
            observedAt: date,
          },
        },
        fieldEvidence: { bsonType: "array", maxItems: 200 },
      },
    },
  },
  crm_pipelines: record(["name", "stages"], {
    id: id("pipeline"),
    productId: id("product"),
    name: string,
    stages: { bsonType: "array", minItems: 1, maxItems: 50 },
  }),
  crm_workspaces: record(["name", "kind"], {
    id: id("workspace"),
    name: string,
    kind: { enum: ["portfolio", "client"] },
    clientOrganisationId: id("org"),
  }),
  crm_leads: record(["workspaceId"], {
    id: id("lead"),
    workspaceId: id("workspace"),
    productId: id("product"),
    personId: id("person"),
    organisationId: id("org"),
  }),
  crm_tasks: record(["title", "type", "status"], {
    id: id("task"),
    title: string,
    type: string,
    status: { enum: ["pending", "in_progress", "completed", "cancelled"] },
    dueAt: date,
    completedAt: date,
  }),
  external_references: record(
    [
      "provider",
      "providerAccountId",
      "objectType",
      "externalId",
      "entityType",
      "entityId",
    ],
    {
      id: id("externalref"),
      ...Object.fromEntries(
        [
          "provider",
          "providerAccountId",
          "objectType",
          "externalId",
          "entityType",
          "entityId",
        ].map((key) => [key, { bsonType: "string", minLength: 1 }]),
      ),
      sourceCreatedAt: date,
      sourceUpdatedAt: date,
      lastSyncedAt: date,
    },
  ),
};
