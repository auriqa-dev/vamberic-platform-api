import test from "node:test";
import assert from "node:assert/strict";
import {
  OfferingContentSchema as RuntimeOffering,
  PRODUCT_MANIFEST,
  productCriteria,
} from "@workspace/agent-runtime-protocol";
import { OfferingContentSchema as PlatformOffering } from "../src/domain/hive-definitions";
import { PRODUCT_POLICY } from "../src/services/product-service-understanding/profile";

test("Product Offering content matches all canonical Platform fields and boundary outcomes", () => {
  assert.deepEqual(
    Object.keys(RuntimeOffering.shape).sort(),
    Object.keys(PlatformOffering.shape).sort(),
  );
  assert.equal(Object.keys(RuntimeOffering.shape).length, 32);
  const probes: unknown[] = [
    null,
    true,
    1,
    {},
    [],
    ["x"],
    ["x", "x"],
    ...Array.from({ length: 2 }, (_, i) =>
      Array.from({ length: 40 + i }, (_, j) => String(j)),
    ),
    ...[
      "software",
      "professional_service",
      "hybrid",
      "unknown",
      "remote_service",
      "no_implementation",
      "https://example.com",
      "http://example.com",
      "ftp://example.com",
      "https://u:p@example.com",
      "  trimmed  ",
    ],
    ...[0, 1, 200, 201, 2000, 2001, 10000, 10001].map((n) => "x".repeat(n)),
  ];
  for (const field of Object.keys(RuntimeOffering.shape))
    for (const probe of probes) {
      const value = {
        name: "name",
        description: "description",
        [field]: probe,
      };
      const runtime = RuntimeOffering.safeParse(value),
        platform = PlatformOffering.safeParse(value);
      assert.equal(runtime.success, platform.success, field);
      if (runtime.success && platform.success)
        assert.deepEqual(runtime.data, platform.data);
    }
  for (const value of [
    { name: "n", description: "d" },
    { name: "n", description: "d", primaryOfferingType: "service" },
    {
      name: "n",
      description: "d",
      websiteUrl: "https://user:password@example.com",
    },
    { name: "n", description: "d", capabilities: ["duplicate", "duplicate"] },
    { name: "n", description: "d", approval: "approved" },
    { name: "n", description: "d", whatCustomerBuys: "x".repeat(10001) },
  ])
    assert.equal(
      RuntimeOffering.safeParse(value).success,
      PlatformOffering.safeParse(value).success,
    );
  assert.deepEqual(PRODUCT_MANIFEST.protocolVersions, ["1.1"]);
  assert.deepEqual(PRODUCT_MANIFEST.resultSchemaVersions, [2]);
  assert.equal(PRODUCT_POLICY.manualOverride, false);
  assert.equal(PRODUCT_POLICY.maxRevisions, 2);
  assert.equal(productCriteria().criteria.length, 15);
});
