import type { Document } from "mongodb";
import { BRAND_ASSET_TYPES, BRAND_ASSET_VARIANTS } from "../domain/brands";
const text = (maxLength = 1000) => ({
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
const list = () => array(text());
const date = { bsonType: "date" };
const human = object(
  {
    type: { enum: ["human"] },
    id: { ...text(300), pattern: "^(?!partner_).+$" },
    issuer: { ...text(500), pattern: "^https?://[^\\s]+$" },
  },
  ["type", "id", "issuer"],
);
const base = {
  _id: {},
  createdAt: date,
  updatedAt: date,
  archivedAt: date,
  archived: { bsonType: "bool" },
  schemaVersion: {
    bsonType: ["int", "long", "double"],
    minimum: 1,
    multipleOf: 1,
  },
  workspaceId: id("workspace"),
  createdBy: human,
  updatedBy: human,
  source: object(
    {
      system: text(100),
      reference: { bsonType: "string", maxLength: 500 },
      importedAt: date,
    },
    ["system"],
  ),
};
const required = ["id", "workspaceId", "createdAt", "updatedAt"];
const brand = object(
  {
    ...base,
    id: id("brand"),
    organisationId: id("org"),
    name: text(200),
    slug: { ...text(100), pattern: "^[a-z0-9][a-z0-9-]{0,99}$" },
    status: { enum: ["active", "retired"] },
    primaryDomain: {
      ...text(253),
      pattern:
        "^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\\.)+[a-zA-Z]{2,63}$",
    },
    description: text(5000),
  },
  [...required, "organisationId", "name", "slug", "status"],
);
const asset = object(
  {
    type: { enum: [...BRAND_ASSET_TYPES] },
    variant: { enum: [...BRAND_ASSET_VARIANTS] },
    name: text(200),
    altText: text(),
    status: { enum: ["approved", "retired"] },
    object: object(
      {
        store: { enum: ["s3"] },
        bucket: {
          ...text(63),
          minLength: 3,
          pattern: "^[a-z0-9][a-z0-9.-]*[a-z0-9]$",
        },
        key: {
          ...text(1024),
          pattern: "^(?!.*(?:^|/)\\.\\.(?:/|$))[A-Za-z0-9][A-Za-z0-9/_.-]*$",
        },
        versionId: { ...text(1024), pattern: "^[A-Za-z0-9_.+/\\-]+$" },
      },
      ["store", "bucket", "key"],
    ),
  },
  ["type", "name", "status", "object"],
);
const kit = object(
  {
    ...base,
    id: id("brandkit"),
    brandId: id("brand"),
    status: { enum: ["draft", "approved", "retired"] },
    approvedAt: date,
    approvedBy: human,
    assets: array(asset, 100),
    colours: array(
      object(
        {
          role: { enum: ["primary", "secondary", "accent", "surface", "text"] },
          name: text(100),
          hex: { ...text(9), pattern: "^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$" },
          usage: text(),
        },
        ["role", "name", "hex"],
      ),
      100,
    ),
    typography: array(
      object(
        {
          role: { enum: ["primary", "secondary", "heading", "body"] },
          family: text(200),
          weights: array(
            {
              bsonType: ["int", "long", "double"],
              minimum: 1,
              maximum: 1000,
              multipleOf: 1,
            },
            20,
          ),
          styles: array({ enum: ["normal", "italic", "oblique"] }, 3),
          usage: text(),
        },
        ["role", "family"],
      ),
      20,
    ),
    visualRules: object({
      layout: text(),
      spacing: text(),
      borders: text(),
      imageTreatment: text(),
      icons: text(),
      illustrations: text(),
      do: list(),
      dont: list(),
    }),
    voice: object({
      descriptors: list(),
      principles: list(),
      writingStyle: text(5000),
      avoidLanguage: list(),
      preferredTerminology: list(),
      audiences: array(
        object({ audience: text(200), guidance: text(2000) }, [
          "audience",
          "guidance",
        ]),
        30,
      ),
    }),
    terminology: object({
      productNames: list(),
      capabilityNames: list(),
      use: list(),
      avoid: list(),
      acronyms: array(
        object({ short: text(100), meaning: text(500) }, ["short", "meaning"]),
        100,
      ),
      namingConventions: list(),
    }),
    descriptions: object({
      short: text(),
      long: text(10000),
      tagline: text(300),
      about: text(10000),
      legalCompany: text(5000),
      footer: text(5000),
      products: array(
        object({ productId: id("product"), description: text(5000) }, [
          "productId",
          "description",
        ]),
        100,
      ),
    }),
    imageryGuidance: object({
      photography: text(),
      productImagery: text(),
      icons: text(),
      illustrations: text(),
      motifs: text(),
      backgrounds: text(),
    }),
    emailDefaults: object({
      fromDisplayName: text(200),
      replyToLabel: text(200),
      replyToContactPointId: id("contact"),
      footer: text(5000),
      signature: text(5000),
      legalFooter: text(5000),
      unsubscribeStyling: text(),
    }),
  },
  [...required, "brandId", "status"],
);
const lifecycle = [
  { $gte: ["$updatedAt", "$createdAt"] },
  {
    $cond: [
      { $ne: [{ $type: "$archivedAt" }, "missing"] },
      {
        $and: [
          { $eq: ["$archived", true] },
          { $gte: ["$archivedAt", "$createdAt"] },
          { $lte: ["$archivedAt", "$updatedAt"] },
        ],
      },
      true,
    ],
  },
];
export const BRAND_MONGO_VALIDATORS: Record<string, Document> = {
  brands: {
    $and: [{ $jsonSchema: brand }, { $expr: { $and: lifecycle } }],
  },
  brand_kits: {
    $and: [
      { $jsonSchema: kit },
      {
        $expr: {
          $and: [
            ...lifecycle,
            {
              $eq: [
                { $type: "$approvedAt" },
                {
                  $cond: [
                    { $eq: [{ $type: "$approvedBy" }, "missing"] },
                    "missing",
                    "date",
                  ],
                },
              ],
            },
            {
              $cond: [
                { $eq: ["$status", "approved"] },
                {
                  $and: [
                    { $eq: [{ $type: "$approvedAt" }, "date"] },
                    { $ne: ["$archived", true] },
                  ],
                },
                true,
              ],
            },
            {
              $cond: [
                { $eq: [{ $type: "$approvedAt" }, "date"] },
                {
                  $and: [
                    { $gte: ["$approvedAt", "$createdAt"] },
                    { $lte: ["$approvedAt", "$updatedAt"] },
                  ],
                },
                true,
              ],
            },
          ],
        },
      },
    ],
  },
};
