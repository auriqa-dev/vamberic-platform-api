import test from "node:test";
import assert from "node:assert/strict";
import { V15_VALIDATORS } from "../src/db/commercial-outcomes-v15";
import {
  parseCommercialV15,
  parseCommercialEventV15,
  type V15Collection,
} from "../src/domain/commercial-outcomes-v15";
import {
  commercialParityCases,
  commercialParityBaselines,
} from "./helpers/commercial-v15-parity";
import { agentMongoParity } from "./helpers/agent-mongo-parity";
import { updateCrmRecord } from "../src/services/crm-foundation";
import type { MongoService } from "../src/services/mongo";
for (const c of commercialParityCases.filter(
  (c) => c.applicationValid !== undefined,
))
  test(`v15 review application boundary: ${c.collection} ${c.name}`, () => {
    const { _id: ignored, ...row } = c.document;
    void ignored;
    const parse = () =>
      c.collection === "events"
        ? (() => {
            const { commercialTransaction, ...record } = row;
            return parseCommercialEventV15({ record, commercialTransaction });
          })()
        : parseCommercialV15(c.collection as V15Collection, row);
    if (c.applicationValid) assert.doesNotThrow(parse);
    else assert.throws(parse);
  });
for (const name of ["transactions", "subscriptions", "product_relationships"])
  test(`v15 legacy exclusion reserves commercial fields: ${name}`, () => {
    const guard = V15_VALIDATORS[name].$or[0];
    for (const key of [
      "commercialVersion",
      "offering",
      "provenance",
      "commercialKind",
      "originalTransaction",
      "subscription",
      "supersedes",
      "transactions",
    ])
      assert.deepEqual(guard[key], { $exists: false });
  });
test("legacy CRM update cannot mutate a workspace commercial relationship", async () => {
  const row = structuredClone(commercialParityBaselines.product_relationships);
  let writes = 0;
  const mongo = {
    withTransaction: async (fn: (db: unknown) => Promise<unknown>) =>
      fn({
        collection: () => ({
          findOne: async () => row,
          updateOne: async () => {
            writes++;
          },
        }),
      }),
  } as unknown as MongoService;
  await assert.rejects(
    updateCrmRecord(
      mongo,
      "product_relationships",
      row.id,
      row.updatedAt,
      { status: "customer" },
      { type: "human", id: "synthetic" },
    ),
    /Workspace operations/,
  );
  assert.equal(writes, 0);
});
test(
  "v15 proposed validators: read-only Mongo $documents boundary parity",
  { skip: process.env.COMMERCIAL_V15_MONGO_PARITY !== "1" },
  async () => {
    assert.notEqual(
      process.env.AGENT_INSTALLED_MONGO_PARITY,
      "1",
      "v15 is unapplied: proposed validators only",
    );
    await agentMongoParity(commercialParityCases, V15_VALIDATORS);
  },
);
test("current production setup rejects contradictory schema-version metadata before writes", async () => {
  const { FakeDb } = await import("./helpers/commercial-migration-db");
  const { setupDatabase: installV14 } = await import("./helpers/database-v14");
  const { setupDatabase } = await import("../src/db/setup");
  const fake = new FakeDb();
  const db = fake as unknown as import("mongodb").Db;
  await installV14(db);
  fake.collection("schema_versions").documents.get("vapp-v1")!.schemaVersion =
    11;
  const mutations = fake.mutationCount;
  await assert.rejects(setupDatabase(db), /Conflicting schema version fields/);
  assert.equal(fake.mutationCount, mutations);
});
