import frozenValidator from "./client-onboarding-v21.frozen.json";
import type { CollectionDefinition } from "./collections";
export const CLIENT_ONBOARDING_MIGRATION_ID = "021-exempt-client-onboarding";
export const CLIENT_ONBOARDING_VALIDATOR = frozenValidator;
export const CLIENT_ONBOARDING_COLLECTION: CollectionDefinition = {
  name: "client_onboardings",
  reason:
    "Partner-scoped pre-client commercial admission; no execution authority",
  indexes: [
    { key: { id: 1 }, name: "id_unique", unique: true },
    { key: { createScope: 1 }, name: "create_scope_unique", unique: true },
    { key: { partnerId: 1, id: 1 }, name: "partner_id" },
  ],
};
