import { isDeepStrictEqual } from "node:util";
import type { Document } from "mongodb";
import type { CollectionDefinition } from "./collections";
import { V14_VALIDATORS } from "./identity-value-v14";
import {
  V15_SCHEMAS,
  TransactionReferenceV15,
} from "../domain/commercial-outcomes-v15";
import { offerMongoStructure } from "./offer-validators";
export const COMMERCIAL_OUTCOMES_V15_MIGRATION_ID = "015-commercial-outcomes";
export const V15_PREDECESSORS: Record<string, Document> = Object.fromEntries(
  ["events", "relationship_value_assessments", "reasoning_contexts"].map(
    (name) => [name, V14_VALIDATORS[name]],
  ),
);
export function isV14Predecessor(name: string, validator: Document) {
  return (
    Boolean(V15_PREDECESSORS[name]) &&
    isDeepStrictEqual(validator, V15_PREDECESSORS[name])
  );
}
export const V15_VALIDATORS: Record<string, Document> = Object.fromEntries(
  Object.entries(V15_SCHEMAS).map(([name, schema]) => {
    const structure = offerMongoStructure(schema);
    structure.properties._id = {};
    if (structure.properties.currency)
      structure.properties.currency.enum = Intl.supportedValuesOf("currency");
    const predicates = V14_VALIDATORS[name]?.$and.slice(1) ?? [
      { $expr: { $eq: ["$createdAt", "$updatedAt"] } },
    ];
    const validator = {
      $and: [{ $jsonSchema: structure }, ...structuredClone(predicates)],
    };
    // Preserve legacy Product records, but removing the discriminator must not
    // let Offering commercial fields escape the strict v15 branch.
    const legacyOnly = Object.fromEntries(
      [
        "commercialVersion",
        "offering",
        "provenance",
        "commercialKind",
        "originalTransaction",
        "subscription",
        "supersedes",
        "transactions",
      ].map((key) => [key, { $exists: false }]),
    );
    return [
      name,
      ["transactions", "subscriptions", "product_relationships"].includes(name)
        ? { $or: [legacyOnly, validator] }
        : validator,
    ];
  }),
);
V15_VALIDATORS.events = {
  $and: [
    structuredClone(V14_VALIDATORS.events),
    {
      $jsonSchema: {
        bsonType: "object",
        properties: {
          commercialTransaction: offerMongoStructure(TransactionReferenceV15),
        },
      },
    },
    {
      $or: [
        { commercialTransaction: { $exists: false } },
        {
          workspaceId: {
            $type: "string",
            $regex: "^workspace_[0-7][0-9abcdefghjkmnpqrstvwxyz]{25}$",
          },
        },
      ],
    },
  ],
};
const partialFilterExpression = { commercialVersion: 1 };
const history = (at: string) => ({
  key: {
    workspaceId: 1,
    organisationId: 1,
    "offering.entityId": 1,
    [at]: -1,
    id: 1,
  },
  name: "workspace_organisation_offering_history",
  partialFilterExpression,
});
const source = {
  key: {
    workspaceId: 1,
    "provenance.sourceSystem": 1,
    "provenance.sourceAccount": 1,
    "provenance.externalReference": 1,
    "provenance.sourceRevision": 1,
  },
  name: "workspace_commercial_source_revision_unique",
  unique: true,
  partialFilterExpression,
};
export const V15_INDEXES: Record<string, CollectionDefinition["indexes"]> = {
  transactions: [
    history("transactedAt"),
    source,
    {
      key: { workspaceId: 1, "originalTransaction.id": 1, createdAt: 1 },
      name: "workspace_original_transaction_history",
      partialFilterExpression,
    },
  ],
  subscriptions: [history("effectiveAt"), source],
  product_relationships: [history("effectiveAt")],
  events: [
    {
      key: { workspaceId: 1, "commercialTransaction.id": 1, occurredAt: -1 },
      name: "workspace_commercial_transaction",
      partialFilterExpression: {
        "commercialTransaction.id": { $exists: true },
      },
    },
  ],
};
