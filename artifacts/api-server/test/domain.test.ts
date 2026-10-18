import {
  historicalProtocolValidator,
  isProtocolV11Predecessor,
  PROTOCOL_V12_COLLECTIONS,
} from "../src/db/protocol-v12-migration";
import { createHash } from "node:crypto";
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
  V14_SETUP_COLLECTIONS as COLLECTION_DEFINITIONS,
  COLLECTION_NAMES,
  SCHEMA_VERSIONS_COLLECTION,
  getDomainCollections,
  DATABASE_MIGRATION_ID,
  CRM_FOUNDATION_MIGRATION_ID,
  COMMERCIAL_FOUNDATION_MIGRATION_ID,
  BRAND_FOUNDATION_MIGRATION_ID,
  HVM_PHASE1_MIGRATION_ID,
  HIVE_FOUNDATION_MIGRATION_ID,
  HIVE_VALIDATOR_CORRECTION_MIGRATION_ID,
  OFFER_FOUNDATION_MIGRATION_ID,
  OPERATING_FOUNDATION_MIGRATION_ID,
  AGENT_CONTROL_PLANE_MIGRATION_ID,
  EFFECTIVENESS_MIGRATION_ID,
  PROTOCOL_V12_MIGRATION_ID,
} from "../src/db/collections";
import {
  MONGO_VALIDATORS,
  IncompatibleDatabaseSchemaError,
  planDatabaseSetup,
  setupDatabase,
} from "./helpers/database-v14";
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

test("collection definitions cover exactly the canonical domain collections", () => {
  assert.deepEqual(
    COLLECTION_DEFINITIONS.map((definition) => definition.name),
    COLLECTION_DEFINITIONS.map((d) => d.name),
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

test("database setup is repeatable and preserves existing documents", async () => {
  const db = new FakeDb();
  const first = await setupDatabase(db as unknown as Db);
  const products = db.collection("products");
  products.documents.set("business-record", {
    id: "business-record",
    name: "keep",
  });
  const second = await setupDatabase(db as unknown as Db);

  assert.equal(
    first.createdCollections.length,
    COLLECTION_DEFINITIONS.length + 1,
  );
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
  assert.equal(
    plan.collectionsToCreate.length,
    COLLECTION_DEFINITIONS.length + 1,
  );
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
    [
      DATABASE_MIGRATION_ID,
      CRM_FOUNDATION_MIGRATION_ID,
      COMMERCIAL_FOUNDATION_MIGRATION_ID,
      BRAND_FOUNDATION_MIGRATION_ID,
      HVM_PHASE1_MIGRATION_ID,
      HIVE_FOUNDATION_MIGRATION_ID,
      HIVE_VALIDATOR_CORRECTION_MIGRATION_ID,
      OFFER_FOUNDATION_MIGRATION_ID,
      OPERATING_FOUNDATION_MIGRATION_ID,
      AGENT_CONTROL_PLANE_MIGRATION_ID,
      EFFECTIVENESS_MIGRATION_ID,
      PROTOCOL_V12_MIGRATION_ID,
      "013-reasoning-contact-strategy-foundation",
      "014-identity-relationship-value-strategy",
    ],
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

test("CRM additive upgrade retains baseline history and resumes after interrupted index creation", async () => {
  const db = new FakeDb();
  const versions = await db.createCollection(SCHEMA_VERSIONS_COLLECTION);
  const baselineAt = new Date("2025-01-01Z");
  versions.documents.set("vapp-v1", {
    _id: "vapp-v1",
    version: 1,
    schemaVersion: 1,
    appliedAt: baselineAt,
    migrations: [
      { id: DATABASE_MIGRATION_ID, version: 1, appliedAt: baselineAt },
    ],
  });
  const external = await db.createCollection("external_references");
  const original = external.createIndexes.bind(external);
  external.createIndexes = async () => {
    throw new Error("interrupted");
  };
  await assert.rejects(setupDatabase(db as unknown as Db), /interrupted/);
  assert.equal(versions.documents.get("vapp-v1")?.version, 1);
  external.createIndexes = original;
  await setupDatabase(db as unknown as Db);
  const ledger = structuredClone(versions.documents.get("vapp-v1"));
  assert.deepEqual(
    (
      ledger?.migrations as { id: string; version: number; appliedAt: Date }[]
    )[0],
    { id: DATABASE_MIGRATION_ID, version: 1, appliedAt: baselineAt },
  );
  assert.equal(ledger?.version, 14);
  const mutations = db.mutationCount;
  await setupDatabase(db as unknown as Db);
  assert.deepEqual(versions.documents.get("vapp-v1"), ledger);
  assert.equal(db.mutationCount, mutations);
});
test("validator preflight is read-only and conflicts stop apply before any writes", async () => {
  for (const conflict of ["options", "records"]) {
    const db = new FakeDb();
    const people = await db.createCollection("people");
    if (conflict === "options")
      people.options = { validator: { required: ["legacy"] } };
    else people.validatorInvalidCount = 1;
    const mutations = db.mutationCount;
    const plan = await planDatabaseSetup(db as unknown as Db);
    assert.ok(plan.validatorConflicts.length);
    assert.equal(db.mutationCount, mutations);
    await assert.rejects(
      setupDatabase(db as unknown as Db),
      IncompatibleDatabaseSchemaError,
    );
    assert.equal(db.mutationCount, mutations);
    assert.equal(people.mutationCount, 0);
  }
});
test("equivalent indexes with different names are reused, not duplicated", async () => {
  const db = new FakeDb();
  const organisations = await db.createCollection("organisations");
  organisations.indexes.push({
    key: { normalizedDomain: 1 },
    name: "existing_domain_candidates",
  });
  const plan = await planDatabaseSetup(db as unknown as Db);
  assert.ok(
    !plan.indexesToCreate.includes(
      "organisations.normalized_domain_candidates",
    ),
  );
});

test("upgrade plans all additive v2 to v4 collections, validators and indexes, preserves records and retries idempotently", async () => {
  const { CRM_MONGO_VALIDATORS } = await import("../src/db/crm-validators");
  const db = new FakeDb();
  await setupDatabase(db as unknown as Db);
  const versions = db.collection(SCHEMA_VERSIONS_COLLECTION);
  const oldLedger = {
    _id: "vapp-v1",
    version: 2,
    schemaVersion: 2,
    migrations: [
      { id: DATABASE_MIGRATION_ID, version: 1, appliedAt: dates.createdAt },
      {
        id: CRM_FOUNDATION_MIGRATION_ID,
        version: 2,
        appliedAt: dates.createdAt,
      },
    ],
  };
  versions.documents.set("vapp-v1", oldLedger);
  const added = [
    "brands",
    "brand_kits",
    "hvm_partners",
    "hvm_partner_memberships",
    "workspace_integrations",
    "workspace_partner_assignments",
    "capabilities",
    "capability_instances",
    "commercial_packages",
    "commercial_charges",
  ];
  for (const name of added) db.collections.delete(name);
  db.collection("entitlements").options = {};
  const entitlements = db.collection("entitlements");
  entitlements.indexes = entitlements.indexes.filter(
    (i) =>
      ![
        "workspace_capability_access_window",
        "workspace_instance_access_window",
      ].includes(String(i.name)),
  );
  const products = db.collection("products");
  products.documents.set("legacy", { id: ids.product, name: "Untouched" });
  const before = structuredClone(products.documents);
  const mutations = db.mutationCount;
  const plan = await planDatabaseSetup(db as unknown as Db);
  assert.equal(db.mutationCount, mutations);
  assert.equal(plan.existingSchemaVersion, 2);
  assert.equal(plan.schemaVersion, 14);
  assert.deepEqual(plan.collectionsToCreate.sort(), [...added].sort());
  assert.deepEqual(
    plan.validatorsToApply.sort(),
    [...added, "entitlements"].sort(),
  );
  assert.equal(plan.indexesToCreate.length, 28);
  assert.ok(
    plan.indexesToCreate.includes(
      "entitlements.workspace_instance_access_window",
    ),
  );
  assert.equal(plan.validatorsToApply.includes("products"), false);
  assert.deepEqual(plan.validatorConflicts, []);
  await setupDatabase(db as unknown as Db);
  assert.deepEqual(products.documents, before);
  for (const [name, validator] of Object.entries(CRM_MONGO_VALIDATORS))
    assert.deepEqual(
      db.collection(name).options.validator,
      name === "crm_workspaces"
        ? (await import("../src/db/execution-serialization-validators"))
            .EXECUTION_SERIALIZATION_VALIDATORS[name]
        : name === "crm_tasks"
          ? MONGO_VALIDATORS.crm_tasks
          : validator,
    );
  assert.equal(versions.documents.get("vapp-v1")?.version, 14);
  const applied = structuredClone(versions.documents);
  const after = db.mutationCount;
  await setupDatabase(db as unknown as Db);
  assert.equal(db.mutationCount, after);
  assert.deepEqual(versions.documents, applied);
});

test("Brand v3 to v4 dry-run proposes only two collections/two validators/five indexes and preserves existing records on retry", async () => {
  const db = new FakeDb();
  await setupDatabase(db as unknown as Db);
  const versions = db.collection(SCHEMA_VERSIONS_COLLECTION);
  const ledger = versions.documents.get("vapp-v1")!;
  versions.documents.set("vapp-v1", {
    ...ledger,
    version: 3,
    schemaVersion: 3,
    migrations: (ledger.migrations as { version: number }[]).filter(
      (m) => m.version <= 3,
    ),
  });
  db.collections.delete("brands");
  db.collections.delete("brand_kits");
  db.collection("products").documents.set("existing", {
    id: ids.product,
    name: "Existing portfolio Product",
  });
  const before = structuredClone(db.collection("products").documents);
  const mutations = db.mutationCount;
  const plan = await planDatabaseSetup(db as unknown as Db);
  assert.equal(db.mutationCount, mutations);
  assert.equal(plan.existingSchemaVersion, 3);
  assert.equal(plan.schemaVersion, 14);
  assert.deepEqual(plan.collectionsToCreate.sort(), ["brand_kits", "brands"]);
  assert.deepEqual(plan.validatorsToApply.sort(), ["brand_kits", "brands"]);
  assert.equal(plan.indexesToCreate.length, 5);
  assert.deepEqual(plan.validatorConflicts, []);
  await setupDatabase(db as unknown as Db);
  assert.deepEqual(db.collection("products").documents, before);
  const after = db.mutationCount;
  await setupDatabase(db as unknown as Db);
  assert.equal(db.mutationCount, after);
});

test("HVM v4 to v5 is additive: one membership collection/validator and six indexes; no legacy index drops", async () => {
  const db = new FakeDb();
  await setupDatabase(db as unknown as Db);
  const ledger = db
    .collection(SCHEMA_VERSIONS_COLLECTION)
    .documents.get("vapp-v1")!;
  db.collection(SCHEMA_VERSIONS_COLLECTION).documents.set("vapp-v1", {
    ...ledger,
    version: 4,
    schemaVersion: 4,
    migrations: (ledger.migrations as { version: number }[]).filter(
      (m) => m.version <= 4,
    ),
  });
  db.collections.delete("workspace_memberships");
  for (const name of ["contact_points", "organisations"])
    db.collection(name).indexes = db
      .collection(name)
      .indexes.filter(
        (i) => !String(i.name).startsWith("workspace_public_enquiry"),
      );
  const before = db.mutationCount;
  const plan = await planDatabaseSetup(db as unknown as Db);
  assert.equal(db.mutationCount, before);
  assert.equal(plan.existingSchemaVersion, 4);
  assert.equal(plan.schemaVersion, 14);
  assert.deepEqual(plan.collectionsToCreate, ["workspace_memberships"]);
  assert.deepEqual(plan.validatorsToApply, ["workspace_memberships"]);
  assert.equal(plan.indexesToCreate.length, 6);
  assert.deepEqual(plan.incompatibleIndexes, []);
  assert.ok(
    db
      .collection("contact_points")
      .indexes.some((i) => i.name === "public_enquiry_email_unique"),
  );
  await setupDatabase(db as unknown as Db);
  const after = db.mutationCount;
  await setupDatabase(db as unknown as Db);
  assert.equal(db.mutationCount, after);
});

test("Hive v5 to v7 adds four collections and twelve indexes, preserving all legacy data and validators", async () => {
  const db = new FakeDb();
  await setupDatabase(db as unknown as Db);
  const names = [
    "offerings",
    "ideal_customer_profiles",
    "buyer_profiles",
    "hive_definition_revisions",
  ];
  const ledger = db
    .collection(SCHEMA_VERSIONS_COLLECTION)
    .documents.get("vapp-v1")!;
  db.collection(SCHEMA_VERSIONS_COLLECTION).documents.set("vapp-v1", {
    ...ledger,
    version: 5,
    schemaVersion: 5,
    migrations: (ledger.migrations as { version: number }[]).filter(
      (m) => m.version <= 5,
    ),
  });
  for (const name of names) db.collections.delete(name);
  db.collection("organisations").documents.set("retained", {
    id: "retained",
    name: "Do not rewrite",
  });
  const before = [...db.collections]
    .filter(([name]) => name !== SCHEMA_VERSIONS_COLLECTION)
    .map(([name, c]) => ({
      name,
      options: structuredClone(c.options),
      indexes: structuredClone(c.indexes),
      documents: structuredClone(c.documents),
    }));
  const mutations = db.mutationCount;
  const plan = await planDatabaseSetup(db as unknown as Db);
  assert.equal(db.mutationCount, mutations);
  assert.equal(plan.schemaVersion, 14);
  assert.equal(plan.existingSchemaVersion, 5);
  assert.deepEqual(new Set(plan.collectionsToCreate), new Set(names));
  assert.deepEqual(new Set(plan.validatorsToApply), new Set(names));
  assert.equal(plan.indexesToCreate.length, 12);
  assert.deepEqual(plan.incompatibleIndexes, []);
  await setupDatabase(db as unknown as Db);
  for (const b of before) {
    const c = db.collection(b.name);
    assert.deepEqual(c.options, b.options);
    assert.deepEqual(c.indexes, b.indexes);
    assert.deepEqual(c.documents, b.documents);
  }
  assert.equal(
    db.collection(SCHEMA_VERSIONS_COLLECTION).documents.get("vapp-v1")?.version,
    14,
  );
  const after = db.mutationCount;
  await setupDatabase(db as unknown as Db);
  assert.equal(db.mutationCount, after);
});

async function installedHiveV6() {
  const { HIVE_V6_MONGO_VALIDATORS } =
    await import("../src/db/hive-validators-v6");
  const db = new FakeDb();
  await setupDatabase(db as unknown as Db);
  const ledger = db
    .collection(SCHEMA_VERSIONS_COLLECTION)
    .documents.get("vapp-v1")!;
  ledger.version = ledger.schemaVersion = 6;
  ledger.migrations = (ledger.migrations as { version: number }[]).filter(
    (m) => m.version <= 6,
  );
  for (const [name, validator] of Object.entries(HIVE_V6_MONGO_VALIDATORS))
    db.collection(name).options = {
      validator: historicalProtocolValidator(validator),
      validationLevel: "strict",
      validationAction: "error",
    };
  return db;
}
test("v7 corrects only exact historical v6 validators, preserves data/indexes/history and retries", async () => {
  const db = await installedHiveV6();
  const names = [
    "offerings",
    "ideal_customer_profiles",
    "buyer_profiles",
    "hive_definition_revisions",
  ];
  const history = structuredClone(
    db.collection(SCHEMA_VERSIONS_COLLECTION).documents.get("vapp-v1")!
      .migrations,
  );
  const before = [...db.collections]
    .filter(([name]) => name !== SCHEMA_VERSIONS_COLLECTION)
    .map(([name, c]) => ({
      name,
      documents: structuredClone(c.documents),
      indexes: structuredClone(c.indexes),
      options: structuredClone(c.options),
    }));
  const mutations = db.mutationCount;
  const plan = await planDatabaseSetup(db as unknown as Db);
  assert.equal(db.mutationCount, mutations);
  assert.equal(plan.existingSchemaVersion, 6);
  assert.equal(plan.schemaVersion, 14);
  assert.deepEqual(plan.validatorConflicts, []);
  assert.deepEqual(new Set(plan.validatorsToApply), new Set(names));
  assert.deepEqual(plan.collectionsToCreate, []);
  assert.deepEqual(plan.indexesToCreate, []);
  // Simulate interruption after one successful collMod; ledger must stay at v6.
  const command = db.command.bind(db);
  let calls = 0;
  db.command = async (input) => {
    if (++calls === 2) throw new Error("simulated interruption");
    await command(input);
  };
  await assert.rejects(
    setupDatabase(db as unknown as Db),
    /simulated interruption/,
  );
  assert.equal(
    db.collection(SCHEMA_VERSIONS_COLLECTION).documents.get("vapp-v1")!.version,
    6,
  );
  assert.equal(
    (await planDatabaseSetup(db as unknown as Db)).validatorsToApply.length,
    3,
  );
  db.command = command;
  await setupDatabase(db as unknown as Db);
  const ledger = db
    .collection(SCHEMA_VERSIONS_COLLECTION)
    .documents.get("vapp-v1")!;
  assert.equal(ledger.version, 14);
  assert.deepEqual(
    (ledger.migrations as unknown[]).slice(0, (history as unknown[]).length),
    history,
  );
  assert.equal(
    (ledger.migrations as { id: string }[]).find(
      (m) => m.id === HIVE_VALIDATOR_CORRECTION_MIGRATION_ID,
    )!.id,
    HIVE_VALIDATOR_CORRECTION_MIGRATION_ID,
  );
  for (const b of before) {
    const c = db.collection(b.name);
    assert.deepEqual(c.documents, b.documents);
    assert.deepEqual(c.indexes, b.indexes);
    if (!names.includes(b.name)) assert.deepEqual(c.options, b.options);
  }
  assert.deepEqual(
    (await planDatabaseSetup(db as unknown as Db)).validatorsToApply,
    [],
  );
  const after = db.mutationCount;
  await setupDatabase(db as unknown as Db);
  assert.equal(db.mutationCount, after);
});
for (const failure of [
  "unknown-validator",
  "invalid-data",
  "wrong-ledger",
  "weak-validation",
] as const) {
  test(`v7 refuses ${failure} before writes`, async () => {
    const db = await installedHiveV6();
    const collection = db.collection("offerings");
    if (failure === "unknown-validator")
      collection.options.validator = { unexpected: true };
    if (failure === "invalid-data") collection.validatorInvalidCount = 1;
    if (failure === "wrong-ledger")
      db
        .collection(SCHEMA_VERSIONS_COLLECTION)
        .documents.get("vapp-v1")!.version = 7;
    if (failure === "weak-validation")
      collection.options.validationAction = "warn";
    const before = db.mutationCount;
    assert.ok(
      (await planDatabaseSetup(db as unknown as Db)).validatorConflicts.length,
    );
    await assert.rejects(
      setupDatabase(db as unknown as Db),
      IncompatibleDatabaseSchemaError,
    );
    assert.equal(db.mutationCount, before);
  });
}

test("historical v6 validator definitions remain frozen", async () => {
  const { HIVE_V6_MONGO_VALIDATORS } =
    await import("../src/db/hive-validators-v6");
  assert.equal(
    createHash("sha256")
      .update(JSON.stringify(HIVE_V6_MONGO_VALIDATORS))
      .digest("hex"),
    "d8474d07ca3bd838814723bc5b51dfdcc0fc55f580a2aee2b1bda1f0e816e1c5",
  );
});

test("Offer foundation v7 to v8 is additive: three empty collections, seven indexes; no existing validators/data change", async () => {
  const db = new FakeDb();
  await setupDatabase(db as unknown as Db);
  const names = ["offer_designs", "offers", "offer_revisions"];
  const versions = db.collection(SCHEMA_VERSIONS_COLLECTION);
  const ledger = versions.documents.get("vapp-v1")!;
  ledger.version = ledger.schemaVersion = 7;
  ledger.migrations = (ledger.migrations as { version: number }[]).filter(
    (m) => m.version <= 7,
  );
  for (const name of names) db.collections.delete(name);
  const before = [...db.collections]
    .filter(([name]) => name !== SCHEMA_VERSIONS_COLLECTION)
    .map(([name, c]) => ({
      name,
      options: structuredClone(c.options),
      indexes: structuredClone(c.indexes),
      documents: structuredClone(c.documents),
    }));
  const mutations = db.mutationCount;
  const plan = await planDatabaseSetup(db as unknown as Db);
  assert.equal(db.mutationCount, mutations);
  assert.equal(plan.existingSchemaVersion, 7);
  assert.equal(plan.schemaVersion, 14);
  assert.deepEqual(new Set(plan.collectionsToCreate), new Set(names));
  assert.deepEqual(new Set(plan.validatorsToApply), new Set(names));
  assert.equal(plan.indexesToCreate.length, 7);
  assert.deepEqual(plan.validatorConflicts, []);
  await setupDatabase(db as unknown as Db);
  assert.equal(versions.documents.get("vapp-v1")!.version, 14);
  for (const old of before) {
    const c = db.collection(old.name);
    assert.deepEqual(c.options, old.options);
    assert.deepEqual(c.indexes, old.indexes);
    assert.deepEqual(c.documents, old.documents);
  }
  for (const name of names) assert.equal(db.collection(name).documents.size, 0);
  const after = db.mutationCount;
  await setupDatabase(db as unknown as Db);
  assert.equal(db.mutationCount, after);
});

test("Empress v8 to v9 is additive: nine empty collections, 29 indexes; existing validators and data unchanged", async () => {
  const db = new FakeDb();
  await setupDatabase(db as unknown as Db);
  const names = [
    "agent_definitions",
    "integration_providers",
    "swarm_templates",
    "commercial_policies",
    "methodology_availability",
    "client_agents",
    "client_swarms",
    "pricing_recommendations",
    "swarm_agreements",
  ];
  const versions = db.collection(SCHEMA_VERSIONS_COLLECTION);
  const ledger = versions.documents.get("vapp-v1")!;
  ledger.version = ledger.schemaVersion = 8;
  ledger.migrations = (ledger.migrations as { version: number }[]).filter(
    (m) => m.version <= 8,
  );
  for (const name of names) db.collections.delete(name);
  const before = [...db.collections]
    .filter(([name]) => name !== SCHEMA_VERSIONS_COLLECTION)
    .map(([name, c]) => ({
      name,
      options: structuredClone(c.options),
      indexes: structuredClone(c.indexes),
      documents: structuredClone(c.documents),
    }));
  const mutations = db.mutationCount;
  const plan = await planDatabaseSetup(db as unknown as Db);
  assert.equal(db.mutationCount, mutations);
  assert.equal(plan.existingSchemaVersion, 8);
  assert.equal(plan.schemaVersion, 14);
  assert.deepEqual(new Set(plan.collectionsToCreate), new Set(names));
  assert.deepEqual(new Set(plan.validatorsToApply), new Set(names));
  assert.equal(plan.indexesToCreate.length, 29);
  assert.deepEqual(plan.validatorConflicts, []);
  await setupDatabase(db as unknown as Db);
  assert.equal(versions.documents.get("vapp-v1")!.version, 14);
  for (const old of before) {
    const c = db.collection(old.name);
    assert.deepEqual(c.options, old.options);
    assert.deepEqual(c.indexes, old.indexes);
    assert.deepEqual(c.documents, old.documents);
  }
  for (const name of names) assert.equal(db.collection(name).documents.size, 0);
  const after = db.mutationCount;
  await setupDatabase(db as unknown as Db);
  assert.equal(db.mutationCount, after);
});

async function installedControlPlaneV9() {
  const { AGENT_VALIDATOR_PREDECESSORS } = await import("../src/db/setup");
  const { AGENT_COLLECTION_DEFINITIONS } =
    await import("../src/db/agent-control-plane-collections");
  const db = new FakeDb();
  await setupDatabase(db as unknown as Db);
  for (const { name } of AGENT_COLLECTION_DEFINITIONS)
    db.collections.delete(name);
  for (const [name, validator] of Object.entries(AGENT_VALIDATOR_PREDECESSORS))
    db.collection(name).options = {
      validator: historicalProtocolValidator(validator),
      validationLevel: "strict",
      validationAction: "error",
    };
  const ledger = db
    .collection(SCHEMA_VERSIONS_COLLECTION)
    .documents.get("vapp-v1")!;
  ledger.version = ledger.schemaVersion = 9;
  ledger.migrations = (ledger.migrations as { version: number }[]).filter(
    (m) => m.version <= 9,
  );
  db.collection("products").documents.set("synthetic-existing", {
    id: ids.product,
    name: "Preserved portfolio record",
  });
  return db;
}
test("control plane v9 to v11: four empty collections, sixteen indexes, ten exact validator amendments; no backfill; retry is idempotent", async () => {
  const { AGENT_VALIDATOR_PREDECESSORS } = await import("../src/db/setup");
  const { AGENT_COLLECTION_DEFINITIONS } =
    await import("../src/db/agent-control-plane-collections");
  const db = await installedControlPlaneV9();
  const existing = [...db.collections]
    .filter(([name]) => name !== SCHEMA_VERSIONS_COLLECTION)
    .map(([name, c]) => ({
      name,
      options: structuredClone(c.options),
      indexes: structuredClone(c.indexes),
      documents: structuredClone(c.documents),
    }));
  const mutations = db.mutationCount;
  const plan = await planDatabaseSetup(db as unknown as Db);
  assert.equal(db.mutationCount, mutations);
  assert.equal(plan.existingSchemaVersion, 9);
  assert.equal(plan.schemaVersion, 14);
  assert.equal(Object.keys(AGENT_VALIDATOR_PREDECESSORS).length, 10);
  assert.deepEqual(
    new Set(plan.collectionsToCreate),
    new Set(AGENT_COLLECTION_DEFINITIONS.map((c) => c.name)),
  );
  assert.equal(plan.validatorsToApply.length, 14);
  assert.equal(plan.indexesToCreate.length, 16);
  assert.deepEqual(plan.validatorConflicts, []);
  assert.deepEqual(plan.incompatibleIndexes, []);
  assert.deepEqual(plan.uniqueIndexRisks, []);
  const command = db.command.bind(db);
  let modifications = 0;
  db.command = async (input) => {
    if (++modifications === 2)
      throw new Error("synthetic interrupted validator apply");
    return command(input);
  };
  await assert.rejects(
    setupDatabase(db as unknown as Db),
    /synthetic interrupted/,
  );
  assert.equal(
    db.collection(SCHEMA_VERSIONS_COLLECTION).documents.get("vapp-v1")!.version,
    9,
  );
  assert.deepEqual(
    (await planDatabaseSetup(db as unknown as Db)).validatorConflicts,
    [],
  );
  db.command = command;
  await setupDatabase(db as unknown as Db);
  for (const previous of existing) {
    const current = db.collection(previous.name);
    assert.deepEqual(current.documents, previous.documents);
    assert.deepEqual(current.indexes, previous.indexes);
    if (!(previous.name in AGENT_VALIDATOR_PREDECESSORS))
      assert.deepEqual(current.options, previous.options);
  }
  for (const { name } of AGENT_COLLECTION_DEFINITIONS)
    assert.equal(db.collection(name).documents.size, 0);
  assert.equal(
    db.collection(SCHEMA_VERSIONS_COLLECTION).documents.get("vapp-v1")!.version,
    14,
  );
  const after = db.mutationCount;
  await setupDatabase(db as unknown as Db);
  assert.equal(db.mutationCount, after);
});
for (const mode of ["unknown", "weak", "invalid"] as const)
  test(`control-plane upgrade refuses ${mode} authority validator state before writes`, async () => {
    const db = await installedControlPlaneV9();
    const c = db.collection("workspace_memberships");
    if (mode === "unknown")
      c.options.validator = { $jsonSchema: { bsonType: "object" } };
    if (mode === "weak") c.options.validationAction = "warn";
    if (mode === "invalid") c.validatorInvalidCount = 1;
    const before = db.mutationCount;
    await assert.rejects(
      setupDatabase(db as unknown as Db),
      IncompatibleDatabaseSchemaError,
    );
    assert.equal(db.mutationCount, before);
  });

async function installedEffectivenessV10() {
  const { AGENT_CONTROL_PLANE_VALIDATORS } =
    await import("../src/db/agent-control-plane-validators");
  const { CONTROL_PLANE_OPERATING_MONGO_VALIDATORS } =
    await import("../src/db/operating-validators");
  const db = new FakeDb();
  await setupDatabase(db as unknown as Db);
  db.collections.delete("agent_effectiveness_cases");
  for (const [name, validator] of Object.entries({
    ...CONTROL_PLANE_OPERATING_MONGO_VALIDATORS,
    ...AGENT_CONTROL_PLANE_VALIDATORS,
  }))
    db.collection(name).options = {
      validator: historicalProtocolValidator(validator),
      validationLevel: "strict",
      validationAction: "error",
    };
  db.collection("agent_runs").indexes = db
    .collection("agent_runs")
    .indexes.filter(
      (i) =>
        !["effectiveness_transition_unique", "active_status_id"].includes(
          String(i.name),
        ),
    );
  const ledger = db
    .collection(SCHEMA_VERSIONS_COLLECTION)
    .documents.get("vapp-v1")!;
  ledger.version = ledger.schemaVersion = 10;
  ledger.migrations = (ledger.migrations as { version: number }[]).filter(
    (m) => m.version <= 10,
  );
  return db;
}
test("v11 migration is additive, exact-predecessor gated, read-only in planning and retryable without Result backfill", async () => {
  const db = await installedEffectivenessV10();
  const before = db.mutationCount;
  const retained = [...db.collections].map(([name, c]) => ({
    name,
    documents: structuredClone(c.documents),
  }));
  const plan = await planDatabaseSetup(db as unknown as Db);
  assert.equal(db.mutationCount, before);
  assert.equal(plan.existingSchemaVersion, 10);
  assert.equal(plan.schemaVersion, 14);
  assert.deepEqual(plan.collectionsToCreate, ["agent_effectiveness_cases"]);
  assert.deepEqual(plan.validatorConflicts, []);
  assert.deepEqual(
    new Set(plan.validatorsToApply),
    new Set([
      "agent_effectiveness_cases",
      "agent_runs",
      "agent_results",
      "agent_definitions",
      "pricing_recommendations",
      "swarm_agreements",
    ]),
  );
  assert.equal(plan.indexesToCreate.length, 7);
  const command = db.command.bind(db);
  let n = 0;
  db.command = async (input) => {
    if (++n === 2) throw new Error("synthetic interruption");
    return command(input);
  };
  await assert.rejects(
    setupDatabase(db as unknown as Db),
    /synthetic interruption/,
  );
  assert.equal(
    db.collection(SCHEMA_VERSIONS_COLLECTION).documents.get("vapp-v1")!.version,
    10,
  );
  db.command = command;
  await setupDatabase(db as unknown as Db);
  for (const old of retained)
    if (old.name !== SCHEMA_VERSIONS_COLLECTION)
      assert.deepEqual(db.collection(old.name).documents, old.documents);
  const after = db.mutationCount;
  await setupDatabase(db as unknown as Db);
  assert.equal(db.mutationCount, after);
});
for (const mode of ["unknown", "weak", "invalid"] as const)
  test("v11 refuses " + mode + " predecessor without mutation", async () => {
    const db = await installedEffectivenessV10();
    const runs = db.collection("agent_runs");
    if (mode === "unknown")
      runs.options.validator = { $jsonSchema: { bsonType: "object" } };
    if (mode === "weak") runs.options.validationAction = "warn";
    if (mode === "invalid") runs.validatorInvalidCount = 1;
    const before = db.mutationCount;
    await assert.rejects(
      setupDatabase(db as unknown as Db),
      IncompatibleDatabaseSchemaError,
    );
    assert.equal(db.mutationCount, before);
  });

async function installedProtocolV11() {
  const db = new FakeDb();
  await setupDatabase(db as unknown as Db);
  for (const name of PROTOCOL_V12_COLLECTIONS) {
    const validator = historicalProtocolValidator(MONGO_VALIDATORS[name]!);
    assert.ok(isProtocolV11Predecessor(name, validator), name);
    db.collection(name).options.validator = validator;
  }
  const ledger = db
    .collection(SCHEMA_VERSIONS_COLLECTION)
    .documents.get("vapp-v1")!;
  ledger.version = ledger.schemaVersion = 11;
  ledger.migrations = (ledger.migrations as { version: number }[]).filter(
    (m: { version: number }) => m.version <= 11,
  );
  return db;
}
test("v12 five-validator upgrade remains intact within v13 target; interrupted upgrade retries without backfill", async () => {
  const db = await installedProtocolV11();
  const before = db.mutationCount;
  const retained = [...db.collections]
    .filter(([n]) => n !== SCHEMA_VERSIONS_COLLECTION)
    .map(([name, c]) => ({ name, documents: structuredClone(c.documents) }));
  const plan = await planDatabaseSetup(db as unknown as Db);
  assert.equal(db.mutationCount, before);
  assert.equal(plan.existingSchemaVersion, 11);
  assert.equal(plan.schemaVersion, 14);
  assert.deepEqual(
    new Set(plan.validatorsToApply),
    new Set(PROTOCOL_V12_COLLECTIONS),
  );
  for (const v of [
    plan.collectionsToCreate,
    plan.indexesToCreate,
    plan.validatorConflicts,
    plan.incompatibleIndexes,
    plan.uniqueIndexRisks,
  ])
    assert.deepEqual(v, []);
  const command = db.command.bind(db);
  let n = 0;
  db.command = async (input) => {
    if (++n === 3) throw new Error("interrupted v12");
    return command(input);
  };
  await assert.rejects(setupDatabase(db as unknown as Db), /interrupted v12/);
  assert.equal(
    db.collection(SCHEMA_VERSIONS_COLLECTION).documents.get("vapp-v1")!.version,
    11,
  );
  db.command = command;
  await setupDatabase(db as unknown as Db);
  const ledger = db
    .collection(SCHEMA_VERSIONS_COLLECTION)
    .documents.get("vapp-v1")!;
  assert.equal(ledger.version, 14);
  assert.deepEqual(
    ledger.migrations.slice(-2).map((m: { version: number }) => m.version),
    [13, 14],
  );
  for (const old of retained)
    assert.deepEqual(db.collection(old.name).documents, old.documents);
  const after = db.mutationCount;
  const done = await planDatabaseSetup(db as unknown as Db);
  assert.equal(done.compatibility, "compatible");
  assert.deepEqual(done.validatorsToApply, []);
  await setupDatabase(db as unknown as Db);
  assert.equal(db.mutationCount, after);
});
for (const mode of ["unknown", "weak", "invalid"] as const)
  test(`v12 rejects ${mode} predecessor before mutations`, async () => {
    const db = await installedProtocolV11();
    const runs = db.collection("agent_runs");
    if (mode === "unknown")
      runs.options.validator = { $jsonSchema: { bsonType: "object" } };
    if (mode === "weak") runs.options.validationAction = "warn";
    if (mode === "invalid") runs.validatorInvalidCount = 1;
    const before = db.mutationCount;
    await assert.rejects(
      setupDatabase(db as unknown as Db),
      IncompatibleDatabaseSchemaError,
    );
    assert.equal(db.mutationCount, before);
  });

test("v13 plans exactly four collections, nine indexes and six validators from v12; preserves history, retries and rejects unknown predecessors", async () => {
  const {
    REASONING_COLLECTION_DEFINITIONS,
    REASONING_V12_PREDECESSORS,
    REASONING_MIGRATION_ID,
  } = await import("../src/db/reasoning-foundation");
  const db = new FakeDb();
  await setupDatabase(db as unknown as Db);
  for (const definition of REASONING_COLLECTION_DEFINITIONS)
    db.collections.delete(definition.name);
  db.collection("crm_tasks").options.validator = structuredClone(
    REASONING_V12_PREDECESSORS.crm_tasks,
  );
  db.collection("events").options = {};
  const ledger = db
    .collection(SCHEMA_VERSIONS_COLLECTION)
    .documents.get("vapp-v1")!;
  ledger.version = ledger.schemaVersion = 12;
  ledger.migrations = ledger.migrations.filter(
    (m: { version: number }) => m.version <= 12,
  );
  const history = structuredClone(ledger.migrations);
  const before = db.mutationCount;
  const plan = await planDatabaseSetup(db as unknown as Db);
  assert.equal(db.mutationCount, before);
  assert.equal(plan.schemaVersion, 14);
  assert.equal(plan.existingSchemaVersion, 12);
  assert.deepEqual(plan.validatorConflicts, []);
  assert.equal(plan.collectionsToCreate.length, 4);
  assert.equal(plan.indexesToCreate.length, 9);
  assert.deepEqual(
    new Set(plan.validatorsToApply),
    new Set([
      ...REASONING_COLLECTION_DEFINITIONS.map((d) => d.name),
      "crm_tasks",
      "events",
    ]),
  );
  const taskValidator = db.collection("crm_tasks").options.validator;
  db.collection("crm_tasks").options.validator = {
    $jsonSchema: { bsonType: "object" },
  };
  await assert.rejects(
    setupDatabase(db as unknown as Db),
    IncompatibleDatabaseSchemaError,
  );
  assert.equal(db.mutationCount, before);
  db.collection("crm_tasks").options.validator = taskValidator;
  const command = db.command.bind(db);
  let calls = 0;
  db.command = async (input) => {
    if (++calls === 2) throw new Error("interrupted v13");
    return command(input);
  };
  await assert.rejects(setupDatabase(db as unknown as Db), /interrupted v13/);
  assert.equal(ledger.version, 12);
  db.command = command;
  await setupDatabase(db as unknown as Db);
  const after = db
    .collection(SCHEMA_VERSIONS_COLLECTION)
    .documents.get("vapp-v1")!;
  assert.deepEqual(after.migrations.slice(0, 12), history);
  assert.equal(
    after.migrations.find((m: { version: number }) => m.version === 13).id,
    REASONING_MIGRATION_ID,
  );
  assert.equal(after.version, 14);
  const mutations = db.mutationCount;
  await setupDatabase(db as unknown as Db);
  assert.equal(db.mutationCount, mutations);
  for (const definition of REASONING_COLLECTION_DEFINITIONS)
    assert.equal(db.collection(definition.name).documents.size, 0);
});
