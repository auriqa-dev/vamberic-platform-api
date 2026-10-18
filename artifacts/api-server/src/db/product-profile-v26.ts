import type { Document } from "mongodb";
import { OfferingContentSchema } from "../domain/hive-definitions";
import { offerMongoStructure } from "./offer-validators";
export const PRODUCT_PROFILE_MIGRATION_ID = "026-product-profile-details";
export const PRODUCT_PROFILE_FIELDS = [
  "offeringTypeExplanation",
  "offeringTypeOtherDetail",
  "technologyRole",
  "technologyRoleExplanation",
  "implementationExplanation",
  "buyerNextSteps",
] as const;
export function extendProductValidators(previous: Record<string, Document>) {
  const validators = structuredClone(previous);
  for (const name of ["offerings", "hive_definition_revisions"]) {
    let count = 0;
    function visit(node: unknown) {
      if (!node || typeof node !== "object") return;
      const obj = node as Document;
      if (
        obj.properties?.primaryOfferingType &&
        obj.properties?.implementationModel &&
        obj.properties?.whatCustomerBuys
      ) {
        for (const field of PRODUCT_PROFILE_FIELDS)
          obj.properties[field] = offerMongoStructure(
            OfferingContentSchema.shape[field],
          );
        count++;
      }
      for (const value of Object.values(obj)) visit(value);
    }
    visit(validators[name]);
    if (count !== 1)
      throw new Error(
        `Expected one offering definition in ${name}, found ${count}`,
      );
  }
  return validators;
}
