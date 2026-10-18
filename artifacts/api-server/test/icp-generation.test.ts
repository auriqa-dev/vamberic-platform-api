import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createIcpGenerator,
  ICP_MODEL,
  recoverIcpDefinition,
  icpContext,
} from "../src/services/icp/generate";
const input = {
  profileType: "b2b" as const,
  instructions: "Target mid-market",
  product: { name: "Service" },
  examples: [],
};
const config = { apiKey: "test", project: "proj_test", model: ICP_MODEL };
test("one compact request uses multiple customer pages as hypotheses without per-field verification", async () => {
  let calls = 0;
  const urls: string[] = [];
  const generate = createIcpGenerator(
    config,
    async (_url, init) => {
      calls++;
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, ICP_MODEL);
      assert.deepEqual(body.reasoning, { effort: "none" });
      assert.match(body.input[0].content, /British English/);
      assert.equal(body.max_output_tokens, 3500);
      const context = JSON.parse(body.input[1].content);
      assert.equal(context.customerWebsite.length, 2);
      assert.match(body.input[0].content, /decision-maker job titles/);
      return new Response(
        JSON.stringify({
          status: "completed",
          model: ICP_MODEL,
          usage: { input_tokens: 100, output_tokens: 200 },
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    definition: {
                      name: "Operations leaders",
                      description: "Buyers of this service",
                      profileType: "b2b",
                      accountProfile: {},
                      characteristics: ["Role: Operations director"],
                    },
                    rationale: "A targeting hypothesis for review",
                  }),
                },
              ],
            },
          ],
        }),
      );
    },
    {
      resolve: async () => ["93.184.216.34"],
      read: async ({ url }) => {
        urls.push(url);
        return {
          access: "allowed",
          decodedBytes: 40,
          text: "Industrial services company",
          title: "Customer",
        };
      },
    },
  );
  const result = await generate(
    {
      ...input,
      customerUrls: ["https://one.example.com/", "https://two.example.com/"],
    },
    new AbortController().signal,
  );
  assert.equal(calls, 1);
  assert.equal(urls.length, 2);
  assert.deepEqual(result.definition.characteristics, [
    "Role: Operations director",
  ]);
});
test("private customer URLs never reach HTTP or AI", async () => {
  let calls = 0;
  const generate = createIcpGenerator(
    config,
    async () => {
      calls++;
      throw new Error("must not call");
    },
    {
      resolve: async () => ["127.0.0.1"],
      read: async () => {
        calls++;
        throw new Error("must not read");
      },
    },
  );
  await assert.rejects(
    generate(
      { ...input, customerUrls: ["https://customer.example.com/"] },
      new AbortController().signal,
    ),
  );
  assert.equal(calls, 0);
});

test("ICP keeps valid optional entries and rejects wrong profile identity", () => {
  const result = recoverIcpDefinition({
    name: "Buyers",
    description: "A draft",
    profileType: "b2b",
    characteristics: ["Operations director", 42],
    accountProfile: { industries: ["Manufacturing", null] },
  });
  assert.deepEqual(result.characteristics, ["Operations director"]);
  assert.deepEqual(result.accountProfile?.industries, ["Manufacturing"]);
  assert.match(result.unknowns!.join(" "), /Review/);
  assert.throws(() =>
    recoverIcpDefinition({
      name: "Buyers",
      description: "A draft",
      profileType: "invalid",
    }),
  );
});

test("supporting-context limits keep full user instructions and disclose excerpts", () => {
  const notes: string[] = [];
  const context = icpContext(
    {
      ...input,
      instructions: "Exact user direction",
      offerResearch: { huge: "x".repeat(80000) },
    },
    [],
    notes,
  );
  assert.equal(context.instructions, "Exact user direction");
  assert.ok(JSON.stringify(context).length < 15000);
  assert.ok(notes.some((n) => n.includes("offerResearch")));
});
test("unavailable optional customer pages preserve useful generation with a review note", async () => {
  const generate = createIcpGenerator(
    config,
    async () =>
      new Response(
        JSON.stringify({
          status: "completed",
          model: ICP_MODEL,
          usage: { input_tokens: 10, output_tokens: 20 },
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    definition: {
                      name: "Buyers",
                      description: "Draft",
                      profileType: "b2b",
                      researchCriteria: [
                        "Hypothesis: demand stress; evidence required",
                      ],
                      adoptionReadiness: ["Can act on recommendations"],
                      targetingCoverage: ["User direction incorporated"],
                    },
                    rationale: "For review",
                  }),
                },
              ],
            },
          ],
        }),
      ),
    {
      resolve: async () => ["93.184.216.34"],
      read: async () => {
        throw new Error("Website timeout");
      },
    },
  );
  const result = await generate(
    { ...input, customerUrls: ["https://customer.example.com/"] },
    new AbortController().signal,
  );
  assert.equal(result.definition.name, "Buyers");
  assert.match(result.definition.unknowns!.join(" "), /could not be read/);
  assert.equal(result.definition.researchCriteria?.length, 1);
});

for (const method of [
  "value-equation-v1",
  "value-proposition-development-v1",
]) {
  for (const failure of [
    new Error("Public page unavailable or unsupported"),
    new Error("Public page transport unavailable"),
    new DOMException("Timed out", "TimeoutError"),
  ]) {
    test(`${method}: optional example ${failure.name}/${failure.message} preserves approved offer and full targeting`, async () => {
      const instructions =
        "Enterprise targeting and evidence requirements. ".repeat(75);
      const offer = {
        id: method,
        revision: 1,
        definition: { name: method, methodology: method },
      };
      let calls = 0;
      const generate = createIcpGenerator(
        config,
        async (_url, init) => {
          calls++;
          const body = JSON.parse(String(init?.body));
          const context = JSON.parse(body.input[1].content);
          assert.equal(context.instructions, instructions);
          assert.deepEqual(context.offer, offer);
          assert.deepEqual(context.examples, [
            { name: "Equans", reason: "Complex offerings" },
          ]);
          assert.equal(context.customerWebsite.length, 1);
          assert.equal(
            context.customerWebsite[0].url,
            "https://available.example.com/",
          );
          assert.match(
            context.sourceLimitations.join(" "),
            /could not be read/,
          );
          return new Response(
            JSON.stringify({
              status: "completed",
              model: ICP_MODEL,
              usage: { input_tokens: 10, output_tokens: 20 },
              output: [
                {
                  type: "message",
                  content: [
                    {
                      type: "output_text",
                      text: JSON.stringify({
                        definition: {
                          name: "Enterprise buyers",
                          description: "Draft",
                          profileType: "b2b",
                        },
                        rationale: "For review",
                      }),
                    },
                  ],
                },
              ],
            }),
          );
        },
        {
          resolve: async () => ["93.184.216.34"],
          read: async ({ url }) => {
            if (url.includes("unavailable")) throw failure;
            return {
              access: "allowed",
              decodedBytes: 20,
              text: "Public company",
              title: "Example",
            };
          },
        },
      );
      const result = await generate(
        {
          ...input,
          instructions,
          offer,
          examples: [{ name: "Equans", reason: "Complex offerings" }],
          customerUrls: [
            "https://unavailable.example.com/",
            "https://available.example.com/",
          ],
        },
        new AbortController().signal,
      );
      assert.equal(calls, 1);
      assert.match(
        result.definition.unknowns!.join(" "),
        /unavailable.example.com/,
      );
    });
  }
}
test("optional page recovery does not swallow cancellation or security failures", async () => {
  for (const security of [
    "Non-public destination",
    "TLS hostname mismatch",
    "Unexpected failure",
  ]) {
    let calls = 0;
    const generate = createIcpGenerator(
      config,
      async () => {
        calls++;
        throw Error("must not call");
      },
      {
        resolve: async () => ["93.184.216.34"],
        read: async () => {
          throw Error(security);
        },
      },
    );
    await assert.rejects(
      generate(
        { ...input, customerUrls: ["https://customer.example.com/"] },
        new AbortController().signal,
      ),
    );
    assert.equal(calls, 0);
  }
  const controller = new AbortController();
  let calls = 0;
  const generate = createIcpGenerator(
    config,
    async () => {
      calls++;
      throw Error("must not call");
    },
    {
      resolve: async () => ["93.184.216.34"],
      read: async () => {
        controller.abort();
        throw Error("Public page transport unavailable");
      },
    },
  );
  await assert.rejects(
    generate(
      { ...input, customerUrls: ["https://customer.example.com/"] },
      controller.signal,
    ),
  );
  assert.equal(calls, 0);
});
