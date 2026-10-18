import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { EnquiryMemoryDb } from "./helpers/enquiry-db";
import { authEnvironment, testIssuer } from "./helpers/auth";
import { parseConfig } from "../src/config";
import { provisionHvmClient } from "../src/services/hvm-provision";
import { generatePlatformId, EventSchema } from "../src/domain";
import {
  createWorkspaceHenry,
  validateHenryProposal,
} from "../src/services/content-strategy/workspace-henry";
import { workspaceHenryRequest } from "../src/services/content-strategy/henry-model";
import type { ContentGenerator } from "../src/services/content-strategy/generate";
const config = parseConfig({
  ...authEnvironment,
  HVM_COGNITO_CLIENT_ID: "hvmclient",
  DEPLOYMENT_ENV: "test",
  MONGODB_URI: "mongodb://unused.invalid",
});
const result = {
  reply: "Focus on your strongest evidence.",
  objective: "Find suitable buyers",
  destination: "icp",
  actionId: "",
  changes: [
    {
      key: "description",
      value: JSON.stringify("Independent advice."),
      reason: "Clearer wording.",
    },
  ],
};
const usage = { model: "offline-fixture", inputTokens: 100, outputTokens: 50 };
async function setup(
  generate: ContentGenerator = async () => ({ result, usage }),
) {
  const db = new EnquiryMemoryDb(),
    w = generatePlatformId("workspace"),
    brand = generatePlatformId("brand"),
    identity = { subject: "owner", issuer: testIssuer, clientId: "hvmclient" };
  db.rows("schema_versions").push({ _id: "vapp-v1", version: 27 });
  await provisionHvmClient(
    db.mongo,
    {
      organisationId: generatePlatformId("org"),
      organisationName: "Fixture",
      workspaceId: w,
      management: "client",
      brandId: brand,
      clientMembershipId: generatePlatformId("workspacemembership"),
      workspaceName: "Fixture",
      brandName: "Fixture",
      brandSlug: "fixture",
      human: { type: "human", id: identity.subject, issuer: identity.issuer },
    },
    testIssuer,
  );
  const input = workspaceHenryRequest.parse({
    requestKey: randomUUID(),
    conversationId: randomUUID(),
    instruction: "Help improve this",
    objective: "",
    screen: {
      section: "understanding",
      brandId: brand,
      summary: "Current company",
      editor: {
        key: "company:1",
        title: "Company",
        fields: [
          {
            key: "description",
            label: "Description",
            value: JSON.stringify("Advice"),
          },
        ],
      },
      actions: [],
    },
  });
  return {
    db,
    w,
    brand,
    identity,
    input,
    service: createWorkspaceHenry(config, db.mongo, generate),
  };
}
test("shared conversation persists, deduplicates requests, carries context and records usage without changing business records", async () => {
  const calls: unknown[] = [];
  const { db, w, brand, identity, input, service } = await setup(
    async (_task, value) => {
      calls.push(value);
      return { result, usage };
    },
  );
  const before = structuredClone(db.rows("brands"));
  assert.deepEqual(await service.ask(identity, w, input), result);
  assert.deepEqual(await service.ask(identity, w, input), result);
  assert.equal(calls.length, 1);
  const list = await service.list(identity, w, brand);
  assert.equal(list.turns.length, 1);
  assert.deepEqual(list.turns[0].screen, input.screen);
  assert.deepEqual(list.turns[0].result, result);
  await service.ask(identity, w, {
    ...input,
    requestKey: randomUUID(),
    screen: { ...input.screen, section: "icp" },
    instruction: "Continue here",
  });
  assert.equal(
    (calls[1] as { conversation: { reply: string }[] }).conversation[0].reply,
    result.reply,
  );
  assert.equal(
    (calls[1] as { approvedContext: { approvedBrandBrief: unknown } })
      .approvedContext.approvedBrandBrief,
    null,
  );
  assert.deepEqual(db.rows("brands"), before);
  const completed = db
    .rows("events")
    .filter(
      (e) =>
        e.payload.task === "workspace_henry" &&
        e.payload.status === "completed",
    );
  assert.equal(completed.length, 2);
  assert.deepEqual(completed[0].payload.usage, usage);
  db.rows("events")
    .filter((e) => e.payload.task === "workspace_henry")
    .forEach((e) => EventSchema.parse(e));
});
test("isolation denies other tenants/actors and another brand cannot inherit the conversation", async () => {
  const { w, brand, identity, input, service, db } = await setup();
  await service.ask(identity, w, input);
  await assert.rejects(() =>
    service.list({ ...identity, subject: "intruder" }, w, brand),
  );
  await assert.rejects(() =>
    service.ask(identity, generatePlatformId("workspace"), input),
  );
  await assert.rejects(() =>
    service.ask(identity, w, {
      ...input,
      requestKey: randomUUID(),
      screen: { ...input.screen, brandId: generatePlatformId("brand") },
    }),
  );
  const other = generatePlatformId("brand");
  db.rows("brands").push({
    ...db.rows("brands")[0],
    id: other,
    name: "Another brand",
  });
  assert.equal((await service.list(identity, w, other)).turns.length, 0);
  const event = db
    .rows("events")
    .find(
      (e) =>
        e.payload.status === "completed" &&
        e.payload.task === "workspace_henry",
    )!;
  event.createdBy.id = "another-person";
  assert.equal((await service.list(identity, w, brand)).turns.length, 0);
});
test("large editors use validated bounded event parts and corrupted recovery is rejected", async () => {
  const { w, brand, identity, input, service, db } = await setup();
  input.screen.editor!.fields[0].value = JSON.stringify("x".repeat(25000));
  await service.ask(identity, w, input);
  assert.equal(
    (await service.list(identity, w, brand)).turns[0].screen.editor.fields[0]
      .value,
    input.screen.editor!.fields[0].value,
  );
  const parts = db.rows("events").filter((e) => e.payload.status === "part");
  assert.ok(parts.length > 3);
  parts.forEach((e) => EventSchema.parse(e));
  parts[0].payload.text = "tampered";
  await assert.rejects(() => service.list(identity, w, brand));
});
test("invalid optional changes are omitted while useful advice survives", async () => {
  const { input } = await setup();
  const valid = validateHenryProposal(input.screen, {
    ...result,
    actionId: "delete:all",
    changes: [
      ...result.changes,
      { key: "permissions", value: '"admin"', reason: "" },
    ],
  });
  assert.equal(valid.actionId, "");
  assert.deepEqual(valid.changes, result.changes);
  assert.match(valid.reply, /left out/);
  for (const changes of [
    [...result.changes, ...result.changes],
    [{ key: "description", value: "null", reason: "" }],
    [{ key: "description", value: "{}", reason: "" }],
    [{ key: "__proto__.x", value: "true", reason: "" }],
  ])
    assert.equal(
      validateHenryProposal(input.screen, { ...result, changes }).changes
        .length,
      0,
    );
});
test("authority loss during generation prevents a completed result and still retains usage", async () => {
  const state = await setup(async () => {
    state.db.rows("workspace_memberships").forEach((m) => (m.archived = true));
    return { result, usage };
  });
  await assert.rejects(() =>
    state.service.ask(state.identity, state.w, state.input),
  );
  const event = state.db
    .rows("events")
    .find(
      (e) =>
        e.payload.task === "workspace_henry" && e.payload.status === "failed",
    );
  assert.ok(event);
  assert.deepEqual(event.payload.usage, usage);
});
test("approved context changes during generation leave the reply recoverably failed", async () => {
  const state = await setup(async () => {
    state.db.rows("brands")[0].archived = true;
    return { result, usage };
  });
  await assert.rejects(() =>
    state.service.ask(state.identity, state.w, state.input),
  );
  assert.ok(
    state.db
      .rows("events")
      .some(
        (e) =>
          e.payload.task === "workspace_henry" && e.payload.status === "failed",
      ),
  );
});

test("offer review reads only the selected brand's saved draft and fences changed decisions", async () => {
  let observed: {
    approvedContext: {
      currentOfferReview: {
        work: { stages: { userInputs: { answer: string }[] }[] };
        informationStatus: string;
      };
    };
  };
  let changeDuringGeneration = false;
  const f = await setup(async (_task, value) => {
    observed = value as typeof observed;
    if (changeDuringGeneration)
      f.db.rows("offer_designs")[0]!.work.stages[0].userInputs[0].answer =
        "Changed by the user";
    return { result: { ...result, changes: [] }, usage };
  });
  const productId = generatePlatformId("offering");
  const offerId = generatePlatformId("offer");
  const designId = generatePlatformId("offerdesign");
  f.db
    .rows("offerings")
    .push({ id: productId, workspaceId: f.w, brandId: f.brand });
  f.db.rows("offers").push({
    id: offerId,
    workspaceId: f.w,
    offeringId: productId,
    offerDesignId: designId,
    definition: { name: "Selected offer" },
  });
  f.db.rows("offer_designs").push({
    id: designId,
    workspaceId: f.w,
    offeringId: productId,
    work: {
      stages: [
        {
          stageKey: "pricing_terms",
          userInputs: [{ question: "Terms?", answer: "No managed services" }],
        },
      ],
    },
  });
  const input = {
    ...f.input,
    screen: {
      ...f.input.screen,
      section: "offers",
      editor: { ...f.input.screen.editor!, key: "offer-review:" + offerId },
    },
  };
  await f.service.ask(f.identity, f.w, input);
  assert.equal(
    observed.approvedContext.currentOfferReview.work.stages[0].userInputs[0]
      .answer,
    "No managed services",
  );
  assert.match(
    observed.approvedContext.currentOfferReview.informationStatus,
    /not approved facts/,
  );
  changeDuringGeneration = true;
  await assert.rejects(
    f.service.ask(f.identity, f.w, { ...input, requestKey: randomUUID() }),
    /context or offer decisions changed/,
  );
  changeDuringGeneration = false;
  f.db.rows("offerings")[0]!.brandId = generatePlatformId("brand");
  await assert.rejects(
    f.service.ask(f.identity, f.w, { ...input, requestKey: randomUUID() }),
    /selected brand/,
  );
});
test("Henry sees saved campaign drafts across functions, scoped to the current brand", async () => {
  let observed: {
    approvedContext: {
      campaigns: { id: string; status: string }[];
      campaignContextStatus: string;
    };
  };
  const f = await setup(async (_task, value) => {
    observed = value as typeof observed;
    return { result, usage };
  });
  const id = generatePlatformId("campaign");
  f.db.rows("events").push({
    id: generatePlatformId("event"),
    workspaceId: f.w,
    campaignId: id,
    eventType: "campaign_setup",
    createdAt: new Date(),
    payload: {
      version: 1,
      status: "draft",
      setup: {
        brandId: f.brand,
        name: "QA campaign",
        objective: "Test only",
        goal: "Saved plan",
        products: [],
        offers: [],
        audiences: [],
      },
    },
  });
  f.db.rows("events").push({
    id: generatePlatformId("event"),
    workspaceId: f.w,
    campaignId: generatePlatformId("campaign"),
    eventType: "campaign_setup",
    createdAt: new Date(),
    payload: {
      version: 1,
      status: "draft",
      setup: { brandId: generatePlatformId("brand"), name: "Other brand" },
    },
  });
  await f.service.ask(f.identity, f.w, f.input);
  assert.equal(observed.approvedContext.campaigns.length, 1);
  assert.equal(observed.approvedContext.campaigns[0].id, id);
  assert.equal(observed.approvedContext.campaigns[0].status, "draft");
  assert.match(
    observed.approvedContext.campaignContextStatus,
    /not approved or executing/,
  );
});
