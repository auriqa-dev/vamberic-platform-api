import test from "node:test";
import assert from "node:assert/strict";
import type { Db } from "mongodb";
import { FakeDb } from "./helpers/commercial-migration-db";
import { setupDatabase as setupV14 } from "./helpers/database-v14";
import {
  setupDatabase,
  planDatabaseSetup,
  IncompatibleDatabaseSchemaError,
  V14_SETUP_VALIDATORS,
  MONGO_VALIDATORS,
} from "./helpers/database-v15";
import {
  V15_INDEXES,
  V15_VALIDATORS,
  V15_PREDECESSORS,
} from "../src/db/commercial-outcomes-v15";
async function installed() {
  const fake = new FakeDb(),
    db = fake as unknown as Db;
  await setupV14(db);
  for (const name of ["transactions", "subscriptions", "product_relationships"])
    fake.collection(name).documents.set("legacy", {
      id: "synthetic_legacy",
      productId: "legacy_product",
      retained: true,
    });
  return { fake, db };
}
test("v15 14 → 15: zero collections, seven indexes, six validators; synthetic apply/retry retains history and all records", async () => {
  const { fake, db } = await installed();
  const ledger = structuredClone(
    fake.collection("schema_versions").documents.get("vapp-v1")!,
  );
  const retained = [...fake.collections]
    .filter(([n]) => n !== "schema_versions")
    .map(([n, c]) => [n, structuredClone(c.documents)] as const);
  const mutations = fake.mutationCount;
  const plan = await planDatabaseSetup(db);
  assert.equal(fake.mutationCount, mutations);
  assert.equal(plan.existingSchemaVersion, 14);
  assert.equal(plan.schemaVersion, 15);
  assert.deepEqual(plan.collectionsToCreate, []);
  assert.deepEqual(plan.validatorConflicts, []);
  assert.deepEqual(
    plan.validatorsToApply.sort(),
    Object.keys(V15_VALIDATORS).sort(),
  );
  assert.deepEqual(
    plan.indexesToCreate.sort(),
    Object.entries(V15_INDEXES)
      .flatMap(([n, list]) => list.map((i) => n + "." + i.name))
      .sort(),
  );
  assert.equal(plan.indexesToCreate.length, 7);
  await setupDatabase(db);
  const applied = fake.collection("schema_versions").documents.get("vapp-v1")!;
  assert.deepEqual(
    (applied.migrations as unknown[]).slice(0, 14),
    ledger.migrations,
  );
  assert.equal(applied.version, 15);
  assert.equal(
    (applied.migrations as { id: string }[]).at(-1)!.id,
    "015-commercial-outcomes",
  );
  for (const [name, documents] of retained)
    assert.deepEqual(fake.collection(name).documents, documents);
  await setupDatabase(db);
  const done = await planDatabaseSetup(db);
  assert.deepEqual(done.validatorsToApply, []);
  assert.deepEqual(done.indexesToCreate, []);
  for (const [name, validator] of Object.entries(V14_SETUP_VALIDATORS))
    if (!(name in V15_VALIDATORS))
      assert.deepEqual(MONGO_VALIDATORS[name], validator);
});
for (const failure of ["unknown", "weak", "invalid", "index", "duplicate"])
  test(`v15 rejects ${failure} before synthetic writes`, async () => {
    const { fake, db } = await installed(),
      c = fake.collection("reasoning_contexts");
    if (failure === "unknown")
      c.options.validator = { $jsonSchema: { bsonType: "object" } };
    if (failure === "weak") c.options.validationAction = "warn";
    if (failure === "invalid") c.validatorInvalidCount = 1;
    if (failure === "index")
      fake.collection("transactions").indexes.push({
        name: V15_INDEXES.transactions[0].name,
        key: { wrong: 1 },
      });
    if (failure === "duplicate")
      fake.collection("transactions").aggregateResults = [{ count: 2 }];
    const before = fake.mutationCount;
    await assert.rejects(setupDatabase(db), IncompatibleDatabaseSchemaError);
    assert.equal(fake.mutationCount, before);
  });
test("v15 interruption resumes without duplicate migration or data backfill", async () => {
  const { fake, db } = await installed(),
    command = fake.command.bind(fake);
  let calls = 0;
  fake.command = async (input) => {
    if (++calls === 2) throw new Error("synthetic interruption");
    return command(input);
  };
  await assert.rejects(setupDatabase(db), /synthetic interruption/);
  assert.equal(
    fake.collection("schema_versions").documents.get("vapp-v1")!.version,
    14,
  );
  fake.command = command;
  await setupDatabase(db);
  await setupDatabase(db);
  const ledger = fake.collection("schema_versions").documents.get("vapp-v1")!;
  assert.equal(
    (ledger.migrations as { version: number }[]).filter((m) => m.version === 15)
      .length,
    1,
  );
});
test("v15 amended predecessors are exactly frozen v14, new validators had no prior validator", () => {
  assert.deepEqual(Object.keys(V15_PREDECESSORS).sort(), [
    "events",
    "reasoning_contexts",
    "relationship_value_assessments",
  ]);
  for (const name of ["transactions", "subscriptions", "product_relationships"])
    assert.equal(V14_SETUP_VALIDATORS[name], undefined);
});
for (const version of [11, 12, 13])
  test(`v15 cannot bypass installed schema ${version} predecessors`, async () => {
    const { fake, db } = await installed();
    fake.collection("schema_versions").documents.get("vapp-v1")!.version =
      version;
    const before = fake.mutationCount;
    await assert.rejects(setupDatabase(db), /qualified releases first/);
    assert.equal(fake.mutationCount, before);
  });
for (const fault of ["missing", "reordered", "duplicate", "wrong-id"])
  test(`v15 rejects ${fault} predecessor ledger`, async () => {
    const { fake, db } = await installed();
    const ledger = fake.collection("schema_versions").documents.get("vapp-v1")!;
    const migrations = ledger.migrations as { id: string; version: number }[];
    if (fault === "missing") migrations.pop();
    if (fault === "reordered") migrations.reverse();
    if (fault === "duplicate") migrations.push({ ...migrations[0] });
    if (fault === "wrong-id") migrations[13].id = "unreviewed";
    const before = fake.mutationCount;
    await assert.rejects(setupDatabase(db), /exact ordered migration history/);
    assert.equal(fake.mutationCount, before);
  });
