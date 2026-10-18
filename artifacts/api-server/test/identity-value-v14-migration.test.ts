import test from "node:test";
import assert from "node:assert/strict";
import type { Db } from "mongodb";
import {
  setupDatabase,
  planDatabaseSetup,
  IncompatibleDatabaseSchemaError,
} from "./helpers/database-v14";
import {
  V14_NEW_COLLECTIONS,
  V14_PREDECESSORS,
  IDENTITY_VALUE_V14_MIGRATION_ID,
} from "../src/db/identity-value-v14";
class FakeCollection {
  readonly documents = new Map<string, Record<string, unknown>>();
  indexes: Record<string, unknown>[] = [{ name: "_id_", key: { _id: 1 } }];
  aggregateResults: Record<string, unknown>[] = [];
  mutationCount = 0;

  listIndexes() {
    return { toArray: async () => this.indexes };
  }

  async createIndexes(indexes: Record<string, unknown>[]) {
    this.mutationCount += 1;
    this.indexes.push(...indexes);
    return indexes.map((index) => index.name as string);
  }

  validatorInvalidCount = 0;
  options: Record<string, unknown> = {};
  async countDocuments(filter?: Record<string, unknown>) {
    if (filter?.$nor) return this.validatorInvalidCount;
    return this.documents.size;
  }

  aggregate() {
    return { toArray: async () => this.aggregateResults };
  }

  async findOne() {
    return this.documents.get("vapp-v1") ?? null;
  }

  async insertOne(document: Record<string, unknown>) {
    this.mutationCount += 1;
    this.documents.set("vapp-v1", document);
  }

  async updateOne(_filter: unknown, update: { $set: Record<string, unknown> }) {
    this.mutationCount += 1;
    const existing = this.documents.get("vapp-v1");
    this.documents.set("vapp-v1", {
      ...existing,
      ...update.$set,
    });
    return { matchedCount: 1 };
  }
}

class FakeDb {
  readonly collections = new Map<string, FakeCollection>();
  mutationCount = 0;

  listCollections() {
    return {
      toArray: async () =>
        [...this.collections].map(([name, collection]) => ({
          name,
          options: collection.options,
        })),
    };
  }

  async command(input: Record<string, unknown>) {
    this.mutationCount++;
    this.collection(input.collMod as string).options = {
      validator: input.validator,
      validationLevel: input.validationLevel,
      validationAction: input.validationAction,
    };
  }

  async createCollection(name: string, options: Record<string, unknown> = {}) {
    this.mutationCount += 1;
    const collection = new FakeCollection();
    collection.options = options;
    this.collections.set(name, collection);
    return collection;
  }

  collection(name: string) {
    let collection = this.collections.get(name);
    if (!collection) {
      collection = new FakeCollection();
      this.collections.set(name, collection);
    }
    return collection;
  }
}

async function installedV13() {
  const fake = new FakeDb();
  const db = fake as unknown as Db;
  await setupDatabase(db);
  for (const name of V14_NEW_COLLECTIONS) fake.collections.delete(name);
  for (const [name, validator] of Object.entries(V14_PREDECESSORS))
    fake.collection(name).options.validator = structuredClone(validator);
  fake.collection("events").indexes = fake
    .collection("events")
    .indexes.filter((i) => i.name !== "workspace_identity_occurred");
  const ledger = fake.collection("schema_versions").documents.get("vapp-v1")!;
  ledger.version = ledger.schemaVersion = 13;
  ledger.migrations = (ledger.migrations as { version: number }[]).filter(
    (m) => m.version <= 13,
  );
  fake.collection("events").documents.set("old", {
    id: "event-historical",
    eventType: "anonymous_visit",
  });
  return { fake, db, ledger };
}
test("v14 exact plan: 13 → 14, three collections, ten indexes, six validators, no backfill", async () => {
  const { fake, db, ledger } = await installedV13();
  const history = structuredClone(ledger.migrations);
  const retained = [...fake.collections]
    .filter(([n]) => n !== "schema_versions")
    .map(([n, c]) => [n, structuredClone(c.documents)] as const);
  const before = fake.mutationCount;
  const plan = await planDatabaseSetup(db);
  assert.equal(fake.mutationCount, before);
  assert.equal(plan.existingSchemaVersion, 13);
  assert.equal(plan.schemaVersion, 14);
  assert.deepEqual(
    plan.collectionsToCreate.sort(),
    [...V14_NEW_COLLECTIONS].sort(),
  );
  assert.equal(plan.indexesToCreate.length, 10);
  assert.deepEqual(
    plan.validatorsToApply.sort(),
    [...V14_NEW_COLLECTIONS, ...Object.keys(V14_PREDECESSORS)].sort(),
  );
  assert.deepEqual(plan.validatorConflicts, []);
  await setupDatabase(db);
  const applied = fake.collection("schema_versions").documents.get("vapp-v1")!;
  assert.deepEqual((applied.migrations as unknown[]).slice(0, 13), history);
  assert.equal(
    (applied.migrations as { id: string }[]).at(-1)!.id,
    IDENTITY_VALUE_V14_MIGRATION_ID,
  );
  assert.equal(applied.version, 14);
  for (const [name, documents] of retained)
    assert.deepEqual(fake.collection(name).documents, documents);
  for (const name of V14_NEW_COLLECTIONS)
    assert.equal(fake.collection(name).documents.size, 0);
  const after = fake.mutationCount;
  await setupDatabase(db);
  assert.equal(fake.mutationCount, after);
  const done = await planDatabaseSetup(db);
  assert.deepEqual(done.validatorsToApply, []);
  assert.deepEqual(done.indexesToCreate, []);
});
for (const mode of ["unknown", "weak", "invalid"] as const)
  test(`v14 rejects ${mode} v13 predecessor without writes`, async () => {
    const { fake, db } = await installedV13();
    const c = fake.collection("reasoning_contexts");
    if (mode === "unknown")
      c.options.validator = { $jsonSchema: { bsonType: "object" } };
    if (mode === "weak") c.options.validationAction = "warn";
    if (mode === "invalid") c.validatorInvalidCount = 1;
    const before = fake.mutationCount;
    await assert.rejects(setupDatabase(db), IncompatibleDatabaseSchemaError);
    assert.equal(fake.mutationCount, before);
  });
test("v14 interruption preserves v13 ledger and resumes once", async () => {
  const { fake, db } = await installedV13();
  const original = fake.command.bind(fake);
  let n = 0;
  fake.command = async (input) => {
    if (++n === 2) throw new Error("interrupted v14");
    return original(input);
  };
  await assert.rejects(setupDatabase(db), /interrupted v14/);
  assert.equal(
    fake.collection("schema_versions").documents.get("vapp-v1")!.version,
    13,
  );
  fake.command = original;
  await setupDatabase(db);
  await setupDatabase(db);
  const ledger = fake.collection("schema_versions").documents.get("vapp-v1")!;
  assert.equal(
    (ledger.migrations as { version: number }[]).filter((m) => m.version === 14)
      .length,
    1,
  );
});
