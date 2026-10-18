import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import {
  hubspotOptions,
  normaliseHubspot,
  hubspotLifecycle,
  previewHubspot,
  commitHubspot,
  assessEmailResponse,
} from "../src/services/hubspot-import";
import {
  readContactContext,
  contactActionRestriction,
} from "../src/services/contact-context";
import { EnquiryMemoryDb } from "./helpers/enquiry-db";
import { generatePlatformId } from "../src/domain";
import type { ClientSession } from "mongodb";
const row = {
  "Record ID": "123",
  "First Name": "Alex",
  "Last Name": "Test",
  Email: "",
  "Lifecycle Stage": "Customer",
  "Unsubscribed from all email": "true",
};
const options = hubspotOptions.parse({
  timezone: "UTC",
  account: "test-portal",
  kind: "contacts",
});
test("HubSpot lifecycle retains qualification distinctions and explicit custom mapping", () => {
  assert.equal(
    hubspotLifecycle("Marketing Qualified Lead"),
    "marketing_qualified",
  );
  assert.equal(hubspotLifecycle("Sales Qualified Lead"), "sales_qualified");
  assert.equal(hubspotLifecycle("Custom"), "unknown");
  assert.equal(hubspotLifecycle("Custom", { Custom: "customer" }), "customer");
  const n = normaliseHubspot(row, options);
  assert.equal(n.email, "");
  assert.deepEqual(n.restrictions, ["Unsubscribed from all email"]);
});
test("response assessment distinguishes departure, absence and objection without authorising changes", () => {
  for (const [body, category] of [
    ["Alex has left the company", "departure"],
    ["I am out of office until Monday", "temporary_absence"],
    ["Please unsubscribe me", "objection"],
  ])
    assert.equal(assessEmailResponse("Auto reply", body!).category, category);
  assert.equal(
    assessEmailResponse(
      "Reply",
      "Thanks\nFrom: Earlier sender\nPlease unsubscribe",
    ).category,
    "ordinary_reply",
  );
});
test("email-free identities, replay, restrictions, changed source and workspace isolation", async () => {
  const memory = new EnquiryMemoryDb(),
    db = await memory.mongo.database(),
    w = generatePlatformId("workspace"),
    actor = { type: "human", id: generatePlatformId("person") },
    session = {} as ClientSession;
  const input = {
    hubspot: options,
    requestKey: randomUUID(),
    filename: "contacts.csv",
    rows: [{ row: 2, original: row }],
  };
  let preview = await previewHubspot(db, w, input);
  assert.equal(preview.rows[0]!.status, "create");
  const result = await commitHubspot(
    db,
    w,
    input,
    preview.digest,
    actor,
    new Date(),
    session,
  );
  assert.equal(memory.rows("people").length, 1);
  assert.deepEqual(
    await commitHubspot(
      db,
      w,
      input,
      preview.digest,
      actor,
      new Date(),
      session,
    ),
    result,
  );
  const next = { ...input, requestKey: randomUUID() };
  preview = await previewHubspot(db, w, next);
  assert.equal(preview.rows[0]!.status, "existing");
  await commitHubspot(db, w, next, preview.digest, actor, new Date(), session);
  assert.equal(memory.rows("people").length, 1);
  const id = result.results[0]!.personId;
  let context = await readContactContext(db, w, id);
  assert.equal(context.lifecycle, "customer");
  assert.equal(
    contactActionRestriction(context, "acquisition").decision,
    "deferred",
  );
  await assert.rejects(
    readContactContext(db, generatePlatformId("workspace"), id),
  );
  const changed = {
    ...input,
    requestKey: randomUUID(),
    rows: [
      {
        row: 2,
        original: {
          ...row,
          "Unsubscribed from all email": "false",
          "First Name": "Changed",
        },
      },
    ],
  };
  preview = await previewHubspot(db, w, changed);
  await commitHubspot(
    db,
    w,
    changed,
    preview.digest,
    actor,
    new Date(Date.now() + 10),
    session,
  );
  assert.equal(memory.rows("people")[0]!.firstName, "Alex");
  context = await readContactContext(db, w, id);
  assert.ok(context.sourceRestrictions.includes("Unsubscribed from all email"));
});
test("email history preserves dates, links participants and does not duplicate", async () => {
  const memory = new EnquiryMemoryDb(),
    db = await memory.mongo.database(),
    w = generatePlatformId("workspace"),
    actor = {
      type: "human",
      id: generatePlatformId("person"),
      issuer: "https://identity.example.com",
    },
    session = {} as ClientSession;
  const person = generatePlatformId("person");
  memory
    .rows("people")
    .push({ id: person, workspaceId: w, updatedAt: new Date() });
  memory.rows("contact_points").push({
    id: generatePlatformId("contact"),
    workspaceId: w,
    personId: person,
    type: "email",
    normalizedValue: "alex@example.com",
  });
  const original = {
    "Record ID": "999",
    "Email Direction": "Incoming",
    "Email body": "Alex has left the company",
    "Email subject": "Automatic reply",
    "Email From Address": "alex@example.com",
    "Activity date": "2026-10-01T10:00:00Z",
  };
  const input = {
    hubspot: hubspotOptions.parse({
      timezone: "UTC",
      account: "test-portal",
      kind: "emails",
    }),
    requestKey: randomUUID(),
    filename: "emails.csv",
    rows: [{ row: 2, original }],
  };
  const preview = await previewHubspot(db, w, input);
  const result = await commitHubspot(
    db,
    w,
    input,
    preview.digest,
    actor,
    new Date(),
    session,
  );
  const event = memory
    .rows("events")
    .find((e) => e.id === result.results[0]!.eventId)!;
  assert.equal(event.eventType, "email");
  assert.deepEqual(event.interaction.actor, { type: actor.type, id: actor.id });
  assert.equal(event.occurredAt.toISOString(), "2026-10-01T10:00:00.000Z");
  assert.equal(event.payload.hubspotEmail.assessment.category, "departure");
  assert.equal(memory.rows("contact_points")[0]!.suppressed, undefined);
  const next = { ...input, requestKey: randomUUID() };
  const p = await previewHubspot(db, w, next);
  await commitHubspot(db, w, next, p.digest, actor, new Date(), session);
  assert.equal(
    memory.rows("events").filter((e) => e.eventType === "email").length,
    1,
  );
});

test("shared addresses remain unlinked and mapping changes version the source", async () => {
  const memory = new EnquiryMemoryDb(),
    db = await memory.mongo.database(),
    w = generatePlatformId("workspace");
  for (let i = 0; i < 2; i++)
    memory.rows("contact_points").push({
      workspaceId: w,
      personId: generatePlatformId("person"),
      type: "email",
      normalizedValue: "shared@example.com",
    });
  const input = {
    hubspot: hubspotOptions.parse({
      timezone: "UTC",
      account: "portal",
      kind: "emails",
    }),
    requestKey: randomUUID(),
    filename: "emails.csv",
    rows: [
      {
        row: 1,
        original: {
          "Record ID": "1",
          "Email Direction": "Incoming",
          "Email From Address": "shared@example.com",
          "Activity date": "2026-01-01",
          "Email body": "Hello",
        },
      },
    ],
  };
  const p = await previewHubspot(db, w, input);
  assert.deepEqual(p.rows[0]!.personIds, []);
  assert.ok(
    p.rows[0]!.issues.some((s: string) => s.includes("multiple people")),
  );
  const contact = {
    hubspot: options,
    requestKey: randomUUID(),
    filename: "contacts.csv",
    rows: [{ row: 1, original: { ...row, "Lifecycle Stage": "Custom" } }],
  };
  const first = await previewHubspot(db, w, contact);
  await commitHubspot(
    db,
    w,
    contact,
    first.digest,
    { type: "human", id: generatePlatformId("person") },
    new Date(),
    {} as ClientSession,
  );
  const changed = await previewHubspot(db, w, {
    ...contact,
    hubspot: { ...options, lifecycleMapping: { Custom: "customer" } },
  });
  assert.equal(changed.rows[0]!.status, "review"); // No-email changes require identity review.
});

test("export timestamps use explicit timezone and reject ambiguous daylight-saving times", async () => {
  const { hubspotDate } = await import("../src/services/hubspot-import");
  assert.equal(
    hubspotDate("2026-09-14 10:10", "Europe/London")?.toISOString(),
    "2026-09-14T09:10:00.000Z",
  );
  assert.equal(
    hubspotDate("2026-09-14 10:10", "UTC")?.toISOString(),
    "2026-09-14T10:10:00.000Z",
  );
  assert.equal(hubspotDate("2026-10-25 01:30", "Europe/London"), null);
  assert.equal(hubspotDate("2026-03-29 01:30", "Europe/London"), null);
});

test("account-free imports match within a workspace, preserve conflicts and repeat safely", async () => {
  const memory = new EnquiryMemoryDb(),
    db = await memory.mongo.database();
  const w = generatePlatformId("workspace"),
    other = generatePlatformId("workspace");
  const actor = { type: "human", id: generatePlatformId("person") };
  const input = {
    hubspot: hubspotOptions.parse({ kind: "contacts", timezone: "UTC" }),
    filename: "contacts.csv",
    requestKey: randomUUID(),
    rows: [{ row: 1, original: { ...row, Email: "alex@example.com" } }],
  };
  const save = async (workspace: string, value = input) => {
    const p = await previewHubspot(db, workspace, value);
    await commitHubspot(
      db,
      workspace,
      value,
      p.digest,
      actor,
      new Date(),
      {} as ClientSession,
    );
    return p;
  };
  await save(w);
  assert.equal(
    (await save(w, { ...input, requestKey: randomUUID() })).rows[0]!.unchanged,
    true,
  );
  await save(other, { ...input, requestKey: randomUUID() });
  assert.equal(memory.rows("people").length, 2);
  // Record ID differs across exports/accounts: email and name still identify the workspace record.
  const changed = {
    ...input,
    requestKey: randomUUID(),
    rows: [
      {
        row: 1,
        original: {
          ...input.rows[0]!.original,
          "Record ID": "999",
          "Job Title": "Director",
        },
      },
    ],
  };
  assert.equal((await save(w, changed)).rows[0]!.status, "existing");
  assert.equal(memory.rows("people").length, 2);
  assert.equal(memory.rows("people")[0]!.title, undefined);
  // Same source record ID cannot attach a different person.
  const different = {
    ...input,
    requestKey: randomUUID(),
    rows: [
      {
        row: 1,
        original: { ...row, "First Name": "Pat", Email: "pat@example.com" },
      },
    ],
  };
  assert.equal((await save(w, different)).rows[0]!.status, "create");
});

test("ambiguous identity review is scoped, supports explicit resolution, and never merges by name", async () => {
  const memory = new EnquiryMemoryDb(),
    db = await memory.mongo.database(),
    w = generatePlatformId("workspace");
  const id = generatePlatformId("person");
  memory.rows("people").push({
    id,
    workspaceId: w,
    firstName: "Alex",
    lastName: "Test",
    displayName: "Alex Test",
  });
  const input = {
    hubspot: hubspotOptions.parse({ kind: "contacts", timezone: "UTC" }),
    filename: "c.csv",
    requestKey: randomUUID(),
    rows: [{ row: 1, original: row }],
  };
  let p = await previewHubspot(db, w, input);
  assert.equal(p.rows[0]!.status, "review");
  assert.equal(p.rows[0]!.candidates[0].id, id);
  p = await previewHubspot(db, w, {
    ...input,
    rows: [
      {
        ...input.rows[0]!,
        resolution: { action: "match", id: generatePlatformId("person") },
      },
    ],
  });
  assert.equal(p.rows[0]!.status, "review");
  p = await previewHubspot(db, w, {
    ...input,
    rows: [{ ...input.rows[0]!, resolution: { action: "match", id } }],
  });
  assert.equal(p.rows[0]!.personId, id);
  assert.equal(p.rows[0]!.status, "existing");
  p = await previewHubspot(db, w, {
    ...input,
    rows: [{ ...input.rows[0]!, resolution: { action: "create" } }],
  });
  assert.equal(p.rows[0]!.status, "create");
});

test("domain matching supports legacy records but shared domains and subsidiaries require review", async () => {
  const memory = new EnquiryMemoryDb(),
    db = await memory.mongo.database(),
    w = generatePlatformId("workspace");
  const id = generatePlatformId("org");
  memory.rows("organisations").push({
    id,
    workspaceId: w,
    name: "Example Ltd",
    normalizedDomain: "example.com",
  });
  const input = {
    hubspot: hubspotOptions.parse({ kind: "companies", timezone: "UTC" }),
    filename: "c.csv",
    requestKey: randomUUID(),
    rows: [
      {
        row: 1,
        original: {
          "Record ID": "123",
          "Company name": "EXAMPLE LTD",
          "Website URL": "https://www.example.com/path",
        },
      },
    ],
  };
  let p = await previewHubspot(db, w, input);
  assert.equal(p.rows[0]!.companyId, id);
  assert.equal(p.rows[0]!.status, "existing");
  memory.rows("organisations").push({
    id: generatePlatformId("org"),
    workspaceId: w,
    name: "Example subsidiary",
    normalizedDomain: "example.com",
  });
  p = await previewHubspot(db, w, input);
  assert.equal(p.rows[0]!.status, "review");
  assert.equal(p.rows[0]!.candidates.length, 2);
});

test("legacy snapshots remain compatible and distinct email messages remain distinct", async () => {
  const memory = new EnquiryMemoryDb(),
    db = await memory.mongo.database(),
    w = generatePlatformId("workspace");
  const actor = { type: "human", id: generatePlatformId("person") };
  const input = {
    hubspot: hubspotOptions.parse({ kind: "emails", timezone: "UTC" }),
    requestKey: randomUUID(),
    filename: "e.csv",
    rows: [
      {
        row: 1,
        original: {
          "Record ID": "10",
          "Email Direction": "Incoming",
          "Activity date": "2026-10-01T10:00:00Z",
          "Email From Address": "a@example.com",
          "Email body": "Hello",
        },
      },
    ],
  };
  const save = async (value: typeof input) => {
    const p = await previewHubspot(db, w, value);
    return commitHubspot(
      db,
      w,
      value,
      p.digest,
      actor,
      new Date(),
      {} as ClientSession,
    );
  };
  await save(input);
  const snapshot = memory
    .rows("events")
    .find((e) => e.eventType === "hubspot_import_record")!;
  snapshot.payload.sourceReference = "old-portal:emails:10";
  snapshot.payload.sourceHash = "legacy-hash";
  await save({ ...input, requestKey: randomUUID() });
  assert.equal(
    memory.rows("events").filter((e) => e.eventType === "hubspot_email_history")
      .length,
    1,
  );
  await save({
    ...input,
    requestKey: randomUUID(),
    rows: [
      { row: 1, original: { ...input.rows[0]!.original, "Record ID": "11" } },
    ],
  });
  assert.equal(
    memory.rows("events").filter((e) => e.eventType === "hubspot_email_history")
      .length,
    2,
  );
});

test("changed name-only and shared-address imports require review even after a previous import", async () => {
  const memory = new EnquiryMemoryDb(),
    db = await memory.mongo.database(),
    w = generatePlatformId("workspace");
  const actor = { type: "human", id: generatePlatformId("person") };
  for (const kind of ["contacts", "companies"] as const) {
    const original =
      kind === "contacts"
        ? { ...row, Email: "info@example.com" }
        : { "Record ID": "5", "Company name": "Example" };
    const input = {
      hubspot: hubspotOptions.parse({ kind, timezone: "UTC" }),
      requestKey: randomUUID(),
      filename: "c.csv",
      rows: [{ row: 1, original }],
    };
    const p = await previewHubspot(db, w, input);
    await commitHubspot(
      db,
      w,
      input,
      p.digest,
      actor,
      new Date(),
      {} as ClientSession,
    );
    const changed = await previewHubspot(db, w, {
      ...input,
      requestKey: randomUUID(),
      rows: [{ row: 1, original: { ...original, "Record ID": "999" } }],
    });
    assert.equal(changed.rows[0]!.status, "review");
  }
});

test("lifecycle labels tolerate export formatting and preserve custom source stages", () => {
  assert.equal(
    hubspotLifecycle(" Marketing_Qualified_Lead "),
    "marketing_qualified",
  );
  assert.equal(hubspotLifecycle("sales-qualified-lead"), "sales_qualified");
  for (const kind of ["companies", "contacts"] as const) {
    const result = normaliseHubspot(
      {
        ...row,
        "Company name": "Example",
        "Lifecycle Stage": "Non Responsive",
        "Current Customer": "Yes",
      },
      hubspotOptions.parse({ kind, timezone: "Europe/London" }),
    );
    assert.equal(result.originalLifecycle, "Non Responsive");
    assert.equal(result.lifecycle, "unknown");
    assert.equal(result.currentCustomer, true);
    const lead = normaliseHubspot(
      {
        ...row,
        "Company name": "Example",
        "Lifecycle Stage": "Lead",
        "Current Customer": "Yes",
      },
      hubspotOptions.parse({ kind, timezone: "Europe/London" }),
    );
    assert.equal(lead.lifecycle, "lead");
  }
});
test("generic import lifecycle informs contact context without overriding reviewed controls", async () => {
  const memory = new EnquiryMemoryDb(),
    db = await memory.mongo.database();
  const w = generatePlatformId("workspace"),
    id = generatePlatformId("person");
  memory.rows("people").push({
    id,
    workspaceId: w,
    firstName: "QA",
    updatedAt: new Date(),
    archived: false,
  });
  memory.rows("events").push({
    id: generatePlatformId("event"),
    workspaceId: w,
    createdAt: new Date(),
    eventType: "hive_import_contact_context",
    payload: {
      personId: id,
      values: { lifecycle: "customer", originalLifecycle: "Customer" },
    },
  });
  let context = await readContactContext(db, w, id);
  assert.equal(context.lifecycle, "customer");
  assert.notEqual(
    contactActionRestriction(context, "acquisition").decision,
    "eligible",
  );
  memory.rows("events").push({
    id: generatePlatformId("event"),
    workspaceId: w,
    createdAt: new Date(),
    eventType: "contact_context_changed",
    payload: {
      subjectId: id,
      controls: {
        lifecycle: "opportunity",
        doNotContact: true,
        reason: "Reviewed",
      },
    },
  });
  context = await readContactContext(db, w, id);
  assert.equal(context.lifecycle, "opportunity");
  assert.notEqual(
    contactActionRestriction(context, "acquisition").decision,
    "eligible",
  );
  await assert.rejects(
    readContactContext(db, generatePlatformId("workspace"), id),
  );
});
