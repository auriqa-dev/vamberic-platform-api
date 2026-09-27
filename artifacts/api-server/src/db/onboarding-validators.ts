import type { Document } from "mongodb";
import {
  PARTNER_MEMBER_ROLES,
  PARTNER_MEMBER_STATUSES,
} from "../domain/partners";
import {
  INTEGRATION_PROVIDER_PATTERN,
  INTEGRATION_STATUSES,
  SECRET_REFERENCE_PATTERN,
} from "../domain/workspace-integrations";
const string = (maxLength: number) => ({
  bsonType: "string",
  minLength: 1,
  maxLength,
});
const id = (prefix: string) => ({
  bsonType: "string",
  pattern: `^${prefix}_[0-7][0-9abcdefghjkmnpqrstvwxyz]{25}$`,
});
const date = { bsonType: "date" };
const human = {
  bsonType: "object",
  required: ["type", "issuer", "id"],
  additionalProperties: false,
  properties: {
    type: { enum: ["human"] },
    issuer: { ...string(500), pattern: "^https?://[^\\s]+$" },
    id: { ...string(300), pattern: "^(?!partner_).+$" },
  },
};
const actor = {
  bsonType: "object",
  additionalProperties: false,
  required: ["type"],
  properties: {
    type: { enum: ["human", "agent", "system", "integration"] },
    id: string(300),
    reference: string(500),
  },
};
const base = {
  _id: {},
  createdAt: date,
  updatedAt: date,
  archivedAt: date,
  archived: { bsonType: "bool" },
  schemaVersion: { bsonType: ["int", "long", "double"], minimum: 1 },
  createdBy: actor,
  updatedBy: actor,
  source: {
    bsonType: "object",
    additionalProperties: false,
    required: ["system"],
    properties: {
      system: string(100),
      reference: { bsonType: "string", maxLength: 500 },
      importedAt: date,
    },
  },
};
const present = (field: string) => ({
  $ne: [{ $type: `$${field}` }, "missing"],
});
const ifPresent = (field: string, rule: Document) => ({
  $cond: [present(field), rule, true],
});
const beforeUpdate = (field: string) =>
  ifPresent(field, { $lte: [`$${field}`, "$updatedAt"] });
const ended = (status: string, field: string) => ({
  oneOf: [
    { properties: { status: { enum: [status] } }, required: [field] },
    {
      properties: { status: { not: { enum: [status] } } },
      not: { required: [field] },
    },
  ],
});
const archive = (status: string) => ({
  anyOf: [
    { properties: { archived: { enum: [false] } } },
    { properties: { status: { enum: [status] } } },
  ],
});
/** Strict new collections; existing validators are not replaced. No provider secrets or arbitrary metadata. */
export const ONBOARDING_MONGO_VALIDATORS: Record<string, Document> = {
  hvm_partner_memberships: {
    $and: [
      {
        $jsonSchema: {
          bsonType: "object",
          additionalProperties: false,
          required: [
            "id",
            "partnerId",
            "human",
            "role",
            "status",
            "joinedAt",
            "createdAt",
            "updatedAt",
          ],
          properties: {
            ...base,
            id: id("partnermembership"),
            partnerId: id("partner"),
            human,
            personId: id("person"),
            role: { enum: [...PARTNER_MEMBER_ROLES] },
            status: { enum: [...PARTNER_MEMBER_STATUSES] },
            joinedAt: date,
            endedAt: date,
            addedBy: human,
          },
          allOf: [ended("ended", "endedAt"), archive("ended")],
        },
      },
      {
        $expr: {
          $and: [
            { $gte: ["$updatedAt", "$createdAt"] },
            beforeUpdate("joinedAt"),
            beforeUpdate("endedAt"),
            ifPresent("endedAt", { $gte: ["$endedAt", "$joinedAt"] }),
          ],
        },
      },
    ],
  },
  workspace_integrations: {
    $and: [
      {
        $jsonSchema: {
          bsonType: "object",
          additionalProperties: false,
          required: [
            "id",
            "workspaceId",
            "provider",
            "displayName",
            "status",
            "createdAt",
            "updatedAt",
          ],
          properties: {
            ...base,
            id: id("integration"),
            workspaceId: id("workspace"),
            provider: {
              bsonType: "string",
              pattern: INTEGRATION_PROVIDER_PATTERN.source,
            },
            displayName: string(200),
            externalAccountId: string(200),
            externalTenantId: string(200),
            status: { enum: [...INTEGRATION_STATUSES] },
            scopes: {
              bsonType: "array",
              maxItems: 100,
              uniqueItems: true,
              items: string(200),
            },
            secretReference: {
              bsonType: "string",
              pattern: SECRET_REFERENCE_PATTERN.source,
            },
            connectedAt: date,
            connectedBy: human,
            disconnectedAt: date,
            lastSyncAt: date,
            lastSuccessfulSyncAt: date,
            errorCode: {
              bsonType: "string",
              pattern: "^[A-Za-z][A-Za-z0-9_]{0,63}$",
            },
          },
          allOf: [
            ended("disconnected", "disconnectedAt"),
            archive("disconnected"),
            {
              anyOf: [
                { properties: { status: { not: { enum: ["connected"] } } } },
                { required: ["connectedAt"] },
              ],
            },
            {
              anyOf: [
                { not: { required: ["connectedBy"] } },
                { required: ["connectedAt"] },
              ],
            },
            {
              anyOf: [
                { properties: { status: { not: { enum: ["pending"] } } } },
                { not: { required: ["connectedAt"] } },
              ],
            },
            {
              anyOf: [
                { not: { required: ["lastSyncAt"] } },
                { required: ["connectedAt"] },
              ],
            },
            {
              anyOf: [
                { not: { required: ["lastSuccessfulSyncAt"] } },
                { required: ["lastSyncAt"] },
              ],
            },
          ],
        },
      },
      {
        $expr: {
          $and: [
            { $gte: ["$updatedAt", "$createdAt"] },
            ...[
              "connectedAt",
              "disconnectedAt",
              "lastSyncAt",
              "lastSuccessfulSyncAt",
            ].map(beforeUpdate),
            ifPresent(
              "disconnectedAt",
              ifPresent("connectedAt", {
                $gte: ["$disconnectedAt", "$connectedAt"],
              }),
            ),
            ifPresent("lastSyncAt", { $gte: ["$lastSyncAt", "$connectedAt"] }),
            ifPresent("lastSuccessfulSyncAt", {
              $and: [
                { $lte: ["$lastSuccessfulSyncAt", "$lastSyncAt"] },
                { $gte: ["$lastSuccessfulSyncAt", "$connectedAt"] },
              ],
            }),
          ],
        },
      },
    ],
  },
};
