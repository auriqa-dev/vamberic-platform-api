import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lushaFixture, config } from "./helpers/lusha";
import { createMailboxApplication } from "../src/services/mailbox/application";
import {
  MailboxError,
  GOOGLE_SCOPES,
  googleMailbox,
  emailMime,
  parseGoogleMessage,
} from "../src/services/mailbox/google";
import type { MailboxSecrets } from "../src/services/mailbox/secrets";
async function fixture() {
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
test("Gmail connection enforces workspace authority and consumes callback once", async () => {
  const f = await fixture();
  const a = await f.connect();
  const result = await f.app.read(f.identity, f.w);
  assert.equal(result.email, "owner@example.com");
  assert.equal(result.status, "connected");
  assert.equal(result.readiness.ready, false);
  assert.ok(!JSON.stringify(result).includes("accessToken"));
  await assert.rejects(
    f.app.finish(f.identity, f.w, {
      state: a.state,
      browserSecret: a.browserSecret,
      code: "code",
    }),
  );
  await assert.rejects(f.app.read({ ...f.identity, subject: "other" }, f.w));
});
test("callback cannot be used by a different browser", async () => {
  const f = await fixture(),
    a = await f.app.begin(f.identity, f.w);
  await assert.rejects(
    f.app.finish(f.identity, f.w, {
      state: a.state,
      browserSecret: "x".repeat(43),
      code: "code",
    }),
  );
  await f.app.finish(f.identity, f.w, {
    state: a.state,
    browserSecret: a.browserSecret,
    code: "code",
  });
});
test("controlled test, replay, reply dedup and disconnect preserve test isolation", async () => {
  const f = await fixture();
  await f.connect();
  const input = {
    operationId: randomUUID(),
    recipient: "owner@example.com",
    controlledInboxConfirmed: true,
  };
  await assert.rejects(
    f.app.sendTest(f.identity, f.w, {
      ...input,
      recipient: "prospect@example.com",
    }),
  );
  await f.app.sendTest(f.identity, f.w, input);
  await f.app.sendTest(f.identity, f.w, input);
  assert.equal(f.sent(), 1);
  f.reply();
  await f.app.sync(f.identity, f.w);
  await f.app.sync(f.identity, f.w);
  const state = await f.app.read(f.identity, f.w);
  assert.equal(state.replies.length, 1);
  assert.equal(state.readiness.ready, true);
  assert.equal(
    f.db.rows("events").filter((e) => e.eventType === "email").length,
    0,
  );
  await f.app.disconnect(f.identity, f.w, {
    expectedUpdatedAt: state.updatedAt,
  });
  const disconnected = f.db.rows("workspace_integrations").find((r) => r.workspaceId === f.w)!;
  // Mongo permits the base actor fields only; an OAuth issuer here rejects the write.
  assert.deepEqual(disconnected.updatedBy, { type: "human", id: f.identity.subject });
  assert.equal(disconnected.secretReference, undefined);
  await assert.rejects(
    f.app.sendTest(f.identity, f.w, { ...input, operationId: randomUUID() }),
  );
  assert.equal((await f.app.read(f.identity, f.w)).status, "disconnected");
});
test("ambiguous send reconciles without another delivery attempt", async () => {
  const f = await fixture();
  await f.connect();
  f.ambiguity();
  const input = {
    operationId: randomUUID(),
    recipient: "owner@example.com",
    controlledInboxConfirmed: true,
  };
  await assert.rejects(f.app.sendTest(f.identity, f.w, input));
  assert.equal((await f.app.read(f.identity, f.w)).tests[0]?.status, "unknown");
  await f.app.sendTest(f.identity, f.w, input);
  await f.app.sync(f.identity, f.w);
  assert.equal(f.sent(), 1);
  assert.equal(
    (await f.app.read(f.identity, f.w)).tests[0]?.status,
    "accepted",
  );
});
test("Google send never retries and MIME has both alternatives", async () => {
  let n = 0;
  const g = googleMailbox(
    {
      clientId: "id",
      clientSecret: "secret",
      redirectUri: "https://app.example.com/mailbox-callback.html",
    },
    async () => {
      n++;
      throw new Error("timeout");
    },
  );
  await assert.rejects(
    g.send("token", "mime"),
    (e: unknown) => e instanceof MailboxError && e.ambiguous,
  );
  assert.equal(n, 1);
  const mime = emailMime(
    "owner@example.com",
    {
      operationId: randomUUID(),
      to: "test@example.com",
      subject: "British English",
      text: "Text",
      html: "<p>Text</p>",
    },
    "<test@example.com>",
  );
  assert.match(mime, /multipart\/alternative/);
  assert.match(mime, /text\/plain/);
  assert.match(mime, /text\/html/);
});
test("Google reply parsing never renders HTML", () => {
  const r = parseGoogleMessage({
    id: "a",
    threadId: "b",
    internalDate: "1000",
    payload: {
      mimeType: "multipart/alternative",
      headers: [
        { name: "References", value: "<b@example.com> <c@example.com>" },
      ],
      parts: [
        {
          mimeType: "text/html",
          body: {
            data: Buffer.from("<script>bad()</script>").toString("base64url"),
          },
        },
        {
          mimeType: "text/plain",
          body: { data: Buffer.from("Hello").toString("base64url") },
        },
      ],
    },
  });
  assert.equal(r.text, "\nHello");
  assert.deepEqual(r.references, ["<b@example.com>", "<c@example.com>"]);
});

test("background sync metadata does not invalidate reconnect consent", async () => {
  const f = await fixture();
  await f.connect();
  const attempt = await f.app.begin(f.identity, f.w);
  await f.app.testConnection(f.identity, f.w);
  await f.app.finish(f.identity, f.w, {
    state: attempt.state,
    browserSecret: attempt.browserSecret,
    code: "new-code",
  });
  assert.equal((await f.app.read(f.identity, f.w)).status, "connected");
});
test("expired credentials refresh server-side before access", async () => {
  const f = await fixture();
  await f.connect();
  for (const [key, value] of f.values)
    if (value && typeof value === "object" && "accessToken" in value)
      f.values.set(key, { ...value, expiresAt: 0 });
  await f.app.testConnection(f.identity, f.w);
  assert.equal(f.refreshes(), 1);
});
test("Google partial consent and revoked refresh grant require reconnect", async () => {
  const config = {
    clientId: "id",
    clientSecret: "secret",
    redirectUri: "https://app.example.com/mailbox-callback.html",
  };
  const partial = googleMailbox(
    config,
    async () =>
      new Response(
        JSON.stringify({
          access_token: "token",
          refresh_token: "refresh",
          expires_in: 3600,
          scope: GOOGLE_SCOPES[0],
        }),
      ),
  );
  await assert.rejects(
    partial.exchange("code", "verifier"),
    (e: unknown) => e instanceof MailboxError && e.code === "CONSENT_REQUIRED",
  );
  const revoked = googleMailbox(
    config,
    async () => new Response('{"error":"invalid_grant"}', { status: 400 }),
  );
  await assert.rejects(
    revoked.refresh({
      accessToken: "token",
      refreshToken: "refresh",
      expiresAt: 0,
      scopes: GOOGLE_SCOPES,
    }),
    (e: unknown) => e instanceof MailboxError && e.code === "RECONNECT",
  );
});
