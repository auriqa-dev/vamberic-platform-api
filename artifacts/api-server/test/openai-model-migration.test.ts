import test from "node:test";
import assert from "node:assert/strict";
import { activeOpenAIModel, lunaRequestOptions } from "../src/services/openai-model";
import { contentGeneratorFromEnvironment } from "../src/services/content-strategy/generate";

test("retiring aliases, snapshots and fine tunes cannot be selected for new requests", () => {
  for (const base of ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini"]) {
    for (const model of [base, `${base}-2025-04-14`, `ft:${base}:org:model:id`]) {
      assert.throws(() => activeOpenAIModel(model), /Retiring OpenAI model/);
    }
  }
  for (const model of ["gpt-6-luna", "gpt-6.1-sol", "gpt-6-astra", "gpt-4.1-nano"]) {
    assert.equal(activeOpenAIModel(model), model);
  }
  assert.deepEqual(lunaRequestOptions("gpt-6-luna"), { reasoning: { effort: "none" } });
  assert.deepEqual(lunaRequestOptions("gpt-6.1-sol"), {});
});

test("obsolete Content Strategy override fails before sending any provider request", async () => {
  const names = ["HVM_PSU_API_KEY", "HVM_PSU_OPENAI_PROJECT", "HVM_CONTENT_STRATEGY_MODEL"];
  const previous = names.map(name => process.env[name]);
  let calls = 0;
  try {
    process.env.HVM_PSU_API_KEY = "offline";
    process.env.HVM_PSU_OPENAI_PROJECT = "proj_test";
    process.env.HVM_CONTENT_STRATEGY_MODEL = "gpt-4.1";
    const generate = contentGeneratorFromEnvironment(async () => { calls++; throw new Error("must not send"); })!;
    await assert.rejects(generate("strategy", {}), /Retiring OpenAI model/);
    assert.equal(calls, 0);
  } finally {
    names.forEach((name, i) => previous[i] === undefined ? delete process.env[name] : process.env[name] = previous[i]);
  }
});

for (const scenario of ["refusal", "truncation"]) {
  test(`Luna ${scenario} preserves usage and returns a recoverable failure`, async () => {
    const names = ["HVM_PSU_API_KEY", "HVM_PSU_OPENAI_PROJECT", "HVM_CONTENT_STRATEGY_MODEL"];
    const previous = names.map(name => process.env[name]);
    try {
      process.env.HVM_PSU_API_KEY = "offline";
      process.env.HVM_PSU_OPENAI_PROJECT = "proj_test";
      delete process.env.HVM_CONTENT_STRATEGY_MODEL;
      const generate = contentGeneratorFromEnvironment(async (_url, init) => {
        const request = JSON.parse(String(init?.body));
        assert.equal(request.model, "gpt-6-luna");
        assert.deepEqual(request.reasoning, { effort: "none" });
        assert.equal(request.text.format.strict, true);
        return new Response(JSON.stringify({
          status: scenario === "truncation" ? "incomplete" : "completed",
          model: "gpt-6-luna",
          usage: { input_tokens: 50, output_tokens: 20 },
          output: [{ content: scenario === "refusal"
            ? [{ type: "refusal", refusal: "Provider refusal" }]
            : [{ type: "output_text", text: '{"partial":' }] }],
        }));
      })!;
      await assert.rejects(generate("strategy", {}), (error: any) => {
        assert.match(error.message, /Saved content is unchanged/);
        assert.deepEqual(error.usage, { model: "gpt-6-luna", inputTokens: 50, outputTokens: 20 });
        return true;
      });
    } finally {
      names.forEach((name, i) => previous[i] === undefined ? delete process.env[name] : process.env[name] = previous[i]);
    }
  });
}

test("migration diagnostics identify HTTP failure without logging provider or customer content", async () => {
  const { logger } = await import("../src/lib/logger");
  const previousWarn = logger.warn;
  const entries: unknown[] = [];
  logger.warn = ((entry: unknown) => { entries.push(entry); }) as typeof logger.warn;
  const names = ["HVM_PSU_API_KEY", "HVM_PSU_OPENAI_PROJECT", "HVM_CONTENT_STRATEGY_MODEL"];
  const previous = names.map(name => process.env[name]);
  try {
    process.env.HVM_PSU_API_KEY = "SENSITIVE_TEST_KEY";
    process.env.HVM_PSU_OPENAI_PROJECT = "proj_test";
    delete process.env.HVM_CONTENT_STRATEGY_MODEL;
    const generate = contentGeneratorFromEnvironment(async () => new Response("SENSITIVE_PROVIDER_TEXT", { status: 404 }))!;
    await assert.rejects(generate("strategy", { privateText: "SENSITIVE_CUSTOMER_TEXT" }));
    assert.equal(entries.length, 1);
    assert.equal((entries[0] as any).code, "http_response");
    assert.equal((entries[0] as any).httpStatus, 404);
    assert.ok(!JSON.stringify(entries).includes("SENSITIVE"));
  } finally {
    logger.warn = previousWarn;
    names.forEach((name, i) => previous[i] === undefined ? delete process.env[name] : process.env[name] = previous[i]);
  }
});

for (const scenario of ["empty_output", "invalid_json", "result_contract"] as const) {
  test(`email diagnostics distinguish ${scenario} without retaining provider text`, async () => {
    const names = ["HVM_PSU_API_KEY", "HVM_PSU_OPENAI_PROJECT"];
    const previous = names.map(name => process.env[name]);
    try {
      process.env.HVM_PSU_API_KEY = "offline";
      process.env.HVM_PSU_OPENAI_PROJECT = "proj_test";
      const text = scenario === "empty_output" ? "" : scenario === "invalid_json" ? "PRIVATE_NOT_JSON" : "{}";
      const generate = contentGeneratorFromEnvironment(async () => new Response(JSON.stringify({
        status: "completed", model: "gpt-6-luna", usage: {input_tokens: 10, output_tokens: 5},
        output: [{content: [{type: "output_text", text}]}],
      })))!;
      await assert.rejects(generate("email", {}), (error: any) => {
        assert.equal(error.generationFailureCode, scenario);
        assert.equal(error.usage.outputTokens, 5);
        assert.ok(!JSON.stringify(error).includes("PRIVATE_NOT_JSON"));
        return true;
      });
    } finally {
      names.forEach((name, i) => previous[i] === undefined ? delete process.env[name] : process.env[name] = previous[i]);
    }
  });
}
