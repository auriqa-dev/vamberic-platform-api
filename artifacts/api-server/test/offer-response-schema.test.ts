import { omitOfferNulls } from "../src/services/offer-architecture/response-schema";
import { offerMongoStructure } from "../src/db/offer-validators";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Document } from "mongodb";
import {
  OFFER_RESPONSE_SCHEMA,
  GeneratedOfferSchema,
  createOfferGenerator,
  briefKeys,
} from "../src/services/offer-architecture/generate";
import { listOfferMethodologies } from "../src/domain/offer-methodologies";

function assertStrict(schema: Document) {
  assert.ok(!("bsonType" in schema));
  if (schema.type === "object") {
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(schema.required, Object.keys(schema.properties));
    for (const child of Object.values(schema.properties))
      assertStrict(child as Document);
  }
  if (schema.items) assertStrict(schema.items);
  for (const child of schema.anyOf ?? []) assertStrict(child);
}
function fillOptionalNulls(value: Document, schema: Document): Document {
  return Object.fromEntries(
    Object.entries(schema.properties).map(([key, field]) => {
      const child = field as Document;
      return [
        key,
        key in value
          ? value[key]
          : child.anyOf?.some((s: Document) => s.type === "null")
            ? null
            : value[key],
      ];
    }),
  );
}
test("offer request uses strict complete response contract and restores nested optional nulls", async () => {
  assertStrict(OFFER_RESPONSE_SCHEMA);
  assert.deepEqual(OFFER_RESPONSE_SCHEMA.required, [
    "definition",
    "stages",
    "researchBrief",
    "competitors",
  ]);
  assert.equal(OFFER_RESPONSE_SCHEMA.properties.stages.minItems, 14);
  const definition = fillOptionalNulls(
    {
      name: "Example",
      headlineProposition: "Explore the service",
      valueProposition: "Learn what fits",
      targetIcpIds: [],
      targetBuyerProfileIds: [],
      commercialTerms: {
        options: [
          {
            name: "Terms to confirm",
            pricingModel: "custom_quote",
            price: null,
            basis: null,
            setupFee: null,
          },
        ],
        commercialNotes: null,
      },
      primaryCallToAction: "Explore",
    },
    OFFER_RESPONSE_SCHEMA.properties.definition,
  );
  let calls = 0;
  const gen = createOfferGenerator(
    { apiKey: "fixture", project: "proj_fixture", model: "fixture" },
    async (_url, init) => {
      calls++;
      const body = JSON.parse(String(init?.body));
      assert.equal(body.text.format.type, "json_schema");
      assert.equal(body.text.format.strict, true);
      assert.deepEqual(body.text.format.schema, OFFER_RESPONSE_SCHEMA);
      return Response.json({
        status: "completed",
        model: "fixture",
        usage: { input_tokens: 1, output_tokens: 1 },
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  definition,
                  stages: listOfferMethodologies()[0]!.stages.map((s) => ({
                    stageKey: s.key,
                    summary: "For review",
                    questions: [],
                  })),
                  researchBrief: Object.fromEntries(
                    briefKeys.map((k) => [k, []]),
                  ),
                  competitors: [],
                }),
              },
            ],
          },
        ],
      });
    },
  );
  const result = await gen(
    {
      context: {},
      research: false,
      instructions: "",
      sourceUrls: [],
      targetIcpIds: [],
      targetBuyerProfileIds: [],
    },
    AbortSignal.timeout(1000),
  );
  assert.equal(calls, 1);
  assert.equal(
    result.draft.definition.commercialTerms.options[0]?.price,
    undefined,
  );
  assert.equal(result.draft.definition.promise, undefined);
  assert.deepEqual(result.draft.definition.components, []);
  assert.ok(GeneratedOfferSchema.safeParse(result.draft).success);
});

test("optional-null adaptation does not hide malformed required fields or unknown root keys", () => {
  const malformed = {
    definition: null,
    stages: null,
    unexpected: "wrong contract",
  };
  const cleaned = omitOfferNulls(
    malformed,
    offerMongoStructure(GeneratedOfferSchema),
  );
  assert.deepEqual(cleaned, malformed);
  assert.equal(GeneratedOfferSchema.safeParse(cleaned).success, false);
});

test("incomplete offer output retains usage and classifies truncation without accepting partial JSON", async () => {
  const { OfferIncompleteError, safeOfferFailure } =
    await import("../src/services/offer-architecture/diagnostics");
  let calls = 0;
  const gen = createOfferGenerator(
    { apiKey: "fixture", project: "proj_fixture", model: "fixture" },
    async (_url, init) => {
      calls++;
      assert.match(String(init?.body), /at most two grouped proposals/);
      return Response.json({
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
        model: "fixture",
        usage: { input_tokens: 100, output_tokens: 9000 },
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "partial private text" }],
          },
        ],
      });
    },
  );
  await assert.rejects(
    gen(
      {
        context: {},
        research: false,
        instructions: "",
        sourceUrls: [],
        targetIcpIds: [],
        targetBuyerProfileIds: [],
      },
      AbortSignal.timeout(1000),
    ),
    (error) => {
      assert.ok(error instanceof OfferIncompleteError);
      assert.deepEqual(safeOfferFailure(error), {
        code: "provider_output_limit",
      });
      assert.equal(error.usage?.outputTokens, 9000);
      assert.ok(!error.message.includes("private"));
      return true;
    },
  );
  assert.equal(calls, 1);
});
