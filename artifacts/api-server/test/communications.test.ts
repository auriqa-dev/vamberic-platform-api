import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mailboxFixture } from "./helpers/communications-mailbox";
import { config } from "./helpers/lusha";
import { createCommunications } from "../src/services/communications/service";
import { createEmailContent } from "../src/services/email-content/service";
import {
  assetData,
  type ContentRecord,
} from "../src/services/content-strategy/model";
import { generatePlatformId } from "../src/domain";
import {
  interpretReply,
  canTransition,
} from "../src/services/communications/model";
function asset(brand: string): ContentRecord {
  return {
    id: "asset",
    version: 1,
    kind: "asset",
    status: "approved",
    updatedAt: new Date().toISOString(),
    fingerprint: "asset",
    sourceVersions: [],
    data: assetData.parse({
      title: "Compare approaches",
      classification: "core",
      assetType: "page",
      channel: "website",
      url: "https://example.com/compare",
      text: "Evidence-based comparison",
      description: "Compare options",
      sourceDocumentId: "",
      sourceAssetIds: [],
      scope: { brandId: brand, products: [], offers: [], audiences: [] },
      topics: [],
      buyerStages: [],
      claims: [],
      evidence: [],
      gaps: [],
      reuse: [],
      restrictions: [],
      usageRights: "owned",
      allowedUses: ["email"],
      visibility: "published",
      analysisStatus: "reviewed",
      sourceMetadata: {
        canonicalUrl: "https://example.com/compare",
        checkedAt: new Date().toISOString(),
        headings: [],
        producer: "",
        briefId: "",
        briefVersion: 0,
        capabilityId: "",
        integrationId: "",
      },
    }),
  };
}
function brief(brand: string): ContentRecord {
  return {
    id: "brief",
    version: 1,
    kind: "brief",
    status: "approved",
    updatedAt: new Date().toISOString(),
    fingerprint: "brief",
    sourceVersions: [],
    data: {
      title: "Introduction",
      channel: "email",
      cta: "Read comparison",
      sourceAssetIds: ["asset"],
      scope: { brandId: brand, products: [], offers: [], audiences: [] },
    },
  };
}

async function fixture() {
  const f = await mailboxFixture();
  await f.connect();
  const person = generatePlatformId("person");
  f.db.rows("people").push({
    id: person,
    workspaceId: f.w,
    firstName: "Taylor",
    lastName: "Example",
    updatedAt: new Date(),
    archived: false,
  });
  for (const r of [brief(f.brand), asset(f.brand)])
    f.db.rows("events").push({
      id: randomUUID(),
      workspaceId: f.w,
      eventType: "content_strategy_record",
      payload: { record: r },
    });
  const email = createEmailContent(config, f.db.mongo, async () => ({
    result: {
      subject: "Useful comparison",
      body: "Hello Taylor, here is a comparison.",
      ctaAssetId: "asset",
      ctaText: "Read comparison",
      ctaRationale: "Matches brief",
      reviewIssues: [],
    },
    usage: { model: "test", inputTokens: 1, outputTokens: 1 },
  }));
  const draft = await email.generate(f.identity, f.w, {
    requestKey: randomUUID(),
    briefId: "brief",
    briefVersion: 1,
    contactId: person,
    instruction: "Introduce the offer",
  });
  const approved = await email.mutate(f.identity, f.w, draft.id, {
    requestKey: randomUUID(),
    expectedVersion: draft.version,
    operation: "approve",
  });
  const comm = createCommunications(config, f.db.mongo, f.app);
  const input = {
    requestKey: randomUUID(),
    draftId: approved.id,
    draftVersion: approved.version,
    testOnly: true,
    testRecipient: "owner@example.com",
  };
  return { ...f, person, email, approved, comm, input };
}
test("content approval is not send authority; replay, send and reply isolation", async () => {
  const f = await fixture();
  let r = await f.comm.create(f.identity, f.w, f.input);
  assert.equal(r.status, "awaiting_review");
  await f.comm.tick();
  assert.equal(f.sent(), 0);
  assert.equal((await f.comm.create(f.identity, f.w, f.input)).id, r.id);
  await assert.rejects(
    f.comm.create({ ...f.identity, subject: "other" }, f.w, f.input),
  );
  r = await f.comm.mutate(f.identity, f.w, r.id, {
    expectedVersion: r.version,
    operation: "approve",
    reason: "Controlled inbox test",
  });
  await f.comm.tick();
  await f.comm.tick();
  assert.equal(f.sent(), 1);
  let state = await f.comm.list(f.identity, f.w);
  assert.equal(state.records[0].status, "accepted");
  f.reply();
  await f.comm.sync(f.identity, f.w);
  await f.comm.sync(f.identity, f.w);
  state = await f.comm.list(f.identity, f.w);
  assert.equal(state.replies.length, 1);
  assert.equal(
    f.db
      .rows("events")
      .filter((e) => ["email", "nba_communication_event"].includes(e.eventType))
      .length,
    0,
  );
  assert.ok(!JSON.stringify(state).includes("accessToken"));
});
test("changed content blocks queued sends; unknown sends reconcile without resubmission", async () => {
  const f = await fixture();
  const r = await f.comm.create(f.identity, f.w, f.input);
  await f.comm.mutate(f.identity, f.w, r.id, {
    expectedVersion: r.version,
    operation: "approve",
    reason: "Controlled inbox test",
  });
  await f.email.mutate(f.identity, f.w, f.approved.id, {
    requestKey: randomUUID(),
    expectedVersion: f.approved.version,
    operation: "save",
    content: { ...f.approved.content, subject: "Changed" },
  });
  await f.comm.tick();
  assert.equal(f.sent(), 0);
  assert.equal(
    (await f.comm.list(f.identity, f.w)).records[0].status,
    "blocked",
  );
  const g = await fixture();
  const a = await g.comm.create(g.identity, g.w, g.input);
  await g.comm.mutate(g.identity, g.w, a.id, {
    expectedVersion: a.version,
    operation: "approve",
    reason: "Controlled inbox test",
  });
  g.ambiguity();
  await g.comm.tick();
  assert.equal(
    (await g.comm.list(g.identity, g.w)).records[0].status,
    "unknown",
  );
  await g.comm.tick();
  assert.equal(g.sent(), 1);
  assert.equal(
    (await g.comm.list(g.identity, g.w)).records[0].status,
    "accepted",
  );
});
test("reply triage preserves evidence without treating it as instructions", () => {
  assert.equal(
    interpretReply("Please stop emailing me.").category,
    "unsubscribe",
  );
  assert.equal(
    interpretReply("They no longer work here.").category,
    "left_organisation",
  );
  assert.equal(
    interpretReply("Thanks.\nOn Monday wrote:\nPlease unsubscribe").category,
    "unclear",
  );
  assert.equal(canTransition("accepted", "approve"), false);
  assert.equal(canTransition("unknown", "approve"), false);
});
test("normal delivery records interaction; reply pauses follow-up and reaches NBA", async () => {
  const f = await fixture(),
    point = generatePlatformId("contact");
  const { createContactStrategies } =
    await import("../src/services/contact-strategy/application");
  const strategies = createContactStrategies(config, f.db.mongo);
  const key = `custom_${randomUUID().replaceAll("-", "")}`;
  await strategies.mutate(f.identity, f.w, {
    key,
    name: "Synthetic scope",
    operation: "save",
    expectedVersion: 0,
    statement: "Only apply this restriction to commercial customers.",
  });
  await strategies.mutate(f.identity, f.w, {
    key,
    operation: "approve",
    expectedVersion: 1,
  });
  assert.equal(
    (await f.comm.list(f.identity, f.w)).policies.filter((p) => p.key === key)
      .length,
    1,
  );

  f.db.rows("contact_points").push({
    id: point,
    workspaceId: f.w,
    personId: f.person,
    type: "email",
    value: "owner@example.com",
    normalizedValue: "owner@example.com",
    archived: false,
  });
  let r = await f.comm.create(f.identity, f.w, {
    ...f.input,
    testOnly: false,
    testRecipient: undefined,
    contactPointId: point,
    purpose: "marketing",
  });
  const approve = async (row: { id: string; version: number }) =>
    f.comm.mutate(f.identity, f.w, row.id, {
      expectedVersion: row.version,
      operation: "approve",
      reason: "Permission reviewed for synthetic test",
      legalConfirmed: true,
      platformConfirmed: true,
      assessments: (await f.comm.list(f.identity, f.w)).policies.map((p) => ({
        policyId: p.id,
        version: p.version,
        effect: "not_applicable",
        reason: "Synthetic fixture has no commercial activity",
      })),
    });
  await assert.rejects(() =>
    f.comm.mutate(f.identity, f.w, r.id, {
      expectedVersion: r.version,
      operation: "approve",
      reason: "Missing custom assessment",
      legalConfirmed: true,
      platformConfirmed: true,
      assessments: [],
    }),
  );
  r = await approve(r);
  await f.comm.tick();
  assert.equal(
    (await f.comm.list(f.identity, f.w)).records[0].status,
    "accepted",
  );
  assert.equal(
    f.db.rows("events").filter((e) => e.eventType === "email").length,
    1,
  );
  const decisionId = generatePlatformId("event"),
    campaignId = generatePlatformId("campaign");
  f.db.rows("events").push({
    id: generatePlatformId("event"),
    workspaceId: f.w,
    campaignId,
    eventType: "nba_decision",
    payload: {
      decisionId,
      version: 1,
      state: "scheduled",
      subject: { type: "person", id: f.person },
      claimKeys: [`person:${f.person}`],
    },
  });
  f.db.rows("events").push({
    id: generatePlatformId("event"),
    workspaceId: f.w,
    campaignId,
    eventType: "nba_claim",
    payload: {
      key: `person:${f.person}`,
      version: 1,
      state: "held",
      decisionId,
    },
  });
  f.reply();
  await f.comm.sync(f.identity, f.w);
  const state = await f.comm.list(f.identity, f.w);
  assert.equal(state.replies.length, 1);
  assert.equal(
    f.db
      .rows("events")
      .filter((e) => e.eventType === "nba_decision")
      .at(-1)?.payload.state,
    "review_required",
  );
  assert.equal(
    f.db
      .rows("events")
      .filter((e) => e.eventType === "nba_claim")
      .at(-1)?.payload.state,
    "released",
  );
  assert.equal(
    f.db.rows("events").filter((e) => e.eventType === "email").length,
    2,
  );
  assert.equal(
    f.db.rows("events").filter((e) => e.eventType === "nba_communication_event")
      .length,
    1,
  );
  const reply = state.replies[0];
  await f.comm.review(f.identity, f.w, reply.id, {
    expectedVersion: reply.version,
    category: "question",
    reason: "Review complete",
  });
  assert.equal((await f.comm.list(f.identity, f.w)).replies[0].reviewed, true);
  const measured = (await f.comm.list(f.identity, f.w)).measurement;
  assert.equal(measured.metrics.find((m) => m.kind === "accepted")?.value, 1);
  assert.equal(measured.metrics.find((m) => m.kind === "replied")?.value, 1);
  const count = f.db
    .rows("events")
    .filter((e) => e.eventType === "measurement_outcome").length;
  await f.comm.sync(f.identity, f.w);
  assert.equal(
    f.db.rows("events").filter((e) => e.eventType === "measurement_outcome")
      .length,
    count,
  );
  await assert.rejects(
    f.comm.measurement({ ...f.identity, subject: "unrelated" }, f.w, {}),
  );
  assert.equal(measured.feedback[0].state, "review_required");
});
test("disconnect after approval blocks execution", async () => {
  const f = await fixture();
  const r = await f.comm.create(f.identity, f.w, f.input);
  await f.comm.mutate(f.identity, f.w, r.id, {
    expectedVersion: r.version,
    operation: "approve",
    reason: "Test",
  });
  const status = await f.app.read(f.identity, f.w);
  await f.app.disconnect(f.identity, f.w, {
    expectedUpdatedAt: status.updatedAt,
  });
  await f.comm.tick();
  assert.equal(f.sent(), 0);
  assert.equal(
    (await f.comm.list(f.identity, f.w)).records[0].status,
    "blocked",
  );
});
test("unreviewed unsubscribe blocks NBA contact and has scoped corrective review", async () => {
  const f = await fixture(),
    point = generatePlatformId("contact");
  f.db.rows("contact_points").push({
    id: point,
    workspaceId: f.w,
    personId: f.person,
    type: "email",
    value: "owner@example.com",
    normalizedValue: "owner@example.com",
    archived: false,
  });
  const r = await f.comm.create(f.identity, f.w, {
    ...f.input,
    testOnly: false,
    testRecipient: undefined,
    contactPointId: point,
  });
  await f.comm.mutate(f.identity, f.w, r.id, {
    expectedVersion: r.version,
    operation: "approve",
    reason: "Synthetic permission review",
    legalConfirmed: true,
    platformConfirmed: true,
    assessments: (await f.comm.list(f.identity, f.w)).policies.map((p) => ({
      policyId: p.id,
      version: p.version,
      effect: "not_applicable",
      reason: "Fixture",
    })),
  });
  await f.comm.tick();
  const saved = f.db.rows("events").find((e) => e.id === r.id)!;
  f.provider.thread = async () => [
    {
      providerId: "unsubscribe",
      conversationId: "thread",
      internetMessageId: "<reply@example.com>",
      inReplyTo: saved.payload.messageId,
      references: [saved.payload.messageId],
      from: "owner@example.com",
      to: ["owner@example.com"],
      subject: "Re: Useful comparison",
      text: "Please stop emailing me.",
      occurredAt: new Date().toISOString(),
    },
  ];
  await f.comm.sync(f.identity, f.w);
  await f.comm.sync(f.identity, f.w);
  const reply = (await f.comm.list(f.identity, f.w)).replies[0];
  assert.equal(reply.interpretation.category, "unsubscribe");
  assert.equal(
    f.db
      .rows("events")
      .filter((e) => e.eventType === "communication_suppression").length,
    1,
  );
  await f.comm.review(f.identity, f.w, reply.id, {
    expectedVersion: reply.version,
    category: "question",
    reason: "Synthetic correction of interpretation",
    clearRestriction: true,
  });
  assert.equal(
    f.db
      .rows("events")
      .find((e) => e.eventType === "communication_suppression")!.payload.active,
    false,
  );
  assert.equal(f.db.rows("people").length > 0, true);
});

test("reviewed conversation reply keeps the provider thread and RFC reference", async () => {
  const f = await fixture();
  const r = await f.comm.create(f.identity, f.w, f.input);
  await f.comm.mutate(f.identity, f.w, r.id, {
    expectedVersion: r.version,
    operation: "approve",
    reason: "Controlled inbox test",
  });
  await f.comm.tick();
  const first = f.db.rows("events").find((e) => e.id === r.id)!;
  f.provider.thread = async () => [
    {
      providerId: "reply",
      conversationId: "thread",
      internetMessageId: "<reply@example.com>",
      inReplyTo: first.payload.messageId,
      references: [first.payload.messageId],
      from: "owner@example.com",
      to: ["owner@example.com"],
      subject: "Re: [HVM TEST] Useful comparison",
      text: "Can you explain?",
      occurredAt: new Date().toISOString(),
    },
  ];
  await f.comm.sync(f.identity, f.w);
  const reply = (await f.comm.list(f.identity, f.w)).replies[0];
  await f.comm.review(f.identity, f.w, reply.id, {
    expectedVersion: reply.version,
    category: "question",
    reason: "Controlled reply reviewed",
  });
  const d = await f.email.generate(f.identity, f.w, {
    requestKey: randomUUID(),
    briefId: "brief",
    briefVersion: 1,
    contactId: f.person,
    instruction: "Answer the question",
  });
  const approved = await f.email.mutate(f.identity, f.w, d.id, {
    requestKey: randomUUID(),
    expectedVersion: d.version,
    operation: "approve",
  });
  const follow = await f.comm.create(f.identity, f.w, {
    ...f.input,
    requestKey: randomUUID(),
    draftId: approved.id,
    draftVersion: approved.version,
    replyToId: reply.id,
  });
  let observed = false;
  f.provider.send = async (_access, mime, thread) => {
    assert.equal(thread, "thread");
    assert.match(mime, /In-Reply-To: <reply@example.com>/);
    observed = true;
    return { id: "second", threadId: "thread" };
  };
  await f.comm.mutate(f.identity, f.w, follow.id, {
    expectedVersion: follow.version,
    operation: "approve",
    reason: "Controlled response",
  });
  await f.comm.tick();
  assert.equal(observed, true);
  // Gmail may replace the supplied RFC Message-ID. Polling the original
  // conversation must still recognise our second send by provider identity.
  const originalThread = f.provider.thread;
  f.provider.thread = async (...args) => [
    ...(await originalThread(...args)),
    {
      providerId: "second",
      conversationId: "thread",
      internetMessageId: "<google-rewritten@example.com>",
      inReplyTo: "<reply@example.com>",
      references: ["<reply@example.com>"],
      from: "owner@example.com",
      to: ["owner@example.com"],
      subject: "[HVM TEST] Useful comparison",
      text: "Our own acknowledgement",
      occurredAt: new Date().toISOString(),
    },
  ];
  await f.comm.sync(f.identity, f.w);
  await f.comm.sync(f.identity, f.w);
  assert.equal(
    f.db.rows("events").filter((e) => e.eventType === "communication_reply")
      .length,
    1,
  );
  assert.equal((await f.comm.list(f.identity, f.w)).replies.length, 1);
  const savedReply = f.db
    .rows("events")
    .find((e) => e.eventType === "communication_reply")!;
  f.db.rows("events").push({
    ...savedReply,
    id: "legacy-outbound-misclassification",
    payload: { ...savedReply.payload, providerId: "second" },
  });
  assert.equal((await f.comm.list(f.identity, f.w)).replies.length, 1);
});

test("template lifecycle is versioned and changed presentation blocks queued delivery", async () => {
  const f = await fixture();
  const { createEmailTemplates } =
    await import("../src/services/email-templates/service");
  const { personal } = await import("../src/services/email-templates/render");
  const t = createEmailTemplates(config, f.db.mongo);
  let row = await t.mutate(f.identity, f.w, {
    requestKey: randomUUID(),
    brandId: f.brand,
    operation: "save",
    settings: { ...personal, name: "Test personal" },
  });
  assert.equal(row.status, "draft");
  await assert.rejects(
    t.preview({ ...f.identity, subject: "other" }, f.w, {
      draftId: f.approved.id,
      draftVersion: f.approved.version,
    }),
  );
  await assert.rejects(
    f.comm.create(f.identity, f.w, { ...f.input, templateId: row.id }),
  );
  row = await t.mutate(f.identity, f.w, {
    requestKey: randomUUID(),
    brandId: f.brand,
    id: row.id,
    expectedVersion: row.version,
    operation: "approve",
  });
  const r = await f.comm.create(f.identity, f.w, {
    ...f.input,
    templateId: row.id,
  });
  await f.comm.mutate(f.identity, f.w, r.id, {
    expectedVersion: r.version,
    operation: "approve",
    reason: "Controlled test",
  });
  await t.mutate(f.identity, f.w, {
    requestKey: randomUUID(),
    brandId: f.brand,
    id: row.id,
    expectedVersion: row.version,
    operation: "save",
    settings: { ...personal, name: "Revised" },
  });
  await f.comm.tick();
  assert.equal(f.sent(), 0);
  assert.equal(
    (await f.comm.list(f.identity, f.w)).records[0].status,
    "blocked",
  );
  await assert.rejects(
    t.mutate(f.identity, f.w, {
      requestKey: randomUUID(),
      brandId: f.brand,
      id: row.id,
      expectedVersion: row.version + 1,
      operation: "delete",
    }),
  );
});

test("rendered communication snapshots accept bounded logos without relaxing other event metadata", async () => {
  const { communicationEvent } =
    await import("../src/services/communications/events");
  const f = await fixture();
  const now = new Date();
  const input = {
    id: generatePlatformId("event"),
    workspaceId: f.w,
    eventType: "communication",
    createdAt: now,
    updatedAt: now,
    occurredAt: now,
    payload: {
      draft: f.approved,
      rendered: {
        subject: "Logo test",
        text: "Hello",
        html: "<p>Hello</p>",
        inlineImages: [{ cid: "brand-logo", base64: "AAAA".repeat(10000) }],
      },
    },
  };
  assert.equal(
    communicationEvent(input).payload.rendered.inlineImages[0].base64.length,
    40000,
  );
  assert.doesNotThrow(() =>
    communicationEvent({ ...input, eventType: "communication_history" }),
  );
  assert.throws(() => communicationEvent({ ...input, eventType: "email" }));
  assert.throws(() => communicationEvent({ ...input, workspaceId: "invalid" }));
  assert.throws(() =>
    communicationEvent({
      ...input,
      payload: {
        ...input.payload,
        rendered: {
          ...input.payload.rendered,
          inlineImages: [{ cid: "brand-logo", base64: "A".repeat(350001) }],
        },
      },
    }),
  );
});

test("elapsed response window requires successful inbox sync and emits once", async () => {
  const { measurementReconciler } =
    await import("../src/services/measurement/reconcile");
  const f = await fixture();
  let r = await f.comm.create(f.identity, f.w, f.input);
  r = await f.comm.mutate(f.identity, f.w, r.id, {
    expectedVersion: r.version,
    operation: "approve",
    reason: "Synthetic test",
  });
  await f.comm.tick();
  const row = f.db
    .rows("events")
    .find((e) => e.eventType === "communication" && e.id === r.id)!;
  // Synthetic fixture only: exercise the non-test projection without a real send.
  row.payload.testOnly = false;
  row.payload.responseDueAt = new Date(Date.now() - 60000).toISOString();
  row.payload.checkedAt = new Date().toISOString();
  delete row.payload.syncedAt;
  const worker = measurementReconciler(f.db.mongo);
  const outcomes = () =>
    f.db
      .rows("events")
      .filter(
        (e) =>
          e.eventType === "measurement_outcome" &&
          e.payload.kind === "no_response",
      );
  await worker.tick();
  assert.equal(outcomes().length, 0);
  row.payload.syncedAt = new Date().toISOString();
  await worker.tick();
  await worker.tick();
  assert.equal(outcomes().length, 1);
  assert.equal(
    f.db.rows("events").find((e) => e.eventType === "nba_measurement_feedback")
      ?.payload.state,
    "review_required",
  );
  assert.equal(f.sent(), 1);
});

test("tracked delivery freezes its original Library CTA and renders the personalised link before approval", async () => {
  const { trackingRow } =
    await import("../src/services/website-tracking/service");
  const f = await fixture();
  f.db.rows("events").push(
    trackingRow(f.w, "website_tracking_site", {
      origin: "https://example.com",
      brandId: f.brand,
      enabled: true,
      testOnly: true,
      retentionDays: 30,
      policyConfirmed: true,
      events: [],
      paths: [],
      version: 1,
      verifiedAt: new Date().toISOString(),
      revoked: false,
    }),
  );
  const prior = process.env.HVM_TRACKING_PUBLIC_ORIGIN;
  process.env.HVM_TRACKING_PUBLIC_ORIGIN = "https://api.example.com";
  try {
    let r = await f.comm.create(f.identity, f.w, f.input);
    assert.equal(r.draft.ctaUrl, "https://example.com/compare");
    assert.match(
      r.rendered.text,
      /api.example.com\/api\/v1\/public\/tracking\/r\//,
    );
    assert.match(
      r.rendered.html,
      /api.example.com\/api\/v1\/public\/tracking\/r\//,
    );
    assert.equal((await f.comm.create(f.identity, f.w, f.input)).id, r.id);
    assert.equal(
      f.db.rows("events").filter((r) => r.eventType === "website_tracking_link")
        .length,
      1,
    );
    await f.comm.tick();
    assert.equal(f.sent(), 0);
    r = await f.comm.mutate(f.identity, f.w, r.id, {
      expectedVersion: r.version,
      operation: "approve",
      reason: "Controlled mocked delivery",
    });
    await f.comm.tick();
    assert.equal(f.sent(), 1);
  } finally {
    if (prior === undefined) delete process.env.HVM_TRACKING_PUBLIC_ORIGIN;
    else process.env.HVM_TRACKING_PUBLIC_ORIGIN = prior;
  }
});

test("campaign test delivery uses isolated GA4 tags even without a website tracker", async () => {
  const f = await fixture(),
    campaignId = generatePlatformId("campaign");
  for (const row of f.db
    .rows("events")
    .filter(
      (e) =>
        e.eventType === "email_content_record" &&
        e.payload.record.id === f.approved.id,
    ))
    row.payload.record.campaignId = campaignId;
  const prepared = await f.comm.create(f.identity, f.w, f.input);
  assert.ok(prepared.rendered.text.includes(`utm_id=test_${campaignId}`));
  assert.ok(prepared.rendered.html.includes(`utm_id=test_${campaignId}`));
  assert.equal(prepared.status, "awaiting_review");
  assert.equal(f.sent(), 0);
});
