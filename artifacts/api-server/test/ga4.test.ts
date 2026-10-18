import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lushaFixture, config } from "./helpers/lusha";
import { createGa4Application } from "../src/services/ga4/application";
import { googleAnalytics, GA4_SCOPE, Ga4Error } from "../src/services/ga4/google";
import type { Ga4Secrets } from "../src/services/ga4/secrets";
import { EventInsertSchema } from "../src/domain";
async function fixture() {
  const f = await lushaFixture(),
    values = new Map<string, unknown>();
  const secrets: Ga4Secrets = {
    create: async (w, v) => {
      const ref = `arn:aws:secretsmanager:eu-west-2:123456789012:secret:hvm/dev/ga4/${w}/${randomUUID()}`;
      values.set(ref, v);
      return ref;
    },
    read: async (w, r) => {
      assert.ok(r.includes(w));
      return values.get(r);
    },
    write: async (w, r, v) => {
      assert.ok(r.includes(w));
      values.set(r, v);
    },
    remove: async (w, r) => {
      assert.ok(r.includes(w));
      values.delete(r);
    },
    config: async () => ({
      clientId: "test.apps.googleusercontent.com",
      clientSecret: "secret",
      redirectUri: "https://hvm.example/ga4-callback.html",
    }),
  };
  const token = () => ({
    accessToken: "access-secret",
    refreshToken: "refresh-secret",
    expiresAt: Date.now() + 3600000,
    scopes: [GA4_SCOPE],
  });
  let fail = false;
  const provider: ReturnType<typeof googleAnalytics> = {
    report: async () => { throw new Error("Not used by connection tests"); },
    authorise: (s) => `https://accounts.google.com/?state=${s}`,
    exchange: async () => token(),
    refresh: async () => token(),
    properties: async () => ({
      properties: [
        {
          property: "properties/123",
          displayName: "Client site",
          accountName: "Client",
        },
      ],
      nextPageToken: null,
    }),
    verify: async (_a, p) => {
      if (fail) throw new Ga4Error("ACCESS_DENIED", "Google access denied");
      return {
        name: p,
        displayName: "Client site",
        timeZone: "Europe/London",
        currencyCode: "GBP",
        hasReportRows: false,
      };
    },
  };
  const app = createGa4Application(config, f.db.mongo, secrets, () => provider);
  async function begin() {
    const s = await app.read(f.identity, f.w);
    const a = await app.begin(f.identity, f.w, {
      expectedUpdatedAt: s.updatedAt,
    });
    return { state: a.state, browserSecret: a.browserSecret };
  }
  async function prepare() {
    const a = await begin();
    await app.finish(f.identity, f.w, { ...a, code: "code" });
    return a;
  }
  return {
    ...f,
    app,
    values,
    begin,
    prepare,
    deny: () => {
      fail = true;
    },
  };
}
test("GA4 saves only after property reporting verification; disconnect removes credentials and preserves evidence", async () => {
  const f = await fixture(),
    a = await f.prepare();
  assert.equal((await f.app.read(f.identity, f.w)).status, "not_connected");
  const saved = await f.app.select(f.identity, f.w, {
    ...a,
    property: "properties/123",
  });
  assert.equal(saved.status, "connected");
  assert.equal(saved.property?.name, "properties/123");
  assert.equal(saved.hasReportRows, false);
  assert.ok(!JSON.stringify(saved).includes("secret"));
  assert.equal(f.values.size, 1);
  await assert.rejects(
    f.app.select(f.identity, f.w, { ...a, property: "properties/456" }),
  );
  const tested = await f.app.test(f.identity, f.w, {
    expectedUpdatedAt: saved.updatedAt,
  });
  await assert.rejects(
    f.app.disconnect(f.identity, f.w, { expectedUpdatedAt: saved.updatedAt }),
  );
  const disconnected = await f.app.disconnect(f.identity, f.w, {
    expectedUpdatedAt: tested.updatedAt,
  });
  assert.equal(disconnected.status, "disconnected");
  assert.equal(disconnected.property, null);
  assert.equal(f.values.size, 0);
  assert.ok(f.db.rows("events").some((e) => e.eventType === "ga4_verified"));
});
test("GA4 binds callback to initiating browser, user and workspace and consumes it once", async () => {
  const f = await fixture(),
    a = await f.begin();
  await assert.rejects(
    f.app.finish(f.identity, f.w, {
      ...a,
      browserSecret: "x".repeat(43),
      code: "code",
    }),
  );
  await assert.rejects(
    f.app.finish({ ...f.identity, subject: "other" }, f.w, {
      ...a,
      code: "code",
    }),
  );
  await f.app.finish(f.identity, f.w, { ...a, code: "code" });
  await assert.rejects(f.app.finish(f.identity, f.w, { ...a, code: "code" }));
  await assert.rejects(
    f.app.properties({ ...f.identity, subject: "other" }, f.w, a),
  );
});
test("GA4 expired and stale selection cannot replace current connection", async () => {
  const f = await fixture(),
    a = await f.prepare(),
    b = await f.prepare();
  await f.app.select(f.identity, f.w, { ...a, property: "properties/123" });
  await assert.rejects(
    f.app.select(f.identity, f.w, { ...b, property: "properties/456" }),
  );
  assert.equal(
    (await f.app.read(f.identity, f.w)).property?.name,
    "properties/123",
  );
  const c = await f.prepare();
  for (const r of f.db.rows("events"))
    if (r.eventType === "ga4_oauth")
      r.payload.expiresAt = new Date(0).toISOString();
  await assert.rejects(
    f.app.select(f.identity, f.w, { ...c, property: "properties/456" }),
  );
});
test("failed verification leaves existing connection intact", async () => {
  const f = await fixture(),
    a = await f.prepare();
  await f.app.select(f.identity, f.w, { ...a, property: "properties/123" });
  const b = await f.prepare();
  f.deny();
  await assert.rejects(
    f.app.select(f.identity, f.w, { ...b, property: "properties/456" }),
  );
  assert.equal(
    (await f.app.read(f.identity, f.w)).property?.name,
    "properties/123",
  );
});
test("Google adapter requests only Analytics read access, encodes pagination and distinguishes no rows from zero", async () => {
  const requests: { url: string; init?: RequestInit }[] = [];
  const client = googleAnalytics(
    {
      clientId: "x",
      clientSecret: "secret",
      redirectUri: "https://example.com/ga4-callback.html",
    },
    async (url, init) => {
      requests.push({ url: String(url), init });
      return new Response(
        JSON.stringify(
          String(url).includes("accountSummaries")
            ? { accountSummaries: [], nextPageToken: "next" }
            : String(url).includes("runReport")
              ? {}
              : {
                  name: "properties/123",
                  displayName: "Site",
                  timeZone: "Europe/London",
                  currencyCode: "GBP",
                },
        ),
      );
    },
  );
  const auth = new URL(client.authorise("state", "challenge"));
  assert.equal(auth.searchParams.get("scope"), GA4_SCOPE);
  assert.equal(auth.searchParams.get("code_challenge_method"), "S256");
  assert.equal(
    (await client.properties("access", "a&b")).nextPageToken,
    "next",
  );
  assert.ok(requests[0]!.url.includes("a%26b"));
  assert.equal(
    (await client.verify("access", "properties/123")).hasReportRows,
    false,
  );
  await assert.rejects(client.verify("access", "https://evil.example"));
  assert.equal(requests.length, 3);
});
test("generic event insert cannot forge GA4 control records", () => {
  const input = { eventType: "ga4_oauth", occurredAt: new Date(), payload: {} };
  assert.equal(EventInsertSchema.safeParse(input).success, false);
});

test("revoked access remains visibly flagged after refresh", async () => {
  const f = await fixture(),
    a = await f.prepare();
  const saved = await f.app.select(f.identity, f.w, {
    ...a,
    property: "properties/123",
  });
  f.deny();
  await assert.rejects(
    f.app.test(f.identity, f.w, { expectedUpdatedAt: saved.updatedAt }),
  );
  assert.equal((await f.app.read(f.identity, f.w)).status, "needs_attention");
});
