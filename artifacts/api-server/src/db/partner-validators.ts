import type { Document } from "mongodb";
import {
  PARTNER_STATUSES,
  PARTNER_ASSIGNMENT_ROLES,
  PARTNER_ASSIGNMENT_STATUSES,
} from "../domain/partners";
const id = (prefix: string) => ({
  bsonType: "string",
  pattern: `^${prefix}_[0-7][0-9abcdefghjkmnpqrstvwxyz]{25}$`,
});
const dates = {
  createdAt: { bsonType: "date" },
  updatedAt: { bsonType: "date" },
  archived: { bsonType: "bool" },
  endedAt: { bsonType: "date" },
};
const lifecycle = [
  {
    oneOf: [
      { properties: { status: { enum: ["ended"] } }, required: ["endedAt"] },
      {
        properties: { status: { not: { enum: ["ended"] } } },
        not: { required: ["endedAt"] },
      },
    ],
  },
  {
    anyOf: [
      { properties: { archived: { enum: [false] } } },
      { properties: { status: { enum: ["ended"] } } },
    ],
  },
];
const timestampRules = [
  { $gte: ["$updatedAt", "$createdAt"] },
  {
    $cond: [
      { $eq: ["$status", "ended"] },
      { $lte: ["$endedAt", "$updatedAt"] },
      true,
    ],
  },
];
/** New, empty collections only. References/authorization remain trusted service checks. */
export const PARTNER_MONGO_VALIDATORS: Record<string, Document> = {
  hvm_partners: {
    $and: [
      {
        $jsonSchema: {
          bsonType: "object",
          required: ["id", "displayName", "status", "createdAt", "updatedAt"],
          properties: {
            ...dates,
            id: id("partner"),
            displayName: { bsonType: "string", minLength: 1, maxLength: 200 },
            status: { enum: [...PARTNER_STATUSES] },
            primaryPersonId: id("person"),
            organisationId: id("org"),
          },
          allOf: [...lifecycle, { not: { required: ["workspaceId"] } }],
        },
      },
      { $expr: { $and: timestampRules } },
    ],
  },
  workspace_partner_assignments: {
    $and: [
      {
        $jsonSchema: {
          bsonType: "object",
          required: [
            "id",
            "workspaceId",
            "partnerId",
            "role",
            "status",
            "assignedAt",
            "createdAt",
            "updatedAt",
          ],
          properties: {
            ...dates,
            id: id("partnerassignment"),
            workspaceId: id("workspace"),
            partnerId: id("partner"),
            role: { enum: [...PARTNER_ASSIGNMENT_ROLES] },
            status: { enum: [...PARTNER_ASSIGNMENT_STATUSES] },
            assignedAt: { bsonType: "date" },
            assignedBy: {
              bsonType: "object",
              required: ["type", "id"],
              additionalProperties: false,
              properties: {
                type: { enum: ["human"] },
                id: { bsonType: "string", minLength: 1, maxLength: 300 },
              },
            },
          },
          allOf: lifecycle,
        },
      },
      {
        $expr: {
          $and: [
            ...timestampRules,
            { $lte: ["$assignedAt", "$updatedAt"] },
            {
              $cond: [
                { $eq: ["$status", "ended"] },
                { $gte: ["$endedAt", "$assignedAt"] },
                true,
              ],
            },
          ],
        },
      },
    ],
  },
};
