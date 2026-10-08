import test from "node:test";
import assert from "node:assert/strict";
import type { Db } from "mongodb";
import { FakeDb } from "./helpers/commercial-migration-db";
import { setupDatabase as setupV15 } from "./helpers/database-v15";
import {
  setupDatabase,
  planDatabaseSetup,
  MONGO_VALIDATORS,
  V15_SETUP_VALIDATORS,
} from "./helpers/database-v16";
import {
  V16_MIGRATION_ID,
  V16_BUDGET_COLLECTIONS,
} from "../src/db/agent-foundation-v16";
async function fixture() {
  const fake = new FakeDb(),
    db = fake as unknown as Db;
  await setupV15(db);
  return { fake, db };
}
test("v16 exact 15 → 16 manifest, synthetic apply/retry, no backfill", async () => {
  const { fake, db } = await fixture();
  const before = new Map(
    [...fake.collections].map(([n, c]) => [n, structuredClone(c.documents)]),
  );
  const mutations = fake.mutationCount;
  const plan = await planDatabaseSetup(db);
  assert.equal(fake.mutationCount, mutations);
  assert.equal(plan.existingSchemaVersion, 15);
  assert.equal(plan.schemaVersion, 16);
  assert.deepEqual(plan.validatorConflicts, []);
  assert.deepEqual(
    plan.collectionsToCreate.sort(),
    V16_BUDGET_COLLECTIONS.map((c) => c.name).sort(),
  );
  assert.equal(plan.indexesToCreate.length, 9);
  assert.deepEqual(
    plan.validatorsToApply.sort(),
    [
      ...V16_BUDGET_COLLECTIONS.map((c) => c.name),
      "workspace_memberships",
      "agent_definitions",
      "pricing_recommendations",
      "swarm_agreements",
      "agent_runs",
      "agent_results",
      "agent_effectiveness_cases",
    ].sort(),
  );
  await setupDatabase(db);
  const ledger = fake.collection("schema_versions").documents.get("vapp-v1")!;
  assert.equal(ledger.version, 16);
  assert.deepEqual(
    (ledger.migrations as { id: string }[]).at(-1)?.id,
    V16_MIGRATION_ID,
  );
  for (const [name, docs] of before)
    if (name !== "schema_versions")
      assert.deepEqual(fake.collection(name).documents, docs);
  for (const c of V16_BUDGET_COLLECTIONS)
    assert.equal(fake.collection(c.name).documents.size, 0);
  await setupDatabase(db);
  const done = await planDatabaseSetup(db);
  assert.deepEqual(done.validatorsToApply, []);
  assert.deepEqual(done.indexesToCreate, []);
  assert.deepEqual(done.collectionsToCreate, []);
  for (const [name, validator] of Object.entries(V15_SETUP_VALIDATORS))
    if (!plan.validatorsToApply.includes(name))
      assert.deepEqual(MONGO_VALIDATORS[name], validator);
});
for (const version of [11, 12, 13, 14])
  test(`v16 refuses to skip predecessor ${version}`, async () => {
    const { fake, db } = await fixture();
    fake.collection("schema_versions").documents.get("vapp-v1")!.version =
      version;
    const count = fake.mutationCount;
    await assert.rejects(setupDatabase(db), /ordered reviewed predecessors/);
    assert.equal(fake.mutationCount, count);
  });
for (const problem of [
  "ledger",
  "validator",
  "validationLevel",
  "invalidRecords",
] as const)
  test(`v16 rejects ${problem} before writes`, async () => {
    const { fake, db } = await fixture();
    if (problem === "ledger")
      fake.collection("schema_versions").documents.get("vapp-v1")!.migrations =
        [];
    if (problem === "validator")
      fake.collection("agent_runs").options.validator = { unexpected: true };
    if (problem === "validationLevel")
      fake.collection("agent_runs").options.validationLevel = "moderate";
    if (problem === "invalidRecords")
      fake.collection("agent_runs").validatorInvalidCount = 1;
    const count = fake.mutationCount;
    await assert.rejects(setupDatabase(db));
    assert.equal(fake.mutationCount, count);
  });

test("v16 interruption retains predecessor ledger and retries exactly once without backfill", async () => {
  const { fake, db } = await fixture();
  const saved = new Map(
    [...fake.collections]
      .filter(([name]) => name !== "schema_versions")
      .map(([name, c]) => [name, structuredClone(c.documents)]),
  );
  const command = fake.command.bind(fake);
  let calls = 0;
  fake.command = async (input) => {
    if (++calls === 2) throw new Error("synthetic interruption");
    return command(input);
  };
  await assert.rejects(setupDatabase(db), /synthetic interruption/);
  assert.equal(
    fake.collection("schema_versions").documents.get("vapp-v1")!.version,
    15,
  );
  fake.command = command;
  await setupDatabase(db);
  await setupDatabase(db);
  const ledger = fake.collection("schema_versions").documents.get("vapp-v1")!;
  assert.equal(
    (ledger.migrations as { version: number }[]).filter((m) => m.version === 16)
      .length,
    1,
  );
  for (const [name, documents] of saved)
    assert.deepEqual(fake.collection(name).documents, documents);
});
