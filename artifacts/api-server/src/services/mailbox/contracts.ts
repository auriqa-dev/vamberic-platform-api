import { z } from "zod";

/** Transport contracts only. Connecting a mailbox never grants campaign execution. */
export const mailboxProvider = z.enum(["microsoft365", "google_workspace"]);
const address = z
  .string()
  .email()
  .max(254)
  .refine((v) => !/[\r\n]/.test(v));
export const outboundMail = z
  .object({
    operationId: z.string().uuid(),
    to: address,
    replyTo: address.optional(),
    subject: z
      .string()
      .trim()
      .min(1)
      .max(998)
      .refine((v) => !/[\r\n]/.test(v)),
    text: z.string().min(1).max(200_000),
    html: z.string().min(1).max(500_000),
    inlineImages: z
      .array(
        z
          .object({
            cid: z.literal("brand-logo"),
            base64: z
              .string()
              .max(350000)
              .regex(/^[A-Za-z0-9+/]+={0,2}$/),
          })
          .strict(),
      )
      .max(1)
      .optional(),
  })
  .strict();
export type OutboundMail = z.infer<typeof outboundMail>;
export interface MailboxIdentity {
  accountId: string;
  email: string;
  tenantId?: string;
}
export interface MailboxTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes: string[];
}
export interface ReceivedMail {
  autoSubmitted?: string;
  deliveryReport?: boolean;
  providerId: string;
  conversationId: string;
  internetMessageId: string;
  inReplyTo?: string;
  references: string[];
  from: string;
  to: string[];
  subject: string;
  text: string;
  occurredAt: string;
}
export type SendOutcome =
  | { status: "accepted"; providerId?: string; conversationId?: string }
  | { status: "unknown"; reason: "ambiguous_provider_response" };
export interface MailboxReadiness {
  connection:
    "not_connected" | "connected" | "needs_attention" | "disconnected";
  sendingVerified: boolean;
  repliesVerified: boolean;
}
export function mailboxReadiness(value: MailboxReadiness) {
  const missing: string[] = [];
  if (value.connection !== "connected")
    missing.push("Connect or reconnect the sender mailbox.");
  if (!value.sendingVerified) missing.push("Complete a controlled test send.");
  if (!value.repliesVerified)
    missing.push("Reply to the test email and check that HVM receives it.");
  return {
    ready: missing.length === 0,
    missing,
    campaignExecutionAuthorised: false as const,
  };
}

/** Only message references may automatically link a reply; subjects/addresses are insufficient. */
export function matchesOutboundReply(
  message: ReceivedMail,
  outboundInternetId: string,
): boolean {
  return (
    Boolean(outboundInternetId) &&
    (message.inReplyTo === outboundInternetId ||
      message.references.includes(outboundInternetId))
  );
}
