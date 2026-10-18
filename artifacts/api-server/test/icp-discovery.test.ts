import test from "node:test";
import assert from "node:assert/strict";
import { createMarketDiscovery } from "../src/services/icp/discovery";
const candidate = {
  name: "Example",
  website: "https://example.com/",
  sourceUrl: "https://example.com/news",
  observation: "Announced an investment programme",
  uncertainty: "Budget and fit remain unverified",
};
function envelope(candidates: unknown[], search = true) {
  return {
    status: "completed",
    model: "fixture",
    usage: { input_tokens: 10, output_tokens: 20 },
    output: [
      ...(search
        ? [
            {
              type: "web_search_call",
              action: { sources: [{ url: candidate.sourceUrl }] },
            },
          ]
        : []),
      {
        type: "message",
        content: [
          { type: "output_text", text: JSON.stringify({ candidates }) },
        ],
      },
    ],
  };
}
test("discovery keeps cited suggestions and usage, drops unsupported or private URLs", async () => {
  const run = createMarketDiscovery(
    { apiKey: "fixture", project: "fixture" },
    async (_url, options) => {
      const request = JSON.parse(String(options?.body));
      assert.equal(request.input[1].content, "Public manufacturing query");
      assert.equal(request.store, false);
      assert.equal(request.model, "gpt-6-luna");
      assert.deepEqual(request.reasoning, { effort: "none" });
      return Response.json(
        envelope([
          candidate,
          { ...candidate, sourceUrl: "https://uncited.example/" },
          { ...candidate, website: "http://127.0.0.1/" },
        ]),
      );
    },
  );
  const result = await run(
    "Public manufacturing query",
    new AbortController().signal,
  );
  assert.equal(result.candidates.length, 1);
  assert.equal(result.omitted, 2);
  assert.equal(result.usage.searchCalls, 1);
});
test("discovery refuses fabricated research without an executed search", async () => {
  const run = createMarketDiscovery(
    { apiKey: "fixture", project: "fixture" },
    async () => Response.json(envelope([candidate], false)),
  );
  await assert.rejects(
    run("Find manufacturers", new AbortController().signal),
    /No public search/,
  );
});
