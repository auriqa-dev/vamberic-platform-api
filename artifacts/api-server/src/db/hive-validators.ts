import type { Document } from "mongodb";
import {
  OFFERING_TYPES,
  DELIVERY_MODES,
  IMPLEMENTATION_MODELS,
  OFFERING_LIST_FIELDS,
  ICP_LIST_FIELDS,
  ACCOUNT_LIST_FIELDS,
  CONSUMER_LIST_FIELDS,
  BUYER_LIST_FIELDS,
} from "../domain/hive-definitions";
import { BUYING_ROLES } from "../domain/buying-roles";
const text = (maxLength = 2000) => ({
  bsonType: "string",
  minLength: 1,
  maxLength,
});
const id = (prefix: string) => ({
  bsonType: "string",
  pattern: `^${prefix}_[0-7][0-9abcdefghjkmnpqrstvwxyz]{25}$`,
});
const object = (properties: Document, required: string[] = []) => ({
  bsonType: "object",
  additionalProperties: false,
  properties,
  ...(required.length ? { required } : {}),
});
const array = (items: Document, maxItems = 40) => ({
  bsonType: "array",
  items,
  maxItems,
});
const list = () => ({ ...array(text()), uniqueItems: true });
const lists = (keys: readonly string[]) =>
  Object.fromEntries(keys.map((k) => [k, list()]));
const date = { bsonType: "date" };
const integer = {
  bsonType: ["int", "long", "double"],
  minimum: 1,
  multipleOf: 1,
};
const human = object(
  {
    type: { enum: ["human"] },
    id: text(300),
    issuer: { ...text(500), pattern: "^https?://[^\\s]+$" },
  },
  ["type", "id", "issuer"],
);
const evidence = object(
  {
    field: {
      ...text(100),
      pattern: "^[a-zA-Z][a-zA-Z0-9]*(?:\\.[a-zA-Z][a-zA-Z0-9]*)?$",
    },
    value: {
      oneOf: [
        text(10000),
        { bsonType: ["int", "long", "double", "decimal"] },
        { bsonType: "bool" },
        list(),
      ],
    },
    origin: { enum: ["user_supplied", "external_evidence", "ai_inferred"] },
    provider: text(100),
    sourceReference: text(500),
    observedAt: date,
    recordedAt: date,
    verification: { enum: ["observed", "human_confirmed", "rejected"] },
    confidence: { bsonType: ["int", "long", "double"], minimum: 0, maximum: 1 },
    actor: human,
  },
  [
    "field",
    "value",
    "origin",
    "observedAt",
    "recordedAt",
    "verification",
    "actor",
  ],
);
const content = { name: text(200), description: text(10000) };
const offering = object(
  {
    ...content,
    businessModel: text(),
    primaryOfferingType: { enum: [...OFFERING_TYPES] },
    secondaryOfferingTypes: array({ enum: [...OFFERING_TYPES] }, 13),
    websiteUrl: { ...text(2048), pattern: "^https?://[^\\s@]+$" },
    whatItIs: text(10000),
    whatCustomerBuys: text(10000),
    deliveryModes: array({ enum: [...DELIVERY_MODES] }, 13),
    supplierRole: text(),
    customerRole: text(),
    implementationModel: { enum: [...IMPLEMENTATION_MODELS] },
    engagementModel: text(),
    valueProposition: text(10000),
    commercialModel: text(),
    ...lists(OFFERING_LIST_FIELDS),
  },
  ["name", "description"],
);
const icp = {
  ...object(
    {
      ...content,
      profileType: { enum: ["b2b", "b2c", "d2c"] },
      ...lists(ICP_LIST_FIELDS),
      accountProfile: object(lists(ACCOUNT_LIST_FIELDS)),
      consumerProfile: object(lists(CONSUMER_LIST_FIELDS)),
    },
    ["name", "description", "profileType"],
  ),
  oneOf: [
    {
      properties: { profileType: { enum: ["b2b"] } },
      not: { required: ["consumerProfile"] },
    },
    {
      properties: { profileType: { enum: ["b2c", "d2c"] } },
      not: { required: ["accountProfile"] },
    },
  ],
};
const buyer = object(
  {
    ...content,
    role: text(),
    seniority: text(200),
    buyingRoles: array({ enum: [...BUYING_ROLES] }, 7),
    ...lists(BUYER_LIST_FIELDS),
  },
  ["name", "description"],
);
const base = {
  _id: {},
  workspaceId: id("workspace"),
  createdAt: date,
  updatedAt: date,
  createdBy: human,
  updatedBy: human,
  schemaVersion: integer,
  archived: { bsonType: "bool" },
  archivedAt: date,
  source: object(
    {
      system: text(100),
      reference: { bsonType: "string", maxLength: 500 },
      importedAt: date,
    },
    ["system"],
  ),
  revision: integer,
  status: { enum: ["draft", "approved", "retired"] },
  contentHash: { bsonType: "string", pattern: "^[a-f0-9]{64}$" },
  approvedRevision: integer,
  approvedAt: date,
  approvedBy: human,
  evidence: array(evidence, 100),
};
const required = [
  "id",
  "workspaceId",
  "createdAt",
  "updatedAt",
  "createdBy",
  "updatedBy",
  "schemaVersion",
  "archived",
  "revision",
  "status",
  "contentHash",
  "evidence",
  "definition",
];
const records = {
  offerings: object(
    {
      ...base,
      id: id("offering"),
      organisationId: id("org"),
      brandId: id("brand"),
      definition: offering,
    },
    [...required, "organisationId"],
  ),
  ideal_customer_profiles: object(
    { ...base, id: id("icp"), offeringId: id("offering"), definition: icp },
    [...required, "offeringId"],
  ),
  buyer_profiles: object(
    {
      ...base,
      id: id("buyerprofile"),
      offeringId: id("offering"),
      idealCustomerProfileId: id("icp"),
      definition: buyer,
    },
    [...required, "offeringId", "idealCustomerProfileId"],
  ),
};
// Cross-collection references and semantic hashes are checked transactionally by the service.
const lifecycle = {
  $and: [
    { $expr: { $gte: ["$updatedAt", "$createdAt"] } },
    {
      $or: [
        {
          status: "draft",
          archived: false,
          approvedAt: { $exists: false },
          approvedBy: { $exists: false },
          archivedAt: { $exists: false },
        },
        {
          status: "approved",
          archived: false,
          approvedAt: { $type: "date" },
          approvedBy: { $exists: true },
          archivedAt: { $exists: false },
        },
        { status: "retired", archived: true, archivedAt: { $type: "date" } },
      ],
    },
    {
      $or: [
        { approvedAt: { $exists: false }, approvedBy: { $exists: false } },
        {
          approvedAt: { $type: "date" },
          approvedBy: { $exists: true },
          $expr: {
            $and: [
              { $gte: ["$approvedAt", "$createdAt"] },
              { $lte: ["$approvedAt", "$updatedAt"] },
            ],
          },
        },
      ],
    },
    {
      $or: [
        { archivedAt: { $exists: false } },
        {
          $expr: {
            $and: [
              { $gte: ["$archivedAt", "$createdAt"] },
              { $lte: ["$archivedAt", "$updatedAt"] },
            ],
          },
        },
      ],
    },
  ],
};
export const HIVE_MONGO_VALIDATORS: Record<string, Document> =
  Object.fromEntries(
    Object.entries(records).map(([name, schema]) => [
      name,
      { $and: [{ $jsonSchema: schema }, lifecycle] },
    ]),
  );
HIVE_MONGO_VALIDATORS.hive_definition_revisions = {
  $and: [
    {
      $jsonSchema: object(
        {
          _id: {},
          id: id("hiverevision"),
          workspaceId: id("workspace"),
          entityType: { enum: Object.keys(records) },
          entityId: { bsonType: "string" },
          revision: integer,
          snapshot: {
            oneOf: Object.values(records).map((record) => ({
              ...record,
              required: [
                ...(record.required ?? []),
                "approvedAt",
                "approvedBy",
                "approvedRevision",
              ],
              properties: {
                ...record.properties,
                status: { enum: ["approved"] },
                archived: { enum: [false] },
              },
            })),
          },
        },
        ["id", "workspaceId", "entityType", "entityId", "revision", "snapshot"],
      ),
    },
    {
      $expr: {
        $and: [
          { $eq: ["$workspaceId", "$snapshot.workspaceId"] },
          { $eq: ["$entityId", "$snapshot.id"] },
          { $eq: ["$revision", "$snapshot.revision"] },
          { $eq: ["$snapshot.status", "approved"] },
        ],
      },
    },
    {
      $or: Object.entries(records).map(([kind, schema]) => ({
        entityType: kind,
        "snapshot.id": { $regex: schema.properties.id.pattern },
      })),
    },
  ],
};
