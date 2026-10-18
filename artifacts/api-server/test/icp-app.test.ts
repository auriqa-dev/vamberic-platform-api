import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test, type TestContext } from "node:test";
import { createApp } from "../src/app";
import { parseConfig } from "../src/config";
import { generatePlatformId, OrganisationSchema } from "../src/domain";
import { provisionHvmClient } from "../src/services/hvm-provision";
import { EnquiryMemoryDb } from "./helpers/enquiry-db";
import { authEnvironment, createTestAuth, testIssuer } from "./helpers/auth";

const definition = {
  name: "Energy optimisation",
  description: "Supplier-delivered optimisation",
  primaryOfferingType: "professional_service",
  implementationModel: "supplier_mobilisation",
  deliveryModes: ["on_site_service"],
  unknowns: ["Measured savings"],
};
async function fixture(
  t: TestContext,
  icpGenerator?: import("../src/services/icp/generate").IcpGenerator,
) {
  const db = new EnquiryMemoryDb();
  db.rows("schema_versions").push({ _id: "vapp-v1", version: 6 });
  const now = new Date("2026-09-28T00:00:00Z");
  const organisationId = generatePlatformId("org");
  db.rows("organisations").push(
    OrganisationSchema.parse({
      id: organisationId,
      name: "Client",
      type: "customer",
      createdAt: now,
      updatedAt: now,
    }),
  );
  const input = {
    organisationId,
    workspaceId: generatePlatformId("workspace"),
    partnerId: generatePlatformId("partner"),
    partnerMembershipId: generatePlatformId("partnermembership"),
    assignmentId: generatePlatformId("partnerassignment"),
    brandId: generatePlatformId("brand"),
    clientMembershipId: generatePlatformId("workspacemembership"),
    workspaceName: "Client",
    partnerName: "Agency",
    brandName: "Brand",
    brandSlug: "brand",
    human: {
      type: "human" as const,
      issuer: testIssuer,
      id: "test-user-subject",
    },
  };
  await provisionHvmClient(db.mongo, input, testIssuer);
  const config = parseConfig({
    ...authEnvironment,
    HVM_COGNITO_CLIENT_ID: "hvmclient",
    HVM_CORS_ORIGINS: "https://app.h-v-m.agency",
    DEPLOYMENT_ENV: "test",
    MONGODB_URI: "mongodb://unused.invalid",
  });
  const auth = await createTestAuth();
  const server = createServer(
    createApp(config, db.mongo, {
      jwtKeyResolver: auth.keyResolver,
      icpGenerator,
    }),
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.close();
    await once(server, "close");
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const token = await auth.sign({ client_id: "hvmclient" });
  const vapp = await auth.sign();
  const root = `/api/v1/hvm/workspaces/${input.workspaceId}`;
  async function request(path: string, body?: unknown, bearer = token) {
    const response = await fetch(url + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        authorization: `Bearer ${bearer}`,
        "content-type": "application/json",
        origin: "https://app.h-v-m.agency",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    assert.match(
      response.headers.get("access-control-expose-headers") ?? "",
      /Retry-After/i,
    );
    return { status: response.status, body: await response.json() };
  }
  const create = async () => {
    const r = await request(root + "/offerings/create", {
      definition,
      brandId: input.brandId,
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body;
  };
  return { db, input, auth, root, request, create, token, vapp };
}
const upload = () => ({
  requestKey: crypto.randomUUID(),
  filename: "customers.csv",
  fieldMapping: { Company: "company", Email: "email" },
  rows: [
    {
      row: 2,
      original: {
        Company: "Example Ltd",
        Email: " A@Example.com ",
        Note: "Keep this",
      },
      company: " Example Ltd ",
      website: "example.com",
      firstName: "Alex",
      email: " A@Example.com ",
      jobTitle: "Operations",
      employees: "100",
    },
  ],
});
test("Hive import previews without writes, preserves source, verifies canonical links and replays without duplicates", async (t) => {
  const f = await fixture(t),
    input = upload();
  const preview = await f.request(f.root + "/icp/imports/preview", input);
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assert.equal(preview.body.rows[0].values.email, "a@example.com");
  assert.equal(f.db.rows("people").length, 0);
  const result = await f.request(f.root + "/icp/imports/commit", {
    ...input,
    digest: preview.body.digest,
  });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.verified, true);
  assert.equal(f.db.rows("people").length, 1);
  assert.equal(f.db.rows("organisation_relationships").length, 1);
  assert.equal(
    f.db.rows("events").find((r) => r.eventType === "hive_import_row")!.payload
      .original.Note,
    "Keep this",
  );
  assert.equal(f.db.rows("marketing_permissions").length, 0);
  const replay = await f.request(f.root + "/icp/imports/commit", {
    ...input,
    digest: preview.body.digest,
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.importId, result.body.importId);
  assert.equal(f.db.rows("people").length, 1);
});
test("Hive import rejects wrong application and workspace, and rolls back failed writes", async (t) => {
  const f = await fixture(t),
    input = upload();
  assert.equal(
    (await f.request(f.root + "/icp/imports/preview", input, f.vapp)).status,
    404,
  );
  assert.equal(
    (
      await f.request(
        `/api/v1/hvm/workspaces/${generatePlatformId("workspace")}/icp/imports/preview`,
        input,
      )
    ).status,
    404,
  );
  const preview = await f.request(f.root + "/icp/imports/preview", input);
  f.db.failCollection = "contact_points";
  const result = await f.request(f.root + "/icp/imports/commit", {
    ...input,
    digest: preview.body.digest,
  });
  assert.equal(result.status, 503);
  assert.equal(f.db.rows("people").length, 0);
  assert.equal(f.db.rows("imports").length, 0);
  assert.equal(JSON.stringify(result.body).includes("private@example"), false);
});
test("import requires review for invalid email, repeated identity and changed preview", async (t) => {
  const f = await fixture(t),
    input = upload();
  input.rows.push({ ...input.rows[0]!, row: 3 });
  const preview = await f.request(f.root + "/icp/imports/preview", input);
  assert.equal(preview.status, 200);
  assert.equal(preview.body.rows[1].status, "review");
  assert.equal(
    (
      await f.request(f.root + "/icp/imports/commit", {
        ...input,
        digest: preview.body.digest,
      })
    ).status,
    409,
  );
  const valid = upload(),
    check = await f.request(f.root + "/icp/imports/preview", valid);
  valid.rows[0]!.company = "Changed";
  assert.equal(
    (
      await f.request(f.root + "/icp/imports/commit", {
        ...valid,
        digest: check.body.digest,
      })
    ).status,
    409,
  );
});
test("generation uses approved product, persists a reviewable draft and saves its lineage once", async (t) => {
  let calls = 0;
  let received: unknown;
  const generated = {
    name: "Energy intensive manufacturers",
    description: "Manufacturers seeking independent evidence of energy savings",
    profileType: "b2b" as const,
    accountProfile: { industries: ["Manufacturing"] },
    goodFitIndicators: ["Material energy spend"],
    unknowns: ["Target size needs confirmation"],
  };
  const f = await fixture(t, async (input) => {
    calls++;
    received = input;
    return {
      definition: generated,
      rationale:
        "Energy spend is relevant to the approved product; size is a hypothesis.",
      usage: { model: "fixture", inputTokens: 100, outputTokens: 50 },
    };
  });
  const product = await f.create();
  const request = {
    requestKey: crypto.randomUUID(),
    offeringId: product.id,
    profileType: "b2b",
    instructions: "Focus on manufacturers",
    examples: [],
  };
  assert.equal(
    (await f.request(f.root + "/icp/generations", request)).status,
    409,
  );
  assert.equal(
    (
      await f.request(f.root + "/offerings/approve", {
        id: product.id,
        expectedUpdatedAt: product.updatedAt,
      })
    ).status,
    200,
  );
  const started = await f.request(f.root + "/icp/generations", request);
  assert.equal(started.status, 202, JSON.stringify(started.body));
  const job = await f.request(f.root + "/icp/generations/" + started.body.id);
  assert.equal(job.body.status, "review");
  const latest = await f.request(
    f.root + "/icp/generations?offeringId=" + product.id,
  );
  assert.equal(latest.status, 200);
  assert.equal(latest.body.id, started.body.id);
  assert.equal(JSON.stringify(received).includes("createdBy"), false);
  assert.equal(
    (await f.request(f.root + "/icp/generations", request)).status,
    202,
  );
  assert.equal(calls, 1);
  const saved = await f.request(
    f.root + "/icp/generations/" + started.body.id + "/save",
    generated,
  );
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.evidence[0].sourceReference, started.body.id);
  const replay = await f.request(
    f.root + "/icp/generations/" + started.body.id + "/save",
    generated,
  );
  assert.equal(replay.body.id, saved.body.id);
  assert.equal(f.db.rows("ideal_customer_profiles").length, 1);
});
test("multiple contacts at one company import as one organisation with two links", async (t) => {
  const f = await fixture(t),
    input = upload();
  input.rows.push({
    ...input.rows[0]!,
    row: 3,
    firstName: "Sam",
    email: "sam@example.com",
  });
  const preview = await f.request(f.root + "/icp/imports/preview", input);
  assert.equal(preview.status, 200);
  assert.equal(preview.body.rows[1].status, "create");
  const result = await f.request(f.root + "/icp/imports/commit", {
    ...input,
    digest: preview.body.digest,
  });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(
    f.db
      .rows("organisations")
      .filter(
        (r) =>
          r.workspaceId === f.input.workspaceId &&
          r.normalizedDomain === "example.com",
      ).length,
    1,
  );
  assert.equal(f.db.rows("organisation_relationships").length, 2);
});

test("workbook batches preserve registration identity, typed observations and scoped recovery receipts", async (t) => {
  const f = await fixture(t);
  const jobId = "a".repeat(64);
  const input = {
    requestKey: "ba9be997-1010-4000-8000-000000000001",
    filename: "ESOS.xlsx",
    fieldMapping: {},
    jobId,
    batchIndex: 0,
    rows: [
      {
        row: 1,
        company: "Example Registered Ltd",
        registration: "123",
        registrationJurisdiction: "GB",
        registrationType: "company_number",
        original: {},
      },
    ],
  };
  const p = await f.request(f.root + "/icp/imports/preview", input);
  assert.equal(p.status, 200);
  const commit = await f.request(f.root + "/icp/imports/commit", {
    ...input,
    digest: p.body.digest,
  });
  assert.equal(commit.status, 200, JSON.stringify(commit.body));
  const org = f.db
    .rows("organisations")
    .find((o) => o.name === "Example Registered Ltd")!;
  assert.equal(org.source.reference, "GB:00000123");
  const evidence = {
    ...input,
    requestKey: "ba9be997-1010-4000-8000-000000000002",
    batchIndex: 1,
    rows: [
      {
        row: 2,
        sourceOnly: true,
        company: "Example Registered Ltd",
        registration: "00000123",
        registrationJurisdiction: "GB",
        registrationType: "company_number",
        origin: {
          sheet: "Responsible Undertaking",
          row: 2,
          scope: "organisation",
          notification: "N1",
        },
        original: {
          "Company registration number": "00000123",
          Energy: "1,200 kWh",
          "Long detail": "x".repeat(9828),
        },
      },
      {
        row: 3,
        sourceOnly: true,
        origin: {
          sheet: "Energy Consumption",
          row: 2,
          scope: "notification",
          notification: "N1",
        },
        original: { "Group energy": "5000 kWh" },
      },
    ],
  };
  const e = await f.request(f.root + "/icp/imports/preview", evidence);
  assert.equal(e.status, 200, JSON.stringify(e.body));
  const saved = await f.request(f.root + "/icp/imports/commit", {
    ...evidence,
    digest: e.body.digest,
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const facts = f.db
    .rows("events")
    .filter((e) => e.eventType === "hive_import_observations");
  assert.ok(
    facts.some((e) =>
      e.payload.fields.some(
        (x: { label: string; value?: unknown; unit?: string; raw: string }) =>
          x.label === "Energy" && x.value === 1200 && x.unit === "kWh",
      ),
    ),
  );
  assert.equal(
    facts
      .flatMap((e) => e.payload.fields)
      .filter(
        (x: { label: string; value?: unknown; unit?: string; raw: string }) =>
          x.label === "Long detail",
      )
      .map(
        (x: { label: string; value?: unknown; unit?: string; raw: string }) =>
          x.raw,
      )
      .join(""),
    "x".repeat(9828),
  );
  assert.ok(
    facts
      .filter((e) => e.payload.origin.scope === "notification")
      .every((e) => !e.payload.companyId),
  );
  const progress = await f.request(f.root + "/icp/imports/progress/" + jobId);
  assert.equal(progress.status, 200);
  assert.equal(progress.body.batches.length, 2);
  const replay = await f.request(f.root + "/icp/imports/commit", {
    ...evidence,
    digest: e.body.digest,
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.importId, saved.body.importId);
  assert.equal(
    f.db
      .rows("events")
      .filter((e) => e.eventType === "hive_import_observations").length,
    facts.length,
  );
  assert.equal(
    (
      await f.request(
        f.root + "/icp/imports/progress/" + jobId,
        undefined,
        f.vapp,
      )
    ).status,
    404,
  );
});

test("ICP company choices exclude retained ESOS supporting records", async (t) => {
  const f = await fixture(t);
  for (const [name, system] of [
    ["ESOS Main", "hvm_hive_upload"],
    ["ESOS Support", "hvm_esos_supporting"],
  ]) {
    f.db.rows("organisations").push({
      id: generatePlatformId("org"),
      workspaceId: f.input.workspaceId,
      name,
      archived: false,
      source: { system },
    });
  }
  const result = await f.request(f.root + "/icp/examples?type=company&q=ESOS");
  assert.equal(result.status, 200);
  assert.deepEqual(
    result.body.map((r: { name: string }) => r.name),
    ["ESOS Main"],
  );
});

test("ICP setup persists independently, rejects stale revisions and isolates workspace access", async (t) => {
  const f = await fixture(t);
  const input = {
    offeringId: generatePlatformId("offering"),
    offer: { id: generatePlatformId("offer"), revision: 1 },
    profileType: "b2b",
    instructions: "Demand stress, distinguish evidence from inference",
    customerUrls: ["https://www.kambi.com/"],
    researchDocuments: [],
    examples: [
      {
        id: generatePlatformId("org"),
        type: "company",
        name: "Kambi",
        reason: "Marketing maturity",
      },
    ],
  };
  const saved = await f.request(f.root + "/icp/setup", { input, revision: 0 });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.revision, 1);
  const read = await f.request(
    f.root +
      `/icp/setup?offeringId=${input.offeringId}&offerId=${input.offer.id}`,
  );
  assert.deepEqual(read.body.input, input);
  const stale = await f.request(f.root + "/icp/setup", {
    input: { ...input, instructions: "Old tab" },
    revision: 0,
  });
  assert.equal(stale.status, 409);
  const denied = await f.request(
    f.root + "/icp/setup",
    { input, revision: 1 },
    f.vapp,
  );
  assert.equal(denied.status, 404);
  const otherInput = {
    ...input,
    offer: { id: generatePlatformId("offer"), revision: 1 },
    instructions: "Enterprise buying group",
    examples: [],
  };
  const other = await f.request(f.root + "/icp/setup", {
    input: otherInput,
    revision: 0,
  });
  assert.equal(other.status, 200);
  const original = await f.request(
    f.root +
      `/icp/setup?offeringId=${input.offeringId}&offerId=${input.offer.id}`,
  );
  assert.equal(original.body.input.instructions, input.instructions);
  assert.deepEqual(original.body.input.examples, input.examples);
  const enterprise = await f.request(
    f.root +
      `/icp/setup?offeringId=${input.offeringId}&offerId=${otherInput.offer.id}`,
  );
  assert.equal(enterprise.body.input.instructions, otherInput.instructions);
  assert.equal(
    f.db.rows("events").filter((r) => r.eventType === "icp_setup").length,
    2,
  );
});

test("consumer examples need no employer; business examples remain explicit and tenant scoped", async (t) => {
  let receivedExamples: unknown[] = [];
  const f = await fixture(t, async (input) => {
    receivedExamples = input.examples;
    return {
      definition: {
        name: "Customers",
        description: "Local customers",
        profileType: input.profileType,
        consumerProfile: {},
      },
      rationale: "For review",
      usage: { model: "fixture", inputTokens: 1, outputTokens: 1 },
    };
  });
  const product = await f.create();
  await f.request(f.root + "/offerings/approve", {
    id: product.id,
    expectedUpdatedAt: product.updatedAt,
  });
  const person = generatePlatformId("person");
  f.db.rows("people").push({
    id: person,
    workspaceId: f.input.workspaceId,
    firstName: "Customer",
    archived: false,
  });
  const request = {
    requestKey: crypto.randomUUID(),
    offeringId: product.id,
    profileType: "b2c",
    instructions: "Appointment buyers",
    examples: [{ id: person, type: "contact", reason: "Existing customer" }],
  };
  const started = await f.request(f.root + "/icp/generations", request);
  assert.equal(started.status, 202, JSON.stringify(started.body));
  assert.equal((receivedExamples[0] as { id: string }).id, person);
  assert.equal(
    (receivedExamples[0] as { companyId?: string }).companyId,
    undefined,
  );
  const business = await f.request(f.root + "/icp/generations", {
    ...request,
    requestKey: crypto.randomUUID(),
    profileType: "b2b",
  });
  assert.equal(business.status, 409);
  f.db.rows("people").find((p) => p.id === person)!.workspaceId =
    generatePlatformId("workspace");
  const denied = await f.request(f.root + "/icp/generations", {
    ...request,
    requestKey: crypto.randomUUID(),
  });
  assert.notEqual(denied.status, 202);
});
test("unfinished audience selection is saved without inventing B2B", async (t) => {
  const f = await fixture(t),
    input = {
      offeringId: generatePlatformId("offering"),
      offer: { id: generatePlatformId("offer"), revision: 1 },
      profileType: null,
      instructions: "Choose audience later",
      examples: [],
    };
  const saved = await f.request(f.root + "/icp/setup", { input, revision: 0 });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.input.profileType, null);
});

test("international registration import preserves identity and does not merge on an unverified identifier", async (t) => {
  const f = await fixture(t);
  const input = {
    requestKey: crypto.randomUUID(),
    filename: "international.csv",
    fieldMapping: {},
    rows: [
      {
        row: 1,
        company: "North American maker",
        registration: "12-3456789",
        registrationJurisdiction: "US",
        registrationType: "tax_id",
        country: "United States",
        original: {},
      },
      {
        row: 2,
        company: "German workshop",
        registration: "HRB 12345",
        registrationJurisdiction: "DE",
        registrationType: "trade_register",
        country: "Germany",
        original: {},
      },
    ],
  };
  const preview = await f.request(f.root + "/icp/imports/preview", input);
  assert.equal(preview.status, 200);
  assert.ok(
    preview.body.rows.every((r: { status: string }) => r.status === "create"),
  );
  const committed = await f.request(f.root + "/icp/imports/commit", {
    ...input,
    digest: preview.body.digest,
  });
  assert.equal(committed.status, 200, JSON.stringify(committed.body));
  const org = f.db
    .rows("organisations")
    .find((o) => o.name === "German workshop")!;
  assert.equal(org.country, "DE");
  assert.match(org.source.reference, /HRB 12345/);
  const repeat = await f.request(f.root + "/icp/imports/preview", {
    ...input,
    requestKey: crypto.randomUUID(),
  });
  assert.ok(
    repeat.body.rows.every((r: { status: string }) => r.status === "review"),
  );
});
