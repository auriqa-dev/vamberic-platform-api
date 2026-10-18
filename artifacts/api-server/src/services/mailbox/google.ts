import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { MailboxTokens, OutboundMail, ReceivedMail } from "./contracts";
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
];
export class MailboxError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly ambiguous = false,
  ) {
    super(message);
  }
}
export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}
const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().optional(),
  expires_in: z.number().positive(),
  scope: z.string().optional(),
});
const encoded = (s: string) =>
  Buffer.from(s)
    .toString("base64")
    .match(/.{1,76}/g)
    ?.join("\r\n") ?? "";
export function emailMime(
  from: string,
  mail: OutboundMail,
  messageId: string,
  inReplyTo?: string,
) {
  if (
    [from, mail.to, mail.replyTo ?? "", messageId, inReplyTo ?? ""].some((v) =>
      /[\r\n]/.test(v),
    )
  )
    throw new Error("Invalid email header");
  const boundary = `hvm_${randomUUID()}`;
  const related = `hvm_related_${randomUUID()}`;
  return [
    `From: ${from}`,
    `To: ${mail.to}`,
    ...(mail.replyTo ? [`Reply-To: ${mail.replyTo}`] : []),
    `Subject: ${Array.from(mail.subject)
      .reduce<string[]>((parts, c, i) => {
        const n = Math.floor(i / 12);
        parts[n] = (parts[n] ?? "") + c;
        return parts;
      }, [])
      .map((p) => `=?UTF-8?B?${Buffer.from(p).toString("base64")}?=`)
      .join("\r\n ")}`,
    `Message-ID: ${messageId}`,
    ...(inReplyTo
      ? [`In-Reply-To: ${inReplyTo}`, `References: ${inReplyTo}`]
      : []),
    "MIME-Version: 1.0",
    ...(mail.inlineImages?.length
      ? [
          `Content-Type: multipart/related; boundary="${related}"`,
          "",
          `--${related}`,
        ]
      : []),
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    encoded(mail.text),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    encoded(mail.html),
    `--${boundary}--`,
    ...(mail.inlineImages?.length
      ? [
          ...mail.inlineImages.flatMap((image) => [
            `--${related}`,
            "Content-Type: image/png",
            "Content-Transfer-Encoding: base64",
            `Content-ID: <${image.cid}>`,
            'Content-Disposition: inline; filename="brand-logo.png"',
            "",
            image.base64.match(/.{1,76}/g)?.join("\r\n") || "",
          ]),
          `--${related}--`,
        ]
      : []),
    "",
  ].join("\r\n");
}
const part = z
  .object({
    mimeType: z.string().optional(),
    body: z.object({ data: z.string().optional() }).optional(),
    headers: z
      .array(z.object({ name: z.string(), value: z.string() }))
      .optional(),
  })
  .passthrough();
function plainText(raw: unknown, depth = 0): string {
  if (depth > 12) return "";
  const p = part.parse(raw);
  if (p.mimeType === "text/plain" && p.body?.data)
    return Buffer.from(p.body.data, "base64url")
      .toString("utf8")
      .slice(0, 8000);
  const children = (p as { parts?: unknown[] }).parts;
  return Array.isArray(children)
    ? children
        .map((c) => plainText(c, depth + 1))
        .join("\n")
        .slice(0, 8000)
    : "";
}
export function parseGoogleMessage(raw: unknown): ReceivedMail {
  const m = z
    .object({
      id: z.string(),
      threadId: z.string(),
      internalDate: z.string(),
      payload: part,
    })
    .parse(raw);
  const header = (name: string) =>
    m.payload.headers?.find((h) => h.name.toLowerCase() === name)?.value ?? "";
  return {
    autoSubmitted: header("auto-submitted").slice(0, 100),
    deliveryReport:
      m.payload.mimeType === "multipart/report" &&
      /delivery-status/i.test(header("content-type")),
    providerId: m.id,
    conversationId: m.threadId,
    internetMessageId: header("message-id").slice(0, 300),
    inReplyTo: header("in-reply-to").slice(0, 300),
    references: (header("references").match(/<[^<>\s]+>/g) ?? [])
      .slice(0, 10)
      .map((v) => v.slice(0, 300)),
    from: header("from").slice(0, 500),
    to: [header("to").slice(0, 500)],
    subject: header("subject").slice(0, 300) || "(No subject)",
    text: plainText(raw && m.payload),
    occurredAt: new Date(Number(m.internalDate)).toISOString(),
  };
}
export function googleMailbox(
  config: GoogleConfig,
  request: typeof fetch = fetch,
) {
  async function json(url: string, options: RequestInit, mutation = false) {
    let r: Response;
    try {
      r = await request(url, {
        ...options,
        redirect: "error",
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw new MailboxError(
        "PROVIDER_UNAVAILABLE",
        mutation
          ? "The send outcome is unknown. HVM will not send it again automatically."
          : "Google could not be reached. Try again.",
        mutation,
      );
    }
    if (!r.ok) {
      if (
        (url === "https://oauth2.googleapis.com/token" && r.status === 400) ||
        r.status === 401 ||
        r.status === 403
      )
        throw new MailboxError(
          "RECONNECT",
          "Reconnect Gmail and allow both sending and reading replies.",
        );
      throw new MailboxError(
        "PROVIDER_UNAVAILABLE",
        r.status === 429
          ? "Google is limiting requests. Wait before trying again."
          : "Google could not complete the request. Try again.",
        mutation && r.status >= 500,
      );
    }
    try {
      return await r.json();
    } catch {
      throw new MailboxError(
        "INVALID_RESPONSE",
        "Google returned an incomplete response.",
        mutation,
      );
    }
  }
  async function token(body: URLSearchParams, previous?: MailboxTokens) {
    body.set("client_id", config.clientId);
    body.set("client_secret", config.clientSecret);
    const t = tokenSchema.parse(
      await json("https://oauth2.googleapis.com/token", {
        method: "POST",
        body,
      }),
    );
    const scopes = t.scope?.split(" ") ?? previous?.scopes ?? [];
    if (
      !GOOGLE_SCOPES.every((s) => scopes.includes(s)) ||
      !(t.refresh_token ?? previous?.refreshToken)
    )
      throw new MailboxError(
        "CONSENT_REQUIRED",
        "Allow both Gmail permissions and offline access, then reconnect.",
      );
    return {
      accessToken: t.access_token,
      refreshToken: t.refresh_token ?? previous!.refreshToken,
      expiresAt: Date.now() + t.expires_in * 1000,
      scopes,
    };
  }
  const api = (access: string, path: string, body?: unknown) =>
    json(
      `https://gmail.googleapis.com/gmail/v1/users/me/${path}`,
      {
        headers: {
          Authorization: `Bearer ${access}`,
          "Content-Type": "application/json",
        },
        ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
      },
      Boolean(body),
    );
  return {
    authorise(state: string, challenge: string) {
      const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      u.search = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        response_type: "code",
        scope: GOOGLE_SCOPES.join(" "),
        access_type: "offline",
        prompt: "consent select_account",
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
      }).toString();
      return u.toString();
    },
    exchange: (code: string, verifier: string) =>
      token(
        new URLSearchParams({
          grant_type: "authorization_code",
          code,
          code_verifier: verifier,
          redirect_uri: config.redirectUri,
        }),
      ),
    refresh: (previous: MailboxTokens) =>
      token(
        new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: previous.refreshToken,
        }),
        previous,
      ),
    async profile(access: string) {
      return z
        .object({ emailAddress: z.string().email() })
        .parse(await api(access, "profile"));
    },
    async send(access: string, mime: string, threadId?: string) {
      return z.object({ id: z.string(), threadId: z.string() }).parse(
        await api(access, "messages/send", {
          raw: Buffer.from(mime).toString("base64url"),
          ...(threadId ? { threadId } : {}),
        }),
      );
    },
    async thread(access: string, id: string) {
      const t = z
        .object({ messages: z.array(z.unknown()).default([]) })
        .parse(
          await api(access, `threads/${encodeURIComponent(id)}?format=full`),
        );
      return t.messages.map(parseGoogleMessage);
    },
    async findSent(access: string, messageId: string) {
      const result = z
        .object({
          messages: z
            .array(z.object({ id: z.string(), threadId: z.string() }))
            .optional(),
        })
        .parse(
          await api(
            access,
            `messages?q=${encodeURIComponent(`in:sent rfc822msgid:${messageId}`)}&maxResults=2`,
          ),
        );
      return result.messages?.length === 1 ? result.messages[0] : undefined;
    },
    async revoke(refreshToken: string) {
      const r = await request("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        body: new URLSearchParams({ token: refreshToken }),
        signal: AbortSignal.timeout(10000),
        redirect: "error",
      });
      if (!r.ok)
        throw new MailboxError(
          "REVOCATION_PENDING",
          "HVM is disconnected. Remove HVM access in your Google Account to complete revocation.",
        );
    },
  };
}
