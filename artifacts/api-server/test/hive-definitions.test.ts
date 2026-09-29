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
  OfferingContentSchema,
  IcpContentSchema,
  BuyerContentSchema,
  semanticHash,
  OfferingSchema,
} from "../src/domain";
import { provisionHvmClient } from "../src/services/hvm-provision";
import { EnquiryMemoryDb } from "./helpers/enquiry-db";
import { authEnvironment, createTestAuth, testIssuer } from "./helpers/auth";
import { previewCrmDelete } from "../src/services/crm-delete";
const definition = {
  name: "Energy optimisation",
  description: "Supplier-delivered optimisation",
  primaryOfferingType: "professional_service",
  implementationModel: "supplier_mobilisation",
  deliveryModes: ["on_site_service"],
  unknowns: ["Measured savings"],
};
async function fixture(t: TestContext) {
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
const mutation = (row: { id: string; updatedAt: string }) => ({
  id: row.id,
  expectedUpdatedAt: row.updatedAt,
});
test("domain separates factual delivery, accounts, consumers and buyer roles with bounded strict content", () => {
  assert.equal(
    OfferingContentSchema.parse(definition).implementationModel,
    "supplier_mobilisation",
  );
  assert.equal(
    IcpContentSchema.safeParse({
      name: "B2B",
      description: "Account",
      profileType: "b2b",
      consumerProfile: {},
    }).success,
    false,
  );
  assert.equal(
    IcpContentSchema.safeParse({
      name: "Consumer",
      description: "Person",
      profileType: "b2c",
      accountProfile: {},
    }).success,
    false,
  );
  assert.ok(
    IcpContentSchema.parse({
      name: "Direct",
      description: "Consumer",
      profileType: "d2c",
      consumerProfile: { values: ["Durability"] },
    }),
  );
  assert.equal(
    BuyerContentSchema.safeParse({
      name: "CFO",
      description: "Buyer",
      buyingRoles: ["fake"],
    }).success,
    false,
  );
  assert.equal(
    OfferingContentSchema.safeParse({
      ...definition,
      capabilities: Array(41).fill("x"),
    }).success,
    false,
  );
  assert.equal(
    OfferingContentSchema.safeParse({ ...definition, capabilityOutput: {} })
      .success,
    false,
  );
  assert.equal(
    OfferingContentSchema.safeParse({
      ...definition,
      websiteUrl: "https://user:secret@example.com",
    }).success,
    false,
  );
  assert.equal(semanticHash({ a: 1, b: 2 }), semanticHash({ b: 2, a: 1 }));
});
test("human draft, approval, immutable revision, new draft, stale writes and archival preserve identity", async (t) => {
  const f = await fixture(t);
  const first = await f.create();
  assert.equal(first.organisationId, f.input.organisationId);
  assert.equal(first.workspaceId, f.input.workspaceId);
  assert.equal(first.revision, 1);
  const approved = await f.request(
    f.root + "/offerings/approve",
    mutation(first),
  );
  assert.equal(approved.status, 200);
  assert.equal(
    (
      await f.request(f.root + "/offerings/update", {
        ...mutation(approved.body),
        definition: { ...definition, name: "Changed" },
      })
    ).status,
    409,
  );
  const revised = await f.request(
    f.root + "/offerings/revise",
    mutation(approved.body),
  );
  assert.equal(revised.status, 200);
  assert.equal(revised.body.revision, 2);
  assert.equal(revised.body.approvedRevision, 1);
  assert.equal(revised.body.approvedBy, undefined);
  const updated = await f.request(f.root + "/offerings/update", {
    ...mutation(revised.body),
    definition: { ...definition, name: "Changed" },
  });
  assert.equal(updated.status, 200);
  assert.notEqual(updated.body.contentHash, first.contentHash);
  assert.equal(
    (
      await f.request(f.root + "/offerings/update", {
        ...mutation(revised.body),
        definition,
      })
    ).status,
    409,
  );
  const approved2 = await f.request(
    f.root + "/offerings/approve",
    mutation(updated.body),
  );
  assert.equal(approved2.status, 200);
  const history = await f.request(
    f.root + `/offerings/${first.id}/revisions/1`,
  );
  assert.equal(history.status, 200);
  assert.equal(history.body.snapshot.definition.name, definition.name);
  assert.equal(history.body.snapshot.contentHash, first.contentHash);
  const archived = await f.request(
    f.root + "/offerings/archive",
    mutation(approved2.body),
  );
  assert.equal(archived.status, 200);
  assert.equal((await f.request(f.root + "/offerings")).body.items.length, 0);
  assert.equal(
    (await f.request(f.root + "/offerings?archived=true")).body.items.length,
    1,
  );
  assert.equal(
    (await f.request(f.root + `/offerings/${first.id}/revisions/2`)).status,
    200,
  );
  assert.equal(f.db.rows("hive_definition_revisions").length, 2);
  assert.equal(
    f.db.rows("events").filter((e) => e.eventType === "hive_definition_changed")
      .length,
    6,
  );
});
test("same-workspace hierarchy and explicit Buyer Offering consistency; parent archival never cascades", async (t) => {
  const f = await fixture(t);
  const offering = await f.create();
  const icp = await f.request(f.root + "/ideal-customer-profiles/create", {
    offeringId: offering.id,
    definition: {
      name: "Factories",
      description: "Energy intensive accounts",
      profileType: "b2b",
      characteristics: ["energy-intensive operations"],
      accountProfile: { industries: ["Manufacturing"] },
    },
  });
  assert.equal(icp.status, 201);
  const other = await f.create();
  const buyerInput = {
    offeringId: other.id,
    idealCustomerProfileId: icp.body.id,
    definition: {
      name: "CFO",
      description: "Economic buyer",
      buyingRoles: ["economic_buyer"],
    },
  };
  assert.equal(
    (await f.request(f.root + "/buyer-profiles/create", buyerInput)).status,
    404,
  );
  const buyer = await f.request(f.root + "/buyer-profiles/create", {
    ...buyerInput,
    offeringId: offering.id,
  });
  assert.equal(buyer.status, 201);
  assert.equal(
    (
      await f.request(
        f.root + `/buyer-profiles?idealCustomerProfileId=${icp.body.id}`,
      )
    ).body.items.length,
    1,
  );
  assert.equal(
    (
      await f.request(
        f.root + `/ideal-customer-profiles?offeringId=${offering.id}`,
      )
    ).body.items.length,
    1,
  );
  assert.equal(
    (await f.request(f.root + "/offerings/archive", mutation(offering))).status,
    200,
  );
  assert.equal(
    (await f.request(f.root + "/buyer-profiles/approve", mutation(buyer.body)))
      .status,
    404,
  );
  assert.equal(
    (
      await f.request(
        f.root + "/ideal-customer-profiles/approve",
        mutation(icp.body),
      )
    ).status,
    404,
  );
  assert.equal(f.db.rows("ideal_customer_profiles")[0].archived, false);
  assert.equal(f.db.rows("buyer_profiles")[0].archived, false);
  assert.equal(
    (await f.request(f.root + "/buyer-profiles/archive", mutation(buyer.body)))
      .status,
    200,
  );
});
test("scope, client identity, metadata, foreign brands and fresh membership are not caller-controlled", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (
      await f.request(f.root + "/offerings/create", {
        definition,
        workspaceId: f.input.workspaceId,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.request(f.root + "/offerings/create", {
        definition,
        organisationId: f.input.organisationId,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.request(f.root + "/offerings/create", {
        definition,
        approvedBy: f.input.human,
      })
    ).status,
    400,
  );
  assert.equal(
    (await f.request(f.root + "/offerings", undefined, f.vapp)).status,
    404,
  );
  const stranger = await f.auth.sign({
    client_id: "hvmclient",
    sub: "stranger",
  });
  assert.equal(
    (await f.request(f.root + "/offerings", undefined, stranger)).status,
    404,
  );
  const brand = f.db.rows("brands")[0];
  const old = brand.workspaceId;
  brand.workspaceId = generatePlatformId("workspace");
  assert.equal(
    (
      await f.request(f.root + "/offerings/create", {
        definition,
        brandId: brand.id,
      })
    ).status,
    404,
  );
  f.db.rows("brands")[0].workspaceId = old;
  const row = await f.create();
  f.db.rows("hvm_partner_memberships")[0].status = "ended";
  f.db.rows("workspace_memberships")[0].status = "ended";
  assert.equal((await f.request(f.root + `/offerings/${row.id}`)).status, 404);
  assert.equal(
    (await f.request(f.root + "/offerings/approve", mutation(row))).status,
    404,
  );
});
test("viewer reads only; onboarder drafts but cannot approve or archive", async (t) => {
  const f = await fixture(t);
  const row = await f.create();
  f.db.rows("workspace_memberships")[0].role = "member";
  f.db.rows("hvm_partner_memberships")[0].status = "ended";
  assert.equal((await f.request(f.root + "/offerings")).status, 200);
  assert.equal(
    (await f.request(f.root + "/offerings/create", { definition })).status,
    404,
  );
  f.db.rows("hvm_partner_memberships")[0].status = "active";
  f.db.rows("hvm_partner_memberships")[0].role = "member";
  assert.equal(
    (
      await f.request(f.root + "/offerings/update", {
        ...mutation(row),
        definition: { ...definition, name: "Draft" },
      })
    ).status,
    200,
  );
  assert.equal(
    (await f.request(f.root + "/offerings/approve", mutation(row))).status,
    404,
  );
  assert.equal(
    (await f.request(f.root + "/offerings/archive", mutation(row))).status,
    404,
  );
});
test("evidence is append-only, bounded, path validated and never silently overwrites confirmed facts", async (t) => {
  const f = await fixture(t);
  const row = await f.create();
  const observation = {
    field: "name",
    value: "Other name",
    origin: "ai_inferred",
    verification: "human_confirmed",
    observedAt: new Date().toISOString(),
    provider: "Reviewed research",
    sourceReference: "report-1",
    confidence: 0.8,
  };
  const observed = await f.request(f.root + "/offerings/observe", {
    ...mutation(row),
    evidence: observation,
  });
  assert.equal(observed.status, 200);
  assert.equal(observed.body.definition.name, row.definition.name);
  assert.equal(observed.body.contentHash, row.contentHash);
  assert.equal(observed.body.evidence[0].actor.issuer, testIssuer);
  assert.equal(
    (
      await f.request(f.root + "/offerings/observe", {
        ...mutation(observed.body),
        evidence: { ...observation, field: "workspaceId" },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.request(f.root + "/offerings/observe", {
        ...mutation(observed.body),
        evidence: { ...observation, actor: { type: "human", id: "fake" } },
      })
    ).status,
    400,
  );
  const updated = await f.request(f.root + "/offerings/update", {
    ...mutation(observed.body),
    definition: { ...definition, description: "Human changed content" },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.evidence.length, 1);
  assert.equal(
    (
      await f.request(f.root + "/offerings/update", {
        ...mutation(updated.body),
        definition,
        evidence: [],
      })
    ).status,
    400,
  );
  const stored = f.db.rows("offerings")[0];
  assert.ok(stored.evidence[0].observedAt instanceof Date);
  assert.ok(stored.createdAt instanceof Date);
  assert.equal(
    OfferingSchema.safeParse({ ...stored, contentHash: "0".repeat(64) })
      .success,
    false,
  );
});
test("failed audits roll back definitions, snapshots and workspace touches; errors are sanitized", async (t) => {
  const f = await fixture(t);
  const row = await f.create();
  const before = structuredClone(f.db.records);
  f.db.failCollection = "events";
  const r = await f.request(f.root + "/offerings/approve", mutation(row));
  assert.equal(r.status, 503);
  assert.doesNotMatch(JSON.stringify(r.body), /secret|private@|mongodb:/);
  assert.deepEqual(f.db.records, before);
});
test("concurrent stale updates admit one writer; list inputs bounded and unknown revisions denied", async (t) => {
  const f = await fixture(t);
  const row = await f.create();
  const results = await Promise.all(
    ["One", "Two"].map((name) =>
      f.request(f.root + "/offerings/update", {
        ...mutation(row),
        definition: { ...definition, name },
      }),
    ),
  );
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await f.request(f.root + "/offerings?limit=101")).status, 400);
  assert.equal(
    (await f.request(f.root + "/offerings?workspaceId=foo")).status,
    400,
  );
  assert.equal(
    (await f.request(f.root + `/offerings/${row.id}/revisions/1`)).status,
    404,
  );
});
test("schema v5 retains existing HVM access but new foundation fails closed without DDL", async (t) => {
  const f = await fixture(t);
  f.db.rows("schema_versions")[0].version = 5;
  assert.equal((await f.request("/api/v1/hvm/context")).status, 200);
  const before = structuredClone(f.db.records);
  assert.equal(
    (await f.request(f.root + "/offerings/create", { definition })).status,
    503,
  );
  assert.deepEqual(f.db.records, before);
  f.db.rows("schema_versions")[0].version = 7;
  assert.equal((await f.request("/api/v1/hvm/context")).status, 503);
});
test("Organisation hard-delete preview blocks retained Offering references", async (t) => {
  const f = await fixture(t);
  await f.create();
  const preview = await previewCrmDelete(
    f.db.mongo,
    "organisation",
    f.input.organisationId,
  );
  assert.ok(preview.blockedBy.some((b) => b.collection === "offerings"));
});

test("ICP and Buyer approvals retain exact revisions and cannot be reparented", async (t) => {
  const f = await fixture(t);
  const offering = await f.create();
  const icp = await f.request(f.root + "/ideal-customer-profiles/create", {
    offeringId: offering.id,
    definition: {
      name: "Consumers",
      description: "Direct customers",
      profileType: "d2c",
      consumerProfile: { purchasingBehaviour: ["Research before buying"] },
    },
  });
  assert.equal(icp.status, 201);
  const buyer = await f.request(f.root + "/buyer-profiles/create", {
    offeringId: offering.id,
    idealCustomerProfileId: icp.body.id,
    definition: {
      name: "Household decision maker",
      description: "Archetype",
      buyingRoles: ["decision_maker"],
    },
  });
  assert.equal(buyer.status, 201);
  const rows = [
    ["buyer-profiles", buyer.body],
    ["ideal-customer-profiles", icp.body],
  ] as const;
  for (const [path, row] of rows) {
    const approved = await f.request(
      `${f.root}/${path}/approve`,
      mutation(row),
    );
    assert.equal(approved.status, 200);
    const revision = await f.request(`${f.root}/${path}/${row.id}/revisions/1`);
    assert.equal(revision.status, 200);
    assert.equal(revision.body.entityId, row.id);
    assert.equal(
      (
        await f.request(`${f.root}/${path}/update`, {
          ...mutation(approved.body),
          definition: row.definition,
          offeringId: generatePlatformId("offering"),
        })
      ).status,
      400,
    );
    const revised = await f.request(
      `${f.root}/${path}/revise`,
      mutation(approved.body),
    );
    assert.equal(revised.status, 200);
    const updated = await f.request(`${f.root}/${path}/update`, {
      ...mutation(revised.body),
      definition: { ...row.definition, name: "Revised" },
    });
    assert.equal(updated.status, 200);
    assert.equal(
      (await f.request(`${f.root}/${path}/archive`, mutation(updated.body)))
        .status,
      200,
    );
  }
});
test("foreign-workspace parent IDs and revisions are denied even with the same Organisation", async (t) => {
  const f = await fixture(t);
  const offering = await f.create();
  f.db.rows("offerings")[0].workspaceId = generatePlatformId("workspace");
  assert.equal(
    (await f.request(f.root + `/offerings/${offering.id}`)).status,
    404,
  );
  assert.equal(
    (
      await f.request(f.root + "/ideal-customer-profiles/create", {
        offeringId: offering.id,
        definition: {
          name: "Accounts",
          description: "Fit",
          profileType: "b2b",
        },
      })
    ).status,
    404,
  );
  assert.equal(
    (await f.request(f.root + `/offerings/${offering.id}/revisions/1`)).status,
    404,
  );
});
