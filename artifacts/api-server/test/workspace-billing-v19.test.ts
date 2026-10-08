import test from "node:test";
import assert from "node:assert/strict";
import {
  effectiveWorkspaceBilling,
  WorkspaceBillingExemptionSchema,
} from "../src/domain/workspace-billing";
import { releaseDatabaseTarget } from "../src/db/setup";
import frozen from "../src/db/frozen-v18-target.json";
const actor = {
  type: "human",
  issuer: "https://issuer.example",
  id: "empress",
};
const active = {
  version: 1,
  revision: 1,
  treatment: "internal",
  scope: "hvm_platform_and_agent_services",
  status: "active",
  reason: "Internal workspace",
  approvedBy: actor,
  approvedAt: new Date("2026-10-01"),
};
test("internal workspace zero-bills HVM services without erasing costs or granting authority", () => {
  const d = effectiveWorkspaceBilling(active, 12345);
  assert.equal(d.billedAmountMinor, 0);
  assert.equal(d.grossAmountMinor, 12345);
  assert.equal(d.executionAuthority, false);
  assert.equal(d.directThirdPartyChargesExcluded, true);
});
test("absent/revoked exemptions preserve existing terms", () => {
  assert.equal(
    effectiveWorkspaceBilling(undefined, 12345).billedAmountMinor,
    12345,
  );
  assert.equal(
    effectiveWorkspaceBilling(
      {
        ...active,
        status: "revoked",
        revision: 2,
        revokedBy: actor,
        revokedAt: new Date("2026-10-02"),
        revocationReason: "Ended",
      },
      12345,
    ).billedAmountMinor,
    12345,
  );
});
test("malformed or widened exemptions fail closed", () => {
  for (const bad of [
    { ...active, scope: "all_third_parties" },
    { ...active, executionAuthority: true },
    { ...active, status: "revoked" },
  ])
    assert.equal(WorkspaceBillingExemptionSchema.safeParse(bad).success, false);
});
test("v19 preserves exact v18 target and changes one validator only", () => {
  assert.deepEqual(releaseDatabaseTarget(18), frozen);
  const next = releaseDatabaseTarget(19);
  assert.equal(next.version, 19);
  assert.deepEqual(next.collections, frozen.collections);
  assert.deepEqual(
    Object.keys(next.validators).filter(
      (k) =>
        JSON.stringify(next.validators[k]) !==
        JSON.stringify((frozen.validators as Record<string, unknown>)[k]),
    ),
    ["crm_workspaces"],
  );
});

import { FakeDb } from "./helpers/commercial-migration-db";
import { createDatabaseSetup } from "../src/db/setup";
test("v18 to v19 plans one validator, no backfill, and is idempotent", async () => {
  const db = new FakeDb();
  // Synthetic historical setup only. No Mongo connection exists in this helper.
  await createDatabaseSetup(releaseDatabaseTarget(17)).setupDatabase(
    db as never,
  );
  await createDatabaseSetup(releaseDatabaseTarget(18)).setupDatabase(
    db as never,
  );
  const before = [...db.collections].map(
    ([name, c]) => [name, structuredClone(c.documents)] as const,
  );
  const setup = createDatabaseSetup(releaseDatabaseTarget(19)),
    mutations = db.mutationCount;
  const plan = await setup.planDatabaseSetup(db as never);
  assert.equal(db.mutationCount, mutations);
  assert.equal(plan.existingSchemaVersion, 18);
  assert.equal(plan.schemaVersion, 19);
  assert.deepEqual(plan.collectionsToCreate, []);
  assert.deepEqual(plan.indexesToCreate, []);
  assert.deepEqual(plan.validatorsToApply, ["crm_workspaces"]);
  assert.deepEqual(plan.validatorConflicts, []);
  await setup.setupDatabase(db as never);
  await setup.setupDatabase(db as never);
  const done = await setup.planDatabaseSetup(db as never);
  assert.deepEqual(done.validatorsToApply, []);
  assert.deepEqual(done.validatorConflicts, []);
  for (const [name, documents] of before)
    if (name !== "schema_versions")
      assert.deepEqual(db.collection(name).documents, documents);
  const ledger = db.collection("schema_versions").documents.get("vapp-v1")!;
  assert.equal(
    (ledger.migrations as { version: number }[]).filter((m) => m.version === 19)
      .length,
    1,
  );
});
for (const fault of ["version", "ledger", "validator", "mode", "data"] as const)
  test(`v19 rejects ${fault} without writes`, async () => {
    const db = new FakeDb();
    await createDatabaseSetup(releaseDatabaseTarget(17)).setupDatabase(
      db as never,
    );
    await createDatabaseSetup(releaseDatabaseTarget(18)).setupDatabase(
      db as never,
    );
    const ledger = db.collection("schema_versions").documents.get("vapp-v1")!;
    if (fault === "version") {
      ledger.version = 17;
      ledger.schemaVersion = 17;
    }
    if (fault === "ledger") ledger.migrations = [];
    if (fault === "validator")
      db.collection("crm_workspaces").options.validator = { unreviewed: true };
    if (fault === "mode")
      db.collection("crm_workspaces").options.validationAction = "warn";
    if (fault === "data")
      db.collection("crm_workspaces").validatorInvalidCount = 1;
    const before = db.mutationCount;
    await assert.rejects(
      createDatabaseSetup(releaseDatabaseTarget(19)).setupDatabase(db as never),
    );
    assert.equal(db.mutationCount, before);
  });
