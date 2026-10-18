import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import {
  emailAssets,
  safeDestination,
  validateEmailBody,
} from "../src/services/email-content/selection";
import { createEmailContent } from "../src/services/email-content/service";
import {
  assetData,
  type ContentRecord,
} from "../src/services/content-strategy/model";
import { EnquiryMemoryDb } from "./helpers/enquiry-db";
import { parseConfig } from "../src/config";
import { authEnvironment, testIssuer } from "./helpers/auth";
import { provisionHvmClient } from "../src/services/hvm-provision";
import { generatePlatformId, EventInsertSchema } from "../src/domain";
const config = parseConfig({
  ...authEnvironment,
  HVM_COGNITO_CLIENT_ID: "hvmclient",
  DEPLOYMENT_ENV: "test",
  MONGODB_URI: "mongodb://unused.invalid",
});
function asset(brand: string): ContentRecord {
  return {
    id: "asset",
    version: 1,
    kind: "asset",
    status: "approved",
    updatedAt: new Date().toISOString(),
    fingerprint: "asset",
    sourceVersions: [],
    data: assetData.parse({
      title: "Compare approaches",
      classification: "core",
      assetType: "page",
      channel: "website",
      url: "https://example.com/compare",
      text: "Evidence-based comparison",
      description: "Compare options",
      sourceDocumentId: "",
      sourceAssetIds: [],
      scope: { brandId: brand, products: [], offers: [], audiences: [] },
      topics: [],
      buyerStages: [],
      claims: [],
      evidence: [],
      gaps: [],
      reuse: [],
      restrictions: [],
      usageRights: "owned",
      allowedUses: ["email"],
      visibility: "published",
      analysisStatus: "reviewed",
      sourceMetadata: {
        canonicalUrl: "https://example.com/compare",
        checkedAt: new Date().toISOString(),
        headings: [],
        producer: "",
        briefId: "",
        briefVersion: 0,
        capabilityId: "",
        integrationId: "",
      },
    }),
  };
}
function brief(brand: string): ContentRecord {
  return {
    id: "brief",
    version: 1,
    kind: "brief",
    status: "approved",
    updatedAt: new Date().toISOString(),
    fingerprint: "brief",
    sourceVersions: [],
    data: {
      title: "Introduction",
      channel: "email",
      cta: "Read comparison",
      sourceAssetIds: ["asset"],
      scope: { brandId: brand, products: [], offers: [], audiences: [] },
    },
  };
}
test("CTA eligibility excludes private, unapproved, stale and unrelated pages", () => {
  const b = brief("brand"),
    a = asset("brand");
  assert.equal(emailAssets([a], b).length, 1);
  for (const patch of [
    { visibility: "private" },
    { allowedUses: [] },
    { archived: true },
    { scope: { brandId: "other", products: [], offers: [], audiences: [] } },
    {
      scope: {
        brandId: "brand",
        products: [],
        offers: [{ id: "other", revision: 1 }],
        audiences: [],
      },
    },
    { sourceMetadata: { checkedAt: "2020-01-01" } },
  ])
    assert.equal(
      emailAssets([{ ...a, data: { ...a.data, ...patch } }], b).length,
      0,
    );
  assert.equal(emailAssets([{ ...a, status: "draft" }], b).length, 0);
  assert.equal(
    emailAssets([{ ...a, sourceVersions: [{ id: "missing", version: 1 }] }], b)
      .length,
    0,
  );
  for (const url of [
    "javascript:alert(1)",
    "https://127.0.0.1/a",
    "https://foo.local/a",
    "https://user:pass@example.com/a",
  ])
    assert.equal(safeDestination(url), false);
  assert.equal(validateEmailBody("Read https://invented.test"), false);
  assert.equal(validateEmailBody("<a href='/x'>Go</a>"), false);
});
async function fixture() {
  const db = new EnquiryMemoryDb(),
    w = generatePlatformId("workspace"),
    brand = generatePlatformId("brand"),
    person = generatePlatformId("person"),
    user = { subject: "owner", issuer: testIssuer, clientId: "hvmclient" };
  db.rows("schema_versions").push({ _id: "vapp-v1", version: 29 });
  await provisionHvmClient(
    db.mongo,
    {
      organisationId: generatePlatformId("org"),
      organisationName: "Fixture",
      workspaceId: w,
      management: "client",
      brandId: brand,
      clientMembershipId: generatePlatformId("workspacemembership"),
      workspaceName: "Fixture",
      brandName: "Fixture",
      brandSlug: "fixture",
      human: { type: "human", id: user.subject, issuer: user.issuer },
    },
    testIssuer,
  );
  db.rows("people").push({
    id: person,
    workspaceId: w,
    firstName: "Taylor",
    lastName: "Example",
    updatedAt: new Date(),
    archived: false,
  });
  for (const r of [brief(brand), asset(brand)])
    db.rows("events").push({
      id: randomUUID(),
      workspaceId: w,
      eventType: "content_strategy_record",
      payload: { record: r },
    });
  let calls = 0;
  const service = createEmailContent(config, db.mongo, async (task, input) => {
    calls++;
    assert.equal(task, "email");
    assert.ok(JSON.stringify(input).includes("Compare approaches"));
    return {
      result: {
        subject: "A useful comparison",
        body: "Hello Taylor,\nHere is an overview of the available approaches.",
        ctaAssetId: "asset",
        ctaText: "Read the comparison",
        ctaRationale: "Matches the brief",
        reviewIssues: [],
      },
      usage: { model: "test", inputTokens: 10, outputTokens: 20 },
    };
  });
  const request = {
    requestKey: randomUUID(),
    briefId: "brief",
    briefVersion: 1,
    contactId: person,
    instruction: "Introduce the offer",
  };
  return { db, w, brand, person, user, service, request, calls: () => calls };
}
test("generation saves a draft and private Library asset, with replay and review lifecycle", async () => {
  const f = await fixture(),
    r = await f.service.generate(f.user, f.w, f.request);
  assert.equal(r.status, "draft");
  assert.equal(r.ctaUrl, "https://example.com/compare");
  assert.match(r.brandNotice, /neutral British English/);
  assert.equal((await f.service.list(f.user, f.w)).records[0]?.id, r.id);
  assert.equal((await f.service.generate(f.user, f.w, f.request)).id, r.id);
  assert.equal(f.calls(), 1);
  const registered = f.db
    .rows("events")
    .find(
      (e) =>
        e.eventType === "content_strategy_record" &&
        e.payload.record.id === r.libraryAssetId,
    )!.payload.record;
  assert.equal(registered.status, "draft");
  assert.equal(registered.data.visibility, "private");
  assert.deepEqual(registered.data.allowedUses, []);
  const approved = await f.service.mutate(f.user, f.w, r.id, {
    requestKey: randomUUID(),
    expectedVersion: 1,
    operation: "approve",
  });
  assert.equal(approved.status, "approved");
  const edited = await f.service.mutate(f.user, f.w, r.id, {
    requestKey: randomUUID(),
    expectedVersion: 2,
    operation: "save",
    content: { ...r.content, subject: "Edited" },
  });
  assert.equal(edited.status, "draft");
  await assert.rejects(() =>
    f.service.mutate(f.user, f.w, r.id, {
      requestKey: randomUUID(),
      expectedVersion: 1,
      operation: "remove",
    }),
  );
  await f.service.mutate(f.user, f.w, r.id, {
    requestKey: randomUUID(),
    expectedVersion: 3,
    operation: "remove",
  });
  assert.equal((await f.service.list(f.user, f.w)).records.length, 0);
  assert.equal((await f.service.history(f.user, f.w, r.id)).length, 4);
});
test("foreign users, mismatched keys, stale context and cancelled NBA guards are rejected", async () => {
  const f = await fixture();
  await assert.rejects(() =>
    f.service.generate({ ...f.user, subject: "foreign" }, f.w, f.request),
  );
  assert.equal(f.calls(), 0);
  await assert.rejects(() =>
    f.service.generate(f.user, f.w, f.request, async () => {
      throw new Error("Cancelled");
    }),
  );
  assert.equal(f.calls(), 0);
  await f.service.generate(f.user, f.w, f.request);
  await assert.rejects(() =>
    f.service.generate(f.user, f.w, { ...f.request, instruction: "Different" }),
  );
  assert.equal(f.calls(), 1);
  const r = (await f.service.list(f.user, f.w)).records[0]!;
  f.db.rows("people")[0]!.updatedAt = new Date(Date.now() + 1000);
  await assert.rejects(
    () =>
      f.service.mutate(f.user, f.w, r.id, {
        requestKey: randomUUID(),
        expectedVersion: 1,
        operation: "approve",
      }),
    /Context changed/,
  );
});
test("generic event writes cannot forge email records", () => {
  for (const eventType of ["email_content_record", "email_content_generation"])
    assert.equal(
      EventInsertSchema.safeParse({
        eventType,
        occurredAt: new Date(),
        payload: {},
      }).success,
      false,
    );
});

test("website ingestion, rights review and approval make a page available as the saved email CTA", async () => {
  const f = await fixture();
  const { createLibrary } =
    await import("../src/services/content-strategy/library");
  const { createContentStrategy } =
    await import("../src/services/content-strategy/application");
  const library = createLibrary(config, f.db.mongo, {
    readPage: async () =>
      ({
        text: "A researched procurement comparison",
        title: "Procurement comparison",
        description: "Practical alternatives",
        canonical: "https://example.com/procurement",
        headings: [],
        fingerprint: "comparison",
        checkedAt: new Date().toISOString(),
      }) as never,
  });
  const discovery = await library.start(f.user, f.w, {
    brandId: f.brand,
    url: "https://example.com/procurement",
    mode: "page",
    requestKey: randomUUID(),
  });
  const imported = await library.importPage(f.user, f.w, {
    id: discovery.id,
    url: "https://example.com/procurement",
    requestKey: randomUUID(),
  });
  assert.ok(imported.asset);
  assert.equal(
    (await f.service.candidates(f.user, f.w, "brief")).some(
      (r) => r.id === imported.asset!.id,
    ),
    false,
  );
  const service = createContentStrategy(config, f.db.mongo);
  const reviewed = await service.mutate(f.user, f.w, {
    id: imported.asset!.id,
    kind: "asset",
    expectedVersion: imported.asset!.version,
    operation: "save",
    requestKey: randomUUID(),
    data: {
      ...imported.asset!.data,
      visibility: "published",
      usageRights: "owned",
      allowedUses: ["email"],
      analysisStatus: "reviewed",
    },
  });
  await service.mutate(f.user, f.w, {
    id: reviewed.id,
    kind: "asset",
    expectedVersion: reviewed.version,
    operation: "approve",
    requestKey: randomUUID(),
  });
  assert.equal(
    (await f.service.candidates(f.user, f.w, "brief")).some(
      (r) => r.id === reviewed.id,
    ),
    true,
  );
  const draft = await f.service.generate(f.user, f.w, {
    ...f.request,
    ctaAssetId: reviewed.id,
  });
  assert.equal(draft.ctaUrl, "https://example.com/procurement");
  await f.service.mutate(f.user, f.w, draft.id, {
    requestKey: randomUUID(),
    expectedVersion: draft.version,
    operation: "approve",
  });
  await assert.rejects(
    () =>
      service.mutate(f.user, f.w, {
        id: draft.libraryAssetId,
        kind: "asset",
        expectedVersion: 2,
        operation: "approve",
        requestKey: randomUUID(),
      }),
    /Email Content Creation/,
  );
});

test("private email-permitted evidence supports claims but never supplies a CTA", async () => {
  const f = await fixture();
  const a = f.db.rows("events").find((e) => e.payload?.record?.id === "asset")!
    .payload.record;
  a.data.visibility = "private";
  a.data.claims = ["Reviewed procurement evidence"];
  a.data.text = "PRIVATE ORIGINAL MUST NOT BE SENT";
  let payload = "";
  const service = createEmailContent(config, f.db.mongo, async (_t, input) => {
    payload = JSON.stringify(input);
    return {
      result: {
        subject: "Practical evidence",
        body: "A useful introduction. See https://invented.example/path",
        ctaAssetId: "asset",
        ctaText: "Read it",
        ctaRationale: "Evidence",
        reviewIssues: [],
      },
      usage: { model: "test", inputTokens: 1, outputTokens: 1 },
    };
  });
  const draft = await service.generate(f.user, f.w, f.request);
  assert.equal(draft.ctaUrl, "");
  assert.ok(draft.content.reviewIssues.length);
  assert.ok(!draft.content.body.includes("https://invented"));
  assert.ok(payload.includes("Reviewed procurement evidence"));
  assert.ok(!payload.includes("PRIVATE ORIGINAL MUST NOT BE SENT"));
});
