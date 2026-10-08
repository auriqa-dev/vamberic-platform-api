import { isDeepStrictEqual } from "node:util";
import type { Document } from "mongodb";
import type { CollectionDefinition } from "./collections";
import {
  V14_SCHEMAS,
  EventIdentityObservationV14,
} from "../domain/identity-value-v14";
import { REASONING_VALIDATORS } from "./reasoning-foundation";
import { offerMongoStructure } from "./offer-validators";
export const IDENTITY_VALUE_V14_MIGRATION_ID =
  "014-identity-relationship-value-strategy";
export const V14_NEW_COLLECTIONS = [
  "interaction_identities",
  "identity_resolutions",
  "relationship_value_assessments",
] as const;
export const V14_COLLECTION_DEFINITIONS: CollectionDefinition[] =
  V14_NEW_COLLECTIONS.map((name) => ({
    name,
    reason: "Workspace-owned, non-authorizing identity and value foundation.",
    indexes: [
      { key: { id: 1 }, name: "id_unique", unique: true },
      {
        key: { workspaceId: 1, createdAt: -1, id: 1 },
        name: "workspace_created",
      },
      ...(name === "identity_resolutions"
        ? [
            {
              key: { workspaceId: 1, identityId: 1, createdAt: -1 },
              name: "workspace_identity_history",
            },
            {
              key: { workspaceId: 1, personId: 1, createdAt: -1 },
              name: "workspace_person_history",
            },
          ]
        : []),
      ...(name === "relationship_value_assessments"
        ? [
            {
              key: {
                workspaceId: 1,
                "subject.kind": 1,
                "subject.organisationId": 1,
                "subject.personId": 1,
                key: 1,
                version: 1,
              },
              name: "workspace_subject_key_version_unique",
              unique: true,
            },
          ]
        : []),
    ] as CollectionDefinition["indexes"],
  }));
export const V14_PREDECESSORS = Object.fromEntries(
  ["reasoning_contexts", "contact_strategy_policies", "events"].map((name) => [
    name,
    REASONING_VALIDATORS[name],
  ]),
);
export function isV13Predecessor(name: string, validator: Document) {
  return (
    Boolean(V14_PREDECESSORS[name]) &&
    isDeepStrictEqual(validator, V14_PREDECESSORS[name])
  );
}
export const V14_VALIDATORS: Record<string, Document> = Object.fromEntries(
  Object.entries(V14_SCHEMAS).map(([name, schema]) => {
    const structure = offerMongoStructure(schema);
    structure.properties._id = {};
    // Same immutable v13 document predicates, new structural extension only.
    const predicates = REASONING_VALIDATORS[name]?.$and.slice(1) ?? [
      {
        $expr: {
          $and: [
            { $eq: ["$createdAt", "$updatedAt"] },
            { $ne: ["$id", { $ifNull: ["$supersedesId", ""] }] },
          ],
        },
      },
    ];
    return [
      name,
      { $and: [{ $jsonSchema: structure }, ...structuredClone(predicates)] },
    ];
  }),
);
V14_VALIDATORS.events = {
  $and: [
    structuredClone(REASONING_VALIDATORS.events),
    {
      $jsonSchema: {
        bsonType: "object",
        properties: {
          identityObservation: offerMongoStructure(EventIdentityObservationV14),
        },
      },
    },
    {
      $or: [
        { identityObservation: { $exists: false } },
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

export const V14_EVENT_IDENTITY_INDEX = {
  key: {
    workspaceId: 1,
    "identityObservation.identityId": 1,
    occurredAt: -1,
    id: 1,
  },
  name: "workspace_identity_occurred",
  partialFilterExpression: {
    "identityObservation.identityId": { $exists: true },
  },
} satisfies CollectionDefinition["indexes"][number];
