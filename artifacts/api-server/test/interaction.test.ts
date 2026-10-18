import { test } from "node:test";
import assert from "node:assert/strict";
import { BrandKitRecordSchema } from "../src/domain/brands";
import {
  interactionSettings,
  interactionReply,
  safeReply,
  INTERACTION_INSTRUCTIONS,
} from "../src/services/interaction/model";
import { publicChatAssets } from "../src/services/interaction/knowledge";
import { releaseDatabaseTarget } from "../src/db/setup";
import { interactionWidget } from "../src/services/interaction/widget";
import { Script } from "node:vm";

test("chat identity is optional, separate from email and closed to unknown configuration", () => {
  const schema = BrandKitRecordSchema.shape.chatPersonality;
  assert.equal(schema.parse(undefined), undefined);
  assert.deepEqual(
    schema.parse({ displayName: "Guide", greeting: "How can I help?" }),
    { displayName: "Guide", greeting: "How can I help?" },
  );
  assert.equal(
    schema.safeParse({ fromDisplayName: "Email name" }).success,
    false,
  );
  assert.equal(
    schema.safeParse({ openingQuestions: Array(7).fill("Question") }).success,
    false,
  );
});
test("public answer refuses invented source IDs and destinations", () => {
  const answer = interactionReply.parse({
    answer: "Here is the available information.",
    sourceIds: ["a"],
    nextStep: "content",
    ctaAssetId: "a",
    qualificationEvidence: [],
    uncertainties: [],
  });
  assert.equal(
    safeReply(answer, [{ id: "a", url: "https://example.org/info" }], "")
      .ctaUrl,
    "https://example.org/info",
  );
  assert.throws(() => safeReply(answer, [], ""));
  assert.throws(() =>
    safeReply(
      { ...answer, answer: "Visit https://evil.example" },
      [{ id: "a", url: "https://example.org" }],
      "",
    ),
  );
});
test("installation refuses credential-bearing or insecure destinations", () => {
  const x = {
    siteId: "site",
    brandId: "brand",
    publicAssetIds: [],
    privacyUrl: "https://example.org/privacy",
    bookingUrl: "",
    handoffEmail: "",
    retentionDays: 30,
  };
  assert.equal(interactionSettings.safeParse(x).success, true);
  for (const url of ["http://example.org", "https://user:pass@example.org"]) {
    assert.equal(
      interactionSettings.safeParse({ ...x, privacyUrl: url }).success,
      false,
    );
  }
});
test("private, foreign and unapproved content cannot enter chat", () => {
  const r = {
    id: "a",
    kind: "asset",
    status: "approved",
    version: 1,
    data: {
      scope: { brandId: "b" },
      visibility: "private",
      allowedUses: ["website chat"],
      usageRights: "owned",
      restrictions: [],
      archived: false,
    },
  };
  assert.deepEqual(publicChatAssets([r], "b", ["a"]), []);
  assert.deepEqual(
    publicChatAssets(
      [{ ...r, status: "draft", data: { ...r.data, visibility: "published" } }],
      "b",
      ["a"],
    ),
    [],
  );
  assert.deepEqual(
    publicChatAssets(
      [{ ...r, data: { ...r.data, visibility: "published" } }],
      "other",
      ["a"],
    ),
    [],
  );
  assert.deepEqual(
    publicChatAssets(
      [
        {
          ...r,
          data: { ...r.data, visibility: "published", allowedUses: ["email"] },
        },
      ],
      "b",
      ["a"],
    ),
    [],
  );
});
test("additive Brand Kit migration preserves all predecessor collections", () => {
  const before = releaseDatabaseTarget(29),
    after = releaseDatabaseTarget(30);
  assert.equal(after.version, 30);
  for (const [name, schema] of Object.entries(before.validators)) {
    if (name !== "brand_kits") assert.deepEqual(after.validators[name], schema);
  }
  assert.ok(
    JSON.stringify(after.validators.brand_kits).includes("chatPersonality"),
  );
  assert.ok(
    !JSON.stringify(before.validators.brand_kits).includes("chatPersonality"),
  );
});
test("widget compiles without persistent tracking and client boundary is explicit", () => {
  new Script(interactionWidget);
  assert.doesNotMatch(
    interactionWidget,
    /localStorage|document.cookie|sessionStorage|innerHTML/,
  );
  assert.match(INTERACTION_INSTRUCTIONS, /entirely separate from Henry/);
  assert.match(INTERACTION_INSTRUCTIONS, /subject boundary is this client/);
});

import { config, lushaFixture } from "./helpers/lusha";
import { BrandKitSchema, generatePlatformId } from "../src/domain";
import { trackingRow } from "../src/services/website-tracking/service";
import { createInteraction } from "../src/services/interaction/service";
import { randomUUID } from "node:crypto";
async function liveShape() {
  const f = await lushaFixture(),
    now = new Date(),
    actor = {
      type: "human",
      id: f.identity.subject,
      issuer: f.identity.issuer,
    };
  f.db.rows("schema_versions")[0].version = 30;
  f.db.rows("brand_kits").push(
    BrandKitSchema.parse({
      id: generatePlatformId("brandkit"),
      workspaceId: f.w,
      brandId: f.brand,
      status: "approved",
      createdAt: now,
      updatedAt: now,
      approvedAt: now,
      approvedBy: actor,
      chatPersonality: {
        displayName: "Guide",
        greeting: "Welcome",
        uncertaintyWording: "Please leave an enquiry.",
      },
    }),
  );
  f.db.rows("agent_definitions").push({
    key: "website_interaction",
    version: 1,
    status: "active",
    archived: false,
  });
  const site = trackingRow(f.w, "website_tracking_site", {
    brandId: f.brand,
    origin: "https://example.org",
    verifiedAt: now.toISOString(),
    revoked: false,
  });
  f.db.rows("events").push(site);
  const installation = trackingRow(f.w, "interaction_installation", {
    siteId: site.id,
    brandId: f.brand,
    enabled: true,
    testOnly: true,
    publicAssetIds: [],
    privacyUrl: "https://example.org/privacy",
    bookingUrl: "",
    handoffEmail: "",
    retentionDays: 30,
    version: 1,
    publisher: f.identity,
  });
  f.db.rows("events").push(installation);
  return {
    ...f,
    installation,
    site,
    app: createInteraction(config, f.db.mongo),
  };
}
test("registered origin and secret are required; other sessions cannot be read", async () => {
  const f = await liveShape();
  await assert.rejects(f.app.start(f.installation.id, "https://other.org"));
  const a = await f.app.start(f.installation.id, "https://example.org"),
    b = await f.app.start(f.installation.id, "https://example.org");
  await assert.rejects(
    f.app.send(f.installation.id, "https://example.org", a.sessionId, b.token, {
      requestKey: randomUUID(),
      message: "Hello",
    }),
  );
  const result = await f.app.send(
    f.installation.id,
    "https://example.org",
    a.sessionId,
    a.token,
    { requestKey: randomUUID(), message: "Hello" },
  );
  assert.equal(result.nextStep, "human_help");
  f.site.payload.revoked = true;
  await assert.rejects(
    f.app.publicConfig(f.installation.id, "https://example.org"),
  );
});
test("enquiry retries save once and do not create marketing permission or auto-associate", async () => {
  const f = await liveShape(),
    s = await f.app.start(f.installation.id, "https://example.org"),
    input = {
      requestKey: randomUUID(),
      name: "Example Visitor",
      email: "visitor@example.org",
      organisation: "Example",
      message: "Please help",
      privacyAcknowledged: true,
    };
  const a = await f.app.enquire(
      f.installation.id,
      "https://example.org",
      s.sessionId,
      s.token,
      input,
    ),
    b = await f.app.enquire(
      f.installation.id,
      "https://example.org",
      s.sessionId,
      s.token,
      input,
    );
  assert.equal(a.id, b.id);
  const row = f.db.rows("events").find((r) => r.id === a.id)!;
  assert.equal(row.payload.marketingPermission, "not_granted");
  assert.equal(row.payload.contactId, undefined);
  assert.equal(
    f.db.rows("events").filter((r) => r.eventType === "interaction_enquiry")
      .length,
    1,
  );
});

test("generation receives only selected public client knowledge and its own valid conversation", async () => {
  const f = await liveShape();
  const currentKit = f.db.rows("brand_kits")[0]!;
  currentKit.descriptions = { short: "PRIVATE BUSINESS DESCRIPTION" };
  currentKit.emailDefaults = {
    fromDisplayName: "EMAIL IDENTITY MUST NOT BECOME CHAT",
  };
  const makeAsset = (
    id: string,
    brandId: string,
    visibility = "published",
  ) => ({
    id,
    version: 1,
    kind: "asset",
    status: "approved",
    updatedAt: new Date().toISOString(),
    fingerprint: id,
    sourceVersions: [],
    data: {
      title: id,
      text: id + " client information",
      url: "https://example.org/" + id,
      scope: { brandId },
      visibility,
      allowedUses: ["website chat"],
      usageRights: "owned",
      restrictions: [],
      archived: false,
    },
  });
  for (const record of [
    makeAsset("public-client", f.brand),
    makeAsset("PRIVATE-KNOWLEDGE", f.brand, "private"),
    makeAsset("OTHER-CLIENT", "another-brand"),
  ]) {
    f.db
      .rows("events")
      .push(trackingRow(f.w, "content_strategy_record", { record }));
  }
  f.installation.payload.publicAssetIds = [
    "public-client",
    "PRIVATE-KNOWLEDGE",
    "OTHER-CLIENT",
  ];
  const app = createInteraction(config, f.db.mongo, async (task, input) => {
    assert.equal(task, "interaction");
    const text = JSON.stringify(input);
    assert.match(text, /public-client client information/);
    for (const forbidden of [
      "PRIVATE BUSINESS DESCRIPTION",
      "EMAIL IDENTITY",
      "PRIVATE-KNOWLEDGE",
      "OTHER-CLIENT",
      "HENRY PRIVATE HISTORY",
      "WITHDRAWN ANSWER",
      "OTHER SESSION",
    ])
      assert.ok(!text.includes(forbidden), forbidden);
    assert.equal(
      (input as { identity: { displayName: string } }).identity.displayName,
      "Guide",
    );
    return {
      result: {
        answer: "Here is the client information.",
        sourceIds: ["public-client"],
        nextStep: "continue",
        ctaAssetId: "",
        qualificationEvidence: [],
        uncertainties: [],
      },
      usage: { model: "test", inputTokens: 10, outputTokens: 10 },
    };
  });
  const session = await app.start(f.installation.id, "https://example.org");
  f.db.rows("events").push(
    trackingRow(f.w, "workspace_henry", { message: "HENRY PRIVATE HISTORY" }),
    trackingRow(f.w, "interaction_turn", {
      sessionId: session.sessionId,
      status: "complete",
      message: "old",
      reply: { answer: "WITHDRAWN ANSWER" },
      sources: [{ id: "withdrawn", version: 1 }],
    }),
    trackingRow(f.w, "interaction_turn", {
      sessionId: "other-session",
      status: "complete",
      message: "OTHER SESSION",
      reply: { answer: "OTHER SESSION" },
      sources: [],
    }),
  );
  const request = {
    requestKey: randomUUID(),
    message: "Tell me about the client",
  };
  await app.send(
    f.installation.id,
    "https://example.org",
    session.sessionId,
    session.token,
    request,
  );
  // Withdrawal also invalidates a previously completed idempotent replay.
  f.installation.payload.publicAssetIds = [];
  await assert.rejects(
    app.send(
      f.installation.id,
      "https://example.org",
      session.sessionId,
      session.token,
      request,
    ),
  );
});

test("an installation cannot change brand and carry its existing conversations with it", async () => {
  const f = await liveShape();
  await assert.rejects(
    f.app.mutate(f.identity, f.w, {
      id: f.installation.id,
      expectedVersion: 1,
      operation: "save",
      settings: {
        ...Object.fromEntries(
          Object.keys(interactionSettings._def.schema.shape).map((key) => [
            key,
            f.installation.payload[key],
          ]),
        ),
        brandId: "another-brand",
      },
    }),
  );
});

test("reviewed enquiries preserve an existing contact's restrictions and produce one feedback item", async () => {
  const f = await liveShape();
  f.installation.payload.testOnly = false;
  const person = generatePlatformId("person"),
    address = generatePlatformId("contact");
  f.db.rows("people").push({
    id: person,
    workspaceId: f.w,
    archived: false,
    displayName: "Existing name",
    suppressed: true,
  });
  f.db.rows("contact_points").push({
    id: address,
    workspaceId: f.w,
    personId: person,
    type: "email",
    value: "visitor@example.org",
    normalizedValue: "visitor@example.org",
    archived: false,
    suppressed: true,
  });
  const priorPerson = structuredClone(f.db.rows("people")[0]);
  const session = await f.app.start(f.installation.id, "https://example.org");
  const input = {
    requestKey: randomUUID(),
    name: "Visitor claim",
    email: "visitor@example.org",
    organisation: "Unverified organisation",
    message: "Please help",
    privacyAcknowledged: true,
  };
  const result = await f.app.enquire(
    f.installation.id,
    "https://example.org",
    session.sessionId,
    session.token,
    input,
  );
  await assert.rejects(
    f.app.enquire(
      f.installation.id,
      "https://example.org",
      session.sessionId,
      session.token,
      { ...input, name: "Changed claim" },
    ),
  );
  await f.app.mutate(f.identity, f.w, {
    id: result.id,
    expectedVersion: 1,
    operation: "associate",
  });
  await f.app.mutate(f.identity, f.w, {
    id: result.id,
    expectedVersion: 2,
    operation: "associate",
  });
  assert.deepEqual(f.db.rows("people")[0], priorPerson);
  assert.equal(f.db.rows("contact_points")[0].suppressed, true);
  const evidence = f.db
    .rows("events")
    .filter((r) => r.eventType === "measurement_outcome");
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].payload.kind, "interaction_enquiry");
  assert.equal(
    f.db
      .rows("events")
      .filter((r) => r.eventType === "nba_measurement_feedback").length,
    1,
  );
});

test("archive and restore stop chat; restoring never re-enables public execution", async () => {
  const f = await liveShape();
  await f.app.mutate(f.identity, f.w, {
    id: f.installation.id,
    expectedVersion: 1,
    operation: "archive",
  });
  await assert.rejects(f.app.start(f.installation.id, "https://example.org"));
  const restored = await f.app.mutate(f.identity, f.w, {
    id: f.installation.id,
    expectedVersion: 2,
    operation: "restore",
  });
  assert.equal(restored.installations[0].enabled, false);
  assert.equal(restored.installations[0].archived, false);
  await assert.rejects(f.app.start(f.installation.id, "https://example.org"));
});

test("tracking association requires the same workspace and website and an unexpired secret", async () => {
  const f = await liveShape(),
    token = "a".repeat(43),
    tracking = trackingRow(f.w, "website_tracking_session", {
      siteId: f.site.id,
      tokenHash: secretHash(token),
      expiresAt: new Date(Date.now() + 60000),
      communicationId: "email",
    });
  f.db.rows("events").push(tracking);
  const session = await f.app.start(f.installation.id, "https://example.org", {
    trackingSession: tracking.id + "." + token,
  });
  assert.equal(
    f.db.rows("events").find((r) => r.id === session.sessionId)?.payload
      .trackingSessionId,
    tracking.id,
  );
  tracking.workspaceId = "other";
  const other = await f.app.start(f.installation.id, "https://example.org", {
    trackingSession: tracking.id + "." + token,
  });
  assert.equal(
    f.db.rows("events").find((r) => r.id === other.sessionId)?.payload
      .trackingSessionId,
    undefined,
  );
});

import { secretHash } from "../src/services/interaction/model";
import { expireInteractionContent } from "../src/services/interaction/cleanup";
test("retention removes visitor data and session secrets without removing the audit shell", async () => {
  const f = await liveShape(),
    row = trackingRow(f.w, "interaction_enquiry", {
      version: 1,
      visitor: { email: "expired@example.org" },
      tokenHash: "secret",
      expiresAt: "2000-01-01T00:00:00.000Z",
      reviewNote: "private",
    });
  f.db.rows("events").push(row);
  await expireInteractionContent(f.db.mongo);
  const expired = f.db.rows("events").find((r) => r.id === row.id)!;
  assert.equal(expired.archived, true);
  assert.equal(expired.payload.expired, true);
  assert.equal(expired.payload.visitor, undefined);
  assert.equal(expired.payload.tokenHash, undefined);
  assert.equal(expired.payload.reviewNote, undefined);
});

import { EventInsertSchema } from "../src/domain";
test("generic event writes cannot forge public chat or its attribution authority", () => {
  for (const eventType of [
    "interaction_installation",
    "interaction_session",
    "interaction_enquiry",
    "interaction_turn",
    "website_tracking_site",
    "measurement_outcome",
  ])
    assert.equal(
      EventInsertSchema.safeParse({
        eventType,
        occurredAt: new Date(),
        payload: {},
      }).success,
      false,
    );
});

import { readInteractionEvidence } from "../src/services/interaction/evidence";
test("NBA evidence excludes unreviewed, expired, test and foreign enquiries", async () => {
  const f = await liveShape(),
    base = {
      version: 1,
      contactId: "person",
      brandId: f.brand,
      identityConfidence: "human_reviewed_association",
      testOnly: false,
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      visitor: {
        message: "Please discuss a project",
        organisation: "Claimed organisation",
      },
    };
  for (const patch of [
    {},
    { testOnly: true },
    { brandId: "other" },
    { identityConfidence: "visitor_supplied_unverified" },
    { expiresAt: "2000-01-01T00:00:00.000Z" },
  ])
    f.db
      .rows("events")
      .push(trackingRow(f.w, "interaction_enquiry", { ...base, ...patch }));
  const evidence = await readInteractionEvidence(
    await f.db.mongo.database(),
    f.w,
    f.brand,
    "person",
  );
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].message, base.visitor.message);
});

import { interactionRegistration } from "../src/services/interaction/registration";
test("catalogue definition is a client-bound proposal and does not grant outreach or worker execution", () => {
  const definition = interactionRegistration({
    type: "human",
    id: "reviewer",
    issuer: "https://example.org",
  });
  assert.equal(definition.key, "website_interaction");
  assert.equal(definition.status, "draft");
  assert.equal(definition.data.hiveAccess.approval, "human_only");
  assert.deepEqual(definition.data.hiveAccess.proposeResources, []);
});

test("only the selected approved avatar in the current brand can be served", async () => {
  const f = await liveShape(),
    digest = "a".repeat(64),
    kit = f.db.rows("brand_kits")[0];
  kit.chatPersonality.avatarAssetId = digest;
  kit.assets = [
    {
      name: "Assistant",
      type: "graphic",
      status: "approved",
      object: {
        store: "s3",
        bucket: "images",
        key: `brand-images/${f.w}/${f.brand}/images/${digest}.png`,
        versionId: "version",
      },
    },
  ];
  let reads = 0;
  const app = createInteraction(config, f.db.mongo, undefined, {
    bucket: "images",
    get: async () => {
      reads++;
      return Buffer.from("png");
    },
    put: async () => {
      throw Error("unexpected write");
    },
  });
  assert.equal(
    (await app.avatar(f.installation.id, "https://example.org"))?.toString(),
    "png",
  );
  kit.assets[0].status = "retired";
  assert.equal(
    await app.avatar(f.installation.id, "https://example.org"),
    null,
  );
  assert.equal(reads, 1);
});

test("public HTTP boundary enforces feature gate, origin and session secret", async () => {
  const { default: express } = await import("express");
  const { publicInteractionRouter } = await import("../src/routes/interaction");
  const f = await liveShape();
  const previous = process.env.HVM_INTERACTION_ENABLED;
  const server = express()
    .use("/interaction", publicInteractionRouter(config, f.db.mongo))
    .listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}/interaction/${f.installation.id}`;
  try {
    process.env.HVM_INTERACTION_ENABLED = "false";
    assert.equal((await fetch(url)).status, 503);
    process.env.HVM_INTERACTION_ENABLED = "true";
    assert.equal((await fetch(url)).status, 403);
    assert.equal(
      (await fetch(url, { headers: { Origin: "https://foreign.example" } }))
        .status,
      403,
    );
    const headers = {
      Origin: "https://example.org",
      "Content-Type": "application/json",
    };
    const response = await fetch(url + "/sessions", {
      method: "POST",
      headers,
      body: "{}",
    });
    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get("access-control-allow-origin"),
      "https://example.org",
    );
    const result = (await response.json()) as {
      sessionId: string;
      token: string;
    };
    assert.ok(result.sessionId && result.token);
    assert.equal(
      (
        await fetch(url + `/sessions/${result.sessionId}/messages`, {
          method: "POST",
          headers,
          body: "{}",
        })
      ).status,
      400,
    );
  } finally {
    if (previous === undefined) delete process.env.HVM_INTERACTION_ENABLED;
    else process.env.HVM_INTERACTION_ENABLED = previous;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("a reviewed new visitor creates a schema-valid named contact", async () => {
  const f = await liveShape();
  const session = await f.app.start(f.installation.id, "https://example.org");
  const result = await f.app.enquire(
    f.installation.id,
    "https://example.org",
    session.sessionId,
    session.token,
    {
      requestKey: randomUUID(),
      name: "Taylor Example",
      email: "new@example.org",
      organisation: "",
      message: "Please help",
      privacyAcknowledged: true,
    },
  );
  await f.app.mutate(f.identity, f.w, {
    id: result.id,
    expectedVersion: 1,
    operation: "associate",
  });
  const { PersonSchema, ContactPointSchema } = await import("../src/domain");
  assert.equal(PersonSchema.parse(f.db.rows("people")[0]).firstName, "Taylor");
  assert.equal(
    ContactPointSchema.parse(f.db.rows("contact_points")[0]).normalizedValue,
    "new@example.org",
  );
});
