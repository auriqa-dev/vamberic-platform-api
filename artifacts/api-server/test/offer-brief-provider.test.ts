import test from "node:test";
import assert from "node:assert/strict";
import {
  createOfferBriefInterpreter,
  OfferBriefProviderFailure,
} from "../src/services/offer-architecture/brief-generate";
import {
  OFFER_BRIEF_FIELDS,
  OfferBriefSchema,
} from "../src/services/offer-architecture/brief-schema";
const method = {
  id: "offermethodology_00000000000000000000000001",
  version: 1,
  rationale: "Immediate self-service subscription purchase.",
};
const brief = OfferBriefSchema.parse({
  name: "Self-Service",
  ...Object.fromEntries(OFFER_BRIEF_FIELDS.map((k) => [k, []])),
});
const selected = { existingOfferId: null, brief };
const input = {
  intent: "Recommend",
  product: {},
  existingOffers: [],
  methodologies: [method],
  recommendationOnly: selected,
};
const response = (value: unknown, status = "completed") =>
  new Response(
    JSON.stringify({
      status,
      model: "fixture",
      usage: { input_tokens: 123, output_tokens: 45 },
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: JSON.stringify(value) }],
        },
      ],
    }),
  );
test("recommendation uses compact strict output and preserves confirmed brief", async () => {
  let calls = 0;
  const interpret = createOfferBriefInterpreter(
    { apiKey: "fixture", project: "proj_fixture" },
    async (_url, init) => {
      calls++;
      const body = JSON.parse(String(init?.body));
      assert.equal(body.max_output_tokens, 700);
      assert.equal(body.text.format.type, "json_schema");
      assert.equal(body.text.format.strict, true);
      assert.deepEqual(body.text.format.schema.required, [
        "id",
        "version",
        "rationale",
      ]);
      assert.equal(body.text.format.schema.additionalProperties, false);
      return response(method);
    },
  );
  const result = await interpret(input, new AbortController().signal);
  assert.equal(calls, 1);
  assert.deepEqual(result.interpretation.offers[0]?.brief, brief);
  assert.deepEqual(
    result.interpretation.offers[0]?.methodologyRecommendation,
    method,
  );
  assert.deepEqual(result.usage, {
    model: "fixture",
    inputTokens: 123,
    outputTokens: 45,
  });
});
test("invalid recommendation is a sanitised provider failure, not invalid user input", async () => {
  const interpret = createOfferBriefInterpreter(
    { apiKey: "fixture", project: "proj_fixture" },
    async () =>
      response({
        ...method,
        version: "PRIVATE VALUE",
        secret: "PRIVATE VALUE",
      }),
  );
  await assert.rejects(
    interpret(input, new AbortController().signal),
    (e: unknown) => {
      assert.ok(e instanceof OfferBriefProviderFailure);
      assert.equal(e.diagnostic.code, "schema_validation");
      assert.ok(e.diagnostic.issues?.some((i) => i.field === "version"));
      assert.ok(!JSON.stringify(e).includes("PRIVATE VALUE"));
      assert.ok(!JSON.stringify(e).includes("secret"));
      return true;
    },
  );
});
test("incomplete provider output is recoverable and contains no provider text", async () => {
  const interpret = createOfferBriefInterpreter(
    { apiKey: "fixture", project: "proj_fixture" },
    async () => response(method, "incomplete"),
  );
  await assert.rejects(
    interpret(input, new AbortController().signal),
    OfferBriefProviderFailure,
  );
});
test("provider HTTP failure captures status without body", async () => {
  const interpret = createOfferBriefInterpreter(
    { apiKey: "fixture", project: "proj_fixture" },
    async () => new Response("PRIVATE BODY", { status: 429 }),
  );
  await assert.rejects(
    interpret(input, new AbortController().signal),
    (e: unknown) => {
      assert.ok(e instanceof OfferBriefProviderFailure);
      assert.deepEqual(e.diagnostic, {
        code: "provider_http_error",
        httpStatus: 429,
      });
      return true;
    },
  );
});

test("normal discovery still returns its full interpretation", async () => {
  const interpretation = { explanation: "Discovery", offers: [selected] };
  const interpret = createOfferBriefInterpreter(
    { apiKey: "fixture", project: "proj_fixture" },
    async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.max_output_tokens, 3500);
      assert.equal(body.text.format.type, "json_schema");
      return response(interpretation);
    },
  );
  const result = await interpret(
    { intent: "Discover", product: {}, existingOffers: [] },
    new AbortController().signal,
  );
  assert.deepEqual(result.interpretation, interpretation);
});
test("full brief uses strict structured output and preserves required null identities", async () => {
  const interpret = createOfferBriefInterpreter(
    { apiKey: "fixture", project: "proj_fixture" },
    async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.text.format.type, "json_schema");
      assert.equal(body.text.format.strict, true);
      assert.equal(body.text.format.schema.additionalProperties, false);
      return response({
        explanation: "Two options for review",
        offers: [{ ...selected, methodologyRecommendation: null }],
      });
    },
  );
  const result = await interpret(
    { intent: "Two offers", product: {}, existingOffers: [] },
    new AbortController().signal,
  );
  assert.equal(result.interpretation.offers[0]?.existingOfferId, null);
  assert.equal(
    result.interpretation.offers[0]?.methodologyRecommendation,
    undefined,
  );
});
