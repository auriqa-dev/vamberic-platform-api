import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeProduct, readProduct } from "../src/domain/product-migration";

const legacy = {
  id: "product_00000000000000000000000001",
  name: "Existing",
  slug: "existing",
  description: "Retain description",
  status: "idea",
  productType: "software",
  commercialModel: "saas",
  domains: ["example.com"],
  currency: "USD",
  internalNotes: "Keep notes",
  createdAt: new Date("2024-01-01"),
  updatedAt: new Date("2025-01-01"),
  schemaVersion: 1,
  archived: false,
  source: { system: "import" },
};

test("migration is idempotent, preserves original records, and only maps unambiguous values", () => {
  for (const status of [
    "idea",
    "validation",
    "active",
    "paused",
    "retired",
    "dormant",
    "custom",
  ]) {
    for (const oneOffPurchaseAvailable of [false, true]) {
      for (const subscriptionAvailable of [false, true]) {
        const original = {
          ...legacy,
          status,
          oneOffPurchaseAvailable,
          subscriptionAvailable,
        };
        const snapshot = structuredClone(original);
        const normalized = normalizeProduct(original);
        assert.deepEqual(original, snapshot);
        assert.deepEqual(normalized.legacyProductData, snapshot);
        assert.deepEqual(normalizeProduct(normalized), normalized);
        const product = readProduct(normalized);
        assert.equal(
          product.lifecycleStatus,
          ["idea", "paused", "retired"].includes(status) ? status : null,
        );
        assert.deepEqual(product.revenueModels, [
          ...(oneOffPurchaseAvailable ? ["one_off"] : []),
          ...(subscriptionAvailable ? ["subscription"] : []),
        ]);
        assert.equal(product.operatingMode, null);
        assert.equal(product.currency, "USD");
        assert.equal(product.primaryDomain, "example.com");
        assert.equal(product.plannedLaunchDate, null);
        assert.equal(product.actualLaunchDate, null);
        assert.deepEqual(product.createdAt, original.createdAt);
        assert.deepEqual(product.updatedAt, original.updatedAt);
      }
    }
  }
});

test("unknown classifications and domain ordering remain recoverable without guessing", () => {
  const original = {
    ...legacy,
    productType: "hardware",
    commercialModel: "freemium",
    domains: ["second.example", "first.example"],
    currency: undefined,
  };
  const product = readProduct(original);
  assert.equal(product.productType, null);
  assert.equal(product.businessModel, null);
  assert.equal(product.currency, undefined);
  assert.equal(product.primaryDomain, null);
  assert.deepEqual(product.additionalDomains, original.domains);
  assert.deepEqual(product.legacyProductData, original);
  assert.equal(product.migrationWarnings?.length, 3);
});

const reviewedEnergy = {
  ...legacy,
  id: "product_01m2t4kk2ac6687tb5fxd3q3tb",
  name: "Energy Health Check",
  slug: "energy",
  commercialModel: "paid",
  domains: [],
  currency: "GBP",
  oneOffPurchaseAvailable: true,
  subscriptionAvailable: false,
};

test("reviewed Energy purchase maps to transactional without altering legacy data", () => {
  const snapshot = structuredClone(reviewedEnergy);
  const migrated = normalizeProduct(reviewedEnergy);
  const product = readProduct(migrated);
  assert.equal(product.productType, "software");
  assert.equal(product.lifecycleStatus, "idea");
  assert.equal(product.businessModel, "transactional");
  assert.deepEqual(product.revenueModels, ["one_off"]);
  assert.equal(product.operatingMode, null);
  assert.equal(product.primaryDomain, null);
  assert.deepEqual(product.additionalDomains, []);
  assert.equal(product.currency, "GBP");
  assert.equal(product.actualLaunchDate, null);
  assert.equal(product.plannedLaunchDate, null);
  assert.deepEqual(product.migrationWarnings, []);
  assert.deepEqual(product.legacyProductData, snapshot);
  assert.deepEqual(reviewedEnergy, snapshot);
  assert.deepEqual(normalizeProduct(migrated), migrated);
});

test("paid remains ambiguous for other products or a changed Energy legacy state", () => {
  for (const change of [
    { id: legacy.id },
    { name: "Another product" },
    { slug: "another-product" },
    { status: "live" },
    { productType: "agency" },
    { commercialModel: "another-model" },
    { oneOffPurchaseAvailable: false },
    { subscriptionAvailable: true },
  ]) {
    const record = { ...reviewedEnergy, ...change };
    const product = readProduct(record);
    assert.equal(product.businessModel, null);
    assert.ok(
      product.migrationWarnings?.some((warning) =>
        warning.startsWith("Review legacy commercial model:"),
      ),
    );
    assert.deepEqual(product.legacyProductData, record);
  }
});

test("reviewed exception never rewrites an already migrated Energy product", () => {
  const migrated = {
    ...normalizeProduct(reviewedEnergy),
    businessModel: "saas",
    revenueModels: ["subscription"],
  };
  assert.deepEqual(normalizeProduct(migrated), migrated);
});
