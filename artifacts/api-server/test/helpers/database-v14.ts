import { createDatabaseSetup, V14_SETUP_VALIDATORS } from "../../src/db/setup";
import { V14_SETUP_COLLECTIONS } from "../../src/db/collections";
export { IncompatibleDatabaseSchemaError } from "../../src/db/setup";
export const { planDatabaseSetup, setupDatabase } = createDatabaseSetup({
  version: 14,
  validators: V14_SETUP_VALIDATORS,
  collections: V14_SETUP_COLLECTIONS,
});

export { V14_SETUP_VALIDATORS as MONGO_VALIDATORS } from "../../src/db/setup";
