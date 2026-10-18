import { withExecutionSerial } from "./execution-serialization-validators";
import { z } from "zod";
import type { Document } from "mongodb";
import { HVM_MONGO_VALIDATORS } from "./hvm-validators";
import { offerMongoStructure } from "./offer-validators";
import { operatingJsonSize } from "./operating-json-size";
import {
  AgentOperationGrantSchema,
  MAX_AGENT_OPERATION_GRANTS,
  MAX_AGENT_OPERATION_GRANT_BYTES,
} from "../domain/agent-operator";

// The installed v5/v9 validator is retained unchanged. The migration must only
// recognize that exact predecessor, never blindly replace a live validator.
export const WORKSPACE_MEMBERSHIP_V9_VALIDATOR =
  HVM_MONGO_VALIDATORS.workspace_memberships!;
const validator = withExecutionSerial(WORKSPACE_MEMBERSHIP_V9_VALIDATOR);
const grantObject = AgentOperationGrantSchema.innerType();
const targetShape = z
  .object({
    kind: z.enum(["client_agent", "client_swarm"]),
    id: z.string(),
    revision: z.number().int().positive().safe(),
  })
  .strict();
// Serialization shape only: both discriminated variants have these exact keys.
const grantSizeShape = grantObject;
void targetShape;
const structural = offerMongoStructure(grantSizeShape);
structural.properties.target = {
  anyOf: grantObject.shape.target.options.map((option) => ({
    ...offerMongoStructure(option),
    properties: {
      ...offerMongoStructure(option).properties,
      revision: {
        bsonType: ["int", "long", "double"],
        minimum: 1,
        maximum: Number.MAX_SAFE_INTEGER,
        multipleOf: 1,
      },
    },
  })),
};
structural.properties.operations.uniqueItems = true;
const grants = {
  $cond: [{ $isArray: "$agentOperationGrants" }, "$agentOperationGrants", []],
};
const unique = (expression: unknown): Document => ({
  $eq: [
    { $size: grants },
    {
      $size: {
        $setUnion: [
          { $map: { input: grants, as: "grant", in: expression } },
          [],
        ],
      },
    },
  ],
});
const present = { $ne: [{ $type: "$agentOperationGrants" }, "missing"] };
const utf16 = (path: string, max: number) => {
  const text = { $cond: [{ $eq: [{ $type: path }, "string"] }, path, ""] };
  return {
    $lte: [
      {
        $add: [
          { $strLenCP: text },
          {
            $size: {
              $regexFindAll: { input: text, regex: "[\\x{10000}-\\x{10FFFF}]" },
            },
          },
        ],
      },
      max,
    ],
  };
};
validator.$and[0].$jsonSchema.properties.agentOperationGrants = {
  bsonType: "array",
  maxItems: MAX_AGENT_OPERATION_GRANTS,
  items: structural,
};
validator.$and.push({
  $expr: {
    $cond: [
      present,
      {
        $and: [
          unique("$$grant.id"),
          unique({
            $concat: ["$$grant.target.kind", ":", "$$grant.target.id"],
          }),
          // Include the serialization wrapper's fixed bytes without limiting old documents.
          operatingJsonSize(
            z.object({ agentOperationGrants: z.array(grantSizeShape) }),
            MAX_AGENT_OPERATION_GRANT_BYTES +
              Buffer.byteLength('{"agentOperationGrants":}'),
          ),
          {
            $allElementsTrue: [
              {
                $map: {
                  input: grants,
                  as: "grant",
                  in: {
                    $and: [
                      { $gte: ["$$grant.grantedAt", "$joinedAt"] },
                      { $lte: ["$$grant.grantedAt", "$updatedAt"] },
                      {
                        $or: [
                          { $eq: [{ $type: "$$grant.expiresAt" }, "missing"] },
                          { $gt: ["$$grant.expiresAt", "$$grant.grantedAt"] },
                        ],
                      },
                      utf16("$$grant.grantedBy.issuer", 500),
                      utf16("$$grant.grantedBy.id", 300),
                      {
                        $not: [
                          {
                            $regexMatch: {
                              input: {
                                $trim: {
                                  input: {
                                    $ifNull: ["$$grant.grantedBy.id", ""],
                                  },
                                },
                              },
                              regex: "^partner_",
                            },
                          },
                        ],
                      },
                    ],
                  },
                },
              },
            ],
          },
        ],
      },
      true,
    ],
  },
});
export const WORKSPACE_MEMBERSHIP_OPERATOR_VALIDATOR: Document = validator;
