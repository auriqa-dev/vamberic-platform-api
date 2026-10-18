import { IcpOfferContextSchema } from "../domain/hive-definitions";
import { offerMongoStructure } from "./offer-validators";
import type { Document } from "mongodb";

export const OFFER_SEQUENCE_MIGRATION_ID = "027-offer-before-icp";
/** Additive relaxation only: historical targets remain untouched; an offer may
 * precede its ICP. Do not compile old migration targets from changed schemas. */
export function extendOfferSequenceValidators(
  previous: Record<string, Document>,
) {
  const validators = structuredClone(previous);
  for (const name of ["offers", "offer_designs", "offer_revisions"]) {
    let definitions = 0;
    let predicates = 0;
    function visit(node: unknown) {
      if (!node || typeof node !== "object") return;
      const obj = node as Document;
      if (obj.properties?.headlineProposition && obj.properties?.targetIcpIds) {
        delete obj.properties.targetIcpIds.minItems;
        definitions++;
      }
      if (Array.isArray(obj.$and)) {
        obj.$and = obj.$and.filter((condition: Document) => {
          const comparison = condition.$gt;
          if (
            Array.isArray(comparison) &&
            comparison[1] === 0 &&
            JSON.stringify(comparison[0]).includes(".work.targetIcpIds")
          ) {
            predicates++;
            return false;
          }
          return true;
        });
      }
      for (const value of Object.values(obj)) visit(value);
    }
    visit(validators[name]);
    const expected =
      name === "offers" ? [1, 0] : name === "offer_designs" ? [0, 1] : [1, 1];
    if (definitions !== expected[0] || predicates !== expected[1])
      throw new Error(`Unexpected offer validator structure: ${name}`);
  }
  for (const name of ["ideal_customer_profiles", "hive_definition_revisions"]) {
    let count = 0;
    function addLink(node: unknown) {
      if (!node || typeof node !== "object") return;
      const obj = node as Document;
      if (
        obj.properties?.id?.pattern?.startsWith("^icp_") &&
        obj.properties?.definition &&
        obj.properties?.offeringId
      ) {
        obj.properties.offer = offerMongoStructure(IcpOfferContextSchema);
        count++;
      }
      for (const value of Object.values(obj)) addLink(value);
    }
    addLink(validators[name]);
    if (count !== 1)
      throw new Error(`Expected one ICP structure in ${name}, found ${count}`);
  }
  return validators;
}
