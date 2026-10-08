import assert from "node:assert/strict";
import { test } from "node:test";
import { createDatabaseSetup, releaseDatabaseTarget } from "../src/db/setup";
import { CLIENT_ONBOARDING_VALIDATOR } from "../src/db/client-onboarding-v21";
import { FakeDb } from "./helpers/commercial-migration-db";
async function base() {
  const db = new FakeDb();
  await createDatabaseSetup(releaseDatabaseTarget(20)).setupDatabase(
    db as never,
  );
  return db;
}
test("v21 adds only one collection and its three indexes/validator; every v20 validator is unchanged", () => {
  const a = releaseDatabaseTarget(20),
    b = releaseDatabaseTarget(21);
  assert.deepEqual(b.collections.slice(0, -1), a.collections);
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(b.validators).filter(([k]) => k !== "client_onboardings"),
    ),
    a.validators,
  );
  assert.deepEqual(
    b.validators.client_onboardings,
    CLIENT_ONBOARDING_VALIDATOR,
  );
});
test("v20 to v21 synthetic dry-run is read-only, no backfill, idempotent ordered migration", async () => {
  const db = await base(),
    s = createDatabaseSetup(releaseDatabaseTarget(21));
  const before = db.mutationCount;
  const data = [...db.collections]
    .filter(([n]) => n !== "schema_versions")
    .map(([n, c]) => [n, structuredClone(c.documents)] as const);
  const plan = await s.planDatabaseSetup(db as never);
  assert.equal(db.mutationCount, before);
  assert.deepEqual(plan.collectionsToCreate, ["client_onboardings"]);
  assert.equal(plan.indexesToCreate.length, 3);
  assert.deepEqual(plan.validatorsToApply, ["client_onboardings"]);
  assert.deepEqual(plan.validatorConflicts, []);
  await s.setupDatabase(db as never);
  await s.setupDatabase(db as never);
  assert.equal(db.collection("client_onboardings").documents.size, 0);
  for (const [name, rows] of data)
    assert.deepEqual(db.collection(name).documents, rows);
  const ledger = db.collection("schema_versions").documents.get("vapp-v1")!;
  assert.equal(ledger.version, 21);
  assert.equal(
    (ledger.migrations as { version: number }[]).filter((m) => m.version === 21)
      .length,
    1,
  );
  assert.deepEqual(
    (await s.planDatabaseSetup(db as never)).validatorsToApply,
    [],
  );
});
for (const fault of ["version", "ledger", "validator", "mode", "data"])
  test(`v21 rejects ${fault} without writes`, async () => {
    const db = await base(),
      ledger = db.collection("schema_versions").documents.get("vapp-v1")!;
    if (fault === "version") {
      ledger.version = 19;
      ledger.schemaVersion = 19;
    }
    if (fault === "ledger") ledger.migrations = [];
    if (fault === "validator")
      db.collection("crm_workspaces").options.validator = { unknown: true };
    if (fault === "mode")
      db.collection("crm_workspaces").options.validationAction = "warn";
    if (fault === "data")
      db.collection("crm_workspaces").validatorInvalidCount = 1;
    const before = db.mutationCount;
    await assert.rejects(
      createDatabaseSetup(releaseDatabaseTarget(21)).setupDatabase(db as never),
    );
    assert.equal(db.mutationCount, before);
  });
test("v21 Mongo numeric bounds include revision one and exclude zero/unsafe/fractional values", () => {
  const s = CLIENT_ONBOARDING_VALIDATOR.$jsonSchema.properties.revision;
  assert.equal(s.minimum, 0);
  assert.equal(s.exclusiveMinimum, true);
  assert.equal(s.maximum, Number.MAX_SAFE_INTEGER);
  assert.equal(s.multipleOf, 1);
});
