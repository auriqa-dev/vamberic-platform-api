import assert from "node:assert/strict";
import { test } from "node:test";
import { BSON } from "mongodb";
import { BrandSchema } from "../src/domain";
import { queenClientBase } from "../src/services/hvm-queen-provision";
for (const domain of [undefined, "example.com"]) {
  test(`provisioned brand survives Mongo serialization with domain ${domain ?? "absent"}`, () => {
    const { records } = queenClientBase(
      {
        requestKey: "local-check",
        organisationName: "Local Check",
        workspaceName: "Local Check",
        brandName: "Local Check",
        brandSlug: "local-check",
        ...(domain ? { brandPrimaryDomain: domain } : {}),
      },
      "partner_" + "1".repeat(26),
      { type: "human", id: "local-check", issuer: "https://example.invalid" },
      new Date(),
    );
    const brand = records.find(([name]) => name === "brands")![1];
    const persisted = BSON.deserialize(
      BSON.serialize(brand, { ignoreUndefined: false }),
    );
    assert.equal(BrandSchema.safeParse(persisted).success, true);
    assert.equal(
      Object.hasOwn(persisted, "primaryDomain"),
      domain !== undefined,
    );
    if (domain) assert.equal(persisted.primaryDomain, domain);
  });
}
