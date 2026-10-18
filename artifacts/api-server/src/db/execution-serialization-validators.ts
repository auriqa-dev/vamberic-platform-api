import { COMMERCIAL_MONGO_VALIDATORS } from "./commercial-validators";
import type { Document } from "mongodb";
import { CRM_MONGO_VALIDATORS } from "./crm-validators";
import { PARTNER_MONGO_VALIDATORS } from "./partner-validators";
import { ONBOARDING_MONGO_VALIDATORS } from "./onboarding-validators";
import { HVM_MONGO_VALIDATORS } from "./hvm-validators";

export const executionSerialMongo = {
  bsonType: ["int", "long", "double"],
  minimum: 0,
  maximum: Number.MAX_SAFE_INTEGER,
  multipleOf: 1,
};
/** Candidate only. Published predecessors are never mutated in place. */
export function withExecutionSerial(previous: Document): Document {
  const next = structuredClone(previous);
  const schema =
    next.$jsonSchema ??
    next.$and?.find((v: Document) => v.$jsonSchema)?.$jsonSchema;
  if (!schema?.properties)
    throw new Error("Authority anchor validator shape changed");
  schema.properties.executionSerial = executionSerialMongo;
  return next;
}
export const EXECUTION_SERIALIZATION_PREDECESSORS: Record<string, Document> = {
  crm_workspaces: CRM_MONGO_VALIDATORS.crm_workspaces!,
  capability_instances: COMMERCIAL_MONGO_VALIDATORS.capability_instances!,
  hvm_partners: PARTNER_MONGO_VALIDATORS.hvm_partners!,
  workspace_partner_assignments:
    PARTNER_MONGO_VALIDATORS.workspace_partner_assignments!,
  hvm_partner_memberships: ONBOARDING_MONGO_VALIDATORS.hvm_partner_memberships!,
  workspace_integrations: ONBOARDING_MONGO_VALIDATORS.workspace_integrations!,
  workspace_memberships: HVM_MONGO_VALIDATORS.workspace_memberships!,
};
export const EXECUTION_SERIALIZATION_VALIDATORS = Object.fromEntries(
  Object.entries(EXECUTION_SERIALIZATION_PREDECESSORS).map(
    ([name, validator]) => [name, withExecutionSerial(validator)],
  ),
);
