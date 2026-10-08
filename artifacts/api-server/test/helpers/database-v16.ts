import { createDatabaseSetup, releaseDatabaseTarget } from "../../src/db/setup";
export { V15_SETUP_VALIDATORS } from "../../src/db/setup";
const target = releaseDatabaseTarget(16);
export const MONGO_VALIDATORS = target.validators;
export const { planDatabaseSetup, setupDatabase } = createDatabaseSetup(target);
