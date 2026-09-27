import { z } from "zod";
const direction = z.enum(["inbound", "outbound"]);
const refs = z
  .object({
    messageId: z.string().min(1).max(500).optional(),
    threadId: z.string().min(1).max(500).optional(),
  })
  .strict();
export const interactionDetailsSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("call"),
      direction,
      outcome: z.enum([
        "connected",
        "no_answer",
        "busy",
        "voicemail",
        "failed",
        "unknown",
      ]),
      durationSeconds: z.number().int().nonnegative().max(604800).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("email"),
      direction,
      references: refs.optional(),
      outcome: z.enum(["sent", "received", "bounced", "unknown"]).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("meeting"),
      startsAt: z.date(),
      endsAt: z.date(),
      outcome: z
        .enum(["scheduled", "held", "cancelled", "no_show", "unknown"])
        .optional(),
    })
    .strict(),
  z.object({ type: z.literal("note") }).strict(),
  z
    .object({
      type: z.literal("communication"),
      direction,
      channel: z.string().min(1).max(100),
      references: refs.optional(),
    })
    .strict(),
]);
