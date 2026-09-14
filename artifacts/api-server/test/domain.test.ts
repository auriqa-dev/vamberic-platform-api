import assert from "node:assert/strict";
import { test } from "node:test";
import type { Db } from "mongodb";
import {
  CampaignSchema,
  ContactPointSchema,
  EntitlementSchema,
  EntitlementInsertSchema,
  EventSchema,
  ImportSchema,
  MarketingPermissionSchema,
  MarketingPermissionInsertSchema,
  OpportunitySchema,
  OrganisationRelationshipSchema,
  OrganisationSchema,
  PersonSchema,
  ProductRelationshipSchema,
  ProductRelationshipInsertSchema,
  ProductRelationshipTargetIntegritySchema,
  ProductSchema,
  SubscriptionSchema,
  SubscriptionInsertSchema,
  TransactionSchema,
  TransactionInsertSchema,
} from "../src/domain/schemas";
import {
  COLLECTION_DEFINITIONS,
  COLLECTION_NAMES,
  SCHEMA_VERSIONS_COLLECTION,
  getDomainCollections,
} from "../src/db/collections";
import {
  IncompatibleDatabaseSchemaError,
  setupDatabase,
} from "../src/db/setup";

const dates = {
  createdAt: new Date("2025-01-01T00:00:00.000Z"),
  updatedAt: new Date("2025-01-01T00:00:00.000Z"),
};
const base = { id: "record_01", ...dates };

test("all fourteen collection schemas accept representative records", () => {
  const records = [
    ProductSchema.parse({
      ...base,
      name: "Energy Health Check",
      slug: "energy-health-check",
      status: "active",
      productType: "assessment",
      commercialModel: "one-off",
    }),
    PersonSchema.parse({ ...base, firstName: "Ada", lastName: "Lovelace" }),
    ContactPointSchema.parse({
      ...base,
      personId: "person_01",
      type: "email",
      value: "Ada@example.com",
      normalizedValue: "ada@example.com",
    }),
    OrganisationSchema.parse({
      ...base,
      name: "Example Ltd",
      type: "prospect",
    }),
    OrganisationRelationshipSchema.parse({
      ...base,
      personId: "person_01",
      organisationId: "org_01",
      current: true,
    }),
    ProductRelationshipSchema.parse({
      ...base,
      productId: "product_01",
      personId: "person_01",
      status: "engaged",
    }),
    MarketingPermissionSchema.parse({
      ...base,
      personId: "person_01",
      productId: "product_01",
      channel: "email",
      purpose: "marketing",
      lawfulBasis: "consent",
      permitted: true,
      grantedAt: dates.createdAt,
    }),
    OpportunitySchema.parse({
      ...base,
      productId: "product_01",
      organisationId: "org_01",
      name: "Example opportunity",
      stage: "discovery",
      status: "open",
    }),
    SubscriptionSchema.parse({
      ...base,
      productId: "product_01",
      customerReference: "customer_01",
      provider: "billing-provider",
      plan: "standard",
      status: "active",
      currency: "GBP",
      recurringAmount: 10,
      billingInterval: "month",
      startedAt: dates.createdAt,
    }),
    EntitlementSchema.parse({
      ...base,
      productId: "product_01",
      customerReference: "customer_01",
      entitlementType: "one_off",
      activeFrom: dates.createdAt,
      status: "active",
    }),
    CampaignSchema.parse({
      ...base,
      productId: "product_01",
      name: "Launch",
      type: "outbound",
      channel: "email",
      status: "draft",
    }),
    ImportSchema.parse({
      ...base,
      provider: "csv",
      importedAt: dates.createdAt,
      rowCounts: {
        total: 1,
        created: 1,
        updated: 0,
        duplicate: 0,
        rejected: 0,
      },
      status: "completed",
    }),
    EventSchema.parse({
      ...base,
      eventType: "contact.created",
      occurredAt: dates.createdAt,
    }),
    TransactionSchema.parse({
      ...base,
      productId: "product_01",
      customerReference: "customer_01",
      provider: "billing-provider",
      type: "purchase",
      grossAmount: 12,
      currency: "GBP",
      transactedAt: dates.createdAt,
      status: "completed",
    }),
  ];
  assert.equal(records.length, 14);
});

test("application IDs and relationship targets are validated", () => {
  assert.throws(
    () =>
      ProductSchema.parse({
        ...base,
        id: "Not A Valid ID",
        name: "Product",
        slug: "product",
        status: "idea",
        productType: "assessment",
        commercialModel: "one-off",
      }),
    /lowercase application ID/,
  );
  assert.equal(
    ProductSchema.safeParse({
      ...base,
      id: "UPPERCASE",
      name: "Product",
      slug: "product",
      status: "idea",
      productType: "assessment",
      commercialModel: "one-off",
    }).success,
    false,
  );
  assert.equal(
    ProductRelationshipTargetIntegritySchema.safeParse({}).success,
    false,
  );
  assert.equal(
    ProductRelationshipSchema.safeParse({
      ...base,
      productId: "product_01",
      status: "engaged",
    }).success,
    false,
  );
  assert.equal(
    SubscriptionSchema.safeParse({
      ...base,
      productId: "product_01",
      provider: "billing-provider",
      plan: "standard",
      status: "active",
      currency: "GBP",
      recurringAmount: 10,
      billingInterval: "month",
      startedAt: dates.createdAt,
    }).success,
    false,
  );
  assert.equal(
    TransactionSchema.safeParse({
      ...base,
      productId: "product_01",
      provider: "billing-provider",
      type: "purchase",
      grossAmount: 12,
      currency: "GBP",
      transactedAt: dates.createdAt,
      status: "completed",
    }).success,
    false,
  );
});

test("collection definitions cover exactly the fourteen domain collections", () => {
  assert.deepEqual(
    COLLECTION_DEFINITIONS.map((definition) => definition.name),
    [...COLLECTION_NAMES],
  );
  for (const definition of COLLECTION_DEFINITIONS) {
    assert.ok(definition.indexes.some((index) => index.name === "id_unique"));
  }
});

test("typed collection access exposes every domain collection", () => {
  const db = new FakeDb();
  const collections = getDomainCollections(db as unknown as Db);
  assert.deepEqual(Object.keys(collections), [...COLLECTION_NAMES]);
  assert.equal(collections.products, db.collection("products"));
  assert.equal(collections.events, db.collection("events"));
});

test("insert schemas preserve relationship and customer target integrity", () => {
  const insertBase = { id: "record_01" };
  assert.equal(
    ProductRelationshipInsertSchema.safeParse({
      ...insertBase,
      productId: "product_01",
      status: "engaged",
    }).success,
    false,
  );
  assert.equal(
    MarketingPermissionInsertSchema.safeParse({
      ...insertBase,
      channel: "email",
      purpose: "marketing",
      lawfulBasis: "consent",
      permitted: true,
      grantedAt: new Date(),
    }).success,
    false,
  );
  assert.equal(
    SubscriptionInsertSchema.safeParse({
      ...insertBase,
      productId: "product_01",
      provider: "provider",
      plan: "standard",
      status: "active",
      currency: "GBP",
      recurringAmount: 10,
      billingInterval: "month",
      startedAt: new Date(),
    }).success,
    false,
  );
  assert.equal(
    EntitlementInsertSchema.safeParse({
      ...insertBase,
      productId: "product_01",
      entitlementType: "one_off",
      activeFrom: new Date(),
      status: "active",
    }).success,
    false,
  );
  assert.equal(
    TransactionInsertSchema.safeParse({
      ...insertBase,
      productId: "product_01",
      provider: "provider",
      type: "purchase",
      grossAmount: 10,
      currency: "GBP",
      transactedAt: new Date(),
      status: "completed",
    }).success,
    false,
  );
});

class FakeCollection {
  readonly documents = new Map<string, Record<string, unknown>>();
  indexes: Record<string, unknown>[] = [{ name: "_id_", key: { _id: 1 } }];

  listIndexes() {
    return { toArray: async () => this.indexes };
  }

  async createIndexes(indexes: Record<string, unknown>[]) {
    this.indexes.push(...indexes);
    return indexes.map((index) => index.name as string);
  }

  async findOne() {
    return this.documents.get("vapp-v1") ?? null;
  }

  async insertOne(document: Record<string, unknown>) {
    this.documents.set("vapp-v1", document);
  }

  async updateOne(_filter: unknown, update: { $set: Record<string, unknown> }) {
    const existing = this.documents.get("vapp-v1");
    this.documents.set("vapp-v1", {
      ...existing,
      ...update.$set,
    });
  }
}

class FakeDb {
  readonly collections = new Map<string, FakeCollection>();

  listCollections() {
    return {
      toArray: async () =>
        [...this.collections.keys()].map((name) => ({ name })),
    };
  }

  async createCollection(name: string) {
    const collection = new FakeCollection();
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

test("database setup is repeatable and preserves existing documents", async () => {
  const db = new FakeDb();
  const first = await setupDatabase(db as unknown as Db);
  const products = db.collection("products");
  products.documents.set("business-record", {
    id: "business-record",
    name: "keep",
  });
  const second = await setupDatabase(db as unknown as Db);

  assert.equal(first.createdCollections.length, 15);
  assert.equal(second.createdCollections.length, 0);
  assert.equal(second.createdIndexes.length, 0);
  assert.deepEqual(products.documents.get("business-record"), {
    id: "business-record",
    name: "keep",
  });
  assert.ok(db.collections.has(SCHEMA_VERSIONS_COLLECTION));
});

test("newer schema versions fail before domain collection mutation", async () => {
  const db = new FakeDb();
  const versions = await db.createCollection(SCHEMA_VERSIONS_COLLECTION);
  versions.documents.set("vapp-v1", {
    _id: "vapp-v1",
    version: 99,
  });

  await assert.rejects(
    setupDatabase(db as unknown as Db),
    IncompatibleDatabaseSchemaError,
  );
  assert.deepEqual([...db.collections.keys()], [SCHEMA_VERSIONS_COLLECTION]);
});

test("setup refuses incompatible index definitions without dropping data", async () => {
  const db = new FakeDb();
  await setupDatabase(db as unknown as Db);
  const products = db.collection("products");
  products.documents.set("business-record", { id: "business-record" });
  products.indexes = products.indexes.map((index) =>
    index.name === "slug_unique" ? { ...index, key: { name: 1 } } : index,
  );

  await assert.rejects(
    setupDatabase(db as unknown as Db),
    IncompatibleDatabaseSchemaError,
  );
  assert.deepEqual(products.documents.get("business-record"), {
    id: "business-record",
  });
});
