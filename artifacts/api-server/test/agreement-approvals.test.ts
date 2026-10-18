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
async function fixture(t: TestContext) {
  const db = new EnquiryMemoryDb();
  db.rows("schema_versions").push({ _id: "vapp-v1", version: 9 });
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
      id: "00000000-0000-4000-8000-000000000001",
    },
  };
  await provisionHvmClient(db.mongo, input, testIssuer);
  const config = parseConfig({
    ...authEnvironment,
    HVM_COGNITO_CLIENT_ID: "hvmclient",
    HVM_EMPRESS_SUBJECTS: "00000000-0000-4000-8000-000000000001",
    HVM_CORS_ORIGINS: "https://app.h-v-m.agency",
    DEPLOYMENT_ENV: "test",
    MONGODB_URI: "mongodb://unused.invalid",
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
  const token = await auth.sign({
    client_id: "hvmclient",
    sub: input.human.id,
  });
  const vapp = await auth.sign();
  const root = `/api/v1/hvm/workspaces/${input.workspaceId}`;
  async function request(path: string, body?: unknown, bearer = token) {
    const response = await fetch(url + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        authorization: `Bearer ${bearer}`,
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  }
  return { db, config, input, auth, root, request, token, vapp };
}
import { operatingFixtures } from "./helpers/operating-fixtures";
import { evaluateCommercialDecision } from "../src/domain/operating-logic";
import { OperatingSchemas } from "../src/domain/operating";
import {
  ApprovalReview,
  ApprovalPage,
} from "../src/services/agreement-approval-contract";
const root = "/api/v1/hvm/empress/agreement-approvals";
async function pendingFixture(t: TestContext, treatment = "internal") {
  const f = await fixture(t);
  const rows = operatingFixtures();
  for (const [collection, source] of Object.entries(rows)) {
    const row = structuredClone(source);
    if (row.workspaceId) row.workspaceId = f.input.workspaceId;
    if (collection === "client_swarms") row.status = "configured";
    if (collection === "swarm_agreements") {
      row.data.decision.treatment = treatment;
      row.data.recommendationSnapshot.assumptions = [
        "PRIVATE_WORKSPACE_CONTENT",
      ];
      row.data.recommendationSnapshot.configurationSnapshot.swarm.description =
        "PRIVATE_AGENT_CONFIGURATION";
      Object.assign(
        row.data,
        evaluateCommercialDecision(
          row.data.decision,
          row.data.recommendationSnapshot,
        ),
      );
    }
    f.db
      .rows(collection)
      .push(
        OperatingSchemas[collection as keyof typeof OperatingSchemas].parse(
          row,
        ),
      );
  }
  const agreement = f.db.rows("swarm_agreements")[0];
  const approve = (overrides = {}) => ({
    expectedUpdatedAt: agreement.updatedAt.toISOString(),
    reason: "Explicit commercial exception",
    ...overrides,
  });
  return { ...f, agreement, approve };
}
function empressOnly(f: Awaited<ReturnType<typeof pendingFixture>>) {
  f.db.rows("hvm_partner_memberships").length = 0;
  f.db.rows("workspace_partner_assignments").length = 0;
  f.db.rows("workspace_memberships").length = 0;
}

for (const treatment of ["internal", "waived"]) {
  test(`Empress can review historical ${treatment} agreements but cannot reactivate retired approval`, async (t) => {
    const f = await pendingFixture(t, treatment);
    empressOnly(f);
    const before = structuredClone(f.db.records);
    const list = await f.request(root);
    assert.equal(list.status, 200);
    ApprovalPage.parse(list.body);
    assert.equal(list.body.items.length, 1);
    const detail = await f.request(`${root}/${f.agreement.id}`);
    assert.equal(detail.status, 200);
    ApprovalReview.parse(detail.body);
    assert.deepEqual(detail.body, list.body.items[0]);
    assert.equal(detail.body.policy.result, "requires_empress_approval");
    assert.ok(!JSON.stringify(detail.body).includes("PRIVATE_"));
    for (const path of [
      "client-swarms",
      "client-agents",
      "swarm-agreements",
      "pricing-recommendations",
    ])
      assert.equal(
        (await f.request(f.root + "/operating/" + path)).status,
        404,
      );
    const responses = await Promise.all([
      f.request(`${root}/${f.agreement.id}/approve`, f.approve()),
      f.request(`${root}/${f.agreement.id}/approve`, f.approve()),
      f.request(f.root + "/operating/swarm-agreements/empress-approve", {
        id: f.agreement.id,
        ...f.approve(),
      }),
    ]);
    for (const response of responses) assert.equal(response.status, 404);
    assert.deepEqual(f.db.records, before);
  });
}
for (const role of [
  "queen",
  "partner-member",
  "client-admin",
  "client-member",
  "unaffiliated",
]) {
  test(`${role} cannot discover, read or approve exceptional agreements`, async (t) => {
    const f = await pendingFixture(t);
    f.config.empressSubjects = [];
    if (role !== "queen" && role !== "partner-member")
      f.db.rows("hvm_partner_memberships").length = 0;
    if (role === "partner-member")
      f.db.rows("hvm_partner_memberships")[0].role = "member";
    if (role === "client-member")
      f.db.rows("workspace_memberships")[0].role = "member";
    if (role === "unaffiliated") f.db.rows("workspace_memberships").length = 0;
    assert.equal((await f.request(root)).status, 404);
    assert.equal((await f.request(`${root}/${f.agreement.id}`)).status, 404);
    assert.equal(
      (await f.request(`${root}/${f.agreement.id}/approve`, f.approve()))
        .status,
      404,
    );
    assert.equal(
      (
        await f.request(
          f.root + "/operating/swarm-agreements/empress-approve",
          { id: f.agreement.id, ...f.approve() },
        )
      ).status,
      404,
    );
    assert.equal(f.db.rows("swarm_agreements")[0].status, "proposed");
    if (role === "queen") {
      assert.equal(
        (await f.request(f.root + "/operating/swarm-agreements")).status,
        200,
      );
      assert.equal(
        (
          await f.request(f.root + "/operating/swarm-agreements/approve", {
            id: f.agreement.id,
            expectedUpdatedAt: f.agreement.updatedAt.toISOString(),
          })
        ).status,
        404,
      );
      const other = `/api/v1/hvm/workspaces/${generatePlatformId("workspace")}/operating/swarm-agreements`;
      assert.equal((await f.request(other)).status, 404);
    }
  });
}
test("queue is empty or bounded and paginated; ordinary and historic agreements excluded", async (t) => {
  const f = await pendingFixture(t);
  const eligible = structuredClone(f.agreement);
  f.db.rows("swarm_agreements").length = 0;
  assert.deepEqual((await f.request(root)).body, {
    items: [],
    hasMore: false,
    limit: 20,
    offset: 0,
  });
  for (let i = 0; i < 3; i++)
    f.db.rows("swarm_agreements").push({
      ...structuredClone(eligible),
      id: generatePlatformId("swarmagreement"),
    });
  for (const status of ["approved", "superseded", "retired"])
    f.db.rows("swarm_agreements").push({
      ...structuredClone(eligible),
      id: generatePlatformId("swarmagreement"),
      status,
    });
  const ordinary = {
    ...structuredClone(eligible),
    id: generatePlatformId("swarmagreement"),
  };
  ordinary.data.decision.treatment = "standard";
  Object.assign(
    ordinary.data,
    evaluateCommercialDecision(
      ordinary.data.decision,
      ordinary.data.recommendationSnapshot,
    ),
  );
  f.db.rows("swarm_agreements").push(ordinary);
  const first = await f.request(root + "?limit=2&offset=0");
  const next = await f.request(root + "?limit=2&offset=2");
  assert.equal(first.body.items.length, 2);
  assert.equal(first.body.hasMore, true);
  assert.equal(next.body.items.length, 1);
  assert.equal(next.body.hasMore, false);
  assert.equal(
    new Set([...first.body.items, ...next.body.items].map((i) => i.id)).size,
    3,
  );
  for (const row of f.db.rows("swarm_agreements").slice(3)) {
    assert.equal((await f.request(`${root}/${row.id}`)).status, 404);
    assert.equal(
      (await f.request(`${root}/${row.id}/approve`, f.approve())).status,
      404,
    );
  }
});

test("combined Empress and Queen cannot mutate retired commercial records, including stale or spoofed requests", async (t) => {
  const f = await pendingFixture(t);
  const before = structuredClone(f.db.records);
  for (const body of [
    f.approve(),
    f.approve({ expectedUpdatedAt: "2020-01-01T00:00:00.000Z" }),
    f.approve({ actor: f.input.human }),
    f.approve({ reason: " " }),
    f.approve({ reason: "x".repeat(2001) }),
  ]) {
    const response = await f.request(`${root}/${f.agreement.id}/approve`, body);
    assert.ok([400, 404].includes(response.status));
    assert.deepEqual(f.db.records, before);
  }
  for (const operation of [
    "approve",
    "empress-approve",
    "update",
    "supersede",
    "retire",
  ])
    assert.equal(
      (
        await f.request(f.root + "/operating/swarm-agreements/" + operation, {
          id: f.agreement.id,
          ...f.approve(),
        })
      ).status,
      404,
    );
  assert.deepEqual(f.db.records, before);
});
test("historical review queries reject scope injection and malformed identifiers without writes", async (t) => {
  const f = await pendingFixture(t);
  const before = structuredClone(f.db.records);
  for (const query of [
    "limit=101",
    "limit=0",
    "offset=10001",
    "offset=-1",
    "workspaceId=anything",
    "status=approved",
    "limit=1&limit=2",
    "id[$ne]=x",
  ])
    assert.equal((await f.request(root + "?" + query)).status, 400);
  assert.equal((await f.request(root + "/bad-id")).status, 400);
  assert.equal(
    (await f.request(`${root}/${generatePlatformId("swarmagreement")}`)).status,
    404,
  );
  assert.equal(
    (await f.request(`${root}/${f.agreement.id}?workspaceId=x`)).status,
    400,
  );
  assert.deepEqual(f.db.records, before);
});
test("historical review uses frozen snapshots, never current policy or raw workspace records", async (t) => {
  const f = await pendingFixture(t);
  empressOnly(f);
  const before = await f.request(`${root}/${f.agreement.id}`);
  f.db.rows("commercial_policies").length = 0;
  f.db.rows("client_swarms")[0].description = "CHANGED_PRIVATE_CONFIGURATION";
  const after = await f.request(`${root}/${f.agreement.id}`);
  assert.equal(after.status, 200);
  assert.deepEqual(after.body, before.body);
  assert.ok(!JSON.stringify(after.body).includes("PRIVATE"));
});
