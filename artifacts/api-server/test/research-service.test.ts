import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { createResearchService } from "../src/services/research/service";
import type { ContentGenerator } from "../src/services/content-strategy/generate";
import { EnquiryMemoryDb } from "./helpers/enquiry-db";
import { parseConfig } from "../src/config";
import { authEnvironment, testIssuer } from "./helpers/auth";
import { provisionHvmClient } from "../src/services/hvm-provision";
import { generatePlatformId } from "../src/domain";
const config = parseConfig({
  ...authEnvironment,
  HVM_COGNITO_CLIENT_ID: "hvmclient",
  DEPLOYMENT_ENV: "test",
  MONGODB_URI: "mongodb://unused.invalid",
});
async function setup(generator?: ContentGenerator) {
  const db = new EnquiryMemoryDb(),
    w = generatePlatformId("workspace"),
    brand = generatePlatformId("brand"),
    identity = {
      subject: "research-owner",
      issuer: testIssuer,
      clientId: "hvmclient",
    };
  db.rows("schema_versions").push({ _id: "vapp-v1", version: 28 });
  await provisionHvmClient(
    db.mongo,
    {
      organisationId: generatePlatformId("org"),
      organisationName: "Research fixture",
      workspaceId: w,
      management: "client",
      brandId: brand,
      clientMembershipId: generatePlatformId("workspacemembership"),
      workspaceName: "Research fixture",
      brandName: "Research fixture",
      brandSlug: "research-fixture",
      human: { type: "human", id: identity.subject, issuer: identity.issuer },
    },
    testIssuer,
  );
  const service = createResearchService(config, db.mongo, generator);
  const input = {
    requestKey: randomUUID(),
    objective: "Investigate demand signals",
    type: "market_buyer",
    scope: { brandId: brand, products: [], offers: [], audiences: [] },
    urls: [],
    destinations: [],
    sourceMode: "existing",
    freshnessDays: 30,
  };
  return { db, w, brand, identity, service, input };
}
const result = {
  summary: "Evidence is incomplete.",
  organisations: [],
  contacts: [],
  findings: [
    {
      statement: "Potential demand",
      kind: "fact",
      evidenceIds: ["invented"],
      rationale: "Assess this",
    },
  ],
  gaps: ["No public evidence supplied"],
};
const usage = { model: "offline-fixture", inputTokens: 10, outputTokens: 20 };
test("request idempotency rejects changed requests and cross-workspace access", async () => {
  const { service, w, identity, input } = await setup();
  const first = await service.start(identity, w, input);
  const second = await service.start(identity, w, input);
  assert.equal(first.id, second.id);
  await assert.rejects(
    service.start(identity, w, { ...input, objective: "Changed objective" }),
  );
  await assert.rejects(
    service.read({ ...identity, subject: "outsider" }, w, first.id),
  );
  await assert.rejects(
    service.read(identity, generatePlatformId("workspace"), first.id),
  );
});
test("partial output survives and invented evidence cannot become a fact", async () => {
  const { service, w, identity, input } = await setup(async () => ({
    result,
    usage,
  }));
  const job = await service.start(identity, w, input);
  const saved = await service.run(identity, w, job.id);
  assert.equal(saved.job.status, "partial");
  assert.equal(saved.findings.length, 1);
  assert.equal(saved.findings[0]!.kind, "inference");
  assert.deepEqual(saved.findings[0]!.evidenceIds, []);
  const finding = saved.findings[0]!;
  await service.review(identity, w, finding.id, {
    expectedUpdatedAt: finding.updatedAt,
    statement: "Reviewed assessment",
    decision: "accepted",
    note: "Confirmed by reviewer",
  });
  assert.equal(
    (await service.read(identity, w, job.id)).findings[0]!.statement,
    "Reviewed assessment",
  );
});
test("cancellation fences a late generation result", async () => {
  let release!: () => void;
  const wait = new Promise<void>((r) => (release = r));
  let entered!: () => void;
  const ready = new Promise<void>((r) => (entered = r));
  const { service, w, identity, input } = await setup(async () => {
    entered();
    await wait;
    return { result, usage };
  });
  const job = await service.start(identity, w, input);
  const running = service.run(identity, w, job.id);
  await ready;
  const current = await service.read(identity, w, job.id);
  await service.mutate(identity, w, job.id, {
    action: "cancel",
    expectedUpdatedAt: current.job.updatedAt,
  });
  release();
  await running;
  const final = await service.read(identity, w, job.id);
  assert.equal(final.job.status, "cancelled");
  assert.equal(final.findings.length, 0);
});
test("concurrent runners execute a provider once and failure can be retried", async () => {
  let calls = 0;
  const { service, w, identity, input } = await setup(async () => {
    calls++;
    throw Error("provider failure");
  });
  const job = await service.start(identity, w, input);
  await Promise.all([
    service.run(identity, w, job.id),
    service.run(identity, w, job.id),
  ]);
  assert.equal(calls, 1);
  const failed = await service.read(identity, w, job.id);
  assert.equal(failed.job.status, "failed");
  const retry = await service.mutate(identity, w, job.id, {
    action: "retry",
    expectedUpdatedAt: failed.job.updatedAt,
  });
  assert.notEqual(retry.id, job.id);
});
test("refresh policies are explicit and removable", async () => {
  const { service, w, identity, input, db } = await setup();
  const request = { ...input };
  delete (request as Partial<typeof input>).requestKey;
  const policy = await service.policy(identity, w, {
    name: "Demand refresh",
    enabled: false,
    mode: "triggered",
    intervalDays: 30,
    trigger: "contact.created",
    request,
  });
  const row = db.rows("events").find((r) => r.id === policy.id)!;
  assert.equal(row.payload.enabled, false);
  await service.removePolicy(identity, w, policy.id, {
    expectedUpdatedAt: row.updatedAt.toISOString(),
  });
  assert.equal(row.archived, true);
});

test("public discovery retains candidates without creating managed contacts", async () => {
  const fixture = await setup();
  const { db, w, brand, identity, input } = fixture;
  const generator: ContentGenerator = async (_task, raw) => {
    const sources = (raw as { sources: { id: string }[] }).sources;
    return {
      result: {
        ...result,
        gaps: [],
        findings: [
          {
            statement: "Named business contact",
            kind: "fact",
            evidenceIds: [sources[0]!.id],
            rationale: "Public team page",
          },
        ],
        contacts: [
          {
            firstName: "Jane",
            lastName: "Example",
            title: "Director",
            email: "jane@example.org",
            companyWebsite: "https://example.org",
            evidenceIds: [sources[0]!.id],
          },
        ],
      },
      usage,
    };
  };
  const service = createResearchService(config, db.mongo, generator, {
    crawl: async () => ({
      pages: [
        {
          url: "https://example.org/team",
          title: "Team",
          text: "Jane Example, Director. jane@example.org",
          retrievedAt: new Date().toISOString(),
          digest: "a".repeat(64),
        },
      ],
      unavailable: [],
      pagesAttempted: 1,
      limited: false,
    }),
  });
  const research = {
    ...input,
    type: "contact_discovery",
    sourceMode: "web",
    urls: ["https://example.org/team"],
    scope: { brandId: brand, products: [], offers: [], audiences: [] },
  };
  const first = await service.start(identity, w, research);
  const saved = await service.run(identity, w, first.id);
  assert.equal(saved.job.status, "completed");
  assert.equal(saved.job.discovery[0].status, "candidate");
  assert.equal(db.rows("people").length, 0);
  const created = db
    .rows("events")
    .find(
      (e) =>
        e.eventType === "hvm_record_created" && e.payload.kind === "contacts",
    );
  assert.equal(created, undefined);
  assert.ok(saved.job.discovery[0].candidateId);
  assert.equal(saved.job.discovery[0].details.email,undefined);
  const second = await service.start(identity, w, {
    ...research,
    requestKey: randomUUID(),
  });
  await service.run(identity, w, second.id);
  assert.equal(db.rows("people").length, 0);
});

test("triggered policies ignore research writes and queue an ordinary change once", async () => {
  const { service, w, identity, input, db } = await setup(async () => ({
    result,
    usage,
  }));
  const request = { ...input };
  delete (request as Partial<typeof input>).requestKey;
  const p = await service.policy(identity, w, {
    name: "Context refresh",
    enabled: true,
    mode: "triggered",
    intervalDays: 30,
    trigger: "contact.created",
    request,
  });
  const policy = db.rows("events").find((r) => r.id === p.id)!;
  policy.payload.cursorAt = new Date(Date.now() - 5000).toISOString();
  db.rows("events").push({
    id: generatePlatformId("event"),
    workspaceId: w,
    eventType: "hvm_record_created",
    createdAt: new Date(Date.now() - 1000),
    payload: { kind: "contacts", origin: "research" },
  });
  await service.tick();
  assert.equal(
    db.rows("events").filter((r) => r.eventType === "research_job").length,
    0,
  );
  db.rows("events").push({
    id: generatePlatformId("event"),
    workspaceId: w,
    eventType: "hvm_record_created",
    createdAt: new Date(),
    payload: { kind: "contacts" },
  });
  await service.tick();
  await service.tick();
  assert.equal(
    db.rows("events").filter((r) => r.eventType === "research_job").length,
    1,
  );
});
test("a generated contact with no source-backed identity is held for review", async () => {
  const { service, w, identity, input, db } = await setup(async () => ({
    result: {
      ...result,
      contacts: [
        {
          firstName: "Invented",
          lastName: "Person",
          title: "Buyer",
          email: "invented@example.org",
          companyWebsite: "",
          evidenceIds: ["fabricated"],
        },
      ],
    },
    usage,
  }));
  const job = await service.start(identity, w, {
    ...input,
    type: "contact_discovery",
  });
  const saved = await service.run(identity, w, job.id);
  assert.equal(db.rows("people").length, 0);
  assert.equal(saved.job.discovery.length, 0);
});
