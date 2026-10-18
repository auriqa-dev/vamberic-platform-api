import assert from "node:assert/strict";
import { test } from "node:test";
import {
  discoveryStep,
  startDiscovery,
  ingestionRecommendation,
  sitemapEntries,
  pageLocale,
  eligibleUrl,
} from "../src/services/content-strategy/library-discovery";
import {
  requirementsForOffers,
  assessRequirement,
  sharedRequirements,
  type OfferPlanningSource,
} from "../src/services/content-strategy/library-planning";
import { assetData, record } from "../src/services/content-strategy/model";
import { releaseDatabaseTarget } from "../src/db/setup";
import type { WebsiteTransport } from "../src/services/psu/page-reader";
const origin = "https://example.com";
function transport(pages: Record<string, string>) {
  const calls: string[] = [];
  const result: WebsiteTransport = {
    resolve: async () => ["8.8.8.8"],
    read: async ({ url }) => {
      calls.push(url);
      if (!(url in pages)) throw new Error("not found");
      return { access: "allowed", text: pages[url]!, title: "" };
    },
  };
  return { result, calls };
}
test("small-site sitemap discovery persists URLs without retrieving their contents", async () => {
  const fake = transport({
    [origin + "/robots.txt"]: "User-agent: *\nDisallow: /private",
    [origin + "/"]:
      "<html lang='en-GB'><title>Example</title><main>Evidence guide</main></html>",
    [origin + "/sitemap.xml"]:
      `<urlset>${Array.from({ length: 100 }, (_, i) => `<url><loc>${origin}/guide-${i}</loc></url>`).join("")}</urlset>`,
  });
  let state = startDiscovery(origin + "/", "brand");
  while (state.status === "running")
    state = await discoveryStep(state, fake.result);
  assert.equal(state.pages.length, 101);
  assert.equal(ingestionRecommendation(state).mode, "comprehensive");
  assert.equal(fake.calls.filter((u) => u.includes("guide-")).length, 0);
  assert.ok(state.pages.every((p) => !("text" in p)));
  const again = await discoveryStep(state, fake.result);
  assert.deepEqual(again, state);
});
test("large multilingual sitemap index recommends selective ingestion", async () => {
  const fake = transport({
    [origin + "/robots.txt"]: "User-agent: *\nAllow: /",
    [origin + "/"]: "<main>Example</main>",
    [origin + "/sitemap.xml"]:
      `<sitemapindex><sitemap><loc>${origin}/products.xml</loc></sitemap></sitemapindex>`,
    [origin + "/products.xml"]:
      `<urlset>${Array.from({ length: 1500 }, (_, i) => `<url><loc>${origin}/${i % 2 ? "de-de" : "en-gb"}/product-${i}</loc></url>`).join("")}</urlset>`,
  });
  let state = startDiscovery(origin + "/", "brand");
  while (state.status === "running")
    state = await discoveryStep(state, fake.result);
  assert.equal(state.pages.length, 1501);
  assert.equal(ingestionRecommendation(state).mode, "selective");
  assert.deepEqual(ingestionRecommendation(state).languages.sort(), [
    "de",
    "en",
  ]);
  assert.equal(fake.calls.filter((u) => u.includes("product-")).length, 0);
});
test("discovery excludes external, unsafe, technical and robots-blocked URLs", () => {
  assert.equal(eligibleUrl("http://127.0.0.1/", origin), undefined);
  assert.equal(eligibleUrl("https://other.test/", origin), undefined);
  assert.equal(eligibleUrl(origin + "/search?q=private", origin), undefined);
  assert.throws(() =>
    sitemapEntries(
      '<!DOCTYPE foo [<!ENTITY x SYSTEM "file:///etc/passwd">]><urlset/>',
    ),
  );
  const meta = pageLocale(
    `<html lang="en-GB"><link rel="alternate" hreflang="de-DE" href="/de/guide">`,
    origin + "/guide",
  );
  assert.equal(meta.language, "en");
  assert.equal(meta.region, "GB");
  assert.equal(meta.alternates[0]?.url, origin + "/de/guide");
});
const source = (id: string): OfferPlanningSource => ({
  id,
  revision: 1,
  brandId: "brand",
  active: true,
  name: id,
  audienceIds: [],
  buyerIds: [],
  messages: [],
  evidence: ["Evidence for procurement operating cost reductions"],
  questions: [],
});
test("three offers share one asset and unchanged requirements retain stable identities", () => {
  const sources = [source("one"), source("two"), source("three")],
    requirements = requirementsForOffers(sources);
  assert.equal(sharedRequirements(requirements).length, 1);
  assert.equal(sharedRequirements(requirements)[0]!.offerIds.length, 3);
  const data = assetData.parse({
    title: "Procurement operating cost reductions",
    classification: "core",
    assetType: "report",
    channel: "",
    url: "",
    text: "Evidence for procurement operating cost reductions",
    description: "",
    sourceDocumentId: "",
    sourceAssetIds: [],
    scope: { brandId: "brand", offers: [], products: [], audiences: [] },
    topics: [],
    buyerStages: [],
    claims: [],
    evidence: [],
    gaps: [],
    reuse: [],
    restrictions: [],
    analysisStatus: "reviewed",
    contentHash: "hash",
    usageRights: "owned",
    allowedUses: ["internal evidence"],
    associations: requirements.map((r) => ({
      offerId: r.offerId,
      offerRevision: 1,
      requirement: r.title,
      relevance: 1,
      reason: "Reviewed evidence",
      decision: "accepted",
      contextHash: r.contextHash,
      contentHash: "hash",
    })),
  });
  const asset = record.parse({
    id: "asset",
    kind: "asset",
    version: 1,
    status: "approved",
    updatedAt: new Date().toISOString(),
    fingerprint: "hash",
    sourceVersions: [],
    data,
  });
  for (const r of requirements)
    assert.equal(assessRequirement(r, [asset], []).status, "available");
  const revised = requirementsForOffers([{ ...sources[0]!, revision: 2 }])[0]!;
  assert.equal(revised.key, requirements[0]!.key);
  assert.equal(
    assessRequirement(revised, [asset], []).status,
    "needs_improvement",
  );
  assert.equal(
    assessRequirement({ ...requirements[0]!, brandId: "other" }, [asset], [])
      .status,
    "missing",
  );
  assert.equal(
    sharedRequirements(
      requirementsForOffers(sources.map((o) => ({ ...o, active: false }))),
    ).length,
    0,
  );
});
test("v28 adds only Library storage collections and leaves all prior validators unchanged", () => {
  const before = releaseDatabaseTarget(27),
    after = releaseDatabaseTarget(28);
  assert.equal(after.collections.length, before.collections.length + 2);
  for (const key of Object.keys(before.validators))
    assert.deepEqual(after.validators[key], before.validators[key]);
  assert.ok(after.validators.library_discovery);
});

test("v28 dry run and repeated apply are additive and preserve existing records", async () => {
  const { FakeDb } = await import("./helpers/commercial-migration-db");
  const { createDatabaseSetup } = await import("../src/db/setup");
  const db = new FakeDb();
  await createDatabaseSetup(releaseDatabaseTarget(27)).setupDatabase(
    db as never,
  );
  const before = [...db.collections].map(
    ([name, c]) => [name, structuredClone(c.documents)] as const,
  );
  const setup = createDatabaseSetup(releaseDatabaseTarget(28)),
    count = db.mutationCount;
  const plan = await setup.planDatabaseSetup(db as never);
  assert.equal(db.mutationCount, count);
  assert.deepEqual([...plan.collectionsToCreate].sort(), [
    "library_discovery",
    "library_text",
  ]);
  assert.deepEqual(plan.validatorConflicts, []);
  await setup.setupDatabase(db as never);
  await setup.setupDatabase(db as never);
  const after = await setup.planDatabaseSetup(db as never);
  assert.equal(after.existingSchemaVersion, 28);
  assert.deepEqual(after.indexesToCreate, []);
  assert.deepEqual(after.validatorsToApply, []);
  for (const [name, records] of before)
    if (name !== "schema_versions")
      assert.deepEqual(db.collection(name).documents, records);
});

test("discovery normalises bare hosts without rewriting explicit schemes", async () => {
  const {normaliseDiscoveryUrl}=await import("../src/services/content-strategy/library");
  assert.equal(normaliseDiscoveryUrl(" www.example.com "),"https://www.example.com");
  assert.equal(normaliseDiscoveryUrl("https://example.com/guide"),"https://example.com/guide");
  assert.equal(normaliseDiscoveryUrl("file:///etc/passwd"),"file:///etc/passwd");
});
