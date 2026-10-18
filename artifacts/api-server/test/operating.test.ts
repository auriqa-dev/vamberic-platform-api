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
  return { db, config, input, auth, root, request, token, vapp, url };
}
import { operatingFixtures } from "./helpers/operating-fixtures";
import {
  evaluateCommercialDecision,
  evaluateSwarmReadiness,
} from "../src/domain/operating-logic";
const fields = operatingFixtures();
const control = (r: { id: string; updatedAt: string }) => ({
  id: r.id,
  expectedUpdatedAt: r.updatedAt,
});

test("retired setup rejects all writes and preserves authorized historical reads", async (t) => {
  const f = await fixture(t);
  for (const resource of ["agent_definitions", "swarm_templates", "commercial_policies", "client_agents", "client_swarms", "pricing_recommendations", "swarm_agreements"] as const) {
    const global = ["agent_definitions", "swarm_templates", "commercial_policies"].includes(resource);
    const root = (global ? "/api/v1/hvm/empress" : f.root + "/operating") + "/" + resource.replaceAll("_", "-");
    const row = { ...structuredClone(fields[resource]), ...(global ? {} : { workspaceId: f.input.workspaceId }) };
    f.db.rows(resource).push(row);
    const before = JSON.stringify(f.db.rows(resource));
    for (const op of ["create", "update", "publish", "configure", "approve", "empress-approve", "supersede", ...(resource === "agent_definitions" ? [] : ["retire"])]) {
      assert.equal((await f.request(root + "/" + op, {})).status, 404, resource + ":" + op);
    }
    assert.equal(JSON.stringify(f.db.rows(resource)), before);
    assert.equal((await f.request(root + "/" + row.id)).status, 200);
    assert.equal((await f.request(root + "/" + row.id, undefined, f.vapp)).status, 404);
  }
  assert.equal((await f.request("/api/v1/hvm/empress/agreement-approvals/anything/approve", {})).status, 400);
});

for (const [name, adjustment, expected] of [
  ["percentage", { kind: "percentage_discount", percentage: 0.1 }, 90000],
  ["fixed", { kind: "fixed_discount", amountMinor: 10000 }, 90000],
  ["custom", { kind: "custom", amountMinor: 85000 }, 85000],
] as const)
  test(`commercial ${name} preserves recommendation and derives final`, () => {
    const before = structuredClone(fields.pricing_recommendations.data);
    const result = evaluateCommercialDecision(
      { ...fields.swarm_agreements.data.decision, adjustment },
      before,
    );
    assert.equal(result.finalRecurringMinor, expected);
    assert.equal(result.recommendedPeriodMinor, 100000);
    assert.deepEqual(before, fields.pricing_recommendations.data);
  });
for (const treatment of ["internal", "waived", "promotional"] as const)
  test(`commercial ${treatment} treatment retains economics`, () => {
    const r = evaluateCommercialDecision(
      { ...fields.swarm_agreements.data.decision, treatment },
      fields.pricing_recommendations.data,
    );
    assert.equal(
      r.finalRecurringMinor,
      treatment === "promotional" ? 100000 : 0,
    );
    assert.equal(r.recommendedPeriodMinor, 100000);
    if (treatment !== "promotional")
      assert.equal(r.policyResult, "requires_empress_approval");
  });
for (const billingFrequency of ["monthly", "annual"] as const)
  test(`annual commitment billed ${billingFrequency}`, () => {
    const r = evaluateCommercialDecision(
      {
        ...fields.swarm_agreements.data.decision,
        billingFrequency,
        commitment: { kind: "annual", months: 12, renewal: "review" },
      },
      fields.pricing_recommendations.data,
    );
    assert.equal(
      r.finalRecurringMinor,
      billingFrequency === "annual" ? 1080000 : 90000,
    );
    assert.equal(r.finalMonthlyEquivalentMinor, 90000);
  });
test("readiness rejects absent agents and cross-workspace configuration", () => {
  const swarm = structuredClone(fields.client_swarms);
  const agent = {
    ...fields.client_agents,
    workspaceId: generatePlatformId("workspace"),
    status: "configured",
  };
  const model = {
    swarm,
    agents: [agent],
    definitions: [],
    providers: [],
    integrations: [],
    capabilityInstances: [],
    allowInternal: false,
  };
  assert.equal(evaluateSwarmReadiness(model).ready, false);
  assert.equal(evaluateSwarmReadiness({ ...model, agents: [] }).ready, false);
});

test("readiness resolves compatible provider alternatives and rejects foreign, disconnected and cyclic bindings", () => {
  const row = operatingFixtures();
  const provider = {
    ...row.integration_providers,
    key: "synthetic",
    status: "active",
  };
  const definition = {
    ...row.agent_definitions,
    status: "active",
    data: {
      ...row.agent_definitions.data,
      integrationRequirements: [
        {
          slot: "email",
          operationalCapability: "email_delivery",
          required: true,
          minimumProviders: 1,
          supportedProviderIds: [provider.id],
        },
      ],
    },
  };
  const connection = {
    id: generatePlatformId("integration"),
    workspaceId: row.client_agents.workspaceId,
    status: "connected",
    provider: provider.key,
    archived: false,
  };
  const agent = {
    ...row.client_agents,
    status: "configured",
    data: {
      ...row.client_agents.data,
      bindings: [
        {
          slot: "email",
          integrationId: connection.id,
          provider: { id: provider.id, version: 1 },
          costTreatment: "client_funded",
        },
      ],
    },
  };
  const model = {
    swarm: row.client_swarms,
    agents: [agent],
    definitions: [definition],
    providers: [provider],
    integrations: [connection],
    capabilityInstances: [],
    allowInternal: false,
  };
  assert.equal(evaluateSwarmReadiness(model).ready, true);
  assert.equal(
    evaluateSwarmReadiness({
      ...model,
      integrations: [
        { ...connection, workspaceId: generatePlatformId("workspace") },
      ],
    }).ready,
    false,
  );
  assert.equal(
    evaluateSwarmReadiness({
      ...model,
      integrations: [{ ...connection, status: "disconnected" }],
    }).ready,
    false,
  );
  assert.equal(
    evaluateSwarmReadiness({
      ...model,
      providers: [
        {
          ...provider,
          data: { ...provider.data, operationalCapabilities: ["other"] },
        },
      ],
    }).ready,
    false,
  );
  assert.equal(
    evaluateSwarmReadiness({
      ...model,
      agents: [
        {
          ...agent,
          data: { ...agent.data, dependencyInstanceIds: [agent.id] },
        },
      ],
    }).ready,
    false,
  );
  const alternative = {
    ...provider,
    id: generatePlatformId("integrationprovider"),
    key: "alternative",
  };
  definition.data.integrationRequirements[0].supportedProviderIds.push(
    alternative.id,
  );
  agent.data.bindings.push({
    ...agent.data.bindings[0],
    integrationId: generatePlatformId("integration"),
    provider: { id: alternative.id, version: 1 },
  });
  model.providers.push(alternative);
  model.integrations.push({
    ...connection,
    id: agent.data.bindings[1].integrationId,
    provider: alternative.key,
  });
  assert.equal(evaluateSwarmReadiness(model).ready, true);
});

import { createOperatingGateway } from "../../../../hvm-app/src/data/operating/gateway";
import {
  AgentDefinitionData,
  IntegrationProviderData,
} from "../../../../hvm-app/src/data/operating/models";
import { resourceFields } from "../../../../hvm-app/src/components/operating/fields";
import {
  toForm,
  toPayload,
} from "../../../../hvm-app/src/components/operating/form-fields";
test("Empress cannot register PSU; legacy PSU remains available for guarded archive", async (t) => {
  const f = await fixture(t);
  f.db.rows("schema_versions")[0]!.version = 23;
  const data = AgentDefinitionData.parse({
    ...fields.agent_definitions.data,
    executionImplementation: {
      key: "product_service_understanding",
      version: 2,
      manifestDigest: "a".repeat(64),
      protocolVersion: "2.0",
    },
    effectiveness: [
      {
        maker: "understand",
        evaluator: "evaluate",
        revision: "revise",
        profile: { key: "profile", version: 1, digest: "b".repeat(64) },
        policy: { key: "policy", version: 1, digest: "c".repeat(64) },
        required: true,
        maxRevisions: 2,
      },
    ],
  });
  const payload = AgentDefinitionData.parse(
    toPayload(
      resourceFields.agent_definitions,
      toForm(resourceFields.agent_definitions, data),
    ),
  );
  const app = createOperatingGateway(f.url, {
    getAccessToken: async () => f.token,
    invalidate: () => {},
  });
  await assert.rejects(
    () =>
      app.create(
        "agent_definitions",
        {
          key: "product_service_understanding",
          version: 2,
          availability: "internal",
          data: payload,
        },
        new AbortController().signal,
      ),
    /denied/,
  );
  const legacy = {
    ...fields.agent_definitions,
    data,
    key: "product_service_understanding",
    status: "active",
    archived: false,
  };
  f.db.rows("agent_definitions").push(legacy);
  assert.equal(
    (await f.request("/api/v1/hvm/empress/agent-definitions")).body.items[0].id,
    legacy.id,
  );
  assert.equal(
    (
      await f.request(
        "/api/v1/hvm/empress/agent-definitions/publish",
        control(legacy),
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await f.request(
        "/api/v1/hvm/empress/agent-definitions/retire",
        control(legacy),
      )
    ).status,
    200,
  );
  assert.equal(f.db.rows("client_agents").length, 0);
  assert.equal(f.db.rows("agent_runs").length, 0);
});

test("frontend accepts a created provider when Mongo adds its internal id", async (t) => {
  const f = await fixture(t);
  const collection = f.db.collection.bind(f.db);
  f.db.collection = (name) => {
    const result = collection(name);
    const insert = result.insertOne;
    result.insertOne = async (record) => {
      // The real driver mutates the supplied document before returning.
      record._id ??= "mongo-internal-id";
      return insert(record);
    };
    return result;
  };
  const app = createOperatingGateway(f.url, {
    getAccessToken: async () => f.token,
    invalidate: () => {},
  });
  const created = await app.create(
    "integration_providers",
    {
      key: "internal_response_regression",
      version: 1,
      availability: "internal",
      data: IntegrationProviderData.parse(fields.integration_providers.data),
    },
    new AbortController().signal,
  );
  assert.equal(created.status, "draft");
  assert.equal("_id" in created, false);
  assert.equal(f.db.rows("integration_providers").length, 1);
  assert.equal(f.db.rows("integration_providers")[0]!._id, "mongo-internal-id");
});

test("Empress deletes only unused drafts and retains audit history", async (t) => {
  const f = await fixture(t);
  const root = "/api/v1/hvm/empress/agent-definitions";
  const draft = structuredClone(fields.agent_definitions);
  f.db.rows("agent_definitions").push(draft);
  assert.equal(
    (
      await f.request(root + "/delete", {
        ...control(draft),
        expectedUpdatedAt: "2000-01-01T00:00:00.000Z",
      })
    ).status,
    409,
  );
  assert.equal(
    (await f.request(root + "/delete", control(draft), f.vapp)).status,
    404,
  );
  f.db
    .rows("client_agents")
    .push({
      id: "dependency",
      data: { definition: { id: draft.id } },
      archived: true,
    });
  const blocked = await f.request(`${root}/${draft.id}/removal-review/delete`);
  assert.equal(blocked.body.allowed, false);
  assert.match(blocked.body.blockers.join(" "), /Client configurations/);
  assert.equal((await f.request(root + "/delete", control(draft))).status, 409);
  f.db.rows("client_agents").splice(0);
  assert.equal((await f.request(root + "/delete", control(draft))).status, 200);
  assert.equal((await f.request(`${root}/${draft.id}`)).status, 404);
  assert.ok(
    f.db
      .rows("events")
      .some(
        (e) =>
          e.payload?.resourceId === draft.id &&
          e.payload.operation === "delete",
      ),
  );
});

test("Published definitions archive with history; execution results block removal", async (t) => {
  const f = await fixture(t);
  const root = "/api/v1/hvm/empress/agent-definitions";
  const active = { ...structuredClone(fields.agent_definitions), status: "active" };
  f.db.rows("agent_definitions").push(active);
  assert.equal(
    (await f.request(root + "/delete", control(active))).status,
    409,
  );
  f.db
    .rows("agent_runs")
    .push({ frozen: { definition: { id: active.id } }, status: "completed" });
  assert.equal(
    (await f.request(root + "/retire", control(active))).status,
    409,
  );
  f.db.rows("agent_runs").splice(0);
  const retired = await f.request(root + "/retire", control(active));
  assert.equal(retired.status, 200);
  assert.equal(retired.body.archived, true);
  assert.equal((await f.request(root)).body.items.length, 0);
  assert.equal(
    (await f.request(root + "?archived=archived")).body.items[0].id,
    active.id,
  );
  assert.equal((await f.request(`${root}/${active.id}`)).status, 200);
});

test("Empress registers, persists and versions the new methodology without changing Value Equation", async t => {
  const f = await fixture(t);
  const path = "/api/v1/hvm/empress/offer-methodology-catalogue";
  const catalogue = await f.request(path);
  assert.equal(catalogue.status,200);
  const id = "offermethodology_00000000000000000000000002";
  const registered = await f.request(path+"/register",{id,version:1});
  assert.equal(registered.status,200,JSON.stringify(registered.body));
  const again = await f.request(path+"/register",{id,version:1});
  assert.equal(again.status,200);
  assert.equal(f.db.rows("methodology_availability").filter(r=>r.key==="value_proposition_development").length,1);
  const persisted = await f.request(path);
  assert.equal(persisted.body.items.find((m:any)=>m.id===id).persisted,true);
  assert.equal(f.db.rows("events").filter(e=>e.eventType==="offer_methodology_definition").length,1);
  const methods = await f.request(f.root+"/offer-design-methodologies");
  assert.equal(methods.status,200);
  assert.ok(methods.body.items.some((m:any)=>m.id===id && m.stages.length===8));
  const unknown = await f.request(path+"/register",{id,version:2});
  assert.equal(unknown.status,409);
});
