import assert from "node:assert/strict";
import { test } from "node:test";
import type { Db } from "mongodb";
import {
  PersonSchema,
  OrganisationSchema,
  OpportunitySchema,
  ContactPointSchema,
  ProductRelationshipSchema,
  EventSchema,
  CrmWorkspaceSchema,
  CrmLeadSchema,
  CampaignSchema,
  CrmTaskSchema,
  CrmPipelineSchema,
  ExternalReferenceSchema,
  generatePlatformId,
  normalizeOrganisationDomain,
  resolveEffectiveMarketingPermission,
  isTaskOverdue,
} from "../src/domain";
import {
  createCrmRecord,
  updateCrmRecord,
  observeCrmField,
  validateCrmReferences,
} from "../src/services/crm-foundation";
import { previewCrmDelete } from "../src/services/crm-delete";
import { EnquiryMemoryDb } from "./helpers/enquiry-db";
const human = { type: "human", id: "operator" };
const integration = { type: "integration", id: "provider" };
const now = new Date("2026-09-26T00:00:00Z");
const dates = { createdAt: now, updatedAt: now };
const product = generatePlatformId("product");
const person = generatePlatformId("person");
const org = generatePlatformId("org");
function dbFixture() {
  const db = new EnquiryMemoryDb();
  db.rows("products").push({ id: product });
  db.rows("people").push(
    PersonSchema.parse({ ...dates, id: person, firstName: "Example" }),
  );
  db.rows("organisations").push(
    OrganisationSchema.parse({
      ...dates,
      id: org,
      name: "Example",
      type: "prospect",
    }),
  );
  return db;
}
test("legacy people, organisations and relationships remain valid with unknown qualification and permission", () => {
  const db = dbFixture();
  const relation = ProductRelationshipSchema.parse({
    ...dates,
    id: generatePlatformId("prodrel"),
    productId: product,
    personId: person,
    status: "prospect",
  });
  assert.equal(relation.salesLifecycleStage, undefined);
  assert.equal(relation.leadStatus, undefined);
  assert.equal(
    PersonSchema.parse(db.rows("people")[0]).preferredLanguage,
    undefined,
  );
  assert.equal(
    resolveEffectiveMarketingPermission([], {
      personId: person,
      productId: product,
      channel: "email",
      purpose: "marketing",
    }),
    undefined,
  );
});
test("new profile types, URLs, language/timezone and money require explicit valid values", () => {
  const base = { ...dates, id: org, name: "Example", type: "prospect" };
  for (const annualRevenue of [
    { amountMinor: 100 },
    { amountMinor: -1, currency: "GBP", observedAt: now },
    { amountMinor: 0.5, currency: "GBP", observedAt: now },
    { amountMinor: 100, currency: "ZZZ", observedAt: now },
    { amountMinor: 100, currency: "GBP", observedAt: "yesterday" },
  ])
    assert.equal(
      OrganisationSchema.safeParse({ ...base, annualRevenue }).success,
      false,
    );
  assert.equal(
    OrganisationSchema.parse({
      ...base,
      annualRevenue: { amountMinor: 100, currency: "GBP", observedAt: now },
    }).annualRevenue?.amountMinor,
    100,
  );
  assert.equal(
    PersonSchema.safeParse({
      ...dates,
      id: person,
      firstName: "A",
      timezone: "made/up",
    }).success,
    false,
  );
  assert.equal(
    PersonSchema.safeParse({
      ...dates,
      id: person,
      firstName: "A",
      socialProfiles: [{ network: "other", url: "javascript:alert(1)" }],
    }).success,
    false,
  );
  assert.equal(
    OrganisationSchema.safeParse({
      ...base,
      website: "https://user:secret@example.com",
    }).success,
    false,
  );
});
test("shared contact values and domains remain allowed; domain normalization is explicit", async () => {
  const db = dbFixture();
  const other = generatePlatformId("person");
  db.rows("people").push({ ...dates, id: other, firstName: "Other" });
  for (const personId of [person, other])
    await createCrmRecord(
      db.mongo,
      "contact_points",
      {
        personId,
        type: "email",
        value: "SHARED@example.com",
        normalizedValue: "shared@example.com",
        primary: true,
      },
      human,
    );
  assert.equal(
    ContactPointSchema.safeParse({
      ...dates,
      id: generatePlatformId("contact"),
      personId: person,
      type: "email",
      value: "SHARED@example.com",
      normalizedValue: "SHARED@example.com",
    }).success,
    false,
  );
  assert.equal(normalizeOrganisationDomain(" Example.COM. "), "example.com");
  for (let i = 0; i < 2; i++)
    await createCrmRecord(
      db.mongo,
      "organisations",
      { name: "Shared", type: "prospect", normalizedDomain: "example.com" },
      human,
    );
  await assert.rejects(
    createCrmRecord(
      db.mongo,
      "contact_points",
      {
        personId: person,
        type: "email",
        value: "second@example.com",
        normalizedValue: "second@example.com",
        primary: true,
      },
      human,
    ),
  );
});
test("pipelines require unique stages/order/probability and enforce same-product opportunity stages and buying roles", async () => {
  const db = dbFixture();
  const pipeline = await createCrmRecord(
    db.mongo,
    "crm_pipelines",
    {
      productId: product,
      name: "Sales",
      stages: [
        {
          id: "discovery",
          label: "Discovery",
          order: 0,
          status: "open",
          probability: 0.2,
        },
      ],
    },
    human,
  );
  for (const stages of [
    [...pipeline.stages, ...pipeline.stages],
    [{ ...pipeline.stages[0], probability: 2 }],
  ])
    assert.equal(
      CrmPipelineSchema.safeParse({ ...pipeline, stages }).success,
      false,
    );
  const base = {
    productId: product,
    organisationId: org,
    personIds: [person],
    name: "Deal",
    stage: "discovery",
    status: "open",
    pipelineId: pipeline.id,
  };
  const opportunity = await createCrmRecord(
    db.mongo,
    "opportunities",
    { ...base, buyingRoles: [{ personId: person, role: "champion" }] },
    human,
  );
  await assert.rejects(
    createCrmRecord(
      db.mongo,
      "opportunities",
      { ...base, stage: "missing" },
      human,
    ),
  );
  await assert.rejects(
    createCrmRecord(
      db.mongo,
      "opportunities",
      { ...base, status: "won" },
      human,
    ),
  );
  assert.equal(
    OpportunitySchema.safeParse({
      ...opportunity,
      buyingRoles: [
        { personId: generatePlatformId("person"), role: "champion" },
      ],
    }).success,
    false,
  );
  await assert.rejects(
    updateCrmRecord(
      db.mongo,
      "crm_pipelines",
      pipeline.id,
      pipeline.updatedAt,
      {
        stages: [{ id: "different", label: "Other", order: 1, status: "open" }],
      },
      human,
    ),
  );
  const other = generatePlatformId("product");
  db.rows("products").push({ id: other });
  await assert.rejects(
    createCrmRecord(
      db.mongo,
      "opportunities",
      { ...base, productId: other },
      human,
    ),
  );
  await createCrmRecord(
    db.mongo,
    "opportunities",
    {
      productId: product,
      organisationId: org,
      name: "Legacy",
      stage: "free text",
      status: "open",
    },
    human,
  );
});
test("external mappings require account identity, target type/existence and reject duplicates within an account", async () => {
  const db = dbFixture();
  const mapping = {
    provider: "hubspot",
    providerAccountId: "portal-a",
    objectType: "contact",
    externalId: "123",
    entityType: "people",
    entityId: person,
  };
  const saved = await createCrmRecord(
    db.mongo,
    "external_references",
    mapping,
    integration,
  );
  await assert.rejects(
    createCrmRecord(db.mongo, "external_references", mapping, integration),
  );
  await createCrmRecord(
    db.mongo,
    "external_references",
    { ...mapping, providerAccountId: "portal-b" },
    integration,
  );
  for (const providerAccountId of [undefined, null, ""])
    assert.equal(
      ExternalReferenceSchema.safeParse({ ...saved, providerAccountId })
        .success,
      false,
    );
  await assert.rejects(
    createCrmRecord(
      db.mongo,
      "external_references",
      { ...mapping, externalId: "456", entityId: generatePlatformId("person") },
      integration,
    ),
  );
  await assert.rejects(
    createCrmRecord(
      db.mongo,
      "external_references",
      { ...mapping, externalId: "456", entityId: org },
      integration,
    ),
  );
});
test("observations stay separate, human/existing values win, unknown fields survive CAS updates", async () => {
  const db = dbFixture();
  db.rows("people")[0].legacyUnknown = { keep: true };
  const evidence = {
    field: "title",
    value: "Unverified title",
    provider: "provider",
    sourceReference: "observation-1",
    observedAt: now,
    verification: "observed" as const,
    confidence: 0.8,
  };
  const observed = await observeCrmField(
    db.mongo,
    "people",
    person,
    now,
    evidence,
    integration,
  );
  assert.equal(observed.title, undefined);
  const verified = await observeCrmField(
    db.mongo,
    "people",
    person,
    observed.updatedAt,
    { ...evidence, value: "Verified title", verification: "human_verified" },
    human,
  );
  const retained = await observeCrmField(
    db.mongo,
    "people",
    person,
    verified.updatedAt,
    { ...evidence, value: "Vendor title", verification: "provider_verified" },
    integration,
  );
  assert.equal(retained.title, "Verified title");
  assert.equal(retained.fieldEvidence.length, 3);
  assert.deepEqual(db.rows("people")[0].legacyUnknown, { keep: true });
  await assert.rejects(
    updateCrmRecord(
      db.mongo,
      "people",
      person,
      retained.updatedAt,
      { title: "Override" },
      integration,
    ),
  );
  await assert.rejects(
    updateCrmRecord(db.mongo, "people", person, now, { title: "Stale" }, human),
  );
  await assert.rejects(
    updateCrmRecord(
      db.mongo,
      "people",
      person,
      retained.updatedAt,
      { fieldEvidence: [] },
      human,
    ),
  );
  await assert.rejects(
    observeCrmField(
      db.mongo,
      "people",
      person,
      retained.updatedAt,
      { ...evidence, verification: "human_verified" },
      integration,
    ),
  );
  await assert.rejects(
    observeCrmField(
      db.mongo,
      "people",
      person,
      retained.updatedAt,
      { ...evidence, field: "constructor.prototype" },
      integration,
    ),
  );
  await assert.rejects(
    updateCrmRecord(
      db.mongo,
      "people",
      person,
      retained.updatedAt,
      { email: "duplicate@example.com" },
      human,
    ),
  );
});
test("events/tasks enforce subjects, details and product consistency; overdue is derived", async () => {
  const db = dbFixture();
  const base = {
    eventType: "note",
    occurredAt: now,
    interaction: { subject: "Note", actor: human, details: { type: "note" } },
    personIds: [person],
  };
  const activity = await createCrmRecord(db.mongo, "events", base, human);
  assert.equal(
    EventSchema.safeParse({
      ...activity,
      interaction: {
        ...activity.interaction,
        details: { type: "call", direction: "outbound", outcome: "connected" },
      },
    }).success,
    false,
  );
  assert.equal(
    EventSchema.safeParse({ ...activity, personIds: [] }).success,
    false,
  );
  assert.equal(
    EventSchema.safeParse({
      ...activity,
      eventType: "meeting",
      interaction: {
        ...activity.interaction,
        details: { type: "meeting", startsAt: now, endsAt: new Date(0) },
      },
    }).success,
    false,
  );
  const task = await createCrmRecord(
    db.mongo,
    "crm_tasks",
    {
      title: "Follow up",
      type: "follow_up",
      status: "pending",
      personId: person,
      dueAt: now,
    },
    human,
  );
  assert.equal(
    isTaskOverdue(CrmTaskSchema.parse(task), new Date(now.getTime() + 1)),
    true,
  );
  assert.equal(
    CrmTaskSchema.safeParse({ ...task, status: "completed" }).success,
    false,
  );
  await assert.rejects(
    createCrmRecord(
      db.mongo,
      "crm_tasks",
      { title: "No subject", type: "other", status: "pending" },
      human,
    ),
  );
  const opportunity = await createCrmRecord(
    db.mongo,
    "opportunities",
    {
      productId: product,
      organisationId: org,
      personIds: [person],
      name: "Deal",
      stage: "legacy",
      status: "open",
    },
    human,
  );
  const other = generatePlatformId("product");
  db.rows("products").push({ id: other });
  await assert.rejects(
    validateCrmReferences(db as unknown as Db, "crm_tasks", {
      ...task,
      productId: other,
      opportunityId: opportunity.id,
    }),
  );
});
test("new history, external mappings, parent organisations and contact/employment links block hard deletion", async () => {
  for (const collection of [
    "events",
    "crm_tasks",
    "external_references",
  ] as const) {
    const db = dbFixture();
    if (collection === "events")
      await createCrmRecord(
        db.mongo,
        collection,
        {
          eventType: "note",
          personIds: [person],
          occurredAt: now,
          interaction: {
            subject: "History",
            actor: human,
            details: { type: "note" },
          },
        },
        human,
      );
    if (collection === "crm_tasks")
      await createCrmRecord(
        db.mongo,
        collection,
        {
          title: "History",
          type: "other",
          status: "pending",
          personId: person,
        },
        human,
      );
    if (collection === "external_references")
      await createCrmRecord(
        db.mongo,
        collection,
        {
          provider: "hubspot",
          providerAccountId: "portal",
          objectType: "contact",
          externalId: "1",
          entityType: "people",
          entityId: person,
        },
        human,
      );
    const plan = await previewCrmDelete(db.mongo, "person", person);
    assert.ok(plan.blockedBy.some((b) => b.collection === collection));
  }
  const db = dbFixture();
  await createCrmRecord(
    db.mongo,
    "organisations",
    { name: "Child", type: "prospect", parentOrganisationId: org },
    human,
  );
  assert.ok(
    (await previewCrmDelete(db.mongo, "organisation", org)).blockedBy.some(
      (b) => b.code === "CHILD_ORGANISATION",
    ),
  );
  const employment = await createCrmRecord(
    db.mongo,
    "organisation_relationships",
    { personId: person, organisationId: org, current: true },
    human,
  );
  await createCrmRecord(
    db.mongo,
    "contact_points",
    {
      personId: person,
      type: "phone",
      value: "+44 123",
      normalizedValue: "+44123",
      organisationRelationshipId: employment.id,
    },
    human,
  );
  assert.ok(
    (await previewCrmDelete(db.mongo, "organisation", org)).blockedBy.some(
      (b) => b.code === "RETAINED_EMPLOYMENT_CONTACT",
    ),
  );
});

test("product qualification is scoped per relationship; campaign attribution cannot cross products", async () => {
  const db = dbFixture();
  const other = generatePlatformId("product");
  db.rows("products").push({ id: other });
  const campaign = generatePlatformId("campaign");
  db.rows("campaigns").push({ id: campaign, productId: other });
  const first = await createCrmRecord(
    db.mongo,
    "product_relationships",
    {
      productId: product,
      personId: person,
      status: "prospect",
      salesLifecycleStage: "qualified",
      icpTier: "tier_1",
    },
    human,
  );
  const second = await createCrmRecord(
    db.mongo,
    "product_relationships",
    { productId: other, personId: person, status: "prospect" },
    human,
  );
  assert.equal(first.salesLifecycleStage, "qualified");
  assert.equal(second.salesLifecycleStage, undefined);
  await assert.rejects(
    createCrmRecord(
      db.mongo,
      "product_relationships",
      {
        productId: product,
        personId: person,
        status: "prospect",
        firstAttribution: {
          channel: "email",
          observedAt: now,
          campaignId: campaign,
        },
      },
      human,
    ),
  );
});
test("canonical patches retain contact identity and referenced activity people", async () => {
  const db = dbFixture();
  const contact = await createCrmRecord(
    db.mongo,
    "contact_points",
    {
      personId: person,
      type: "email",
      value: "first@example.com",
      normalizedValue: "first@example.com",
    },
    human,
  );
  await assert.rejects(
    updateCrmRecord(
      db.mongo,
      "contact_points",
      contact.id,
      contact.updatedAt,
      { value: "second@example.com", normalizedValue: "second@example.com" },
      human,
    ),
  );
  const opportunity = await createCrmRecord(
    db.mongo,
    "opportunities",
    {
      productId: product,
      organisationId: org,
      personIds: [person],
      name: "Deal",
      stage: "legacy",
      status: "open",
    },
    human,
  );
  await createCrmRecord(
    db.mongo,
    "events",
    {
      eventType: "note",
      opportunityId: opportunity.id,
      personIds: [person],
      occurredAt: now,
      interaction: { subject: "Note", actor: human, details: { type: "note" } },
    },
    human,
  );
  await assert.rejects(
    updateCrmRecord(
      db.mongo,
      "opportunities",
      opportunity.id,
      opportunity.updatedAt,
      { personIds: [] },
      human,
    ),
  );
});
test("public enquiry input rejects enrichment and qualification mass assignment", async () => {
  const { PublicEnquirySchema } = await import("../src/domain/public-enquiry");
  const enquiry = {
    firstName: "Example",
    lastName: "Contact",
    workEmail: "example@example.com",
    company: "Example",
    message: "Enquiry",
  };
  assert.equal(PublicEnquirySchema.safeParse(enquiry).success, true);
  for (const field of [
    "owner",
    "salesLifecycleStage",
    "fieldEvidence",
    "annualRevenue",
    "pipelineId",
  ])
    assert.equal(
      PublicEnquirySchema.safeParse({ ...enquiry, [field]: "injected" })
        .success,
      false,
    );
});

test("nested patches preserve known siblings and unknown legacy fields", async () => {
  const db = dbFixture();
  db.rows("organisations")[0].size = {
    employees: 1,
    band: "small",
    legacyNested: "keep",
  };
  const updated = await updateCrmRecord(
    db.mongo,
    "organisations",
    org,
    now,
    { size: { employees: 2 } },
    human,
  );
  assert.equal(updated.size.band, "small");
  assert.deepEqual(db.rows("organisations")[0].size, {
    employees: 2,
    band: "small",
    legacyNested: "keep",
  });
  await observeCrmField(
    db.mongo,
    "organisations",
    org,
    updated.updatedAt,
    {
      field: "size.employees",
      value: 3,
      provider: "provider",
      sourceReference: "observation",
      observedAt: now,
      verification: "provider_verified",
    },
    integration,
  );
  assert.deepEqual(db.rows("organisations")[0].size, {
    employees: 2,
    band: "small",
    legacyNested: "keep",
  });
});

test("events are the only append-only interaction stream; legacy events stay valid", async () => {
  const db = dbFixture();
  const event = await createCrmRecord(
    db.mongo,
    "events",
    {
      eventType: "form_submission",
      occurredAt: now,
      personId: person,
      payload: { form: "example" },
    },
    human,
  );
  await assert.rejects(
    updateCrmRecord(
      db.mongo,
      "events",
      event.id,
      event.updatedAt,
      { payload: { form: "changed" } },
      human,
    ),
    /append-only/,
  );
  const task = await createCrmRecord(
    db.mongo,
    "crm_tasks",
    {
      title: "Call",
      type: "call",
      status: "pending",
      productId: product,
      personId: person,
    },
    human,
  );
  const otherProduct = generatePlatformId("product");
  db.rows("products").push({ id: otherProduct });
  await assert.rejects(
    validateCrmReferences(db as unknown as Db, "events", {
      ...event,
      taskId: task.id,
      productId: otherProduct,
    }),
  );
  assert.equal(db.rows("events").length, 1);
  assert.equal(db.rows("crm_activities").length, 0);
  assert.ok(EventSchema.safeParse(event).success);
});

test("workspace ownership is independent of product and cross-workspace links fail closed", async () => {
  const db = dbFixture();
  const workspaceId = generatePlatformId("workspace");
  const otherWorkspace = generatePlatformId("workspace");
  const workspace = CrmWorkspaceSchema.parse({
    ...dates,
    id: workspaceId,
    name: "Client A",
    kind: "client",
    clientOrganisationId: org,
  });
  db.rows("crm_workspaces").push(workspace, {
    ...workspace,
    id: otherWorkspace,
  });
  const clientPerson = {
    ...db.rows("people")[0],
    id: generatePlatformId("person"),
    workspaceId,
  };
  const clientOrg = {
    ...db.rows("organisations")[0],
    id: generatePlatformId("org"),
    workspaceId,
  };
  db.rows("people").push(clientPerson);
  db.rows("organisations").push(clientOrg);
  const lead = CrmLeadSchema.parse({
    ...dates,
    id: generatePlatformId("lead"),
    workspaceId,
    personId: clientPerson.id,
    leadStatus: "new",
  });
  await validateCrmReferences(db as unknown as Db, "crm_leads", lead);
  await assert.rejects(
    validateCrmReferences(db as unknown as Db, "crm_leads", {
      ...lead,
      workspaceId: otherWorkspace,
    }),
  );
  await assert.rejects(
    validateCrmReferences(db as unknown as Db, "crm_leads", {
      ...lead,
      personId: person,
    }),
  );
  const pipeline = CrmPipelineSchema.parse({
    ...dates,
    id: generatePlatformId("pipeline"),
    workspaceId,
    name: "Client-defined",
    stages: [{ id: "review", label: "Review", order: 0, status: "open" }],
  });
  db.rows("crm_pipelines").push(pipeline);
  const opportunity = OpportunitySchema.parse({
    ...dates,
    id: generatePlatformId("opportunity"),
    workspaceId,
    organisationId: clientOrg.id,
    personIds: [clientPerson.id],
    pipelineId: pipeline.id,
    name: "Client deal",
    status: "open",
    stage: "review",
  });
  await validateCrmReferences(
    db as unknown as Db,
    "opportunities",
    opportunity,
  );
  await assert.rejects(
    updateCrmRecord(
      db.mongo,
      "crm_workspaces",
      workspaceId,
      now,
      { kind: "portfolio" },
      human,
    ),
    /ownership cannot be reassigned/,
  );
  // One client-wide pipeline can support multiple optional portfolio Products.
  await validateCrmReferences(db as unknown as Db, "opportunities", {
    ...opportunity,
    productId: product,
  });
  assert.ok(
    CampaignSchema.safeParse({
      ...dates,
      id: generatePlatformId("campaign"),
      workspaceId,
      name: "Client campaign",
      type: "marketing",
      channel: "email",
      status: "draft",
    }).success,
  );
  assert.equal(
    OpportunitySchema.safeParse({ ...opportunity, workspaceId: undefined })
      .success,
    false,
  );
  await assert.rejects(
    createCrmRecord(
      db.mongo,
      "people",
      { workspaceId, firstName: "Blocked" },
      human,
    ),
    /authorization boundary/,
  );
  await assert.rejects(
    updateCrmRecord(
      db.mongo,
      "people",
      clientPerson.id,
      now,
      { firstName: "Blocked" },
      human,
    ),
    /authorization boundary/,
  );
  await assert.rejects(
    previewCrmDelete(db.mongo, "person", clientPerson.id),
    /not found/i,
  );
  assert.ok(
    (await previewCrmDelete(db.mongo, "organisation", org)).blockedBy.some(
      (b) => b.code === "CLIENT_WORKSPACE",
    ),
  );
});

test("external identity uniqueness includes workspace and provider account without provider-specific canonical fields", async () => {
  const db = dbFixture();
  const collection = db.collection("external_references");
  const mapping = {
    provider: "hubspot",
    providerAccountId: "portal",
    objectType: "contact",
    externalId: "7",
    entityType: "people",
    entityId: person,
  };
  const a = ExternalReferenceSchema.parse({
    ...dates,
    id: generatePlatformId("externalref"),
    ...mapping,
    workspaceId: generatePlatformId("workspace"),
  });
  const b = {
    ...a,
    id: generatePlatformId("externalref"),
    workspaceId: generatePlatformId("workspace"),
  };
  await collection.insertOne(a);
  await collection.insertOne(b);
  await assert.rejects(
    collection.insertOne({ ...a, id: generatePlatformId("externalref") }),
  );
  for (const provider of [
    "lusha",
    "paddle",
    "linkedin",
    "marketplace",
    "other-system",
  ])
    assert.ok(ExternalReferenceSchema.safeParse({ ...a, provider }).success);
});

test("canonical index set defers unused queue indexes and removes the activity collection", async () => {
  const { COLLECTION_DEFINITIONS } = await import("../src/db/collections");
  assert.equal(COLLECTION_DEFINITIONS.length, 19);
  assert.equal(
    COLLECTION_DEFINITIONS.reduce((n, c) => n + c.indexes.length, 0),
    61,
  );
  assert.equal(
    COLLECTION_DEFINITIONS.some((c) => String(c.name) === "crm_activities"),
    false,
  );
  for (const name of [
    "crm_workspaces",
    "crm_leads",
    "crm_tasks",
    "crm_pipelines",
  ])
    assert.equal(
      COLLECTION_DEFINITIONS.find((c) => c.name === name)?.indexes.length,
      1,
    );
});

test("permission decisions do not cross workspace boundaries or imply portfolio permission", async () => {
  const { MarketingPermissionSchema } = await import("../src/domain");
  const workspaceId = generatePlatformId("workspace");
  const permission = MarketingPermissionSchema.parse({
    ...dates,
    id: generatePlatformId("permission"),
    workspaceId,
    personId: person,
    channel: "email",
    purpose: "marketing",
    lawfulBasis: "consent",
    permitted: true,
    effectiveAt: now,
  });
  const criteria = {
    personId: person,
    channel: "email",
    purpose: "marketing" as const,
  };
  assert.equal(
    resolveEffectiveMarketingPermission([permission], criteria, now),
    undefined,
  );
  assert.equal(
    resolveEffectiveMarketingPermission(
      [permission],
      { ...criteria, workspaceId: generatePlatformId("workspace") },
      now,
    ),
    undefined,
  );
  assert.equal(
    resolveEffectiveMarketingPermission(
      [permission],
      { ...criteria, workspaceId },
      now,
    )?.id,
    permission.id,
  );
  assert.equal(
    MarketingPermissionSchema.safeParse({ ...permission, portfolioWide: true })
      .success,
    false,
  );
});

test("agents and Queen are actors and task assignees, never CRM account owners", async () => {
  const db = dbFixture();
  const actors = [
    human,
    { type: "agent", id: "hvm-queen" },
    { type: "agent", id: "hvm-worker" },
    { type: "system", id: "hvm-system" },
  ];
  for (const actor of actors) {
    const event = await createCrmRecord(
      db.mongo,
      "events",
      {
        eventType: "agent_action_executed",
        occurredAt: now,
        personId: person,
        payload: { action: "review" },
      },
      actor,
    );
    assert.deepEqual(event.createdBy, actor);
    const task = await createCrmRecord(
      db.mongo,
      "crm_tasks",
      {
        title: "Review lead",
        type: "research",
        status: "pending",
        personId: person,
        assignedTo: actor,
      },
      human,
    );
    assert.deepEqual(task.assignedTo, actor);
    const lead = {
      ...dates,
      id: generatePlatformId("lead"),
      workspaceId: generatePlatformId("workspace"),
      personId: person,
      owner: actor,
    };
    const opportunity = {
      ...dates,
      id: generatePlatformId("opportunity"),
      productId: product,
      organisationId: org,
      name: "Review",
      stage: "enquiry",
      status: "open",
      owner: actor,
    };
    const relation = {
      ...dates,
      id: generatePlatformId("prodrel"),
      productId: product,
      personId: person,
      status: "prospect",
      owner: actor,
    };
    for (const [schema, record] of [
      [CrmLeadSchema, lead],
      [OpportunitySchema, opportunity],
      [ProductRelationshipSchema, relation],
    ] as const)
      assert.equal(schema.safeParse(record).success, actor.type === "human");
  }
  assert.ok(
    CrmLeadSchema.safeParse({
      ...dates,
      id: generatePlatformId("lead"),
      workspaceId: generatePlatformId("workspace"),
      personId: person,
    }).success,
  );
});
