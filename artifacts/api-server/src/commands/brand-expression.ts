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
  const db = client.db(DATABASE_NAME);
  const setup = createDatabaseSetup(releaseDatabaseTarget(25));
  const plan = await setup.planDatabaseSetup(db);
  assert.ok([24, 25].includes(plan.existingSchemaVersion));
  for (const values of [
    plan.validatorConflicts,
    plan.collectionsToCreate,
    plan.indexesToCreate,
    plan.incompatibleIndexes,
    plan.uniqueIndexRisks,
  ])
    assert.equal(values.length, 0);
  assert.ok(plan.validatorsToApply.every((name) => name === "brand_kits"));
  if (mode === "--apply") await setup.setupDatabase(db);
  const after = await setup.planDatabaseSetup(db);
  if (mode === "--apply") {
    assert.equal(after.existingSchemaVersion, 25);
    assert.equal(after.validatorsToApply.length, 0);
    assert.equal(after.validatorConflicts.length, 0);
  }
  console.log(
    JSON.stringify({
      mode,
      status: "PASS",
      beforeVersion: plan.existingSchemaVersion,
      afterVersion: after.existingSchemaVersion,
      validatorsToApply: plan.validatorsToApply,
      clientRecordWrites: 0,
    }),
  );
} catch {
  console.error(
    "Brand expression schema transition stopped safely; no credentials or document data logged.",
  );
  process.exitCode = 1;
} finally {
  await client.close();
}
