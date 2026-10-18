import assert from "node:assert/strict";
import { test } from "node:test";
import { contentGeneratorFromEnvironment } from "../src/services/content-strategy/generate";
import { validateHenryProposal } from "../src/services/content-strategy/workspace-henry";
import { henryScreen } from "../src/services/content-strategy/henry-model";
import {
  recipientNoteKeys,
  isRecipientNoteInput,
  encodeRecipientProposal,
} from "../src/services/content-strategy/recipient-proposal";
const screen = henryScreen.parse({
  section: "campaigns",
  brandId: "brand",
  summary: "QA only",
  actions: [],
  editor: {
    key: "recipient:campaign:person:current:point",
    title: "Recipient review",
    fields: recipientNoteKeys.map((key) => ({ key, label: key, value: '""' })),
  },
});
const reply = {
  reply: "Unknowns remain on hold.",
  objective: "Review",
  destination: "campaigns",
  actionId: "",
  changes: recipientNoteKeys.map((key) => ({
    key,
    value: `Unknown ${key}; source says "not confirmed".\nDo not approve.`,
    reason: "Evidence gap",
  })),
};
test("provider plain-text notes survive shared validation with exact keys and no action", async () => {
  const oldKey = process.env.HVM_PSU_API_KEY,
    oldProject = process.env.HVM_PSU_OPENAI_PROJECT;
  process.env.HVM_PSU_API_KEY = "offline-test";
  process.env.HVM_PSU_OPENAI_PROJECT = "offline-test";
  try {
    const generate = contentGeneratorFromEnvironment(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(
        body.text.format.schema.properties.changes.items.properties.key.enum,
        [...recipientNoteKeys],
      );
      assert.match(body.input[0].content, /ordinary note text/);
      return new Response(
        JSON.stringify({
          status: "completed",
          model: "offline",
          usage: { input_tokens: 1, output_tokens: 1 },
          output: [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: JSON.stringify(reply) }],
            },
          ],
        }),
        { status: 200 },
      );
    })!;
    const response = await generate("workspace_henry", { screen });
    const result = validateHenryProposal(screen, response.result);
    assert.equal(result.changes.length, 4);
    assert.equal(result.actionId, "");
    result.changes.forEach((c, i) =>
      assert.equal(JSON.parse(c.value), reply.changes[i].value),
    );
  } finally {
    if (oldKey === undefined) delete process.env.HVM_PSU_API_KEY;
    else process.env.HVM_PSU_API_KEY = oldKey;
    if (oldProject === undefined) delete process.env.HVM_PSU_OPENAI_PROJECT;
    else process.env.HVM_PSU_OPENAI_PROJECT = oldProject;
  }
});
test("recipient contract cannot suggest permissions, actions, wrong shapes or oversized notes", () => {
  for (const changes of [
    [{ key: "decision", value: "include", reason: "" }],
    [{ key: "fit", value: { approved: true }, reason: "" }],
    [{ key: "fit", value: "x".repeat(1501), reason: "" }],
  ])
    assert.throws(() => encodeRecipientProposal({ ...reply, changes }));
  assert.throws(() =>
    encodeRecipientProposal({ ...reply, actionId: "launch" }),
  );
  const duplicate = encodeRecipientProposal({
    ...reply,
    changes: [reply.changes[0], reply.changes[0]],
  });
  assert.equal(validateHenryProposal(screen, duplicate).changes.length, 0);
  assert.equal(isRecipientNoteInput({ screen }), true);
  assert.equal(
    isRecipientNoteInput({ screen: { ...screen, section: "offers" } }),
    false,
  );
  assert.equal(
    isRecipientNoteInput({
      screen: {
        ...screen,
        editor: {
          ...screen.editor,
          fields: [{ key: "fit", label: "fit", value: "" }],
        },
      },
    }),
    false,
  );
  assert.equal(
    validateHenryProposal(screen, {
      ...reply,
      changes: [{ key: "fit", value: "{}", reason: "" }],
    }).changes.length,
    0,
  );
});
