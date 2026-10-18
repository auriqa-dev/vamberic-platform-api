import assert from "node:assert/strict";
import { test } from "node:test";
import { createDatabaseSetup, releaseDatabaseTarget } from "../src/db/setup";
import { FakeDb } from "./helpers/commercial-migration-db";
test("scoped Interaction migration checks changed records and still detects metadata drift", async () => {
  const db = new FakeDb();
  await createDatabaseSetup({
    ...releaseDatabaseTarget(29),
    ordered: false,
  }).setupDatabase(db as never);
  const scans: string[] = [];
  for (const [name, c] of db.collections) {
    const count = c.countDocuments.bind(c);
    c.countDocuments = async (filter) => {
      scans.push(name);
      return count(filter);
    };
  }
  const setup = createDatabaseSetup({
    ...releaseDatabaseTarget(30),
    changedRecordsOnly: true,
  });
  const p = await setup.planDatabaseSetup(db as never);
  assert.deepEqual(p.validatorConflicts, []);
  assert.deepEqual(p.validatorsToApply, ["brand_kits"]);
  assert.deepEqual(scans, ["brand_kits"]);
  db.collection("brand_kits").validatorInvalidCount = 1;
  assert.ok(
    (await setup.planDatabaseSetup(db as never)).validatorConflicts.some((x) =>
      x.startsWith("brand_kits:"),
    ),
  );
  db.collection("brand_kits").validatorInvalidCount = 0;
  await setup.setupDatabase(db as never);
  assert.equal(
    (await setup.planDatabaseSetup(db as never)).existingSchemaVersion,
    30,
  );
  db.collection("people").options = { validator: { unexpected: true } };
  assert.ok(
    (await setup.planDatabaseSetup(db as never)).validatorConflicts.some((x) =>
      x.startsWith("people:"),
    ),
  );
});
