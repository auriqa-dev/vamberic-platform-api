import { createDatabaseSetup, V15_SETUP_VALIDATORS } from "../../src/db/setup";
import { V15_SETUP_COLLECTIONS } from "../../src/db/collections";
export {
  IncompatibleDatabaseSchemaError,
  V14_SETUP_VALIDATORS,
} from "../../src/db/setup";
export const { planDatabaseSetup, setupDatabase } = createDatabaseSetup({
  version: 15,
  validators: V15_SETUP_VALIDATORS,
  collections: V15_SETUP_COLLECTIONS,
});
export { V15_SETUP_VALIDATORS as MONGO_VALIDATORS } from "../../src/db/setup";
