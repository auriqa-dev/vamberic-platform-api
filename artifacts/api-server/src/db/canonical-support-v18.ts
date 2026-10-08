import {
  SupportCertificateBodySchema,
  CERTIFICATE_EVENT,
} from "../domain/canonical-support";
import { z } from "zod";
import { offerMongoStructure } from "./offer-validators";
import frozen from "./frozen-v17-target.json";
export const CANONICAL_SUPPORT_MIGRATION_ID =
  "018-canonical-support-certification";
export const CANONICAL_SUPPORT_INDEX = {
  name: "canonical_support_revision_policy_unique",
  key: {
    workspaceId: 1,
    "payload.resource": 1,
    "payload.entityId": 1,
    "payload.revision": 1,
    "payload.policyVersion": 1,
  },
  unique: true,
  partialFilterExpression: { eventType: CERTIFICATE_EVENT },
};
export const CANONICAL_SUPPORT_VALIDATOR = {
  $and: [
    frozen.validators.events,
    {
      $or: [
        { eventType: { $ne: CERTIFICATE_EVENT } },
        {
          $jsonSchema: {
            bsonType: "object",
            required: ["workspaceId", "eventType", "payload"],
            properties: {
              eventType: { enum: [CERTIFICATE_EVENT] },
              payload: offerMongoStructure(
                SupportCertificateBodySchema.extend({
                  digest: z.string().regex(/^[a-f0-9]{64}$/),
                }),
              ),
            },
          },
        },
      ],
    },
  ],
};
