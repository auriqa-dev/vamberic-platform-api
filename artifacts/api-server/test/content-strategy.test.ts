import { assetReuseEligibility } from "../src/services/content-strategy/execution";
import { ActionTypeSchema, actionTypeHash } from "../src/domain/action-library";
import { initialiseContentTypes } from "../src/services/content-strategy/catalogue";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  createContentStrategy,
  currentRecords,
} from "../src/services/content-strategy/application";
import {
  assetData,
  resultSchemas,
  briefData,
  strategyData,
  actionData,
} from "../src/services/content-strategy/model";
import {
  robotsAllowed,
  pageMetadata,
} from "../src/services/content-strategy/discovery";
import {
  outputSchema,
  omitOptionalNulls,
} from "../src/services/content-strategy/generate";
import { generatePlatformId, EventInsertSchema } from "../src/domain";
import { EnquiryMemoryDb } from "./helpers/enquiry-db";
import { parseConfig } from "../src/config";
import { authEnvironment, testIssuer } from "./helpers/auth";
import { provisionHvmClient } from "../src/services/hvm-provision";
const config = parseConfig({
  ...authEnvironment,
  HVM_COGNITO_CLIENT_ID: "hvmclient",
  DEPLOYMENT_ENV: "test",
  MONGODB_URI: "mongodb://unused.invalid",
});
async function setup() {
  const db = new EnquiryMemoryDb(),
    w = generatePlatformId("workspace"),
    brand = generatePlatformId("brand"),
    identity = { subject: "owner", issuer: testIssuer, clientId: "hvmclient" };
  db.rows("schema_versions").push({ _id: "vapp-v1", version: 28 });
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
  const service = createContentStrategy(config, db.mongo);
  const asset = assetData.parse({
    title: "Source",
    classification: "core",
    assetType: "article",
    channel: "",
    url: "",
    text: "Supported methodology evidence.",
    description: "Methodology",
    sourceDocumentId: "",
    sourceAssetIds: [],
    scope: { brandId: brand, products: [], offers: [], audiences: [] },
    topics: [],
    buyerStages: [],
    claims: [],
    evidence: [],
    gaps: [],
    reuse: [],
    restrictions: [],
    analysisStatus: "not_analysed",
  });
  return { db, w, brand, identity, service, asset };
}
test("workspace CRUD preserves approvals, rejects stale updates and foreign actors", async () => {
  const { w, identity, service, asset } = await setup();
  const input = {
    kind: "asset",
    operation: "save",
    expectedVersion: 0,
    data: asset,
    requestKey: randomUUID(),
  };
  const saved = await service.mutate(identity, w, input);
  assert.equal(saved.status, "draft");
  assert.equal((await service.mutate(identity, w, input)).id, saved.id);
  await assert.rejects(() =>
    service.mutate({ ...identity, subject: "foreign" }, w, {
      ...input,
      requestKey: randomUUID(),
    }),
  );
  const approved = await service.mutate(identity, w, {
    kind: "asset",
    id: saved.id,
    expectedVersion: 1,
    operation: "approve",
    requestKey: randomUUID(),
  });
  assert.equal(approved.status, "approved");
  await assert.rejects(() =>
    service.mutate(identity, w, {
      ...input,
      id: saved.id,
      expectedVersion: 1,
      requestKey: randomUUID(),
    }),
  );
  const revised = await service.mutate(identity, w, {
    ...input,
    id: saved.id,
    expectedVersion: 2,
    data: { ...asset, title: "Changed" },
    requestKey: randomUUID(),
  });
  assert.equal(revised.status, "draft");
  assert.equal((await service.history(identity, w, saved.id)).length, 3);
});
test("source dependencies prevent deletion and cross-workspace lineage is rejected", async () => {
  const { w, identity, service, asset } = await setup();
  const saved = await service.mutate(identity, w, {
    kind: "asset",
    operation: "save",
    expectedVersion: 0,
    data: asset,
    requestKey: randomUUID(),
  });
  await service.mutate(identity, w, {
    kind: "asset",
    operation: "save",
    expectedVersion: 0,
    data: { ...asset, title: "Derivative", sourceAssetIds: [saved.id] },
    requestKey: randomUUID(),
  });
  await assert.rejects(
    () =>
      service.mutate(identity, w, {
        id: saved.id,
        kind: "asset",
        operation: "remove",
        expectedVersion: 1,
        requestKey: randomUUID(),
      }),
    /dependants/,
  );
  await assert.rejects(
    () =>
      service.mutate(identity, w, {
        kind: "asset",
        operation: "save",
        expectedVersion: 0,
        data: {
          ...asset,
          title: "Foreign",
          sourceAssetIds: [generatePlatformId("event")],
        },
        requestKey: randomUUID(),
      }),
    /source asset/,
  );
});
test("website metadata uses safe same-site links and robots deny rules", () => {
  assert.equal(
    robotsAllowed(
      "User-agent: *\nDisallow: /private\nAllow: /private/public",
      "/private/a",
    ),
    false,
  );
  assert.equal(
    robotsAllowed(
      "User-agent: *\nDisallow: /private\nAllow: /private/public",
      "/private/public",
    ),
    true,
  );
  const p = pageMetadata(
    '<title>Example</title><nav>Cookie links</nav><main><h1>Research</h1><p>Evidence.</p><a href="/guide">Guide</a><a href="http://127.0.0.1/">Unsafe</a></main>',
    "https://example.com/",
  );
  assert.equal(p.title, "Example");
  assert.ok(!p.text.includes("Cookie links"));
  assert.deepEqual(p.links, ["https://example.com/guide"]);
  assert.deepEqual(p.headings, ["Research"]);
});
test("generation output contract is closed and record reduction preserves latest revisions", () => {
  const out = outputSchema(assetData);
  assert.equal(out.additionalProperties, false);
  assert.ok((out.required as string[]).includes("sourceMetadata"));
  const base = {
    id: "x",
    kind: "asset",
    status: "draft",
    data: {},
    updatedAt: new Date().toISOString(),
    fingerprint: "h",
  };
  assert.equal(
    currentRecords([
      { payload: { record: { ...base, version: 2 } } },
      { payload: { record: { ...base, version: 1 } } },
    ])[0].version,
    2,
  );
});
test("generic event writes cannot forge Content Strategy records or approvals", () => {
  for (const eventType of [
    "content_strategy_record",
    "content_strategy_generation",
    "content_strategy_handoff",
  ]) {
    assert.equal(
      EventInsertSchema.safeParse({
        id: generatePlatformId("event"),
        workspaceId: generatePlatformId("workspace"),
        eventType,
        occurredAt: new Date(),
        source: { system: "fixture" },
        payload: {},
      }).success,
      false,
    );
  }
});

function brief(scope: unknown, ids: string[]) {
  return briefData.parse({
    title: "Website guide production",
    actionId: "",
    scope,
    classification: "channel",
    format: "article",
    channel: "website",
    objective: "Explain the evidence",
    audience: "Buyers",
    buyerQuestion: "How does it work?",
    buyerStage: "Evaluation",
    messages: ["Evidence before claims"],
    evidence: [],
    sourceAssetIds: ids,
    structure: [],
    preserve: [],
    mayChange: [],
    cta: "Learn more",
    restrictions: [],
    approvalRequirements: ["Human review"],
    personalisation: {
      objective: "",
      depth: "LIGHT",
      allowedContext: [],
      requiredContext: [],
      evidenceSources: [],
      maximumAgeDays: null,
      opening: "",
      coreMessage: "",
      variations: [],
      prohibitedAssumptions: [],
      fallback: "Use general wording",
      length: "",
      sendingRequirements: [],
    },
  });
}
const saveInput = (kind: string, data: unknown) => ({
  kind,
  operation: "save",
  expectedVersion: 0,
  data,
  requestKey: randomUUID(),
});
test("manual production pins approved brief and keeps returned assets unapproved", async () => {
  const { w, identity, service, asset } = await setup();
  const source = await service.mutate(identity, w, saveInput("asset", asset));
  const draft = await service.mutate(
    identity,
    w,
    saveInput("brief", brief(asset.scope, [source.id])),
  );
  await assert.rejects(
    () => service.exportBrief(identity, w, draft.id),
    /Approve/,
  );
  const approved = await service.mutate(identity, w, {
    id: draft.id,
    kind: "brief",
    expectedVersion: 1,
    operation: "approve",
    requestKey: randomUUID(),
  });
  const contract = await service.exportBrief(identity, w, approved.id);
  assert.equal(contract.contract, "hvm.execution-brief.v1");
  assert.equal(contract.execution.automaticExecution, false);
  assert.equal(contract.returnContract.publicationAuthorised, false);
  const returned = await service.mutate(
    identity,
    w,
    saveInput("asset", {
      ...asset,
      title: "Produced result",
      text: "New returned copy",
      sourceMetadata: {
        ...asset.sourceMetadata,
        briefId: approved.id,
        briefVersion: approved.version,
        producer: "Human studio",
      },
    }),
  );
  assert.equal(returned.status, "draft");
  await assert.rejects(
    () =>
      service.mutate(
        identity,
        w,
        saveInput("asset", {
          ...asset,
          sourceMetadata: {
            ...asset.sourceMetadata,
            briefId: approved.id,
            briefVersion: 1,
            producer: "Human studio",
          },
        }),
      ),
    /approved brief/,
  );
  await service.mutate(identity, w, {
    ...saveInput("asset", { ...asset, text: "Changed source" }),
    id: source.id,
    expectedVersion: 1,
  });
  await assert.rejects(
    () => service.exportBrief(identity, w, approved.id),
    /changed/,
  );
  assert.equal(
    (await service.list(identity, w)).records.find((r) => r.id === approved.id)
      ?.needsReview,
    true,
  );
});
test("changed sources block approval and dependency cycles cannot be saved", async () => {
  const { w, identity, service, asset } = await setup();
  const a = await service.mutate(identity, w, saveInput("asset", asset));
  const b = await service.mutate(
    identity,
    w,
    saveInput("asset", {
      ...asset,
      title: "Derived",
      text: "Derivative text",
      sourceAssetIds: [a.id],
    }),
  );
  await assert.rejects(
    () =>
      service.mutate(identity, w, {
        ...saveInput("asset", { ...asset, sourceAssetIds: [b.id] }),
        id: a.id,
        expectedVersion: 1,
      }),
    /cycle/,
  );
  await service.mutate(identity, w, {
    ...saveInput("asset", { ...asset, text: "Revised" }),
    id: a.id,
    expectedVersion: 1,
  });
  await assert.rejects(
    () =>
      service.mutate(identity, w, {
        id: b.id,
        kind: "asset",
        operation: "approve",
        expectedVersion: 1,
        requestKey: randomUUID(),
      }),
    /changed/,
  );
  // Removal remains possible even after a dependency changes.
  await service.mutate(identity, w, {
    id: b.id,
    kind: "asset",
    operation: "remove",
    expectedVersion: 1,
    requestKey: randomUUID(),
  });
});
test("generation preserves usage on stale completion and caches identical analysis", async () => {
  const { db, w, identity, service, asset } = await setup();
  const source = await service.mutate(identity, w, saveInput("asset", asset));
  let calls = 0;
  const generator = async () => {
    calls++;
    return {
      result: asset,
      usage: { model: "fixture", inputTokens: 10, outputTokens: 10 },
    };
  };
  const generated = createContentStrategy(config, db.mongo, generator);
  const input = {
    task: "analyse",
    scope: asset.scope,
    instruction: "Classify",
    recordIds: [source.id],
    requestKey: randomUUID(),
  };
  await generated.propose(identity, w, input);
  await generated.propose(identity, w, { ...input, requestKey: randomUUID() });
  assert.equal(calls, 1);
  const stale = createContentStrategy(config, db.mongo, async () => {
    await service.mutate(identity, w, {
      ...saveInput("asset", { ...asset, text: "Revised during generation" }),
      id: source.id,
      expectedVersion: 1,
    });
    return generator();
  });
  await assert.rejects(
    () =>
      stale.propose(identity, w, {
        ...input,
        instruction: "Recheck",
        requestKey: randomUUID(),
      }),
    /changed/,
  );
  const failed = db
    .rows("events")
    .find(
      (e) =>
        e.eventType === "content_strategy_generation" &&
        e.payload.status === "failed",
    );
  assert.equal(failed?.payload.usage.inputTokens, 10);
});

test("canonical Action Library handoff reuses a draft and retires it with its recommendation", async () => {
  const { db, w, identity, service, asset } = await setup();
  await assert.rejects(() =>
    initialiseContentTypes(config, db.mongo, identity),
  );
  const actor = {
      type: "human",
      id: identity.subject,
      issuer: identity.issuer,
    },
    now = new Date();
  const typeData = {
    name: "Create content",
    description: "Produce a reviewed draft",
    capabilityIds: [],
  };
  const type = ActionTypeSchema.parse({
    id: generatePlatformId("actiontype"),
    key: "content_creation",
    version: 1,
    data: typeData,
    contentHash: actionTypeHash({
      key: "content_creation",
      version: 1,
      data: typeData,
    }),
    status: "active",
    availability: "queens",
    createdAt: now,
    updatedAt: now,
    createdBy: actor,
    updatedBy: actor,
    archived: false,
    schemaVersion: 1,
  });
  db.rows("action_types").push(type);
  const strategy = await service.mutate(
    identity,
    w,
    saveInput(
      "strategy",
      strategyData.parse({
        title: "Strategy",
        scope: asset.scope,
        context: {
          objectives: [],
          priorities: [],
          constraints: [],
          channels: [],
          timeHorizon: "",
          measurement: [],
          questions: [],
        },
        assessment: "Use evidence",
        strengths: [],
        gaps: [],
        priorities: [],
        coverage: [],
        recommendations: [],
        sourceRecordIds: [],
        changes: [],
        limitations: [],
      }),
    ),
  );
  const action = actionData.parse({
    key: "guide",
    title: "Make a guide",
    kind: "create",
    rationale: "Answer buyer questions",
    priority: "high",
    feasibility: "READY",
    dependencies: [],
    evidence: [],
    sourceAssetIds: [],
    buyerQuestions: [],
    buyerStages: [],
    effort: "Small",
    contribution: "Explain value",
    alternative: "",
    strategyId: strategy.id,
    strategyRevision: strategy.version,
    owner: "",
    decisionReason: "",
    progress: "proposed",
    actionDefinitionId: "",
  });
  const rec = await service.mutate(identity, w, saveInput("action", action));
  const handoff = {
    id: rec.id,
    expectedVersion: rec.version,
    actionTypeId: type.id,
  };
  const first = await service.handoff(identity, w, handoff);
  assert.equal((await service.handoff(identity, w, handoff)).id, first.id);
  const next = await service.mutate(identity, w, {
    ...saveInput("action", { ...action, title: "Revise the guide" }),
    id: rec.id,
    expectedVersion: 1,
  });
  assert.equal(
    (
      await service.handoff(identity, w, {
        ...handoff,
        expectedVersion: next.version,
      })
    ).id,
    first.id,
  );
  assert.equal(db.rows("action_definitions").length, 1);
  assert.equal(
    db.rows("action_definitions")[0].definition.name,
    "Revise the guide",
  );
  await service.mutate(identity, w, {
    id: rec.id,
    kind: "action",
    operation: "remove",
    expectedVersion: next.version,
    requestKey: randomUUID(),
  });
  assert.equal(db.rows("action_definitions")[0].status, "retired");
});

test("external delivery pins approved work and records assets and outcome evidence", async () => {
  const { db, w, identity, service, asset } = await setup();
  const strategy = await service.mutate(
    identity,
    w,
    saveInput("strategy", {
      title: "Authority strategy",
      scope: asset.scope,
      context: {
        objectives: [],
        priorities: [],
        constraints: [],
        channels: [],
        timeHorizon: "",
        measurement: [],
        questions: [],
      },
      assessment: "PR opportunity",
      strengths: [],
      gaps: [],
      priorities: [],
      coverage: [],
      recommendations: [],
      sourceRecordIds: [],
      changes: [],
      limitations: [],
    }),
  );
  const action = await service.mutate(
    identity,
    w,
    saveInput("action", {
      key: "pr",
      title: "Editorial coverage",
      kind: "other",
      rationale: "Relevant audience",
      priority: "medium",
      feasibility: "READY",
      dependencies: [],
      evidence: [],
      sourceAssetIds: [],
      buyerQuestions: [],
      buyerStages: [],
      effort: "Agency",
      contribution: "Authority",
      alternative: "",
      strategyId: strategy.id,
      strategyRevision: strategy.version,
      owner: "Queen",
      decisionReason: "",
      progress: "proposed",
      actionDefinitionId: "",
    }),
  );
  const approve = (r: { id: string; kind: string; version: number }) =>
    service.mutate(identity, w, {
      id: r.id,
      kind: r.kind,
      expectedVersion: r.version,
      operation: "approve",
      requestKey: randomUUID(),
    });
  await approve(action);
  const b = await service.mutate(
    identity,
    w,
    saveInput("brief", {
      ...brief(asset.scope, []),
      actionId: action.id,
      briefType: "pr",
      workDescription: "Seek relevant coverage",
      deliverables: ["Coverage report"],
      completionCriteria: ["Report delivered"],
      successMeasures: ["Relevant coverage"],
    }),
  );
  const approvedBrief = await approve(b);
  const resource = await service.mutate(
    identity,
    w,
    saveInput("executor", {
      scope: asset.scope,
      title: "PR specialist",
      executorType: "external_agency",
      capabilities: ["Media relations"],
      capabilityIds: [],
      integrationId: "",
      contactDetails: "",
      constraints: [],
      available: true,
    }),
  );
  const assignment = {
    scope: asset.scope,
    title: "PR delivery",
    briefId: b.id,
    briefVersion: approvedBrief.version,
    executorId: resource.id,
    progress: "assigned",
    externalReference: "Manual",
    notes: "",
    completedAt: "",
  };
  await assert.rejects(
    () => service.mutate(identity, w, saveInput("execution", assignment)),
    /Library/,
  );
  const libraryId = generatePlatformId("actiondefinition");
  db.rows("action_definitions").push({
    id: libraryId,
    workspaceId: w,
    archived: false,
    status: "draft",
  });
  db.rows("events").push({
    id: generatePlatformId("event"),
    workspaceId: w,
    eventType: "content_strategy_handoff",
    createdAt: new Date(),
    payload: { recordId: action.id, definitionId: libraryId },
  });
  const execution = await service.mutate(
    identity,
    w,
    saveInput("execution", assignment),
  );
  assert.equal(execution.data.actionDefinitionId, libraryId);
  await assert.rejects(
    () =>
      service.mutate(identity, w, {
        ...saveInput("execution", { ...execution.data, executorId: "foreign" }),
        id: execution.id,
        expectedVersion: execution.version,
      }),
    /unavailable|Cancel this assignment/,
  );
  await assert.rejects(
    () =>
      service.mutate(
        identity,
        w,
        saveInput("executor", { ...resource.data, integrationId: "fake" }),
      ),
    /not software integrations/,
  );
  await assert.rejects(
    () =>
      service.mutate(
        identity,
        w,
        saveInput("executor", {
          ...resource.data,
          executorType: "external_application",
          integrationId: "fake",
        }),
      ),
    /connected application/,
  );
  const result = await service.mutate(
    identity,
    w,
    saveInput("asset", {
      ...asset,
      title: "Published article",
      url: "https://publication.example/article",
      sourceMetadata: {
        ...asset.sourceMetadata,
        executionId: execution.id,
        briefId: b.id,
        briefVersion: approvedBrief.version,
        producer: "PR specialist",
        publication: "Example publication",
        publicationDate: "2026-10-09",
      },
      restrictions: ["Review rights before reuse"],
    }),
  );
  assert.equal(result.status, "draft");
  const done = await service.mutate(identity, w, {
    ...saveInput("execution", {
      ...execution.data,
      progress: "completed",
      completedAt: new Date().toISOString(),
    }),
    id: execution.id,
    expectedVersion: execution.version,
  });
  const outcome = await service.mutate(
    identity,
    w,
    saveInput("effectiveness", {
      scope: asset.scope,
      title: "Coverage observed",
      category: "engagement",
      assetId: result.id,
      executionId: execution.id,
      metric: "Coverage relevance",
      value: "Relevant article; impact unmeasured",
      observedAt: new Date().toISOString(),
      source: "https://publication.example/article",
      limitations: "No attribution",
      eventIds: [result.evidenceEventId],
      opportunities: ["Review reuse"],
    }),
  );
  assert.ok(
    db
      .rows("events")
      .some(
        (e) => e.id === outcome.evidenceEventId && e.payload.observationOnly,
      ),
  );
  assert.equal(
    (await service.list(identity, w)).records.find((r) => r.id === result.id)
      ?.status,
    "draft",
  );
  await assert.rejects(
    () =>
      service.mutate(identity, w, {
        ...saveInput("execution", {
          ...done.data,
          progress: "in_progress",
          completedAt: "",
        }),
        id: done.id,
        expectedVersion: done.version,
      }),
    /cannot be restarted/,
  );
  await assert.rejects(
    () =>
      service.mutate(identity, w, {
        id: resource.id,
        kind: "executor",
        expectedVersion: resource.version,
        operation: "remove",
        requestKey: randomUUID(),
      }),
    /referenced/,
  );
});

test("externally published assets still need rights and approval for downstream use", () => {
  const r = {
    id: "asset",
    version: 1,
    kind: "asset" as const,
    status: "draft" as const,
    updatedAt: new Date().toISOString(),
    fingerprint: "x",
    sourceVersions: [],
    data: {
      usageRights: "licensed",
      allowedUses: ["Reference public coverage"],
      url: "https://example.com/article",
    },
  };
  assert.equal(assetReuseEligibility(r, []).eligible, false);
  assert.equal(
    assetReuseEligibility({ ...r, status: "approved" }, []).eligible,
    true,
  );
  assert.equal(
    assetReuseEligibility(
      { ...r, status: "approved", data: { ...r.data, usageRights: "unknown" } },
      [],
    ).eligible,
    false,
  );
  assert.equal(
    assetReuseEligibility(
      {
        ...r,
        status: "approved",
        sourceVersions: [{ id: "missing", version: 1 }],
      },
      [],
    ).eligible,
    false,
  );
});

test("Henry keeps private conversation continuity without mutating or approving records", async () => {
  const { db, w, identity, asset } = await setup();
  const seen: unknown[] = [];
  const service = createContentStrategy(
    config,
    db.mongo,
    async (_task, input) => {
      seen.push(input);
      return {
        result: {
          reply:
            "We can prepare a brief using your evidence. Nothing has been approved.",
          strategy: null,
          brief: null,
          reviewRecordId: "",
        },
        usage: { model: "fixture", inputTokens: 10, outputTokens: 20 },
      };
    },
  );
  const input = {
    task: "henry",
    scope: asset.scope,
    instruction: "Help with editorial coverage",
    conversationId: randomUUID(),
    recordIds: [],
    requestKey: randomUUID(),
  };
  await service.propose(identity, w, input);
  await service.propose(identity, w, input);
  assert.equal(seen.length, 1, "retry does not execute the model again");
  const first = (await service.list(identity, w)).conversations;
  assert.equal(first.length, 1);
  assert.equal(
    (await service.list(identity, w)).proposals.length,
    0,
    "private turns are not shared proposals",
  );
  // Another user's transcript in the same workspace must not enter this conversation.
  const e = db
    .rows("events")
    .find((e) => e.payload?.conversationId === input.conversationId)!;
  db.rows("events").push({
    ...structuredClone(e),
    id: generatePlatformId("event"),
    createdBy: { ...e.createdBy, id: "other" },
    payload: { ...e.payload, instruction: "Private other-user objective" },
  });
  await service.propose(identity, w, {
    ...input,
    instruction: "What should we do first?",
    requestKey: randomUUID(),
  });
  const next = seen[1] as { conversation: { user: string }[] };
  assert.deepEqual(
    next.conversation.map((t) => t.user),
    [input.instruction],
  );
  assert.equal((await service.list(identity, w)).conversations.length, 2);
  assert.equal((await service.list(identity, w)).records.length, 0);
  await assert.rejects(
    service.propose({ ...identity, subject: "outsider" }, w, {
      ...input,
      requestKey: randomUUID(),
    }),
  );
});

test("Henry rejects invented review targets and wrong-scope or stale refinements", async () => {
  const { db, w, identity, asset } = await setup();
  let calls = 0;
  const service = createContentStrategy(config, db.mongo, async () => {
    calls++;
    return {
      result: {
        reply: "Review this",
        strategy: null,
        brief: null,
        reviewRecordId: "invented",
      },
      usage: { model: "fixture", inputTokens: 10, outputTokens: 20 },
    };
  });
  const input = {
    task: "henry",
    scope: asset.scope,
    instruction: "Approve the strategy",
    conversationId: randomUUID(),
    recordIds: [],
    requestKey: randomUUID(),
  };
  await assert.rejects(service.propose(identity, w, input), /unavailable/);
  const strategy = strategyData.parse({
    title: "Draft",
    scope: { ...asset.scope, brandId: generatePlatformId("brand") },
    context: {
      objectives: [],
      priorities: [],
      constraints: [],
      channels: [],
      timeHorizon: "",
      measurement: [],
      questions: [],
    },
    assessment: "Use evidence",
    strengths: [],
    gaps: [],
    priorities: [],
    coverage: [],
    recommendations: [],
    sourceRecordIds: [],
    changes: [],
    limitations: [],
  });
  await assert.rejects(
    service.propose(identity, w, {
      ...input,
      requestKey: randomUUID(),
      draft: { kind: "strategy", data: strategy, recordId: "", version: 0 },
    }),
    /different scope/,
  );
  strategy.scope = asset.scope;
  await assert.rejects(
    service.propose(identity, w, {
      ...input,
      requestKey: randomUUID(),
      draft: {
        kind: "strategy",
        data: strategy,
        recordId: "missing",
        version: 1,
      },
    }),
    /record changed/,
  );
  assert.equal(calls, 1);
});

test("Henry refines the supplied draft and normalises proposal scope without saving it", async () => {
  const { db, w, identity, asset, service: recordsService } = await setup();
  const strategy = strategyData.parse({
    title: "Editorial strategy",
    scope: asset.scope,
    context: {
      objectives: ["Build authority"],
      priorities: [],
      constraints: [],
      channels: [],
      timeHorizon: "",
      measurement: [],
      questions: [],
    },
    assessment: "Use evidence",
    strengths: [],
    gaps: [],
    priorities: [],
    coverage: [],
    recommendations: [],
    sourceRecordIds: [],
    changes: [],
    limitations: [],
  });
  const saved = await recordsService.mutate(
    identity,
    w,
    saveInput("strategy", strategy),
  );
  const service = createContentStrategy(
    config,
    db.mongo,
    async (_task, raw) => {
      const input = raw as { currentDraft: { data: { assessment: string } } };
      assert.equal(input.currentDraft.data.assessment, "My direct edit");
      return {
        result: {
          reply: "Here is a refinement for review.",
          strategy: {
            ...strategy,
            assessment: "Refined draft",
            scope: { ...asset.scope, brandId: generatePlatformId("brand") },
          },
          brief: null,
          reviewRecordId: "",
        },
        usage: { model: "fixture", inputTokens: 10, outputTokens: 20 },
      };
    },
  );
  const result = await service.propose(identity, w, {
    task: "henry",
    scope: asset.scope,
    instruction: "Refine this",
    conversationId: randomUUID(),
    requestKey: randomUUID(),
    recordIds: [saved.id],
    draft: {
      kind: "strategy",
      data: { ...strategy, assessment: "My direct edit" },
      recordId: saved.id,
      version: saved.version,
    },
  });
  assert.ok("strategy" in result && result.strategy);
  assert.equal(result.strategy.scope.brandId, asset.scope.brandId);
  const persisted = (await service.list(identity, w)).records.find(
    (r) => r.id === saved.id,
  )!;
  assert.equal(persisted.version, saved.version);
  assert.equal(persisted.data.assessment, "Use evidence");
  assert.deepEqual((await service.list(identity, w)).conversations[0]?.target, {
    id: saved.id,
    version: saved.version,
    kind: "strategy",
  });
});

test("Library discovery and planning are tenant scoped and initial discovery requests are idempotent", async () => {
  const { createLibrary } =
    await import("../src/services/content-strategy/library");
  const { db, w, brand, identity } = await setup();
  const library = createLibrary(config, db.mongo);
  const input = {
    brandId: brand,
    url: "https://example.com/",
    requestKey: randomUUID(),
  };
  const first = await library.start(identity, w, input);
  assert.equal((await library.start(identity, w, input)).id, first.id);
  assert.equal((await library.list(identity, w)).length, 1);
  await assert.rejects(() =>
    library.start(identity, w, { ...input, url: "https://other.example/" }),
  );
  await assert.rejects(() =>
    library.list({ ...identity, subject: "foreign" }, w),
  );
  await assert.rejects(() =>
    library.planning(identity, generatePlatformId("workspace")),
  );
  db.rows("schema_versions")[0]!.version = 27;
  await assert.rejects(
    () => library.start(identity, w, { ...input, requestKey: randomUUID() }),
    /database update/,
  );
});

test("private originals link once and original revision changes require renewed review", async () => {
  const { db, w, brand, identity, service, asset } = await setup();
  const id = generatePlatformId("event");
  db.rows("events").push({
    id,
    workspaceId: w,
    eventType: "research_document",
    createdAt: new Date(),
    createdBy: { id: identity.subject },
    payload: { filename: "private.pdf", status: "ready", revision: 1 },
  });
  const input = {
    kind: "asset",
    operation: "save",
    expectedVersion: 0,
    data: {
      ...asset,
      sourceDocumentId: id,
      sourceDocumentRevision: 1,
      visibility: "private",
    },
    requestKey: randomUUID(),
  };
  const saved = await service.mutate(identity, w, input);
  const repeat = await service.mutate(identity, w, {
    ...input,
    requestKey: randomUUID(),
  });
  assert.equal(saved.id, repeat.id);
  assert.equal(saved.status, "draft");
  db.rows("events").find((e) => e.id === id)!.payload.revision = 2;
  await assert.rejects(
    () =>
      service.mutate(identity, w, {
        kind: "asset",
        id: saved.id,
        expectedVersion: saved.version,
        operation: "approve",
        requestKey: randomUUID(),
      }),
    /original document changed/,
  );
  assert.equal((saved.data.scope as { brandId: string }).brandId, brand);
});

test("full Library text survives compact event storage, editing and metadata changes", async () => {
  const { createLibrary } =
    await import("../src/services/content-strategy/library");
  const { db, w, identity, service, asset } = await setup(),
    library = createLibrary(config, db.mongo);
  const text =
    "Evidence and source material. ".repeat(1500) + "Unique end of document";
  const saved = await service.mutate(identity, w, {
    kind: "asset",
    operation: "save",
    expectedVersion: 0,
    data: { ...asset, text },
    requestKey: randomUUID(),
  });
  assert.ok(String(saved.data.text).length <= 5000);
  assert.ok(saved.data.contentTextId);
  assert.ok(
    JSON.stringify(
      db.rows("events").find((e) => e.payload?.record?.id === saved.id)
        ?.payload,
    ).length < 16384,
  );
  assert.equal((await library.asset(identity, w, saved.id)).data.text, text);
  const next = await service.mutate(identity, w, {
    kind: "asset",
    id: saved.id,
    expectedVersion: saved.version,
    operation: "save",
    data: { ...saved.data, region: "GB" },
    requestKey: randomUUID(),
  });
  assert.equal(next.data.contentTextId, saved.data.contentTextId);
  assert.equal(db.rows("library_text").length, 1);
  await assert.rejects(() =>
    library.asset({ ...identity, subject: "foreign" }, w, saved.id),
  );
  const full = await library.asset(identity, w, saved.id);
  const edited = await service.mutate(identity, w, {
    kind: "asset",
    id: saved.id,
    expectedVersion: next.version,
    operation: "save",
    data: { ...full.data, text: "Short revision" },
    requestKey: randomUUID(),
  });
  assert.equal(edited.data.contentTextId, "");
  assert.equal(db.rows("library_text").length, 1);
});

test("single-page imports resume idempotently, preserve prior revisions and report unchanged content", async () => {
  const { createLibrary } =
    await import("../src/services/content-strategy/library");
  const { db, w, brand, identity } = await setup();
  let text = "Useful source evidence";
  const library = createLibrary(config, db.mongo, {
    readPage: async () =>
      ({
        text,
        title: "Source report",
        description: "Research",
        canonical: "https://example.com/report",
        headings: [],
        fingerprint: text,
        checkedAt: new Date().toISOString(),
      }) as Awaited<
        ReturnType<
          typeof import("../src/services/content-strategy/discovery").discoverWebsite
        >
      >,
  });
  const { id } = await library.start(identity, w, {
    brandId: brand,
    url: "https://example.com/report",
    mode: "page",
    requestKey: randomUUID(),
  });
  const firstState = await library.discovery(identity, w, id);
  assert.equal(firstState.state.pages.length, 1);
  assert.equal(firstState.state.status, "complete");
  assert.equal(
    (await library.step(identity, w, id)).version,
    firstState.version,
  );
  const first = await library.importPage(identity, w, {
    id,
    url: "https://example.com/report",
    requestKey: randomUUID(),
  });
  const repeat = await library.importPage(identity, w, {
    id,
    url: "https://example.com/report",
    requestKey: randomUUID(),
  });
  assert.equal(first.asset!.id, repeat.asset!.id);
  assert.equal(repeat.unchanged, true);
  text = "Updated evidence";
  const changed = await library.importPage(identity, w, {
    id,
    url: "https://example.com/report",
    requestKey: randomUUID(),
  });
  assert.equal(changed.asset!.id, first.asset!.id);
  assert.equal(changed.asset!.version, first.asset!.version + 1);
  assert.equal(changed.asset!.status, "draft");
  assert.equal(
    (await library.discovery(identity, w, id)).state.pages[0].ingestion,
    "imported",
  );
  const history = db
    .rows("events")
    .filter((e) => e.payload?.record?.id === first.asset!.id);
  assert.equal(history.length, 2);
  await assert.rejects(() =>
    library.importPage({ ...identity, subject: "outsider" }, w, {
      id,
      url: "https://example.com/report",
      requestKey: randomUUID(),
    }),
  );
});

test("all generation contracts compile including optional research fields and literal nulls", () => {
  for (const [task, schema] of Object.entries(resultSchemas)) {
    const wire = outputSchema(schema);
    assert.equal(wire.additionalProperties, false, task);
    assert.ok(
      !JSON.stringify(wire).includes('"type":"object","enum":[null]'),
      task,
    );
  }
  const schema = resultSchemas.research;
  const value = {
    summary: "Example",
    assessments: [
      {
        organisationId: "org",
        personId: null,
        website: "",
        offerId: "offer",
        icpId: "icp",
        fit: "needs_research",
        rationale: "Unknown",
        evidenceIds: [],
        unknowns: [],
      },
    ],
    organisations: [],
    contacts: [],
    findings: [],
    gaps: [],
  };
  const parsed = schema.parse(omitOptionalNulls(value, schema));
  assert.equal(parsed.assessments[0].personId, undefined);
  assert.throws(() =>
    schema.parse(omitOptionalNulls({ ...value, extra: "not allowed" }, schema)),
  );
  const henry = outputSchema(resultSchemas.workspace_henry) as {
    properties: {
      objective: { maxLength: number };
      reply: { minLength: number };
      changes: {
        maxItems: number;
        items: { properties: { reason: { maxLength: number } } };
      };
    };
  };
  assert.equal(henry.properties.objective.maxLength, 2000);
  assert.equal(henry.properties.reply.minLength, 1);
  assert.equal(henry.properties.changes.maxItems, 160);
  assert.equal(
    henry.properties.changes.items.properties.reason.maxLength,
    1000,
  );
});

test("generated briefs do not confuse strategy recommendation keys with saved actions", async () => {
  const { normaliseBriefRecommendation } =
    await import("../src/services/content-strategy/application");
  const supplied = [
    { id: "strategy-1", kind: "strategy", status: "approved" },
    { id: "action-1", kind: "action", status: "draft" },
    { id: "removed-action", kind: "action", status: "removed" },
  ] as const;
  for (const actionId of [
    "strategy-1",
    "invented-recommendation-key",
    "removed-action",
    "other-workspace-action",
  ]) {
    const brief = { actionId, dependencies: ["Retain evidence requirement"] };
    normaliseBriefRecommendation(brief, [...supplied]);
    assert.equal(brief.actionId, "");
    assert.equal(brief.dependencies.length, 2);
    assert.equal(brief.dependencies[0], "Retain evidence requirement");
  }
  for (const actionId of ["", "action-1"]) {
    const brief = { actionId, dependencies: ["Keep"] };
    normaliseBriefRecommendation(brief, [...supplied]);
    assert.deepEqual(brief, { actionId, dependencies: ["Keep"] });
  }
  const full = {
    actionId: "invented",
    dependencies: Array.from({ length: 40 }, (_, i) => `Requirement ${i}`),
  };
  const original = [...full.dependencies];
  normaliseBriefRecommendation(full, [...supplied]);
  assert.equal(full.actionId, "");
  assert.deepEqual(full.dependencies, original);
});

test("association-only updates preserve approved content and reject injected edits", async () => {
  const { w, identity, service, asset } = await setup();
  const saved = await service.mutate(identity, w, {
    kind: "asset",
    operation: "save",
    expectedVersion: 0,
    data: asset,
    requestKey: randomUUID(),
  });
  const approved = await service.mutate(identity, w, {
    kind: "asset",
    operation: "approve",
    id: saved.id,
    expectedVersion: saved.version,
    requestKey: randomUUID(),
  });
  const input = {
    kind: "asset",
    operation: "associate",
    id: saved.id,
    expectedVersion: approved.version,
    data: { associations: [] },
    requestKey: randomUUID(),
  };
  const associated = await service.mutate(identity, w, input);
  assert.equal(associated.status, "approved");
  assert.equal(associated.data.text, asset.text);
  assert.deepEqual(await service.mutate(identity, w, input), associated);
  await assert.rejects(() =>
    service.mutate(identity, w, {
      ...input,
      expectedVersion: associated.version,
      requestKey: randomUUID(),
      data: { associations: [], text: "overwrite" },
    }),
  );
  await assert.rejects(() =>
    service.mutate({ ...identity, subject: "foreign" }, w, {
      ...input,
      expectedVersion: associated.version,
      requestKey: randomUUID(),
    }),
  );
});

test("written production uses approved brief evidence and remains a recoverable draft", async () => {
  const { db, w, identity, service, asset } = await setup();
  const source = await service.mutate(identity, w, saveInput("asset", asset));
  const draft = await service.mutate(
    identity,
    w,
    saveInput("brief", brief(asset.scope, [source.id])),
  );
  let calls = 0;
  const generated = createContentStrategy(
    config,
    db.mongo,
    async (_task, input) => {
      calls++;
      assert.ok(
        (input as { records: { id: string }[] }).records.some(
          (r) => r.id === source.id,
        ),
      );
      return {
        result: {
          title: "Evidence guide",
          text: "The supported methodology.",
          description: "A useful guide",
          evidenceGaps: [],
        },
        usage: { model: "fixture", inputTokens: 10, outputTokens: 10 },
      };
    },
  );
  const input = {
    task: "write",
    scope: asset.scope,
    instruction: "Write",
    recordIds: [draft.id],
    requestKey: randomUUID(),
  };
  await assert.rejects(
    () => generated.propose(identity, w, input),
    /approved content brief/,
  );
  const approved = await service.mutate(identity, w, {
    kind: "brief",
    operation: "approve",
    id: draft.id,
    expectedVersion: 1,
    requestKey: randomUUID(),
  });
  const result = await generated.propose(identity, w, {
    ...input,
    requestKey: randomUUID(),
  });
  assert.equal(result.text, "The supported methodology.");
  assert.equal(calls, 1);
  const proposals = (await generated.list(identity, w)).proposals;
  assert.ok(
    proposals.some(
      (p) => p.task === "write" && p.scope.brandId === asset.scope.brandId,
    ),
  );
  const saved = await service.mutate(
    identity,
    w,
    saveInput("asset", {
      ...asset,
      title: result.title,
      text: result.text,
      description: result.description,
      gaps: [],
      sourceAssetIds: [source.id],
      sourceMetadata: {
        ...asset.sourceMetadata,
        briefId: approved.id,
        briefVersion: approved.version,
        producer: "HVM",
      },
    }),
  );
  assert.equal(saved.status, "draft");
});
