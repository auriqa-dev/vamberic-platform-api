import assert from "node:assert/strict";
import { test } from "node:test";
import { extractPublicPage } from "../src/services/psu/page-http";
import {
  pageTextDigest,
  WEBSITE_LIMITS,
  WebsitePageSchema,
} from "../src/services/psu/page-reader";
import { createPsuGenerator } from "../src/services/psu/generate";
import { digest } from "@workspace/agent-runtime-protocol";
test("large pages retain all text and enforce UTF-8 byte boundaries", () => {
  assert.equal(pageTextDigest("Small page é"), digest("Small page é"));
  const text = "é".repeat(WEBSITE_LIMITS.textBytes / 2);
  assert.equal(
    extractPublicPage(`<main>${text}</main>`, "text/html").text,
    text,
  );
  const page = {
    url: "https://example.com/",
    title: "",
    text,
    digest: pageTextDigest(text),
    retrievedAt: new Date().toISOString(),
  };
  assert.equal(WebsitePageSchema.parse(page).text, text);
  assert.throws(() => extractPublicPage(text + "a", "text/plain"));
  assert.equal(
    WebsitePageSchema.safeParse({ ...page, text: text + "a" }).success,
    false,
  );
});
test("large source reaches the AI request intact beyond the old request ceiling", async () => {
  const text = "Company product information. ".repeat(7000);
  let submitted = false;
  const generate = createPsuGenerator(
    { apiKey: "fixture", project: "proj_fixture", model: "fixture" },
    async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(JSON.parse(body.input[1].content).pages[0].text, text);
      assert.ok(Buffer.byteLength(String(init?.body)) > 131072);
      submitted = true;
      throw new Error("offline provider boundary");
    },
    {
      resolve: async () => ["93.184.216.34"],
      read: async () => ({
        access: "allowed",
        decodedBytes: Buffer.byteLength(text),
        title: "Company",
        text,
      }),
    },
  );
  await assert.rejects(
    generate(
      {
        websiteUrls: ["https://example.com/"],
        workingLabel: "Company",
        orientation: "",
        context: {},
      },
      new AbortController().signal,
    ),
    /offline provider boundary/,
  );
  assert.equal(submitted, true);
});
