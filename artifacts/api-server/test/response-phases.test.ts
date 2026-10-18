import { test } from "node:test";
import assert from "node:assert/strict";
import { finalResponseTextParts } from "../src/services/content-strategy/generate";
import { parseProviderJson } from "../src/services/psu/strict-json";
const message = (text: string, phase?: "commentary" | "final_answer") => ({
  type: "message",
  role: "assistant",
  status: "completed",
  phase,
  content: [{ type: "output_text", text }],
});
test("structured final excludes commentary, including commentary that looks like JSON", () => {
  const parts = finalResponseTextParts([
    message('{"answer":"intermediate"}', "commentary"),
    message('{"answer":"final"}', "final_answer"),
  ]);
  assert.deepEqual(parseProviderJson(parts.map((p) => p.text).join("")), {
    answer: "final",
  });
});
test("supports legacy single messages and fragmented content within one final", () => {
  assert.equal(finalResponseTextParts([message("{}")])[0].text, "{}");
  const m = message('{"answer":', "final_answer");
  m.content.push({ type: "output_text", text: '"final"}' });
  assert.deepEqual(
    parseProviderJson(
      finalResponseTextParts([m])
        .map((p) => p.text)
        .join(""),
    ),
    { answer: "final" },
  );
});
test("rejects missing, multiple or incomplete final answers and duplicate keys", () => {
  for (const output of [
    [],
    [message("{}", "commentary")],
    [message("{}"), message("{}")],
    [message("{}", "final_answer"), message("{}", "final_answer")],
    [{ ...message("{}"), status: "incomplete" }],
  ])
    assert.throws(() => finalResponseTextParts(output));
  assert.throws(() =>
    parseProviderJson(
      finalResponseTextParts([message('{"a":1,"a":2}')])
        .map((p) => p.text)
        .join(""),
    ),
  );
});

test("interaction generation parses final JSON after commentary and retains usage", async () => {
  const { contentGeneratorFromEnvironment } =
    await import("../src/services/content-strategy/generate");
  const oldKey = process.env.HVM_PSU_API_KEY,
    oldProject = process.env.HVM_PSU_OPENAI_PROJECT;
  process.env.HVM_PSU_API_KEY = "test-only";
  process.env.HVM_PSU_OPENAI_PROJECT = "test-only";
  const reply = {
    answer: "I can help with the client’s services.",
    sourceIds: [],
    nextStep: "continue",
    ctaAssetId: "",
    qualificationEvidence: [],
    uncertainties: [],
  };
  try {
    const generate = contentGeneratorFromEnvironment(async (_url, options) => {
      const request = JSON.parse(String(options?.body));
      assert.match(
        request.input[0].content,
        /Return one final JSON object only/,
      );
      assert.match(request.input[0].content, /For a wholly unrelated request/);
      assert.equal(request.max_output_tokens, 4500);
      assert.equal(request.reasoning.effort, "none");
      return new Response(
        JSON.stringify({
          status: "completed",
          model: "gpt-6-luna",
          usage: { input_tokens: 40, output_tokens: 20 },
          output: [
            message("I will redirect this request.", "commentary"),
            message(JSON.stringify(reply), "final_answer"),
          ],
        }),
      );
    })!;
    const result = await generate("interaction", {});
    assert.deepEqual(result.result, reply);
    assert.equal(result.usage.outputTokens, 20);
  } finally {
    if (oldKey === undefined) delete process.env.HVM_PSU_API_KEY;
    else process.env.HVM_PSU_API_KEY = oldKey;
    if (oldProject === undefined) delete process.env.HVM_PSU_OPENAI_PROJECT;
    else process.env.HVM_PSU_OPENAI_PROJECT = oldProject;
  }
});
