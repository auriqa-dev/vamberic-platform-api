import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { EnquiryMemoryDb } from "./helpers/enquiry-db";
import { authEnvironment, testIssuer } from "./helpers/auth";
import { parseConfig } from "../src/config";
import { generatePlatformId, OrganisationSchema } from "../src/domain";
import { provisionHvmClient } from "../src/services/hvm-provision";
import { createResearchDocuments } from "../src/services/research/documents";
import { readResearchContext } from "../src/services/research/context";
const identity = {
  subject: "test-user-subject",
  issuer: testIssuer,
  clientId: "hvmclient",
};
const config = parseConfig({
  ...authEnvironment,
  HVM_COGNITO_CLIENT_ID: "hvmclient",
  HVM_CORS_ORIGINS: "https://app.h-v-m.net",
  DEPLOYMENT_ENV: "test",
  MONGODB_URI: "mongodb://unused.invalid",
});
async function setup() {
  const db = new EnquiryMemoryDb();
  const now = new Date();
  const org = generatePlatformId("org"),
    w = generatePlatformId("workspace");
  db.rows("schema_versions").push({ _id: "vapp-v1", version: 28 });
  db.rows("organisations").push(
    OrganisationSchema.parse({
      id: org,
      name: "Client",
      type: "customer",
      createdAt: now,
      updatedAt: now,
    }),
  );
  await provisionHvmClient(
    db.mongo,
    {
      organisationId: org,
      workspaceId: w,
      partnerId: generatePlatformId("partner"),
      partnerMembershipId: generatePlatformId("partnermembership"),
      assignmentId: generatePlatformId("partnerassignment"),
      brandId: generatePlatformId("brand"),
      clientMembershipId: generatePlatformId("workspacemembership"),
      workspaceName: "Client",
      partnerName: "Agency",
      brandName: "Brand",
      brandSlug: "brand",
      human: { type: "human", issuer: testIssuer, id: identity.subject },
    },
    testIssuer,
  );
  const files = new Map<string, Buffer>();
  const app = createResearchDocuments(config, db.mongo, {
    async put(key, bytes) {
      files.set(key, bytes);
      return "v1";
    },
    async get(key) {
      return files.get(key)!;
    },
  });
  const bytes = Buffer.from("Group,Energy\nExample,100\n");
  const input = {
    requestKey: randomUUID(),
    filename: "evidence.csv",
    size: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    details: {
      name: "Research",
      purpose: "Compare reported groups",
      extract: "Example reporting group: 100",
      provenance: "Sheet one, row 2",
      grain: "reporting_group",
    },
  };
  return { db, app, w, input, bytes };
}
test("research uploads verify original bytes, retry safely and never import CRM records", async () => {
  const f = await setup();
  const before = f.db.rows("organisations").length;
  const row = await f.app.create(identity, f.w, f.input);
  assert.equal((await f.app.create(identity, f.w, f.input)).id, row.id);
  await assert.rejects(f.app.upload(identity, f.w, row.id, Buffer.from("bad")));
  const ready = await f.app.upload(identity, f.w, row.id, f.bytes);
  assert.equal(ready.status, "ready");
  assert.equal((await f.app.upload(identity, f.w, row.id, f.bytes)).id, row.id);
  assert.deepEqual(
    (await f.app.download(identity, f.w, row.id)).bytes,
    f.bytes,
  );
  assert.equal(f.db.rows("organisations").length, before);
  assert.equal(f.db.rows("people").length, 0);
  const context = await readResearchContext(await f.db.mongo.database(), f.w, [
    { id: row.id, revision: 1 },
  ]);
  assert.equal(context.sources[0]?.grain, "reporting_group");
  assert.match(context.instructions, /must never be assigned/);
  await assert.rejects(
    f.app.list({ ...identity, subject: "unrelated-user" }, f.w),
  );
  await assert.rejects(
    readResearchContext(
      await f.db.mongo.database(),
      generatePlatformId("workspace"),
      [{ id: row.id, revision: 1 }],
    ),
  );
});
test("changed and removed research extracts cannot be silently reused", async () => {
  const f = await setup();
  const created = await f.app.create(identity, f.w, f.input);
  const row = await f.app.upload(identity, f.w, created.id, f.bytes);
  await f.app.mutate(identity, f.w, {
    operation: "update",
    id: row.id,
    expectedUpdatedAt: row.updatedAt,
    details: { ...f.input.details, extract: "Corrected group observation" },
  });
  await assert.rejects(
    readResearchContext(await f.db.mongo.database(), f.w, [
      { id: row.id, revision: 1 },
    ]),
  );
  const updated = (await f.app.list(identity, f.w)).documents[0]!;
  assert.equal(updated.revision, 2);
  await assert.rejects(
    f.app.mutate(identity, f.w, {
      operation: "remove",
      targets: [{ id: row.id, expectedUpdatedAt: row.updatedAt }],
    }),
  );
  await f.app.mutate(identity, f.w, {
    operation: "remove",
    targets: [{ id: updated.id, expectedUpdatedAt: updated.updatedAt }],
  });
  assert.equal((await f.app.list(identity, f.w)).documents.length, 0);
  await assert.rejects(f.app.download(identity, f.w, row.id));
  await assert.rejects(
    readResearchContext(await f.db.mongo.database(), f.w, [
      { id: row.id, revision: 2 },
    ]),
  );
});

test("consumer characteristics keep person authority, stale-write protection and deletion", async () => {
  const { createConsumerFacts } =
    await import("../src/services/icp/consumer-facts");
  const { assessConsumerFit } = await import("../src/services/icp/eligibility");
  const f = await setup(),
    personId = generatePlatformId("person");
  f.db.rows("people").push({
    id: personId,
    workspaceId: f.w,
    firstName: "Example",
    archived: false,
  });
  const app = createConsumerFacts(config, f.db.mongo);
  const facts = {
    country: "United Kingdom",
    region: "North West",
    needs: ["Lower energy costs"],
    interests: ["Efficiency"],
    purchaseStage: "comparing",
    source: "Customer interview",
    observedOn: "2026-01-01",
  };
  const saved = await app.save(identity, f.w, personId, {
    expectedUpdatedAt: null,
    facts,
  });
  assert.deepEqual(saved?.facts, facts);
  await assert.rejects(
    app.save(identity, f.w, personId, { expectedUpdatedAt: null, facts }),
  );
  await assert.rejects(
    app.save({ ...identity, subject: "unrelated" }, f.w, personId, {
      expectedUpdatedAt: saved?.updatedAt,
      facts,
    }),
  );
  assert.equal(
    assessConsumerFit({ consumerNeeds: ["Lower energy costs", "Other"] }, [
      {
        field: "consumerNeeds",
        values: ["lower energy costs"],
        effect: "include",
      },
    ]).fit,
    "matches",
  );
  assert.equal(
    assessConsumerFit({ consumerNeeds: [] }, [
      {
        field: "consumerNeeds",
        values: ["lower energy costs"],
        effect: "exclude",
      },
    ]).fit,
    "needs_review",
  );
  await app.save(identity, f.w, personId, {
    expectedUpdatedAt: saved?.updatedAt,
    facts: null,
  });
  assert.equal((await app.read(identity, f.w, personId))?.facts, null);
  assert.equal(
    f.db
      .rows("events")
      .filter((r) => r.eventType === "consumer_characteristics_history").length,
    1,
  );
});

test("bulk document purpose updates preserve extracts and advance each selected version", async () => {
  const f = await setup();
  const a = await f.app.create(identity, f.w, f.input);
  const b = await f.app.create(identity, f.w, {
    ...f.input,
    requestKey: randomUUID(),
    filename: "second.csv",
  });
  await f.app.mutate(identity, f.w, {
    operation: "update-purpose",
    purpose: "Shared research question",
    targets: [a, b].map((r) => ({ id: r.id, expectedUpdatedAt: r.updatedAt })),
  });
  const rows = (await f.app.list(identity, f.w)).documents;
  assert.equal(rows.length, 2);
  assert.ok(
    rows.every(
      (r) =>
        r.revision === 2 &&
        r.details.purpose === "Shared research question" &&
        r.details.extract === f.input.details.extract,
    ),
  );
});

test("content originals validate PDF and Word signatures before storage", async () => {
  const f = await setup();
  for (const [filename, bytes, valid] of [
    ["report.pdf", Buffer.from("%PDF-1.4\nexample"), true],
    ["report.docx", Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]), true],
    ["fake.pdf", Buffer.from("not a pdf"), false],
  ] as const) {
    const row = await f.app.create(identity, f.w, {
      ...f.input,
      requestKey: randomUUID(),
      filename,
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    if (valid)
      assert.equal(
        (await f.app.upload(identity, f.w, row.id, bytes)).status,
        "ready",
      );
    else await assert.rejects(() => f.app.upload(identity, f.w, row.id, bytes));
  }
});

test("Library media originals stay private, byte-verified and undeletable while referenced", async () => {
  const f = await setup();
  for (const filename of [
    "slides.pptx",
    "table.xlsx",
    "diagram.png",
    "recording.mp4",
    "audio.mp3",
    "legacy.doc",
  ]) {
    const row = await f.app.create(identity, f.w, {
      ...f.input,
      requestKey: randomUUID(),
      filename,
    });
    const ready = await f.app.upload(identity, f.w, row.id, f.bytes);
    assert.deepEqual(
      (await f.app.download(identity, f.w, row.id)).bytes,
      f.bytes,
    );
    await assert.rejects(() =>
      f.app.download({ ...identity, subject: "foreign" }, f.w, row.id),
    );
    f.db
      .rows("events")
      .push({
        id: generatePlatformId("event"),
        workspaceId: f.w,
        eventType: "content_strategy_record",
        payload: {
          record: {
            id: generatePlatformId("event"),
            kind: "asset",
            version: 1,
            status: "draft",
            data: { sourceDocumentId: row.id },
          },
        },
      });
    await assert.rejects(
      () =>
        f.app.mutate(identity, f.w, {
          operation: "remove",
          targets: [{ id: row.id, expectedUpdatedAt: ready.updatedAt }],
        }),
      /Library|referenc|original/i,
    );
  }
});
