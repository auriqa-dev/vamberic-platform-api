import test from "node:test";
import assert from "node:assert/strict";
import { createDatabaseSetup, releaseDatabaseTarget } from "../src/db/setup";
import frozen from "../src/db/frozen-v19-target.json";
import { ACTION_NUMERIC_V20_PATHS } from "../src/db/action-numeric-v20";
import { FakeDb } from "./helpers/commercial-migration-db";
import { CRM_SCHEMAS, crmPatchSchema } from "../src/services/crm-foundation";
async function base() {
  const db = new FakeDb();
  await createDatabaseSetup(releaseDatabaseTarget(19)).setupDatabase(
    db as never,
  );
  return db;
}
test("v20 is exactly twelve forward numeric leaves, five validators, no collection/index change", () => {
  assert.deepEqual(releaseDatabaseTarget(19).validators, frozen.validators);
  const target = releaseDatabaseTarget(20);
  assert.deepEqual(target.collections, frozen.collections);
  const expected = structuredClone(frozen.validators) as Record<
    string,
    Record<string, unknown>
  >;
  for (const [name, ...path] of ACTION_NUMERIC_V20_PATHS) {
    let p = expected[name];
    for (const key of path.slice(0, -1)) p = p[key] as Record<string, unknown>;
    p.minimum = 0;
  }
  assert.equal(ACTION_NUMERIC_V20_PATHS.length, 12);
  assert.equal(new Set(ACTION_NUMERIC_V20_PATHS.map((p) => p[0])).size, 5);
  assert.deepEqual(target.validators, expected);
});
for (const path of ACTION_NUMERIC_V20_PATHS)
  test(`v20 positive safe numeric boundary ${path.join("/")}`, () => {
    let shape: Record<string, unknown> = releaseDatabaseTarget(20).validators;
    for (const key of path.slice(0, -1))
      shape = shape[key] as Record<string, unknown>;
    for (const value of [
      -Number.MAX_SAFE_INTEGER,
      -1,
      0,
      1.5,
      1,
      Number.MAX_SAFE_INTEGER,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      const accepted =
        Number.isInteger(value) &&
        value > (shape.minimum as number) &&
        value <= (shape.maximum as number);
      assert.equal(accepted, [1, Number.MAX_SAFE_INTEGER].includes(value));
    }
    assert.equal(shape.exclusiveMinimum, true);
    assert.equal(shape.multipleOf, 1);
  });
test("v19 to v20 plans five validators, preserves data and repeats without changes", async () => {
  const db = await base();
  const old = [...db.collections].map(
    ([n, c]) => [n, structuredClone(c.documents)] as const,
  );
  const s = createDatabaseSetup(releaseDatabaseTarget(20));
  const p = await s.planDatabaseSetup(db as never);
  assert.deepEqual(p.collectionsToCreate, []);
  assert.deepEqual(p.indexesToCreate, []);
  assert.equal(p.validatorsToApply.length, 5);
  assert.deepEqual(p.validatorConflicts, []);
  await s.setupDatabase(db as never);
  await s.setupDatabase(db as never);
  assert.deepEqual(
    (await s.planDatabaseSetup(db as never)).validatorsToApply,
    [],
  );
  for (const [name, docs] of old)
    if (name !== "schema_versions")
      assert.deepEqual(db.collection(name).documents, docs);
  const l = db.collection("schema_versions").documents.get("vapp-v1")!;
  assert.equal(
    (l.migrations as { version: number }[]).filter((m) => m.version === 20)
      .length,
    1,
  );
});
for (const fault of ["version", "ledger", "validator", "mode", "data"])
  test(`v20 fails closed before writes: ${fault}`, async () => {
    const db = await base();
    const l = db.collection("schema_versions").documents.get("vapp-v1")!;
    if (fault === "version") {
      l.version = 18;
      l.schemaVersion = 18;
    }
    if (fault === "ledger") l.migrations = [];
    if (fault === "validator")
      db.collection("reasoning_decisions").options.validator = {
        unreviewed: true,
      };
    if (fault === "mode")
      db.collection("reasoning_decisions").options.validationAction = "warn";
    if (fault === "data")
      db.collection("reasoning_decisions").validatorInvalidCount = 1;
    const mutations = db.mutationCount;
    await assert.rejects(
      createDatabaseSetup(releaseDatabaseTarget(20)).setupDatabase(db as never),
    );
    assert.equal(db.mutationCount, mutations);
  });
test("v20 interrupted predicate install retains ledger then retries exactly once", async () => {
  const db = await base(),
    command = db.command.bind(db);
  let count = 0;
  db.command = async (input) => {
    if (++count === 2) throw Error("synthetic interruption");
    await command(input);
  };
  const s = createDatabaseSetup(releaseDatabaseTarget(20));
  await assert.rejects(s.setupDatabase(db as never));
  assert.equal(
    db.collection("schema_versions").documents.get("vapp-v1")!.version,
    19,
  );
  db.command = command;
  await s.setupDatabase(db as never);
  assert.equal(
    db.collection("schema_versions").documents.get("vapp-v1")!.version,
    20,
  );
});
test("no generic Action writer exists; legacy tasks remain available without Action links", () => {
  for (const name of [
    "action_types",
    "action_definitions",
    "action_definition_revisions",
    "reasoning_decisions",
  ])
    assert.equal(name in CRM_SCHEMAS, false);
  assert.equal(
    crmPatchSchema("crm_tasks").safeParse({ title: "Legacy task" }).success,
    true,
  );
  assert.equal(
    crmPatchSchema("crm_tasks").safeParse({
      reasoning: { action: { revision: 1 } },
    }).success,
    false,
  );
});
