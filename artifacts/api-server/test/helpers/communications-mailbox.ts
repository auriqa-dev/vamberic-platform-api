import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lushaFixture, config } from "./lusha";
import { createMailboxApplication } from "../../src/services/mailbox/application";
import {
  MailboxError,
  GOOGLE_SCOPES,
  googleMailbox,
} from "../../src/services/mailbox/google";
import type { MailboxSecrets } from "../../src/services/mailbox/secrets";
export async function mailboxFixture() {
  const f = await lushaFixture(),
    values = new Map<string, unknown>();
  let sent = 0,
    refreshes = 0;
  let ambiguous = false;
  let reference = "";
  let replies = false;
  const secrets: MailboxSecrets = {
    create: async (w, v) => {
      const arn = `arn:aws:secretsmanager:eu-west-2:123456789012:secret:hvm/dev/mailbox/${w}/${randomUUID()}`;
      values.set(arn, v);
      return arn;
    },
    read: async (w, a) => {
      assert.ok(a.includes(w));
      return values.get(a);
    },
    write: async (w, a, v) => {
      assert.ok(a.includes(w));
      values.set(a, v);
    },
    remove: async (w, a) => {
      assert.ok(a.includes(w));
      values.delete(a);
    },
    config: async () => ({
      clientId: "test.apps.googleusercontent.com",
      clientSecret: "test",
      redirectUri: "https://app.example.com/mailbox-callback.html",
    }),
  };
  const tokens = () => ({
    accessToken: "token",
    refreshToken: "refresh",
    expiresAt: Date.now() + 3600000,
    scopes: GOOGLE_SCOPES,
  });
  const provider: ReturnType<typeof googleMailbox> = {
    authorise: (s) => `https://accounts.google.com/?state=${s}`,
    exchange: async () => tokens(),
    refresh: async () => {
      refreshes++;
      return tokens();
    },
    profile: async () => ({ emailAddress: "owner@example.com" }),
    send: async (_a, mime) => {
      sent++;
      reference = mime.match(/Message-ID: (.+)\r\n/)![1]!;
      if (ambiguous)
        throw new MailboxError("PROVIDER_UNAVAILABLE", "unknown", true);
      return { id: "sent", threadId: "thread" };
    },
    findSent: async () => ({ id: "sent", threadId: "thread" }),
    thread: async () =>
      replies
        ? [
            {
              providerId: "reply",
              conversationId: "thread",
              internetMessageId: "<reply@example.com>",
              inReplyTo: reference,
              references: [reference],
              from: "owner@example.com",
              to: ["owner@example.com"],
              subject: "Re: test",
              text: "Received",
              occurredAt: new Date().toISOString(),
            },
          ]
        : [],
    revoke: async () => {},
  };
  const app = createMailboxApplication(
    config,
    f.db.mongo,
    secrets,
    () => provider,
  );
  async function connect() {
    const a = await app.begin(f.identity, f.w);
    await app.finish(f.identity, f.w, {
      state: a.state,
      browserSecret: a.browserSecret,
      code: "code",
    });
    return a;
  }
  return {
    ...f,
    app,
    connect,
    values,
    provider,
    sent: () => sent,
    refreshes: () => refreshes,
    ambiguity: () => {
      ambiguous = true;
    },
    reply: () => {
      replies = true;
    },
  };
}
