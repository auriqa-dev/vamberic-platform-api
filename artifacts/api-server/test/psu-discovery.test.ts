import assert from "node:assert/strict";
import { test } from "node:test";
import { extractPublicPage } from "../src/services/psu/page-http";
import { supportingPages } from "../src/services/psu/page-discovery";
import { createPsuGenerator } from "../src/services/psu/generate";
test("discovers navigation/footer and alternate links without boilerplate evidence", () => {
  const p = extractPublicPage(
    '<head><link href="/llms.txt" rel="alternate"></head><nav><a href="/pricing">Prices</a></nav><main>Facts</main><footer><a href="/compare">Compare</a></footer>',
    "text/html",
  );
  assert.deepEqual(p.links, ["/llms.txt", "/pricing", "/compare"]);
  assert.equal(p.text, "Facts");
});
test("prioritises diverse same-site sources and rejects unsafe links", () => {
  assert.deepEqual(
    supportingPages(
      [
        {
          url: "https://example.com/",
          links: [
            "/platform",
            "/pricing",
            "/compare",
            "/ai-information",
            "/about",
            "/pricing?token=x",
            "https://other.com/pricing",
            "http://example.com/pricing",
            "javascript:alert(1)",
            "/pricing#plans",
          ],
        },
      ],
      ["https://example.com/"],
      5,
    ),
    [
      "https://example.com/ai-information",
      "https://example.com/pricing",
      "https://example.com/compare",
      "https://example.com/about",
      "https://example.com/platform",
    ],
  );
});
test("batches submitted and discovered URLs, retains partial evidence, makes one model call", async () => {
  let active = 0,
    peak = 0,
    calls = 0;
  const visited: string[] = [];
  let captured = "";
  const generate = createPsuGenerator(
    { apiKey: "offline", project: "proj_test", model: "offline" },
    async (_u, init) => {
      calls++;
      captured = JSON.parse(String(init?.body)).input[1].content;
      throw new Error("captured request");
    },
    {
      resolve: async () => ["93.184.216.34"],
      read: async ({ url }) => {
        active++;
        peak = Math.max(peak, active);
        visited.push(url);
        try {
          await new Promise((r) => setTimeout(r, 2));
          if (url.endsWith("/about")) throw new Error("unavailable");
          return {
            access: "allowed",
            decodedBytes: 100,
            title: "Facts",
            text: url.endsWith("/pricing")
              ? "Pricing facts"
              : url.endsWith("/compare")
                ? "Competitor facts"
                : url.endsWith("/ai-information")
                  ? "Terminology facts"
                  : "Company facts",
            links: [
              "/pricing",
              "/compare",
              "/ai-information",
              "/about",
              "/platform",
            ],
          };
        } finally {
          active--;
        }
      },
    },
  );
  await assert.rejects(() =>
    generate(
      {
        kind: "company",
        depth: "summary",
        websiteUrls: [
          "https://example.com/",
          "https://example.com/product",
          "https://example.com/ai-information",
        ],
        workingLabel: "Example",
        orientation: "",
        context: {},
      },
      new AbortController().signal,
    ),
  );
  const ctx = JSON.parse(captured);
  assert.equal(ctx.pages.length, 5);
  assert.equal(ctx.sourceCoverage.unavailable.length, 1);
  const all = ctx.sources.map((s: { text: string }) => s.text).join(" ");
  assert.match(all, /Pricing facts/);
  assert.match(all, /Competitor facts/);
  assert.match(all, /Terminology facts/);
  assert.equal(calls, 1);
  assert.equal(peak, 2);
  assert.equal(visited.length, 6);
  assert.equal(new Set(visited).size, 6);
});
