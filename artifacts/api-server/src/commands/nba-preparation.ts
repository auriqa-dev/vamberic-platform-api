import assert from "node:assert/strict";
import { MongoClient } from "mongodb";
import { loadConfig } from "../config";
import { DATABASE_NAME } from "../services/mongo";
import { createDatabaseSetup, releaseDatabaseTarget } from "../db/setup";
const mode = process.argv[2];
assert.ok(mode === "--dry-run" || mode === "--apply");
const client = new MongoClient(loadConfig().mongodbUri, {
  serverSelectionTimeoutMS: 10000,
});
try {
  await client.connect();
  const db = client.db(DATABASE_NAME),
    setup = createDatabaseSetup(releaseDatabaseTarget(29)),
    plan = await setup.planDatabaseSetup(db);
  assert.ok([28, 29].includes(plan.existingSchemaVersion));
  assert.equal(plan.validatorConflicts.length, 0);
  assert.equal(plan.incompatibleIndexes.length, 0);
  assert.equal(plan.uniqueIndexRisks.length, 0);
  assert.equal(plan.collectionsToCreate.length, 0);
  assert.equal(plan.indexesToCreate.length, 0);
  assert.ok(
    plan.validatorsToApply.every((name) =>
      [
        "offers",
        "offer_revisions",
        "ideal_customer_profiles",
        "hive_definition_revisions",
      ].includes(name),
    ),
  );
  if (mode === "--apply") await setup.setupDatabase(db);
  const after = await setup.planDatabaseSetup(db);
  if (mode === "--apply") {
    assert.equal(after.existingSchemaVersion, 29);
    assert.equal(after.collectionsToCreate.length, 0);
    assert.equal(after.indexesToCreate.length, 0);
    assert.equal(after.validatorsToApply.length, 0);
  }
  console.log(
    JSON.stringify({
      mode,
      status: "PASS",
      beforeVersion: plan.existingSchemaVersion,
      afterVersion: after.existingSchemaVersion,
      collectionsToCreate: plan.collectionsToCreate,
      indexesToCreate: plan.indexesToCreate,
      clientRecordWrites: 0,
    }),
  );
} catch {
  console.error(
    "NBA preparation schema transition stopped. No credentials or client records logged.",
  );
  process.exitCode = 1;
} finally {
  await client.close();
}
