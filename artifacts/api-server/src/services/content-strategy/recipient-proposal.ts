import { z } from "zod";
import { henryScreen, workspaceHenryReply } from "./henry-model";

export const recipientNoteKeys = [
  "fit",
  "communication",
  "customer",
  "conversations",
] as const;
// Use the existing structured-output transport, with plain text at the provider
// boundary. Only the server encodes values for the shared editor contract.
export const recipientProposalReply = workspaceHenryReply
  .extend({
    actionId: z.literal(""),
    changes: z
      .array(
        z
          .object({
            key: z.enum(recipientNoteKeys),
            value: z.string().max(1500),
            reason: z.string().max(1000),
          })
          .strict(),
      )
      .max(4),
  })
  .strict();

export function isRecipientNoteInput(input: unknown): boolean {
  if (!input || typeof input !== "object" || !("screen" in input)) return false;
  const parsed = henryScreen.safeParse(input.screen);
  if (!parsed.success) return false;
  const screen = parsed.data;
  if (
    screen.section !== "campaigns" ||
    !screen.editor?.key.startsWith("recipient:")
  )
    return false;
  const fields = screen.editor.fields;
  return (
    fields.length === 4 &&
    recipientNoteKeys.every((key) => {
      const matching = fields.filter((field) => field.key === key);
      if (matching.length !== 1) return false;
      try {
        return typeof JSON.parse(matching[0].value) === "string";
      } catch {
        return false;
      }
    })
  );
}

export function encodeRecipientProposal(raw: unknown) {
  const reply = recipientProposalReply.parse(raw);
  return {
    ...reply,
    changes: reply.changes.map((change) => ({
      ...change,
      value: JSON.stringify(change.value),
    })),
  };
}

export const RECIPIENT_NOTE_INSTRUCTIONS = `For this recipient evidence editor, the changes contract is specialised: use only fit, communication, customer and conversations as keys. Each value is ordinary note text, NOT a JSON-encoded string or an object; the server encodes it for the editor. Return at most one change per key, only when the user requests notes. Keep actionId empty. Notes are suggestions, never approval or permission. Cite supplied evidence, preserve uncertainty and all restrictions. Do not invent communication basis, account status or conversation history. Missing evidence stays unresolved. Never launch, send, change restrictions or approve inclusion.`;
