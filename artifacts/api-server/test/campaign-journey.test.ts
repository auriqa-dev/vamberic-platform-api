import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { campaignTrackedUrl } from "../src/services/campaigns/tracking";
import { createCampaignService } from "../src/services/campaigns/service";
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
    brand = generatePlatformId("brand");
  const user = {
    subject: "journey-client",
    issuer: testIssuer,
    clientId: "hvmclient",
  };
  db.rows("schema_versions").push({ _id: "vapp-v1", version: 29 });
  await provisionHvmClient(
    db.mongo,
    {
      organisationId: generatePlatformId("org"),
      organisationName: "Client",
      workspaceId: w,
      management: "client",
      brandId: brand,
      clientMembershipId: generatePlatformId("workspacemembership"),
      workspaceName: "Client",
      brandName: "Client",
      brandSlug: "client",
      human: { type: "human", id: user.subject, issuer: user.issuer },
    },
    testIssuer,
  );
  const service = createCampaignService(config, db.mongo);
  const campaign = await service.change(user, w, undefined, {
    requestKey: randomUUID(),
    expectedVersion: 0,
    action: "save",
    setup: {
      name: "Free account",
      objective: "Grow free accounts",
      brandId: brand,
      products: [],
      offers: [],
      audiences: [],
      source: "existing",
      researchPriority: "",
      urls: [],
      channels: ["email"],
      goal: "Free signups",
      target: null,
      owner: "Marketing",
      timezone: "Europe/London",
      startDate: "",
      endDate: "",
      schedule: "",
      assetIds: [],
      contentRecordIds: [],
      overlapPolicy: "",
    },
  });
  return { db, w, user, service, campaign };
}
test("tracking replaces conflicting tags, preserves destination and isolates tests", () => {
  const url = new URL(
    campaignTrackedUrl(
      "https://client.example/start?plan=free&utm_campaign=old&UTM_ID=other#form",
      "campaign_abc",
      "email_123",
    ),
  );
  assert.equal(url.searchParams.get("plan"), "free");
  assert.equal(url.hash, "#form");
  assert.equal(url.searchParams.get("utm_id"), "campaign_abc");
  assert.equal(url.searchParams.get("UTM_ID"), null);
  assert.equal(
    campaignTrackedUrl(url.href, "campaign_abc", "email_123"),
    url.href,
  );
  const qa = new URL(
    campaignTrackedUrl(url.href, "campaign_abc", "email_123", true),
  );
  assert.equal(qa.searchParams.get("utm_id"), "test_campaign_abc");
  assert.throws(
    () => campaignTrackedUrl("javascript:alert(1)", "campaign", "email"),
    /HTTP/,
  );
  assert.throws(
    () =>
      campaignTrackedUrl(
        "https://secret:password@example.com",
        "campaign",
        "email",
      ),
    /HTTP/,
  );
});
test("client can save and resume preparation; retry is idempotent and never queues", async () => {
  const f = await fixture();
  const input = {
    requestKey: randomUUID(),
    expectedVersion: 0,
    campaignVersion: 1,
    action: "save",
    excludedOrganisations: ["An excluded client"],
    recipients: [],
    reason: "Review preparation",
  };
  const first = await f.service.saveJourney(f.user, f.w, f.campaign.id, input);
  assert.equal(first.version, 1);
  assert.equal(first.status, "draft");
  assert.equal(
    (await f.service.saveJourney(f.user, f.w, f.campaign.id, input)).version,
    1,
  );
  assert.equal(
    f.db.rows("events").filter((e) => e.eventType === "communication").length,
    0,
  );
  assert.equal(f.db.rows("campaigns")[0].status, "draft");
  await assert.rejects(
    () =>
      f.service.saveJourney(f.user, f.w, f.campaign.id, {
        ...input,
        requestKey: randomUUID(),
      }),
    /changed/,
  );
  await assert.rejects(
    () =>
      f.service.saveJourney(f.user, f.w, f.campaign.id, {
        ...input,
        excludedOrganisations: [],
      }),
    /Request changed/,
  );
});
test("launch requires explicit current review and readiness; another tenant cannot inspect or mutate", async () => {
  const f = await fixture();
  const review = await f.service.journey(f.user, f.w, f.campaign.id);
  const input = {
    requestKey: randomUUID(),
    expectedVersion: 0,
    campaignVersion: 1,
    action: "approve_launch",
    reason: "Review",
  };
  await assert.rejects(
    () => f.service.saveJourney(f.user, f.w, f.campaign.id, input),
    /explicitly confirm/,
  );
  await assert.rejects(
    () =>
      f.service.saveJourney(f.user, f.w, f.campaign.id, {
        ...input,
        confirmed: true,
        reviewFingerprint: review.reviewFingerprint,
      }),
    /approved product|approve campaign|recipient/,
  );
  const other = { ...f.user, subject: "other-client" };
  await assert.rejects(() => f.service.journey(other, f.w, f.campaign.id));
  await assert.rejects(() =>
    f.service.saveJourney(other, f.w, f.campaign.id, {
      ...input,
      action: "save",
    }),
  );
  assert.equal(
    f.db.rows("events").filter((e) => e.eventType === "campaign_journey")
      .length,
    0,
  );
});

test("recipient review is tenant scoped, excludes named organisations, and cannot override restrictions", async () => {
  const f = await fixture(),
    person = generatePlatformId("person"),
    point = generatePlatformId("contact"),
    org = generatePlatformId("org");
  f.db.rows("people").push({
    id: person,
    workspaceId: f.w,
    name: "Taylor Example",
    updatedAt: new Date(),
  });
  f.db.rows("contact_points").push({
    id: point,
    workspaceId: f.w,
    personId: person,
    type: "email",
    value: "taylor@example.com",
    updatedAt: new Date(),
  });
  f.db
    .rows("organisations")
    .push({ id: org, workspaceId: f.w, name: "Excluded Organisation" });
  f.db.rows("organisation_relationships").push({
    id: "relationship",
    workspaceId: f.w,
    personId: person,
    organisationId: org,
    current: true,
  });
  f.db.rows("events").push({
    id: "controls",
    workspaceId: f.w,
    eventType: "contact_context_changed",
    createdAt: new Date(),
    payload: { subjectId: person, controls: { lifecycle: "lead" } },
  });
  const candidates = await f.service.recipientCandidates(
    f.user,
    f.w,
    f.campaign.id,
    { search: "Taylor" },
  );
  assert.equal(candidates.items.length, 1);
  const c = candidates.items[0];
  const recipient = {
    personId: person,
    contactPointId: point,
    decision: "include",
    reason: "Role and fit reviewed",
    contextRevision: c.contextRevision,
    evidenceReview: {
      fit: "Role and company verified in source",
      communication: "Documented client communication basis",
      customer: "Account owner checked product ownership",
      conversations: "Contact history and sales owner reviewed",
    },
  };
  const body = {
    requestKey: randomUUID(),
    expectedVersion: 0,
    campaignVersion: 1,
    action: "save",
    excludedOrganisations: ["Excluded Organisation"],
    recipients: [recipient],
    reason: "Review",
  };
  await assert.rejects(
    () => f.service.saveJourney(f.user, f.w, f.campaign.id, body),
    /excluded/,
  );
  await assert.rejects(
    () =>
      f.service.saveJourney(f.user, f.w, f.campaign.id, {
        ...body,
        requestKey: randomUUID(),
        excludedOrganisations: [],
        recipients: [{ ...recipient, evidenceReview: undefined }],
      }),
    /communication basis/,
  );
  const saved = await f.service.saveJourney(f.user, f.w, f.campaign.id, {
    ...body,
    requestKey: randomUUID(),
    recipients: [{ ...recipient, decision: "exclude" }],
  });
  assert.equal(saved.recipients[0].decision, "exclude");
  await assert.rejects(
    () =>
      f.service.saveJourney(f.user, f.w, f.campaign.id, {
        ...body,
        requestKey: randomUUID(),
        expectedVersion: 1,
        excludedOrganisations: [],
        recipients: [{ ...recipient, contextRevision: "stale" }],
      }),
    /changed/,
  );
  assert.equal(
    (await f.service.journey(f.user, f.w, f.campaign.id)).version,
    1,
  );
});

test("campaign approval events cannot be forged through generic ingestion", async () => {
  const { EventInsertSchema } = await import("../src/domain");
  for (const eventType of ["campaign_setup", "campaign_journey"])
    assert.equal(
      EventInsertSchema.safeParse({
        workspaceId: generatePlatformId("workspace"),
        eventType,
        occurredAt: new Date().toISOString(),
        payload: { status: "approved" },
      }).success,
      false,
    );
});

test("launch approval is version bound, can be stopped, and never creates a delivery", async () => {
  const f = await fixture();
  const product = generatePlatformId("offering"),
    offer = generatePlatformId("offer"),
    icp = generatePlatformId("icp"),
    person = generatePlatformId("person"),
    point = generatePlatformId("contact");
  const brand = f.campaign.setup.brandId;
  f.db.rows("offerings").push({
    id: product,
    workspaceId: f.w,
    brandId: brand,
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
  f.db.rows("offers").push({
    id: offer,
    workspaceId: f.w,
    offeringId: product,
    approvedRevision: 1,
    status: "approved",
    revision: 1,
    definition: {
      name: "Free account",
      conversionOutcome: "Free signup",
      qualificationCriteria: ["Relevant need supported by evidence"],
    },
  });
  f.db.rows("offer_revisions").push({
    workspaceId: f.w,
    offerId: offer,
    revision: 1,
    snapshot: { name: "Free account" },
  });
  f.db.rows("ideal_customer_profiles").push({
    id: icp,
    workspaceId: f.w,
    offeringId: product,
    offer: { id: offer, revision: 1 },
    approvedRevision: 1,
    definition: { name: "Audience" },
  });
  f.db.rows("hive_definition_revisions").push({
    workspaceId: f.w,
    entityType: "ideal_customer_profiles",
    entityId: icp,
    revision: 1,
    snapshot: { name: "Audience" },
  });
  await f.service.change(f.user, f.w, f.campaign.id, {
    requestKey: randomUUID(),
    expectedVersion: 1,
    action: "save",
    setup: {
      ...f.campaign.setup,
      operatingMode: "engagement_management",
      products: [{ id: product, revision: 1 }],
      offers: [{ id: offer, revision: 1 }],
      audiences: [{ id: icp, revision: 1 }],
    },
  });
  await f.service.change(f.user, f.w, f.campaign.id, {
    requestKey: randomUUID(),
    expectedVersion: 2,
    action: "approve",
  });
  const { createContactStrategies } =
    await import("../src/services/contact-strategy/application");
  const policies = createContactStrategies(config, f.db.mongo),
    key = `custom_${randomUUID().replaceAll("-", "")}`;
  await policies.mutate(f.user, f.w, {
    key,
    name: "Reviewed audience",
    operation: "save",
    expectedVersion: 0,
    statement: "Only contact reviewed eligible recipients.",
  });
  await policies.mutate(f.user, f.w, {
    key,
    operation: "approve",
    expectedVersion: 1,
  });
  f.db.rows("people").push({
    id: person,
    workspaceId: f.w,
    name: "Reviewed person",
    updatedAt: new Date(),
  });
  f.db.rows("contact_points").push({
    id: point,
    workspaceId: f.w,
    personId: person,
    type: "email",
    value: "reviewed@example.com",
    updatedAt: new Date(),
  });
  f.db.rows("events").push({
    id: "controls",
    workspaceId: f.w,
    eventType: "contact_context_changed",
    createdAt: new Date(),
    payload: { subjectId: person, controls: { lifecycle: "lead" } },
  });
  f.db.rows("workspace_integrations").push({
    id: "mailbox",
    workspaceId: f.w,
    provider: "google_workspace",
    status: "connected",
    connectedAt: new Date(),
    externalAccountId: "sender@example.com",
  });
  f.db.rows("events").push({
    id: "email",
    workspaceId: f.w,
    eventType: "email_content_record",
    payload: {
      record: {
        id: "draft",
        version: 1,
        status: "approved",
        campaignId: f.campaign.id,
        campaignVersion: 3,
        contactId: person,
        content: { subject: "Reviewed email" },
      },
    },
  });
  const c = (
    await f.service.recipientCandidates(f.user, f.w, f.campaign.id, {})
  ).items[0];
  let j = await f.service.saveJourney(f.user, f.w, f.campaign.id, {
    requestKey: randomUUID(),
    expectedVersion: 0,
    campaignVersion: 3,
    action: "save",
    recipients: [
      {
        personId: person,
        contactPointId: point,
        decision: "include",
        reason: "Fit and context reviewed",
        contextRevision: c.contextRevision,
        evidenceReview: {
          fit: "Role and company verified in source",
          communication: "Documented client communication basis",
          customer: "Account owner checked product ownership",
          conversations: "Contact history and sales owner reviewed",
        },
      },
    ],
    reason: "Prepare",
  });
  assert.deepEqual(j.blockers, []);
  j = await f.service.saveJourney(f.user, f.w, f.campaign.id, {
    requestKey: randomUUID(),
    expectedVersion: j.version,
    campaignVersion: 3,
    action: "approve_launch",
    confirmed: true,
    reviewFingerprint: j.reviewFingerprint,
    reason: "Reviewed current audience and drafts",
  });
  assert.equal(j.status, "approved");
  const { assertCampaignLaunch } =
    await import("../src/services/campaigns/journey");
  await assertCampaignLaunch(f.db as never, f.w, f.campaign.id, person, point);
  await assert.rejects(
    () =>
      assertCampaignLaunch(
        f.db as never,
        f.w,
        f.campaign.id,
        person,
        "different-address",
      ),
    /recipient/,
  );
  f.db.rows("events").push({
    id: "sent",
    workspaceId: f.w,
    personId: person,
    eventType: "email",
    occurredAt: new Date(),
    updatedAt: new Date(),
    interaction: {
      subject: "Sent email",
      details: { direction: "outbound" },
    },
  });
  assert.equal(
    (await f.service.journey(f.user, f.w, f.campaign.id)).status,
    "approved",
  );
  f.db.rows("people")[0].title = "Changed role";
  assert.equal(
    (await f.service.journey(f.user, f.w, f.campaign.id)).status,
    "review_required",
  );
  await assert.rejects(
    () =>
      assertCampaignLaunch(f.db as never, f.w, f.campaign.id, person, point),
    /launch/,
  );
  const stopped = await f.service.saveJourney(f.user, f.w, f.campaign.id, {
    requestKey: randomUUID(),
    expectedVersion: j.version,
    campaignVersion: 3,
    action: "stop",
    reason: "Stop requested",
  });
  assert.equal(stopped.status, "stopped");
  assert.equal(
    f.db.rows("events").filter((e) => e.eventType === "communication").length,
    0,
  );
});

test("large preparation is chunked without relaxing event bounds and corrupt recovery fails closed", async () => {
  const f = await fixture();
  const exclusions = Array.from(
    { length: 150 },
    (_, i) => `Organisation ${i} ${"x".repeat(170)}`,
  );
  const r = await f.service.saveJourney(f.user, f.w, f.campaign.id, {
    requestKey: randomUUID(),
    expectedVersion: 0,
    campaignVersion: 1,
    action: "save",
    excludedOrganisations: exclusions,
    recipients: [],
    reason: "Reviewed exclusions",
  });
  assert.deepEqual(r.excludedOrganisations, exclusions);
  const parts = f.db
    .rows("events")
    .filter((e) => e.eventType === "campaign_journey_part");
  assert.ok(parts.length > 1);
  assert.ok(parts.every((p) => JSON.stringify(p.payload).length < 16384));
  parts[0].payload.text = "corrupt";
  await assert.rejects(
    () => f.service.journey(f.user, f.w, f.campaign.id),
    /verified/,
  );
});

test("recipient approval requires all evidence checks; old reviews remain readable but incomplete", async () => {
  const { journeyRecipient, recipientReviewGaps } =
    await import("../src/services/campaigns/journey");
  const legacy = journeyRecipient.parse({
    personId: "person",
    contactPointId: "point",
    decision: "include",
    reason: "Old review",
    contextRevision: "old",
  });
  assert.equal(recipientReviewGaps(legacy.evidenceReview).length, 4);
  assert.equal(
    recipientReviewGaps({
      fit: "source",
      communication: "  ",
      customer: "source",
      conversations: "source",
    }).length,
    1,
  );
  assert.equal(
    recipientReviewGaps({
      fit: "source",
      communication: "basis",
      customer: "source",
      conversations: "source",
    }).length,
    0,
  );
  assert.equal(
    journeyRecipient.safeParse({
      ...legacy,
      evidenceReview: {
        fit: "source",
        communication: "basis",
        customer: "source",
        conversations: "source",
        approved: true,
      },
    }).success,
    false,
  );
});
