import assert from "node:assert/strict";
import { test } from "node:test";
import { createDatabaseSetup, releaseDatabaseTarget } from "../src/db/setup";
import { BRAND_EXPRESSION_STRUCTURE } from "../src/db/brand-expression-v25";
import { FakeDb } from "./helpers/commercial-migration-db";
import { expressionDefaults } from "../src/domain/brand-expression";
import { BrandKitSchema, generatePlatformId } from "../src/domain";
import { projectBrandContext } from "../src/services/brand-context";
import { createBrandGenerator } from "../src/services/brand-expression/generate";
test("v25 adds only optional brand expression; frozen targets and records are preserved and apply replays", async () => {
  const old = releaseDatabaseTarget(24),
    next = releaseDatabaseTarget(25),
    expected = structuredClone(old.validators);
  expected.brand_kits!.$and[0].$jsonSchema.properties.expression =
    BRAND_EXPRESSION_STRUCTURE;
  assert.deepEqual(next.validators, expected);
  assert.deepEqual(next.collections, old.collections);
  assert.equal(
    old.validators.brand_kits!.$and[0].$jsonSchema.properties.expression,
    undefined,
  );
  const db = new FakeDb();
  for (let v = 12; v <= 24; v++)
    await createDatabaseSetup({
      ...releaseDatabaseTarget(v as 24),
      ordered: v !== 12,
    }).setupDatabase(db as never);
  const setup = createDatabaseSetup(next),
    plan = await setup.planDatabaseSetup(db as never);
  assert.deepEqual(plan.validatorConflicts, []);
  assert.deepEqual(plan.validatorsToApply, ["brand_kits"]);
  assert.deepEqual(plan.indexesToCreate, []);
  assert.deepEqual(plan.collectionsToCreate, []);
  await setup.setupDatabase(db as never);
  const after = await setup.planDatabaseSetup(db as never);
  assert.equal(after.existingSchemaVersion, 25);
  assert.deepEqual(after.validatorsToApply, []);
  await setup.setupDatabase(db as never);
});
test("approved projection excludes draft and original author references; interaction has no editorial structure", () => {
  const now = new Date(),
    actor = {
      type: "human",
      id: "fixture",
      issuer: "https://auth.example.test",
    };
  const entry = {
    savedAt: now,
    savedBy: actor,
    originalDescription: "I admire a named author",
    approvedAt: now,
    approvedBy: actor,
  };
  const style = {
    ...expressionDefaults.writingStyle,
    characteristics: "Analytical clarity",
    structure: "Long editorial sections",
    inspirations: [
      { reference: "Named author", interpretation: "Accessible explanations" },
    ],
  };
  const kit = BrandKitSchema.parse({
    id: generatePlatformId("brandkit"),
    workspaceId: generatePlatformId("workspace"),
    brandId: generatePlatformId("brand"),
    createdAt: now,
    updatedAt: now,
    createdBy: actor,
    updatedBy: actor,
    status: "approved",
    approvedAt: now,
    approvedBy: actor,
    expression: {
      writingStyle: {
        approved: { ...entry, content: style },
        draft: {
          savedAt: now,
          savedBy: actor,
          originalDescription: "Draft",
          content: { ...style, characteristics: "DRAFT" },
        },
      },
    },
  });
  const context = projectBrandContext(kit, "newsletter");
  assert.equal(context.writingStyle!.characteristics, "Analytical clarity");
  assert.equal(JSON.stringify(context).includes("Named author"), false);
  assert.equal(JSON.stringify(context).includes("I admire"), false);
  assert.equal(
    projectBrandContext(kit, "interaction").writingStyle!.structure,
    undefined,
  );
  assert.equal(
    projectBrandContext(kit, "email", true).writingStyle!.characteristics,
    "DRAFT",
  );
});
test("provider uses strict structured output, no tools or storage, and validates generation mode", async () => {
  let body: {
    store?: boolean;
    tools?: unknown[];
    text?: { format: { strict: boolean } };
  } = {};
  const generate = createBrandGenerator(
    { apiKey: "fixture", project: "proj_fixture", model: "fixture" },
    (async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          model: "fixture",
          status: "completed",
          usage: { input_tokens: 10, output_tokens: 20 },
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({ sample: "Hello" }),
                },
              ],
            },
          ],
        }),
      );
    }) as typeof fetch,
  );
  const input = {
    mode: "preview" as const,
    description: "True facts",
    context: null,
    format: "email",
  };
  const result = await generate(input, new AbortController().signal);
  assert.equal(result.usage.inputTokens, 10);
  assert.equal(body.store, false);
  assert.deepEqual(body.tools, []);
  assert.equal(body.text?.format.strict, true);
  await assert.rejects(
    generate({ ...input, mode: "interpret" }, new AbortController().signal),
  );
});
