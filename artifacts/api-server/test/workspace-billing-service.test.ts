import assert from "node:assert/strict";
import { test } from "node:test";
import { parseConfig } from "../src/config";
import {
  generatePlatformId,
  HvmPartnerSchema,
  HvmPartnerMembershipSchema,
  EventInsertSchema,
} from "../src/domain";
import { provisionQueenClient } from "../src/services/hvm-queen-provision";
import { EnquiryMemoryDb } from "./helpers/enquiry-db";
import { authEnvironment, testIssuer } from "./helpers/auth";
const config = parseConfig({
  ...authEnvironment,
  HVM_COGNITO_CLIENT_ID: "hvmclient",
  DEPLOYMENT_ENV: "test",
  HVM_EMPRESS_SUBJECTS: "00000000-0000-4000-8000-000000000099",
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
function fixture(version = 19) {
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

import {
  mutateWorkspaceBilling,
  readWorkspaceBilling,
} from "../src/services/workspace-billing";
const empress = {
  ...identity,
  subject: "00000000-0000-4000-8000-000000000099",
};
for (const version of [19,28]) test(`Empress approves without workspace authority; Queen reads and cannot mutate; revocation preserves audit (v${version})`, async () => {
  const f = fixture();
  const client = await f.run();
  // The retired provisioning writer creates the historical fixture at v19.
  // Exercise current billing against that preserved workspace after the additive release.
  f.db.rows("schema_versions")[0]!.version = version;
  const id = client.workspaceId;
  const request = {
    action: "approve",
    requestKey: "approval-1",
    expectedRevision: 0,
    reason: "Internal fictional client",
  };
  await assert.rejects(
    mutateWorkspaceBilling(f.db.mongo, config, identity, id, request),
  );
  const result = await mutateWorkspaceBilling(
    f.db.mongo,
    config,
    empress,
    id,
    request,
  );
  assert.equal(result.revision, 1);
  assert.equal(result.effective.treatment, "internal");
  assert.deepEqual(
    await mutateWorkspaceBilling(f.db.mongo, config, empress, id, request),
    result,
  );
  await assert.rejects(
    mutateWorkspaceBilling(f.db.mongo, config, empress, id, {
      ...request,
      reason: "changed",
    }),
  );
  assert.equal(
    (await readWorkspaceBilling(f.db.mongo, config, identity, id)).effective
      .treatment,
    "internal",
  );
  await assert.rejects(readWorkspaceBilling(f.db.mongo, config, empress, id));
  await assert.rejects(
    readWorkspaceBilling(
      f.db.mongo,
      config,
      { ...identity, subject: "foreign" },
      id,
    ),
  );
  const revoked = await mutateWorkspaceBilling(
    f.db.mongo,
    config,
    empress,
    id,
    {
      action: "revoke",
      requestKey: "revoke-1",
      expectedRevision: 1,
      reason: "Ended",
    },
  );
  assert.equal(revoked.effective.treatment, "existing_terms");
  assert.equal(revoked.revision, 2);
  assert.equal(
    f.db
      .rows("events")
      .filter((e) => e.eventType === "workspace_billing_exemption_changed")
      .length,
    2,
  );
});

import { operatingFixtures } from "./helpers/operating-fixtures";
import { OperatingSchemas } from "../src/domain/operating";
import { mutateOperating } from "../src/services/operating";
import {
  updateCrmRecord,
  createCrmRecord,
} from "../src/services/crm-foundation";
test("workspace exemption governs agreement calculation and preserves provider cost snapshot", async () => {
  const f = fixture(),
    client = await f.run(),
    id = client.workspaceId,
    rows = operatingFixtures();
  for (const [collection, source] of Object.entries(rows)) {
    if (collection === "swarm_agreements") continue;
    const row = structuredClone(source);
    if (row.workspaceId) row.workspaceId = id;
    if (collection === "client_swarms") row.status = "configured";
    f.db
      .rows(collection)
      .push(
        OperatingSchemas[collection as keyof typeof OperatingSchemas].parse(
          row,
        ),
      );
  }
  await mutateWorkspaceBilling(f.db.mongo, config, empress, id, {
    action: "approve",
    requestKey: "commercial-1",
    expectedRevision: 0,
    reason: "Internal client",
  });
  const recommendation = f.db.rows("pricing_recommendations")[0]!,
    gross = structuredClone(recommendation.data);
  await mutateOperating(
    f.db.mongo,
    config,
    identity,
    "swarm_agreements",
    "create",
    {
      data: {
        ...rows.swarm_agreements.data.decision,
        recommendationId: recommendation.id,
        treatment: "standard",
        onboardingMinor: 100,
      },
    },
    id,
  );
  const agreement = f.db.rows("swarm_agreements")[0]!;
  assert.equal(agreement.data.finalRecurringMinor, 0);
  assert.equal(agreement.data.decision.onboardingMinor, 0);
  assert.equal(agreement.data.decision.treatment, "internal");
  assert.deepEqual(agreement.data.recommendationSnapshot, gross);
});
test("generic CRM writes cannot forge an exemption or its approval event", async () => {
  const f = fixture(),
    client = await f.run(),
    row = f.db.rows("crm_workspaces").find((w) => w.id === client.workspaceId)!;
  const actor = { type: "human", id: identity.subject };
  await assert.rejects(
    updateCrmRecord(
      f.db.mongo,
      "crm_workspaces",
      row.id,
      row.updatedAt,
      { billingExemption: {} },
      actor,
    ),
  );
  await assert.rejects(
    createCrmRecord(
      f.db.mongo,
      "events",
      { eventType: "workspace_billing_exemption_changed" },
      actor,
    ),
  );
  assert.equal(
    EventInsertSchema.safeParse({
      eventType: "workspace_billing_exemption_changed",
      occurredAt: new Date(),
      payload: {},
    }).success,
    false,
  );
  assert.equal(row.billingExemption, undefined);
});
test("billing requires v19, exact revision, and a current Empress configuration", async () => {
  const f = fixture(),
    client = await f.run(),
    id = client.workspaceId;
  const body = {
    action: "approve",
    requestKey: "a",
    expectedRevision: 1,
    reason: "Synthetic",
  };
  await assert.rejects(
    mutateWorkspaceBilling(f.db.mongo, config, empress, id, body),
  );
  // Public configuration parsing is used so no accidental property alias can authorize this check.
  const revokedConfig = parseConfig({
    ...authEnvironment,
    HVM_COGNITO_CLIENT_ID: "hvmclient",
    DEPLOYMENT_ENV: "test",
    MONGODB_URI: "mongodb://unused.invalid",
  });
  await assert.rejects(
    mutateWorkspaceBilling(f.db.mongo, revokedConfig, empress, id, {
      ...body,
      expectedRevision: 0,
    }),
  );
  f.db.rows("schema_versions")[0]!.version = 18;
  await assert.rejects(
    mutateWorkspaceBilling(f.db.mongo, config, empress, id, {
      ...body,
      expectedRevision: 0,
    }),
  );
  assert.equal(
    f.db.rows("crm_workspaces").find((w) => w.id === id)!.billingExemption,
    undefined,
  );
});
