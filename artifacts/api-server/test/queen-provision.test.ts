import { snapshotInterleaving } from "./helpers/agent-snapshot-db";
import frozen16 from "../src/db/frozen-v16-target.json";
import frozen17 from "../src/db/frozen-v17-target.json";
import { CANONICAL_SUPPORT_VALIDATOR } from "../src/db/canonical-support-v18";
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
  provisionQueenClient,
  QUEEN_PROVISION_EVENT,
} from "../src/services/hvm-queen-provision";
import { EnquiryMemoryDb } from "./helpers/enquiry-db";
import { authEnvironment, testIssuer } from "./helpers/auth";
const config = parseConfig({
  ...authEnvironment,
  HVM_COGNITO_CLIENT_ID: "hvmclient",
  DEPLOYMENT_ENV: "test",
  MONGODB_URI: "mongodb://unused.invalid",
});
const identity = {
  subject: "owner",
  issuer: testIssuer,
  clientId: "hvmclient",
};
const input = {
  requestKey: "fictional-1",
  organisationName: "Fictional Lantern Ltd",
  workspaceName: "Lantern",
  brandName: "Lantern",
  brandSlug: "lantern",
};
function fixture(version = 18) {
  const db = new EnquiryMemoryDb();
  db.rows("schema_versions").push({ _id: "vapp-v1", version });
  const now = new Date();
  const base = { createdAt: now, updatedAt: now };
  const partnerId = generatePlatformId("partner");
  db.rows("hvm_partners").push(
    HvmPartnerSchema.parse({
      ...base,
      id: partnerId,
      displayName: "Existing Agency",
      status: "active",
    }),
  );
  db.rows("hvm_partner_memberships").push(
    HvmPartnerMembershipSchema.parse({
      ...base,
      id: generatePlatformId("partnermembership"),
      partnerId,
      human: { type: "human", id: identity.subject, issuer: identity.issuer },
      role: "owner",
      status: "active",
      joinedAt: now,
    }),
  );
  return {
    db,
    partnerId,
    run: (body: unknown = input, actor = identity) =>
      provisionQueenClient(config, db.mongo, actor, partnerId, body),
  };
}
for (const version of [16, 17, 18])
  test(`owner provisions new scoped client on schema ${version} without membership or execution grants`, async () => {
    const f = fixture(version);
    const result = await f.run();
    assert.equal(result.partnerId, f.partnerId);
    assert.equal(f.db.rows("hvm_partners").length, 1);
    assert.equal(f.db.rows("hvm_partner_memberships").length, 1);
    assert.equal(f.db.rows("workspace_memberships").length, 0);
    assert.equal(
      f.db.rows("crm_workspaces")[0].clientOrganisationId,
      result.organisationId,
    );
    assert.equal(
      f.db.rows("workspace_partner_assignments")[0].partnerId,
      f.partnerId,
    );
    for (const c of [
      "client_agents",
      "agent_runs",
      "swarm_agreements",
      "workspace_integrations",
      "campaigns",
    ])
      assert.equal(f.db.rows(c).length, 0);
    assert.equal(f.db.rows("hvm_partners")[0].executionSerial, 1);
    assert.equal(f.db.rows("hvm_partner_memberships")[0].executionSerial, 1);
  });
test("concurrent exact retries create one set; changed request fails and preserves result", async () => {
  const f = fixture();
  const [a, b] = await Promise.all([f.run(), f.run()]);
  assert.deepEqual(a, b);
  for (const c of [
    "organisations",
    "brands",
    "crm_workspaces",
    "workspace_partner_assignments",
    "events",
  ])
    assert.equal(f.db.rows(c).length, 1);
  await assert.rejects(() => f.run({ ...input, workspaceName: "Changed" }));
  assert.deepEqual(await f.run(), a);
});
for (const condition of [
  "member",
  "ended",
  "suspended",
  "foreign",
  "empress-only",
  "wrong-client",
  "wrong-issuer",
  "archived",
] as const)
  test(`denies ${condition} without new client records`, async () => {
    const f = fixture();
    let actor = identity;
    if (condition === "member")
      f.db.rows("hvm_partner_memberships")[0].role = "member";
    if (condition === "ended")
      f.db.rows("hvm_partner_memberships")[0].status = "ended";
    if (condition === "suspended")
      f.db.rows("hvm_partners")[0].status = "suspended";
    if (condition === "archived") f.db.rows("hvm_partners")[0].archived = true;
    if (condition === "foreign" || condition === "empress-only")
      actor = { ...identity, subject: condition };
    if (condition === "wrong-client")
      actor = { ...identity, clientId: "other" };
    if (condition === "wrong-issuer")
      actor = { ...identity, issuer: "https://foreign.invalid" };
    await assert.rejects(() => f.run(input, actor));
    assert.equal(f.db.rows("crm_workspaces").length, 0);
  });
test("revocation also rejects an exact replay", async () => {
  const f = fixture();
  await f.run();
  f.db.rows("hvm_partner_memberships")[0].status = "ended";
  await assert.rejects(() => f.run());
});
test("insert failure rolls back every record and authority serial", async () => {
  const f = fixture();
  const before = structuredClone(f.db.records);
  f.db.failCollection = "brands";
  await assert.rejects(() => f.run());
  assert.deepEqual(f.db.records, before);
});
test("browser cannot supply actor, existing entity, membership, grant or billing bypass", async () => {
  for (const key of [
    "human",
    "organisationId",
    "workspaceId",
    "partnerMembershipId",
    "clientMembershipId",
    "billingExempt",
    "agentOperationGrants",
  ]) {
    const f = fixture();
    await assert.rejects(() => f.run({ ...input, [key]: "forged" }));
    assert.equal(f.db.rows("crm_workspaces").length, 0);
  }
});
test("generic event writer cannot forge provisioning receipt", () => {
  assert.equal(
    EventInsertSchema.safeParse({
      eventType: QUEEN_PROVISION_EVENT,
      occurredAt: new Date(),
      payload: {},
    }).success,
    false,
  );
});
for (const version of [11, 15, 21])
  test(`unqualified schema ${version} fails closed`, async () => {
    const f = fixture(version);
    await assert.rejects(() => f.run());
    assert.equal(f.db.rows("crm_workspaces").length, 0);
  });

for (const anchor of ["hvm_partners", "hvm_partner_memberships"])
  test(`snapshot revocation of ${anchor} conflicts before any new client commits`, async () => {
    const f = fixture();
    const race = snapshotInterleaving(f.db, async () => {
      f.db.rows(anchor)[0].status =
        anchor === "hvm_partners" ? "suspended" : "ended";
    });
    await assert.rejects(
      () =>
        provisionQueenClient(config, race.mongo, identity, f.partnerId, input),
      /Snapshot write conflict/,
    );
    assert.equal(f.db.rows("crm_workspaces").length, 0);
    assert.equal(f.db.rows("events").length, 0);
    await assert.rejects(() => f.run());
  });
test("v17 preserves all provisioning validators; v18 adds only conditional certificate-event validation", () => {
  for (const name of [
    "organisations",
    "crm_workspaces",
    "brands",
    "workspace_partner_assignments",
    "hvm_partners",
    "hvm_partner_memberships",
    "events",
  ] as const)
    assert.deepEqual(
      frozen17.validators[name],
      frozen16.validators[name],
      name,
    );
  assert.deepEqual(
    CANONICAL_SUPPORT_VALIDATOR.$and[0],
    frozen17.validators.events,
  );
  assert.deepEqual(CANONICAL_SUPPORT_VALIDATOR.$and[1].$or[0], {
    eventType: { $ne: "canonical_support_certified" },
  });
  assert.notEqual(QUEEN_PROVISION_EVENT, "canonical_support_certified");
});
