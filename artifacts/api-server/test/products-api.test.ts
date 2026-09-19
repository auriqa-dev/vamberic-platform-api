import { authEnvironment, createTestAuth } from "./helpers/auth";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import type { Db, Filter } from "mongodb";
import { createApp } from "../src/app";
import { parseConfig } from "../src/config";
import type { Product } from "../src/domain";
import type { MongoService } from "../src/services/mongo";

class MemoryCollection<T extends Record<string, unknown>> {
  constructor(private readonly records: T[] = []) {}

  find(filter: Filter<T>) {
    const matches = this.records.filter((record) => {
      if ("status" in filter && record.status !== filter.status) return false;
      if ("$or" in filter && Array.isArray(filter.$or)) {
        return filter.$or.some((condition) => {
          const [field, value] = Object.entries(condition)[0] ?? [];
          if (!field || typeof value !== "object" || value === null)
            return false;
          const pattern = "$regex" in value ? String(value.$regex) : "";
          return new RegExp(pattern, "i").test(String(record[field] ?? ""));
        });
      }
      return true;
    });
    return {
      sort: () => ({
        toArray: async () =>
          [...matches].sort(
            (left, right) =>
              new Date(String(right.updatedAt)).getTime() -
              new Date(String(left.updatedAt)).getTime(),
          ),
      }),
    };
  }

  async findOne(filter: { id?: string }): Promise<T | null> {
    return this.records.find((record) => record.id === filter.id) ?? null;
  }

  async insertOne(record: T): Promise<void> {
    this.records.push(record);
  }

  async updateOne(
    filter: { id: string; updatedAt?: Date },
    update: { $set: T },
  ) {
    const index = this.records.findIndex((item) => item.id === filter.id);
    if (index >= 0 && this.records[index].updatedAt === filter.updatedAt) {
      this.records[index] = { ...this.records[index], ...update.$set };
      return { matchedCount: 1 };
    }
    return { matchedCount: 0 };
  }

  async countDocuments(filter?: {
    status?: string | { $ne?: string };
  }): Promise<number> {
    if (!filter?.status) return this.records.length;
    if (typeof filter.status === "string") {
      return this.records.filter((record) => record.status === filter.status)
        .length;
    }
    return this.records.filter((record) => record.status !== filter.status.$ne)
      .length;
  }
}

class MemoryDb {
  readonly collections = new Map<
    string,
    MemoryCollection<Record<string, unknown>>
  >();

  collection(name: string) {
    let collection = this.collections.get(name);
    if (!collection) {
      collection = new MemoryCollection();
      this.collections.set(name, collection);
    }
    return collection;
  }
}

const config = parseConfig({
  ...authEnvironment,
  NODE_ENV: "production",
  DEPLOYMENT_ENV: "test",
  MONGODB_URI: "mongodb://localhost:27017",
  PORT: "5001",
  SERVICE_NAME: "test-api",
  API_VERSION: "test-version",
  RATE_LIMIT_MAX_REQUESTS: "100",
});

test("dashboard and product CRUD use the existing Mongo domain model", async () => {
  const memoryDb = new MemoryDb();
  const mongo: MongoService = {
    isAvailable: async () => true,
    database: async () => memoryDb as unknown as Db,
    close: async () => undefined,
  };
  const auth = await createTestAuth();
  const token = await auth.sign();
  const server = createServer(
    createApp(config, mongo, { jwtKeyResolver: auth.keyResolver }),
  );
  server.listen(0);
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  const request = async (
    path: string,
    init?: RequestInit,
  ): Promise<{ status: number; body: Record<string, unknown> | unknown[] }> => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        ...init?.headers,
      },
    });
    return {
      status: response.status,
      body: (await response.json()) as Record<string, unknown> | unknown[],
    };
  };

  try {
    const emptySummary = await request("/api/v1/dashboard/summary");
    assert.equal(emptySummary.status, 200);
    assert.deepEqual(emptySummary.body, {
      totalProducts: 0,
      activeProducts: 0,
      draftOrInactiveProducts: 0,
      totalOrganisations: 0,
      totalPeople: 0,
      totalOpportunities: 0,
    });

    const validInput = {
      name: "Validation example",
      slug: "validation-example",
      lifecycleStatus: "idea",
      productType: "software",
      businessModel: "saas",
    };
    for (const invalid of [
      { name: "   " },
      { currency: "ZZZ" },
      { productType: "hardware" },
      { lifecycleStatus: "dormant" },
      { operatingMode: "dormant" },
      { businessModel: "freemium" },
      { revenueModels: ["unknown"] },
      { revenueModels: ["one_off", "one_off"] },
      { plannedLaunchDate: "2026-02-30" },
      { additionalDomains: [" "] },
    ]) {
      const rejected = await request("/api/v1/products", {
        method: "POST",
        body: JSON.stringify({ ...validInput, ...invalid }),
      });
      assert.equal(rejected.status, 400);
      assert.deepEqual(rejected.body, { error: "Invalid product details" });
    }

    const created = await request("/api/v1/products", {
      method: "POST",
      body: JSON.stringify({
        name: "Energy Health Check",
        slug: "energy-health-check",
        lifecycleStatus: "live",
        productType: "service",
        businessModel: "transactional",
        description: "A practical energy assessment.",
      }),
    });
    assert.equal(created.status, 201);
    assert.match(
      String((created.body as Record<string, unknown>).id),
      /^product_[0-7][0-9abcdefghjkmnpqrstvwxyz]{25}$/,
    );
    const productId = String((created.body as Record<string, unknown>).id);

    const list = await request(
      "/api/v1/products?search=energy&lifecycleStatus=live",
    );
    assert.equal(list.status, 200);
    assert.equal((list.body as unknown[]).length, 1);

    const detail = await request(`/api/v1/products/${productId}`);
    assert.equal(detail.status, 200);
    assert.equal(
      (detail.body as Record<string, unknown>).slug,
      "energy-health-check",
    );

    for (const invalid of [
      { name: "   " },
      { currency: "ZZZ" },
      { productType: "hardware" },
      { lifecycleStatus: "dormant" },
      { operatingMode: "dormant" },
      { businessModel: "freemium" },
      { revenueModels: ["unknown"] },
      { revenueModels: ["one_off", "one_off"] },
      { plannedLaunchDate: "2026-02-30" },
      {},
      { archived: true },
    ]) {
      const rejected = await request(`/api/v1/products/${productId}`, {
        method: "PATCH",
        body: JSON.stringify(invalid),
      });
      assert.equal(rejected.status, 400);
      assert.deepEqual(rejected.body, { error: "Invalid product update" });
    }
    const missing = await request(
      "/api/v1/products/product_00000000000000000000000000",
    );
    assert.equal(missing.status, 404);
    const invalidId = await request("/api/v1/products/not-an-id");
    assert.equal(invalidId.status, 400);
    const noDelete = await request(`/api/v1/products/${productId}`, {
      method: "DELETE",
    });
    assert.equal(noDelete.status, 404);

    const updated = await request(`/api/v1/products/${productId}`, {
      method: "PATCH",
      body: JSON.stringify({
        lifecycleStatus: "paused",
        internalNotes: "Review pricing.",
        currency: "gbp",
        additionalDomains: ["vamberic.com", "app.vamberic.com"],
        id: "product_00000000000000000000000000",
        createdAt: "2000-01-01T00:00:00.000Z",
        schemaVersion: 99,
        archived: true,
        archivedAt: "2000-01-01T00:00:00.000Z",
      }),
    });
    assert.equal(updated.status, 200);
    assert.equal(
      (updated.body as Record<string, unknown>).lifecycleStatus,
      "paused",
    );

    const summary = await request("/api/v1/dashboard/summary");
    assert.equal(summary.status, 200);
    assert.deepEqual(summary.body, {
      totalProducts: 1,
      activeProducts: 0,
      draftOrInactiveProducts: 1,
      totalOrganisations: 0,
      totalPeople: 0,
      totalOpportunities: 0,
    });

    const products = memoryDb.collection(
      "products",
    ) as unknown as MemoryCollection<Product>;
    const storedProduct = await products.findOne({ id: productId });
    assert.equal(storedProduct?.internalNotes, "Review pricing.");
    assert.equal(storedProduct?.id, productId);
    assert.equal(storedProduct?.currency, "GBP");
    assert.deepEqual(storedProduct?.additionalDomains, [
      "vamberic.com",
      "app.vamberic.com",
    ]);
    assert.equal(
      storedProduct?.createdAt.toISOString(),
      (created.body as Record<string, unknown>).createdAt,
    );
    assert.equal(storedProduct?.schemaVersion, 1);
    assert.equal(storedProduct?.archived, false);
    assert.equal(storedProduct?.archivedAt, undefined);
    assert.ok(storedProduct?.createdAt instanceof Date);
    assert.ok(storedProduct?.updatedAt instanceof Date);
    assert.ok(
      storedProduct &&
        storedProduct.updatedAt.getTime() >= storedProduct.createdAt.getTime(),
    );
    // Both software and non-software products use the same contract.
    for (const productType of ["software", "agency"]) {
      const added = await request("/api/v1/products", {
        method: "POST",
        body: JSON.stringify({
          ...validInput,
          slug: `${productType}-example`,
          productType,
          lifecycleStatus: "live",
          operatingMode: "listen",
          revenueModels: ["one_off", "retainer"],
          primaryDomain: "example.agency",
          additionalDomains: ["extra.example", "second.example"],
          plannedLaunchDate: "2026-10-01",
          launchHypothesis: "Test specialist demand",
          successMeasures: "Qualified enquiries",
        }),
      });
      assert.equal(added.status, 201);
      const item = added.body as Record<string, unknown>;
      assert.equal(item.currency, "GBP");
      assert.equal(item.actualLaunchDate, null);
      const reloaded = await request(`/api/v1/products/${item.id}`);
      assert.deepEqual(reloaded.body, added.body);
      assert.deepEqual(item.revenueModels, ["one_off", "retainer"]);
      assert.equal(item.primaryDomain, "example.agency");
      assert.deepEqual(item.additionalDomains, [
        "extra.example",
        "second.example",
      ]);
      assert.equal(item.lifecycleStatus, "live");
      assert.equal(item.operatingMode, "listen");
      assert.equal(item.launchHypothesis, "Test specialist demand");
      assert.equal(item.successMeasures, "Qualified enquiries");
      assert.equal(item.plannedLaunchDate, "2026-10-01");
      const changed = await request(`/api/v1/products/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          operatingMode: "maintain",
          actualLaunchDate: "2026-10-02",
        }),
      });
      assert.equal(
        (changed.body as Record<string, unknown>).lifecycleStatus,
        "live",
      );
      assert.equal(
        (changed.body as Record<string, unknown>).operatingMode,
        "maintain",
      );
      const cleared = await request(`/api/v1/products/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          revenueModels: [],
          primaryDomain: null,
          additionalDomains: [],
          actualLaunchDate: null,
          plannedLaunchDate: null,
          operatingMode: null,
          launchHypothesis: null,
          successMeasures: null,
          businessModel: null,
        }),
      });
      assert.equal(cleared.status, 200);
      assert.equal(
        (cleared.body as Record<string, unknown>).actualLaunchDate,
        null,
      );
      assert.deepEqual(
        (cleared.body as Record<string, unknown>).revenueModels,
        [],
      );
    }

    const legacy = {
      id: "product_00000000000000000000000001",
      name: "Existing product",
      slug: "existing-product",
      status: "active",
      productType: "assessment",
      commercialModel: "freemium",
      currency: "USD",
      oneOffPurchaseAvailable: true,
      subscriptionAvailable: true,
      domains: ["first.example", "second.example"],
      createdAt: new Date("2025-01-01"),
      updatedAt: new Date("2025-01-01"),
      internalNotes: "Keep this",
      unknownFutureField: { keep: true },
    };
    await memoryDb.collection("products").insertOne(legacy);
    const oldDetail = await request(`/api/v1/products/${legacy.id}`);
    assert.equal(oldDetail.status, 200);
    const old = oldDetail.body as Record<string, unknown>;
    assert.equal(old.lifecycleStatus, null);
    assert.equal(old.productType, null);
    assert.equal(old.currency, "USD");
    assert.deepEqual(old.revenueModels, ["one_off", "subscription"]);
    assert.deepEqual(old.additionalDomains, legacy.domains);
    assert.equal(old.primaryDomain, null);
    assert.ok((old.migrationWarnings as string[]).length);
    const oldEdited = await request(`/api/v1/products/${legacy.id}`, {
      method: "PATCH",
      body: JSON.stringify({ description: "An unrelated edit" }),
    });
    assert.equal(oldEdited.status, 200);
    const preserved = await memoryDb
      .collection("products")
      .findOne({ id: legacy.id });
    assert.equal(preserved?.currency, "USD");
    assert.equal(preserved?.status, "active");
    assert.deepEqual(preserved?.domains, legacy.domains);
    assert.deepEqual(preserved?.unknownFutureField, { keep: true });
    assert.deepEqual(preserved?.legacyProductData, legacy);
    assert.deepEqual(preserved?.createdAt, legacy.createdAt);
    assert.equal((await request("/api/v1/products")).status, 200);
    assert.equal((await request("/api/v1/dashboard/summary")).status, 200);
  } finally {
    server.close();
    await once(server, "close");
  }
});
