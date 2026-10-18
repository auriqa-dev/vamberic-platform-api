import { ClientOnboardingSchema } from "../domain/client-onboarding";
import { offerMongoStructure } from "./offer-validators";
export const ONBOARDING_NO_EXPIRY_MIGRATION_ID = "024-onboarding-no-expiry";
const structure = offerMongoStructure(ClientOnboardingSchema);
structure.properties._id = {};
export const ONBOARDING_NO_EXPIRY_VALIDATOR = { $jsonSchema: structure };
