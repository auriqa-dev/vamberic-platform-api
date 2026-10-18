import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { randomUUID } from "node:crypto";
import type { ClientSession } from "mongodb";
import { config, lushaFixture } from "./helpers/lusha";
import {
  createWebsiteTracking,
  prepareTracking,
  trackingRow,
  readToken,
} from "../src/services/website-tracking/service";
import {
  websiteOrigin,
  secret,
  recordingBudget,
  browserEvent,
  automated,
} from "../src/services/website-tracking/model";
import { trackerScript } from "../src/services/website-tracking/script";
import { generatePlatformId } from "../src/domain";
import { renderTemplate } from "../src/services/email-templates/render";
import type { EmailRecord } from "../src/services/email-content/model";
import { summarise } from "../src/services/measurement/model";

async function fixture(testOnly = false) {
  const f = await lushaFixture(),
    db = await f.db.mongo.database(),
    s = {} as ClientSession;
  const site = trackingRow(f.w, "website_tracking_site", {
    origin: "https://example.com",
    brandId: f.brand,
    enabled: true,
    testOnly,
    retentionDays: 30,
    policyConfirmed: true,
    events: ["resource_download"],
    version: 1,
    verification: "test",
    verifiedAt: new Date().toISOString(),
    revoked: false,
    lastReceivedAt: null,
  });
  f.db.rows("events").push(site);
  const contactId = generatePlatformId("person");
  f.db.rows("people").push({ id: contactId, workspaceId: f.w });
  const draft = {
    id: "draft",
    version: 1,
    brandId: f.brand,
    contactId,
    campaignId: generatePlatformId("campaign"),
    ctaUrl: "https://example.com/compare?source=email#details",
    content: {
      subject: "Hello",
      body: "See the comparison",
      ctaText: "See the comparison",
      ctaAssetId: "asset",
    },
  };
  const comm = trackingRow(f.w, "communication", {
    draft,
    testOnly,
    status: "accepted",
    version: 1,
  });
  f.db.rows("events").push(comm);
  const prior = process.env.HVM_TRACKING_PUBLIC_ORIGIN;
  process.env.HVM_TRACKING_PUBLIC_ORIGIN = "https://api.example.com";
  let link;
  try {
    link = await prepareTracking(db, f.w, draft, comm.id, testOnly, s);
  } finally {
    if (prior === undefined) delete process.env.HVM_TRACKING_PUBLIC_ORIGIN;
    else process.env.HVM_TRACKING_PUBLIC_ORIGIN = prior;
  }
  assert.ok(link);
  return {
    ...f,
    db,
    s,
    site,
    draft,
    comm,
    link,
    token: link.url.split("/r/")[1]!,
    app: createWebsiteTracking(config, f.db.mongo),
  };
}
test("origins reject internal, credentialed, non-HTTPS and path-bearing addresses", () => {
  for (const u of [
    "http://example.com",
    "https://127.0.0.1",
    "https://[::1]",
    "https://localhost",
    "https://example.local",
    "https://example.com/path",
    "https://u:p@example.com",
    "https://example.com:8443",
  ])
    assert.throws(() => websiteOrigin(u));
  assert.equal(websiteOrigin("https://EXAMPLE.com/"), "https://example.com");
  assert.equal(secret().length, 43);
  assert.equal(automated("Googlebot", ""), true);
  assert.equal(automated("Mozilla", "prefetch"), true);
  assert.equal(
    browserEvent.safeParse({
      eventId: randomUUID(),
      kind: "page_view",
      path: "/",
      consent: true,
      contactId: "injected",
    }).success,
    false,
  );
});
test("tracked CTA renders once, preserves approved source and uses tracking in both alternatives", () => {
  const draft = {
    content: {
      subject: "Hello",
      body: "Visit https://example.com/compare",
      ctaText: "Compare",
    },
    ctaUrl: "https://example.com/compare",
  } as EmailRecord;
  const r = renderTemplate(
    draft,
    undefined,
    null,
    false,
    "https://api.example.com/r/opaque",
  );
  assert.equal((r.html.match(/href=/g) || []).length, 1);
  assert.match(r.html, /href="https:\/\/api.example.com\/r\/opaque"/);
  assert.match(r.text, /api.example.com\/r\/opaque/);
  assert.equal(draft.ctaUrl, "https://example.com/compare");
});
test("redirects preserve approved destinations, reject invalid tokens and stop recording after revoke", async () => {
  const f = await fixture();
  assert.equal(await f.app.redirect(f.token + "bad", false), null);
  const url = await f.app.redirect(f.token, false);
  assert.match(url!, /#details&hvm_tracking=/);
  assert.equal(
    await f.app.redirect(f.token, true),
    expectedAttributedDestination(f.draft),
  );
  assert.equal(
    f.db.rows("events").filter((r) => r.eventType === "measurement_outcome")
      .length,
    2,
  );
  f.site.payload.revoked = true;
  assert.equal(
    await f.app.redirect(f.token, false),
    expectedAttributedDestination(f.draft),
  );
  assert.equal(
    f.db.rows("events").filter((r) => r.eventType === "measurement_outcome")
      .length,
    2,
  );
});
test("public event attribution is server-side, scoped, idempotent and does not claim confirmed identity", async () => {
  const f = await fixture();
  const eventId = randomUUID();
  await assert.rejects(() =>
    f.app.collect(
      f.site.id,
      "https://evil.example",
      { eventId, kind: "page_view", path: "/compare", consent: true },
      false,
    ),
  );
  const result = await f.app.collect(
    f.site.id,
    "https://example.com",
    {
      eventId,
      link: f.token,
      kind: "page_view",
      path: "/compare?email=private",
      consent: true,
    },
    false,
  );
  await f.app.collect(
    f.site.id,
    "https://example.com",
    {
      eventId,
      session: result.session,
      kind: "page_view",
      path: "/compare",
      consent: true,
    },
    false,
  );
  let outcomes = f.db
    .rows("events")
    .filter((r) => r.eventType === "measurement_outcome");
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0]!.payload.contactId, f.draft.contactId);
  assert.equal(outcomes[0]!.payload.website.identity, "intended_recipient");
  assert.equal(outcomes[0]!.payload.website.path, "/compare");
  const session = await readToken(
    f.db,
    result.session,
    "website_tracking_session",
  );
  assert.ok(session);
  session.payload.startedAt = Date.now() - 5000;
  await f.app.collect(
    f.site.id,
    "https://example.com",
    {
      eventId: randomUUID(),
      session: result.session,
      kind: "engaged",
      path: "/private/user@example.com",
      consent: true,
    },
    false,
  );
  outcomes = f.db
    .rows("events")
    .filter((r) => r.eventType === "measurement_outcome");
  assert.equal(outcomes[1]!.payload.website.path, "[other page]");
  assert.equal(outcomes[1]!.payload.website.automation, "likely_human");
  assert.equal(
    f.db
      .rows("events")
      .filter((r) => r.eventType === "nba_measurement_feedback").length,
    1,
  );
});
test("anonymous and test website evidence never enqueue NBA work", async () => {
  const f = await fixture(true);
  const a = await f.app.collect(
    f.site.id,
    "https://example.com",
    {
      eventId: randomUUID(),
      link: f.token,
      kind: "page_view",
      path: "/compare",
      consent: true,
    },
    false,
  );
  const session = await readToken(f.db, a.session, "website_tracking_session");
  session!.payload.startedAt = Date.now() - 5000;
  await f.app.collect(
    f.site.id,
    "https://example.com",
    {
      eventId: randomUUID(),
      session: a.session,
      kind: "engaged",
      path: "/compare",
      consent: true,
    },
    false,
  );
  assert.equal(
    f.db
      .rows("events")
      .filter((r) => r.eventType === "nba_measurement_feedback").length,
    0,
  );
  const events = f.db
    .rows("events")
    .filter((r) => r.eventType === "measurement_outcome")
    .map((r) => r.payload);
  assert.equal(
    summarise(events as never).find((m) => m.kind === "website_engaged")!.value,
    0,
  );
});
test("recording budget is bounded and replenishes", () => {
  const allow = recordingBudget();
  for (let i = 0; i < 120; i++) assert.equal(allow("a", 1), true);
  assert.equal(allow("a", 1), false);
  assert.equal(allow("a", 60001), true);
});
test("script is inert before consent, strips attribution fragment, stores only after consent and clears on withdrawal", async () => {
  const requests: unknown[] = [];
  const stored = new Map<string, string>();
  const location = {
    pathname: "/compare",
    search: "",
    hash: "#details&hvm_tracking=opaque",
  };
  const history = {
    state: null,
    replaceState: (_a: unknown, _b: unknown, url: string) => {
      location.hash = url.includes("#") ? url.slice(url.indexOf("#")) : "";
    },
    pushState: () => {},
  };
  const window = {} as { HVMTracking: { consent: (x: boolean) => void } };
  runInNewContext(trackerScript, {
    window,
    document: {
      currentScript: {
        src: "https://api.example.com/api/v1/public/tracking/tracker.js",
        getAttribute: (name: string) => (name === "data-site" ? "site" : null),
      },
      visibilityState: "visible",
    },
    URL,
    location,
    history,
    addEventListener: () => {},
    crypto: { randomUUID },
    Date,
    sessionStorage: {
      getItem: (k: string) => stored.get(k),
      setItem: (k: string, v: string) => stored.set(k, v),
      removeItem: (k: string) => stored.delete(k),
    },
    fetch: async (_url: string, input: unknown) => {
      requests.push(input);
      return { ok: true, json: async () => ({ session: "receipt" }) };
    },
  });
  assert.equal(requests.length, 0);
  assert.equal(stored.size, 0);
  assert.equal(location.hash, "#details");
  window.HVMTracking.consent(true);
  await new Promise((r) => setImmediate(r));
  assert.equal(requests.length, 1);
  assert.equal(stored.size, 1);
  window.HVMTracking.consent(false);
  assert.equal(stored.size, 0);
});

test("website management requires workspace integration authority and prevents stale edits and deletion of used sites", async () => {
  const f = await fixture();
  await assert.rejects(() =>
    f.app.list({ ...f.identity, subject: "outsider" }, f.w),
  );
  const state = await f.app.list(f.identity, f.w);
  assert.equal(state.canManage, true);
  await assert.rejects(
    () =>
      f.app.mutate(f.identity, f.w, {
        id: f.site.id,
        expectedVersion: 0,
        operation: "revoke",
      }),
    /Refresh/,
  );
  await assert.rejects(
    () =>
      f.app.mutate(f.identity, f.w, {
        id: f.site.id,
        expectedVersion: 1,
        operation: "delete",
      }),
    /Revoke/,
  );
  const saved = await f.app.mutate(f.identity, f.w, {
    id: f.site.id,
    expectedVersion: 1,
    operation: "revoke",
  });
  assert.equal(saved.sites[0]!.revoked, true);
});
test("recording failure leaves a valid CTA navigable and scanner requests never request NBA review", async () => {
  const f = await fixture();
  await f.app.redirect(f.token, true);
  assert.equal(
    f.db
      .rows("events")
      .filter((r) => r.eventType === "nba_measurement_feedback").length,
    0,
  );
  f.db.failCollection = "events";
  assert.equal(
    await f.app.redirect(f.token, false),
    expectedAttributedDestination(f.draft),
  );
});
test("a website interaction cannot replace an out-of-office wait or unsubscribe review", async () => {
  const f = await fixture();
  const prior = trackingRow(f.w, "nba_measurement_feedback", {
    key: `${f.draft.campaignId}:${f.draft.contactId}`,
    kind: "reply_interpreted",
    category: "unsubscribe",
    state: "review_required",
    reason: "Restricted",
    version: 1,
  });
  f.db.rows("events").push(prior);
  const r = await f.app.collect(
    f.site.id,
    "https://example.com",
    {
      eventId: randomUUID(),
      link: f.token,
      kind: "page_view",
      path: "/compare",
      consent: true,
    },
    false,
  );
  const session = await readToken(f.db, r.session, "website_tracking_session");
  session!.payload.startedAt = Date.now() - 5000;
  await f.app.collect(
    f.site.id,
    "https://example.com",
    {
      eventId: randomUUID(),
      session: r.session,
      kind: "engaged",
      path: "/compare",
      consent: true,
    },
    false,
  );
  assert.equal(prior.payload.category, "unsubscribe");
  assert.equal(prior.payload.version, 1);
});
test("cross-site session and link tokens cannot attribute an unrelated website visitor", async () => {
  const f = await fixture();
  const other = trackingRow(f.w, "website_tracking_site", {
    ...f.site.payload,
    origin: "https://other.example.com",
  });
  f.db.rows("events").push(other);
  await f.app.collect(
    other.id,
    "https://other.example.com",
    {
      eventId: randomUUID(),
      link: f.token,
      kind: "page_view",
      path: "/compare",
      consent: true,
    },
    false,
  );
  const row = f.db
    .rows("events")
    .find((r) => r.eventType === "measurement_outcome");
  assert.equal(row!.payload.contactId, "");
  assert.equal(row!.payload.website.identity, "anonymous");
});

test("DNS ownership must match the workspace-specific challenge before tracking can be enabled", async () => {
  const f = await lushaFixture();
  let txt = "wrong";
  const app = createWebsiteTracking(config, f.db.mongo, {
    dns: async () => [[txt]],
  });
  const created = await app.mutate(f.identity, f.w, {
    id: "",
    expectedVersion: 0,
    operation: "save",
    settings: {
      origin: "https://example.com",
      brandId: f.brand,
      enabled: false,
      testOnly: true,
      retentionDays: 14,
      policyConfirmed: true,
      events: [],
    },
  });
  const site = created.sites[0]!;
  await assert.rejects(
    () =>
      app.mutate(f.identity, f.w, {
        id: site.id,
        expectedVersion: 1,
        operation: "verify",
      }),
    /DNS record not found/,
  );
  txt = String(site.verification);
  const verified = await app.mutate(f.identity, f.w, {
    id: site.id,
    expectedVersion: 1,
    operation: "verify",
  });
  assert.ok(verified.sites[0]!.verifiedAt);
  await app.mutate(f.identity, f.w, {
    id: site.id,
    expectedVersion: 2,
    operation: "save",
    settings: {
      origin: "https://example.com",
      brandId: f.brand,
      enabled: true,
      testOnly: true,
      retentionDays: 14,
      policyConfirmed: true,
      events: [],
    },
  });
  assert.equal((await app.list(f.identity, f.w)).sites[0]!.enabled, true);
});

test("public HTTP endpoints enforce exact origin, payload limits and safe redirect headers", async () => {
  const { default: express } = await import("express");
  const { publicWebsiteTrackingRouter } =
    await import("../src/routes/website-tracking");
  const f = await fixture();
  const api = express();
  api.use("/tracking", publicWebsiteTrackingRouter(config, f.db.mongo));
  const server = api.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/tracking`;
  const prior = process.env.HVM_TRACKING_PUBLIC_ORIGIN;
  process.env.HVM_TRACKING_PUBLIC_ORIGIN = "https://api.example.com";
  try {
    const redirect = await fetch(`${base}/r/${f.token}`, {
      redirect: "manual",
    });
    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.get("referrer-policy"), "no-referrer");
    assert.equal(redirect.headers.get("cache-control"), "no-store");
    const denied = await fetch(`${base}/sites/${f.site.id}/events`, {
      method: "OPTIONS",
      headers: { Origin: "https://evil.example" },
    });
    assert.equal(denied.status, 403);
    const preflight = await fetch(`${base}/sites/${f.site.id}/events`, {
      method: "OPTIONS",
      headers: { Origin: "https://example.com" },
    });
    assert.equal(preflight.status, 204);
    assert.equal(
      preflight.headers.get("access-control-allow-origin"),
      "https://example.com",
    );
    assert.equal(
      preflight.headers.get("access-control-allow-credentials"),
      null,
    );
    const write = await fetch(`${base}/sites/${f.site.id}/events`, {
      method: "POST",
      headers: {
        Origin: "https://example.com",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        eventId: randomUUID(),
        kind: "page_view",
        path: "/",
        consent: true,
      }),
    });
    assert.equal(write.status, 200);
    assert.deepEqual(Object.keys(await write.json()), ["session"]);
    const huge = await fetch(`${base}/sites/${f.site.id}/events`, {
      method: "POST",
      headers: {
        Origin: "https://example.com",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ path: "a".repeat(5000) }),
    });
    assert.equal(huge.status, 413);
  } finally {
    if (prior === undefined) delete process.env.HVM_TRACKING_PUBLIC_ORIGIN;
    else process.env.HVM_TRACKING_PUBLIC_ORIGIN = prior;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("retention removes website evidence and session identity without deleting delivery history or breaking links", async () => {
  const { expireWebsiteEvidence } =
    await import("../src/services/website-tracking/cleanup");
  const f = await fixture();
  await f.app.collect(
    f.site.id,
    "https://example.com",
    {
      eventId: randomUUID(),
      link: f.token,
      kind: "page_view",
      path: "/compare",
      consent: true,
    },
    false,
  );
  const rows = f.db.rows("events");
  for (const row of rows) {
    if (row.eventType === "measurement_outcome")
      row.payload.website.expiresAt = new Date(0).toISOString();
    if (
      ["website_tracking_link", "website_tracking_session"].includes(
        row.eventType,
      )
    )
      row.payload.expiresAt = new Date(0);
  }
  await expireWebsiteEvidence(f.db.mongo);
  assert.equal(
    f.db
      .rows("events")
      .filter((r) =>
        ["measurement_outcome", "website_tracking_session"].includes(
          r.eventType,
        ),
      ).length,
    0,
  );
  assert.ok(f.db.rows("events").some((r) => r.id === f.comm.id));
  const link = await readToken(f.db, f.token, "website_tracking_link");
  assert.equal(link!.payload.communicationId, null);
  assert.equal(
    await f.app.redirect(f.token, false),
    expectedAttributedDestination(f.draft),
  );
});
test("test browser sessions remain excluded when the site leaves test mode or its test communication is removed", async () => {
  const f = await fixture(true);
  const r = await f.app.collect(
    f.site.id,
    "https://example.com",
    {
      eventId: randomUUID(),
      link: f.token,
      kind: "page_view",
      path: "/compare",
      consent: true,
    },
    false,
  );
  f.site.payload.testOnly = false;
  await f.db.collection("events").deleteOne({ id: f.comm.id });
  await f.app.collect(
    f.site.id,
    "https://example.com",
    {
      eventId: randomUUID(),
      session: r.session,
      kind: "page_view",
      path: "/compare",
      consent: true,
    },
    false,
  );
  assert.ok(
    f.db
      .rows("events")
      .filter((r) => r.eventType === "measurement_outcome")
      .every((r) => r.payload.testOnly),
  );
});

function expectedAttributedDestination(draft: {
  ctaUrl: string;
  campaignId: string;
}) {
  const url = new URL(draft.ctaUrl);
  for (const [key, value] of Object.entries({
    utm_source: "hvm",
    utm_medium: "email",
    utm_campaign: draft.campaignId,
    utm_id: draft.campaignId,
    utm_source_platform: "hvm",
    utm_content: "draft",
  }))
    url.searchParams.set(key, value);
  return url.toString();
}
