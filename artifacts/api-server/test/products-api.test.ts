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
          if (!field || typeof value !== "object" || value === null) return false;
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

  async replaceOne(filter: { id: string }, record: T): Promise<void> {
    const index = this.records.findIndex((item) => item.id === filter.id);
    if (index >= 0) this.records[index] = record;
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
  readonly collections = new Map<string, MemoryCollection<Record<string, unknown>>>();

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
  const server = createServer(createApp(config, mongo));
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
        ...init?.headers,
      },
    });
    return {
      status: response.status,
      body: (await response.json()) as Record<string, unknown> | unknown[],
    };
  };

  try {
    const created = await request("/api/v1/products", {
      method: "POST",
      body: JSON.stringify({
        name: "Energy Health Check",
        slug: "energy-health-check",
        status: "active",
        productType: "assessment",
        commercialModel: "one-off",
        description: "A practical energy assessment.",
      }),
    });
    assert.equal(created.status, 201);
    assert.match(
      String((created.body as Record<string, unknown>).id),
      /^product_[0-7][0-9abcdefghjkmnpqrstvwxyz]{25}$/,
    );
    const productId = String((created.body as Record<string, unknown>).id);

    const list = await request("/api/v1/products?search=energy&status=active");
    assert.equal(list.status, 200);
    assert.equal((list.body as unknown[]).length, 1);

    const detail = await request(`/api/v1/products/${productId}`);
    assert.equal(detail.status, 200);
    assert.equal((detail.body as Record<string, unknown>).slug, "energy-health-check");

    const updated = await request(`/api/v1/products/${productId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "paused", internalNotes: "Review pricing." }),
    });
    assert.equal(updated.status, 200);
    assert.equal((updated.body as Record<string, unknown>).status, "paused");

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

    const products = memoryDb.collection("products") as unknown as MemoryCollection<Product>;
    assert.equal((await products.findOne({ id: productId }))?.internalNotes, "Review pricing.");
  } finally {
    server.close();
    await once(server, "close");
  }
});