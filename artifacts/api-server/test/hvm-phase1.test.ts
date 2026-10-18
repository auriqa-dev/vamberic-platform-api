import sharp from "sharp";
import type { BrandImageStore } from "../src/services/brand-images";
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
const empressSubject = "00000000-0000-4000-8000-000000000001";
async function fixture(
  t: TestContext,
  empress = false,
  brandImages?: BrandImageStore,
  brandGenerator?: import("../src/services/brand-expression/generate").BrandGenerator,
) {
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
    HVM_EMPRESS_SUBJECTS: empress ? empressSubject : "",
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
    createApp(config, db.mongo, {
      jwtKeyResolver: auth.keyResolver,
      brandImages,
      brandGenerator,
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

test("provisioning validates optional Brand domain and never overwrites it on retry", async () => {
  const db = new EnquiryMemoryDb();
  db.rows("schema_versions").push({ _id: "vapp-v1", version: 5 });
  const input = {
    organisationId: generatePlatformId("org"),
    organisationName: "Example Ltd",
    workspaceId: generatePlatformId("workspace"),
    partnerId: generatePlatformId("partner"),
    partnerMembershipId: generatePlatformId("partnermembership"),
    assignmentId: generatePlatformId("partnerassignment"),
    brandId: generatePlatformId("brand"),
    clientMembershipId: generatePlatformId("workspacemembership"),
    workspaceName: "Example",
    partnerName: "Example",
    brandName: "Example",
    brandSlug: "example",
    brandPrimaryDomain: "example.test",
    human,
  };
  const empty = structuredClone(db.records);
  for (const domain of [
    "https://example.test",
    "example.test/path",
    "",
    "bad domain",
  ]) {
    await assert.rejects(
      provisionHvmClient(
        db.mongo,
        { ...input, brandPrimaryDomain: domain },
        testIssuer,
      ),
    );
    assert.deepEqual(db.records, empty);
  }
  await provisionHvmClient(db.mongo, input, testIssuer);
  assert.equal(db.rows("brands")[0].primaryDomain, "example.test");
  const before = structuredClone(db.records);
  assert.deepEqual(
    (await provisionHvmClient(db.mongo, input, testIssuer)).createdIds,
    [],
  );
  await assert.rejects(
    provisionHvmClient(
      db.mongo,
      { ...input, brandPrimaryDomain: "other.test" },
      testIssuer,
    ),
    /identity\/state conflict/,
  );
  assert.deepEqual(db.records, before);
  const { brandPrimaryDomain, ...legacyInput } = input;
  void brandPrimaryDomain;
  assert.deepEqual(
    (await provisionHvmClient(db.mongo, legacyInput, testIssuer)).createdIds,
    [],
  );
  assert.deepEqual(db.records, before);
  delete db.rows("brands")[0].primaryDomain;
  await assert.rejects(
    provisionHvmClient(db.mongo, input, testIssuer),
    /identity\/state conflict/,
  );
  assert.equal(db.rows("brands")[0].primaryDomain, undefined);
});

for (const scenario of [
  { name: "no authority", empress: false, queen: false, client: false },
  { name: "Empress only", empress: true, queen: false, client: false },
  { name: "Queen owner only", empress: false, queen: true, client: false },
  { name: "client admin only", empress: false, queen: false, client: true },
  { name: "Empress and Queen", empress: true, queen: true, client: false },
  {
    name: "Empress, Queen and client",
    empress: true,
    queen: true,
    client: true,
  },
  {
    name: "Partner member/onboarder",
    empress: false,
    queen: true,
    client: false,
    member: true,
  },
]) {
  test(`context independently discovers ${scenario.name}`, async (t) => {
    const f = await fixture(t, scenario.empress);
    f.db.rows("schema_versions")[0].version = 9;
    const partnerMembership = f.db.rows("hvm_partner_memberships")[0];
    const clientMembership = f.db.rows("workspace_memberships")[0];
    partnerMembership.human = { ...human, id: empressSubject };
    clientMembership.human = { ...human, id: empressSubject };
    if (!scenario.queen) f.db.rows("hvm_partner_memberships").length = 0;
    if (!scenario.client) f.db.rows("workspace_memberships").length = 0;
    if (scenario.member) partnerMembership.role = "member";
    const token = await f.auth.sign({
      client_id: "hvmclient",
      sub: empressSubject,
    });
    const result = await f.request("/api/v1/hvm/context", undefined, token);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, {
      application: "hvmapp",
      human: { ...human, id: empressSubject },
      platform: { empress: scenario.empress },
      partners: scenario.queen
        ? [
            {
              id: f.input.partnerId,
              displayName: "Agency",
              role: scenario.member ? "member" : "owner",
              workspaceIds: [f.input.workspaceId],
            },
          ]
        : [],
      clients: scenario.client
        ? [{ workspaceId: f.input.workspaceId, role: "admin" }]
        : [],
      workspaces:
        scenario.queen || scenario.client
          ? [
              {
                id: f.input.workspaceId,
                name: "Client",
                role: scenario.member ? "onboarder" : "admin",
              },
            ]
          : [],
    });
    // Context is not a grant: endpoints independently enforce both authorities.
    assert.equal(
      (
        await f.request(
          "/api/v1/hvm/empress/agent-definitions",
          undefined,
          token,
        )
      ).status,
      scenario.empress ? 200 : 404,
    );
    assert.equal(
      (await f.request(f.root + "/operating/client-agents", undefined, token))
        .status,
      scenario.queen || scenario.client ? 200 : 404,
    );
  });
}

test("context ignores claimed Empress authority and refreshes after trusted configuration revocation", async (t) => {
  const f = await fixture(t, true);
  const token = await f.auth.sign({
    client_id: "hvmclient",
    sub: empressSubject,
    empress: true,
    platform: { empress: true },
  });
  assert.deepEqual(
    (await f.request("/api/v1/hvm/context", undefined, token)).body.platform,
    { empress: true },
  );
  // Simulate the current process receiving replacement trusted configuration.
  // Production environment changes require the normal process reload.
  f.config.empressSubjects = [];
  const refreshed = await f.request(
    "/api/v1/hvm/context?empress=true",
    undefined,
    token,
    { "x-empress": "true" },
  );
  assert.equal(refreshed.status, 200);
  assert.deepEqual(refreshed.body.platform, { empress: false });
  assert.deepEqual(refreshed.body.workspaces, []);
  assert.equal(
    (await f.request("/api/v1/hvm/empress/agent-definitions", undefined, token))
      .status,
    404,
  );
});

test("brand images publish immediately, retain prior content, replay safely and enforce scope", async (t) => {
  const stored = new Map<string, Buffer>();
  const store: BrandImageStore = {
    bucket: "brand-images-test",
    async put(key, bytes) {
      stored.set(key, bytes);
      return "version1";
    },
    async get(key, version) {
      assert.equal(version, "version1");
      return stored.get(key)!;
    },
  };
  const f = await fixture(t, false, store);
  const root = `${f.root}/brands/${f.input.brandId}`;
  const bytes = await sharp({
    create: { width: 2, height: 2, channels: 4, background: "#ff000080" },
  })
    .png()
    .toBuffer();
  const input = {
    expectedKitId: null,
    name: "Logo",
    type: "logo",
    contentType: "image/png",
    base64: bytes.toString("base64"),
  };
  const upload = await f.request(root + "/images", input);
  assert.equal(upload.status, 201);
  const kits = f.db.rows("brand_kits");
  assert.equal(kits.length, 1);
  assert.equal(kits[0].status, "approved");
  assert.equal(kits[0].assets.length, 1);
  const digest = kits[0].assets[0].object.key
    .split("/")
    .at(-1)
    .replace(".png", "");
  const download = await f.request(
    root + `/kits/${upload.body.id}/images/${digest}`,
  );
  assert.equal(download.status, 200);
  assert.equal(download.body.contentType, "image/png");
  assert.equal((await f.request(root + "/images", input)).status, 200);
  assert.equal(kits.length, 1);
  assert.equal(stored.size, 1);
  assert.equal(
    (await f.request(root + "/images", { ...input, name: "Changed" })).status,
    409,
  );
  const replacement = await f.request(root + "/images", {
    ...input,
    name: "Photo",
    type: "photography",
    expectedKitId: upload.body.id,
    expectedUpdatedAt: upload.body.updatedAt,
  });
  assert.equal(replacement.status, 201);
  assert.equal(kits.length, 2);
  assert.equal(kits[0].status, "retired");
  assert.equal(kits[1].assets.length, 2);
  assert.equal(kits.filter((k) => k.status === "approved").length, 1);
  const photoDigest = kits[1].assets[1].object.key
    .split("/")
    .at(-1)
    .replace(".png", "");
  const edit = {
    operation: "update",
    expectedKitId: replacement.body.id,
    expectedUpdatedAt: replacement.body.updatedAt,
    imageId: digest,
    name: "Renamed logo",
    type: "logo",
    altText: "Accessible description",
  };
  const edited = await f.request(root + "/images", edit);
  assert.equal(edited.status, 201);
  let currentKit = kits.find((k) => k.status === "approved");
  assert.equal(currentKit.assets.length, 2);
  assert.equal(currentKit.assets[0].name, "Renamed logo");
  assert.equal(currentKit.assets[0].altText, "Accessible description");
  assert.equal(stored.size, 2, "Metadata edits do not upload new bytes");
  assert.equal(
    (await f.request(root + "/images", edit)).status,
    409,
    "Stale edit cannot overwrite",
  );
  const replaced = await f.request(root + "/images", {
    ...edit,
    name: "Replacement logo",
    expectedKitId: edited.body.id,
    expectedUpdatedAt: edited.body.updatedAt,
    contentType: input.contentType,
    base64: input.base64,
  });
  assert.equal(replaced.status, 201);
  currentKit = kits.find((k) => k.status === "approved");
  assert.equal(currentKit.assets.length, 2, "Replace does not append an image");
  const newDigest = currentKit.assets[0].object.key
    .split("/")
    .at(-1)
    .replace(".png", "");
  assert.notEqual(newDigest, digest);
  assert.equal(
    (await f.request(root + `/kits/${replaced.body.id}/images/${newDigest}`))
      .status,
    200,
  );
  const bulk = await f.request(root + "/images", {
    operation: "bulk-update",
    imageIds: [newDigest, photoDigest],
    type: "graphic",
    expectedKitId: replaced.body.id,
    expectedUpdatedAt: replaced.body.updatedAt,
  });
  assert.equal(bulk.status, 201);
  assert.ok(
    f.db
      .rows("brand_kits")
      .find((k) => k.status === "approved")
      .assets.every((a) => a.type === "graphic"),
  );
  const deletion = {
    operation: "bulk-delete",
    expectedKitId: bulk.body.id,
    expectedUpdatedAt: bulk.body.updatedAt,
    imageIds: [photoDigest],
  };
  assert.equal(
    (
      await f.request(
        `${f.root}/brands/${generatePlatformId("brand")}/images`,
        deletion,
      )
    ).status,
    404,
  );
  assert.equal(
    (await f.request(root + "/images", deletion, f.vapp)).status,
    404,
  );
  f.db.failCollection = "events";
  const beforeDelete = structuredClone(kits);
  assert.equal((await f.request(root + "/images", deletion)).status, 503);
  assert.deepEqual(
    f.db.rows("brand_kits"),
    beforeDelete,
    "Failed removal rolls back",
  );
  f.db.failCollection = undefined;
  const removed = await f.request(root + "/images", deletion);
  assert.equal(removed.status, 201);
  currentKit = f.db.rows("brand_kits").find((k) => k.status === "approved");
  assert.equal(currentKit.assets.length, 1);
  assert.equal(currentKit.assets[0].name, "Replacement logo");
  assert.equal(
    (await f.request(root + `/kits/${removed.body.id}/images/${photoDigest}`))
      .status,
    404,
  );
  assert.equal(
    stored.size,
    3,
    "Private historical objects retained for recovery",
  );
  assert.equal((await f.request(root + "/images", deletion)).status, 409);
  const beforeFailure = structuredClone(f.db.rows("brand_kits"));
  f.db.failCollection = "events";
  const failed = await f.request(root + "/images", {
    ...input,
    name: "Transactional failure",
    expectedKitId: removed.body.id,
    expectedUpdatedAt: removed.body.updatedAt,
  });
  assert.equal(failed.status, 503);
  assert.deepEqual(f.db.rows("brand_kits"), beforeFailure);
  f.db.failCollection = undefined;

  assert.equal((await f.request(root + "/images", input, f.vapp)).status, 404);
  const otherBrand = generatePlatformId("brand");
  assert.equal(
    (await f.request(`${f.root}/brands/${otherBrand}/images`, input)).status,
    404,
  );
  const membership = f.db.rows("workspace_memberships")[0];
  membership.role = "viewer";
  // End the Queen assignment too; the same human can have both independent roles.
  for (const a of f.db.rows("workspace_partner_assignments"))
    a.status = "ended";
  const denied = await f.request(root + "/images", {
    ...input,
    name: "Denied",
  });
  assert.equal(denied.status, 404);
  assert.equal(
    (
      await f.request(root + "/images", {
        ...deletion,
        expectedKitId: removed.body.id,
        expectedUpdatedAt: removed.body.updatedAt,
        imageId: newDigest,
      })
    ).status,
    404,
  );
});

test("Brand Kit sections save immediately, retain other content, reject stale and cross-scope writes and roll back atomically", async (t) => {
  const f = await fixture(t);
  const inputs = {
    colours: [{ role: "primary", name: "Plum", hex: "#663366" }],
    typography: [{ role: "heading", family: "Arial", weights: [400, 700] }],
    visualRules: { layout: "Use a clear grid", do: ["Leave space"] },
    voice: { descriptors: ["Clear"], writingStyle: "Direct and helpful" },
    terminology: { use: ["Energy intelligence"], avoid: ["Magic"] },
    descriptions: { short: "Independent energy analysis" },
    imageryGuidance: { photography: "Use real buildings" },
    emailDefaults: { fromDisplayName: "Built Matters", signature: "The team" },
  };
  let latest: { id: string; updatedAt: string } | undefined;
  const save = (content: unknown, extra = {}) =>
    f.request(f.root + "/kit-save", {
      brandId: f.input.brandId,
      expectedKitId: latest?.id ?? null,
      expectedUpdatedAt: latest?.updatedAt,
      content,
      ...extra,
    });
  for (const [key, value] of Object.entries(inputs)) {
    const result = await save({ [key]: value });
    assert.equal(result.status, 200);
    latest = result.body;
    const current = f.db
      .rows("brand_kits")
      .filter((k) => k.status === "approved");
    assert.equal(current.length, 1);
    assert.deepEqual(current[0][key], value);
  }
  const current = f.db.rows("brand_kits").find((k) => k.status === "approved")!;
  for (const [key, value] of Object.entries(inputs))
    assert.deepEqual(current[key], value);
  current.assets = [
    {
      type: "logo",
      name: "Existing logo",
      status: "approved",
      object: {
        store: "s3",
        bucket: "brand-images-test",
        key: "retained.png",
        versionId: "v1",
      },
    },
  ];
  const before = structuredClone(current.assets);
  const changed = await save({ colours: [] });
  assert.equal(changed.status, 200);
  assert.deepEqual(
    f.db.rows("brand_kits").find((k) => k.status === "approved")!.assets,
    before,
  );
  assert.equal((await save({ voice: { writingStyle: "Stale" } })).status, 409);
  latest = changed.body;
  assert.equal(
    (
      await save({
        colours: [{ role: "primary", name: "Invalid", hex: "javascript:bad" }],
      })
    ).status,
    400,
  );
  assert.equal((await save({ assets: [] })).status, 400);
  assert.equal((await save({ voice: {}, terminology: {} })).status, 400);
  assert.equal(
    (
      await save({
        emailDefaults: { replyToContactPointId: generatePlatformId("contact") },
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await save({
        descriptions: {
          products: [
            {
              productId: generatePlatformId("product"),
              description: "Foreign",
            },
          ],
        },
      })
    ).status,
    404,
  );
  assert.equal(
    (await save({ voice: {} }, { brandId: generatePlatformId("brand") }))
      .status,
    409,
  );
  const beforeFailure = structuredClone(f.db.rows("brand_kits"));
  f.db.failCollection = "events";
  assert.equal(
    (await save({ voice: { writingStyle: "Must roll back" } })).status,
    503,
  );
  assert.deepEqual(f.db.rows("brand_kits"), beforeFailure);
  f.db.failCollection = undefined;
  f.db.rows("workspace_memberships")[0].role = "viewer";
  for (const a of f.db.rows("workspace_partner_assignments"))
    a.status = "ended";
  assert.equal((await save({ voice: {} })).status, 404);
});

test("brand read carries stored onboarding website only for its exact brand and preserves corrections", async (t) => {
  const f = await fixture(t);
  f.db.rows("client_onboardings").push({
    result: { workspaceId: f.input.workspaceId, brandId: f.input.brandId },
    details: { intake: { websiteUrl: "https://www.odyssiant.ai/" } },
  });
  const response = await f.request(f.root + "/brands");
  assert.equal(response.status, 200);
  assert.equal(response.body.brands[0].primaryDomain, "www.odyssiant.ai");
  assert.equal(f.db.rows("brands")[0].primaryDomain, undefined);
  f.db.rows("brands")[0].primaryDomain = "corrected.example";
  const corrected = await f.request(f.root + "/brands");
  assert.equal(corrected.body.brands[0].primaryDomain, "corrected.example");
});

import { expressionDefaults } from "../src/domain/brand-expression";
for (const schemaVersion of [25, 26, 27])
  test(`brand expression keeps independent approval, preserves kit history, reads fresh brand context and fences stale/foreign writes (schema ${schemaVersion})`, async (t) => {
    const f = await fixture(t);
    f.db.rows("schema_versions")[0]!.version = schemaVersion;
    const call = (op: string, body: unknown) =>
      f.request(f.root + "/kit-expression-" + op, body);
    const base = {
      brandId: f.input.brandId,
      expectedKitId: null,
      dimension: "tone",
      content: {
        ...expressionDefaults.tone,
        defaultTone: "Clear and direct",
        variations: [{ context: "email", guidance: "Brief and personal" }],
      },
    };
    const saved = await call("save", base);
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const contextPath =
      f.root + `/brands/${f.input.brandId}/expression/context?format=email`;
    assert.equal((await f.request(contextPath)).body.context.tone, null);
    const approved = await call("approve", {
      brandId: f.input.brandId,
      expectedKitId: saved.body.id,
      expectedUpdatedAt: saved.body.updatedAt,
      dimension: "tone",
    });
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    assert.equal(
      (await f.request(contextPath)).body.context.tone.guidance,
      "Brief and personal",
    );
    const next = await call("save", {
      ...base,
      expectedKitId: approved.body.id,
      expectedUpdatedAt: approved.body.updatedAt,
      content: { ...base.content, defaultTone: "DRAFT" },
    });
    assert.equal(next.status, 200);
    assert.equal(
      (await f.request(contextPath)).body.context.tone.defaultTone,
      "Clear and direct",
    );
    assert.equal((await call("save", base)).status, 409);
    const personality = await call("save", {
      ...base,
      expectedKitId: next.body.id,
      expectedUpdatedAt: next.body.updatedAt,
      dimension: "personality",
      content: { ...expressionDefaults.personality, character: "Curious" },
    });
    assert.equal(personality.status, 200);
    const final = await call("approve", {
      brandId: f.input.brandId,
      expectedKitId: personality.body.id,
      expectedUpdatedAt: personality.body.updatedAt,
      dimension: "personality",
    });
    assert.equal(final.status, 200);
    const ctx = (await f.request(contextPath)).body.context;
    assert.equal(ctx.personality.character, "Curious");
    assert.equal(ctx.tone.defaultTone, "Clear and direct");
    assert.equal(
      f.db.rows("brand_kits").filter((x) => x.status === "approved").length,
      1,
    );
    assert.equal(
      f.db.rows("brand_kits").filter((x) => x.status === "retired").length,
      4,
    );
    assert.equal(
      (
        await f.request(
          f.root +
            `/brands/${generatePlatformId("brand")}/expression/context?format=email`,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await f.request(
          contextPath.replace(
            f.input.workspaceId,
            generatePlatformId("workspace"),
          ),
        )
      ).status,
      403,
    );
    const discarded = await call("remove", {
      brandId: f.input.brandId,
      expectedKitId: final.body.id,
      expectedUpdatedAt: final.body.updatedAt,
      dimension: "tone",
      target: "draft",
    });
    assert.equal(discarded.status, 200);
    assert.equal(
      (await f.request(contextPath)).body.context.tone.defaultTone,
      "Clear and direct",
    );
    const removed = await call("remove", {
      brandId: f.input.brandId,
      expectedKitId: discarded.body.id,
      expectedUpdatedAt: discarded.body.updatedAt,
      dimension: "tone",
      target: "approved",
    });
    assert.equal(removed.status, 200);
    assert.equal((await f.request(contextPath)).body.context.tone, null);
    assert.equal(
      (await f.request(contextPath)).body.context.personality.character,
      "Curious",
    );
    assert.equal(
      (
        await call("remove", {
          brandId: f.input.brandId,
          expectedKitId: discarded.body.id,
          expectedUpdatedAt: discarded.body.updatedAt,
          dimension: "personality",
          target: "approved",
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await call("remove", {
          brandId: generatePlatformId("brand"),
          expectedKitId: removed.body.id,
          expectedUpdatedAt: removed.body.updatedAt,
          dimension: "personality",
          target: "approved",
        })
      ).status,
      409,
    );
  });

for (const schemaVersion of [25, 26, 27])
  test(`brand interpretation and preview reuse scoped jobs, retain lineage and usage, and never approve settings (schema ${schemaVersion})`, async (t) => {
    const inputs: import("../src/services/brand-expression/generate").BrandGenerationInput[] =
      [];
    const f = await fixture(t, false, undefined, async (input) => {
      inputs.push(input);
      return {
        result:
          input.mode === "interpret"
            ? { settings: expressionDefaults }
            : { sample: "A short sample" },
        usage: { model: "fixture", inputTokens: 10, outputTokens: 20 },
      };
    });
    f.db.rows("schema_versions")[0]!.version = schemaVersion;
    const root = f.root + `/brands/${f.input.brandId}/expression/generations`;
    const input = {
      requestKey: crypto.randomUUID(),
      mode: "interpret",
      description: "We are curious",
      format: "website",
      useDrafts: false,
    };
    const started = await f.request(root, input);
    assert.equal(started.status, 202, JSON.stringify(started.body));
    let result;
    for (let i = 0; i < 30; i++) {
      result = await f.request(root + "/" + started.body.id);
      if (result.body.status !== "generating") break;
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal(result!.body.status, "completed", JSON.stringify(result));
    assert.equal(result!.body.usage.inputTokens, 10);
    assert.equal(f.db.rows("brand_kits").length, 0);
    assert.equal((await f.request(root, input)).body.id, started.body.id);
    assert.equal(inputs.length, 1);
    assert.equal(
      (await f.request(root, { ...input, description: "Changed" })).status,
      409,
    );
    const saved = await f.request(f.root + "/kit-expression-save", {
      brandId: f.input.brandId,
      expectedKitId: null,
      dimension: "personality",
      content: { ...expressionDefaults.personality, character: "Human edited" },
      originalDescription: input.description,
      sourceGenerationId: started.body.id,
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const draft = f.db.rows("brand_kits")[0]!.expression.personality.draft;
    assert.equal(draft.content.character, "Human edited");
    assert.equal(draft.proposedContent.character, "");
    assert.equal(
      f.db.rows("brand_kits")[0]!.expression.personality.approved,
      undefined,
    );
    const preview = await f.request(root, {
      ...input,
      requestKey: crypto.randomUUID(),
      mode: "preview",
      description: "Our company",
      useDrafts: true,
    });
    assert.equal(preview.status, 202);
    for (let i = 0; i < 30; i++) {
      result = await f.request(root + "/" + preview.body.id);
      if (result.body.status !== "generating") break;
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal(result!.body.result.sample, "A short sample");
    assert.equal(
      (inputs[1]!.context as { personality: { character: string } }).personality
        .character,
      "Human edited",
    );
    assert.equal(f.db.rows("brand_kits").length, 1);
  });

test("client-managed provisioning creates no Queen and direct client admin can manage Brand Kit without platform power", async (t) => {
  const f = await fixture(t);
  f.db.rows("schema_versions")[0]!.version = 25;
  const input = {
    management: "client",
    organisationId: generatePlatformId("org"),
    organisationName: "Self service company",
    workspaceId: generatePlatformId("workspace"),
    brandId: generatePlatformId("brand"),
    clientMembershipId: generatePlatformId("workspacemembership"),
    workspaceName: "Self service",
    brandName: "Own brand",
    brandSlug: "own",
    human: { ...human, id: "client-only" },
  };
  const partners = f.db.rows("hvm_partners").length,
    assignments = f.db.rows("workspace_partner_assignments").length;
  await provisionHvmClient(f.db.mongo, input, testIssuer);
  await provisionHvmClient(f.db.mongo, input, testIssuer);
  assert.equal(f.db.rows("hvm_partners").length, partners);
  assert.equal(f.db.rows("workspace_partner_assignments").length, assignments);
  const token = await f.auth.sign({
    client_id: "hvmclient",
    sub: "client-only",
  });
  const context = await f.request("/api/v1/hvm/context", undefined, token);
  assert.equal(context.body.partners.length, 0);
  assert.equal(context.body.clients[0].role, "admin");
  assert.equal(context.body.platform.empress, false);
  const root = `/api/v1/hvm/workspaces/${input.workspaceId}`;
  const draft = await f.request(
    root + "/kit-expression-save",
    {
      brandId: input.brandId,
      expectedKitId: null,
      dimension: "personality",
      content: { ...expressionDefaults.personality, character: "Independent" },
    },
    token,
  );
  assert.equal(draft.status, 200, JSON.stringify(draft.body));
  assert.equal(
    (
      await f.request(
        root + "/kit-expression-approve",
        {
          brandId: input.brandId,
          expectedKitId: draft.body.id,
          expectedUpdatedAt: draft.body.updatedAt,
          dimension: "personality",
        },
        token,
      )
    ).status,
    200,
  );
  assert.equal(
    (await f.request(f.root + "/team", undefined, token)).status,
    404,
  );
  assert.equal(
    (await f.request(root + "/team", undefined, token)).body.management,
    "client",
  );
  assert.equal(f.db.rows("workspace_billing").length, 0);
});

test("management handovers keep identity, end old Queen access, retain client admin and reject member or stale changes", async (t) => {
  const f = await fixture(t);
  const direct = await f.auth.sign({
    client_id: "hvmclient",
    sub: "direct-admin",
  });
  f.db.rows("workspace_memberships").push(
    WorkspaceMembershipSchema.parse({
      ...dates,
      id: generatePlatformId("workspacemembership"),
      workspaceId: f.input.workspaceId,
      human: { ...human, id: "direct-admin" },
      role: "admin",
      status: "active",
      joinedAt: dates.createdAt,
    }),
  );
  // Original user is exclusively the managing Queen for this check.
  f.db.rows("workspace_memberships").splice(0, 1);
  const team = await f.request(f.root + "/team", undefined, direct);
  assert.equal(team.body.canChangeManagement, true);
  const change = {
    management: "client",
    expectedUpdatedAt: team.body.updatedAt,
    confirm: true,
  };
  assert.equal(
    (await f.request(f.root + "/management-change", change)).status,
    404,
  );
  const fresh = await f.request(f.root + "/team", undefined, direct);
  assert.equal(
    (
      await f.request(
        f.root + "/management-change",
        { ...change, expectedUpdatedAt: fresh.body.updatedAt },
        direct,
      )
    ).status,
    200,
  );
  assert.equal((await f.request(f.root + "/team")).status, 404);
  assert.equal(
    (await f.request(f.root + "/team", undefined, direct)).body.management,
    "client",
  );
  assert.equal(f.db.rows("workspace_partner_assignments")[0].status, "ended");
  assert.equal(f.db.rows("brands")[0].id, f.input.brandId);
  assert.equal(
    f.db.rows("crm_workspaces")[0].clientOrganisationId,
    f.input.organisationId,
  );
  assert.equal(
    (await f.request(f.root + "/management-change", change, direct)).status,
    409,
  );
  const now = await f.request(f.root + "/team", undefined, direct);
  assert.equal(
    (
      await f.request(
        f.root + "/management-change",
        {
          management: "queen",
          partnerId: f.input.partnerId,
          confirm: true,
          expectedUpdatedAt: now.body.updatedAt,
        },
        direct,
      )
    ).status,
    200,
  );
  assert.equal((await f.request(f.root + "/team")).status, 200);
  const admin = f.db
    .rows("workspace_memberships")
    .find((m) => m.human.id === "direct-admin")!;
  assert.equal(
    (
      await f.request(f.root + "/member-revoke", {
        id: admin.id,
        expectedUpdatedAt: admin.updatedAt.toISOString(),
      })
    ).status,
    409,
  );
  assert.equal(
    f.db
      .rows("events")
      .filter((e) => e.eventType === "workspace_management_changed").length,
    2,
  );
  f.db.rows("workspace_memberships").push(
    WorkspaceMembershipSchema.parse({
      ...dates,
      id: generatePlatformId("workspacemembership"),
      workspaceId: f.input.workspaceId,
      human: { ...human, id: "reader" },
      role: "member",
      status: "active",
      joinedAt: dates.createdAt,
    }),
  );
  const reader = await f.auth.sign({ client_id: "hvmclient", sub: "reader" });
  assert.equal(
    (await f.request(f.root + "/team", undefined, reader)).body.canManage,
    false,
  );
  assert.equal(
    (
      await f.request(
        f.root + "/member-provision",
        { human: { ...human, id: "reader" }, role: "admin" },
        reader,
      )
    ).status,
    404,
  );
  assert.equal(
    (await f.request(f.root + "/management-change", change, reader)).status,
    404,
  );
  assert.equal(
    (
      await f.request(
        f.root + "/kit-save",
        {
          brandId: f.input.brandId,
          expectedKitId: null,
          content: { voice: { writingStyle: "Changed" } },
        },
        reader,
      )
    ).status,
    404,
  );
});

test("currency reference data is shared read-only metadata behind HVM authentication", async (t) => {
  const f = await fixture(t);
  f.db
    .rows("ref_currencies")
    .push(
      { code: "GBP", name: "Pound Sterling", minorUnits: 2, is_active: true },
      { code: "JPY", name: "Yen", minorUnits: 0, is_active: true },
      { code: "XXX", name: "No currency", minorUnits: null, is_active: true },
      { code: "OLD", name: "Inactive", minorUnits: 2, is_active: false },
    );
  const r = await f.request("/api/v1/hvm/reference-data/currencies");
  assert.equal(r.status, 200);
  assert.equal(r.body.currencies.length, 3);
  assert.deepEqual(
    r.body.currencies.find((c: { code: string }) => c.code === "JPY"),
    { code: "JPY", name: "Yen", minorUnits: 0, selectable: true },
  );
  assert.equal(
    r.body.currencies.find((c: { code: string }) => c.code === "XXX")
      .selectable,
    false,
  );
  assert.equal(
    (
      await f.request(
        "/api/v1/hvm/reference-data/currencies",
        undefined,
        f.vapp,
      )
    ).status,
    404,
  );
});

test("authenticated client admin and delegated Queen can open all core workspace screens without cross-tenant access", async (t) => {
  const f = await fixture(t);
  f.db.rows("schema_versions")[0]!.version = 28;
  const client = {
    management: "client" as const,
    organisationId: generatePlatformId("org"),
    organisationName: "Isolated client",
    workspaceId: generatePlatformId("workspace"),
    brandId: generatePlatformId("brand"),
    clientMembershipId: generatePlatformId("workspacemembership"),
    workspaceName: "Client only",
    brandName: "Client brand",
    brandSlug: "client-only",
    human: { ...human, id: "client-only-check" },
  };
  await provisionHvmClient(f.db.mongo, client, testIssuer);
  const token = await f.auth.sign({
    client_id: "hvmclient",
    sub: client.human.id,
  });
  for (const role of [
    {
      name: "client admin",
      token,
      own: client.workspaceId,
      other: f.input.workspaceId,
      brand: client.brandId,
    },
    {
      name: "delegated Queen",
      token: f.token,
      own: f.input.workspaceId,
      other: client.workspaceId,
      brand: f.input.brandId,
    },
  ]) {
    for (const suffix of [
      "/overview",
      "/brands",
      "/team",
      "/integrations",
      "/psu",
      "/psu/reference-data",
      "/offer-architecture/permissions",
      "/research",
      "/content-strategy",
      "/content-strategy/library/discovery",
      "/icp/examples?type=company",
    ]) {
      const own = await f.request(
        `/api/v1/hvm/workspaces/${role.own}${suffix}`,
        undefined,
        role.token,
      );
      assert.equal(
        own.status,
        200,
        `${role.name} ${suffix}: ${JSON.stringify(own.body)}`,
      );
      const foreign = await f.request(
        `/api/v1/hvm/workspaces/${role.other}${suffix}`,
        undefined,
        role.token,
      );
      assert.equal(
        foreign.status,
        404,
        `${role.name} foreign ${suffix}: ${JSON.stringify(foreign.body)}`,
      );
    }
    for (const [kind, fields] of [
      [
        "contacts",
        {
          firstName: "QA",
          lastName: "Example",
          title: "",
          phone: "",
          email: "qa@example.test",
          organisationId: "",
        },
      ],
      [
        "organisations",
        {
          name: "QA organisation",
          website: "https://example.test",
          type: "prospect",
          industry: "",
          country: "",
          region: "",
          description: "",
        },
      ],
    ] as const) {
      const ownRoot = `/api/v1/hvm/workspaces/${role.own}/records/${kind}`;
      const created = await f.request(
        ownRoot + "/create",
        { fields },
        role.token,
      );
      assert.equal(
        created.status,
        201,
        `${role.name} create ${kind}: ${JSON.stringify(created.body)}`,
      );
      assert.equal(
        (
          await f.request(
            ownRoot + "/" + created.body.id,
            undefined,
            role.token,
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await f.request(
            `/api/v1/hvm/workspaces/${role.other}/records/${kind}/${created.body.id}`,
            undefined,
            role.token,
          )
        ).status,
        404,
      );
    }
    const context = await f.request(
      "/api/v1/hvm/context",
      undefined,
      role.token,
    );
    assert.equal(context.body.platform.empress, false);
  }
  assert.equal(f.db.rows("workspace_billing").length, 0);
  assert.equal(f.db.rows("workspace_integrations").length, 0);
});
