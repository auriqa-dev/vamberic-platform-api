import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test, type TestContext } from "node:test";
import { createApp } from "../src/app";
import { parseConfig } from "../src/config";
import {
  generatePlatformId,
  OrganisationSchema,
  ProductSchema,
  WorkspaceMembershipSchema,
} from "../src/domain";
import { provisionHvmClient } from "../src/services/hvm-provision";
import { submitEnquiry } from "../src/services/enquiries";
import { EnquiryMemoryDb } from "./helpers/enquiry-db";
import { authEnvironment, createTestAuth, testIssuer } from "./helpers/auth";
const dates = {
  createdAt: new Date("2026-09-28T00:00:00Z"),
  updatedAt: new Date("2026-09-28T00:00:00Z"),
};
const human = {
  type: "human",
  issuer: testIssuer,
  id: "test-user-subject",
} as const;
const enquiry = {
  firstName: "Ada",
  lastName: "Lovelace",
  workEmail: "ada@example.test",
  company: "Example",
  website: "https://example.test",
  message: "Please contact me",
};
async function fixture(t: TestContext) {
  const db = new EnquiryMemoryDb();
  db.rows("schema_versions").push({ _id: "vapp-v1", version: 5 });
  const organisationId = generatePlatformId("org");
  db.rows("organisations").push(
    OrganisationSchema.parse({
      ...dates,
      id: organisationId,
      name: "Legal entity",
      type: "customer",
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
    human,
  };
  await provisionHvmClient(db.mongo, input, testIssuer);
  const productId = generatePlatformId("product");
  db.rows("products").push(
    ProductSchema.parse({
      ...dates,
      id: productId,
      name: "Portfolio",
      slug: "portfolio",
      productType: "agency",
      lifecycleStatus: "live",
    }),
  );
  const config = parseConfig({
    ...authEnvironment,
    HVM_COGNITO_CLIENT_ID: "hvmclient",
    HVM_CORS_ORIGINS: "https://app.h-v-m.agency,http://localhost:5173",
    DEPLOYMENT_ENV: "test",
    MONGODB_URI: "mongodb://unused.invalid",
    PUBLIC_ENQUIRY_CORS_ORIGINS: "https://h-v-m.agency",
    PUBLIC_ENQUIRY_RATE_LIMIT_MAX_REQUESTS: "20",
    PUBLIC_ENQUIRY_WORKSPACE_ROUTES_JSON: JSON.stringify({
      [productId]: { workspaceId: input.workspaceId, brandId: input.brandId },
    }),
  });
  const auth = await createTestAuth();
  const server = createServer(
    createApp(config, db.mongo, { jwtKeyResolver: auth.keyResolver }),
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
  async function request(
    path: string,
    body?: unknown,
    bearer = token,
    extra: Record<string, string> = {},
  ) {
    const response = await fetch(url + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        authorization: `Bearer ${bearer}`,
        "content-type": "application/json",
        ...extra,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  }
  const root = `/api/v1/hvm/workspaces/${input.workspaceId}`;
  return {
    db,
    input,
    productId,
    config,
    auth,
    token,
    vapp,
    request,
    root,
    url,
  };
}
test("trusted HVM client mapping rejects spoofed Vapp identity and unknown client; context supports both roles and no access", async (t) => {
  const f = await fixture(t);
  const context = await f.request("/api/v1/hvm/context");
  assert.equal(context.status, 200);
  assert.equal(context.body.application, "hvmapp");
  assert.equal(context.body.partners.length, 1);
  assert.equal(context.body.clients.length, 1);
  assert.equal(
    (
      await f.request("/api/v1/hvm/context", undefined, f.vapp, {
        "x-application": "hvmapp",
      })
    ).status,
    404,
  );
  const unknown = await f.auth.sign({
    client_id: "other",
    application: "hvmapp",
  });
  assert.equal(
    (await f.request("/api/v1/hvm/context", undefined, unknown)).status,
    401,
  );
  const stranger = await f.auth.sign({
    client_id: "hvmclient",
    sub: "stranger",
  });
  const empty = await f.request("/api/v1/hvm/context", undefined, stranger);
  assert.deepEqual(empty.body.workspaces, []);
  assert.equal(
    (await f.request(f.root + "/overview", undefined, stranger)).status,
    404,
  );
});
test("Partner resolution is fresh, supports agency humans/multiple clients and fails closed on ended relationships", async (t) => {
  const f = await fixture(t);
  f.db.rows("workspace_memberships")[0].status = "ended";
  f.db.rows("workspace_memberships")[0].endedAt = new Date();
  const second = {
    ...f.db.rows("crm_workspaces")[0],
    id: generatePlatformId("workspace"),
  };
  f.db.rows("crm_workspaces").push(second);
  f.db.rows("workspace_partner_assignments").push({
    ...f.db.rows("workspace_partner_assignments")[0],
    id: generatePlatformId("partnerassignment"),
    workspaceId: second.id,
  });
  f.db.rows("hvm_partner_memberships").push({
    ...f.db.rows("hvm_partner_memberships")[0],
    id: generatePlatformId("partnermembership"),
    human: { ...human, id: "staff" },
    role: "member",
  });
  const staff = await f.auth.sign({ client_id: "hvmclient", sub: "staff" });
  const context = await f.request("/api/v1/hvm/context", undefined, staff);
  assert.equal(context.body.workspaces.length, 2);
  f.db.rows("workspace_partner_assignments")[0].status = "ended";
  assert.equal(
    (await f.request(f.root + "/overview", undefined, staff)).status,
    404,
  );
  f.db.rows("workspace_partner_assignments")[0].status = "active";
  for (const status of ["suspended", "ended"]) {
    f.db.rows("hvm_partners")[0].status = status;
    assert.equal(
      (await f.request(f.root + "/overview", undefined, staff)).status,
      404,
    );
  }
  f.db.rows("hvm_partners")[0].status = "active";
  f.db.rows("hvm_partner_memberships")[1].status = "ended";
  assert.equal(
    (await f.request(f.root + "/overview", undefined, staff)).status,
    404,
  );
});
test("client membership works without Partner access; member is read-only and revoke takes effect", async (t) => {
  const f = await fixture(t);
  f.db.rows("hvm_partner_memberships")[0].status = "ended";
  const m = f.db.rows("workspace_memberships")[0];
  m.role = "member";
  assert.equal((await f.request(f.root + "/overview")).status, 200);
  assert.equal(
    (
      await f.request(f.root + "/brand-create", {
        name: "Denied",
        slug: "denied",
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await f.request(
        `/api/v1/hvm/workspaces/${generatePlatformId("workspace")}/overview`,
      )
    ).status,
    404,
  );
  f.db.rows("workspace_memberships")[0].status = "ended";
  assert.equal((await f.request(f.root + "/overview")).status, 404);
});
test("onboarding Brand and approved-kit replacement are scoped, transactional and audited", async (t) => {
  const f = await fixture(t);
  const created = await f.request(f.root + "/brand-create", {
    name: "Second",
    slug: "second",
  });
  assert.equal(created.status, 200);
  const brand = f.db.rows("brands").find((b) => b.id === created.body.id)!;
  assert.equal(brand.workspaceId, f.input.workspaceId);
  assert.equal(brand.organisationId, f.input.organisationId);
  assert.equal(
    (
      await f.request(f.root + "/brand-create", {
        name: "Escape",
        slug: "escape",
        workspaceId: generatePlatformId("workspace"),
      })
    ).status,
    400,
  );
  const draft = await f.request(f.root + "/kit-create", {
    brandId: f.input.brandId,
    content: { descriptions: { short: "Approved copy" } },
  });
  assert.equal(draft.status, 200);
  const approved = await f.request(f.root + "/kit-approve", {
    id: draft.body.id,
    expectedUpdatedAt: draft.body.updatedAt,
  });
  assert.equal(approved.status, 200);
  assert.equal(
    (await f.request(f.root + `/brands/${f.input.brandId}/kit`)).body.kit.id,
    draft.body.id,
  );
  assert.equal(
    (
      await f.request(f.root + "/kit-update", {
        id: draft.body.id,
        expectedUpdatedAt: approved.body.updatedAt,
        content: { descriptions: { short: "Changed" } },
      })
    ).status,
    409,
  );
  const replacement = await f.request(f.root + "/kit-create", {
    brandId: f.input.brandId,
    sourceKitId: draft.body.id,
    content: { descriptions: { short: "Replacement" } },
  });
  assert.equal(replacement.status, 200);
  assert.equal(
    (
      await f.request(f.root + "/kit-approve", {
        id: replacement.body.id,
        expectedUpdatedAt: replacement.body.updatedAt,
      })
    ).status,
    409,
  );
  const replaced = await f.request(f.root + "/kit-approve", {
    id: replacement.body.id,
    expectedUpdatedAt: replacement.body.updatedAt,
    replacesKitId: draft.body.id,
  });
  assert.equal(replaced.status, 200);
  assert.equal(
    f.db.rows("brand_kits").filter((k) => k.status === "approved").length,
    1,
  );
  assert.equal(
    (await f.request(f.root + `/brands/${f.input.brandId}/kit`)).body.kit.id,
    replacement.body.id,
  );
  assert.equal(
    (await f.request(f.root + `/brands/${generatePlatformId("brand")}/kit`))
      .status,
    404,
  );
  assert.ok(
    f.db
      .rows("events")
      .some(
        (e) =>
          e.payload.action === "kit-approve" &&
          e.payload.application === "hvmapp" &&
          e.payload.human.id === human.id,
      ),
  );
  f.db.failCollection = "events";
  const before = structuredClone(f.db.records);
  assert.equal(
    (
      await f.request(f.root + "/brand-create", {
        name: "Rollback",
        slug: "rollback",
      })
    ).status,
    503,
  );
  assert.deepEqual(f.db.records, before);
});
test("integrations stay pending, reject raw secrets/model providers, and never expose secure-store details", async (t) => {
  const f = await fixture(t);
  for (const provider of [
    "openai",
    "anthropic",
    "huggingface",
    "aws",
    "mongodb",
  ])
    assert.equal(
      (
        await f.request(f.root + "/integration-create", {
          provider,
          displayName: "Invalid",
        })
      ).status,
      400,
    );
  for (const field of [
    "apiKey",
    "accessToken",
    "refreshToken",
    "secretReference",
    "status",
    "scopes",
  ])
    assert.equal(
      (
        await f.request(f.root + "/integration-create", {
          provider: "odyssiant",
          displayName: "Account",
          [field]: "secret",
        })
      ).status,
      400,
    );
  const result = await f.request(f.root + "/integration-create", {
    provider: "odyssiant",
    displayName: "Existing Odyssiant",
  });
  assert.equal(result.status, 200);
  const row = f.db.rows("workspace_integrations")[0];
  assert.equal(row.status, "pending");
  row.secretReference =
    "arn:aws:secretsmanager:eu-west-2:755905325223:secret:private-ABC123";
  row.errorCode = "PrivateError";
  const listing = await f.request(f.root + "/integrations");
  assert.equal(JSON.stringify(listing.body).includes("secret"), false);
  assert.equal(JSON.stringify(listing.body).includes("PrivateError"), false);
  const disconnected = await f.request(f.root + "/integration-disconnect", {
    id: row.id,
    expectedUpdatedAt: result.body.updatedAt,
  });
  assert.equal(disconnected.status, 200);
  assert.equal(row.workspaceId, f.input.workspaceId);
  const providers = await f.request("/api/v1/hvm/integration-providers");
  assert.equal(providers.body.providers.includes("openai"), false);
});
test("team administration is explicit, idempotent, issuer constrained and revocable", async (t) => {
  const f = await fixture(t);
  const input = { human: { ...human, id: "client-user" }, role: "member" };
  const created = await f.request(f.root + "/member-provision", input);
  assert.equal(created.status, 200);
  assert.equal(
    (await f.request(f.root + "/member-provision", input)).body.id,
    created.body.id,
  );
  assert.equal(
    (
      await f.request(f.root + "/member-provision", {
        ...input,
        human: { ...human, issuer: "https://untrusted.test" },
      })
    ).status,
    404,
  );
  const token = await f.auth.sign({
    client_id: "hvmclient",
    sub: "client-user",
  });
  assert.equal(
    (await f.request(f.root + "/overview", undefined, token)).status,
    200,
  );
  assert.equal(
    (
      await f.request(f.root + "/member-revoke", {
        id: created.body.id,
        expectedUpdatedAt: created.body.updatedAt,
      })
    ).status,
    200,
  );
  assert.equal(
    (await f.request(f.root + "/overview", undefined, token)).status,
    404,
  );
  assert.equal(
    WorkspaceMembershipSchema.safeParse({
      ...f.db.rows("workspace_memberships")[0],
      role: "god",
    }).success,
    false,
  );
});
test("provisioning is generic, transactional and idempotent with explicit stable IDs", async (t) => {
  const f = await fixture(t);
  const before = structuredClone(f.db.records);
  const result = await provisionHvmClient(f.db.mongo, f.input, testIssuer);
  assert.deepEqual(result.createdIds, []);
  assert.deepEqual(f.db.records, before);
  await assert.rejects(
    provisionHvmClient(
      f.db.mongo,
      { ...f.input, brandName: "Different" },
      testIssuer,
    ),
  );
  assert.deepEqual(f.db.records, before);
  await assert.rejects(
    provisionHvmClient(
      f.db.mongo,
      { ...f.input, human: { ...human, issuer: "https://wrong.test" } },
      testIssuer,
    ),
  );
});
test("public routing chooses trusted workspace, preserves attribution/consent, and Vapp cannot list/get/delete scoped CRM", async (t) => {
  const f = await fixture(t);
  const path = `/api/v1/public/products/${f.productId}/enquiries`;
  assert.equal(
    (await f.request(path, { ...enquiry, workspaceId: f.input.workspaceId }))
      .status,
    400,
  );
  const input = {
    ...enquiry,
    source: "hvm-site",
    campaign: "launch",
    marketingOptIn: true,
    marketingConsentText: "Send updates",
    marketingConsentVersion: "v1",
  };
  assert.equal((await f.request(path, input)).status, 201);
  assert.equal((await f.request(path, enquiry)).status, 201);
  for (const collection of [
    "people",
    "contact_points",
    "product_relationships",
    "crm_leads",
    "opportunities",
  ]) {
    assert.equal(f.db.rows(collection).length, 1);
    assert.equal(f.db.rows(collection)[0].workspaceId, f.input.workspaceId);
  }
  assert.equal(f.db.rows("marketing_permissions").length, 1);
  assert.equal(
    f.db.rows("events").filter((e) => e.eventType === "enquiry_submitted")
      .length,
    2,
  );
  assert.equal(
    f.db.rows("events").find((e) => e.eventType === "enquiry_submitted")!
      .payload.campaign,
    "launch",
  );
  for (const collection of ["people", "organisations", "opportunities"]) {
    const row = f.db
      .rows(collection)
      .find((r) => r.workspaceId === f.input.workspaceId)!;
    const listing = await f.request(`/api/v1/${collection}`, undefined, f.vapp);
    assert.equal(listing.status, 200);
    assert.equal(JSON.stringify(listing.body).includes(row.id), false);
    for (const suffix of ["", "/delete-preview"])
      assert.equal(
        (
          await f.request(
            `/api/v1/${collection}/${row.id}${suffix}`,
            undefined,
            f.vapp,
          )
        ).status,
        404,
      );
    const deletion = await fetch(`${f.url}/api/v1/${collection}/${row.id}`, {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${f.vapp}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ previewToken: "guess" }),
    });
    assert.ok([400, 404].includes(deletion.status));
  }
  assert.equal((await f.request(f.root + "/enquiries")).body.leads.length, 1);
});
test("same email/domain across workspaces and internal CRM remain separate; repeat scopes reuse and notification is best effort", async (t) => {
  const f = await fixture(t);
  const second = {
    ...f.db.rows("crm_workspaces")[0],
    id: generatePlatformId("workspace"),
  };
  f.db.rows("crm_workspaces").push(second);
  const brand = {
    ...f.db.rows("brands")[0],
    id: generatePlatformId("brand"),
    workspaceId: second.id,
  };
  f.db.rows("brands").push(brand);
  let notified = 0;
  const notifications = {
    notify: async () => {
      notified++;
      throw new Error("provider failure");
    },
  };
  for (const routing of [
    undefined,
    { workspaceId: f.input.workspaceId, brandId: f.input.brandId },
    { workspaceId: second.id, brandId: brand.id },
  ]) {
    await submitEnquiry(
      f.db.mongo,
      f.productId,
      enquiry,
      notifications,
      routing,
    );
    await submitEnquiry(
      f.db.mongo,
      f.productId,
      enquiry,
      notifications,
      routing,
    );
  }
  assert.equal(notified, 6);
  assert.equal(f.db.rows("people").length, 3);
  assert.equal(f.db.rows("contact_points").length, 3);
  assert.equal(
    f.db.rows("organisations").filter((o) => o.name === "Example").length,
    3,
  );
  assert.equal(f.db.rows("opportunities").length, 4); // legacy internal behaviour + one per client
  assert.equal(f.db.rows("marketing_permissions").length, 0);
});

test("HVM fails closed before schema v5; no implicit membership collection writes", async (t) => {
  const f = await fixture(t);
  f.db.rows("schema_versions")[0].version = 4;
  const before = structuredClone(f.db.records);
  assert.equal(
    (
      await f.request(f.root + "/brand-create", {
        name: "Denied",
        slug: "denied",
      })
    ).status,
    503,
  );
  assert.deepEqual(f.db.records, before);
});

test("onboarder cannot approve/manage team, and foreign Brand/kit IDs cannot be written", async (t) => {
  const f = await fixture(t);
  const draft = await f.request(f.root + "/kit-create", {
    brandId: f.input.brandId,
    content: {},
  });
  f.db.rows("workspace_memberships")[0].status = "ended";
  f.db.rows("hvm_partner_memberships")[0].role = "member";
  assert.equal(
    (
      await f.request(f.root + "/kit-approve", {
        id: draft.body.id,
        expectedUpdatedAt: draft.body.updatedAt,
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await f.request(f.root + "/member-provision", {
        human: { ...human, id: "other" },
        role: "admin",
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await f.request(f.root + "/kit-create", {
        brandId: generatePlatformId("brand"),
        content: {},
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await f.request(f.root + "/kit-create", {
        brandId: f.input.brandId,
        content: { assets: [{ object: { bucket: "private", key: "secret" } }] },
      })
    ).status,
    400,
  );
  const row = f.db.rows("brand_kits")[0];
  row.workspaceId = generatePlatformId("workspace");
  assert.equal(
    (
      await f.request(f.root + "/kit-update", {
        id: row.id,
        expectedUpdatedAt: row.updatedAt.toISOString(),
        content: {},
      })
    ).status,
    404,
  );
});

test("workspace overview/profile and all scoped reads enforce application/workspace boundaries and optimistic edits", async (t) => {
  const f = await fixture(t);
  const overview = await f.request(f.root + "/overview");
  const changed = await f.request(f.root + "/profile", {
    name: "Renamed",
    expectedUpdatedAt: overview.body.workspace.updatedAt,
  });
  assert.equal(changed.status, 200);
  assert.equal(
    (await f.request(f.root + "/overview")).body.workspace.name,
    "Renamed",
  );
  assert.equal(
    (
      await f.request(f.root + "/profile", {
        name: "Stale",
        expectedUpdatedAt: overview.body.workspace.updatedAt,
      })
    ).status,
    409,
  );
  for (const view of [
    "overview",
    "brands",
    "integrations",
    "team",
    "capabilities",
    "enquiries",
  ]) {
    assert.equal((await f.request(f.root + "/" + view)).status, 200);
    assert.equal(
      (await f.request(f.root + "/" + view, undefined, f.vapp)).status,
      404,
    );
    assert.equal(
      (
        await f.request(
          `/api/v1/hvm/workspaces/${generatePlatformId("workspace")}/${view}`,
        )
      ).status,
      404,
    );
  }
  assert.equal((await f.request("/api/v1/people")).status, 404);
});

test("public configured mapping cannot fall back to internal CRM when Brand/workspace is unavailable", async (t) => {
  const f = await fixture(t);
  f.db.rows("brands")[0].workspaceId = generatePlatformId("workspace");
  const before = structuredClone(f.db.records);
  const result = await f.request(
    `/api/v1/public/products/${f.productId}/enquiries`,
    enquiry,
  );
  assert.equal(result.status, 503);
  assert.deepEqual(f.db.records, before);
});

test("first-client provisioning may create an explicitly named legal Organisation and rolls back all new records on failure", async (t) => {
  const f = await fixture(t);
  const db = new EnquiryMemoryDb();
  db.rows("schema_versions").push({ _id: "vapp-v1", version: 5 });
  const manifest = { ...f.input, organisationName: "Reviewed legal name" };
  db.failCollection = "brands";
  const before = structuredClone(db.records);
  await assert.rejects(provisionHvmClient(db.mongo, manifest, testIssuer));
  assert.deepEqual(db.records, before);
  db.failCollection = undefined;
  const result = await provisionHvmClient(db.mongo, manifest, testIssuer);
  assert.ok(result.createdIds.includes(manifest.organisationId));
  assert.equal(db.rows("organisations")[0].name, "Reviewed legal name");
  assert.deepEqual(
    (await provisionHvmClient(db.mongo, manifest, testIssuer)).createdIds,
    [],
  );
});

test("HVM auth enablement requires a distinct client and never falls back to Vapp", () => {
  const base = {
    ...authEnvironment,
    DEPLOYMENT_ENV: "test",
    MONGODB_URI: "mongodb://unused.invalid",
  };
  assert.equal(parseConfig(base).cognito.hvmClientId, undefined);
  assert.throws(
    () => parseConfig({ ...base, HVM_AUTH_ENABLED: "true" }),
    /HVM_COGNITO_CLIENT_ID/,
  );
  assert.throws(
    () =>
      parseConfig({
        ...base,
        HVM_AUTH_ENABLED: "true",
        HVM_COGNITO_CLIENT_ID: authEnvironment.COGNITO_CLIENT_ID,
      }),
    /must differ/,
  );
  assert.equal(
    parseConfig({
      ...base,
      HVM_AUTH_ENABLED: "false",
      HVM_COGNITO_CLIENT_ID: "hvmclient",
    }).cognito.hvmClientId,
    undefined,
  );
  assert.equal(
    parseConfig({
      ...base,
      HVM_AUTH_ENABLED: "true",
      HVM_COGNITO_CLIENT_ID: "hvmclient",
    }).cognito.hvmClientId,
    "hvmclient",
  );
  assert.throws(() => parseConfig({ ...base, HVM_CORS_ORIGINS: "*" }));
});

test("configured HVM browser origins receive CORS permission; unknown origins do not", async (t) => {
  const f = await fixture(t);
  for (const origin of ["https://app.h-v-m.agency", "http://localhost:5173"]) {
    const response = await fetch(f.url + "/api/v1/hvm/context", {
      headers: { origin, authorization: `Bearer ${f.token}` },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), origin);
  }
  const unknown = await fetch(f.url + "/api/v1/hvm/context", {
    headers: {
      origin: "https://unapproved.example",
      authorization: `Bearer ${f.token}`,
    },
  });
  assert.equal(unknown.headers.get("access-control-allow-origin"), null);
  const preflight = await fetch(f.url + "/api/v1/hvm/context", {
    method: "OPTIONS",
    headers: {
      origin: "https://app.h-v-m.agency",
      "access-control-request-method": "GET",
      "access-control-request-headers": "authorization",
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(
    preflight.headers.get("access-control-allow-origin"),
    "https://app.h-v-m.agency",
  );
  const publicResponse = await fetch(
    f.url + `/api/v1/public/products/${f.productId}/enquiries`,
    {
      method: "OPTIONS",
      headers: {
        origin: "https://app.h-v-m.agency",
        "access-control-request-method": "POST",
      },
    },
  );
  assert.equal(publicResponse.headers.get("access-control-allow-origin"), null);
});
