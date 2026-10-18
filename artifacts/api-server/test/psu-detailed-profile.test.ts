import { validateDetail } from "../src/services/psu/detailed-profile";
import { pageTextDigest } from "../src/services/psu/page-reader";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createPsuGenerator } from "../src/services/psu/generate";
import { OfferingContentSchema } from "../src/domain/hive-definitions";
import { createDatabaseSetup, releaseDatabaseTarget } from "../src/db/setup";
import { PRODUCT_PROFILE_FIELDS } from "../src/db/product-profile-v26";
import { FakeDb } from "./helpers/commercial-migration-db";
const detail = {
  offeringTypeExplanation: "A professional service",
  offeringTypeOtherDetail: "Specialist service",
  technologyRole: "delivery_enabler",
  technologyRoleExplanation: "Technology supports the analysts",
  implementationExplanation: "No customer implementation",
  buyerNextSteps: ["Contact the supplier"],
};
test("detailed profile uses GPT-6 Luna and preserves all additional Odyssiant fields as reviewable values", async () => {
  const text =
    "Analysts deliver a professional service using technology. Contact the supplier. No customer implementation.";
  const generate = createPsuGenerator(
    { apiKey: "offline", project: "proj_test", model: "legacy" },
    async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, "gpt-6-luna");
      assert.equal(body.max_output_tokens, 4500);
      assert.deepEqual(body.reasoning, { effort: "none" });
      assert.match(body.input[0].content, /technologyRoleExplanation/);
      assert.equal(
        JSON.parse(body.input[1].content).existingContext.product.name,
        "Service",
      );
      return new Response(
        JSON.stringify({
          model: body.model,
          status: "completed",
          usage: { input_tokens: 100, output_tokens: 200 },
          output: [
            {
              type: "message",
              role: "assistant",
              status: "completed",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    fields: Object.entries({
                      ...detail,
                      name: "Service",
                      description: "Professional service",
                    }).map(([field, value]) => ({
                      field,
                      value,
                      sources: [0],
                    })),
                    unknowns: [],
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
      read: async () => ({
        access: "allowed",
        decodedBytes: text.length,
        text,
        title: "Service",
      }),
    },
  );
  const result = await generate(
    {
      depth: "detailed",
      websiteUrls: ["https://example.com"],
      workingLabel: "Service",
      orientation: "",
      context: { product: { name: "Service" } },
    },
    new AbortController().signal,
  );
  assert.equal(result.draft!.approval, "not_approved");
  const definition = Object.fromEntries(
    result.draft!.fields.map((f) => [f.binding.field, f.binding.value]),
  );
  assert.deepEqual(OfferingContentSchema.parse(definition), {
    ...detail,
    name: "Service",
    description: "Professional service",
  });
});
test("v26 changes only offering definitions and version history; it replays and rejects validator drift", async () => {
  const before = releaseDatabaseTarget(25),
    after = releaseDatabaseTarget(26);
  assert.deepEqual(after.collections, before.collections);
  assert.deepEqual(
    Object.keys(after.validators)
      .filter(
        (k) =>
          JSON.stringify(after.validators[k]) !==
          JSON.stringify(before.validators[k]),
      )
      .sort(),
    ["hive_definition_revisions", "offerings"],
  );
  assert.ok(
    PRODUCT_PROFILE_FIELDS.every(
      (k) =>
        !JSON.stringify(before.validators.offerings).includes('"' + k + '"'),
    ),
  );
  const db = new FakeDb();
  for (let version = 12; version <= 25; version++)
    await createDatabaseSetup({
      ...releaseDatabaseTarget(version as 25),
      ordered: version !== 12,
    }).setupDatabase(db as never);
  const setup = createDatabaseSetup(after);
  const plan = await setup.planDatabaseSetup(db as never);
  assert.deepEqual(plan.validatorConflicts, []);
  assert.deepEqual(plan.validatorsToApply.sort(), [
    "hive_definition_revisions",
    "offerings",
  ]);
  await setup.setupDatabase(db as never);
  assert.equal(
    (await setup.planDatabaseSetup(db as never)).existingSchemaVersion,
    26,
  );
  await setup.setupDatabase(db as never);
  db.collection("offerings").options.validationAction = "warn";
  assert.ok(
    (await setup.planDatabaseSetup(db as never)).validatorConflicts.length,
  );
});

test("detailed profile keeps supported fields when another value or reference is unusable", () => {
  const text = "A professional service";
  const result = validateDetail(
    {
      fields: [
        { field: "name", value: "Service", sources: [0] },
        { field: "technologyRole", value: "impossible", sources: [0] },
        { field: "description", value: "Draft", sources: [999] },
      ],
      unknowns: [],
    },
    [
      {
        url: "https://example.com",
        title: "Service",
        text,
        digest: pageTextDigest(text),
        retrievedAt: new Date().toISOString(),
      },
    ],
  );
  assert.equal(result.fields.length, 1);
  assert.equal(result.approval, "not_approved");
  assert.equal(result.unknowns.length, 2);
});

test("PSU diagnostics classify internal validation failures without disclosing provider content", async () => {
  const { safePsuValidationReason } =
    await import("../src/services/psu/generate");
  assert.equal(
    safePsuValidationReason(new Error("Duplicate proposed field")),
    "duplicate_field",
  );
  assert.equal(
    safePsuValidationReason(new Error("private generated text")),
    "validation_failed",
  );
});

test("duplicate generated fields are omitted for review without losing other detailed fields", () => {
  const text = "Supplier provides a professional service.";
  const result = validateDetail(
    {
      fields: [
        { field: "name", value: "Service", sources: [0] },
        { field: "whatCustomerBuys", value: "Advice", sources: [0] },
        { field: "whatCustomerBuys", value: "Software", sources: [0] },
      ],
      unknowns: [],
    },
    [
      {
        url: "https://example.com",
        title: "Service",
        text,
        digest: pageTextDigest(text),
        retrievedAt: new Date().toISOString(),
      },
    ],
  );
  assert.deepEqual(
    result.fields.map((f) => f.binding.field),
    ["name"],
  );
  assert.match(
    result.unknowns.join(" "),
    /whatCustomerBuys: more than one value/,
  );
  assert.equal(result.approval, "not_approved");
});
