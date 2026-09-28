import type { Document } from "mongodb";
import { ONBOARDING_MONGO_VALIDATORS } from "./onboarding-validators";
// Reuse the already-tested human membership lifecycle, with workspace ownership.
const membership = structuredClone(
  ONBOARDING_MONGO_VALIDATORS.hvm_partner_memberships,
);
const schema = membership.$and[0].$jsonSchema;
schema.required = schema.required.map((key: string) =>
  key === "partnerId" ? "workspaceId" : key,
);
delete schema.properties.partnerId;
schema.properties.workspaceId = {
  bsonType: "string",
  pattern: "^workspace_[0-7][0-9abcdefghjkmnpqrstvwxyz]{25}$",
};
schema.properties.id.pattern =
  "^workspacemembership_[0-7][0-9abcdefghjkmnpqrstvwxyz]{25}$";
schema.properties.role.enum = ["admin", "member"];
export const HVM_MONGO_VALIDATORS: Record<string, Document> = {
  workspace_memberships: membership,
};
