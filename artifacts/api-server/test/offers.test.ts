import { createHash } from "node:crypto";
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
async function fixture(t: TestContext) {
  const db = new EnquiryMemoryDb();
  db.rows("schema_versions").push({ _id: "vapp-v1", version: 8 });
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

import {
  listOfferMethodologies,
  getOfferMethodology,
} from "../src/domain/offer-methodologies";
import {
  OfferContentSchema,
  OfferDesignSchema,
  OfferSchema,
  OfferRevisionSchema,
} from "../src/domain/offers";
import { offerParityCases } from "./helpers/offer-parity";
import {
  OFFER_MONGO_VALIDATORS,
  offerMongoStructure,
} from "../src/db/offer-validators";
const method = listOfferMethodologies()[0];
const analysis = {
  researchedAt: "2026-09-01T00:00:00Z",
  scope: "Current public alternatives",
  findings: [
    {
      key: "alternative",
      identity: "Alternative supplier",
      kind: "competitor",
      sources: [
        {
          key: "pricing",
          kind: "external_evidence",
          reference: "https://example.com/pricing",
          observedAt: "2026-09-01T00:00:00Z",
        },
      ],
      relevance: "Comparable service",
    },
  ],
  selectedPositioning: "Transparent staged service",
};
async function sources(f: Awaited<ReturnType<typeof fixture>>) {
  const offering = await f.create();
  const approved = await f.request(
    f.root + "/offerings/approve",
    mutation(offering),
  );
  assert.equal(approved.status, 200);
  const icp = await f.request(f.root + "/ideal-customer-profiles/create", {
    offeringId: offering.id,
    definition: {
      name: "Sites",
      description: "Energy intensive sites",
      profileType: "b2b",
    },
  });
  assert.equal(icp.status, 201);
  assert.equal(
    (
      await f.request(
        f.root + "/ideal-customer-profiles/approve",
        mutation(icp.body),
      )
    ).status,
    200,
  );
  const buyer = await f.request(f.root + "/buyer-profiles/create", {
    offeringId: offering.id,
    idealCustomerProfileId: icp.body.id,
    definition: {
      name: "Operator",
      description: "Operational buyer",
      buyingRoles: ["decision_maker"],
    },
  });
  assert.equal(buyer.status, 201);
  assert.equal(
    (await f.request(f.root + "/buyer-profiles/approve", mutation(buyer.body)))
      .status,
    200,
  );
  return {
    offeringId: offering.id,
    icpId: icp.body.id,
    buyerId: buyer.body.id,
  };
}
function output(ids: { icpId: string; buyerId: string }) {
  return {
    name: "SCREEN → FIND → FIX → PROVE",
    targetIcpIds: [ids.icpId],
    targetBuyerProfileIds: [ids.buyerId],
    headlineProposition: "Find and address wasted energy",
    valueProposition: "A staged optimisation service",
    commercialTerms: {
      options: [
        {
          name: "SCREEN",
          pricingModel: "free",
          price: { amountMinor: 0, currency: "GBP" },
        },
        {
          name: "FIND",
          pricingModel: "one_off",
          price: { amountMinor: 199500, currency: "GBP" },
          basis: "per site",
        },
        {
          name: "PROVE",
          pricingModel: "recurring",
          price: { amountMinor: 29500, currency: "GBP" },
          basis: "per site",
          billingFrequency: "monthly",
        },
      ],
    },
    primaryCallToAction: "Request screening",
  };
}
function work(ids: { icpId: string; buyerId: string }, completed = false) {
  return {
    name: "Energy proposition design",
    targetIcpIds: [ids.icpId],
    targetBuyerProfileIds: [ids.buyerId],
    currentStageKey: method.stages[0].key,
    completedStageKeys: completed ? method.stages.map((s) => s.key) : [],
    stages: method.stages.map((s) => ({
      stageKey: s.key,
      status: completed ? "completed" : "in_progress",
      ...(completed
        ? { decisionRationale: "Reviewed options and recorded our decision" }
        : {}),
    })),
    ...(completed ? { competitiveAnalysis: analysis } : {}),
  };
}
async function design(
  f: Awaited<ReturnType<typeof fixture>>,
  ids: Awaited<ReturnType<typeof sources>>,
  completed = false,
) {
  const r = await f.request(f.root + "/offer-designs/create", {
    offeringId: ids.offeringId,
    methodologyId: method.id,
    methodologyVersion: 1,
    work: work(ids, completed),
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
}

test("Value Equation is globally versioned data with fourteen stages, four dimensions and immutable reads", () => {
  assert.equal(
    createHash("sha256").update(JSON.stringify(method)).digest("hex"),
    "f0ab9558230694ec4d9ecb6381bb154229b182486f6b3f6cfb1fca05e1e37116",
  );
  assert.equal(method.name, "Value Equation");
  assert.equal(method.key, "value_equation");
  assert.equal(method.version, 1);
  assert.equal(method.stages.length, 14);
  assert.equal(method.conceptualModel.dimensions.length, 4);
  const altered = getOfferMethodology(method.id, 1)!;
  altered.stages[0].name = "changed";
  assert.notEqual(getOfferMethodology(method.id, 1)!.stages[0].name, "changed");
  assert.equal(getOfferMethodology(method.id, 2), undefined);
});
test("strict canonical Offer is descriptive commerce, not marketing copy or billing execution", () => {
  const definition = output({
    icpId: generatePlatformId("icp"),
    buyerId: generatePlatformId("buyerprofile"),
  });
  assert.equal(OfferContentSchema.safeParse(definition).success, true);
  assert.equal(
    OfferContentSchema.safeParse({
      ...definition,
      methodologyKey: "value_equation",
    }).success,
    false,
  );
  assert.equal(
    OfferContentSchema.safeParse({ ...definition, emailSequence: "No" })
      .success,
    false,
  );
  assert.equal(
    OfferContentSchema.safeParse({
      ...definition,
      commercialTerms: {
        options: [
          {
            name: "Invalid",
            pricingModel: "free",
            price: { amountMinor: 1, currency: "GBP" },
          },
        ],
      },
    }).success,
    false,
  );
  assert.equal(
    OfferContentSchema.safeParse({
      ...definition,
      commercialTerms: {
        options: [
          {
            name: "Invalid",
            pricingModel: "one_off",
            price: { amountMinor: 2.5, currency: "XYZ" },
          },
        ],
      },
    }).success,
    false,
  );
  assert.ok(OFFER_MONGO_VALIDATORS.offer_revisions);
  const generated = offerMongoStructure(OfferContentSchema);
  assert.equal(generated.additionalProperties, false);
  assert.equal(generated.properties.components.maxItems, 40);
});
test("resumable design, mandatory competitive review, explicit completion then separate Offer approval", async (t) => {
  const f = await fixture(t);
  const ids = await sources(f);
  let d = await design(f, ids);
  const before = structuredClone(f.db.rows("offerings"));
  const methods = await f.request(f.root + "/offer-design-methodologies");
  assert.equal(methods.status, 200);
  assert.equal(methods.body.items[0].stages.length, 14);
  assert.equal(
    (await f.request(f.root + "/offer-designs/ready", mutation(d))).status,
    400,
  );
  const updated = await f.request(f.root + "/offer-designs/update", {
    ...mutation(d),
    work: work(ids, true),
  });
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  assert.equal(
    (
      await f.request(f.root + "/offer-designs/update", {
        ...mutation(d),
        work: work(ids),
      })
    ).status,
    409,
  );
  d = (await f.request(f.root + "/offer-designs/ready", mutation(updated.body)))
    .body;
  assert.equal(d.status, "ready_for_review");
  d = (await f.request(f.root + "/offer-designs/complete", mutation(d))).body;
  assert.equal(d.status, "completed");
  assert.equal(f.db.rows("offers").length, 0);
  assert.equal(
    (
      await f.request(f.root + "/offer-designs/update", {
        ...mutation(d),
        work: work(ids),
      })
    ).status,
    409,
  );
  const created = await f.request(f.root + "/offers/create", {
    offeringId: ids.offeringId,
    offerDesignId: d.id,
    definition: output(ids),
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const approved = await f.request(
    f.root + "/offers/approve",
    mutation(created.body),
  );
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.status, "approved");
  assert.equal(
    approved.body.lineage.methodology.methodologyKey,
    "value_equation",
  );
  assert.equal(approved.body.lineage.offering.revision, 1);
  assert.equal(
    (
      await f.request(f.root + "/offers/update", {
        ...mutation(approved.body),
        definition: output(ids),
      })
    ).status,
    409,
  );
  const history = await f.request(
    f.root + `/offers/${created.body.id}/revisions/1`,
  );
  assert.equal(history.status, 200);
  assert.equal(history.body.designSnapshot.work.stages.length, 14);
  const reopened = await f.request(
    f.root + "/offer-designs/reopen",
    mutation(d),
  );
  assert.equal(reopened.status, 200);
  assert.equal(
    (
      await f.request(f.root + "/offer-designs/update", {
        ...mutation(reopened.body),
        work: work(ids),
      })
    ).status,
    200,
  );
  assert.deepEqual(
    (await f.request(f.root + `/offers/${created.body.id}/revisions/1`)).body,
    history.body,
  );
  const revised = await f.request(
    f.root + "/offers/revise",
    mutation(approved.body),
  );
  assert.equal(revised.status, 200);
  assert.equal(revised.body.revision, 2);
  assert.equal(revised.body.approvedRevision, 1);
  assert.equal(
    (await f.request(f.root + "/offers/archive", mutation(revised.body)))
      .status,
    200,
  );
  assert.equal(
    (await f.request(f.root + `/offers/${created.body.id}/revisions/1`)).status,
    200,
  );
  assert.deepEqual(f.db.rows("offerings"), before);
});
test("working artifacts retain explicit decisions and assumptions, reject hidden reasoning and unknown stages", async (t) => {
  const f = await fixture(t);
  const ids = await sources(f);
  const d = await design(f, ids);
  const value = work(ids);
  const full = {
    ...value,
    stages: [
      {
        stageKey: method.stages[0].key,
        status: "in_progress",
        evidence: [
          {
            key: "fact",
            kind: "hive_revision",
            reference: "Offering revision 1",
            observedAt: "2026-09-01T00:00:00Z",
          },
        ],
        facts: [
          { statement: "Factual delivery", evidenceReferenceKeys: ["fact"] },
        ],
        assumptions: [
          {
            key: "conversion",
            statement: "Free screening will improve response",
            validationQuestion: "Does conversion increase?",
          },
        ],
        optionsConsidered: [
          {
            key: "free",
            name: "Free screening",
            description: "Initial proposition",
            status: "selected",
            rationale: "Reduce purchase friction",
            requiresOfferingChange: false,
          },
        ],
        selectedOptionKeys: ["free"],
        decisionRationale: "Human commercial choice",
      },
    ],
  };
  const r = await f.request(f.root + "/offer-designs/update", {
    ...mutation(d),
    work: full,
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.work.stages[0].assumptions[0].status, "untested");
  for (const changed of [
    { ...full, stages: [{ stageKey: "unknown", status: "in_progress" }] },
    { ...full, hiddenChainOfThought: "No" },
  ])
    assert.equal(
      (
        await f.request(f.root + "/offer-designs/update", {
          ...mutation(r.body),
          work: changed,
        })
      ).status,
      400,
    );
  assert.equal(
    OfferDesignSchema.safeParse({
      ...f.db.rows("offer_designs")[0],
      methodologyVersion: 2,
    }).success,
    false,
  );
});
test("standalone Offer approval requires sourced competitive analysis and approved Hive lineage", async (t) => {
  const f = await fixture(t);
  const ids = await sources(f);
  const r = await f.request(f.root + "/offers/create", {
    offeringId: ids.offeringId,
    definition: output(ids),
  });
  assert.equal(r.status, 201);
  assert.equal(
    (await f.request(f.root + "/offers/approve", mutation(r.body))).status,
    409,
  );
  const updated = await f.request(f.root + "/offers/update", {
    ...mutation(r.body),
    definition: output(ids),
    competitiveAnalysis: analysis,
  });
  assert.equal(updated.status, 200);
  assert.equal(
    (await f.request(f.root + "/offers/approve", mutation(updated.body)))
      .status,
    200,
  );
  assert.equal(
    (
      await f.request(f.root + "/offers/create", {
        offeringId: ids.offeringId,
        definition: output(ids),
        competitiveAnalysis: {
          ...analysis,
          findings: [
            {
              ...analysis.findings[0],
              sources: [
                { ...analysis.findings[0].sources[0], kind: "user_supplied" },
              ],
            },
          ],
        },
      })
    ).status,
    400,
  );
});
test("scope, ownership, application, human role and current memberships remain authoritative", async (t) => {
  const f = await fixture(t);
  const ids = await sources(f);
  const d = await design(f, ids);
  assert.equal(
    (await f.request(f.root + "/offer-designs", undefined, f.vapp)).status,
    404,
  );
  assert.equal(
    (
      await f.request(f.root + "/offer-designs/create", {
        offeringId: ids.offeringId,
        methodologyId: method.id,
        methodologyVersion: 1,
        work: work(ids),
        workspaceId: f.input.workspaceId,
      })
    ).status,
    400,
  );
  const stranger = await f.auth.sign({
    client_id: "hvmclient",
    sub: "stranger",
  });
  assert.equal(
    (await f.request(f.root + "/offer-designs", undefined, stranger)).status,
    404,
  );
  f.db.rows("workspace_memberships")[0].role = "member";
  f.db.rows("hvm_partner_memberships")[0].status = "ended";
  assert.equal((await f.request(f.root + "/offer-designs")).status, 200);
  assert.equal(
    (await f.request(f.root + "/offer-designs/start", mutation(d))).status,
    404,
  );
  f.db.rows("hvm_partner_memberships")[0].status = "active";
  f.db.rows("hvm_partner_memberships")[0].role = "member";
  assert.equal(
    (await f.request(f.root + "/offer-designs/start", mutation(d))).status,
    200,
  );
  assert.equal(
    (await f.request(f.root + "/offer-designs/archive", mutation(d))).status,
    404,
  );
});
test("cross-Offering Buyer/ICP selections and foreign workspace references fail closed", async (t) => {
  const f = await fixture(t);
  const ids = await sources(f);
  const other = await f.create();
  assert.equal(
    (
      await f.request(f.root + "/offers/create", {
        offeringId: other.id,
        definition: output(ids),
      })
    ).status,
    404,
  );
  f.db.rows("buyer_profiles")[0].workspaceId = generatePlatformId("workspace");
  assert.equal(
    (
      await f.request(f.root + "/offers/create", {
        offeringId: ids.offeringId,
        definition: output(ids),
      })
    ).status,
    404,
  );
});
test("failure rolls back design and workspace writes; schema v7 never auto-creates Offer data", async (t) => {
  const f = await fixture(t);
  const ids = await sources(f);
  const before = structuredClone(f.db.records);
  f.db.failCollection = "events";
  const r = await f.request(f.root + "/offer-designs/create", {
    offeringId: ids.offeringId,
    methodologyId: method.id,
    methodologyVersion: 1,
    work: work(ids),
  });
  assert.equal(r.status, 503);
  assert.doesNotMatch(JSON.stringify(r.body), /secret|mongodb:/);
  assert.deepEqual(f.db.records, before);
  f.db.failCollection = undefined;
  f.db.rows("schema_versions")[0].version = 7;
  assert.equal((await f.request("/api/v1/hvm/context")).status, 200);
  assert.equal((await f.request(f.root + "/offers")).status, 503);
  assert.equal(f.db.records.offers, undefined);
});

test("proposed Offer Mongo validators agree with canonical records and representative invalid boundaries without writes", async (t) => {
  const f = await fixture(t);
  const ids = await sources(f);
  let d = await design(f, ids, true);
  d = (await f.request(f.root + "/offer-designs/ready", mutation(d))).body;
  d = (await f.request(f.root + "/offer-designs/complete", mutation(d))).body;
  const created = await f.request(f.root + "/offers/create", {
    offeringId: ids.offeringId,
    offerDesignId: d.id,
    definition: output(ids),
  });
  assert.equal(created.status, 201);
  assert.equal(
    (await f.request(f.root + "/offers/approve", mutation(created.body)))
      .status,
    200,
  );
  const schemas = {
    offer_designs: OfferDesignSchema,
    offers: OfferSchema,
    offer_revisions: OfferRevisionSchema,
  };
  const cases = Object.entries(schemas).map(([collection, schema]) => ({
    collection,
    schema,
    variants: offerParityCases(collection, f.db.rows(collection)[0]),
  }));
  for (const { collection, schema, variants } of cases) {
    for (const variant of variants)
      await t.test(`${collection}: ${variant.name} (Zod)`, () => {
        const parsed = schema.safeParse(variant.document);
        assert.equal(
          parsed.success,
          variant.valid,
          parsed.success ? variant.name : JSON.stringify(parsed.error.issues),
        );
      });
  }
  await t.test(
    "read-only proposed validators in Mongo",
    { skip: process.env.OFFER_PARITY_MONGO !== "true" },
    async (t) => {
      const { MongoClient } = await import("mongodb");
      assert.ok(process.env.MONGODB_URI);
      const client = new MongoClient(process.env.MONGODB_URI, {
        serverSelectionTimeoutMS: 5000,
      });
      try {
        await client.connect();
        for (const { collection, variants } of cases) {
          // Batches bound command size; no insert/out/merge or temporary collection.
          for (let start = 0; start < variants.length; start += 10) {
            const batch = variants.slice(start, start + 10);
            const accepted = await client
              .db("vamberic_studio")
              .aggregate([
                {
                  $documents: {
                    $literal: batch.map((v, i) => ({ ...v.document, _id: i })),
                  },
                },
                { $match: OFFER_MONGO_VALIDATORS[collection] },
                { $project: { _id: 1 } },
              ])
              .toArray();
            const ids = new Set(accepted.map((v) => v._id));
            for (const [i, variant] of batch.entries())
              await t.test(`${collection}: ${variant.name} (Mongo)`, () => {
                assert.equal(ids.has(i), variant.valid);
              });
          }
        }
      } catch (error) {
        if (error instanceof assert.AssertionError) throw error;
        throw new Error(
          "Read-only Offer validator query failed; provider details withheld",
        );
      } finally {
        await client.close();
      }
    },
  );
});

test("completed design pins approved Hive sources even if a source gets a newer approval", async (t) => {
  const f = await fixture(t);
  const ids = await sources(f);
  let d = await design(f, ids, true);
  d = (await f.request(f.root + "/offer-designs/ready", mutation(d))).body;
  d = (await f.request(f.root + "/offer-designs/complete", mutation(d))).body;
  assert.equal(d.sourceRevisions.offering.revision, 1);
  const previous = (await f.request(f.root + `/offerings/${ids.offeringId}`))
    .body;
  const revised = (
    await f.request(f.root + "/offerings/revise", mutation(previous))
  ).body;
  assert.equal(
    (await f.request(f.root + "/offerings/approve", mutation(revised))).status,
    200,
  );
  const offer = (
    await f.request(f.root + "/offers/create", {
      offeringId: ids.offeringId,
      offerDesignId: d.id,
      definition: output(ids),
    })
  ).body;
  const approved = await f.request(f.root + "/offers/approve", mutation(offer));
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.lineage.offering.revision, 1);
});
