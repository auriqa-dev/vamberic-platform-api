import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { FakeDb } from "./helpers/commercial-migration-db";
import { createDatabaseSetup, releaseDatabaseTarget } from "../src/db/setup";
const v17 = releaseDatabaseTarget(17);
const { setupDatabase, planDatabaseSetup } = createDatabaseSetup(v17);
const MONGO_VALIDATORS = v17.validators;
import {
  ACTION_LIBRARY_V17_VALIDATORS,
  ACTION_LIBRARY_COLLECTIONS,
} from "../src/db/action-library-v17";
async function fixture() {
  const fake = new FakeDb();
  await createDatabaseSetup(releaseDatabaseTarget(16)).setupDatabase(
    fake as never,
  );
  return fake;
}
test("v17 exact manifest, read-only planning, retry and no backfill", async () => {
  const fake = await fixture(),
    before = new Map(
      [...fake.collections].map(([name, c]) => [
        name,
        structuredClone(c.documents),
      ]),
    ),
    count = fake.mutationCount;
  const p = await planDatabaseSetup(fake as never);
  assert.equal(fake.mutationCount, count);
  assert.equal(p.existingSchemaVersion, 16);
  assert.equal(p.schemaVersion, 17);
  assert.deepEqual(p.validatorConflicts, []);
  assert.deepEqual(
    p.validatorsToApply.sort(),
    Object.keys(ACTION_LIBRARY_V17_VALIDATORS).sort(),
  );
  assert.deepEqual(
    p.collectionsToCreate.sort(),
    ACTION_LIBRARY_COLLECTIONS.map((c) => c.name).sort(),
  );
  assert.equal(p.indexesToCreate.length, 7);
  await setupDatabase(fake as never);
  await setupDatabase(fake as never);
  const done = await planDatabaseSetup(fake as never);
  assert.deepEqual(done.validatorsToApply, []);
  assert.deepEqual(done.indexesToCreate, []);
  assert.deepEqual(done.collectionsToCreate, []);
  for (const [name, rows] of before)
    if (name !== "schema_versions")
      assert.deepEqual(fake.collection(name).documents, rows);
  for (const c of ACTION_LIBRARY_COLLECTIONS)
    assert.equal(fake.collection(c.name).documents.size, 0);
  for (const [name, v] of Object.entries(releaseDatabaseTarget(16).validators))
    if (!p.validatorsToApply.includes(name))
      assert.deepEqual(MONGO_VALIDATORS[name], v);
});
test("v17 interrupted DDL resumes with one ledger entry and no backfill", async () => {
  const fake = await fixture(),
    command = fake.command.bind(fake);
  let n = 0;
  fake.command = async (input) => {
    if (++n === 2) throw new Error("synthetic interruption");
    return command(input);
  };
  await assert.rejects(setupDatabase(fake as never), /synthetic interruption/);
  assert.equal(
    fake.collection("schema_versions").documents.get("vapp-v1")!.version,
    16,
  );
  fake.command = command;
  await setupDatabase(fake as never);
  await setupDatabase(fake as never);
  assert.equal(
    (
      fake.collection("schema_versions").documents.get("vapp-v1")!
        .migrations as { version: number }[]
    ).filter((m) => m.version === 17).length,
    1,
  );
});
for (const version of [11, 12, 13, 14, 15, 18])
  test(`v17 rejects predecessor ${version} without writes`, async () => {
    const fake = await fixture();
    fake.collection("schema_versions").documents.get("vapp-v1")!.version =
      version;
    const n = fake.mutationCount;
    await assert.rejects(setupDatabase(fake as never));
    assert.equal(fake.mutationCount, n);
  });
for (const kind of ["ledger", "validator", "invalid_data", "mode"] as const)
  test(`v17 rejects ${kind} before writes`, async () => {
    const fake = await fixture();
    if (kind === "ledger")
      fake.collection("schema_versions").documents.get("vapp-v1")!.migrations =
        [];
    if (kind === "validator")
      fake.collection("reasoning_decisions").options.validator = {
        unknown: true,
      };
    if (kind === "invalid_data")
      fake.collection("reasoning_decisions").validatorInvalidCount = 1;
    if (kind === "mode")
      fake.collection("reasoning_decisions").options.validationAction = "warn";
    const n = fake.mutationCount;
    await assert.rejects(setupDatabase(fake as never));
    assert.equal(fake.mutationCount, n);
  });
test("all reviewed v12–v16 compiled targets remain exact", () => {
  const expected: Record<number, string> = {
    "12": "ba487b64505e2be74c9ae808f93edb82b4ffe22a4ca5605650b4f14552037871",
    "13": "7dfc97a56fb8678cc810260784c784edccd9d7955296b83a5838d662944af631",
    "14": "22361100e00aeffeee50cddb1a64b5898d8de7add0cdba19592c9f0003aec310",
    "15": "190a533405ddc6f957ad13f19e9e31d6af2870d64229d8b5aa6907f3992ec2e2",
    "16": "8196a9b0ee663dfd9249f2364b92b1d02dfbd81f464c76074a29d7390c817df6",
  };
  for (const version of [12, 13, 14, 15, 16] as const) {
    const { ordered, ...target } = releaseDatabaseTarget(version);
    void ordered;
    assert.equal(
      createHash("sha256").update(JSON.stringify(target)).digest("hex"),
      expected[version],
    );
  }
});
