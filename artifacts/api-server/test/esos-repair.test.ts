import assert from "node:assert/strict";
import { test } from "node:test";
import { EnquiryMemoryDb } from "./helpers/enquiry-db";
import { generatePlatformId } from "../src/domain";
import {
  applyEsosRepair,
  rollbackEsosRepair,
  inspectEsosRepair,
  type RepairManifest,
} from "../src/services/icp/esos-repair";
import {
  checkRecovery,
  ESOS_RECOVERY_JOB,
  ESOS_RECOVERY_WORKSPACE,
  ESOS_SUPPORTING_SOURCE,
  recoveryComplete,
} from "../src/services/icp/esos-recovery";
function fixture() {
  const db = new EnquiryMemoryDb(),
    w = ESOS_RECOVERY_WORKSPACE,
    now = new Date("2026-10-07T12:00:00Z");
  const m: RepairManifest = {
    workspaceId: w,
    jobId: ESOS_RECOVERY_JOB,
    hashes: ["expected"],
    expected: [
      ["Main", "00000001", true],
      ["Support", "", false],
    ],
  };
  db.rows("crm_workspaces").push({
    id: w,
    kind: "client",
    archived: false,
    updatedAt: now,
  });
  db.rows("events").push({
    workspaceId: w,
    eventType: "hive_import_completed",
    payload: {
      jobId: m.jobId,
      importId: "import-1",
      batchIndex: 0,
      inputHash: "expected",
      verified: true,
    },
  });
  m.expected.forEach(([name, reg], i) => {
    const id = generatePlatformId("org");
    db.rows("organisations").push({
      id,
      workspaceId: w,
      name,
      archived: false,
      createdAt: now,
      updatedAt: now,
      source: {
        system: "hvm_hive_upload",
        reference: reg ? `GB:${reg}` : "import-1",
      },
    });
    db.rows("events").push({
      workspaceId: w,
      eventType: "hive_import_row",
      occurredAt: now,
      payload: {
        importId: "import-1",
        companyId: id,
        row: i + 1,
        status: "create",
        normalized: { company: name, ...(reg ? { registration: reg } : {}) },
      },
    });
  });
  return { db, m };
}
test("repair preserves main accounts and identities, gates restart, and restores exact organisation before-images", async () => {
  const { db, m } = fixture(),
    before = structuredClone(db.rows("organisations"));
  assert.equal(
    (await inspectEsosRepair(await db.mongo.database(), m)).supporting.length,
    1,
  );
  await checkRecovery(
    await db.mongo.database(),
    generatePlatformId("workspace"),
    { jobId: ESOS_RECOVERY_JOB },
  );
  await assert.rejects(
    checkRecovery(await db.mongo.database(), m.workspaceId, {
      jobId: ESOS_RECOVERY_JOB,
    }),
  );
  await assert.rejects(
    checkRecovery(await db.mongo.database(), m.workspaceId, {
      jobId: "new",
      replacesJobId: m.jobId,
    }),
  );
  assert.deepEqual(
    await db.mongo.withTransaction!((d, s) => applyEsosRepair(d, m, s)),
    { status: "completed", changed: 1 },
  );
  assert.deepEqual(db.rows("organisations")[0], before[0]);
  assert.equal(
    db.rows("organisations")[1]!.source.system,
    ESOS_SUPPORTING_SOURCE,
  );
  await checkRecovery(await db.mongo.database(), m.workspaceId, {
    jobId: "new",
    replacesJobId: m.jobId,
  });
  assert.equal(
    await recoveryComplete(
      await db.mongo.database(),
      generatePlatformId("workspace"),
      m.jobId,
    ),
    false,
  );
  await db.mongo.withTransaction!((d, s) => rollbackEsosRepair(d, m, s));
  assert.deepEqual(db.rows("organisations"), before);
  assert.equal(
    await recoveryComplete(await db.mongo.database(), m.workspaceId, m.jobId),
    false,
  );
});
test("changed data or audit-write failure aborts the entire repair", async () => {
  const { db, m } = fixture();
  db.rows("organisations")[1]!.name = "Edited";
  await assert.rejects(
    db.mongo.withTransaction!((d, s) => applyEsosRepair(d, m, s)),
  );
  assert.equal(
    db.rows("events").filter((e) => e.eventType === "hive_esos_reconciled")
      .length,
    0,
  );
  db.rows("organisations")[1]!.name = "Support";
  const before = structuredClone(db.rows("organisations"));
  db.failCollection = "events";
  await assert.rejects(
    db.mongo.withTransaction!((d, s) => applyEsosRepair(d, m, s)),
  );
  assert.deepEqual(db.rows("organisations"), before);
});
test("rollback refuses to overwrite subsequent edits", async () => {
  const { db, m } = fixture();
  await db.mongo.withTransaction!((d, s) => applyEsosRepair(d, m, s));
  db.rows("organisations")[1]!.updatedAt = new Date("2030-01-01");
  await assert.rejects(
    db.mongo.withTransaction!((d, s) => rollbackEsosRepair(d, m, s)),
  );
  assert.equal(
    db.rows("organisations")[1]!.source.system,
    ESOS_SUPPORTING_SOURCE,
  );
});
