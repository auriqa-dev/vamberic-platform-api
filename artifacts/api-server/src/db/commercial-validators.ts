import type { Document } from "mongodb";
import { BILLING_TREATMENTS } from "../domain/commercial-fields";
const id = (prefix: string) => ({
  bsonType: "string",
  pattern: `^${prefix}_[0-7][0-9abcdefghjkmnpqrstvwxyz]{25}$`,
});
const ids = (prefix: string) => ({
  bsonType: "array",
  maxItems: 100,
  uniqueItems: true,
  items: id(prefix),
});
const treatment = { enum: [...BILLING_TREATMENTS] };
const approval = {
  bsonType: "object",
  required: ["type", "id"],
  additionalProperties: false,
  properties: {
    type: { enum: ["human"] },
    id: { bsonType: "string", minLength: 1, maxLength: 300 },
  },
};
const scopeProperties = {
  workspaceId: id("workspace"),
  scopeType: { enum: ["workspace", "product"] },
  scopeProductId: id("product"),
};
const scopeRule = {
  oneOf: [
    {
      properties: { scopeType: { enum: ["workspace"] } },
      not: { required: ["scopeProductId"] },
    },
    {
      properties: { scopeType: { enum: ["product"] } },
      required: ["scopeProductId"],
    },
  ],
};
const record = (
  prefix: string,
  required: string[],
  properties: Document,
  extra: Document = {},
) => ({
  $jsonSchema: {
    bsonType: "object",
    required: ["id", "createdAt", "updatedAt", ...required],
    properties: {
      id: id(prefix),
      createdAt: { bsonType: "date" },
      updatedAt: { bsonType: "date" },
      archived: { bsonType: "bool" },
      ...properties,
    },
    ...extra,
  },
});
/** Refined, still-unapplied v3. Existing Products/subscriptions/transactions are unchanged. */
export const COMMERCIAL_MONGO_VALIDATORS: Record<string, Document> = {
  capabilities: record(
    "capability",
    ["name", "supportedScopeTypes"],
    {
      name: { bsonType: "string", minLength: 1, maxLength: 200 },
      supportedScopeTypes: {
        bsonType: "array",
        minItems: 1,
        maxItems: 2,
        uniqueItems: true,
        items: { enum: ["workspace", "product"] },
      },
      dependencies: {
        bsonType: "array",
        maxItems: 100,
        uniqueItems: true,
        items: {
          bsonType: "object",
          required: ["capabilityId", "scope"],
          additionalProperties: false,
          properties: {
            capabilityId: id("capability"),
            scope: { enum: ["same_scope", "workspace"] },
          },
        },
      },
    },
    { not: { required: ["workspaceId"] } },
  ),
  capability_instances: record(
    "capinstance",
    ["workspaceId", "scopeType", "capabilityId", "status"],
    {
      ...scopeProperties,
      capabilityId: id("capability"),
      status: { enum: ["draft", "enabled", "disabled"] },
      dependencyInstanceIds: ids("capinstance"),
      configuration: { bsonType: "object", maxProperties: 50 },
      output: { bsonType: "object", maxProperties: 50 },
    },
    scopeRule,
  ),
  commercial_packages: record(
    "package",
    ["workspaceId", "scopeType", "name", "capabilityIds", "status"],
    {
      ...scopeProperties,
      name: { bsonType: "string", minLength: 1, maxLength: 200 },
      capabilityIds: { ...ids("capability"), minItems: 1 },
      capabilityInstanceIds: ids("capinstance"),
      status: { enum: ["draft", "active", "retired"] },
      billingTreatment: treatment,
    },
    scopeRule,
  ),
  commercial_charges: record(
    "charge",
    ["workspaceId", "name", "chargeType", "billingTreatment", "status"],
    {
      workspaceId: id("workspace"),
      capabilityInstanceId: id("capinstance"),
      commercialPackageId: id("package"),
      name: { bsonType: "string", minLength: 1, maxLength: 200 },
      chargeType: { enum: ["one_off", "recurring", "usage"] },
      billingInterval: { enum: ["month", "year"] },
      usageUnit: { bsonType: "string", minLength: 1, maxLength: 100 },
      billingTreatment: treatment,
      billingReason: { bsonType: "string", minLength: 1, maxLength: 1000 },
      approvedBy: approval,
      amountMinor: {
        bsonType: ["int", "long", "double"],
        minimum: 0,
        maximum: Number.MAX_SAFE_INTEGER,
        multipleOf: 1,
      },
      currency: { bsonType: "string", pattern: "^[A-Z]{3}$" },
      status: { enum: ["draft", "active", "retired"] },
      sourceSubscriptionId: id("subscription"),
      sourceTransactionId: id("transaction"),
    },
    {
      allOf: [
        {
          anyOf: [
            { required: ["capabilityInstanceId"] },
            { required: ["commercialPackageId"] },
          ],
        },
        {
          oneOf: [
            {
              properties: { chargeType: { enum: ["recurring"] } },
              required: ["billingInterval"],
              not: { required: ["usageUnit"] },
            },
            {
              properties: { chargeType: { enum: ["usage"] } },
              required: ["usageUnit"],
              not: { required: ["billingInterval"] },
            },
            {
              properties: { chargeType: { enum: ["one_off"] } },
              not: {
                anyOf: [
                  { required: ["billingInterval"] },
                  { required: ["usageUnit"] },
                ],
              },
            },
          ],
        },
        {
          oneOf: [
            { required: ["amountMinor", "currency"] },
            {
              not: {
                anyOf: [
                  { required: ["amountMinor"] },
                  { required: ["currency"] },
                ],
              },
            },
          ],
        },
      ],
    },
  ),
  entitlements: {
    $jsonSchema: {
      bsonType: "object",
      properties: {
        capabilityId: id("capability"),
        capabilityInstanceId: id("capinstance"),
        commercialPackageId: id("package"),
        billingTreatment: treatment,
        billingReason: { bsonType: "string", minLength: 1, maxLength: 1000 },
        approvedBy: approval,
      },
      allOf: [
        // Legacy documents gain no required fields. New targets must be exclusive and workspace scoped.
        {
          anyOf: [
            {
              not: {
                anyOf: [
                  { required: ["capabilityId"] },
                  { required: ["capabilityInstanceId"] },
                ],
              },
            },
            {
              required: ["workspaceId"],
              properties: { workspaceId: id("workspace") },
              not: { required: ["productId"] },
              oneOf: [
                {
                  required: ["capabilityId"],
                  not: { required: ["capabilityInstanceId"] },
                },
                {
                  required: ["capabilityInstanceId"],
                  not: { required: ["capabilityId"] },
                },
              ],
            },
          ],
        },
      ],
    },
  },
};
