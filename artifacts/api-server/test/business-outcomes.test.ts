import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  definition,
  mapEvidence,
  hash,
  validToken,
} from "../src/services/business-outcomes/model";
import {
  createBusinessOutcomes,
  readBusinessOutcomes,
} from "../src/services/business-outcomes/service";
import { lushaFixture, config } from "./helpers/lusha";
import { EventInsertSchema, generatePlatformId } from "../src/domain";
const sample = {
  event_id: "evt-1",
  account_id: "acct-1",
  event_type: "account_created",
  occurred_at: "2026-10-17T12:00:00Z",
  extra: "DO NOT RETAIN RAW PAYLOAD",
};
async function fixture() {
  const f = await lushaFixture(),
    app = createBusinessOutcomes(config, f.db.mongo);
  const campaignId = generatePlatformId("campaign");
  f.db.rows("events").push({
    id: generatePlatformId("event"),
    workspaceId: f.w,
    eventType: "campaign_setup",
    campaignId,
    payload: {
      version: 4,
      status: "draft",
      setup: { name: "Prospecting", brandId: f.brand },
    },
  });
  const d = {
    name: "Free signup",
    description: "One newly created free account",
    brandId: f.brand,
    campaignId,
    sourceName: "Account system",
    expectedEvent: "account_created",
    mapping: {
      eventId: "event_id",
      subjectId: "account_id",
      occurredAt: "occurred_at",
      eventType: "event_type",
      campaignId: "campaign_id",
    },
  };
  let current: Awaited<ReturnType<typeof app.state>>["definitions"][number],
    token = "";
  async function change(action: string, extra = {}) {
    const r = await app.change(f.identity, f.w, {
      action,
      id: current?.id ?? null,
      version: current?.version ?? 0,
      requestId: randomUUID(),
      ...extra,
    });
    current = r.state.definitions[0];
    if (r.token) token = r.token;
    return r;
  }
  await change("save", { definition: d });
  return {
    ...f,
    app,
    d,
    campaignId,
    change,
    current: () => current,
    token: () => token,
  };
}
test("mapping discards raw personal data, rejects unsafe paths and timestamps, and never infers campaign attribution", () => {
  const d = definition.parse({
    name: "Signup",
    description: "Account created",
    brandId: generatePlatformId("brand"),
    campaignId: generatePlatformId("campaign"),
    sourceName: "Account system",
    expectedEvent: "account_created",
    mapping: {
      eventId: "event_id",
      subjectId: "account_id",
      occurredAt: "occurred_at",
      eventType: "event_type",
      campaignId: "campaign_id",
    },
  });
  const event = mapEvidence(d, sample);
  assert.equal(event.campaignId, null);
  assert.equal(event.subjectHash, hash("acct-1"));
  assert.ok(!JSON.stringify(event).includes(sample.extra));
  assert.equal(
    mapEvidence(d, { ...sample, campaign_id: d.campaignId }).campaignId,
    d.campaignId,
  );
  assert.equal(
    mapEvidence(d, { ...sample, campaign_id: "someone-elses-campaign" })
      .campaignId,
    null,
  );
  assert.throws(() => mapEvidence(d, { ...sample, event_type: "page_view" }));
  assert.throws(() =>
    mapEvidence(d, { ...sample, occurred_at: "2030-01-01T00:00:00Z" }),
  );
  assert.throws(() =>
    definition.parse({
      ...d,
      mapping: { ...d.mapping, eventId: "__proto__.id" },
    }),
  );
  assert.ok(validToken("secret", hash("secret")));
  assert.ok(!validToken("wrong", hash("secret")));
});
test("client-owned setup requires mapped sample AND external test; retries and duplicate accounts count once; campaign stays draft", async () => {
  const f = await fixture();
  assert.equal(f.current().enabled, false);
  await assert.rejects(() => f.change("enable"));
  await f.change("rotate");
  const key = f.token();
  assert.ok(key);
  assert.ok(
    !JSON.stringify(await f.app.state(f.identity, f.w)).includes(hash(key)),
  );
  await f.change("test", { sample });
  await assert.rejects(() => f.change("enable"));
  await assert.rejects(() =>
    f.app.receive(f.w, f.current().id, key, sample, false),
  );
  await f.app.receive(f.w, f.current().id, key, sample, true);
  // Refresh returns the authoritative test result without changing the definition revision.
  await f.change("enable");
  const first = await f.app.receive(f.w, f.current().id, key, sample, false);
  assert.equal(first.duplicate, false);
  assert.equal(
    (await f.app.receive(f.w, f.current().id, key, sample, false)).duplicate,
    true,
  );
  assert.equal(
    (
      await f.app.receive(
        f.w,
        f.current().id,
        key,
        { ...sample, event_id: "retry-with-another-id" },
        false,
      )
    ).duplicate,
    true,
  );
  await f.app.receive(
    f.w,
    f.current().id,
    key,
    {
      ...sample,
      event_id: "evt-2",
      account_id: "acct-2",
      campaign_id: f.campaignId,
    },
    false,
  );
  const db = await f.db.mongo.database();
  const period = {
    since: "2026-10-17T00:00:00Z",
    until: "2026-10-18T00:00:00Z",
  };
  const total = await readBusinessOutcomes(db, f.w, period);
  assert.equal(total.confirmed, 2);
  assert.equal(total.unattributed, 1);
  assert.equal(total.attributed, 1);
  assert.equal(
    (
      await readBusinessOutcomes(db, f.w, {
        ...period,
        campaignId: f.campaignId,
      })
    ).confirmed,
    1,
  );
  const stored = f.db
    .rows("events")
    .filter((r) => r.eventType === "business_outcome_evidence");
  assert.ok(!JSON.stringify(stored).includes(sample.extra));
  const evidence = stored.find((r) => !r.payload.testOnly)!;
  await f.app.change(f.identity, f.w, {
    action: "retract",
    id: evidence.id,
    version: 0,
    requestId: randomUUID(),
    note: "Incorrect source event",
  });
  assert.equal((await readBusinessOutcomes(db, f.w, period)).confirmed, 1);
  assert.equal(
    f.db.rows("events").find((r) => r.eventType === "campaign_setup")!.payload
      .status,
    "draft",
  );
  assert.equal(
    f.db
      .rows("events")
      .filter((r) => /communication|send|nba/.test(r.eventType)).length,
    0,
  );
});
test("tenant isolation, stale edits, key rotation and archive prevent further ingestion", async () => {
  const f = await fixture();
  await f.change("rotate");
  const old = f.token();
  await assert.rejects(() =>
    f.app.state(f.identity, generatePlatformId("workspace")),
  );
  await assert.rejects(() =>
    f.app.receive(
      generatePlatformId("workspace"),
      f.current().id,
      old,
      sample,
      true,
    ),
  );
  await assert.rejects(() =>
    f.app.receive(f.w, f.current().id, "wrong", sample, true),
  );
  await assert.rejects(() =>
    f.app.change(f.identity, f.w, {
      action: "save",
      id: f.current().id,
      version: 0,
      requestId: randomUUID(),
      definition: f.d,
    }),
  );
  await assert.rejects(() =>
    f.change("save", {
      definition: { ...f.d, campaignId: generatePlatformId("campaign") },
    }),
  );
  await f.change("rotate");
  assert.notEqual(old, f.token());
  await assert.rejects(() =>
    f.app.receive(f.w, f.current().id, old, sample, true),
  );
  await f.change("archive");
  await assert.rejects(() =>
    f.app.receive(f.w, f.current().id, f.token(), sample, true),
  );
  await f.change("restore");
  await assert.rejects(() => f.change("enable"));
});
test("replayed create request is idempotent and source changes pause receiving", async () => {
  const f = await fixture(),
    requestId = randomUUID();
  const body = {
    action: "save",
    id: null,
    version: 0,
    requestId,
    definition: { ...f.d, name: "Another outcome" },
  };
  await f.app.change(f.identity, f.w, body);
  await f.app.change(f.identity, f.w, body);
  assert.equal(
    f.db.rows("events").filter((r) => r.eventType === "business_outcome_setup")
      .length,
    2,
  );
  await f.change("save", {
    definition: { ...f.d, description: "Revised criteria" },
  });
  assert.equal(f.current().enabled, false);
  assert.equal(f.current().testedAt, null);
});

test("outcome setup, audit and evidence cannot be forged through generic event ingestion", () => {
  for (const eventType of [
    "business_outcome_setup",
    "business_outcome_evidence",
    "business_outcome_change",
  ])
    assert.equal(
      EventInsertSchema.safeParse({
        workspaceId: generatePlatformId("workspace"),
        eventType,
        occurredAt: new Date(),
        payload: {},
      }).success,
      false,
    );
});

test("a transaction callback retry creates one definition with a stable identity", async () => {
  const f = await lushaFixture();
  const original = f.db.mongo.withTransaction!;
  let retried = false;
  f.db.mongo.withTransaction = async (work) => {
    if (!retried) {
      retried = true;
      const before = structuredClone(f.db.records);
      await original(work);
      f.db.records = before;
    }
    return original(work);
  };
  const app = createBusinessOutcomes(config, f.db.mongo);
  const result = await app.change(f.identity, f.w, {
    action: "save",
    id: null,
    version: 0,
    requestId: randomUUID(),
    definition: {
      name: "Signup",
      description: "Confirmed free account",
      brandId: f.brand,
      campaignId: null,
      sourceName: "Account system",
      expectedEvent: "free_account_created",
      mapping: {
        eventId: "event_id",
        subjectId: "account_id",
        occurredAt: "occurred_at",
        eventType: "event_type",
      },
    },
  });
  assert.equal(result.state.definitions.length, 1);
  const audit = f.db
    .rows("events")
    .find((r) => r.eventType === "business_outcome_change")!;
  assert.equal(audit.payload.outcomeId, result.state.definitions[0]!.id);
});
