import type { Document } from "mongodb";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { googleAnalytics } from "../src/services/ga4/google";
import {
  parseReport,
  metricNames,
  defaultWindow,
  reportWindow,
} from "../src/services/ga4/reporting";
import { createPerformanceService } from "../src/services/performance/service";
import { lushaFixture, config } from "./helpers/lusha";
import { EventInsertSchema, generatePlatformId } from "../src/domain";
const window = { startDate: "2026-09-01", endDate: "2026-09-28" };
const values = {
  sessions: 12,
  totalUsers: 8,
  newUsers: 5,
  screenPageViews: 25,
  engagedSessions: 7,
  keyEvents: 1,
};
const table = { rows: [], rowCount: 0, truncated: false, warnings: [] };
const connection = {
  available: true,
  canManage: true,
  status: "connected",
  updatedAt: "2026-10-17T00:00:00.000Z",
  property: {
    name: "properties/123",
    displayName: "Client website",
    timeZone: "Europe/London",
    currencyCode: "GBP",
  },
  lastCheckedAt: "2026-10-17T00:00:00.000Z",
  hasReportRows: true,
};
test("GA4 reporting uses separate period aggregates, exact session attribution and reports thresholding", async () => {
  const calls: Document[] = [];
  const client = googleAnalytics(
    {
      clientId: "test.apps.googleusercontent.com",
      clientSecret: "secret",
      redirectUri: "https://example.com/ga4-callback.html",
    },
    async (_url, init) => {
      const b = JSON.parse(String(init?.body));
      calls.push(b);
      return new Response(
        JSON.stringify({
          dimensionHeaders: b.dimensions,
          metricHeaders: b.metrics,
          rowCount: 1,
          rows: [
            {
              dimensionValues: b.dimensions.map(() => ({ value: "20260901" })),
              metricValues: metricNames.map((n) => ({
                value: String(values[n]),
              })),
            },
          ],
          metadata: { timeZone: "Europe/London", subjectToThresholding: true },
        }),
      );
    },
  );
  const result = await client.report(
    "secret",
    "properties/123",
    window,
    "Europe/London",
    { field: "sessionCampaignId", value: "campaign-tag" },
  );
  assert.equal(calls.length, 4);
  assert.equal(calls.filter((c) => !c.dimensions.length).length, 1);
  assert.ok(
    calls.every(
      (c) =>
        c.dimensionFilter.filter.fieldName === "sessionCampaignId" &&
        c.dimensionFilter.filter.stringFilter.matchType === "EXACT",
    ),
  );
  assert.equal(result.totals?.totalUsers, 8);
  assert.match(result.warnings[0]!, /thresholding/);
});
test("GA4 empty data is unavailable, date validation and property timezone boundaries are explicit", () => {
  assert.equal(
    parseReport({ metricHeaders: metricNames.map((name) => ({ name })) }, [])
      .rows.length,
    0,
  );
  assert.throws(() =>
    reportWindow.parse({ startDate: "2026-02-30", endDate: "2026-03-01" }),
  );
  assert.throws(() =>
    reportWindow.parse({ startDate: "2025-01-01", endDate: "2026-10-01" }),
  );
  assert.deepEqual(
    defaultWindow("America/Los_Angeles", new Date("2026-10-17T01:00:00Z")),
    { startDate: "2026-09-18", endDate: "2026-10-15" },
  );
  assert.throws(() =>
    parseReport(
      {
        metricHeaders: metricNames.map((name) => ({ name })),
        rows: [{ metricValues: metricNames.map(() => ({ value: "NaN" })) }],
      },
      [],
    ),
  );
});
async function fixture() {
  const f = await lushaFixture();
  let requests = 0;
  f.db.rows("workspace_integrations").push({
    workspaceId: f.w,
    provider: "ga4",
    status: "connected",
    externalAccountId: "properties/123",
    connectedAt: new Date(connection.updatedAt),
  });
  const app = createPerformanceService(config, f.db.mongo, {
    read: async () => connection,
    report: async () => {
      requests++;
      return {
        property: connection.property,
        connectionVersion: connection.updatedAt,
        traffic: {
          window,
          totals: values,
          daily: table,
          sources: table,
          campaigns: table,
          warnings: [],
          fetchedAt: new Date().toISOString(),
          timeZone: "Europe/London",
        },
      };
    },
  });
  return { ...f, app, requests: () => requests };
}
test("baseline preserves aggregate evidence, rejects stale writes, corrects context without refetch and archives with history", async () => {
  const f = await fixture(),
    requestId = randomUUID(),
    notes = {
      label: "Before launch",
      customerCount: 4,
      customerNote:
        "Owner confirmed 17 October 2026: three represented in contacts, one via partner.",
    };
  const input = {
    action: "capture",
    expectedVersion: null,
    requestId,
    window,
    notes,
  };
  const saved = await f.app.saveBaseline(f.identity, f.w, input);
  assert.equal(saved.baseline.notes.customerCount, 4);
  assert.equal(saved.baseline.snapshot.analytics.traffic.totals.totalUsers, 8);
  assert.equal(saved.baseline.snapshot.measurement.timeline, undefined);
  assert.equal(f.requests(), 1);
  await f.app.saveBaseline(f.identity, f.w, input);
  assert.equal(f.requests(), 1);
  await assert.rejects(
    () =>
      f.app.saveBaseline(f.identity, f.w, {
        ...input,
        requestId: randomUUID(),
      }),
    /changed/,
  );
  const fixed = await f.app.saveBaseline(f.identity, f.w, {
    action: "correct",
    expectedVersion: saved.baselineVersion,
    requestId: randomUUID(),
    notes: { ...notes, label: "Corrected label" },
  });
  assert.equal(fixed.baseline.capturedAt, saved.baseline.capturedAt);
  assert.equal(f.requests(), 1);
  const archived = await f.app.saveBaseline(f.identity, f.w, {
    action: "archive",
    expectedVersion: fixed.baselineVersion,
    requestId: randomUUID(),
  });
  assert.equal(archived.baseline, null);
  assert.equal(
    f.db.rows("events").filter((e) => e.eventType === "performance_baseline")
      .length,
    3,
  );
});
test("cross-workspace reporting is denied and missing campaign mapping never guesses GA4 attribution", async () => {
  const f = await fixture();
  await assert.rejects(() =>
    f.app.state(f.identity, generatePlatformId("workspace")),
  );
  const id = generatePlatformId("campaign"),
    now = new Date();
  f.db.rows("events").push({
    id: generatePlatformId("event"),
    workspaceId: f.w,
    campaignId: id,
    eventType: "campaign_setup",
    createdAt: now,
    payload: { version: 1, status: "ready", setup: { name: "Launch" } },
  });
  const r = await f.app.report(f.identity, f.w, { window, campaignId: id });
  assert.equal(r.analytics, null);
  assert.match(r.analyticsError!, /exact GA4/);
  assert.equal(f.requests(), 1);
  await f.app.saveAttribution(f.identity, f.w, {
    campaignId: id,
    expectedVersion: null,
    filter: { field: "sessionCampaignName", value: "launch" },
  });
  const matched = await f.app.report(f.identity, f.w, {
    window,
    campaignId: id,
  });
  assert.ok(matched.analytics);
  assert.equal(f.requests(), 2);
  await assert.rejects(
    () =>
      f.app.saveAttribution(f.identity, f.w, {
        campaignId: id,
        expectedVersion: null,
        filter: null,
      }),
    /changed/,
  );
});
test("performance events cannot be written through generic event ingestion", () => {
  assert.equal(
    EventInsertSchema.safeParse({
      workspaceId: generatePlatformId("workspace"),
      eventType: "performance_baseline",
      occurredAt: new Date().toISOString(),
      payload: {},
    }).success,
    false,
  );
});

test("malformed GA4 provider reports are unavailable rather than client input errors", async () => {
  const client = googleAnalytics(
    {
      clientId: "test",
      clientSecret: "test",
      redirectUri: "https://example.com/callback",
    },
    async () =>
      Response.json({ rows: [], metadata: { timeZone: "Europe/London" } }),
  );
  await assert.rejects(
    client.report("test", "properties/123", window, "Europe/London", {
      field: "sessionCampaignId",
      value: "new-campaign",
    }),
    (e: unknown) =>
      e instanceof Error &&
      "code" in e &&
      e.code === "INVALID_REPORT" &&
      !e.message.includes("metricHeaders"),
  );
});

test("recognises a typed empty Google report without inventing metrics or accepting malformed populated reports", () => {
  const empty = {
    kind: "analyticsData#runReport",
    metadata: { timeZone: "Etc/GMT" },
  };
  for (const dimensions of [
    [],
    ["date"],
    ["sessionSourceMedium"],
    ["sessionCampaignId", "sessionCampaignName"],
  ]) {
    const result = parseReport(empty, dimensions);
    assert.deepEqual(result.rows, []);
    assert.equal(result.rowCount, 0);
    assert.match(result.warnings[0]!, /not zero/);
  }
  assert.throws(() => parseReport({}, []));
  assert.throws(() => parseReport({ ...empty, rowCount: 1 }, []));
  assert.throws(() =>
    parseReport(
      {
        ...empty,
        rows: [{ metricValues: metricNames.map(() => ({ value: "0" })) }],
      },
      [],
    ),
  );
  assert.throws(() => parseReport({ ...empty, kind: "other" }, []));
});

test("guided campaign tags automatically match the bound property and never silently switch properties", async () => {
  const f = await fixture(),
    id = generatePlatformId("campaign"),
    now = new Date();
  f.db.rows("events").push({
    id: generatePlatformId("event"),
    workspaceId: f.w,
    campaignId: id,
    eventType: "campaign_setup",
    createdAt: now,
    payload: {
      version: 1,
      status: "draft",
      setup: { name: "Guided campaign" },
    },
  });
  const j = {
    id: generatePlatformId("event"),
    workspaceId: f.w,
    campaignId: id,
    eventType: "campaign_journey",
    createdAt: now,
    payload: { version: 1, ga4Property: "properties/123" },
  };
  f.db.rows("events").push(j);
  const result = await f.app.report(f.identity, f.w, {
    window,
    campaignId: id,
  });
  assert.equal(result.mapping?.automatic, true);
  assert.deepEqual(result.mapping?.filter, {
    field: "sessionCampaignId",
    value: id,
  });
  assert.ok(result.analytics);
  j.payload.ga4Property = "properties/other";
  const changed = await f.app.report(f.identity, f.w, {
    window,
    campaignId: id,
  });
  assert.equal(changed.analytics, null);
  assert.ok(changed.analyticsError);
});
