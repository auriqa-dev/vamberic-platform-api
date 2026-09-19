import assert from "node:assert/strict";
import { test } from "node:test";
import type { Db } from "mongodb";
import * as domainSchemas from "../src/domain/schemas";
import {
  CampaignSchema,
  ContactPointSchema,
  ContactPointUpdateSchema,
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
  TransactionUpdateSchema,
  assertTransactionStatusTransition,
  canTransitionTransactionStatus,
  generatePlatformId,
  isPlatformId,
  normalizeContactValue,
  resolveEffectiveMarketingPermission,
} from "../src/domain/schemas";
import {
  COLLECTION_DEFINITIONS,
  COLLECTION_NAMES,
  SCHEMA_VERSIONS_COLLECTION,
  getDomainCollections,
  DATABASE_MIGRATION_ID,
} from "../src/db/collections";
import {
  IncompatibleDatabaseSchemaError,
  planDatabaseSetup,
  setupDatabase,
} from "../src/db/setup";
import {
  main,
  parseSetupMode,
  runDatabaseSetup,
} from "../src/commands/db-setup";

const dates = {
  createdAt: new Date("2025-01-01T00:00:00.000Z"),
  updatedAt: new Date("2025-01-01T00:00:00.000Z"),
};
const ids = {
  product: "product_00000000000000000000000000",
  person: "person_00000000000000000000000000",
  contact: "contact_00000000000000000000000000",
  org: "org_00000000000000000000000000",
  orgrel: "orgrel_00000000000000000000000000",
  prodrel: "prodrel_00000000000000000000000000",
  permission: "permission_00000000000000000000000000",
  opportunity: "opportunity_00000000000000000000000000",
  subscription: "subscription_00000000000000000000000000",
  entitlement: "entitlement_00000000000000000000000000",
  campaign: "campaign_00000000000000000000000000",
  import: "import_00000000000000000000000000",
  event: "event_00000000000000000000000000",
  transaction: "transaction_00000000000000000000000000",
};
const base = { ...dates };

test("all fourteen collection schemas accept representative records", () => {
  const records = [
    ProductSchema.parse({
      ...base,
      id: ids.product,
      name: "Energy Health Check",
      slug: "energy-health-check",
      lifecycleStatus: "live",
      productType: "service",
      businessModel: "transactional",
    }),
    PersonSchema.parse({
      ...base,
      id: ids.person,
      firstName: "Ada",
      lastName: "Lovelace",
    }),
    ContactPointSchema.parse({
      ...base,
      id: ids.contact,
      personId: ids.person,
      type: "email",
      value: "Ada@example.com",
      normalizedValue: "ada@example.com",
    }),
    OrganisationSchema.parse({
      ...base,
      id: ids.org,
      name: "Example Ltd",
      type: "prospect",
    }),
    OrganisationRelationshipSchema.parse({
      ...base,
      id: ids.orgrel,
      personId: ids.person,
      organisationId: ids.org,
      current: true,
    }),
    ProductRelationshipSchema.parse({
      ...base,
      id: ids.prodrel,
      productId: ids.product,
      personId: ids.person,
      status: "engaged",
    }),
    MarketingPermissionSchema.parse({
      ...base,
      id: ids.permission,
      personId: ids.person,
      productId: ids.product,
      channel: "email",
      purpose: "marketing",
      lawfulBasis: "consent",
      permitted: true,
      effectiveAt: dates.createdAt,
    }),
    OpportunitySchema.parse({
      ...base,
      id: ids.opportunity,
      productId: ids.product,
      organisationId: ids.org,
      name: "Example opportunity",
      stage: "discovery",
      status: "open",
    }),
    SubscriptionSchema.parse({
      ...base,
      id: ids.subscription,
      productId: ids.product,
      personId: ids.person,
      provider: "billing-provider",
      plan: "standard",
      status: "active",
      currency: "GBP",
      recurringAmountMinor: 1000,
      billingInterval: "month",
      startedAt: dates.createdAt,
    }),
    EntitlementSchema.parse({
      ...base,
      id: ids.entitlement,
      productId: ids.product,
      personId: ids.person,
      entitlementType: "one_off",
      activeFrom: dates.createdAt,
      status: "active",
    }),
    CampaignSchema.parse({
      ...base,
      id: ids.campaign,
      productId: ids.product,
      name: "Launch",
      type: "outbound",
      channel: "email",
      status: "draft",
    }),
    ImportSchema.parse({
      ...base,
      id: ids.import,
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
      id: ids.event,
      eventType: "contact.created",
      occurredAt: dates.createdAt,
    }),
    TransactionSchema.parse({
      ...base,
      id: ids.transaction,
      productId: ids.product,
      personId: ids.person,
      provider: "billing-provider",
      type: "purchase",
      grossAmountMinor: 1200,
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
        lifecycleStatus: "idea",
        productType: "service",
        businessModel: "transactional",
      }),
    /product platform ID/,
  );
  assert.equal(
    ProductSchema.safeParse({
      ...base,
      id: "UPPERCASE",
      name: "Product",
      slug: "product",
      lifecycleStatus: "idea",
      productType: "service",
      businessModel: "transactional",
    }).success,
    false,
  );
  assert.equal(
    ProductRelationshipTargetIntegritySchema.safeParse({}).success,
    false,
  );
  assert.equal(
    PersonSchema.safeParse({
      ...base,
      id: ids.product,
      firstName: "Wrong",
      lastName: "Prefix",
    }).success,
    false,
  );
  assert.equal(
    ProductRelationshipSchema.safeParse({
      ...base,
      id: ids.prodrel,
      productId: ids.product,
      status: "engaged",
    }).success,
    false,
  );
  assert.equal(
    SubscriptionSchema.safeParse({
      ...base,
      id: ids.subscription,
      productId: ids.product,
      provider: "billing-provider",
      plan: "standard",
      status: "active",
      currency: "GBP",
      recurringAmountMinor: 1000,
      billingInterval: "month",
      startedAt: dates.createdAt,
    }).success,
    false,
  );
  assert.equal(
    TransactionSchema.safeParse({
      ...base,
      id: ids.transaction,
      productId: ids.product,
      provider: "billing-provider",
      type: "purchase",
      grossAmountMinor: 1200,
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
  assert.equal(
    ProductRelationshipInsertSchema.safeParse({
      id: ids.prodrel,
      productId: ids.product,
      status: "engaged",
    }).success,
    false,
  );
  assert.equal(
    MarketingPermissionInsertSchema.safeParse({
      id: ids.permission,
      channel: "email",
      purpose: "marketing",
      lawfulBasis: "consent",
      permitted: true,
      effectiveAt: new Date(),
    }).success,
    false,
  );
  assert.equal(
    SubscriptionInsertSchema.safeParse({
      id: ids.subscription,
      productId: ids.product,
      provider: "provider",
      plan: "standard",
      status: "active",
      currency: "GBP",
      recurringAmountMinor: 1000,
      billingInterval: "month",
      startedAt: new Date(),
    }).success,
    false,
  );
  assert.equal(
    EntitlementInsertSchema.safeParse({
      id: ids.entitlement,
      productId: ids.product,
      entitlementType: "one_off",
      activeFrom: new Date(),
      status: "active",
    }).success,
    false,
  );
  assert.equal(
    TransactionInsertSchema.safeParse({
      id: ids.transaction,
      productId: ids.product,
      provider: "provider",
      type: "purchase",
      grossAmountMinor: 1000,
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

  async countDocuments() {
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
  }
}

class FakeDb {
  readonly collections = new Map<string, FakeCollection>();
  mutationCount = 0;

  listCollections() {
    return {
      toArray: async () =>
        [...this.collections.keys()].map((name) => ({ name })),
    };
  }

  async createCollection(name: string) {
    this.mutationCount += 1;
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
  const plan = await planDatabaseSetup(db as unknown as Db);
  assert.equal(plan.existingSchemaVersion, 99);
  assert.equal(plan.compatibility, "newer-incompatible");
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

test("Platform API IDs are prefixed lowercase ULIDs", () => {
  const first = generatePlatformId("product");
  const second = generatePlatformId("product");
  assert.match(first, /^product_[0-9abcdefghjkmnpqrstvwxyz]{26}$/);
  assert.equal(isPlatformId(first, "product"), true);
  assert.equal(isPlatformId(first, "person"), false);
  assert.notEqual(first, second);
});

test("money uses non-negative integer minor units and links refunds", () => {
  const valid = TransactionSchema.safeParse({
    ...base,
    id: ids.transaction,
    productId: ids.product,
    personId: ids.person,
    provider: "provider",
    type: "refund",
    grossAmountMinor: 1200,
    currency: "GBP",
    originalTransactionId: ids.transaction,
    transactedAt: dates.createdAt,
    status: "completed",
  });
  assert.equal(valid.success, true);
  assert.equal(
    TransactionSchema.safeParse({
      ...base,
      id: ids.transaction,
      productId: ids.product,
      personId: ids.person,
      provider: "provider",
      type: "purchase",
      grossAmountMinor: 1.5,
      currency: "GBP",
      transactedAt: dates.createdAt,
      status: "completed",
    }).success,
    false,
  );
  assert.equal(
    TransactionSchema.safeParse({
      ...base,
      id: ids.transaction,
      productId: ids.product,
      personId: ids.person,
      customerReference: "not-accepted",
      provider: "provider",
      type: "purchase",
      grossAmountMinor: 100,
      currency: "GBP",
      transactedAt: dates.createdAt,
      status: "completed",
    }).success,
    false,
  );
});

test("permission resolution uses the latest effective historical decision", () => {
  const earlier = MarketingPermissionSchema.parse({
    ...base,
    id: generatePlatformId("permission"),
    personId: ids.person,
    productId: ids.product,
    channel: "email",
    purpose: "marketing",
    lawfulBasis: "consent",
    permitted: true,
    effectiveAt: new Date("2025-01-02T00:00:00.000Z"),
  });
  const later = MarketingPermissionSchema.parse({
    ...base,
    id: generatePlatformId("permission"),
    personId: ids.person,
    productId: ids.product,
    channel: "email",
    purpose: "marketing",
    lawfulBasis: "consent",
    permitted: false,
    effectiveAt: new Date("2025-01-03T00:00:00.000Z"),
    supersedesPermissionId: earlier.id,
  });
  const result = resolveEffectiveMarketingPermission(
    [earlier, later],
    {
      personId: ids.person,
      productId: ids.product,
      channel: "email",
      purpose: "marketing",
    },
    new Date("2025-01-04T00:00:00.000Z"),
  );
  assert.equal(result?.id, later.id);
  assert.equal(result?.permitted, false);
});

test("contact normalization and partial primary index are explicit", () => {
  assert.equal(
    normalizeContactValue("email", " Ada@Example.COM "),
    "ada@example.com",
  );
  assert.equal(
    normalizeContactValue("phone", "+44 (20) 1234 5678"),
    "+442012345678",
  );
  const index = COLLECTION_DEFINITIONS.find(
    (definition) => definition.name === "contact_points",
  )?.indexes.find(
    (candidate) => candidate.name === "person_type_primary_unique",
  );
  assert.equal(index?.unique, true);
  assert.deepEqual(index?.partialFilterExpression, { primary: true });
  assert.equal(
    TransactionUpdateSchema.safeParse({ grossAmountMinor: 10 }).success,
    false,
  );
});

test("dry-run planning is read-only and CLI mode is explicit", async () => {
  const db = new FakeDb();
  const before = [...db.collections.keys()];
  const plan = await planDatabaseSetup(db as unknown as Db);
  assert.deepEqual([...db.collections.keys()], before);
  assert.equal(plan.collectionsToCreate.length, 15);
  assert.ok(plan.indexesToCreate.length > 0);
  assert.equal(parseSetupMode(["--dry-run"]), "dry-run");
  assert.equal(parseSetupMode(["--apply"]), "apply");
  assert.throws(() => parseSetupMode([]), /Usage: db:setup/);
  assert.throws(
    () => parseSetupMode(["--dry-run", "--apply"]),
    /Usage: db:setup/,
  );
});

test("existing-collection dry-run reports counts, conflicts, and duplicate diagnostics", async () => {
  const db = new FakeDb();
  const products = await db.createCollection("products");
  products.documents.set("one", { id: "duplicate" });
  products.documents.set("two", { id: "duplicate" });
  products.aggregateResults = [{ _id: { id: "duplicate" }, count: 2 }];
  const before = [...db.collections.keys()];
  const databaseMutationsBefore = db.mutationCount;
  const collectionMutationsBefore = products.mutationCount;
  const plan = await planDatabaseSetup(db as unknown as Db);
  assert.deepEqual([...db.collections.keys()], before);
  assert.equal(db.mutationCount, databaseMutationsBefore);
  assert.equal(products.mutationCount, collectionMutationsBefore);
  assert.equal(plan.documentCounts.products, 2);
  assert.equal(plan.compatibility, "new-install");
  assert.ok(
    plan.uniqueIndexRiskDiagnostics.some(
      (diagnostic) =>
        diagnostic.index === "products.id_unique" &&
        diagnostic.status === "confirmed-duplicate",
    ),
  );
});

test("transaction lifecycle accepts only conservative status transitions", () => {
  assert.equal(canTransitionTransactionStatus("pending", "completed"), true);
  assert.equal(canTransitionTransactionStatus("pending", "failed"), true);
  assert.equal(canTransitionTransactionStatus("pending", "pending"), true);
  assert.equal(canTransitionTransactionStatus("completed", "refunded"), true);
  assert.equal(canTransitionTransactionStatus("completed", "pending"), false);
  assert.equal(canTransitionTransactionStatus("refunded", "completed"), false);
  assert.doesNotThrow(() =>
    assertTransactionStatusTransition("pending", "voided"),
  );
  assert.throws(
    () => assertTransactionStatusTransition("voided", "pending"),
    /Invalid transaction status transition/,
  );
});

test("contact identity fields are immutable in operational updates", () => {
  assert.equal(
    ContactPointUpdateSchema.safeParse({ primary: true, updatedAt: new Date() })
      .success,
    true,
  );
  assert.equal(
    ContactPointUpdateSchema.safeParse({ value: "new@example.com" }).success,
    false,
  );
  assert.equal(
    ContactPointUpdateSchema.safeParse({ normalizedValue: "new@example.com" })
      .success,
    false,
  );
  assert.equal(
    ContactPointUpdateSchema.safeParse({ type: "phone" }).success,
    false,
  );
});

test("money requires safe integer amounts, valid currencies, and amount pairing", () => {
  const opportunity = {
    ...base,
    id: ids.opportunity,
    productId: ids.product,
    organisationId: ids.org,
    name: "Opportunity",
    stage: "discovery",
    status: "open" as const,
    estimatedValueMinor: 100,
  };
  assert.equal(OpportunitySchema.safeParse(opportunity).success, false);
  assert.equal(
    OpportunitySchema.safeParse({
      ...opportunity,
      currency: "ZZZ",
    }).success,
    false,
  );
  assert.equal(
    OpportunitySchema.safeParse({
      ...opportunity,
      estimatedValueMinor: Number.MAX_SAFE_INTEGER + 1,
      currency: "GBP",
    }).success,
    false,
  );
  assert.equal(
    CampaignSchema.safeParse({
      ...base,
      id: ids.campaign,
      productId: ids.product,
      name: "Campaign",
      type: "outbound",
      channel: "email",
      status: "draft",
      spendMinor: 100,
    }).success,
    false,
  );
});

test("append-only update contracts are not exported", () => {
  assert.equal("EventUpdateSchema" in domainSchemas, false);
  assert.equal("MarketingPermissionUpdateSchema" in domainSchemas, false);
});

test("apply inserts and then stably backfills the migration ledger", async () => {
  const db = new FakeDb();
  await setupDatabase(db as unknown as Db);
  const versions = db.collection(SCHEMA_VERSIONS_COLLECTION);
  const first = versions.documents.get("vapp-v1") as {
    migrations: { id: string; appliedAt: Date }[];
  };
  assert.equal(first.migrations[0]?.id, DATABASE_MIGRATION_ID);
  const firstAppliedAt = first.migrations[0]?.appliedAt;
  await setupDatabase(db as unknown as Db);
  const second = versions.documents.get("vapp-v1") as {
    migrations: { id: string; appliedAt: Date }[];
  };
  assert.deepEqual(second.migrations, first.migrations);
  assert.equal(second.migrations[0]?.appliedAt, firstAppliedAt);
});

test("apply backfills a missing baseline migration on compatible metadata", async () => {
  const db = new FakeDb();
  const versions = await db.createCollection(SCHEMA_VERSIONS_COLLECTION);
  versions.documents.set("vapp-v1", {
    _id: "vapp-v1",
    version: 1,
    schemaVersion: 1,
    migrations: [],
  });
  await setupDatabase(db as unknown as Db);
  const document = versions.documents.get("vapp-v1") as {
    migrations: { id: string }[];
  };
  assert.deepEqual(
    document.migrations.map((migration) => migration.id),
    [DATABASE_MIGRATION_ID],
  );
});

test("no-mode command refusal does not connect", async () => {
  process.exitCode = 0;
  await main([]);
  assert.equal(process.exitCode, 2);
  process.exitCode = 0;
});

test("command failures never log configuration credentials", async () => {
  const config = {
    deploymentEnvironment: "test" as const,
    runtimeMode: "test" as const,
    mongodbUri: "mongodb://secret-user:secret-password@private.example/db",
    port: 5000,
    serviceName: "test",
    version: "test",
    logLevel: "info" as const,
    cognito: {
      issuer: "https://cognito-idp.eu-west-2.amazonaws.com/eu-west-2_TestPool",
      clientId: "testclient",
    },
    corsOrigins: [],
    rateLimit: { windowMs: 1000, maxRequests: 1 },
  };
  const secretError = () =>
    new Error(
      "failure mongodb://secret-user:secret-password@private.example/db",
    );
  const failureCases = [
    {
      loadConfig: () => {
        throw secretError();
      },
      createClient: () => {
        throw new Error("unreachable");
      },
    },
    {
      loadConfig: () => config,
      createClient: () => {
        throw secretError();
      },
    },
    {
      loadConfig: () => config,
      createClient: () => ({
        connect: async () => {
          throw secretError();
        },
        db: () => {
          throw new Error("unreachable");
        },
        close: async () => undefined,
      }),
    },
  ];

  for (const failureCase of failureCases) {
    const messages: string[] = [];
    await runDatabaseSetup("dry-run", {
      ...failureCase,
      logger: {
        info: (value: unknown) => messages.push(String(value)),
        error: (value: unknown) => messages.push(String(value)),
      },
    });
    assert.doesNotMatch(
      messages.join(" "),
      /secret-user|secret-password|private\.example|mongodb:\/\//,
    );
  }
  process.exitCode = 0;
});

test("canonical setup plans and provisions only the missing public enquiry indexes", async () => {
  const db = new FakeDb();
  await setupDatabase(db as unknown as Db);
  const required = [
    ["contact_points", "public_enquiry_email_unique"],
    ["organisations", "public_enquiry_org_unique"],
  ];
  for (const [collection, index] of required) {
    const target = db.collection(collection);
    target.indexes = target.indexes.filter((item) => item.name !== index);
    target.documents.set("existing", {
      id: "existing",
      source: { system: "legacy_import" },
    });
  }
  const before = [...db.collections].map(([name, collection]) => [
    name,
    collection.mutationCount,
  ]);
  const plan = await planDatabaseSetup(db as unknown as Db);
  assert.deepEqual(
    plan.indexesToCreate.sort(),
    required.map(([collection, index]) => `${collection}.${index}`).sort(),
  );
  assert.deepEqual(plan.collectionsToCreate, []);
  assert.deepEqual(plan.uniqueIndexRisks, []);
  assert.deepEqual(
    [...db.collections].map(([name, collection]) => [
      name,
      collection.mutationCount,
    ]),
    before,
  );
  const applied = await setupDatabase(db as unknown as Db);
  assert.deepEqual(applied.createdIndexes.sort(), plan.indexesToCreate.sort());
  for (const [collection, index] of required) {
    const target = db.collection(collection);
    assert.equal(
      target.indexes.find((item) => item.name === index)?.unique,
      true,
    );
    assert.deepEqual(target.documents.get("existing"), {
      id: "existing",
      source: { system: "legacy_import" },
    });
  }
  assert.deepEqual(
    (await setupDatabase(db as unknown as Db)).createdIndexes,
    [],
  );
});

for (const risk of ["confirmed duplicate", "inspection unavailable"]) {
  test(`setup refuses ${risk} before creating any resources`, async () => {
    const db = new FakeDb();
    const contacts = await db.createCollection("contact_points");
    contacts.documents.set("existing", {
      id: "existing",
      type: "email",
      normalizedValue: "example@example.com",
      source: { system: "public_enquiry" },
    });
    if (risk === "confirmed duplicate")
      contacts.aggregateResults = [
        { _id: { key0: "example@example.com" }, count: 2 },
      ];
    else
      contacts.aggregate = () => ({
        toArray: async () => {
          throw new Error("Unavailable");
        },
      });
    const before = [...db.collections.keys()];
    const mutations = db.mutationCount;
    await assert.rejects(
      setupDatabase(db as unknown as Db),
      /Unresolved unique index risks/,
    );
    assert.deepEqual([...db.collections.keys()], before);
    assert.equal(db.mutationCount, mutations);
    assert.equal(contacts.mutationCount, 0);
  });
}
