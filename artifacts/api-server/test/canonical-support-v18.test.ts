import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { FakeDb } from "./helpers/commercial-migration-db";
import { createDatabaseSetup, releaseDatabaseTarget } from "../src/db/setup";
import { CANONICAL_SUPPORT_INDEX } from "../src/db/canonical-support-v18";
import {
  SupportCertificateSchema,
  canonicalDigest,
} from "../src/domain/canonical-support";
const setup = createDatabaseSetup(releaseDatabaseTarget(18));
async function fixture() {
  const db = new FakeDb();
  await createDatabaseSetup(releaseDatabaseTarget(17)).setupDatabase(
    db as never,
  );
  return db;
}
test("v18 changes only events validator and one partial unique index; no backfill", async () => {
  const db = await fixture();
  const before = [...db.collections].map(
    ([name, c]) => [name, structuredClone(c.documents)] as const,
  );
  const mutations = db.mutationCount;
  const p = await setup.planDatabaseSetup(db as never);
  assert.equal(db.mutationCount, mutations);
  assert.equal(p.existingSchemaVersion, 17);
  assert.equal(p.schemaVersion, 18);
  assert.deepEqual(p.validatorConflicts, []);
  assert.deepEqual(p.collectionsToCreate, []);
  assert.deepEqual(p.validatorsToApply, ["events"]);
  assert.equal(p.indexesToCreate.length, 1);
  await setup.setupDatabase(db as never);
  await setup.setupDatabase(db as never);
  const done = await setup.planDatabaseSetup(db as never);
  assert.deepEqual(done.validatorsToApply, []);
  assert.deepEqual(done.indexesToCreate, []);
  assert.deepEqual(done.validatorConflicts, []);
  assert.deepEqual(
    db
      .collection("events")
      .indexes.find((i) => i.name === CANONICAL_SUPPORT_INDEX.name),
    CANONICAL_SUPPORT_INDEX,
  );
  for (const [name, documents] of before)
    if (name !== "schema_versions")
      assert.deepEqual(db.collection(name).documents, documents);
  const ledger = db.collection("schema_versions").documents.get("vapp-v1")!;
  assert.equal(
    (ledger.migrations as { version: number }[]).filter((m) => m.version === 18)
      .length,
    1,
  );
  for (const [name, v] of Object.entries(releaseDatabaseTarget(17).validators))
    if (name !== "events")
      assert.deepEqual(releaseDatabaseTarget(18).validators[name], v);
});
for (const fault of [
  "version",
  "ledger",
  "validator",
  "mode",
  "data",
  "index",
] as const)
  test(`v18 refuses ${fault} conflict without writes`, async () => {
    const db = await fixture();
    const ledger = db.collection("schema_versions").documents.get("vapp-v1")!;
    if (fault === "version") {
      ledger.version = 16;
      ledger.schemaVersion = 16;
    }
    if (fault === "ledger") ledger.migrations = [];
    if (fault === "validator")
      db.collection("events").options.validator = { unreviewed: true };
    if (fault === "mode")
      db.collection("events").options.validationAction = "warn";
    if (fault === "data") db.collection("events").validatorInvalidCount = 1;
    if (fault === "index")
      db.collection("events").indexes.push({
        ...CANONICAL_SUPPORT_INDEX,
        unique: false,
      });
    const mutations = db.mutationCount;
    await assert.rejects(setup.setupDatabase(db as never));
    assert.equal(db.mutationCount, mutations);
  });
test("v12–v17 target definitions retain exact pre-v18 hashes", () => {
  const expected = [
    "ba487b64505e2be74c9ae808f93edb82b4ffe22a4ca5605650b4f14552037871",
    "7dfc97a56fb8678cc810260784c784edccd9d7955296b83a5838d662944af631",
    "22361100e00aeffeee50cddb1a64b5898d8de7add0cdba19592c9f0003aec310",
    "190a533405ddc6f957ad13f19e9e31d6af2870d64229d8b5aa6907f3992ec2e2",
    "8196a9b0ee663dfd9249f2364b92b1d02dfbd81f464c76074a29d7390c817df6",
    "7f4d8cb2c3cd4fc9834e7cfad7285753c88a8ede2961ef7b2e8ef193380bd5e9",
  ];
  for (const [i, version] of ([12, 13, 14, 15, 16, 17] as const).entries()) {
    const { ordered, ...target } = releaseDatabaseTarget(version);
    void ordered;
    assert.equal(
      createHash("sha256").update(JSON.stringify(target)).digest("hex"),
      expected[i],
    );
  }
});
test("certificate schema rejects missing attribution and tampered digests", () => {
  assert.equal(
    SupportCertificateSchema.safeParse({
      kind: "canonical_support_certificate",
      digest: canonicalDigest({}),
    }).success,
    false,
  );
});

test("generic Event input cannot request the reserved certificate type", async () => {
  const { EventInsertSchema } = await import("../src/domain/schemas");
  const { createCrmRecord } = await import("../src/services/crm-foundation");
  const input = {
    eventType: "canonical_support_certified",
    occurredAt: new Date(),
    payload: {},
  };
  assert.equal(EventInsertSchema.safeParse(input).success, false);
  await assert.rejects(
    createCrmRecord({} as never, "events", input, {
      type: "system",
      id: "synthetic",
    }),
    /Reserved Platform approval event/,
  );
});

test("v18 interrupted validator update remains on v17 and safely resumes", async () => {
  const db = await fixture();
  const command = db.command.bind(db);
  db.command = async () => {
    throw new Error("synthetic interruption");
  };
  await assert.rejects(
    setup.setupDatabase(db as never),
    /synthetic interruption/,
  );
  assert.equal(
    db.collection("schema_versions").documents.get("vapp-v1")!.version,
    17,
  );
  db.command = command;
  await setup.setupDatabase(db as never);
  const done = await setup.planDatabaseSetup(db as never);
  assert.deepEqual(done.validatorConflicts, []);
  assert.deepEqual(done.indexesToCreate, []);
});
test("certificate graph never ignores external criterion freshness", async () => {
  const { collectSupportGraph } =
    await import("../src/services/canonical-support-graph");
  await assert.rejects(
    collectSupportGraph(
      {} as never,
      "workspace_synthetic",
      {} as never,
      [],
      undefined,
      [
        {
          id: "external",
          role: "consumed",
          purpose: "External criterion",
          source: {
            kind: "external",
            url: "https://example.invalid/criteria",
            contentHash: "0".repeat(64),
          },
          observedAt: "2030-01-01T00:00:00.000Z",
          fetchedAt: "2030-01-01T00:00:00.000Z",
        },
      ],
    ),
    /currentness is unproven/,
  );
});
