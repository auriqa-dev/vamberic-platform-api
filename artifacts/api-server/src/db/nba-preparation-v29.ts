import { isDeepStrictEqual } from "node:util";
import type { Document } from "mongodb";
import { OfferQualificationShape } from "../domain/offers";
import { ICP_PREPARATION_FIELDS } from "../domain/hive-definitions";
import { offerMongoStructure } from "./offer-validators";
export function extendNbaPreparationValidators(previous: Record<string, Document>) {
 const validators = withApprovedIcpRecovery(previous);
 for (const name of ["offers", "offer_revisions", "ideal_customer_profiles", "hive_definition_revisions"]) {
  let count=0;
  function visit(node: unknown) {
   if (!node || typeof node !== "object") return;
   const obj=node as Document;
   if (obj.properties?.headlineProposition && obj.properties?.primaryCallToAction) {
    for (const [key,schema] of Object.entries(OfferQualificationShape)) obj.properties[key]=offerMongoStructure(schema);
    count++;
   }
   if (obj.properties?.profileType && obj.properties?.accountProfile && obj.properties?.consumerProfile) {
    for (const key of ICP_PREPARATION_FIELDS) obj.properties[key]=structuredClone(obj.properties.researchCriteria ?? obj.properties.goodFitIndicators);
    count++;
   }
   for(const value of Object.values(obj)) visit(value);
  }
  visit(validators[name]);
  if(count!==1) throw new Error(`Unexpected preparation structure in ${name}: ${count}`);
 }
 return validators;
}

/** Exact additive ICP recovery applied and approved on 14 October 2026.
 * Keep frozen v28 unchanged; recognise this reviewed predecessor explicitly. */
export function withApprovedIcpRecovery(previous: Record<string, Document>) {
 const next=structuredClone(previous);
 for(const name of ["ideal_customer_profiles","hive_definition_revisions"]){
  let matched=0;
  function visit(node:unknown){
   if(!node||typeof node!=="object")return;
   const obj=node as Document, props=obj.properties;
   if(props?.profileType?.enum?.includes("b2b")&&props?.accountProfile&&props?.name&&props?.description){
    if(obj.additionalProperties!==false)throw new Error("Unexpected ICP predecessor structure");
    matched++;
    const spec={bsonType:"array",items:{bsonType:"string",minLength:1,maxLength:2000,pattern:"\\S"},maxItems:40,uniqueItems:true};
    for(const field of ["researchCriteria","adoptionReadiness","targetingCoverage"]){
     if(props[field]&&!isDeepStrictEqual(props[field],spec))throw new Error("Unexpected ICP recovery field");
     props[field]=structuredClone(spec);
    }
   }
   for(const value of Object.values(obj))visit(value);
  }
  visit(next[name]);if(matched!==1)throw new Error("Unexpected ICP recovery shape");
 }
 return next;
}
