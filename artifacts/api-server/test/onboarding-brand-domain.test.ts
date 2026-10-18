import assert from "node:assert/strict";
import { test } from "node:test";
import { EnquiryMemoryDb } from "./helpers/enquiry-db";
import {
  onboardingWebsiteDomain,
  readOnboardingBrandDomain,
} from "../src/services/onboarding-brand-domain";
test("onboarding URL becomes a domain without accepting credentials or non-web schemes", () => {
  assert.equal(
    onboardingWebsiteDomain("https://www.odyssiant.ai/about"),
    "www.odyssiant.ai",
  );
  for (const value of [
    "ftp://example.com",
    "https://user:pass@example.com",
    "bad",
  ])
    assert.equal(onboardingWebsiteDomain(value), undefined);
});
test("legacy website lookup is bound to both the created workspace and brand and never writes", async () => {
  const db = new EnquiryMemoryDb();
  const records = db.rows("client_onboardings");
  records.push({
    result: { workspaceId: "workspace-a", brandId: "brand-a" },
    details: { intake: { websiteUrl: "https://www.odyssiant.ai/" } },
  });
  const before = structuredClone(records);
  assert.equal(
    await readOnboardingBrandDomain(db as never, "workspace-a", "brand-a"),
    "www.odyssiant.ai",
  );
  assert.equal(
    await readOnboardingBrandDomain(db as never, "workspace-b", "brand-a"),
    undefined,
  );
  assert.equal(
    await readOnboardingBrandDomain(db as never, "workspace-a", "brand-b"),
    undefined,
  );
  assert.deepEqual(records, before);
  records.push(structuredClone(records[0]));
  assert.equal(
    await readOnboardingBrandDomain(db as never, "workspace-a", "brand-a"),
    undefined,
  );
});
