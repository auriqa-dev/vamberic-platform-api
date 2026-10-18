import assert from "node:assert/strict";
import { test } from "node:test";
import { generatePlatformId } from "../src/domain";
import { CONTACT_STRATEGY_TEMPLATES } from "../src/services/contact-strategy/catalogue";
import {
  planStrategyTemplates,
  initialiseStrategyTemplates,
} from "../src/services/contact-strategy/provision";
import { evaluateContactStrategies } from "../src/services/contact-strategy/evaluate";
import { EnquiryMemoryDb } from "./helpers/enquiry-db";
const workspace = () => generatePlatformId("workspace");
test("exact catalogue has 25 templates, six categories and draft-only provisioning", () => {
  const w = workspace(),
    plan = planStrategyTemplates(w, [], new Date());
  assert.equal(CONTACT_STRATEGY_TEMPLATES.length, 25);
  assert.equal(
    new Set(CONTACT_STRATEGY_TEMPLATES.map((t) => t.category)).size,
    6,
  );
  assert.deepEqual(
    CONTACT_STRATEGY_TEMPLATES.map((t) => t.id),
    Array.from(
      { length: 25 },
      (_, i) => `CS-${String(i + 1).padStart(3, "0")}`,
    ),
  );
  assert.equal(plan.created.length, 25);
  assert.ok(
    plan.created.every((r) => r.workspaceId === w && r.status === "draft"),
  );
  assert.equal(
    planStrategyTemplates(w, plan.created, new Date()).created.length,
    0,
  );
});
test("customisations and withdrawals retained; unknown existing keys conflict; tenants rejected", () => {
  const w = workspace(),
    records = planStrategyTemplates(w, [], new Date()).created;
  records[0].status = "withdrawn";
  records[1].clauses[0].statement = "A client-specific rule";
  assert.equal(planStrategyTemplates(w, records, new Date()).created.length, 0);
  records[2].source.reference = "existing-policy";
  assert.equal(
    planStrategyTemplates(w, records, new Date()).conflicts.length,
    1,
  );
  assert.throws(
    () => planStrategyTemplates(workspace(), records, new Date()),
    /Workspace mismatch/,
  );
});
test("transactional retry and failure do not partially populate library", async () => {
  const memory = new EnquiryMemoryDb(),
    w = workspace();
  memory.failCollection = "contact_strategy_policies";
  await assert.rejects(() =>
    memory.mongo.withTransaction!((db, s) =>
      initialiseStrategyTemplates(db, s, w, new Date()),
    ),
  );
  assert.equal(memory.rows("contact_strategy_policies").length, 0);
  memory.failCollection = undefined;
  await Promise.all(
    [1, 2].map(() =>
      memory.mongo.withTransaction!((db, s) =>
        initialiseStrategyTemplates(db, s, w, new Date()),
      ),
    ),
  );
  assert.equal(memory.rows("contact_strategy_policies").length, 25);
});
test("legal and suppression restrictions cannot be overridden; unknown assessment defers", () => {
  const w = workspace(),
    records = planStrategyTemplates(w, [], new Date()).created;
  records[0].status = "recorded";
  const context = {
    workspaceId: w,
    evaluatedAt: new Date(),
    legal: "permitted" as const,
    suppression: "clear" as const,
    platform: "permitted" as const,
    assessments: {},
  };
  assert.equal(evaluateContactStrategies(records, context).effect, "deferred");
  assert.equal(
    evaluateContactStrategies(records, {
      ...context,
      suppression: "suppressed",
    }).effect,
    "prohibited",
  );
  assert.equal(
    evaluateContactStrategies(records, { ...context, legal: "prohibited" })
      .executionAuthorised,
    false,
  );
  assert.throws(
    () =>
      evaluateContactStrategies(records, {
        ...context,
        workspaceId: workspace(),
      }),
    /Workspace mismatch/,
  );
});

import { createContactStrategies } from "../src/services/contact-strategy/application";
import { parseConfig } from "../src/config";
import { authEnvironment, testIssuer } from "./helpers/auth";
import { provisionHvmClient } from "../src/services/hvm-provision";
const config = parseConfig({
  ...authEnvironment,
  HVM_COGNITO_CLIENT_ID: "hvmclient",
  DEPLOYMENT_ENV: "test",
  MONGODB_URI: "mongodb://unused.invalid",
});
test("client administrator can review/approve own drafts; foreign actor denied; edits preserve active history", async () => {
  const db = new EnquiryMemoryDb(),
    w = workspace();
  db.rows("schema_versions").push({ _id: "vapp-v1", version: 27 });
  const identity = {
    subject: "client-admin",
    issuer: testIssuer,
    clientId: "hvmclient",
  };
  await provisionHvmClient(
    db.mongo,
    {
      organisationId: generatePlatformId("org"),
      organisationName: "Fixture",
      workspaceId: w,
      management: "client",
      brandId: generatePlatformId("brand"),
      clientMembershipId: generatePlatformId("workspacemembership"),
      workspaceName: "Fixture",
      brandName: "Fixture",
      brandSlug: "fixture",
      human: { type: "human", id: identity.subject, issuer: identity.issuer },
    },
    testIssuer,
  );
  const service = createContactStrategies(config, db.mongo);
  const list = await service.list(identity, w);
  assert.equal(list.policies.length, 25);
  await assert.rejects(() =>
    service.list({ ...identity, subject: "outsider" }, w),
  );
  const approved = await service.mutate(identity, w, {
    key: "cs_001",
    expectedVersion: 1,
    operation: "approve",
  });
  assert.equal(approved.status, "recorded");
  const draft = await service.mutate(identity, w, {
    key: "cs_001",
    expectedVersion: 2,
    operation: "save",
    statement: "Keep acquisition and cross-sell separate.",
  });
  assert.equal(draft.status, "draft");
  assert.equal(
    db.rows("contact_strategy_policies").find((p) => p.id === approved.id)
      ?.status,
    "recorded",
  );
  await assert.rejects(() =>
    service.mutate(identity, w, {
      key: "cs_001",
      expectedVersion: 2,
      operation: "approve",
    }),
  );
  await assert.rejects(() =>
    service.mutate(identity, w, {
      key: "cs_001",
      expectedVersion: 3,
      operation: "remove",
    }),
  );
  const off = await service.mutate(identity, w, {
    key: "cs_001",
    expectedVersion: 3,
    operation: "deactivate",
  });
  assert.equal(off.status, "withdrawn");
  assert.equal(
    planStrategyTemplates(w, db.rows("contact_strategy_policies"), new Date())
      .created.length,
    0,
  );
  assert.equal(
    db.rows("events").filter((e) => e.eventType === "contact_strategy_changed")
      .length,
    3,
  );
});

import { randomUUID } from "node:crypto";
import { InterpretationFailure } from "../src/services/contact-strategy/interpret";
import { recordContactStrategyAssessment } from "../src/services/contact-strategy/decision";
test("Henry deduplicates requests, stores review and usage, preserves policy clauses; decision trace requires approval", async () => {
  const db = new EnquiryMemoryDb(),
    w = workspace();
  db.rows("schema_versions").push({ _id: "vapp-v1", version: 27 });
  const identity = {
    subject: "owner",
    issuer: testIssuer,
    clientId: "hvmclient",
  };
  const human = {
    type: "human" as const,
    id: identity.subject,
    issuer: identity.issuer,
  };
  await provisionHvmClient(
    db.mongo,
    {
      organisationId: generatePlatformId("org"),
      organisationName: "Fixture",
      workspaceId: w,
      management: "client",
      brandId: generatePlatformId("brand"),
      clientMembershipId: generatePlatformId("workspacemembership"),
      workspaceName: "Fixture",
      brandName: "Fixture",
      brandSlug: "fixture",
      human,
    },
    testIssuer,
  );
  let calls = 0;
  const usage = { model: "fixture", inputTokens: 100, outputTokens: 50 };
  const service = createContactStrategies(config, db.mongo, async () => {
    calls++;
    return {
      proposal: {
        statement: "Do not cross-sell within 30 days of purchase.",
        explanation: "Product-specific cooling-off",
        conflicts: [],
        questions: ["Confirm the purchase event"],
      },
      usage,
    };
  });
  const input = {
    key: "cs_004",
    requestKey: randomUUID(),
    instruction: "Wait 30 days after purchase before cross-selling",
  };
  const result = await service.propose(identity, w, input);
  assert.deepEqual(await service.propose(identity, w, input), result);
  assert.equal(calls, 1);
  assert.equal((await service.list(identity, w)).reviews.length, 1);
  assert.equal(db.rows("contact_strategy_policies").length, 25);
  const row = db
    .rows("contact_strategy_policies")
    .find((p) => p.key === "cs_004")!;
  row.clauses.push({
    key: "exception",
    category: "contact",
    statement: "Always honour suppression",
    evidence: [],
  });
  const saved = await service.mutate(identity, w, {
    key: "cs_004",
    expectedVersion: 1,
    operation: "save",
    statement: result.statement,
  });
  assert.equal(saved.clauses.length, 2);
  const approved = await service.mutate(identity, w, {
    key: "cs_004",
    expectedVersion: 2,
    operation: "approve",
  });
  const context = {
    workspaceId: w,
    evaluatedAt: new Date(),
    target: {
      productId: generatePlatformId("product"),
      channel: "email",
      purpose: "marketing" as const,
      actionId: "fixture-action",
    },
    legal: "permitted" as const,
    suppression: "clear" as const,
    platform: "permitted" as const,
    assessments: {
      [approved.id]: {
        policyId: approved.id,
        version: approved.version,
        applies: true,
        effect: "deferred" as const,
        reason: "Purchase was 10 days ago",
        evidenceIds: ["fixture-transaction"],
      },
    },
  };
  const decision = await db.mongo.withTransaction!((d, s) =>
    recordContactStrategyAssessment(d, s, context, human),
  );
  assert.equal(decision.effect, "deferred");
  assert.equal(decision.executionAuthorised, false);
  assert.equal(
    db.rows("events").filter((e) => e.eventType === "contact_strategy_assessed")
      .length,
    1,
  );
  const failed = createContactStrategies(config, db.mongo, async () => {
    throw new InterpretationFailure(usage);
  });
  await assert.rejects(() =>
    failed.propose(identity, w, { ...input, requestKey: randomUUID() }),
  );
  assert.deepEqual(
    db.rows("events").find((e) => e.payload.status === "failed")?.payload.usage,
    usage,
  );
  await assert.rejects(() =>
    service.propose({ ...identity, subject: "outsider" }, w, {
      ...input,
      requestKey: randomUUID(),
    }),
  );
  assert.equal(calls, 1);
});

import { EventInsertSchema } from "../src/domain/schemas";
test("generic event creation cannot forge strategy approval, interpretation or decision receipts", () => {
  assert.equal(
    EventInsertSchema.safeParse({
      id: generatePlatformId("event"),
      workspaceId: workspace(),
      eventType: "ordinary_test",
      occurredAt: new Date(),
      source: { system: "fixture" },
      payload: {},
    }).success,
    true,
  );
  for (const eventType of [
    "contact_strategy_definition",
    "contact_strategy_changed",
    "contact_strategy_interpretation",
    "contact_strategy_assessed",
  ]) {
    assert.equal(
      EventInsertSchema.safeParse({
        id: generatePlatformId("event"),
        workspaceId: workspace(),
        eventType,
        occurredAt: new Date(),
        source: { system: "contact_strategy" },
        payload: { operation: "approve" },
      }).success,
      false,
    );
  }
});

test("custom strategy survives reload, refines without approval, versions and enforces tenant authority", async () => {
  const db = new EnquiryMemoryDb(), w = workspace();
  db.rows("schema_versions").push({_id:"vapp-v1",version:27});
  const identity={subject:"custom-admin",issuer:testIssuer,clientId:"hvmclient"};
  await provisionHvmClient(db.mongo,{
    organisationId:generatePlatformId("org"),organisationName:"Custom fixture",workspaceId:w,
    management:"client",brandId:generatePlatformId("brand"),clientMembershipId:generatePlatformId("workspacemembership"),
    workspaceName:"Custom fixture",brandName:"Custom fixture",brandSlug:"custom-fixture",
    human:{type:"human",id:identity.subject,issuer:identity.issuer},
  },testIssuer);
  let received: any;
  const service=createContactStrategies(config,db.mongo,async input=>{
    received=input;
    return {proposal:{statement:"Pause inactive accounts until they request help.",explanation:"Clarified intent",conflicts:[],questions:[]},usage:{model:"fixture",inputTokens:1,outputTokens:1}};
  });
  const key=`custom_${randomUUID().replaceAll("-", "")}`;
  const proposed=await service.propose(identity,w,{key,name:"Inactive accounts",instruction:"Do not bother inactive accounts",requestKey:randomUUID()});
  assert.equal(received.template.name,"Inactive accounts");
  assert.equal((await service.list(identity,w)).policies.filter(p=>p.key===key).length,0);
  const input={key,name:"Inactive accounts",statement:proposed.statement,expectedVersion:0,operation:"save"};
  await assert.rejects(()=>service.mutate({...identity,subject:"outsider"},w,input));
  const saved=await service.mutate(identity,w,input);
  assert.equal(saved.status,"draft");
  const reloaded=await service.list(identity,w);
  assert.equal(reloaded.templates.find(t=>t.key===key)?.name,"Inactive accounts");
  assert.equal(reloaded.policies.find(p=>p.id===saved.id)?.clauses[0].statement,proposed.statement);
  await assert.rejects(()=>service.mutate(identity,w,input),/changed/);
  assert.equal(db.rows("events").filter(e=>e.eventType==="contact_strategy_definition").length,1);
  const approved=await service.mutate(identity,w,{key,expectedVersion:1,operation:"approve"});
  assert.equal(approved.status,"recorded");
  await assert.rejects(()=>service.mutate(identity,w,{key,expectedVersion:2,operation:"remove"}),/Deactivate/);
  const edited=await service.mutate(identity,w,{key,expectedVersion:2,operation:"save",statement:"Only respond to inbound requests."});
  assert.equal(edited.status,"draft");
  assert.equal(db.rows("contact_strategy_policies").find(p=>p.id===approved.id)?.status,"recorded");
  await service.mutate(identity,w,{key,expectedVersion:3,operation:"deactivate"});
  const removed=await service.mutate(identity,w,{key,expectedVersion:4,operation:"remove"});
  assert.equal(removed.status,"withdrawn");
});

test("approved reader requires matching tenant approval evidence and retains approved predecessors", async () => {
  const { readApprovedContactStrategies } = await import("../src/services/contact-strategy/current");
  const db = new EnquiryMemoryDb(), w = workspace();
  const p = planStrategyTemplates(w, [], new Date()).created[0];
  p.status = "recorded";
  db.rows("contact_strategy_policies").push(p);
  assert.deepEqual((await readApprovedContactStrategies(db as any, w)).missingApproval, [p.id]);
  db.rows("events").push({workspaceId:workspace(), eventType:"contact_strategy_changed", payload:{operation:"approve",policyId:p.id,version:p.version}});
  assert.equal((await readApprovedContactStrategies(db as any, w)).approved.length, 0);
  db.rows("events").push({workspaceId:w, eventType:"contact_strategy_changed", payload:{operation:"approve",policyId:p.id,version:p.version}});
  db.rows("contact_strategy_policies").push({...p,id:generatePlatformId("contactstrategy"),version:2,status:"draft"});
  assert.deepEqual((await readApprovedContactStrategies(db as any, w)).approved.map(r=>r.id), [p.id]);
  db.rows("contact_strategy_policies").push({...p,id:generatePlatformId("contactstrategy"),version:3,status:"withdrawn"});
  assert.deepEqual((await readApprovedContactStrategies(db as any, w)).approved, []);
});
