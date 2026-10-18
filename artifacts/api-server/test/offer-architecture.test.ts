import { createIcpApplication } from "../src/services/icp/application";
import { readHiveDefinitions } from "../src/services/hive-definitions";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Document } from "mongodb";
import { randomUUID } from "node:crypto";
import { EnquiryMemoryDb } from "./helpers/enquiry-db";
import { authEnvironment, testIssuer } from "./helpers/auth";
import { parseConfig } from "../src/config";
import { generatePlatformId, OrganisationSchema } from "../src/domain";
import { provisionHvmClient } from "../src/services/hvm-provision";
import { mutateHiveDefinition } from "../src/services/hive-definitions";
import {
  createOfferArchitecture,
  generationWork,
} from "../src/services/offer-architecture/application";
import {
  createOfferGenerator,
  GeneratedOfferSchema,
  briefKeys,
} from "../src/services/offer-architecture/generate";
import { listOfferMethodologies } from "../src/domain/offer-methodologies";
import type { OfferGenerator } from "../src/services/offer-architecture/generate";
const identity = {
  subject: "test-user-subject",
  issuer: testIssuer,
  clientId: "hvmclient",
};
const config = parseConfig({
  ...authEnvironment,
  HVM_COGNITO_CLIENT_ID: "hvmclient",
  HVM_CORS_ORIGINS: "https://app.h-v-m.net",
  DEPLOYMENT_ENV: "test",
  MONGODB_URI: "mongodb://unused.invalid",
});
function draft(icp: string) {
  return GeneratedOfferSchema.parse({
    definition: {
      name: "Explore",
      targetIcpIds: [icp],
      headlineProposition: "Find a useful next step",
      valueProposition: "Understand the options",
      commercialTerms: {
        options: [{ name: "Terms to confirm", pricingModel: "custom_quote" }],
      },
      primaryCallToAction: "Explore the product",
    },
    stages: listOfferMethodologies()[0]!.stages.map((s) => ({
      stageKey: s.key,
      summary: "Proposed decision for review",
      questions: [],
    })),
    researchBrief: Object.fromEntries(
      briefKeys.map((k) => [k, ["A hypothesis to check"]]),
    ),
    competitors: [],
  });
}
async function setup(generate?: OfferGenerator) {
  const db = new EnquiryMemoryDb();
  db.rows("schema_versions").push({ _id: "vapp-v1", version: 26 });
  const now = new Date();
  const org = generatePlatformId("org"),
    w = generatePlatformId("workspace"),
    brand = generatePlatformId("brand");
  db.rows("organisations").push(
    OrganisationSchema.parse({
      id: org,
      name: "Client",
      type: "customer",
      createdAt: now,
      updatedAt: now,
    }),
  );
  await provisionHvmClient(
    db.mongo,
    {
      organisationId: org,
      workspaceId: w,
      partnerId: generatePlatformId("partner"),
      partnerMembershipId: generatePlatformId("partnermembership"),
      assignmentId: generatePlatformId("partnerassignment"),
      brandId: brand,
      clientMembershipId: generatePlatformId("workspacemembership"),
      workspaceName: "Client",
      partnerName: "Agency",
      brandName: "Brand",
      brandSlug: "brand",
      human: { type: "human", issuer: testIssuer, id: identity.subject },
    },
    testIssuer,
  );
  const mutate = (
    kind: "offerings" | "ideal_customer_profiles",
    op: "create" | "approve",
    body: unknown,
  ) => mutateHiveDefinition(db.mongo, config, identity, w, kind, op, body);
  const p = await mutate("offerings", "create", {
    brandId: brand,
    definition: {
      name: "Product",
      description: "Public product description",
      primaryOfferingType: "software",
      implementationModel: "no_implementation",
      deliveryModes: ["digital_self_service"],
      unknowns: [],
    },
  });
  await mutate("offerings", "approve", {
    id: p.id,
    expectedUpdatedAt: p.updatedAt.toISOString(),
  });
  const i = await mutate("ideal_customer_profiles", "create", {
    offeringId: p.id,
    definition: {
      name: "Teams",
      description: "Teams needing help",
      profileType: "b2b",
    },
  });
  await mutate("ideal_customer_profiles", "approve", {
    id: i.id,
    expectedUpdatedAt: i.updatedAt.toISOString(),
  });
  return {
    db,
    w,
    p,
    i,
    app: createOfferArchitecture(config, db.mongo, generate),
  };
}
async function finished(
  app: ReturnType<typeof createOfferArchitecture>,
  w: string,
  id: string,
) {
  for (let n = 0; n < 100; n++) {
    const j = await app.read(identity, w, id);
    if (j.status !== "generating") return j;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw Error("Did not finish");
}
test("generation saves offer + design, deduplicates retries, fences stale saves and requires review", async () => {
  let count = 0;
  const f = await setup(async (input) => {
    count++;
    return {
      draft: draft(input.targetIcpIds[0]!),
      sources: [],
      usage: { model: "fixture", inputTokens: 10, outputTokens: 20 },
      limitations: [],
    };
  });
  const input = {
    offeringId: f.p.id,
    targetIcpIds: [f.i.id],
    instructions: "",
    requestKey: randomUUID(),
  };
  const first = await f.app.start(identity, f.w, input);
  const j = await finished(f.app, f.w, first.id);
  assert.equal(j.status, "complete");
  assert.equal(count, 1);
  assert.equal((await f.app.start(identity, f.w, input)).id, first.id);
  assert.equal(count, 1);
  const b = await f.app.bundle(identity, f.w, j.offerId);
  assert.equal(b.offer.status, "draft");
  assert.equal(f.db.rows("offers").length, 1);
  assert.equal(f.db.rows("offer_designs").length, 1);
  assert.equal((b.design as Document).work.stages.length, 14);
  await assert.rejects(
    f.app.transition(identity, f.w, {
      id: b.offer.id,
      expectedUpdatedAt: b.offer.updatedAt.toISOString(),
      expectedDesignUpdatedAt: (b.design as Document).updatedAt.toISOString(),
      action: "approve",
    }),
  );
  await assert.rejects(
    f.app.save(identity, f.w, {
      id: b.offer.id,
      designId: (b.design as Document).id,
      expectedUpdatedAt: new Date(0).toISOString(),
      expectedDesignUpdatedAt: (b.design as Document).updatedAt.toISOString(),
      definition: b.offer.definition,
      work: (b.design as Document).work,
    }),
  );
  await assert.rejects(
    f.app.read(identity, generatePlatformId("workspace"), j.id),
  );
});
test("failed generation leaves no partial records and reports failure", async () => {
  const f = await setup(async () => {
    throw Error("provider failed");
  });
  const j = await f.app.start(identity, f.w, {
    offeringId: f.p.id,
    targetIcpIds: [f.i.id],
    instructions: "",
    requestKey: randomUUID(),
  });
  assert.equal((await finished(f.app, f.w, j.id)).status, "failed");
  assert.equal(f.db.rows("offers").length, 0);
  assert.equal(f.db.rows("offer_designs").length, 0);
});
test("generator handles missing research without inventing sources and rejects mismatched targets", async () => {
  const id = generatePlatformId("icp");
  let calls = 0;
  let invalid = false;
  const send: typeof fetch = async (_u, init) => {
    calls++;
    const b = JSON.parse(String(init?.body));
    assert.equal(b.store, false);
    const d = draft(invalid ? generatePlatformId("icp") : id);
    (d.definition as unknown as Record<string, unknown>).promise = 123;
    d.competitors = [
      {
        identity: "Unverified",
        kind: "competitor",
        sourceIndexes: [99],
        relevance: "Draft",
        positioning: "Draft",
        strengths: [],
        weaknessesGaps: [],
      },
    ];
    assert.match(b.input[0].content, /British English/);
    return Response.json({
      status: "completed",
      model: "fixture",
      usage: { input_tokens: 10, output_tokens: 20 },
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: JSON.stringify(d) }],
        },
      ],
    });
  };
  const gen = createOfferGenerator(
    { apiKey: "fake", project: "proj_fixture", model: "fixture" },
    send,
  );
  const input = {
    context: {},
    research: false,
    instructions: "",
    sourceUrls: [],
    targetIcpIds: [id],
    targetBuyerProfileIds: [],
  };
  const result = await gen(input, new AbortController().signal);
  assert.equal(calls, 1);
  assert.equal(result.sources.length, 0);
  assert.equal(result.draft.definition.promise, undefined);
  assert.equal(result.draft.competitors.length, 0);
  assert.ok(result.limitations.some((s) => s.includes("source references")));
  assert.equal(
    generationWork(result, {
      offeringId: generatePlatformId("offering"),
      targetIcpIds: [id],
      targetBuyerProfileIds: [],
    }).competitiveAnalysis,
    undefined,
  );
  invalid = true;
  await assert.rejects(gen(input, new AbortController().signal), /targets/);
});
test("reviewed offer can be approved, revised and saved without altering immutable approval", async () => {
  const f = await setup(async (input) => ({
    draft: {
      ...draft(input.targetIcpIds[0]!),
      competitors: [
        {
          identity: "Alternative",
          kind: "competitor",
          sourceIndexes: [0],
          relevance: "Comparable",
          positioning: "Alternative",
          strengths: [],
          weaknessesGaps: [],
        },
      ],
    },
    sources: [
      {
        url: "https://example.com/alternative",
        observedAt: new Date().toISOString(),
      },
    ],
    usage: { model: "fixture", inputTokens: 10, outputTokens: 20 },
    limitations: [],
  }));
  const job = await f.app.start(identity, f.w, {
    offeringId: f.p.id,
    targetIcpIds: [f.i.id],
    instructions: "",
    requestKey: randomUUID(),
  });
  const j = await finished(f.app, f.w, job.id);
  let b = await f.app.bundle(identity, f.w, j.offerId);
  let d = b.design as Document;
  const work = {
    ...d.work,
    completedStageKeys: d.work.stages.map((s: Document) => s.stageKey),
    stages: d.work.stages.map((s: Document) => ({
      ...s,
      status: "completed",
      decisionRationale: "Reviewed against customer needs",
    })),
  };
  b = await f.app.save(identity, f.w, {
    id: b.offer.id,
    expectedUpdatedAt: b.offer.updatedAt.toISOString(),
    designId: d.id,
    expectedDesignUpdatedAt: d.updatedAt.toISOString(),
    definition: b.offer.definition,
    work,
  });
  d = b.design as Document;
  f.db.rows("schema_versions")[0]!.version = 28;
  f.db.rows("schema_versions")[0]!.version = 28;
  b = await f.app.transition(identity, f.w, {
    id: b.offer.id,
    expectedUpdatedAt: b.offer.updatedAt.toISOString(),
    expectedDesignUpdatedAt: d.updatedAt.toISOString(),
    action: "approve",
  });
  assert.equal(b.offer.status, "approved");
  assert.equal(f.db.rows("offer_revisions").length, 1);
  const approved = JSON.stringify(f.db.rows("offer_revisions"));
  f.db.rows("schema_versions")[0]!.version = 27;
  const icpApp = createIcpApplication(config, f.db.mongo, async (input) => {
    assert.equal((input.offer as Document).id, b.offer.id);
    assert.equal((input.offer as Document).revision, 1);
    assert.equal(
      (input.offer as Document).definition.headlineProposition,
      b.offer.definition.headlineProposition,
    );
    return {
      definition: {
        name: "Offer-specific segment",
        description: "Commercially suitable customers",
        profileType: "b2b",
      },
      rationale: "Based on the selected offer",
      usage: { model: "fixture", inputTokens: 1, outputTokens: 1 },
    };
  });
  await assert.rejects(
    icpApp.start(identity, f.w, {
      offeringId: f.p.id,
      profileType: "b2b",
      instructions: "",
      examples: [],
      requestKey: randomUUID(),
    }),
    /Choose an approved offer/,
  );
  const icpJob = await icpApp.start(identity, f.w, {
    offeringId: f.p.id,
    offer: { id: b.offer.id, revision: 1 },
    profileType: "b2b",
    instructions: "",
    examples: [],
    requestKey: randomUUID(),
  });
  let icpResult = await icpApp.read(identity, f.w, icpJob.id);
  for (let n = 0; n < 100 && icpResult.status === "generating"; n++) {
    await new Promise((r) => setTimeout(r, 5));
    icpResult = await icpApp.read(identity, f.w, icpJob.id);
  }
  assert.equal(icpResult.status, "review");
  const linked = await icpApp.save(
    identity,
    f.w,
    icpJob.id,
    icpResult.definition,
  );
  assert.deepEqual(linked!.offer, { id: b.offer.id, revision: 1 });
  assert.equal(
    (
      (await readHiveDefinitions(
        f.db.mongo,
        config,
        identity,
        f.w,
        "ideal_customer_profiles",
        {},
        linked!.id,
      )) as Document
    ).offerLinkStatus,
    "current",
  );
  assert.equal(
    (
      (await readHiveDefinitions(
        f.db.mongo,
        config,
        identity,
        f.w,
        "ideal_customer_profiles",
        {},
        f.i.id,
      )) as Document
    ).offerLinkStatus,
    "unlinked",
  );
  const approvedIcp = await mutateHiveDefinition(
    f.db.mongo,
    config,
    identity,
    f.w,
    "ideal_customer_profiles",
    "approve",
    { id: linked!.id, expectedUpdatedAt: linked!.updatedAt.toISOString() },
  );
  const { createEligibility } = await import("../src/services/icp/eligibility");
  const eligibility = createEligibility(config, f.db.mongo);
  const policy = await eligibility.save(identity, f.w, {
    requestKey: randomUUID(),
    definition: {
      name: "Manufacturing fit",
      exclusivity: "one_offer_per_organisation",
      segments: [
        {
          icpId: approvedIcp.id,
          revision: approvedIcp.revision,
          rules: [
            { field: "industry", effect: "include", values: ["Manufacturing"] },
            { field: "department", effect: "include", values: ["Marketing"] },
          ],
        },
      ],
      offerPriority: [b.offer.id],
    },
  });
  await assert.rejects(
    eligibility.identify(identity, f.w, { policyId: policy.id }),
    /Approve a policy/,
  );
  const editInput = {
    id: policy.id,
    expectedUpdatedAt: policy.updatedAt,
    requestKey: randomUUID(),
    definition: { ...policy.definition, name: "Reviewed manufacturing fit" },
  };
  const updated = await eligibility.updateDraft(identity, f.w, editInput);
  assert.equal(updated.id, policy.id);
  assert.equal(updated.definition.name, "Reviewed manufacturing fit");
  assert.deepEqual(
    await eligibility.updateDraft(identity, f.w, editInput),
    updated,
  );
  await assert.rejects(
    eligibility.updateDraft(identity, f.w, {
      ...editInput,
      requestKey: randomUUID(),
    }),
    /Draft changed/,
  );
  assert.equal(
    f.db
      .rows("events")
      .filter((e) => e.eventType === "icp_eligibility_draft_edit").length,
    1,
  );
  Object.assign(policy, updated);
  const disposable = await eligibility.save(identity, f.w, {
    requestKey: randomUUID(),
    definition: { ...policy.definition, name: "Disposable draft" },
  });
  const staleDelete = await eligibility.deleteDrafts(identity, f.w, {
    confirmation: "DELETE",
    items: [
      { id: policy.id, expectedUpdatedAt: editInput.expectedUpdatedAt },
      { id: disposable.id, expectedUpdatedAt: disposable.updatedAt },
    ],
  });
  assert.deepEqual(
    staleDelete.results.map((r) => r.status),
    ["changed", "deleted"],
  );
  const repeatDelete = await eligibility.deleteDrafts(identity, f.w, {
    confirmation: "DELETE",
    items: [{ id: disposable.id, expectedUpdatedAt: disposable.updatedAt }],
  });
  assert.equal(repeatDelete.results[0]?.status, "deleted");
  assert.equal(
    (await eligibility.read(identity, f.w)).some((p) => p.id === disposable.id),
    false,
  );
  await assert.rejects(
    eligibility.updateDraft(identity, f.w, { ...editInput, id: disposable.id }),
    /Only drafts/,
  );
  await assert.rejects(
    eligibility.deleteDrafts({ ...identity, subject: "unrelated-user" }, f.w, {
      confirmation: "DELETE",
      items: [{ id: policy.id, expectedUpdatedAt: policy.updatedAt }],
    }),
  );
  await eligibility.approve(identity, f.w, {
    id: policy.id,
    expectedUpdatedAt: policy.updatedAt,
  });
  const protectedDelete = await eligibility.deleteDrafts(identity, f.w, {
    confirmation: "DELETE",
    items: [{ id: policy.id, expectedUpdatedAt: policy.updatedAt }],
  });
  assert.equal(protectedDelete.results[0]?.status, "protected");
  await assert.rejects(
    eligibility.updateDraft(identity, f.w, {
      ...editInput,
      expectedUpdatedAt: policy.updatedAt,
      requestKey: randomUUID(),
    }),
    /Only drafts/,
  );
  const companyId = generatePlatformId("org");
  f.db.rows("organisations").push({
    id: companyId,
    workspaceId: f.w,
    name: "Matching manufacturer",
    industry: "Manufacturing",
    archived: false,
  });
  f.db.rows("organisations").push({
    id: generatePlatformId("org"),
    workspaceId: generatePlatformId("workspace"),
    name: "Other tenant",
    industry: "Manufacturing",
    archived: false,
  });
  for (const [firstName, department] of [
    ["Match", "Marketing"],
    ["Excluded", "Finance"],
    ["Unknown", undefined],
  ]) {
    const personId = generatePlatformId("person");
    f.db.rows("people").push({ id: personId, workspaceId: f.w, firstName });
    f.db.rows("organisation_relationships").push({
      id: generatePlatformId("orgrel"),
      workspaceId: f.w,
      personId,
      organisationId: companyId,
      current: true,
      department,
    });
  }
  const identified = await eligibility.identify(identity, f.w, {
    policyId: policy.id,
  });
  assert.equal(identified.items.length, 1);
  assert.equal(identified.items[0]!.id, companyId);
  assert.deepEqual(identified.items[0]!.permittedOfferIds, [b.offer.id]);
  assert.equal(identified.campaignSelection, null);
  const contacts = identified.items[0]!.contacts;
  assert.deepEqual(
    contacts.find((c) => c.name === "Match")?.permittedOfferIds,
    [b.offer.id],
  );
  assert.deepEqual(
    contacts.find((c) => c.name === "Excluded")?.permittedOfferIds,
    [],
  );
  assert.equal(
    contacts.find((c) => c.name === "Unknown")?.roleFit,
    "needs_review",
  );
  const preserved = JSON.stringify(f.db.rows("ideal_customer_profiles"));
  const offerRow = f.db.rows("offers").find((row) => row.id === b.offer.id)!;
  offerRow.approvedRevision = 2;
  assert.equal(
    (
      (await readHiveDefinitions(
        f.db.mongo,
        config,
        identity,
        f.w,
        "ideal_customer_profiles",
        {},
        linked!.id,
      )) as Document
    ).offerLinkStatus,
    "stale",
  );
  assert.equal(JSON.stringify(f.db.rows("ideal_customer_profiles")), preserved);
  await assert.rejects(
    eligibility.identify(identity, f.w, { policyId: policy.id }),
    /offer changed/,
  );
  await assert.rejects(
    mutateHiveDefinition(
      f.db.mongo,
      config,
      identity,
      f.w,
      "ideal_customer_profiles",
      "approve",
      {
        id: linked!.id,
        expectedUpdatedAt: approvedIcp.updatedAt.toISOString(),
      },
    ),
    /approved offer changed/,
  );
  f.db.rows("offers").find((row) => row.id === b.offer.id)!.approvedRevision =
    1;
  d = b.design as Document;
  f.db.rows("schema_versions")[0]!.version = 28;
  b = await f.app.transition(identity, f.w, {
    id: b.offer.id,
    expectedUpdatedAt: b.offer.updatedAt.toISOString(),
    expectedDesignUpdatedAt: d.updatedAt.toISOString(),
    action: "revise",
  });
  assert.equal(b.offer.status, "draft");
  assert.equal(JSON.stringify(f.db.rows("offer_revisions")), approved);
});
test("source changes during generation cannot produce an offer", async () => {
  let resolve!: (value: Awaited<ReturnType<OfferGenerator>>) => void;
  const f = await setup(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const j = await f.app.start(identity, f.w, {
    offeringId: f.p.id,
    targetIcpIds: [f.i.id],
    instructions: "",
    requestKey: randomUUID(),
  });
  f.db.rows("offerings").find((x) => x.id === f.p.id)!.approvedRevision = 2;
  resolve({
    draft: draft(f.i.id),
    sources: [],
    usage: { model: "fixture", inputTokens: 1, outputTokens: 1 },
    limitations: [],
  });
  assert.equal((await finished(f.app, f.w, j.id)).status, "failed");
  assert.equal(f.db.rows("offers").length, 0);
});

test("existing customer patterns are scoped, optional and absent from public discovery context", async () => {
  let observed: Parameters<OfferGenerator>[0] | undefined;
  const f = await setup(async (input) => {
    observed = input;
    return {
      draft: draft(input.targetIcpIds[0]!),
      sources: [],
      usage: { model: "fixture", inputTokens: 1, outputTokens: 1 },
      limitations: [],
    };
  });
  f.db.rows("organisations").push(
    {
      id: generatePlatformId("org"),
      workspaceId: f.w,
      type: "customer",
      name: "Private customer name",
      industry: "Manufacturing",
      country: "GB",
      archived: false,
    },
    {
      id: generatePlatformId("org"),
      workspaceId: generatePlatformId("workspace"),
      type: "customer",
      industry: "Other tenant",
      archived: false,
    },
    {
      id: generatePlatformId("org"),
      workspaceId: f.w,
      type: "prospect",
      industry: "Not a customer",
      archived: false,
    },
  );
  const j = await f.app.start(identity, f.w, {
    offeringId: f.p.id,
    targetIcpIds: [f.i.id],
    instructions: "",
    requestKey: randomUUID(),
  });
  await finished(f.app, f.w, j.id);
  const context = JSON.stringify(observed?.context);
  assert.match(context, /Manufacturing/);
  assert.doesNotMatch(
    context,
    /Private customer name|Other tenant|Not a customer/,
  );
  assert.doesNotMatch(
    JSON.stringify(observed?.researchContext),
    /Manufacturing|Private customer/,
  );
});

test("public discovery rejects non-public URL shapes and requires an executed search", async () => {
  const { createOfferResearch } =
    await import("../src/services/offer-architecture/research");
  let executed = true;
  const search = createOfferResearch(
    { apiKey: "fake", project: "proj_fixture" },
    async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      assert.equal(request.tools[0].type, "web_search");
      assert.equal(request.tool_choice, "required");
      return Response.json({
        status: "completed",
        model: "fixture",
        usage: { input_tokens: 1, output_tokens: 1 },
        output: executed
          ? [
              {
                type: "web_search_call",
                action: {
                  sources: [
                    { url: "https://example.com/product" },
                    { url: "https://localhost/private" },
                    { url: "http://example.com/insecure" },
                  ],
                },
              },
              {
                type: "message",
                content: [
                  {
                    type: "output_text",
                    annotations: [
                      {
                        type: "url_citation",
                        url: "https://example.com/product",
                      },
                    ],
                  },
                ],
              },
            ]
          : [],
      });
    },
  );
  const result = await search(
    { name: "Public product" },
    new AbortController().signal,
  );
  assert.deepEqual(result.urls, ["https://example.com/product"]);
  assert.equal(result.usage.searchCalls, 1);
  executed = false;
  await assert.rejects(
    search({}, new AbortController().signal),
    /did not execute/,
  );
});

test("offer-first generation needs no ICP, preserves sibling offers and still requires competitive review", async () => {
  const f = await setup(async (input) => ({
    draft: {
      ...draft(generatePlatformId("icp")),
      definition: {
        ...draft(generatePlatformId("icp")).definition,
        targetIcpIds: input.targetIcpIds,
      },
    },
    sources: [],
    usage: { model: "fixture", inputTokens: 10, outputTokens: 20 },
    limitations: [],
  }));
  const input = {
    offeringId: f.p.id,
    targetIcpIds: [],
    instructions: "Enterprise proposition; audience is a hypothesis",
    requestKey: randomUUID(),
  };
  await assert.rejects(f.app.start(identity, f.w, input), /schema v27/);
  f.db.rows("schema_versions")[0]!.version = 27;
  await assert.rejects(
    f.app.start(identity, f.w, input),
    /Confirm the offer brief/,
  );
  const { OFFER_BRIEF_FIELDS } =
    await import("../src/services/offer-architecture/brief-schema");
  for (let n = 0; n < 2; n++) {
    f.db.rows("schema_versions")[0]!.version = n === 0 ? 27 : 28;
    await assert.rejects(
      f.app.start(identity, f.w, { ...input, requestKey: randomUUID() }),
      /Confirm the offer brief/,
    );
    const briefId = generatePlatformId("event");
    f.db.rows("events").push({
      id: briefId,
      workspaceId: f.w,
      eventType: "offer_brief",
      payload: {
        status: "confirmed",
        input: { offeringId: f.p.id },
        productRevision: 1,
        interpretation: {
          explanation: "Confirmed separate offer",
          offers: [
            {
              existingOfferId: null,
              brief: {
                name: "Offer " + n,
                ...Object.fromEntries(OFFER_BRIEF_FIELDS.map((k) => [k, []])),
              },
            },
          ],
        },
      },
    });
    const started = await f.app.start(identity, f.w, {
      ...input,
      briefId,
      briefOfferIndex: 0,
      requestKey: randomUUID(),
    });
    const done = await finished(f.app, f.w, started.id);
    assert.equal(done.status, "complete");
    const saved = await f.app.bundle(identity, f.w, done.offerId);
    assert.deepEqual(saved.offer.definition.targetIcpIds, []);
    assert.equal(saved.offer.offeringId, f.p.id);
    assert.equal(saved.offer.status, "draft");
    await assert.rejects(
      f.app.transition(identity, f.w, {
        id: saved.offer.id,
        expectedUpdatedAt: saved.offer.updatedAt.toISOString(),
        expectedDesignUpdatedAt: (
          saved.design as Document
        ).updatedAt.toISOString(),
        action: "approve",
      }),
    );
  }
  assert.equal(f.db.rows("offers").length, 2);
  assert.equal(f.db.rows("offer_designs").length, 2);
  assert.equal(f.db.rows("ideal_customer_profiles").length, 1);
});

test("Henry stores, restores and confirms an editable brief before generating one independent offer", async () => {
  const { createOfferBriefs } =
    await import("../src/services/offer-architecture/briefs");
  const { OFFER_BRIEF_FIELDS, OfferBriefSchema } =
    await import("../src/services/offer-architecture/brief-schema");
  let interpreted = 0,
    generated = 0;
  const f = await setup(async (input) => {
    generated++;
    assert.ok((input.context as Document).confirmedBrief);
    return {
      draft: {
        ...draft(generatePlatformId("icp")),
        definition: {
          ...draft(generatePlatformId("icp")).definition,
          targetIcpIds: [],
        },
      },
      sources: [],
      usage: { model: "fixture", inputTokens: 1, outputTokens: 1 },
      limitations: [],
    };
  });
  f.db.rows("schema_versions")[0]!.version = 27;
  const briefs = createOfferBriefs(config, f.db.mongo, async () => {
    interpreted++;
    return {
      interpretation: {
        explanation: "Enterprise is a separate commercial proposition",
        offers: [
          {
            existingOfferId: null,
            brief: OfferBriefSchema.parse({
              name: "Enterprise",
              ...Object.fromEntries(OFFER_BRIEF_FIELDS.map((k) => [k, []])),
              marketHypothesis: [
                { text: "Larger organisations", origin: "hypothesis" },
              ],
            }),
          },
        ],
      },
      usage: { model: "fixture", inputTokens: 1, outputTokens: 1 },
    };
  });
  const input = {
    offeringId: f.p.id,
    intent: "Build an enterprise offer",
    requestKey: randomUUID(),
  };
  let j = await briefs.start(identity, f.w, input);
  for (let n = 0; n < 100 && j.status === "interpreting"; n++) {
    await new Promise((r) => setTimeout(r, 5));
    j = await briefs.read(identity, f.w, j.id);
  }
  assert.equal(j.status, "review");
  assert.equal((await briefs.start(identity, f.w, input)).id, j.id);
  assert.equal(interpreted, 1);
  assert.equal(f.db.rows("offers").length, 0);
  await assert.rejects(
    f.app.start(identity, f.w, {
      offeringId: f.p.id,
      instructions: "",
      requestKey: randomUUID(),
      briefId: j.id,
      briefOfferIndex: 0,
    }),
  );
  const confirmed = await briefs.confirm(identity, f.w, {
    id: j.id,
    expectedUpdatedAt: j.updatedAt,
    interpretation: j.interpretation,
  });
  assert.equal(confirmed.status, "confirmed");
  await briefs.methodology(identity, f.w, {
    id: confirmed.id,
    index: 0,
    expectedUpdatedAt: confirmed.updatedAt,
    selection: { id: listOfferMethodologies()[0]!.id, version: 1 },
  });
  assert.equal((await briefs.latest(identity, f.w, f.p.id))?.id, j.id);
  const gen = {
    offeringId: f.p.id,
    instructions: "",
    requestKey: randomUUID(),
    briefId: j.id,
    briefOfferIndex: 0,
  };
  const started = await f.app.start(identity, f.w, gen);
  assert.equal((await finished(f.app, f.w, started.id)).status, "complete");
  assert.equal(
    (await f.app.start(identity, f.w, { ...gen, requestKey: randomUUID() })).id,
    started.id,
  );
  assert.equal(generated, 1);
  assert.equal(f.db.rows("offers").length, 1);
  const oldOffer = f.db.rows("offers")[0]!;
  oldOffer.archived = true;
  oldOffer.status = "retired";
  await assert.rejects(
    f.app.start(identity, f.w, gen),
    /previous result was archived or retired/,
  );
  const retry = { ...gen, requestKey: randomUUID() };
  const replacement = await f.app.start(identity, f.w, retry);
  assert.notEqual(replacement.id, started.id);
  assert.equal((await f.app.start(identity, f.w, retry)).id, replacement.id);
  const regenerated = await finished(f.app, f.w, replacement.id);
  assert.equal(regenerated.status, "complete");
  assert.notEqual(regenerated.offerId, oldOffer.id);
  assert.equal(generated, 2);
  assert.equal(oldOffer.archived, true);
  assert.equal(f.db.rows("offers").length, 2);
  assert.equal(
    (await f.app.start(identity, f.w, { ...gen, requestKey: randomUUID() })).id,
    replacement.id,
  );
  assert.equal(generated, 2);
  assert.equal((await briefs.latest(identity, f.w, f.p.id))?.id, j.id);

  await assert.rejects(
    briefs.read(identity, generatePlatformId("workspace"), j.id),
  );
  await assert.rejects(
    briefs.confirm(identity, f.w, {
      id: j.id,
      expectedUpdatedAt: j.updatedAt,
      interpretation: j.interpretation,
    }),
  );
});

test("Henry refines the same offer without changing commercial terms by default", async () => {
  const f = await setup(async (input) => ({
    draft: {
      ...draft(input.targetIcpIds[0]!),
      definition: {
        ...draft(input.targetIcpIds[0]!).definition,
        headlineProposition: "Improved positioning",
        commercialTerms: {
          options: [
            { name: "Unapproved replacement", pricingModel: "custom_quote" },
          ],
        },
      },
    },
    sources: [],
    usage: { model: "fixture", inputTokens: 1, outputTokens: 1 },
    limitations: [],
  }));
  const initial = await f.app.start(identity, f.w, {
    offeringId: f.p.id,
    targetIcpIds: [f.i.id],
    instructions: "",
    requestKey: randomUUID(),
  });
  const completed = await finished(f.app, f.w, initial.id);
  let original = await f.app.bundle(identity, f.w, completed.offerId);
  original = await f.app.save(identity, f.w, {
    id: original.offer.id,
    expectedUpdatedAt: original.offer.updatedAt.toISOString(),
    designId: (original.design as Document).id,
    expectedDesignUpdatedAt: (
      original.design as Document
    ).updatedAt.toISOString(),
    work: (original.design as Document).work,
    definition: {
      ...original.offer.definition,
      commercialTerms: {
        options: [
          {
            name: "Starter",
            pricingModel: "recurring",
            billingFrequency: "monthly",
            price: { currency: "GBP", amountMinor: 9900 },
          },
        ],
      },
    },
  });
  const { createOfferBriefs } =
    await import("../src/services/offer-architecture/briefs");
  const { OfferBriefSchema, OFFER_BRIEF_FIELDS } =
    await import("../src/services/offer-architecture/brief-schema");
  const briefs = createOfferBriefs(config, f.db.mongo, async () => ({
    interpretation: {
      explanation: "Refine messaging, retain commercial commitments",
      offers: [
        {
          existingOfferId: original.offer.id,
          brief: OfferBriefSchema.parse({
            name: "Refine existing offer",
            ...Object.fromEntries(OFFER_BRIEF_FIELDS.map((k) => [k, []])),
            existingCommitments: [
              { text: "Keep pricing", origin: "queen_supplied" },
            ],
          }),
        },
      ],
    },
    usage: { model: "fixture", inputTokens: 1, outputTokens: 1 },
  }));
  let brief = await briefs.start(identity, f.w, {
    offeringId: f.p.id,
    intent: "Keep pricing; refine positioning",
    requestKey: randomUUID(),
  });
  for (let n = 0; n < 100 && brief.status === "interpreting"; n++) {
    await new Promise((r) => setTimeout(r, 5));
    brief = await briefs.read(identity, f.w, brief.id);
  }
  brief = await briefs.confirm(identity, f.w, {
    id: brief.id,
    expectedUpdatedAt: brief.updatedAt,
    interpretation: brief.interpretation,
  });
  await briefs.methodology(identity, f.w, {
    id: brief.id,
    index: 0,
    expectedUpdatedAt: brief.updatedAt,
    selection: { id: listOfferMethodologies()[0]!.id, version: 1 },
  });
  const job = await f.app.start(identity, f.w, {
    offeringId: f.p.id,
    targetIcpIds: [f.i.id],
    instructions: "",
    requestKey: randomUUID(),
    briefId: brief.id,
    briefOfferIndex: 0,
  });
  const result = await finished(f.app, f.w, job.id);
  assert.equal(result.status, "complete");
  assert.equal(result.offerId, original.offer.id);
  const refined = await f.app.bundle(identity, f.w, result.offerId);
  assert.deepEqual(
    refined.offer.definition.commercialTerms,
    original.offer.definition.commercialTerms,
  );
  assert.equal(f.db.rows("offers").length, 1);
  assert.equal(refined.refinement?.generationId, result.id);
  assert.deepEqual(
    refined.refinement?.previousDefinition,
    original.offer.definition,
  );
  assert.ok(refined.refinement?.proposedWork.stages.length);
  assert.equal(refined.refinement?.commercialChangesAuthorised, false);
  assert.deepEqual((refined.design as Document).work.completedStageKeys, []);
});

test("consumer identification is tenant-scoped, paginated, revision-fenced and respects explicit person precedence", async () => {
  const f = await setup();
  const { createEligibility } = await import("../src/services/icp/eligibility");
  const app = createEligibility(config, f.db.mongo);
  const offerIds = [generatePlatformId("offer"), generatePlatformId("offer")];
  const segments = offerIds.map((offerId, index) => {
    const id = generatePlatformId("icp");
    f.db.rows("offers").push({
      id: offerId,
      workspaceId: f.w,
      offeringId: f.p.id,
      archived: false,
      approvedRevision: 1,
    });
    f.db.rows("ideal_customer_profiles").push({
      id,
      workspaceId: f.w,
      offeringId: f.p.id,
      archived: false,
      approvedRevision: 1,
    });
    f.db.rows("hive_definition_revisions").push({
      workspaceId: f.w,
      entityType: "ideal_customer_profiles",
      entityId: id,
      revision: 1,
      snapshot: {
        offer: { id: offerId, revision: 1 },
        definition: {
          name: "Consumer segment",
          profileType: index ? "d2c" : "b2c",
        },
      },
    });
    return {
      icpId: id,
      revision: 1,
      rules: [
        { field: "preferredLanguage", effect: "include", values: ["en-GB"] },
      ],
    };
  });
  for (let i = 0; i < 52; i++)
    f.db.rows("people").push({
      id: generatePlatformId("person"),
      workspaceId: f.w,
      firstName: `Person ${i}`,
      preferredLanguage: i === 0 ? undefined : i === 1 ? "fr" : "en-GB",
      lifecycleStatus: "active",
    });
  for (const status of ["inactive", "archived"])
    f.db.rows("people").push({
      id: generatePlatformId("person"),
      workspaceId: f.w,
      firstName: "Hidden",
      lifecycleStatus: status,
    });
  f.db.rows("people").push({
    id: generatePlatformId("person"),
    workspaceId: generatePlatformId("workspace"),
    firstName: "Other tenant",
    preferredLanguage: "en-GB",
  });
  let policy = await app.save(identity, f.w, {
    requestKey: randomUUID(),
    definition: {
      name: "Consumer fit",
      exclusivity: "one_offer_per_customer",
      segments,
      offerPriority: offerIds,
    },
  });
  await app.approve(identity, f.w, {
    id: policy.id,
    expectedUpdatedAt: policy.updatedAt,
  });
  const first = await app.identify(identity, f.w, {
    policyId: policy.id,
    recordType: "people",
  });
  assert.equal(first.recordType, "people");
  assert.equal(first.items.length, 50);
  assert.equal(first.hasMore, true);
  const next = await app.identify(identity, f.w, {
    policyId: policy.id,
    recordType: "people",
    offset: 50,
  });
  assert.equal(next.items.length, 2);
  assert.equal(next.hasMore, false);
  const all = [...first.items, ...next.items];
  assert.equal(new Set(all.map((p) => p.id)).size, 52);
  assert.equal(
    all.some((p) => p.name === "Hidden" || p.name === "Other tenant"),
    false,
  );
  assert.deepEqual(all.find((p) => p.name === "Person 2")?.permittedOfferIds, [
    offerIds[0],
  ]);
  assert.equal(
    all.find((p) => p.name === "Person 0")?.fits[0]?.fit,
    "needs_review",
  );
  assert.equal(all.find((p) => p.name === "Person 1")?.fits[0]?.fit, "not_fit");
  assert.equal(first.campaignSelection, null);
  await assert.rejects(
    app.identify({ ...identity, subject: "other-user" }, f.w, {
      policyId: policy.id,
      recordType: "people",
    }),
  );
  policy = await app.save(identity, f.w, {
    requestKey: randomUUID(),
    definition: {
      ...policy.definition,
      exclusivity: "one_offer_per_organisation",
    },
  });
  await app.approve(identity, f.w, {
    id: policy.id,
    expectedUpdatedAt: policy.updatedAt,
  });
  const legacy = await app.identify(identity, f.w, {
    policyId: policy.id,
    recordType: "people",
  });
  assert.equal(
    legacy.items.every((p) => p.permittedOfferIds.length === 0),
    true,
  );
  assert.match(legacy.notice, /only defines organisation exclusivity/);
  f.db.rows("offers").find((p) => p.id === offerIds[0])!.approvedRevision = 2;
  await assert.rejects(
    app.identify(identity, f.w, { policyId: policy.id, recordType: "people" }),
    /offer changed/,
  );
});

test("public discovery requires a current approved policy, deduplicates execution and restores results", async () => {
  const f = await setup();
  const { createEligibility } = await import("../src/services/icp/eligibility");
  let calls = 0;
  const app = createEligibility(config, f.db.mongo, async (query) => {
    calls++;
    assert.equal(query, "Find public manufacturing investment announcements");
    return {
      candidates: [],
      omitted: 0,
      usage: {
        model: "fixture",
        inputTokens: 1,
        outputTokens: 2,
        searchCalls: 1,
      },
    };
  });
  const offerId = generatePlatformId("offer"),
    profileId = generatePlatformId("icp");
  f.db.rows("offers").push({
    id: offerId,
    workspaceId: f.w,
    offeringId: f.p.id,
    archived: false,
    approvedRevision: 1,
  });
  f.db.rows("ideal_customer_profiles").push({
    id: profileId,
    workspaceId: f.w,
    offeringId: f.p.id,
    archived: false,
    approvedRevision: 1,
  });
  f.db.rows("hive_definition_revisions").push({
    workspaceId: f.w,
    entityType: "ideal_customer_profiles",
    entityId: profileId,
    revision: 1,
    snapshot: {
      offer: { id: offerId, revision: 1 },
      definition: { name: "Manufacturers", profileType: "b2b" },
    },
  });
  const policy = await app.save(identity, f.w, {
    requestKey: randomUUID(),
    definition: {
      name: "Market",
      exclusivity: "multiple_offers",
      offerPriority: [offerId],
      segments: [
        {
          icpId: profileId,
          revision: 1,
          rules: [
            { field: "industry", effect: "include", values: ["Manufacturing"] },
          ],
        },
      ],
    },
  });
  const input = {
    policyId: policy.id,
    requestKey: randomUUID(),
    query: "Find public manufacturing investment announcements",
    publicQueryConfirmed: true,
  };
  await assert.rejects(app.discoveryStart(identity, f.w, input));
  assert.equal(calls, 0);
  await app.approve(identity, f.w, {
    id: policy.id,
    expectedUpdatedAt: policy.updatedAt,
  });
  const first = await app.discoveryStart(identity, f.w, input);
  assert.equal((await app.discoveryStart(identity, f.w, input)).id, first.id);
  for (let i = 0; i < 20; i++) {
    if (
      (await app.discoveryRead(identity, f.w, first.id)).status !== "searching"
    )
      break;
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.equal(calls, 1);
  assert.equal(
    (await app.discoveryLatest(identity, f.w, policy.id))?.status,
    "review",
  );
  await assert.rejects(
    app.discoveryRead({ ...identity, subject: "other" }, f.w, first.id),
  );
  f.db.rows("offers").find((r) => r.id === offerId)!.approvedRevision = 2;
  assert.equal((await app.discoveryRead(identity, f.w, first.id)).stale, true);
  await assert.rejects(
    app.discoveryStart(identity, f.w, { ...input, requestKey: randomUUID() }),
  );
  assert.equal(calls, 1);
});

test("failed offer attempt persists redacted stage diagnostics without discarding inputs", async () => {
  const f = await setup(async (_input, _signal, observe) => {
    await observe?.({
      stage: "research",
      outcome: "complete",
      elapsedMs: 10,
      count: 3,
    });
    await observe?.({ stage: "validation", outcome: "started", elapsedMs: 20 });
    throw Error(
      "private generated content and credentials must never be stored",
    );
  });
  const j = await f.app.start(identity, f.w, {
    offeringId: f.p.id,
    targetIcpIds: [f.i.id],
    instructions: "Keep this discovery context",
    requestKey: randomUUID(),
  });
  const saved = await finished(f.app, f.w, j.id);
  assert.equal(saved.status, "failed");
  assert.equal(saved.input.instructions, "Keep this discovery context");
  assert.equal(saved.diagnostics.at(-1).stage, "validation");
  assert.equal(saved.diagnostics.at(-1).code, "unexpected_error");
  assert.equal(saved.diagnostics[1].count, 3);
  assert.doesNotMatch(
    JSON.stringify(saved.diagnostics),
    /private generated|credentials/,
  );
  assert.equal(f.db.rows("offers").length, 0);
});

test("published Value Proposition Development executes eight stages and persists its own version", async () => {
  const method = listOfferMethodologies()[1]!;
  const f = await setup(async (input) => {
    assert.deepEqual(input.methodology, { id: method.id, version: 1 });
    const value = draft(input.targetIcpIds[0]!);
    value.stages = method.stages.map((s) => ({
      stageKey: s.key,
      summary: "A proposed value decision",
      questions: ["What needs your review?"],
      proposals: [],
    }));
    return {
      draft: value,
      sources: [],
      usage: { model: "fixture", inputTokens: 10, outputTokens: 20 },
      limitations: [],
    };
  });
  const input = {
    offeringId: f.p.id,
    targetIcpIds: [f.i.id],
    instructions: "",
    requestKey: randomUUID(),
    methodology: { id: method.id, version: 1 },
  };
  await assert.rejects(f.app.start(identity, f.w, input), /not published/);
  f.db.rows("methodology_availability").push({
    id: generatePlatformId("methodologyavailability"),
    status: "active",
    archived: false,
    availability: "queens",
    data: { methodology: input.methodology },
  });
  const job = await f.app.start(identity, f.w, input);
  const complete = await finished(f.app, f.w, job.id);
  assert.equal(complete.status, "complete");
  const saved = f.db.rows("offer_designs")[0]!;
  assert.equal(saved.methodologyId, method.id);
  assert.equal(saved.methodologyVersion, 1);
  assert.equal(saved.work.currentStageKey, "customer_context");
  assert.deepEqual(
    saved.work.stages.map((s: { stageKey: string }) => s.stageKey),
    method.stages.map((s) => s.key),
  );
  assert.equal(saved.work.completedStageKeys.length, 0);
});

test("two offers for one product retain independent approved methodologies, designs and decisions", async () => {
  const { createOfferBriefs } =
    await import("../src/services/offer-architecture/briefs");
  const { OfferBriefSchema, OFFER_BRIEF_FIELDS } =
    await import("../src/services/offer-architecture/brief-schema");
  const methods = listOfferMethodologies();
  const f = await setup(async (input) => {
    const method = methods.find((m) => m.id === input.methodology?.id)!;
    const base = draft(generatePlatformId("icp"));
    return {
      draft: {
        ...base,
        definition: { ...base.definition, name: method.key, targetIcpIds: [] },
        stages: method.stages.map((s) => ({
          stageKey: s.key,
          summary: s.purpose,
          questions: [],
        })),
      },
      sources: [],
      usage: { model: "fixture", inputTokens: 1, outputTokens: 1 },
      limitations: [],
    };
  });
  f.db.rows("schema_versions")[0]!.version = 27;
  f.db.rows("methodology_availability").push({
    status: "active",
    archived: false,
    availability: "queens",
    data: { methodology: { id: methods[1]!.id, version: 1 } },
  });
  let calls = 0;
  const briefs = createOfferBriefs(config, f.db.mongo, async (input) => {
    calls++;
    assert.equal(input.methodologies?.length, 2);
    return {
      interpretation: {
        explanation: "Two independent commercial models",
        offers: methods.map((m, i) => ({
          existingOfferId: null,
          brief: OfferBriefSchema.parse({
            name: i ? "Enterprise" : "Self-Service",
            ...Object.fromEntries(OFFER_BRIEF_FIELDS.map((k) => [k, []])),
          }),
          methodologyRecommendation: {
            id: m.id,
            version: 1,
            rationale: i
              ? "Consultative buying, multiple stakeholders and evidence-led outcomes"
              : "Self-service buying with clear value and low friction",
          },
        })),
      },
      usage: { model: "fixture", inputTokens: 1, outputTokens: 1 },
    };
  });
  let brief = await briefs.start(identity, f.w, {
    offeringId: f.p.id,
    intent: "Develop Self-Service and Enterprise independently",
    requestKey: randomUUID(),
  });
  for (let n = 0; n < 100 && brief.status === "interpreting"; n++) {
    await new Promise((r) => setTimeout(r, 5));
    brief = await briefs.read(identity, f.w, brief.id);
  }
  brief = await briefs.confirm(identity, f.w, {
    id: brief.id,
    expectedUpdatedAt: brief.updatedAt,
    interpretation: brief.interpretation,
  });
  const generate = (index: number) => ({
    offeringId: f.p.id,
    instructions: "",
    requestKey: randomUUID(),
    briefId: brief.id,
    briefOfferIndex: index,
  });
  await assert.rejects(
    f.app.start(identity, f.w, generate(0)),
    /Approve a methodology/,
  );
  brief = await briefs.methodology(identity, f.w, {
    id: brief.id,
    index: 0,
    expectedUpdatedAt: brief.updatedAt,
    selection: { id: methods[0]!.id, version: 1 },
  });
  await assert.rejects(
    f.app.start(identity, f.w, generate(1)),
    /Approve a methodology/,
  );
  await assert.rejects(
    briefs.methodology(identity, f.w, {
      id: brief.id,
      index: 1,
      expectedUpdatedAt: brief.updatedAt,
      selection: { id: methods[1]!.id, version: 999 },
    }),
    /available/,
  );
  const self = await finished(
    f.app,
    f.w,
    (await f.app.start(identity, f.w, generate(0))).id,
  );
  assert.equal(self.status, "complete");
  const priorDesign = structuredClone(f.db.rows("offer_designs")[0]);
  brief = await briefs.methodology(identity, f.w, {
    id: brief.id,
    index: 1,
    expectedUpdatedAt: brief.updatedAt,
    selection: { id: methods[1]!.id, version: 1 },
  });
  await assert.rejects(
    f.app.start(identity, f.w, {
      ...generate(1),
      methodology: { id: methods[0]!.id, version: 1 },
    }),
    /differs/,
  );
  const enterprise = await finished(
    f.app,
    f.w,
    (await f.app.start(identity, f.w, generate(1))).id,
  );
  assert.equal(enterprise.status, "complete");
  const one = await f.app.bundle(identity, f.w, self.offerId),
    two = await f.app.bundle(identity, f.w, enterprise.offerId);
  assert.equal(one.offer.offeringId, two.offer.offeringId);
  assert.notEqual(one.design.id, two.design.id);
  assert.equal(one.design.methodologyId, methods[0]!.id);
  assert.equal(two.design.methodologyId, methods[1]!.id);
  assert.equal(one.design.work.stages.length, 14);
  assert.equal(two.design.work.stages.length, 8);
  assert.deepEqual(
    f.db.rows("offer_designs").find((d) => d.id === priorDesign!.id),
    priorDesign,
  );
  assert.equal(one.offer.status, "draft");
  assert.equal(two.offer.status, "draft");
  assert.equal(calls, 1);
  const oldEnterprise = structuredClone(two.design);
  brief = await briefs.methodology(identity, f.w, {
    id: brief.id,
    index: 1,
    expectedUpdatedAt: brief.updatedAt,
    selection: { id: methods[0]!.id, version: 1 },
  });
  assert.equal(brief.interpretation.offers[0].existingOfferId, self.offerId);
  assert.equal(
    brief.interpretation.offers[1].existingOfferId,
    enterprise.offerId,
  );
  const switched = await finished(
    f.app,
    f.w,
    (await f.app.start(identity, f.w, generate(1))).id,
  );
  assert.equal(switched.status, "complete");
  assert.equal(switched.offerId, enterprise.offerId);
  const newEnterprise = await f.app.bundle(identity, f.w, enterprise.offerId);
  assert.notEqual(newEnterprise.design.id, oldEnterprise.id);
  assert.equal(newEnterprise.design.methodologyId, methods[0]!.id);
  assert.deepEqual(
    f.db.rows("offer_designs").find((d) => d.id === oldEnterprise.id),
    oldEnterprise,
  );
  assert.equal(f.db.rows("offers").length, 2);
  assert.equal(f.db.rows("offer_designs").length, 3);

  assert.equal(
    f.db
      .rows("events")
      .filter((e) => e.eventType === "offer_methodology_approved").length,
    3,
  );
  await assert.rejects(
    briefs.methodology(identity, generatePlatformId("workspace"), {
      id: brief.id,
      index: 1,
      expectedUpdatedAt: brief.updatedAt,
      selection: { id: methods[1]!.id, version: 1 },
    }),
  );
  // A confirmed refinement brief must remain usable after the old test offer is archived.
  brief = await briefs.methodology(identity, f.w, {
    id: brief.id,
    index: 1,
    expectedUpdatedAt: brief.updatedAt,
    selection: { id: methods[1]!.id, version: 1 },
  });
  const original = f.db
    .rows("offers")
    .find((row) => row.id === enterprise.offerId)!;
  original.archived = true;
  original.status = "retired";
  original.updatedAt = new Date(original.updatedAt.getTime() + 1000);
  original.archivedAt = original.updatedAt;
  const archivedSnapshot = structuredClone(original);
  const selfSnapshot = structuredClone(
    f.db.rows("offers").find((row) => row.id === self.offerId),
  );
  const recovered = await finished(
    f.app,
    f.w,
    (await f.app.start(identity, f.w, generate(1))).id,
  );
  assert.equal(recovered.status, "complete");
  assert.notEqual(recovered.offerId, enterprise.offerId);
  const recoveredBundle = await f.app.bundle(identity, f.w, recovered.offerId);
  assert.equal(recoveredBundle.design.methodologyId, methods[1]!.id);
  assert.equal(recoveredBundle.design.work.stages.length, 8);
  assert.deepEqual(original, archivedSnapshot);
  assert.deepEqual(
    f.db.rows("offers").find((row) => row.id === self.offerId),
    selfSnapshot,
  );
  assert.equal(
    (await f.app.start(identity, f.w, generate(1))).offerId,
    recovered.offerId,
  );
});

test("legacy brief recommendations preserve discovery and prevent duplicate provider work", async () => {
  const { createOfferBriefs } =
    await import("../src/services/offer-architecture/briefs");
  const { OfferBriefSchema, OFFER_BRIEF_FIELDS } =
    await import("../src/services/offer-architecture/brief-schema");
  const f = await setup();
  const now = new Date();
  const id = generatePlatformId("event");
  const method = listOfferMethodologies()[0]!;
  const selected = {
    existingOfferId: null,
    brief: OfferBriefSchema.parse({
      name: "Self-Service",
      ...Object.fromEntries(OFFER_BRIEF_FIELDS.map((k) => [k, []])),
    }),
  };
  f.db.rows("events").push({
    id,
    workspaceId: f.w,
    eventType: "offer_brief",
    createdAt: now,
    updatedAt: now,
    payload: {
      status: "confirmed",
      input: { offeringId: f.p.id, intent: "Original discovery" },
      existingOffers: [],
      interpretation: {
        explanation: "Retain this discovery",
        offers: [selected],
      },
    },
  });
  let calls = 0,
    release!: () => void;
  const wait = new Promise<void>((r) => (release = r));
  const briefs = createOfferBriefs(config, f.db.mongo, async (input) => {
    assert.deepEqual(input.recommendationOnly, selected);
    calls++;
    await wait;
    return {
      interpretation: {
        explanation: "Not copied",
        offers: [
          {
            ...selected,
            methodologyRecommendation: {
              id: method.id,
              version: 1,
              rationale: "Immediate subscription purchase",
            },
          },
        ],
      },
      usage: { model: "fixture", inputTokens: 4, outputTokens: 5 },
    };
  });
  const request = { id, index: 0, expectedUpdatedAt: now.toISOString() };
  const first = briefs.methodology(identity, f.w, request);
  for (let i = 0; i < 50 && !calls; i++)
    await new Promise((r) => setTimeout(r, 1));
  await assert.rejects(
    briefs.methodology(identity, f.w, request),
    /already being prepared/,
  );
  release();
  const result = await first;
  assert.equal(calls, 1);
  assert.equal(result.interpretation.explanation, "Retain this discovery");
  assert.deepEqual(result.interpretation.offers[0].brief, selected.brief);
  assert.equal(
    result.interpretation.offers[0].methodologyRecommendation.id,
    method.id,
  );
  assert.equal(result.methodologyApprovals?.["0"], undefined);
  assert.equal(result.methodologyPendingAt, undefined);
  assert.equal(
    f.db
      .rows("events")
      .find((e) => e.eventType === "offer_methodology_recommended")!.payload
      .usage.inputTokens,
    4,
  );
});

test("brief overview links only active same-workspace, same-product generated offers", async () => {
  const { createOfferBriefs } =
    await import("../src/services/offer-architecture/briefs");
  const f = await setup();
  const id = generatePlatformId("event");
  const active = generatePlatformId("offer");
  const retired = generatePlatformId("offer");
  const foreign = generatePlatformId("offer");
  const otherProduct = generatePlatformId("offer");
  f.db.rows("offers").push(
    {
      id: active,
      workspaceId: f.w,
      offeringId: f.p.id,
      archived: false,
      status: "draft",
    },
    {
      id: retired,
      workspaceId: f.w,
      offeringId: f.p.id,
      archived: true,
      status: "retired",
    },
    {
      id: foreign,
      workspaceId: generatePlatformId("workspace"),
      offeringId: f.p.id,
      archived: false,
      status: "draft",
    },
    {
      id: otherProduct,
      workspaceId: f.w,
      offeringId: generatePlatformId("offering"),
      archived: false,
      status: "draft",
    },
  );
  f.db.rows("events").push({
    id,
    workspaceId: f.w,
    eventType: "offer_brief",
    createdAt: new Date(),
    updatedAt: new Date(),
    payload: {
      status: "confirmed",
      input: { offeringId: f.p.id, intent: "Two offers" },
    },
  });
  [active, retired, foreign, otherProduct].forEach((offerId, index) =>
    f.db.rows("events").push({
      id: generatePlatformId("event"),
      workspaceId: f.w,
      eventType: "offer_generation",
      createdAt: new Date(Date.now() + index),
      payload: {
        status: "complete",
        offerId,
        input: { briefId: id, briefOfferIndex: index < 2 ? 0 : index },
      },
    }),
  );
  const briefs = createOfferBriefs(config, f.db.mongo);
  assert.deepEqual((await briefs.read(identity, f.w, id)).linkedOffers, {
    "0": active,
  });
  assert.deepEqual((await briefs.latest(identity, f.w, f.p.id))?.linkedOffers, {
    "0": active,
  });
  await assert.rejects(() =>
    briefs.read({ ...identity, subject: "unrelated-user" }, f.w, id),
  );
});

test("offer output is idempotent, versioned, scoped and not distribution-approved", async()=>{
 const f=await setup(async()=>({draft:draft(f.i.id),sources:[],usage:{model:"fixture",inputTokens:1,outputTokens:1},limitations:[]}));
 const job=await f.app.start(identity,f.w,{offeringId:f.p.id,targetIcpIds:[f.i.id],instructions:"",requestKey:randomUUID()});
 const j=await finished(f.app,f.w,job.id);f.db.rows("schema_versions")[0]!.version=28;let b=await f.app.bundle(identity,f.w,j.offerId);
 const register=()=>f.app.registerOutput(identity,f.w,{id:b.offer.id,expectedUpdatedAt:b.offer.updatedAt.toISOString(),expectedDesignUpdatedAt:(b.design as Document).updatedAt.toISOString()});
 b=await register();const id=b.output.assetId;assert.ok(id);assert.match(b.output.text,/Understand the options/);
 await register();assert.equal(f.db.rows("events").filter(e=>e.payload?.record?.id===id).length,1);
 const d=b.design as Document;
 b=await f.app.save(identity,f.w,{id:b.offer.id,expectedUpdatedAt:b.offer.updatedAt.toISOString(),designId:d.id,expectedDesignUpdatedAt:d.updatedAt.toISOString(),definition:{...b.offer.definition,valueProposition:"Revised value"},work:d.work});
 const versions=f.db.rows("events").filter(e=>e.payload?.record?.id===id).map(e=>e.payload.record);
 assert.equal(versions.length,2);assert.equal(versions[0].data.offerOutput.offerStatus,"draft");assert.equal(versions[1].status,"draft");assert.equal(versions[1].data.usageRights,"restricted");assert.equal(versions[1].data.visibility,"private");
 const latest=f.db.rows("events").filter(e=>e.payload?.record?.id===id).at(-1)!;
 latest.payload.record.status="removed";
 const nextDesign=b.design as Document;
 b=await f.app.save(identity,f.w,{id:b.offer.id,expectedUpdatedAt:b.offer.updatedAt.toISOString(),designId:nextDesign.id,expectedDesignUpdatedAt:nextDesign.updatedAt.toISOString(),definition:{...b.offer.definition,valueProposition:"Another revision"},work:nextDesign.work});
 assert.equal(b.output.assetId,null);
 assert.equal(f.db.rows("events").filter(e=>e.payload?.record?.id===id).length,2);
 await assert.rejects(f.app.registerOutput(identity,generatePlatformId("workspace"),{id:b.offer.id,expectedUpdatedAt:b.offer.updatedAt.toISOString(),expectedDesignUpdatedAt:(b.design as Document).updatedAt.toISOString()}));
});


test("public discovery preserves incomplete reason and provider usage", async () => {
  const { createOfferResearch } = await import("../src/services/offer-architecture/research");
  const { OfferIncompleteError, safeOfferFailure } = await import("../src/services/offer-architecture/diagnostics");
  for (const [reason, expected] of [["max_output_tokens", "output_limit"], ["content_filter", "content_filter"], ["other", "incomplete"]]) {
    const search = createOfferResearch({ apiKey: "fake", project: "proj_fixture" }, async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      assert.match(request.input[0].content, /at most six links/);
      return Response.json({ status: "incomplete", incomplete_details: { reason }, model: "fixture",
        usage: { input_tokens: 50, output_tokens: 1200 }, output: [{ type: "web_search_call" }] });
    });
    await assert.rejects(search({}, new AbortController().signal), (error: unknown) => {
      assert.ok(error instanceof OfferIncompleteError);
      assert.equal(error.reason, expected);
      assert.deepEqual(error.usage, { model: "fixture", inputTokens: 50, outputTokens: 1200, searchCalls: 1 });
      assert.equal(safeOfferFailure(error).code, `provider_${expected}`);
      return true;
    });
  }
});
