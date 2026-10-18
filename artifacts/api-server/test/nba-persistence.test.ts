import type { Db, Document } from "mongodb";
import { createNbaReconciler } from "../src/services/nba/reconcile";
import { createAgentControlPlane } from "../src/services/agent-control-plane";
import {
  createNbaNativeExecution,
  nbaWorkAllowed,
} from "../src/services/nba/native";
import { nbaRegistration } from "../src/services/nba/registration";
import { createAgentWorkloadAuthority } from "../src/authorization/agent-workload";
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { EnquiryMemoryDb } from "./helpers/enquiry-db";
import { parseConfig } from "../src/config";
import { authEnvironment, testIssuer } from "./helpers/auth";
import { provisionHvmClient } from "../src/services/hvm-provision";
import { generatePlatformId } from "../src/domain";
import { createCampaignService } from "../src/services/campaigns/service";
import { createNbaService } from "../src/services/nba/service";
const config = parseConfig({
  ...authEnvironment,
  HVM_COGNITO_CLIENT_ID: "hvmclient",
  DEPLOYMENT_ENV: "test",
  MONGODB_URI: "mongodb://unused.invalid",
});
async function fixture(native: boolean | "research" = false) {
  const db = new EnquiryMemoryDb(),
    w = generatePlatformId("workspace"),
    brand = generatePlatformId("brand"),
    user = { subject: "nba-owner", issuer: testIssuer, clientId: "hvmclient" };
  db.rows("schema_versions").push({ _id: "vapp-v1", version: 29 });
  await provisionHvmClient(
    db.mongo,
    {
      organisationId: generatePlatformId("org"),
      organisationName: "NBA fixture",
      workspaceId: w,
      management: "client",
      brandId: brand,
      clientMembershipId: generatePlatformId("workspacemembership"),
      workspaceName: "NBA fixture",
      brandName: "NBA fixture",
      brandSlug: "nba-fixture",
      human: { type: "human", id: user.subject, issuer: user.issuer },
    },
    testIssuer,
  );
  const campaign = await createCampaignService(config, db.mongo).change(
    user,
    w,
    undefined,
    {
      requestKey: randomUUID(),
      expectedVersion: 0,
      action: "save",
      setup: {
        name: "Decision test",
        objective: "Find evidence",
        brandId: brand,
        products: [],
        offers: [],
        audiences: [],
        source: "both",
        researchPriority: "Demand evidence",
        urls: [],
        channels: [],
        goal: "Qualified leads",
        target: null,
        owner: "Marketing",
        timezone: "Europe/London",
        startDate: "",
        endDate: "",
        schedule: "",
        assetIds: [],
        contentRecordIds: [],
        overlapPolicy: "Review overlaps",
      },
    },
  );
  // Isolated test prerequisite, never bypasses approval in production.
  db.rows("events").find((e) => e.campaignId === campaign.id)!.payload.status =
    "ready";
  const authority = createAgentWorkloadAuthority("test", ["runtime"]);
  const execution = native
    ? createNbaNativeExecution(
        config,
        db.mongo,
        authority,
        {
          dependencies: async () => [],
          current: async (d, run, s) =>
            nbaWorkAllowed(d, run.workspaceId, run.frozen, s, config),
        },
        async () => true,
      )
    : undefined;
  if (native) {
    const definition = nbaRegistration({
      type: "human",
      id: user.subject,
      issuer: user.issuer,
    });
    definition.status = "active";
    db.rows("agent_definitions").push(definition);
  }
  let calls = 0;
  let fail = false;
  let generationInput: Document;
  let policyAssessments: Document[] | undefined;
  const service = createNbaService(
    config,
    db.mongo,
    async (_task, input) => {
      generationInput = input;
      calls++;
      if (fail) throw new Error("provider failed");
      return {
        result: {
          policyAssessments,
          action:
            native === "research"
              ? "request_evidence"
              : native
                ? "wait"
                : "no_action",
          outcome: "Wait for evidence",
          offerId: null,
          reason: "No current supporting evidence",
          alternatives: [],
          evidenceIds: [],
          missingInformation: ["Research"],
          dueAt:
            native === true
              ? new Date(Date.now() + 3600000).toISOString()
              : null,
          awaitEvent: null,
          instruction: "",
        },
        usage: { model: "fixture", inputTokens: 1, outputTokens: 1 },
      };
    },
    execution,
  );
  const input = {
    requestKey: randomUUID(),
    campaignId: campaign.id,
    campaignVersion: 1,
    subject: { type: "campaign" },
    instruction: "Find the next useful step",
  };
  return {
    db,
    w,
    user,
    service,
    input,
    calls: () => calls,
    generationInput: () => generationInput,
    assess: (items: Document[]) => {
      policyAssessments = items;
    },
    authority,
    control: createAgentControlPlane(config, db.mongo, authority, {
      dependencies: async () => [],
      current: async (d, run, s) =>
        nbaWorkAllowed(d, run.workspaceId, run.frozen, s, config),
    }),
    reconcile: createNbaReconciler(config, db.mongo),
    fail: () => {
      fail = true;
    },
  };
}
test("NBA saves provider failure and instructions, duplicate request does not call again", async () => {
  const f = await fixture();
  f.fail();
  const saved = await f.service.preview(f.user, f.w, f.input);
  assert.equal(saved.state, "failed");
  assert.equal(saved.instruction, f.input.instruction);
  assert.equal((await f.service.preview(f.user, f.w, f.input)).id, saved.id);
  assert.equal(f.calls(), 1);
});
test("NBA preview persists, edits are versioned, stale mutation rejected, cancellation retained", async () => {
  const f = await fixture();
  const saved = await f.service.preview(f.user, f.w, f.input);
  assert.equal(saved.version, 2);
  assert.equal(saved.state, "proposed");
  const edit = {
    requestKey: randomUUID(),
    expectedVersion: 2,
    action: "revise",
    decision: { ...saved.decision, reason: "Human-reviewed reason" },
  };
  const edited = await f.service.change(f.user, f.w, saved.id, edit);
  assert.equal(edited.version, 3);
  assert.equal(
    (await f.service.change(f.user, f.w, saved.id, edit)).version,
    3,
  );
  await assert.rejects(
    () =>
      f.service.change(f.user, f.w, saved.id, {
        ...edit,
        requestKey: randomUUID(),
      }),
    /changed/,
  );
  const cancelled = await f.service.change(f.user, f.w, saved.id, {
    requestKey: randomUUID(),
    expectedVersion: 3,
    action: "cancel",
  });
  assert.equal(cancelled.state, "cancelled");
  assert.equal(
    (await f.service.history(f.user, f.w, saved.id)).history.length,
    4,
  );
  assert.equal(f.calls(), 1);
});
test("NBA never approves execution without native binding and cannot read another workspace", async () => {
  const f = await fixture();
  const saved = await f.service.preview(f.user, f.w, f.input);
  await assert.rejects(
    () =>
      f.service.change(f.user, f.w, saved.id, {
        requestKey: randomUUID(),
        expectedVersion: 2,
        action: "approve",
      }),
    /not connected/,
  );
  await assert.rejects(() =>
    f.service.history(f.user, generatePlatformId("workspace"), saved.id),
  );
  assert.equal(f.db.rows("agent_runs").length, 0);
});

test("approval queues native work atomically; pause cancels its run and resume creates a new one", async () => {
  const f = await fixture(true);
  const saved = await f.service.preview(f.user, f.w, f.input);
  const body = {
    requestKey: randomUUID(),
    expectedVersion: saved.version,
    action: "approve",
  };
  const approved = await f.service.change(f.user, f.w, saved.id, body);
  assert.equal(approved.state, "scheduled");
  assert.equal(f.db.rows("agent_runs").length, 1);
  assert.equal(
    (await f.service.change(f.user, f.w, saved.id, body)).version,
    approved.version,
  );
  assert.equal(f.db.rows("agent_runs").length, 1);
  const paused = await f.service.change(f.user, f.w, saved.id, {
    requestKey: randomUUID(),
    expectedVersion: approved.version,
    action: "pause",
  });
  assert.equal(paused.state, "paused");
  assert.equal(f.db.rows("agent_runs")[0]!.status, "cancelled");
  const resumed = await f.service.change(f.user, f.w, saved.id, {
    requestKey: randomUUID(),
    expectedVersion: paused.version,
    action: "resume",
  });
  assert.equal(resumed.state, "scheduled");
  assert.equal(f.db.rows("agent_runs").length, 2);
});

test("changed campaign invalidates approval without creating native work", async () => {
  const f = await fixture(true),
    saved = await f.service.preview(f.user, f.w, f.input);
  f.db.rows("events").find((r) => r.eventType === "campaign_setup")!.payload
    .version++;
  await assert.rejects(
    () =>
      f.service.change(f.user, f.w, saved.id, {
        requestKey: randomUUID(),
        expectedVersion: saved.version,
        action: "approve",
      }),
    /current approved/,
  );
  assert.equal(f.db.rows("agent_runs").length, 0);
  assert.equal(
    (await f.service.history(f.user, f.w, saved.id)).history[0]!.state,
    "proposed",
  );
});
test("native claim refuses revoked client administrator authority", async () => {
  const f = await fixture(true),
    saved = await f.service.preview(f.user, f.w, f.input);
  await f.service.change(f.user, f.w, saved.id, {
    requestKey: randomUUID(),
    expectedVersion: saved.version,
    action: "approve",
  });
  const r = f.db.rows("agent_runs")[0]!;
  const principal = f.authority.authenticated({
    environment: "test",
    clientId: "runtime",
    workerId: "worker",
    workloadClass: "agent_runtime",
    scopes: ["claim", "heartbeat", "context", "outcome", "receipt", "usage"],
  });
  const claim = {
    claimId: "claim:1",
    dispatch: {
      protocolVersion: "2.0",
      environment: "test",
      runId: r.id,
      generation: r.generation,
      dispatchId: r.dispatch.id,
      notBefore: r.notBefore.toISOString(),
      traceId: r.frozen.traceId,
    },
  };
  const work = await f.control.claim(principal, claim);
  assert.deepEqual(await f.control.claim(principal, claim), work);
  f.db.rows("workspace_memberships")[0]!.status = "ended";
  f.db.rows("workspace_memberships")[0]!.endedAt = new Date();
  assert.deepEqual(
    await f.control.heartbeat(principal, {
      runId: r.id,
      attemptId: work.attemptId,
      fence: work.fence,
      generation: work.generation,
      leaseId: work.lease.id,
    }),
    { continue: false },
  );
});
test("native completion creates one research handoff; repeated reconciliation reuses the saved request", async () => {
  const f = await fixture("research"),
    saved = await f.service.preview(f.user, f.w, f.input);
  const approved = await f.service.change(f.user, f.w, saved.id, {
    requestKey: randomUUID(),
    expectedVersion: saved.version,
    action: "approve",
  });
  const run = f.db.rows("agent_runs")[0]!;
  run.status = "completed";
  run.terminalReason = "success";
  f.db.rows("agent_results").push({
    id: generatePlatformId("agentresult"),
    workspaceId: f.w,
    runId: run.id,
    envelope: {
      outcome: {
        content: {
          domainOutput: {
            decisionId: saved.id,
            decisionVersion: approved.version,
            status: "re_evaluation_due",
          },
        },
      },
    },
  });
  await f.reconcile.reconcile(f.w, saved.id);
  assert.equal(
    (await f.service.history(f.user, f.w, saved.id)).history[0]!.state,
    "running",
  );
  await f.reconcile.reconcile(f.w, saved.id);
  await f.reconcile.reconcile(f.w, saved.id);
  assert.equal(
    f.db.rows("events").filter((r) => r.eventType === "research_job").length,
    1,
  );
  const latest = (await f.service.history(f.user, f.w, saved.id)).history[0]!;
  assert.ok(latest.researchId);
  await f.service.change(f.user, f.w, saved.id, {
    requestKey: randomUUID(),
    expectedVersion: latest.version,
    action: "cancel",
  });
  assert.equal(
    f.db.rows("events").find((r) => r.eventType === "research_job")!.payload
      .status,
    "cancelled",
  );
});

test("explicit resume renews an elapsed timer without changing its earlier history", async () => {
  const f = await fixture(true);
  const proposed = await f.service.preview(f.user, f.w, f.input);
  const approved = await f.service.change(f.user, f.w, proposed.id, {
    requestKey: randomUUID(),
    expectedVersion: proposed.version,
    action: "approve",
  });
  const paused = await f.service.change(f.user, f.w, proposed.id, {
    requestKey: randomUUID(),
    expectedVersion: approved.version,
    action: "pause",
  });
  const row = f.db
    .rows("events")
    .find(
      (e) =>
        e.eventType === "nba_decision" &&
        e.payload.decisionId === paused.id &&
        e.payload.version === paused.version,
    )!;
  row.payload.decision.dueAt = new Date(Date.now() - 60000).toISOString();
  const previous = row.payload.decision.dueAt;
  const resumed = await f.service.change(f.user, f.w, paused.id, {
    requestKey: randomUUID(),
    expectedVersion: paused.version,
    action: "resume",
  });
  assert.equal(resumed.state, "scheduled");
  assert.ok(Date.parse(resumed.decision!.dueAt!) > Date.parse(previous));
  assert.equal(row.payload.decision.dueAt, previous);
});

test("interrupted generation is recoverable and reconciliation cannot revive cancellation", async () => {
  const f = await fixture(true);
  const preview = await f.service.preview(f.user, f.w, f.input);
  const pending = f.db
    .rows("events")
    .find(
      (e) =>
        e.eventType === "nba_decision" &&
        e.payload.decisionId === preview.id &&
        e.payload.version === preview.version,
    )!;
  pending.payload.state = "generating";
  pending.createdAt = new Date(Date.now() - 360000);
  await f.reconcile.reconcile(f.w, preview.id);
  const recovered = (await f.service.history(f.user, f.w, preview.id))
    .history[0]!;
  assert.equal(recovered.state, "failed");
  assert.equal(f.calls(), 1);
  const cancelled = await f.service.change(f.user, f.w, preview.id, {
    requestKey: randomUUID(),
    expectedVersion: recovered.version,
    action: "cancel",
  });
  await f.reconcile.reconcile(f.w, preview.id);
  assert.equal(
    (await f.service.history(f.user, f.w, preview.id)).history[0]!.version,
    cancelled.version,
  );
});

test("reviewed production composition admits NBA through shared capacity without changing PSU manifest", async () => {
  const { composePsuProduction } =
    await import("../src/services/psu-production-composition");
  const { PRODUCT_CLARIFICATION_MANIFEST: psu } =
    await import("@workspace/agent-runtime-protocol");
  const { PSU_RECONCILIATION_POLICY_DIGEST } =
    await import("../src/services/product-service-understanding/execution-policy");
  const { openAITerminalQualification } =
    await import("../src/services/psu-terminal-qualification");
  const f = await fixture(true),
    authority = createAgentWorkloadAuthority("dev", ["runtime"]);
  const principal = authority.authenticated({
    environment: "dev",
    clientId: "runtime",
    workerId: "worker:00000000-0000-4000-8000-000000000001",
    workloadClass: "agent_runtime",
    scopes: [
      "claim",
      "heartbeat",
      "context",
      "outcome",
      "receipt",
      "usage",
      "capacity",
      "execution_evidence",
    ],
  });
  const release = {
    environment: "dev" as const,
    workloadClass: "agent_runtime" as const,
    workloadClientId: "runtime",
    manifestDigest: psu.manifestDigest,
    buildDigest: psu.buildDigest,
    policyDigest: PSU_RECONCILIATION_POLICY_DIGEST,
    serviceArn: "service",
    taskDefinitionArn: "task-definition",
    imageDigest: `sha256:${"a".repeat(64)}`,
  };
  const api = composePsuProduction(
    { ...config, deploymentEnvironment: "dev" },
    f.db.mongo,
    { authority, authenticate: async () => principal },
    release,
    async () => true,
    undefined,
    openAITerminalQualification("proj_synthetic"),
    true,
  );
  assert.ok(api.nba);
  assert.equal(await api.nba.available(), false);
  await api.capacity.report(principal, {
    release,
    taskArn: "task",
    ready: true,
  });
  await api.capacity.observe();
  assert.equal(await api.nba.available(), true);
  const preview = await f.service.preview(f.user, f.w, f.input);
  const service = createNbaService(
    { ...config, deploymentEnvironment: "dev" },
    f.db.mongo,
    async () => {
      throw new Error("No provider calls");
    },
    api.nba,
  );
  const saved = await service.change(f.user, f.w, preview.id, {
    requestKey: randomUUID(),
    expectedVersion: preview.version,
    action: "approve",
  });
  assert.equal(saved.state, "scheduled");
  const run = f.db.rows("agent_runs").find((r) => r.id === saved.runId)!;
  const claim = await api.control.claim(principal, {
    dispatch: {
      protocolVersion: "2.0",
      environment: "dev",
      runId: run.id,
      generation: run.generation,
      dispatchId: run.dispatch.id,
      notBefore: run.notBefore.toISOString(),
      traceId: run.frozen.traceId,
    },
    claimId: "nba:production",
  });
  assert.equal(claim.runId, run.id);
  assert.equal(run.frozen.grant.models.length, 0);
});

test("only Empress can register and publish the exact NBA foundation; other Agent authoring stays retired", async () => {
  const { mutateOperating } = await import("../src/services/operating");
  const f = await fixture();
  const definition = nbaRegistration({
    type: "human",
    id: f.user.subject,
    issuer: f.user.issuer,
  });
  const input = {
    key: definition.key,
    version: definition.version,
    availability: definition.availability,
    data: definition.data,
  };
  await assert.rejects(() =>
    mutateOperating(
      f.db.mongo,
      config,
      f.user,
      "agent_definitions",
      "create",
      input,
    ),
  );
  const empress = {
    ...f.user,
    subject: "00000000-0000-4000-8000-000000000001",
  };
  const empressConfig = parseConfig({
    ...authEnvironment,
    HVM_COGNITO_CLIENT_ID: "hvmclient",
    HVM_EMPRESS_SUBJECTS: empress.subject,
    DEPLOYMENT_ENV: "test",
    MONGODB_URI: "mongodb://unused.invalid",
  });
  await assert.rejects(() =>
    mutateOperating(
      f.db.mongo,
      empressConfig,
      empress,
      "agent_definitions",
      "create",
      { ...input, key: "anything_else" },
    ),
  );
  await assert.rejects(() =>
    mutateOperating(
      f.db.mongo,
      empressConfig,
      empress,
      "agent_definitions",
      "create",
      { ...input, data: { ...input.data, name: "Changed definition" } },
    ),
  );
  await mutateOperating(
    f.db.mongo,
    empressConfig,
    empress,
    "agent_definitions",
    "create",
    input,
  );
  const saved = f.db
    .rows("agent_definitions")
    .find((r) => r.key === "next_best_action")!;
  await mutateOperating(
    f.db.mongo,
    empressConfig,
    empress,
    "agent_definitions",
    "publish",
    { id: saved.id, expectedUpdatedAt: saved.updatedAt.toISOString() },
  );
  assert.equal(
    f.db.rows("agent_definitions").find((r) => r.id === saved.id)!.status,
    "active",
  );
});

test("NBA explains available internal Research without treating preview as execution", async () => {
  const f = await fixture("research");
  const saved = await f.service.preview(f.user, f.w, f.input);
  const input = f.generationInput();
  assert.ok(input.availableActions.includes("request_evidence"));
  assert.match(input.capabilities.research, /after explicit approval/);
  assert.match(input.capabilities.research, /existing Hive sources only/);
  assert.match(
    input.capabilities.communications,
    /Human-approved Gmail delivery/,
  );
  assert.match(
    input.capabilities.communications,
    /Never infer sending authority/,
  );
  assert.equal(saved.state, "proposed");
  assert.equal(f.db.rows("agent_runs").length, 0);
  assert.equal(
    f.db.rows("events").filter((r) => r.eventType === "research_job").length,
    0,
  );
});

test("unknown organisation customer status permits internal evidence review but DNC still blocks it", async () => {
  const f = await fixture("research"),
    id = generatePlatformId("org");
  f.db.rows("organisations").push({
    id,
    workspaceId: f.w,
    name: "Unknown customer fixture",
    archived: false,
    updatedAt: new Date(),
  });
  const input = { ...f.input, subject: { type: "organisation", id } };
  const saved = await f.service.preview(f.user, f.w, input);
  assert.equal(saved.state, "proposed");
  const approved = await f.service.change(f.user, f.w, saved.id, {
    requestKey: randomUUID(),
    expectedVersion: saved.version,
    action: "approve",
  });
  assert.equal(approved.state, "scheduled");
  await f.service.change(f.user, f.w, saved.id, {
    requestKey: randomUUID(),
    expectedVersion: approved.version,
    action: "cancel",
  });
  f.db.rows("events").push({
    id: generatePlatformId("event"),
    workspaceId: f.w,
    eventType: "contact_context_changed",
    createdAt: new Date(),
    payload: { subjectId: id, controls: { doNotContact: true } },
  });
  const blocked = await f.service.preview(f.user, f.w, {
    ...input,
    requestKey: randomUUID(),
  });
  assert.equal(blocked.state, "blocked");
  assert.ok(blocked.blockers.includes("Contact policy prevents this action."));
});

test("reconsideration receives completed research as scoped unapproved evidence", async () => {
  const f = await fixture();
  const job = generatePlatformId("event");
  f.db.rows("events").push({
    id: generatePlatformId("event"),
    workspaceId: f.w,
    campaignId: f.input.campaignId,
    eventType: "nba_decision",
    payload: {
      subject: { type: "campaign" },
      researchId: job,
      researchStatus: "completed",
      researchSummary:
        "Synthetic organisation has no demonstrated fit; do not contact.",
    },
  });
  f.db.rows("events").push({
    id: generatePlatformId("event"),
    workspaceId: generatePlatformId("workspace"),
    campaignId: f.input.campaignId,
    eventType: "nba_decision",
    payload: {
      subject: { type: "campaign" },
      researchId: generatePlatformId("event"),
      researchSummary: "OTHER TENANT",
    },
  });
  f.db.rows("events").push({
    id: generatePlatformId("event"),
    workspaceId: f.w,
    campaignId: f.input.campaignId,
    eventType: "nba_decision",
    payload: {
      subject: { type: "organisation", id: generatePlatformId("org") },
      researchId: generatePlatformId("event"),
      researchSummary: "OTHER SUBJECT",
    },
  });
  await f.service.preview(f.user, f.w, f.input);
  const input = f.generationInput();
  assert.equal(input.priorResearchResults.length, 1);
  assert.equal(input.priorResearchResults[0].researchId, job);
  assert.match(input.priorResearchResults[0].approval, /Unapproved/);
  assert.ok(input.evidenceIds.includes(job));
  assert.equal(input.approvedResearch.length, 0);
});

test("unchanged completed Research cannot be approved again; changed context permits review", async () => {
  const f = await fixture("research");
  const first = await f.service.preview(f.user, f.w, f.input);
  const source = f.db
    .rows("events")
    .find(
      (e) =>
        e.eventType === "nba_decision" &&
        e.payload.decisionId === first.id &&
        e.payload.version === first.version,
    )!;
  source.payload.researchId = generatePlatformId("event");
  source.payload.researchStatus = "completed";
  source.payload.researchSummary = "Evidence reviewed; needs a human decision.";
  const again = await f.service.preview(f.user, f.w, {
    ...f.input,
    requestKey: randomUUID(),
  });
  assert.equal(again.state, "review_required");
  assert.match(again.blockers.join(" "), /already completed/);
  await assert.rejects(() =>
    f.service.change(f.user, f.w, again.id, {
      requestKey: randomUUID(),
      expectedVersion: again.version,
      action: "approve",
    }),
  );
  assert.equal(f.db.rows("agent_runs").length, 0);
  const campaign = f.db
    .rows("events")
    .find((e) => e.eventType === "campaign_setup")!;
  campaign.payload.version = 2;
  const changed = await f.service.preview(f.user, f.w, {
    ...f.input,
    campaignVersion: 2,
    requestKey: randomUUID(),
  });
  assert.equal(changed.state, "proposed");
});

test("approved NBA content handoff registers one private draft and returns to review without sending", async () => {
  const f = await fixture(true),
    person = generatePlatformId("person"),
    org = generatePlatformId("org"),
    brand = f.db.rows("brands")[0]!.id;
  f.db.rows("people").push({
    id: person,
    workspaceId: f.w,
    firstName: "Taylor",
    archived: false,
    updatedAt: new Date(),
  });
  f.db
    .rows("organisations")
    .push({ id: org, workspaceId: f.w, name: "Example", archived: false });
  f.db.rows("organisation_relationships").push({
    id: randomUUID(),
    workspaceId: f.w,
    personId: person,
    organisationId: org,
    current: true,
    archived: false,
  });
  f.db.rows("events").push({
    id: randomUUID(),
    workspaceId: f.w,
    eventType: "contact_context_changed",
    createdAt: new Date(),
    payload: { subjectId: person, controls: { lifecycle: "lead" } },
  });
  f.db.rows("events").push({
    id: randomUUID(),
    workspaceId: f.w,
    eventType: "content_strategy_record",
    payload: {
      record: {
        id: "brief-email",
        kind: "brief",
        version: 1,
        status: "approved",
        updatedAt: new Date().toISOString(),
        fingerprint: "brief",
        sourceVersions: [],
        data: {
          title: "Ask a useful question",
          channel: "email",
          cta: "Reply to this email",
          scope: { brandId: brand, products: [], offers: [], audiences: [] },
          sourceAssetIds: [],
        },
      },
    },
  });
  const preview = await f.service.preview(f.user, f.w, {
    ...f.input,
    subject: { type: "person", id: person },
  });
  const edited = await f.service.change(f.user, f.w, preview.id, {
    requestKey: randomUUID(),
    expectedVersion: preview.version,
    action: "revise",
    decision: {
      ...preview.decision,
      action: "prepare_content",
      instruction: "Ask a relevant question",
      dueAt: null,
    },
  });
  const approved = await f.service.change(f.user, f.w, edited.id, {
    requestKey: randomUUID(),
    expectedVersion: edited.version,
    action: "approve",
  });
  const native = f.db.rows("agent_runs").find((r) => r.id === approved.runId)!;
  native.status = "completed";
  f.db.rows("agent_results").push({
    id: generatePlatformId("agentresult"),
    workspaceId: f.w,
    runId: approved.runId,
    envelope: {
      outcome: {
        content: {
          domainOutput: {
            decisionId: approved.id,
            decisionVersion: approved.version,
            status: "re_evaluation_due",
          },
        },
      },
    },
  });
  let calls = 0;
  const reconcile = createNbaReconciler(
    config,
    f.db.mongo,
    async (task, input) => {
      assert.equal(task, "email");
      const payload = input as Document;
      assert.ok(payload.approved);
      assert.ok(payload.campaign.setup);
      assert.equal(payload.campaign.approved, undefined);
      assert.equal(payload.campaign.contact, undefined);
      assert.equal(payload.campaign.capabilities, undefined);
      assert.ok("engagementPolicy" in payload.campaign);
      assert.ok("approvedResearch" in payload.campaign);
      calls++;
      return {
        result: {
          subject: "A practical question",
          body: "Hello Taylor, what is your current priority?",
          ctaAssetId: "",
          ctaText: "Reply with your priority",
          ctaRationale: "The brief requests a reply",
          reviewIssues: [],
        },
        usage: { model: "test", inputTokens: 1, outputTokens: 1 },
      };
    },
  );
  await reconcile.reconcile(f.w, approved.id);
  await reconcile.reconcile(f.w, approved.id);
  await reconcile.reconcile(f.w, approved.id);
  assert.equal(calls, 1);
  assert.equal(
    f.db.rows("events").filter((e) => e.eventType === "email_content_record")
      .length,
    1,
  );
  const receipts = f.db
    .rows("events")
    .filter(
      (e) =>
        e.eventType === "nba_capability_result" &&
        e.payload.capability === "content_creation",
    );
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0]!.payload.disposition, "review_required");
  assert.equal(
    f.db.rows("events").filter((e) => e.eventType === "email").length,
    0,
  );
});

test("approved custom strategies gate NBA preview, approval and native recheck; drafts do not replace approval", async () => {
  const { createContactStrategies } =
    await import("../src/services/contact-strategy/application");
  const { nbaContext } = await import("../src/services/nba/context");
  const { guardDecision } = await import("../src/services/nba/model");
  const f = await fixture("research");
  const policies = createContactStrategies(config, f.db.mongo);
  const key = `custom_${randomUUID().replaceAll("-", "")}`;
  await policies.mutate(f.user, f.w, {
    key,
    name: "Research rule",
    statement: "Internal research may proceed only with recorded evidence.",
    operation: "save",
    expectedVersion: 0,
  });
  const approved = await policies.mutate(f.user, f.w, {
    key,
    operation: "approve",
    expectedVersion: 1,
  });
  const blocked = await f.service.preview(f.user, f.w, f.input);
  assert.equal(blocked.state, "blocked");
  assert.match(blocked.blockers.join(" "), /Current policy assessment/);
  assert.deepEqual(
    f.generationInput().policies.map((p: { id: string }) => p.id),
    [approved.id],
  );
  // Real approved campaign research evidence, scoped exactly as production reads it.
  const evidenceId = generatePlatformId("event");
  f.db.rows("events").push({
    id: evidenceId,
    workspaceId: f.w,
    eventType: "research_finding",
    payload: {
      decision: "approved",
      destinations: [{ type: "campaign", id: f.input.campaignId }],
      summary: "Internal evidence exists",
    },
  });
  const assessment = {
    policyId: approved.id,
    version: approved.version,
    action: "request_evidence",
    offerId: null,
    applies: true,
    effect: "permitted",
    reason: "Recorded internal research evidence supports this internal action",
    evidenceIds: [evidenceId],
  };
  f.assess([assessment]);
  const allowed = await f.service.preview(f.user, f.w, {
    ...f.input,
    requestKey: randomUUID(),
  });
  assert.equal(allowed.state, "proposed");
  assert.equal(allowed.decision.policyAssessments[0].policyId, approved.id);
  await policies.mutate(f.user, f.w, {
    key,
    operation: "save",
    expectedVersion: 2,
    statement: "Do not research.",
  });
  const ctx = await nbaContext(
    f.db as unknown as Db,
    config,
    f.user,
    f.w,
    f.input.campaignId,
    1,
    { type: "campaign" },
  );
  assert.deepEqual(
    ctx.contactStrategies?.map((p) => p.id),
    [approved.id],
  );
  assert.equal(
    guardDecision(allowed.decision, ctx, new Date()).state,
    "proposed",
  );
  const queuedCandidate = await f.service.preview(f.user, f.w, {
    ...f.input,
    requestKey: randomUUID(),
  });
  const queued = await f.service.change(f.user, f.w, queuedCandidate.id, {
    requestKey: randomUUID(),
    expectedVersion: queuedCandidate.version,
    action: "approve",
  });
  assert.equal(queued.state, "scheduled");
  const run = f.db.rows("agent_runs").at(-1)!;
  assert.equal(
    await nbaWorkAllowed(
      f.db as unknown as Db,
      f.w,
      run.frozen,
      undefined,
      config,
    ),
    true,
  );
  const { createAgentExecutionReadiness } =
    await import("../src/services/agent-execution-readiness");
  const { NBA_FOUNDATION_MANIFEST } =
    await import("@workspace/agent-runtime-protocol");
  const readiness = createAgentExecutionReadiness(
    {
      manifest: async () => NBA_FOUNDATION_MANIFEST,
      available: async () => true,
      reasoningOperations: () => ["reconsider"],
      reasoningConfiguration: () => [],
    },
    {
      allowInternal: false,
      dependencies: async () => [],
      allowed: (db, workspace, work, session) =>
        nbaWorkAllowed(db, workspace, work, session, config),
    },
  );
  assert.equal(
    await readiness.policy.current(
      f.db as unknown as Db,
      run as unknown as Parameters<typeof readiness.policy.current>[1],
      undefined,
    ),
    true,
  );
  await policies.mutate(f.user, f.w, {
    key,
    operation: "approve",
    expectedVersion: 3,
  });
  assert.equal(
    await nbaWorkAllowed(
      f.db as unknown as Db,
      f.w,
      run.frozen,
      undefined,
      config,
    ),
    false,
  );

  const changed = await nbaContext(
    f.db as unknown as Db,
    config,
    f.user,
    f.w,
    f.input.campaignId,
    1,
    { type: "campaign" },
  );
  assert.equal(
    guardDecision(allowed.decision, changed, new Date()).state,
    "blocked",
  );
  await assert.rejects(
    () =>
      f.service.change(f.user, f.w, allowed.id, {
        requestKey: randomUUID(),
        expectedVersion: allowed.version,
        action: "approve",
      }),
    /changed/,
  );
  await policies.mutate(f.user, f.w, {
    key,
    operation: "deactivate",
    expectedVersion: 4,
  });
  const withdrawn = await nbaContext(
    f.db as unknown as Db,
    config,
    f.user,
    f.w,
    f.input.campaignId,
    1,
    { type: "campaign" },
  );
  assert.deepEqual(withdrawn.contactStrategies, []);
  assert.equal(
    f.db.rows("events").filter((e) => e.eventType === "communication_delivery")
      .length,
    0,
  );
});
