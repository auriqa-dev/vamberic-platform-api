import assert from "node:assert/strict";
import { test } from "node:test";
import {
  outcome,
  summarise,
  guidance,
  websiteSignal,
} from "../src/services/measurement/model";
const base = outcome.parse({
  schemaVersion: 1,
  eventKey: "send:accepted",
  kind: "accepted",
  communicationId: "send",
  contactId: "person",
  brandId: "brand",
  draftId: "draft",
  draftVersion: 1,
  sourceId: "send",
  sourceVersion: 1,
  occurredAt: "2026-10-17T10:00:00Z",
  provider: "google_workspace",
  fact: "observed",
  testOnly: false,
});
test("metrics distinguish acceptance, reviewed human engagement and unavailable tracking", () => {
  const result = summarise([
    base,
    { ...base, eventKey: "test", contactId: "test", testOnly: true },
    {
      ...base,
      eventKey: "reply",
      kind: "reply_received",
      replyId: "reply",
      category: "interested",
      associated: true,
      reviewed: false,
    },
  ]);
  assert.equal(result.find((m) => m.kind === "accepted")?.value, 1);
  assert.equal(result.find((m) => m.kind === "replied")?.value, 0);
  assert.equal(result.find((m) => m.kind === "review")?.value, 1);
  for (const kind of ["opened", "delivered"])
    assert.equal(result.find((m) => m.kind === kind)?.value, null);
});
test("replayed and corrected replies count only their latest reviewed interpretation", () => {
  const reply = {
    ...base,
    eventKey: "reply:1",
    kind: "reply_interpreted" as const,
    replyId: "reply",
    sourceVersion: 2,
    category: "interested",
    associated: true,
    reviewed: true,
  };
  const corrected = {
    ...reply,
    eventKey: "reply:2",
    sourceVersion: 3,
    category: "out_of_office",
  };
  const result = summarise([base, reply, reply, corrected]);
  assert.equal(result.find((m) => m.kind === "replied")?.value, 0);
  assert.equal(result.find((m) => m.kind === "interested")?.value, 0);
  assert.match(guidance(corrected), /confirm a return date/);
});
test("referrals and meeting requests are not booking or send authority", () => {
  assert.match(
    guidance({
      ...base,
      kind: "reply_interpreted",
      category: "referral",
      reviewed: true,
      associated: true,
    }),
    /not permission/,
  );
  assert.match(
    guidance({
      ...base,
      kind: "reply_interpreted",
      category: "meeting_request",
      reviewed: true,
      associated: true,
    }),
    /not been booked/,
  );
  assert.match(guidance({ ...base, kind: "no_response" }), /Recheck history/);
});
test("future website contract has no direct identity or authority fields", () => {
  const signal = {
    schemaVersion: 1,
    eventId: "4106d09e-2af3-4b21-bcab-92783e057329",
    kind: "cta_clicked",
    occurredAt: base.occurredAt,
    correlationToken: "a".repeat(40),
    pageUrl: "https://example.com/compare",
    identity: "anonymous",
    automation: "unknown",
    evidenceReference: "ref",
  };
  assert.ok(websiteSignal.safeParse(signal).success);
  assert.equal(
    websiteSignal.safeParse({
      ...signal,
      email: "a@example.com",
      workspaceId: "someone",
    }).success,
    false,
  );
});

test("one rejected historical record does not starve the remaining measurement batch", async () => {
  const { measurementReconciler } =
    await import("../src/services/measurement/reconcile");
  const rows = [{ id: "invalid" }, { id: "valid" }];
  const cursor = {
    sort: () => cursor,
    limit: () => cursor,
    toArray: async () => rows,
  };
  const db = {
    collection: () => ({ find: () => cursor, updateMany: async () => ({}) }),
  };
  let attempts = 0,
    errors = 0;
  const mongo = {
    database: async () => db,
    withTransaction: async () => {
      attempts++;
      if (attempts === 1) throw new Error("Invalid historical record");
    },
  };
  await measurementReconciler(mongo as never, () => {
    errors++;
  }).tick();
  assert.equal(attempts, 2);
  assert.equal(errors, 1);
});

test("Mongo null optional values remain readable without weakening required fields", () => {
  const stored = {
    ...base,
    organisationId: null,
    campaignId: null,
    offerId: null,
    offerIds: null,
    nbaDecisionId: null,
    providerId: null,
    conversationId: null,
    category: null,
    reviewed: null,
    associated: null,
    replyId: null,
    responseDueAt: null,
    returnAt: null,
    cta: { assetId: null, url: null },
  };
  const parsed = outcome.parse(stored);
  assert.equal(
    summarise([parsed]).find((m) => m.kind === "accepted")?.value,
    1,
  );
  assert.equal(
    outcome.safeParse({ ...stored, contactId: null }).success,
    false,
  );
  assert.equal(
    outcome.safeParse({ ...stored, unexpected: null }).success,
    false,
  );
});

test("every measurement metric has a readable label, including website enquiries", () => {
  for (const metric of summarise([])) assert.ok(typeof metric.label === "string" && metric.label.length > 0, metric.kind);
  assert.equal(summarise([]).find(m=>m.kind==="interaction_enquiry")?.label,"Website enquiries");
});
