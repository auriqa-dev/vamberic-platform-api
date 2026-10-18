import assert from "node:assert/strict";
import { test } from "node:test";
import { createDatabaseSetup, releaseDatabaseTarget } from "../src/db/setup";
test("v24 only makes historical onboarding expiry optional and preserves frozen v23", () => {
  const old = releaseDatabaseTarget(23),
    next = releaseDatabaseTarget(24);
  assert.deepEqual(next.collections, old.collections);
  const expected = structuredClone(old.validators);
  const approval = expected.client_onboardings!.$jsonSchema.properties.approval;
  assert.ok(approval.required.includes("validUntil"));
  approval.required = approval.required.filter(
    (key: string) => key !== "validUntil",
  );
  assert.deepEqual(next.validators, expected);
  assert.ok(
    old.validators.client_onboardings!.$jsonSchema.properties.approval.required.includes(
      "validUntil",
    ),
  );
});

import { FakeDb } from "./helpers/commercial-migration-db";
test("v23 to v24 preflight, apply and replay preserve data and need only the onboarding validator", async () => {
 const db = new FakeDb();
 for (let v = 12; v <= 23; v++) await createDatabaseSetup({ ...releaseDatabaseTarget(v as 23), ordered: v !== 12 }).setupDatabase(db as never);
 const setup = createDatabaseSetup(releaseDatabaseTarget(24));
 const plan = await setup.planDatabaseSetup(db as never);
 assert.deepEqual(plan.validatorConflicts, []);
 assert.deepEqual(plan.validatorsToApply, ["client_onboardings"]);
 assert.deepEqual(plan.collectionsToCreate, []);
 assert.deepEqual(plan.indexesToCreate, []);
 await setup.setupDatabase(db as never);
 const after = await setup.planDatabaseSetup(db as never);
 assert.equal(after.existingSchemaVersion, 24);
 assert.deepEqual(after.validatorsToApply, []);
 await setup.setupDatabase(db as never);
});
