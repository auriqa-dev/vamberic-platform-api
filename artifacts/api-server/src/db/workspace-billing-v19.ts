import frozen from "./frozen-v18-target.json";
import { offerMongoStructure } from "./offer-validators";
import { WorkspaceBillingExemptionSchema } from "../domain/workspace-billing";
export const WORKSPACE_BILLING_MIGRATION_ID = "019-workspace-billing-exemption";
export const WORKSPACE_BILLING_VALIDATOR = {
  $and: [
    frozen.validators.crm_workspaces,
    {
      $jsonSchema: {
        bsonType: "object",
        properties: {
          billingExemption: offerMongoStructure(
            WorkspaceBillingExemptionSchema,
          ),
        },
      },
    },
  ],
};
