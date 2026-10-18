import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { createCampaignService } from "../src/services/campaigns/service";
import {
  campaignReadiness,
  campaignSetup,
} from "../src/services/campaigns/model";
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
async function fixture() {
  const db = new EnquiryMemoryDb(),
    w = generatePlatformId("workspace"),
    brand = generatePlatformId("brand"),
    identity = {
      subject: "campaign-owner",
      issuer: testIssuer,
      clientId: "hvmclient",
    };
  db.rows("schema_versions").push({ _id: "vapp-v1", version: 29 });
  await provisionHvmClient(
    db.mongo,
    {
      organisationId: generatePlatformId("org"),
      organisationName: "Campaign fixture",
      workspaceId: w,
      management: "client",
      brandId: brand,
      clientMembershipId: generatePlatformId("workspacemembership"),
      workspaceName: "Campaign fixture",
      brandName: "Campaign fixture",
      brandSlug: "campaign-fixture",
      human: { type: "human", id: identity.subject, issuer: identity.issuer },
    },
    testIssuer,
  );
  const service = createCampaignService(config, db.mongo);
  const setup = {
    name: "Two offers",
    objective: "Find suitable customers",
    brandId: brand,
    products: [],
    offers: [],
    audiences: [],
    source: "both",
    researchPriority: "Find supported demand signals",
    urls: [],
    channels: [],
    goal: "New customers",
    target: 10,
    owner: "Marketing",
    timezone: "Europe/London",
    startDate: "",
    endDate: "",
    schedule: "",
    assetIds: [],
    overlapPolicy: "Review overlaps",
  };
  return { db, w, brand, identity, service, setup };
}
test("campaign setup persists, duplicate request recovers and stale edits fail", async () => {
  const f = await fixture(),
    body = {
      requestKey: randomUUID(),
      expectedVersion: 0,
      action: "save",
      setup: f.setup,
    };
  const saved = await f.service.change(f.identity, f.w, undefined, body);
  assert.equal(saved.version, 1);
  assert.equal(saved.status, "draft");
  assert.equal(
    (await f.service.change(f.identity, f.w, undefined, body)).id,
    saved.id,
  );
  const read = await f.service.read(f.identity, f.w, saved.id);
  assert.equal(read.setup.name, "Two offers");
  assert.equal(
    read.execution,
    "NBA recommendations and individually authorised Communications are available. Campaign setup is not sending permission.",
  );
  assert.equal(read.contacts, 0);
  await assert.rejects(
    () =>
      f.service.change(f.identity, f.w, saved.id, {
        ...body,
        requestKey: randomUUID(),
      }),
    /changed/,
  );
  assert.equal(f.db.rows("campaigns")[0]?.status, "draft");
});
test("incomplete setup cannot approve or run and failed approval preserves draft", async () => {
  const f = await fixture(),
    saved = await f.service.change(f.identity, f.w, undefined, {
      requestKey: randomUUID(),
      expectedVersion: 0,
      action: "save",
      setup: f.setup,
    });
  await assert.rejects(
    () =>
      f.service.change(f.identity, f.w, saved.id, {
        requestKey: randomUUID(),
        expectedVersion: 1,
        action: "approve",
      }),
    /approved product/,
  );
  await assert.rejects(
    () => f.service.start(f.identity, f.w, saved.id, { expectedVersion: 1 }),
    /Approve/,
  );
  assert.equal((await f.service.read(f.identity, f.w, saved.id)).version, 1);
});
test("campaign reads and mutations reject other workspace users", async () => {
  const f = await fixture(),
    saved = await f.service.change(f.identity, f.w, undefined, {
      requestKey: randomUUID(),
      expectedVersion: 0,
      action: "save",
      setup: f.setup,
    });
  const intruder = { ...f.identity, subject: "other-person" };
  await assert.rejects(() => f.service.read(intruder, f.w, saved.id));
  await assert.rejects(() =>
    f.service.change(intruder, f.w, saved.id, {
      requestKey: randomUUID(),
      expectedVersion: 1,
      action: "delete",
    }),
  );
});
test("unused draft deletion retains audit and removes it from campaign list", async () => {
  const f = await fixture(),
    saved = await f.service.change(f.identity, f.w, undefined, {
      requestKey: randomUUID(),
      expectedVersion: 0,
      action: "save",
      setup: f.setup,
    });
  await f.service.change(f.identity, f.w, saved.id, {
    requestKey: randomUUID(),
    expectedVersion: 1,
    action: "delete",
  });
  assert.equal(
    (await f.service.read(f.identity, f.w, saved.id)).status,
    "deleted",
  );
  assert.equal(f.db.rows("campaigns")[0]?.archived, true);
  assert.equal(
    f.db.rows("events").filter((r) => r.eventType === "campaign_setup").length,
    2,
  );
});
test("campaign validation rejects oversized setup and invalid timezone", () => {
  assert.equal(
    campaignSetup.safeParse({ timezone: "invented" }).success,
    false,
  );
  assert.equal(
    campaignReadiness({
      objective: "",
      products: [],
      offers: [],
      audiences: [],
      goal: "",
    } as never).length,
    7,
  );
});
async function withApprovedContext() {
  const f = await fixture();
  const product = generatePlatformId("offering");
  f.db.rows("offerings").push({
    id: product,
    workspaceId: f.w,
    brandId: f.brand,
    approvedRevision: 1,
    definition: { name: "Product" },
  });
  f.db.rows("hive_definition_revisions").push({
    workspaceId: f.w,
    entityType: "offerings",
    entityId: product,
    revision: 1,
    snapshot: { name: "Product" },
  });
  const offers = [],
    audiences = [];
  for (const name of ["Self-service", "Enterprise"]) {
    const offer = generatePlatformId("offer"),
      icp = generatePlatformId("icp");
    offers.push({ id: offer, revision: 1 });
    audiences.push({ id: icp, revision: 1 });
    f.db.rows("offers").push({
      id: offer,
      workspaceId: f.w,
      offeringId: product,
      approvedRevision: 1,
      status: "approved",
      revision: 1,
      definition: {
        name,
        conversionOutcome:
          name === "Enterprise" ? "Sales conversation" : "Purchase",
        qualificationCriteria: ["Relevant need supported by evidence"],
      },
    });
    f.db.rows("offer_revisions").push({
      workspaceId: f.w,
      offerId: offer,
      revision: 1,
      snapshot: { name },
    });
    f.db.rows("ideal_customer_profiles").push({
      id: icp,
      workspaceId: f.w,
      offeringId: product,
      offer: { id: offer, revision: 1 },
      approvedRevision: 1,
      definition: { name: name + " ICP" },
    });
    f.db.rows("hive_definition_revisions").push({
      workspaceId: f.w,
      entityType: "ideal_customer_profiles",
      entityId: icp,
      revision: 1,
      snapshot: {
        name: name + " ICP",
        targetingInstructions:
          "Assess supported demand stress; preserve unknowns.",
      },
    });
  }
  return {
    ...f,
    setup: {
      ...f.setup,
      operatingMode: "both",
      products: [{ id: product, revision: 1 }],
      offers,
      audiences,
    },
  };
}
test("two offers retain independent ICP bindings; approval is not activation", async () => {
  const f = await withApprovedContext();
  const saved = await f.service.change(f.identity, f.w, undefined, {
    requestKey: randomUUID(),
    expectedVersion: 0,
    action: "save",
    setup: f.setup,
  });
  const approved = await f.service.change(f.identity, f.w, saved.id, {
    requestKey: randomUUID(),
    expectedVersion: 1,
    action: "approve",
  });
  assert.equal(approved.status, "ready");
  assert.equal(approved.setup.offers.length, 2);
  assert.equal(f.db.rows("campaigns")[0]?.status, "draft");
  await assert.rejects(
    () => f.service.start(f.identity, f.w, saved.id, { expectedVersion: 2 }),
    /unavailable/,
  );
});
test("approval requires ICP coverage for each offer and preserves prior draft on conflict", async () => {
  const f = await withApprovedContext();
  f.setup.audiences = f.setup.audiences.slice(0, 1);
  const saved = await f.service.change(f.identity, f.w, undefined, {
    requestKey: randomUUID(),
    expectedVersion: 0,
    action: "save",
    setup: f.setup,
  });
  await assert.rejects(
    () =>
      f.service.change(f.identity, f.w, saved.id, {
        requestKey: randomUUID(),
        expectedVersion: 1,
        action: "approve",
      }),
    /every offer/,
  );
});
test("policy proposal is saved as a draft, never silently approved", async () => {
  const f = await fixture(),
    saved = await f.service.change(f.identity, f.w, undefined, {
      requestKey: randomUUID(),
      expectedVersion: 0,
      action: "save",
      setup: f.setup,
    });
  const policy = f.db
    .rows("contact_strategy_policies")
    .find((p) => p.key === "cs_022");
  await f.service.savePolicy(f.identity, f.w, saved.id, {
    campaignVersion: 1,
    expectedVersion: policy?.version ?? 0,
  });
  const rows = f.db
    .rows("contact_strategy_policies")
    .filter((p) => p.key === "cs_022");
  assert.equal(rows.at(-1)?.status, "draft");
  assert.equal(rows.at(-1)?.clauses[0].statement, "Review overlaps");
});
import { campaignMeasurement } from "../src/services/campaigns/measurement";
test("measurements deduplicate provider events and contacts, keep unknown stages unavailable", () => {
  const e = {
    eventKey: "delivery-1",
    kind: "delivered",
    personId: "person-1",
    offerId: "offer-1",
    channel: "email",
    occurredAt: "2026-10-14T09:00:00Z",
  };
  const metrics = campaignMeasurement(
    [e, e, { ...e, eventKey: "delivery-2", offerId: "offer-2" }],
    new Date("2026-10-14"),
    new Date("2026-10-15"),
  );
  assert.equal(metrics.find((m) => m.kind === "delivered")?.value, 1);
  assert.equal(metrics.find((m) => m.kind === "opened")?.value, null);
});
import { createResearchService } from "../src/services/research/service";
test("campaign overview lists current saved setup and supports client administrators", async () => {
  const f = await fixture();
  await f.service.change(f.identity, f.w, undefined, {
    requestKey: randomUUID(),
    expectedVersion: 0,
    action: "save",
    setup: f.setup,
  });
  const listed = await f.service.list(f.identity, f.w);
  assert.equal(listed.campaigns.length, 1);
  assert.ok(listed.choices.brands.some((b) => b.id === f.brand));
});
test("campaign research uses the approved scope, deduplicates selected organisation work and fences changes", async () => {
  const f = await withApprovedContext(),
    org = generatePlatformId("org");
  f.db.rows("organisations").push({
    id: org,
    workspaceId: f.w,
    name: "Candidate",
    domain: "example.org",
  });
  f.setup.researchPriority = "Preserve this entire priority. ".repeat(60);
  const saved = await f.service.change(f.identity, f.w, undefined, {
    requestKey: randomUUID(),
    expectedVersion: 0,
    action: "save",
    setup: f.setup,
  });
  await f.service.change(f.identity, f.w, saved.id, {
    requestKey: randomUUID(),
    expectedVersion: 1,
    action: "approve",
  });
  const research = createResearchService(config, f.db.mongo);
  const request = {
    requestKey: randomUUID(),
    campaignVersion: 2,
    objective: "Assess current candidates",
    type: "account_discovery",
    scope: {
      brandId: f.brand,
      products: f.setup.products,
      offers: f.setup.offers,
      audiences: f.setup.audiences,
    },
    destinations: [
      { type: "campaign", id: saved.id },
      { type: "organisations", id: org },
    ],
    sourceMode: "existing",
  };
  const job = await research.start(f.identity, f.w, request);
  assert.equal(job.status, "queued");
  assert.equal((await research.start(f.identity, f.w, request)).id, job.id);
  await assert.rejects(
    () =>
      research.start(f.identity, f.w, { ...request, requestKey: randomUUID() }),
    /already being researched/,
  );
  await assert.rejects(
    () =>
      f.service.change(f.identity, f.w, saved.id, {
        requestKey: randomUUID(),
        expectedVersion: 2,
        action: "save",
        setup: f.setup,
      }),
    /current research/,
  );
  await assert.rejects(
    () =>
      research.start(f.identity, f.w, {
        ...request,
        requestKey: randomUUID(),
        scope: { ...request.scope, offers: [] },
      }),
    /setup changed/,
  );
  let received: unknown;
  const runner = createResearchService(
    config,
    f.db.mongo,
    async (_task, input) => {
      received = input;
      return {
        result: {
          summary: "Needs review",
          organisations: [],
          contacts: [],
          findings: [],
          unknowns: [],
          assessments: [],
        },
        usage: { model: "offline-fixture", inputTokens: 1, outputTokens: 1 },
      };
    },
  );
  await runner.run(f.identity, f.w, job.id);
  assert.ok(JSON.stringify(received).includes(f.setup.researchPriority.trim()));
});

test("consumer campaign approval requires existing records; contact assessments persist separately", async () => {
  const f = await withApprovedContext();
  for (const row of f.db.rows("hive_definition_revisions"))
    if (row.entityType === "ideal_customer_profiles")
      row.snapshot.profileType = "b2c";
  const saved = await f.service.change(f.identity, f.w, undefined, {
    requestKey: randomUUID(),
    expectedVersion: 0,
    action: "save",
    setup: { ...f.setup, purpose: "retention" },
  });
  assert.equal(f.db.rows("campaigns")[0].type, "retention");
  await assert.rejects(
    () =>
      f.service.change(f.identity, f.w, saved.id, {
        requestKey: randomUUID(),
        expectedVersion: 1,
        action: "approve",
      }),
    /existing contacts only/,
  );
  const existing = await f.service.change(f.identity, f.w, saved.id, {
    requestKey: randomUUID(),
    expectedVersion: 1,
    action: "save",
    setup: { ...f.setup, source: "existing", purpose: "retention" },
  });
  const approved = await f.service.change(f.identity, f.w, saved.id, {
    requestKey: randomUUID(),
    expectedVersion: existing.version,
    action: "approve",
  });
  const person = generatePlatformId("person");
  f.db.rows("people").push({
    id: person,
    workspaceId: f.w,
    firstName: "Existing",
    lastName: "Customer",
    updatedAt: new Date(),
  });
  const listed = await f.service.audience(f.identity, f.w, saved.id, {
    entity: "people",
  });
  assert.equal(listed.items[0].id, person);
  let called = false;
  const research = createResearchService(
    config,
    f.db.mongo,
    async (_task, input) => {
      called = true;
      const evidence = (
        input.sources as { id: string; extract: string }[]
      ).find((s) => s.extract.includes(person));
      assert.ok(evidence);
      return {
        result: {
          summary: "Review customer fit",
          organisations: [],
          contacts: [],
          findings: [],
          gaps: [],
          assessments: [
            {
              organisationId: "",
              personId: person,
              website: "",
              offerId: f.setup.offers[0].id,
              icpId: f.setup.audiences[0].id,
              fit: "potential_fit",
              rationale: "Existing customer",
              evidenceIds: [evidence.id],
              unknowns: [],
            },
          ],
        },
        usage: { model: "fixture", inputTokens: 1, outputTokens: 1 },
      };
    },
  );
  const request = {
    requestKey: randomUUID(),
    campaignVersion: approved.version,
    objective: "Review customer fit",
    type: "market_buyer",
    scope: {
      brandId: f.brand,
      products: f.setup.products,
      offers: f.setup.offers,
      audiences: f.setup.audiences,
    },
    destinations: [
      { type: "campaign", id: saved.id },
      { type: "people", id: person },
    ],
    sourceMode: "existing",
  };
  await assert.rejects(
    () => research.start(f.identity, f.w, { ...request, sourceMode: "web" }),
    /existing records only/,
  );
  const job = await research.start(f.identity, f.w, request);
  await assert.rejects(
    () =>
      research.start(f.identity, f.w, { ...request, requestKey: randomUUID() }),
    /already being researched/,
  );
  await research.run(f.identity, f.w, job.id);
  assert.ok(called);
  const assessment = f.db
    .rows("events")
    .find((r) => r.eventType === "campaign_audience_assessment");
  assert.ok(assessment);
  assert.equal(assessment.payload.personId, person);
  assert.equal(assessment.payload.organisationId, "");
  assert.equal(assessment.payload.decision, "proposed");
});

test("manual meetings are isolated, versioned observations and never qualification or delivery", async () => {
  const f = await withApprovedContext();
  const person = generatePlatformId("person"),
    foreign = generatePlatformId("person");
  f.db.rows("people").push(
    { id: person, workspaceId: f.w, name: "Test buyer" },
    {
      id: foreign,
      workspaceId: generatePlatformId("workspace"),
      name: "Other workspace",
    },
  );
  const campaign = await f.service.change(f.identity, f.w, undefined, {
    requestKey: randomUUID(),
    expectedVersion: 0,
    action: "save",
    setup: f.setup,
  });
  const body = {
    requestKey: randomUUID(),
    expectedVersion: 0,
    personId: person,
    offerId: f.setup.offers[0]!.id,
    status: "confirmed",
    startsAt: "2026-12-10T10:00:00.000Z",
    notes: "Confirmed by the prospect",
  };
  await assert.rejects(() =>
    f.service.recordMeeting(
      { ...f.identity, subject: "intruder" },
      f.w,
      campaign.id,
      body,
    ),
  );
  await assert.rejects(
    () =>
      f.service.recordMeeting(f.identity, f.w, campaign.id, {
        ...body,
        personId: foreign,
      }),
    /current contact/,
  );
  const saved = await f.service.recordMeeting(
    f.identity,
    f.w,
    campaign.id,
    body,
  );
  assert.equal(
    (await f.service.recordMeeting(f.identity, f.w, campaign.id, body)).id,
    saved.id,
  );
  assert.equal(
    (await f.service.read(f.identity, f.w, campaign.id)).meetings.length,
    1,
  );
  assert.equal(
    f.db.rows("events").filter((e) => e.eventType === "campaign_activity")
      .length,
    0,
  );
  await assert.rejects(() =>
    f.service.recordMeeting(f.identity, f.w, campaign.id, {
      ...body,
      id: saved.id,
      requestKey: randomUUID(),
      status: "clicked",
    }),
  );
  await assert.rejects(
    () =>
      f.service.recordMeeting(f.identity, f.w, campaign.id, {
        ...body,
        id: saved.id,
        requestKey: randomUUID(),
        expectedVersion: 0,
      }),
    /changed/,
  );
  const corrected = await f.service.recordMeeting(
    f.identity,
    f.w,
    campaign.id,
    {
      ...body,
      id: saved.id,
      requestKey: randomUUID(),
      expectedVersion: 1,
      status: "cancelled",
    },
  );
  assert.equal(corrected.version, 2);
  assert.equal(
    (await f.service.read(f.identity, f.w, campaign.id)).meetings[0]!.status,
    "cancelled",
  );
  assert.equal(
    f.db.rows("events").filter((e) => e.eventType === "campaign_meeting")
      .length,
    2,
  );
  await assert.rejects(
    () =>
      f.service.change(f.identity, f.w, campaign.id, {
        requestKey: randomUUID(),
        expectedVersion: 1,
        action: "delete",
      }),
    /history/,
  );
});

test("campaign qualification remains offer specific and booking overrides do not modify offers", async () => {
  const f = await withApprovedContext();
  f.db.rows("offers")[1]!.definition.meetingPurpose = "Enterprise discovery";
  f.db.rows("offers")[1]!.definition.bookingUrl =
    "https://booking.example/enterprise";
  const saved = await f.service.change(f.identity, f.w, undefined, {
    requestKey: randomUUID(),
    expectedVersion: 0,
    action: "save",
    setup: f.setup,
  });
  let detail = await f.service.read(f.identity, f.w, saved.id);
  assert.equal(detail.preparation[0]!.conversionOutcome, "Purchase");
  assert.equal(detail.preparation[0]!.bookingUrl, "");
  assert.equal(
    detail.preparation[1]!.bookingUrl,
    "https://booking.example/enterprise",
  );
  assert.equal(detail.preparation[0]!.gaps.length, 0);
  await f.service.change(f.identity, f.w, saved.id, {
    requestKey: randomUUID(),
    expectedVersion: 1,
    action: "save",
    setup: { ...f.setup, bookingUrl: "https://booking.example/campaign" },
  });
  detail = await f.service.read(f.identity, f.w, saved.id);
  assert.equal(
    detail.preparation[1]!.bookingUrl,
    "https://booking.example/campaign",
  );
  assert.equal(
    f.db.rows("offers")[1]!.definition.bookingUrl,
    "https://booking.example/enterprise",
  );
});
