import { z } from "zod";
import { EventSchema } from "../../domain";
import { emailRecord } from "../email-content/model";
import { outboundMail } from "../mailbox/contracts";

// Rendered delivery snapshots contain MIME image data, not generic event metadata.
// Keep the existing envelope and metadata checks; validate the two larger fields
// through their own bounded contracts, only for communication records/history.
const presentation = outboundMail
  .pick({ subject: true, text: true, html: true, inlineImages: true })
  .extend({ notice: z.string().max(2000).optional() })
  .strict();
export function communicationEvent(input: Record<string, unknown>) {
  if (
    !["communication", "communication_history"].includes(
      String(input.eventType),
    )
  )
    return EventSchema.parse(input);
  const payload = z
    .record(z.unknown())
    .refine((p) => Object.keys(p).length <= 50)
    .refine(
      (p) => Buffer.byteLength(JSON.stringify(p)) <= 1_048_576,
      "Delivery snapshot exceeds 1 MiB",
    )
    .parse(input.payload);
  const { draft, rendered, ...metadata } = payload;
  const envelope = EventSchema.parse({ ...input, payload: metadata });
  return {
    ...envelope,
    payload: {
      ...metadata,
      draft: emailRecord.parse(draft),
      rendered: presentation.parse(rendered),
    },
  };
}
