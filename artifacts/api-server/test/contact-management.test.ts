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

const orgFields = {
  name: "Test Organisation",
  website: "https://example.org",
  industry: "Energy",
  country: "GB",
  region: "London",
  description: "Profile",
  type: "prospect",
};
const contactFields = {
  firstName: "Alex",
  lastName: "Example",
  title: "Director",
  email: "alex@example.org",
  phone: "+442012345678",
  organisationId: "",
};
test("record CRUD preserves hidden fields and history, rejects stale and duplicate edits", async (t) => {
  const f = await fixture(t),
    root = f.root + "/records/";
  const created = await f.request(root + "organisations/create", {
    fields: orgFields,
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const org = f.db.rows("organisations").find((r) => r.id === created.body.id)!;
  org.legalName = "Keep legal name";
  org.source = { system: "existing", reference: "keep" };
  const originalTime = org.updatedAt.toISOString();
  let r = await f.request(root + "organisations/" + org.id + "/save", {
    updatedAt: originalTime,
    fields: { ...orgFields, description: "Changed" },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(org.legalName, "Keep legal name");
  assert.equal(org.source.reference, "keep");
  r = await f.request(root + "organisations/" + org.id + "/save", {
    updatedAt: originalTime,
    fields: orgFields,
  });
  assert.equal(r.status, 409);
  r = await f.request(root + "organisations/create", { fields: orgFields });
  assert.equal(r.status, 409);
  r = await f.request(root + "contacts/create", {
    fields: { ...contactFields, organisationId: org.id },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const person = f.db.rows("people").find((x) => x.id === r.body.id)!;
  person.preferredLanguage = "en";
  const email = f.db
    .rows("contact_points")
    .find((x) => x.personId === person.id && x.type === "email")!;
  email.suppressed = true;
  email.deliverability = "hard_bounced";
  r = await f.request(root + "contacts/" + person.id + "/save", {
    updatedAt: person.updatedAt.toISOString(),
    fields: {
      ...contactFields,
      email: "new@example.org",
      organisationId: org.id,
    },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(person.preferredLanguage, "en");
  assert.equal(email.archived, true);
  assert.equal(email.suppressed, true);
  const newEmail = f.db
    .rows("contact_points")
    .find((x) => x.personId === person.id && x.value === "new@example.org")!;
  assert.equal(newEmail.deliverability, "unknown");
  assert.equal(f.db.rows("marketing_permissions").length, 0);
  // Returning to a previous address keeps its suppression and validation history.
  const currentPerson = () =>
    f.db.rows("people").find((x) => x.id === person.id)!;
  r = await f.request(root + "contacts/" + person.id + "/save", {
    updatedAt: currentPerson().updatedAt.toISOString(),
    fields: { ...contactFields, organisationId: org.id },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(email.archived, false);
  assert.equal(email.suppressed, true);
  r = await f.request(root + "contacts/" + person.id + "/save", {
    updatedAt: currentPerson().updatedAt.toISOString(),
    fields: {
      ...contactFields,
      email: "new@example.org",
      organisationId: org.id,
    },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));

  r = await f.request(root + "contacts/create", {
    fields: { ...contactFields, email: "NEW@example.org", phone: "" },
  });
  assert.equal(r.status, 409);
  const currentOrg = () =>
    f.db.rows("organisations").find((x) => x.id === org.id)!;
  const links = structuredClone(f.db.rows("organisation_relationships"));
  r = await f.request(root + "organisations/" + org.id + "/archive", {
    updatedAt: currentOrg().updatedAt.toISOString(),
  });
  assert.equal(r.status, 200);
  assert.equal(currentOrg().archived, true);
  assert.deepEqual(f.db.rows("organisation_relationships"), links);
  r = await f.request(root + "organisations/" + org.id + "/restore", {
    updatedAt: currentOrg().updatedAt.toISOString(),
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(currentOrg().archived, false);
  assert.ok(
    f.db
      .rows("events")
      .every(
        (e) =>
          !e.eventType.startsWith("hvm_record_") ||
          e.createdBy?.id === "test-user-subject",
      ),
  );
});
test("record writes deny cross-workspace references, other apps and viewers; audit failures roll back", async (t) => {
  const f = await fixture(t),
    root = f.root + "/records/";
  let r = await f.request(root + "contacts/create", {
    fields: { ...contactFields, organisationId: generatePlatformId("org") },
  });
  assert.equal(r.status, 409);
  r = await f.request(
    root + "contacts/create",
    { fields: contactFields },
    f.vapp,
  );
  assert.equal(r.status, 404);
  const other = f.root.replace(
    f.input.workspaceId,
    generatePlatformId("workspace"),
  );
  r = await f.request(other + "/records/contacts/create", {
    fields: contactFields,
  });
  assert.equal(r.status, 404);
  f.db.failCollection = "events";
  r = await f.request(root + "contacts/create", { fields: contactFields });
  assert.equal(r.status, 503);
  assert.equal(f.db.rows("people").length, 0);
  assert.equal(f.db.rows("contact_points").length, 0);
  f.db.failCollection = undefined;
  for (const m of f.db.rows("hvm_partner_memberships")) m.status = "inactive";
  for (const m of f.db.rows("workspace_memberships")) m.role = "member";
  r = await f.request(root + "contacts/create", { fields: contactFields });
  assert.equal(r.status, 404);
});

test("a contact needs only a first name; clearing a surname preserves other fields", async (t) => {
  const f = await fixture(t),
    root = f.root + "/records/contacts";
  let r = await f.request(root + "/create", {
    fields: { ...contactFields, lastName: "", email: "", phone: "" },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const p = f.db.rows("people").find((x) => x.id === r.body.id)!;
  assert.equal(p.lastName, undefined);
  r = await f.request(root + "/create", {
    fields: { ...contactFields, lastName: "", email: "", phone: "" },
  });
  assert.equal(r.status, 409);
});
