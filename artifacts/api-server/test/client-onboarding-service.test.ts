import assert from "node:assert/strict";
import { test } from "node:test";
import { parseConfig } from "../src/config";
import {
  generatePlatformId,
  HvmPartnerSchema,
  HvmPartnerMembershipSchema,
  EventInsertSchema,
} from "../src/domain";
import {
  mutateClientOnboarding,
  listClientOnboardings,
  ONBOARDING_EVENT,
} from "../src/services/client-onboarding";
import { provisionQueenClient } from "../src/services/hvm-queen-provision";
import { EnquiryMemoryDb } from "./helpers/enquiry-db";
import { authEnvironment, testIssuer } from "./helpers/auth";
const empressId = "00000000-0000-4000-8000-000000000099";
const config = parseConfig({
  ...authEnvironment,
  HVM_COGNITO_CLIENT_ID: "hvmclient",
  DEPLOYMENT_ENV: "test",
  MONGODB_URI: "mongodb://unused.invalid",
  HVM_EMPRESS_SUBJECTS: empressId,
});
const queen = { subject: "owner", issuer: testIssuer, clientId: "hvmclient" },
  empress = { ...queen, subject: empressId };
const details = {
  intake: {
    organisationName: "Fictional Lantern",
    websiteUrl: "https://lantern.invalid",
    otherTools: [],
  },
  workspaceName: "Lantern",
  brandName: "Lantern",
  brandSlug: "lantern",
};
function fixture() {
  const db = new EnquiryMemoryDb(),
    partnerId = generatePlatformId("partner"),
    now = new Date();
  db.rows("schema_versions").push({ _id: "vapp-v1", version: 21 });
  db.rows("hvm_partners").push(
    HvmPartnerSchema.parse({
      id: partnerId,
      displayName: "Existing Agency",
      status: "active",
      createdAt: now,
      updatedAt: now,
    }),
  );
  db.rows("hvm_partner_memberships").push(
    HvmPartnerMembershipSchema.parse({
      id: generatePlatformId("partnermembership"),
      partnerId,
      human: { type: "human", id: queen.subject, issuer: queen.issuer },
      role: "owner",
      status: "active",
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
    }),
  );
  const run = (
    body: unknown,
    id?: string,
    governance = false,
    user = governance ? empress : queen,
  ) =>
    mutateClientOnboarding(
      db.mongo,
      config,
      user,
      governance ? undefined : partnerId,
      id,
      body,
    );
  return {
    db,
    partnerId,
    run,
    create: () =>
      run({
        action: "save",
        requestKey: "create",
        expectedRevision: 0,
        details,
      }),
  };
}
const command = (action: string, revision: number) => ({
  action,
  requestKey: action,
  expectedRevision: revision,
  ...(["approve", "revoke"].includes(action)
    ? { reason: "Internal testing exemption" }
    : {}),
});
test("approved onboarding atomically creates only canonical base with exact exemption receipt and replay", async () => {
  const f = fixture(),
    a = await f.create();
  assert.equal(f.db.rows("crm_workspaces").length, 0);
  const b = await f.run(command("approve", a.revision), a.id, true);
  assert.equal(b.approval!.validUntil, undefined);
  const c = await f.run(command("provision", b.revision), a.id);
  assert.ok(c.result);
  assert.equal(f.db.rows("organisations").length, 1);
  assert.equal(f.db.rows("crm_workspaces").length, 1);
  assert.equal(f.db.rows("brands").length, 1);
  assert.equal(f.db.rows("brands")[0].primaryDomain, "lantern.invalid");
  assert.equal(f.db.rows("workspace_partner_assignments").length, 1);
  assert.equal(
    f.db.rows("crm_workspaces")[0].billingExemption.approvedBy.id,
    empressId,
  );
  for (const name of [
    "workspace_memberships",
    "client_agents",
    "agent_runs",
    "workspace_integrations",
    "campaigns",
    "subscriptions",
    "transactions",
  ])
    assert.equal(f.db.rows(name).length, 0, name);
  assert.deepEqual(
    (await f.run(command("provision", b.revision), a.id)).result,
    c.result,
  );
  assert.equal(f.db.rows("events").length, 3);
  const receipt = f.db.rows("events")[2].payload.snapshot;
  assert.deepEqual(receipt.result, c.result);
  assert.deepEqual(receipt.approval.binding, a.binding);
});
test("Queen cannot approve; Empress cannot provision or obtain Partner scope merely by being Empress", async () => {
  const f = fixture(),
    a = await f.create();
  await assert.rejects(f.run(command("approve", 1), a.id));
  await assert.rejects(f.run(command("provision", 1), a.id, true));
  await assert.rejects(
    listClientOnboardings(f.db.mongo, config, empress, f.partnerId),
  );
  await assert.rejects(listClientOnboardings(f.db.mongo, config, queen));
  assert.equal(
    (await listClientOnboardings(f.db.mongo, config, empress)).items.length,
    1,
  );
});
test("cross-Partner and wrong client/issuer denied", async () => {
  const f = fixture(),
    a = await f.create();
  await assert.rejects(
    mutateClientOnboarding(
      f.db.mongo,
      config,
      queen,
      generatePlatformId("partner"),
      a.id,
      command("provision", 1),
    ),
  );
  for (const user of [
    { ...queen, clientId: "other" },
    { ...queen, issuer: "https://other.invalid" },
    { ...queen, subject: "other" },
  ])
    await assert.rejects(f.run(command("provision", 1), a.id, false, user));
});
test("revision invalidates approval and exact request reuse rejects changed input", async () => {
  const f = fixture(),
    a = await f.create(),
    b = await f.run(command("approve", 1), a.id, true);
  const c = await f.run(
    {
      action: "save",
      expectedRevision: b.revision,
      requestKey: "revise",
      details: { ...details, workspaceName: "Changed" },
    },
    a.id,
  );
  assert.equal(c.approval, undefined);
  assert.equal(f.db.rows("client_onboardings")[0].approval, undefined);
  await assert.rejects(f.run(command("provision", c.revision), a.id));
  await assert.rejects(
    f.run({
      action: "save",
      expectedRevision: 0,
      requestKey: "create",
      details: { ...details, workspaceName: "Different" },
    }),
  );
});
for (const fault of ["revoked", "tampered", "empressRemoved", "ownerRevoked"]) {
  test(`provision fails closed: ${fault}`, async () => {
    const f = fixture(),
      a = await f.create();
    await f.run(command("approve", 1), a.id, true);
    const row = f.db.rows("client_onboardings")[0];
    if (fault === "revoked") await f.run(command("revoke", 2), a.id, true);
    if (fault === "tampered") row.details.workspaceName = "Changed";
    if (fault === "ownerRevoked")
      f.db.rows("hvm_partner_memberships")[0].status = "revoked";
    if (fault === "empressRemoved")
      await assert.rejects(
        mutateClientOnboarding(
          f.db.mongo,
          { ...config, empressSubjects: [] },
          queen,
          f.partnerId,
          a.id,
          command("provision", 2),
        ),
      );
    else {
      if (fault === "expired") await new Promise((r) => setTimeout(r, 5));
      await assert.rejects(f.run(command("provision", row.revision), a.id));
    }
    assert.equal(f.db.rows("crm_workspaces").length, 0);
  });
}
test("concurrent exact create and provision requests yield one base; retry rechecks owner", async () => {
  const f = fixture();
  const [a, b] = await Promise.all([f.create(), f.create()]);
  assert.equal(a.id, b.id);
  await f.run(command("approve", 1), a.id, true);
  const [c, d] = await Promise.all([
    f.run(command("provision", 2), a.id),
    f.run(command("provision", 2), a.id),
  ]);
  assert.deepEqual(c.result, d.result);
  assert.equal(f.db.rows("crm_workspaces").length, 1);
  f.db.rows("hvm_partner_memberships")[0].status = "revoked";
  await assert.rejects(f.run(command("provision", 2), a.id));
});
test("legacy direct creation cannot bypass commercial admission on v21", async () => {
  const f = fixture();
  await assert.rejects(
    provisionQueenClient(config, f.db.mongo, queen, f.partnerId, {
      requestKey: "bypass",
      organisationName: "X",
      workspaceName: "X",
      brandName: "X",
      brandSlug: "x",
    }),
  );
  assert.equal(f.db.rows("crm_workspaces").length, 0);
});
test("generic event insertion cannot forge onboarding audit", () => {
  assert.equal(
    EventInsertSchema.safeParse({
      eventType: ONBOARDING_EVENT,
      occurredAt: new Date(),
      payload: {},
    }).success,
    false,
  );
});
for (const collection of [
  "organisations",
  "crm_workspaces",
  "brands",
  "workspace_partner_assignments",
  "events",
])
  test(`atomic rollback on ${collection} insertion failure`, async () => {
    const f = fixture(),
      a = await f.create();
    await f.run(command("approve", 1), a.id, true);
    const before = structuredClone(f.db.records);
    f.db.failCollection = collection;
    await assert.rejects(f.run(command("provision", 2), a.id));
    assert.deepEqual(f.db.records, before);
  });
test("concurrent revocation prevents stale-snapshot provisioning", async () => {
  const { snapshotInterleaving } = await import("./helpers/agent-snapshot-db");
  const f = fixture(),
    a = await f.create();
  await f.run(command("approve", 1), a.id, true);
  const stale = snapshotInterleaving(f.db, async () => {
    await f.run(command("revoke", 2), a.id, true);
  });
  await assert.rejects(
    mutateClientOnboarding(
      stale.mongo,
      config,
      queen,
      f.partnerId,
      a.id,
      command("provision", 2),
    ),
    /Snapshot write conflict/,
  );
  assert.equal(f.db.rows("crm_workspaces").length, 0);
  assert.equal(f.db.rows("client_onboardings")[0].approval.status, "revoked");
});
test("completed provisioning cannot be reversed through pre-client governance", async () => {
  const f = fixture(),
    a = await f.create();
  await f.run(command("approve", 1), a.id, true);
  await f.run(command("provision", 2), a.id);
  await assert.rejects(
    f.run(command("revoke", 3), a.id, true),
    /workspace billing/,
  );
  assert.equal(
    f.db.rows("crm_workspaces")[0].billingExemption.status,
    "active",
  );
});
test("v21 context preserves independent Empress and Queen scopes; workspace billing revoke remains available", async () => {
  const { resolveHvmContext } = await import("../src/services/hvm-context");
  const { mutateWorkspaceBilling } =
    await import("../src/services/workspace-billing");
  const f = fixture(),
    a = await f.create();
  await f.run(command("approve", 1), a.id, true);
  const c = await f.run(command("provision", 2), a.id);
  const em = await resolveHvmContext(
    await f.db.mongo.database(),
    config,
    empress,
  );
  assert.equal(em.response.platform.empress, true);
  assert.equal(em.response.workspaces.length, 0);
  const q = await resolveHvmContext(await f.db.mongo.database(), config, queen);
  assert.equal(q.response.platform.empress, false);
  assert.ok(q.response.workspaces.some((w) => w.id === c.result!.workspaceId));
  await mutateWorkspaceBilling(
    f.db.mongo,
    config,
    empress,
    c.result!.workspaceId,
    {
      action: "revoke",
      requestKey: "workspace-revoke",
      expectedRevision: 1,
      reason: "End internal exemption",
    },
  );
  assert.equal(
    f.db.rows("crm_workspaces")[0].billingExemption.status,
    "revoked",
  );
});
test("HTTP onboarding uses authenticated HVM human boundary and rejects cross-role decisions", async (t) => {
  const { createApp } = await import("../src/app");
  const { createTestAuth } = await import("./helpers/auth");
  const { createServer } = await import("node:http");
  const { once } = await import("node:events");
  const f = fixture(),
    auth = await createTestAuth(),
    server = createServer(
      createApp(config, f.db.mongo, { jwtKeyResolver: auth.keyResolver }),
    );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((r) => server.close(() => r())));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api/v1/hvm`;
  const token = await auth.sign({ sub: queen.subject, client_id: "hvmclient" });
  const empressToken = await auth.sign({
    sub: empress.subject,
    client_id: "hvmclient",
  });
  const call = (path: string, tokenValue: string, body?: unknown) =>
    fetch(base + path, {
      method: body ? "POST" : "GET",
      headers: {
        authorization: `Bearer ${tokenValue}`,
        "content-type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const root = `/partners/${f.partnerId}/client-onboarding`;
  const created = await call(root, token, {
    action: "save",
    requestKey: "http",
    expectedRevision: 0,
    details,
  });
  assert.equal(created.status, 200);
  const record = (await created.json()) as { id: string };
  assert.equal(
    (await call(root + `/${record.id}`, token, command("approve", 1))).status,
    404,
  );
  assert.equal((await call("/empress/client-onboarding", token)).status, 404);
  assert.equal((await call(root, empressToken)).status, 404);
  assert.equal(
    (
      await call(
        `/empress/client-onboarding/${record.id}`,
        empressToken,
        command("approve", 1),
      )
    ).status,
    200,
  );
  const provision = await call(
    root + `/${record.id}`,
    token,
    command("provision", 2),
  );
  assert.equal(provision.status, 200);
  assert.equal((await call(root + "?unknown=true", token)).status, 400);
});
test("approval revision remains monotonic across intake revision and reapproval", async () => {
  const f = fixture(),
    a = await f.create(),
    b = await f.run(command("approve", 1), a.id, true);
  const c = await f.run(
    {
      action: "save",
      requestKey: "edit",
      expectedRevision: 2,
      details: { ...details, brandName: "New declaration" },
    },
    a.id,
  );
  const d = await f.run(
    { ...command("approve", c.revision), requestKey: "approve-again" },
    a.id,
    true,
  );
  assert.ok(d.approval!.revision > b.approval!.revision);
  assert.notDeepEqual(d.approval!.binding, b.approval!.binding);
});

import { createOperatingGateway } from "../../../.integration/hvm-app/src/data/operating/gateway";
import { readWorkspaceBilling } from "../src/services/workspace-billing";
test("real frontend onboarding transport parses Queen save, independent Empress approval, provision and billing", async () => {
  const f = fixture();
  // The real Mongo driver adds _id to the supplied insert document in place.
  const collection = f.db.collection.bind(f.db);
  f.db.collection = (name: string) => {
    const target = collection(name);
    if (name === "client_onboardings") {
      const insert = target.insertOne;
      target.insertOne = async (record) => {
        record._id ??= "mongo-generated-storage-id";
        return insert(record);
      };
    }
    return target;
  };
  f.db.rows("schema_versions")[0]!.version = 23;
  const signal = new AbortController().signal;
  const gateway = createOperatingGateway(
    "https://synthetic.invalid",
    {
      getAccessToken: async () => "synthetic",
      invalidate: () => {},
    },
    async (url, options) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith("/billing-treatment")) {
        assert.equal(options?.method, "GET");
        return Response.json(
          await readWorkspaceBilling(
            f.db.mongo,
            config,
            queen,
            path.split("/").at(-2)!,
          ),
        );
      }
      assert.equal(options?.method, "POST");
      const governance = path.includes("/empress/");
      assert.ok(governance || path.includes(`/partners/${f.partnerId}/`));
      const tail = path.split("/").at(-1)!;
      return Response.json(
        await f.run(
          JSON.parse(String(options?.body)),
          tail === "client-onboarding" ? undefined : tail,
          governance,
        ),
      );
    },
  );
  const saved = await gateway.onboarding.mutate(
    f.partnerId,
    undefined,
    {
      action: "save",
      requestKey: "frontend-save",
      expectedRevision: 0,
      details,
    },
    signal,
  );
  assert.equal(saved.approval, undefined);
  assert.equal(f.db.rows("crm_workspaces").length, 0);
  const approved = await gateway.onboarding.mutate(
    undefined,
    saved.id,
    {
      action: "approve",
      requestKey: "frontend-approve",
      expectedRevision: saved.revision,
      reason: "Synthetic internal exemption",
    },
    signal,
  );
  assert.equal(approved.approval?.approvedBy.id, empressId);
  const provisioned = await gateway.onboarding.mutate(
    f.partnerId,
    saved.id,
    {
      action: "provision",
      requestKey: "frontend-provision",
      expectedRevision: approved.revision,
    },
    signal,
  );
  assert.ok(provisioned.result);
  const billing = await gateway.workspaceBilling(
    provisioned.result.workspaceId,
    false,
    signal,
  );
  assert.equal(billing.effective.treatment, "internal");
  assert.equal(billing.effective.executionAuthority, false);
  assert.equal(provisioned.proposal.externalServicesIncluded, false);
  for (const collection of [
    "client_agents",
    "agent_runs",
    "workspace_integrations",
    "campaigns",
  ])
    assert.equal(f.db.rows(collection).length, 0);
});

test("schema24 onboarding approval and provisioning remain compatible", async () => {
  const f = fixture();
  f.db.rows("schema_versions")[0].version = 24;
  const saved = await f.create();
  const approved = await f.run(
    command("approve", saved.revision),
    saved.id,
    true,
  );
  const provisioned = await f.run(
    command("provision", approved.revision),
    saved.id,
  );
  assert.ok(provisioned.result?.workspaceId);
});
