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
import { validateWebsiteDraft } from "../src/services/psu/website-draft";
import type { PsuGenerator } from "../src/services/psu/generate";
import { digest } from "@workspace/agent-runtime-protocol";
const definition = {
  name: "Energy optimisation",
  description: "Supplier-delivered optimisation",
  primaryOfferingType: "professional_service",
  implementationModel: "supplier_mobilisation",
  deliveryModes: ["on_site_service"],
  unknowns: ["Measured savings"],
};
async function fixture(t: TestContext, psuGenerator?: PsuGenerator) {
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
      psuGenerator,
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

function draft() {
  const page = {
    url: "https://example.com/service",
    title: "Service",
    text: "Energy optimisation. Supplier-delivered optimisation.",
    retrievedAt: new Date().toISOString(),
    digest: digest("Energy optimisation. Supplier-delivered optimisation."),
  };
  return validateWebsiteDraft(
    {
      version: 1,
      fields: [
        {
          binding: { field: "name", value: "Energy optimisation" },
          basis: "source_claim",
          support: [{ pageDigest: page.digest, quote: "Energy optimisation" }],
        },
        {
          binding: {
            field: "description",
            value: "Supplier-delivered optimisation",
          },
          basis: "source_claim",
          support: [
            {
              pageDigest: page.digest,
              quote: "Supplier-delivered optimisation",
            },
          ],
        },
      ],
      unknowns: ["Pricing"],
      questions: [],
    },
    [page],
  );
}
const generator: PsuGenerator = async () => ({
  draft: draft(),
  unavailable: [],
  usage: {
    model: "test-model",
    inputTokens: 100,
    outputTokens: 50,
    status: "recorded",
  },
});
async function ready(f: Awaited<ReturnType<typeof fixture>>) {
  for (let i = 0; i < 50; i++) {
    const r = await f.request(f.root + "/psu");
    if (r.body.items[0]?.status !== "generating") return r.body.items[0];
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("Generation did not settle");
}
const input = (brandId: string) => ({
  brandId,
  requestKey: crypto.randomUUID(),
  workingLabel: "Energy",
  orientation: "",
  websiteUrls: ["https://example.com/service"],
});
test("PSU works with no registered Agent: generate, review, save, approve, revise and reload with evidence", async (t) => {
  let calls = 0;
  const f = await fixture(t, async (...args) => {
    calls++;
    return generator(...args);
  });
  const body = input(f.input.brandId);
  assert.equal(
    (await f.request(f.root + "/psu")).body.generationAvailable,
    true,
  );
  const started = await f.request(f.root + "/psu", body);
  assert.equal(started.status, 202, JSON.stringify(started));
  assert.equal(
    (await f.request(f.root + "/psu", body)).body.id,
    started.body.id,
  );
  const job = await ready(f);
  assert.equal(job.status, "review");
  assert.equal(calls, 1);
  assert.equal(f.db.rows("agent_runs").length, 0);
  assert.equal(f.db.rows("agent_definitions").length, 0);
  const review = {
    draftDigest: job.draft.digest,
    fields: [
      { field: "name", value: "My energy service" },
      { field: "description", value: "Reviewed service description" },
    ],
  };
  const saved = await f.request(f.root + "/psu/" + job.id + "/save", review);
  assert.equal(saved.status, 200, JSON.stringify(saved));
  assert.equal(
    (await f.request(f.root + "/psu/" + job.id + "/save", review)).body
      .offeringId,
    saved.body.offeringId,
  );
  let row = (await f.request(f.root + "/offerings/" + saved.body.offeringId))
    .body;
  assert.equal(row.status, "draft");
  assert.equal(row.evidence.length, 2);
  assert.equal(row.evidence[0].sourceReference, "psu_review:" + job.id);
  assert.equal(f.db.rows("offerings").length, 1);
  const approval = await f.request(f.root + "/offerings/approve", {
    id: row.id,
    expectedUpdatedAt: row.updatedAt,
  });
  assert.equal(approval.status, 200, JSON.stringify(approval));
  row = approval.body;
  const history = await f.request(f.root + `/offerings/${row.id}/revisions/1`);
  assert.equal(history.body.snapshot.definition.name, "My energy service");
  const revised = await f.request(f.root + "/offerings/revise", {
    id: row.id,
    expectedUpdatedAt: row.updatedAt,
  });
  assert.equal(revised.status, 200);
  assert.equal(revised.body.approvedRevision, 1);
  assert.equal(
    (await f.request(f.root + `/offerings/${row.id}/revisions/1`)).body.snapshot
      .status,
    "approved",
  );
  assert.equal(
    (await f.request(f.root + "/psu")).body.items[0].status,
    "saved",
  );
  assert.ok(
    f.db
      .rows("events")
      .some(
        (e) =>
          e.eventType === "psu_content_chunk" &&
          e.payload.text.includes("Supplier-delivered"),
      ),
  );
});
test("tenant isolation, changed scope, invalid input and duplicate key cannot trigger or corrupt generation", async (t) => {
  let calls = 0;
  const f = await fixture(t, async (...args) => {
    calls++;
    return generator(...args);
  });
  const other = f.root.replace(
    f.input.workspaceId,
    generatePlatformId("workspace"),
  );
  assert.equal((await f.request(other + "/psu")).status, 404);
  assert.equal(
    (await f.request(other + "/psu", input(f.input.brandId))).status,
    404,
  );
  assert.equal(
    (await f.request(f.root + "/psu", input(generatePlatformId("brand"))))
      .status,
    404,
  );
  assert.equal(
    (
      await f.request(f.root + "/psu", {
        ...input(f.input.brandId),
        websiteUrls: ["http://127.0.0.1/"],
      })
    ).status,
    400,
  );
  assert.equal(calls, 0);
  const body = input(f.input.brandId);
  await f.request(f.root + "/psu", body);
  const job = await ready(f);
  assert.equal(
    (await f.request(f.root + "/psu", { ...body, orientation: "changed" }))
      .status,
    409,
  );
  const review = {
    draftDigest: job.draft.digest,
    fields: [
      { field: "name", value: "Name" },
      { field: "description", value: "Description" },
    ],
  };
  assert.equal(
    (await f.request(other + "/psu/" + job.id + "/save", review)).status,
    404,
  );
  f.db.rows("brands")[0]!.name = "Changed brand";
  assert.equal(
    (await f.request(f.root + "/psu/" + job.id + "/save", review)).status,
    409,
  );
  assert.equal(f.db.rows("offerings").length, 0);
});
test("AI failure stays recoverable, saved offerings remain accessible without provider configuration", async (t) => {
  const f = await fixture(t, async () => {
    throw new Error("provider failure");
  });
  await f.create();
  await f.request(f.root + "/psu", input(f.input.brandId));
  assert.equal((await ready(f)).status, "failed");
  assert.equal((await f.request(f.root + "/offerings")).body.items.length, 1);
  const disabled = await fixture(t);
  assert.equal(
    (await disabled.request(disabled.root + "/psu")).body.generationAvailable,
    false,
  );
});
test("PSU preserves exact quoted evidence and rejects invented sources or duplicate fields", () => {
  const d = draft();
  assert.equal(d.fields.length, 2);
  assert.equal(d.fields[0]!.support[0]!.url, "https://example.com/service");
  assert.throws(() =>
    validateWebsiteDraft(
      {
        version: 1,
        fields: [
          {
            binding: { field: "name", value: "Wrong" },
            basis: "source_claim",
            support: [{ pageDigest: "a".repeat(64), quote: "Invented" }],
          },
        ],
        unknowns: [],
        questions: [],
      },
      [
        {
          url: "https://example.com",
          title: "",
          text: "Real",
          digest: digest("Real"),
          retrievedAt: new Date().toISOString(),
        },
      ],
    ),
  );
});

test("direct AI path reuses source validation, records usage and has no runtime grant or quota", async () => {
  const { createPsuGenerator, PsuGenerationFailure } =
    await import("../src/services/psu/generate");
  const text = "Energy optimisation. Supplier-delivered optimisation.";
  const transport = {
    resolve: async () => ["8.8.8.8"],
    read: async () => ({
      access: "allowed" as const,
      decodedBytes: text.length,
      text,
      title: "Service",
    }),
  };
  let submitted: Record<string, unknown> | undefined;
  const dto = {
    version: 1,
    fields: [
      {
        binding: { field: "name", value: "Energy optimisation" },
        basis: "source_claim",
        support: [{ pageDigest: digest(text), quote: "Energy optimisation" }],
      },
    ],
    unknowns: [],
    questions: [],
  };
  const send: typeof fetch = async (_url, init) => {
    submitted = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        model: "test-model",
        status: "completed",
        usage: { input_tokens: 100, output_tokens: 50 },
        output: [
          {
            type: "message",
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text: JSON.stringify(dto) }],
          },
        ],
      }),
      { status: 200 },
    );
  };
  const generate = createPsuGenerator(
    {
      apiKey: "offline-placeholder",
      project: "proj_test",
      model: "test-model",
    },
    send,
    transport,
  );
  const input = {
    websiteUrls: ["https://example.com/service"],
    workingLabel: "Service",
    orientation: "",
    context: { name: "Brand" },
  };
  const result = await generate(input, new AbortController().signal);
  assert.equal(result.usage.inputTokens, 100);
  assert.equal(
    result.draft.fields[0]!.support[0]!.quote,
    "Energy optimisation",
  );
  assert.equal(submitted!.store, false);
  assert.deepEqual(submitted!.tools, []);
  assert.equal("grant" in submitted!, false);
  dto.fields[0]!.binding.field = "deliveryModes";
  await assert.rejects(
    () => generate(input, new AbortController().signal),
    (e: unknown) =>
      e instanceof PsuGenerationFailure &&
      e.validationStage === "provider_schema" &&
      e.code === "output_format_invalid",
  );
  dto.fields[0]!.binding.field = "name";
  dto.fields[0]!.support[0]!.quote = "Invented quotation";
  await assert.rejects(
    () => generate(input, new AbortController().signal),
    (e: unknown) =>
      e instanceof PsuGenerationFailure &&
      e.usage.inputTokens === 100 &&
      e.validationStage === "product_validation",
  );
});

import {
  validateCompanyDraft,
  CompanyProfileSchema,
} from "../src/services/psu/company";
function companyDraft() {
  const text =
    "Acme is a B2B engineering company. Its brand is Acme. https://example.com";
  const page = {
    url: "https://example.com",
    title: "Acme",
    text,
    retrievedAt: new Date().toISOString(),
    digest: digest(text),
  };
  return validateCompanyDraft(
    {
      version: 1,
      fields: Object.entries({
        name: "Acme",
        brandName: "Acme",
        websiteUrl: "https://example.com",
        description: "Engineering company",
        businessModel: "B2B",
      }).map(([field, value]) => ({
        binding: { field, value },
        basis: "interpretation",
        support: [{ pageDigest: page.digest, quote: text }],
      })),
      unknowns: ["Competitors are not named"],
      questions: [],
    },
    [page],
  );
}
const companyDefinition = {
  name: "Acme",
  brandName: "Acme",
  websiteUrl: "https://example.com",
  description: "Engineering company",
  businessModel: "B2B",
};
test("company uses intake URL, separate review/approval, retained approved version and fresh company context for products", async (t) => {
  const calls: Parameters<PsuGenerator>[0][] = [];
  const f = await fixture(t, async (input) => {
    calls.push(input);
    return {
      ...(await generator(input, AbortSignal.timeout(1000))),
      ...(input.kind === "company"
        ? {
            companyDraft: companyDraft(),
            offeringCount: "single" as const,
            offeringCountReason: "Explicit single offering",
          }
        : {}),
    };
  });
  f.db.rows("client_onboardings").push({
    result: {
      workspaceId: f.input.workspaceId,
      brandId: f.input.brandId,
      organisationId: f.input.organisationId,
    },
    details: { intake: { websiteUrl: "https://example.com/about" } },
  });
  const root = f.root + "/psu/company/" + f.input.brandId;
  assert.equal(
    (await f.request(root)).body.websiteUrl,
    "https://example.com/about",
  );
  const started = await f.request(f.root + "/psu", {
    ...input(f.input.brandId),
    kind: "company",
  });
  assert.equal(started.status, 202);
  const job = await ready(f);
  assert.equal(job.companyDraft.kind, "psu_company_review_draft");
  assert.ok(job.draft);
  assert.equal(f.db.rows("offerings").length, 0);
  const body = {
    requestKey: crypto.randomUUID(),
    expectedVersionId: null,
    definition: companyDefinition,
    jobId: job.id,
    draftDigest: job.companyDraft.digest,
  };
  const saved = await f.request(root + "/save", body);
  assert.equal(saved.status, 200, JSON.stringify(saved));
  assert.equal(
    (await f.request(root + "/save", body)).body.versionId,
    saved.body.versionId,
  );
  assert.equal((await f.request(root)).body.approved, null);
  assert.equal(
    (await f.request(root + "/approve", { versionId: saved.body.versionId }))
      .status,
    200,
  );
  assert.equal(
    (await f.request(root)).body.approved.definition.businessModel,
    "B2B",
  );
  const product = await f.request(f.root + "/psu/" + job.id + "/save", {
    draftDigest: job.draft.digest,
    fields: [
      { field: "name", value: "Engineering" },
      { field: "description", value: "One service" },
    ],
  });
  assert.equal(product.status, 200, JSON.stringify(product));
  assert.equal(f.db.rows("offerings")[0]!.definition.businessModel, "B2B");
  const revised = await f.request(root + "/save", {
    requestKey: crypto.randomUUID(),
    expectedVersionId: saved.body.versionId,
    definition: { ...companyDefinition, description: "Revised" },
  });
  assert.equal(revised.status, 200);
  const state = (await f.request(root)).body;
  assert.equal(state.current.definition.description, "Revised");
  assert.equal(state.approved.definition.description, "Engineering company");
  assert.equal(
    (await f.request(root + "/approve", { versionId: saved.body.versionId }))
      .status,
    409,
  );
  assert.equal(
    (
      await f.request(root + "/save", {
        ...body,
        requestKey: crypto.randomUUID(),
      })
    ).status,
    409,
  );
  await f.request(f.root + "/psu", input(f.input.brandId));
  await ready(f);
  assert.equal(
    calls.at(-1)!.context.company &&
      (calls.at(-1)!.context.company as { definition: { description: string } })
        .definition.description,
    "Engineering company",
  );
  assert.equal(f.db.rows("brands")[0]!.name, "Brand");
});
test("company and primary product writes reject foreign resources and stale selection", async (t) => {
  const f = await fixture(t, generator),
    root = f.root + "/psu/company/" + f.input.brandId;
  assert.equal((await f.request(root, undefined, f.vapp)).status, 404);
  assert.equal(
    (await f.request(f.root + "/psu/company/" + generatePlatformId("brand")))
      .status,
    404,
  );
  assert.equal(
    (
      await f.request(root + "/primary", {
        offeringId: generatePlatformId("offering"),
        expectedOfferingId: null,
      })
    ).status,
    404,
  );
  const one = await f.create();
  const two = await f.create();
  assert.equal(
    (
      await f.request(root + "/primary", {
        offeringId: one.id,
        expectedOfferingId: null,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await f.request(root + "/primary", {
        offeringId: two.id,
        expectedOfferingId: null,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await f.request(root + "/primary", {
        offeringId: two.id,
        expectedOfferingId: one.id,
      })
    ).status,
    200,
  );
  assert.equal((await f.request(root)).body.primaryOfferingId, two.id);
  assert.equal(
    CompanyProfileSchema.safeParse({
      ...companyDefinition,
      websiteUrl: "https://user:password@example.com",
    }).success,
    false,
  );
});
test("a company-only result is reviewable when the product could not be generated", async (t) => {
  const f = await fixture(t, async () => ({
    companyDraft: companyDraft(),
    offeringCount: "single",
    offeringCountReason: "One stated offering",
    productUnavailable: true,
    unavailable: [],
    usage: { model: "test", status: "recorded" },
  }));
  await f.request(f.root + "/psu", {
    ...input(f.input.brandId),
    kind: "company",
  });
  const job = await ready(f);
  assert.equal(job.status, "review");
  assert.ok(job.companyDraft);
  assert.equal(job.draft, undefined);
  assert.equal(job.productUnavailable, true);
  assert.equal(
    (
      await f.request(f.root + "/psu/" + job.id + "/save", {
        draftDigest: job.companyDraft.digest,
        fields: [{ field: "name", value: "No" }],
      })
    ).status,
    409,
  );
});
test("company provider output keeps valid company evidence when the product output is malformed", async () => {
  const { createPsuGenerator, generationFailureCode } =
    await import("../src/services/psu/generate");
  const text = "Acme provides one engineering service.";
  const company = {
    version: 1,
    fields: [
      {
        binding: { field: "name", value: "Acme" },
        basis: "source_claim",
        support: [{ pageDigest: digest(text), quote: text }],
      },
    ],
    unknowns: [],
    questions: [],
  };
  const response = {
    company,
    offeringCount: "single",
    offeringCountReason: "One service is expressly stated",
    product: { invalid: "broken" },
    competitorSuggestions: ["Example competitor"],
  };
  const send: typeof fetch = async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    assert.ok(request.text.format.schema.properties.company);
    assert.ok(request.text.format.schema.properties.product);
    return new Response(
      JSON.stringify({
        model: "test-model",
        status: "completed",
        usage: { input_tokens: 100, output_tokens: 50 },
        output: [
          {
            type: "message",
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text: JSON.stringify(response) }],
          },
        ],
      }),
    );
  };
  const generate = createPsuGenerator(
    {
      apiKey: "offline-placeholder",
      project: "proj_test",
      model: "test-model",
    },
    send,
    {
      resolve: async () => ["8.8.8.8"],
      read: async () => ({
        access: "allowed",
        text,
        title: "Acme",
        decodedBytes: text.length,
      }),
    },
  );
  const result = await generate(
    {
      kind: "company",
      websiteUrls: ["https://example.com"],
      workingLabel: "Acme",
      orientation: "",
      context: {},
    },
    AbortSignal.timeout(1000),
  );
  assert.equal(result.companyDraft?.fields.length, 1);
  assert.deepEqual(result.competitorSuggestions, ["Example competitor"]);
  assert.equal(result.draft, undefined);
  assert.equal(result.productUnavailable, true);
  assert.equal(result.usage.status, "recorded");
  company.fields[0]!.support[0]!.quote = "Invented competitor evidence";
  await assert.rejects(
    () =>
      generate(
        {
          kind: "company",
          websiteUrls: ["https://example.com"],
          workingLabel: "Acme",
          orientation: "",
          context: {},
        },
        AbortSignal.timeout(1000),
      ),
    (error: unknown) =>
      generationFailureCode(error) === "output_evidence_invalid",
  );
});

test("large approved company context is chunked and faithfully supplied to generation", async (t) => {
  let observed: unknown;
  const f = await fixture(t, async (input, signal) => {
    observed = input.context;
    return generator(input, signal);
  });
  const root = f.root + "/psu/company/" + f.input.brandId;
  const description = "A".repeat(9500),
    valueProposition = "B".repeat(9500);
  const saved = await f.request(root + "/save", {
    requestKey: crypto.randomUUID(),
    expectedVersionId: null,
    definition: { ...companyDefinition, description, valueProposition },
  });
  assert.equal(saved.status, 200);
  assert.equal(
    (await f.request(root + "/approve", { versionId: saved.body.versionId }))
      .status,
    200,
  );
  assert.equal(
    (await f.request(f.root + "/psu", input(f.input.brandId))).status,
    202,
  );
  assert.equal((await ready(f)).status, "review");
  assert.equal(
    (observed as { company: { definition: { description: string } } }).company
      .definition.description,
    description,
  );
});

test("company provider schema omits unsupported URI format while local URL validation remains strict", async () => {
  const { structuredOutput } =
    await import("../src/services/psu/structured-output");
  const { CompanyOutputDto } = await import("../src/services/psu/company");
  const output = structuredOutput(CompanyOutputDto);
  assert.equal(JSON.stringify(output.schema).includes('"format":"uri"'), false);
  const value = {
    company: {
      version: 1,
      fields: [
        {
          binding: { field: "websiteUrl", value: "https://example.com" },
          basis: "source_claim",
          support: [{ pageDigest: "a".repeat(64), quote: "Example" }],
        },
      ],
      unknowns: [],
      questions: [],
    },
    offeringCount: "uncertain",
    offeringCountReason: "Unknown",
    product: null,
    competitorSuggestions: null,
  };
  assert.doesNotThrow(() => output.parse(value));
  for (const invalid of [
    "not a URL",
    "https://user:password@example.com",
    "file:///etc/passwd",
  ]) {
    value.company.fields[0]!.binding.value = invalid;
    assert.throws(() => output.parse(value));
  }
});

test("company failures return safe categories and never raw error details", async (t) => {
  for (const [message, code] of [
    ["AI request rejected", "service_configuration"],
    ["sources_unavailable", "sources_unavailable"],
    ["secret/raw provider data", "generation_failed"],
  ]) {
    const f = await fixture(t, async () => {
      throw new Error(message);
    });
    await f.request(f.root + "/psu", {
      ...input(f.input.brandId),
      kind: "company",
    });
    const job = await ready(f);
    assert.equal(job.status, "failed");
    assert.equal(job.failureCode, code);
    assert.equal(JSON.stringify(job).includes(message), message === code);
  }
});

test("manual product creation is idempotent, unapproved and needs no generator", async (t) => {
  const f = await fixture(t);
  const body = {
    requestKey: crypto.randomUUID(),
    brandId: f.input.brandId,
    definition,
  };
  const created = await f.request(f.root + "/psu/products", body);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.deepEqual(
    (await f.request(f.root + "/psu/products", body)).body,
    created.body,
  );
  assert.equal(
    (
      await f.request(f.root + "/psu/products", {
        ...body,
        requestKey: crypto.randomUUID(),
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await f.request(f.root + "/psu/products", {
        ...body,
        requestKey: crypto.randomUUID(),
        brandId: generatePlatformId("brand"),
      })
    ).status,
    404,
  );
  const rows = (await f.request(f.root + "/offerings")).body.items;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "draft");
});

test("summary review updates its selected product and retains approved history; stale targets are rejected", async (t) => {
  const f = await fixture(t, generator);
  let product = await f.create();
  product = (
    await f.request(f.root + "/offerings/approve", {
      id: product.id,
      expectedUpdatedAt: product.updatedAt,
    })
  ).body;
  const request = {
    ...input(f.input.brandId),
    offeringId: product.id,
    expectedUpdatedAt: product.updatedAt,
  };
  assert.equal((await f.request(f.root + "/psu", request)).status, 202);
  const job = await ready(f);
  let rows = (await f.request(f.root + "/offerings")).body.items;
  assert.equal(rows[0].status, "approved");
  const body = {
    draftDigest: job.draft.digest,
    fields: [
      { field: "name", value: definition.name },
      { field: "description", value: "Updated summary" },
    ],
  };
  const result = await f.request(f.root + "/psu/" + job.id + "/save", body);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.offeringId, product.id);
  assert.deepEqual(
    (await f.request(f.root + "/psu/" + job.id + "/save", body)).body,
    result.body,
  );
  rows = (await f.request(f.root + "/offerings")).body.items;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "draft");
  assert.equal(rows[0].approvedRevision, 1);
  assert.equal(rows[0].definition.description, "Updated summary");
  const snapshot = (
    await f.request(f.root + "/offerings/" + product.id + "/revisions/1")
  ).body.snapshot;
  assert.equal(snapshot.definition.description, definition.description);
  assert.equal(
    (
      await f.request(f.root + "/psu", {
        ...request,
        requestKey: crypto.randomUUID(),
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await f.request(f.root + "/psu", {
        ...request,
        requestKey: crypto.randomUUID(),
        offeringId: generatePlatformId("offering"),
      })
    ).status,
    404,
  );
});

test("reference lists return active shared records only after workspace authorization", async (t) => {
  const f = await fixture(t);
  f.db.rows("ref_industries").push(
    {
      _id: "1",
      code: "ENERGY",
      name: "Energy",
      description: "Energy services",
      is_active: true,
    },
    { _id: "2", code: "OLD", name: "Old", is_active: false },
  );
  f.db
    .rows("ref_regions")
    .push({ _id: "3", code: "UK", name: "United Kingdom", is_active: true });
  const result = await f.request(f.root + "/psu/reference-data");
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.industries, [
    { code: "ENERGY", name: "Energy", description: "Energy services" },
  ]);
  assert.deepEqual(result.body.regions, [
    { code: "UK", name: "United Kingdom", description: "" },
  ]);
  const denied = await f.request(
    "/api/v1/hvm/workspaces/" +
      generatePlatformId("workspace") +
      "/psu/reference-data",
  );
  assert.equal(denied.status, 404);
});

test("product evidence failure omits the whole affected field and retains verified fields", () => {
  const text = "Energy optimisation. Supplier-delivered optimisation.";
  const page = {
    url: "https://example.com/service",
    title: "Service",
    text,
    digest: digest(text),
    retrievedAt: new Date().toISOString(),
  };
  const field = (
    name: string,
    value: string,
    quote: string,
    pageDigest = page.digest,
  ) => ({
    binding: { field: name, value },
    basis: "source_claim",
    support: [{ pageDigest, quote }],
  });
  const fields = [
    field("name", "Energy optimisation", "Energy optimisation"),
    field(
      "description",
      "Supplier-delivered optimisation",
      "Supplier-delivered optimisation",
    ),
    field("valueProposition", "Unsupported value", "Not on the page"),
    field("engagementModel", "Unsupported model", text, "a".repeat(64)),
  ];
  const raw = {
    version: 1,
    fields,
    unknowns: ["Pricing not stated"],
    questions: [],
  };
  const result = validateWebsiteDraft(raw, [page]);
  assert.deepEqual(
    result.fields.map((f) => f.binding.field),
    ["name", "description"],
  );
  assert.equal(
    result.fields[1]!.support[0]!.quote,
    "Supplier-delivered optimisation",
  );
  assert.match(result.unknowns.join(" "), /2 suggested details were left out/);
  assert.equal(JSON.stringify(result).includes("Unsupported value"), false);
  const fullUnknowns = Array.from({ length: 20 }, (_, i) => `Unknown ${i}`);
  assert.deepEqual(
    validateWebsiteDraft({ ...raw, unknowns: fullUnknowns }, [page]).unknowns,
    fullUnknowns,
  );
  const mixed = field("name", "Energy optimisation", "Energy optimisation");
  mixed.support.push({ pageDigest: page.digest, quote: "Invented" });
  assert.throws(
    () => validateWebsiteDraft({ ...raw, fields: [mixed] }, [page]),
    /Unsupported source quotation/,
  );
  assert.throws(
    () =>
      validateWebsiteDraft({ ...raw, fields: [fields[0], fields[0]] }, [page]),
    /Duplicate proposed field/,
  );
  assert.throws(
    () => validateWebsiteDraft(raw, [{ ...page, digest: "b".repeat(64) }]),
    /Page digest mismatch/,
  );
});

test("provider contract enforces product field-specific types and enum values", async () => {
  const { WebsiteDraftDto } = await import("../src/services/psu/website-draft");
  const { structuredOutput } =
    await import("../src/services/psu/structured-output");
  const output = structuredOutput(WebsiteDraftDto);
  const make = (field: string, value: unknown) => ({
    version: 1,
    fields: [
      {
        binding: { field, value },
        basis: "source_claim",
        support: [{ pageDigest: "a".repeat(64), quote: "Example" }],
      },
    ],
    unknowns: [],
    questions: [],
  });
  for (const [field, value] of [
    ["deliveryModes", "remote_service"],
    ["primaryOfferingType", "Professional service"],
    ["name", ["Example"]],
    ["capabilities", "Analysis"],
    ["implementationModel", "None"],
  ] as const) {
    assert.throws(() => output.parse(make(field, value)));
  }
  for (const [field, value] of [
    ["deliveryModes", ["remote_service"]],
    ["primaryOfferingType", "professional_service"],
    ["name", "Example"],
    ["capabilities", ["Analysis"]],
    ["implementationModel", "no_implementation"],
  ] as const) {
    assert.deepEqual(output.parse(make(field, value)), make(field, value));
  }
});

test("app product draft accepts more than twenty distinct supported fields without weakening review checks", () => {
  const text = "Example service and supporting details";
  const page = {
    url: "https://example.com/",
    title: "Example",
    retrievedAt: "2026-10-07T00:00:00.000Z",
    text,
    digest: digest(text),
  };
  const textFields = [
    "name",
    "description",
    "whatItIs",
    "whatCustomerBuys",
    "supplierRole",
    "customerRole",
    "engagementModel",
    "valueProposition",
    "commercialModel",
    "businessModel",
  ];
  const listFields = [
    "capabilities",
    "deliverables",
    "problemsSolved",
    "desiredOutcomes",
    "differentiators",
    "purchaseConsiderations",
    "industriesServed",
    "regionsServed",
    "competitors",
    "boundaries",
    "explicitExclusions",
  ];
  const fields = [
    ...textFields.map((field) => ({ field, value: text })),
    ...listFields.map((field) => ({ field, value: [text] })),
  ].map((binding) => ({
    binding,
    basis: "interpretation",
    support: [{ pageDigest: page.digest, quote: text }],
  }));
  const raw = { version: 1, fields, unknowns: [], questions: [] };
  const result = validateWebsiteDraft(raw, [page]);
  assert.equal(result.fields.length, 21);
  assert.throws(
    () =>
      validateWebsiteDraft({ ...raw, fields: [...fields, fields[0]] }, [page]),
    /Duplicate proposed field/,
  );
  assert.throws(() =>
    validateWebsiteDraft(
      { ...raw, fields: Array.from({ length: 41 }, () => fields[0]) },
      [page],
    ),
  );
});
