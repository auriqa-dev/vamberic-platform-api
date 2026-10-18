import {
  OPENAI_TERMINAL_POLICY,
  TERMINAL_QUALIFICATION_DIGEST as runtimeQualification,
} from "../../../../vamberic-agent-runtime/dist/src/models/openai/terminal-policy.js";
import {
  openAITerminalQualification,
  TERMINAL_QUALIFICATION_DIGEST,
} from "../src/services/psu-terminal-qualification";
import { preparePsuProduction } from "../../../../vamberic-agent-runtime/dist/src/worker/psu-production.js";
import { z as runtimeZ } from "../../../../vamberic-agent-runtime/node_modules/zod/index.js";
import test from "node:test";
import assert from "node:assert/strict";
import { workspaceAgentFixture } from "./helpers/workspace-agent-v16";
import { PRODUCT_CLARIFICATION_MANIFEST } from "@workspace/agent-runtime-protocol";
import { composePsuProduction } from "../src/services/psu-production-composition";
import { createAgentWorkloadAuthority } from "../src/authorization/agent-workload";
import { PSU_RECONCILIATION_POLICY_DIGEST } from "../src/services/product-service-understanding/execution-policy";
import { PSU_RECONCILIATION_POLICY_DIGEST as runtimePolicy } from "../../../../vamberic-agent-runtime/dist/src/worker/psu-production.js";
test("production exact bindings, capacity, USD preparation and fenced slot integrate without Client Agent", async () => {
  assert.equal(runtimePolicy, PSU_RECONCILIATION_POLICY_DIGEST);
  assert.equal(runtimeQualification, TERMINAL_QUALIFICATION_DIGEST);
  assert.throws(() => openAITerminalQualification("wrong"));
  const f = await workspaceAgentFixture(true, PRODUCT_CLARIFICATION_MANIFEST);
  f.db.rows("schema_versions")[0]!.version = 23;
  const authority = createAgentWorkloadAuthority("dev", ["client"]);
  const principal = authority.authenticated({
    environment: "dev",
    clientId: "client",
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
    workloadClientId: "client",
    manifestDigest: f.manifest.manifestDigest,
    buildDigest: f.manifest.buildDigest,
    policyDigest: PSU_RECONCILIATION_POLICY_DIGEST,
    serviceArn: "service",
    taskDefinitionArn: "task-definition",
    imageDigest: `sha256:${"a".repeat(64)}`,
  };
  let now = f.now;
  const api = composePsuProduction(
    { ...f.config, deploymentEnvironment: "dev" },
    f.db.mongo,
    { authority, authenticate: async () => principal },
    release,
    async () => true,
    () => now,
    openAITerminalQualification("proj_synthetic"),
  );
  await assert.rejects(
    api.effectiveness.create(f.queen, f.workspaceId, f.request),
  );
  await api.capacity.report(principal, {
    release,
    taskArn: "task",
    ready: true,
  });
  await api.capacity.observe();
  await assert.rejects(
    api.effectiveness.create(f.queen, f.workspaceId, {
      ...f.request,
      input: {
        ...f.request.input,
        websiteUrls: ["https://fictional.example/"],
      },
    }),
  );
  const c = await api.effectiveness.create(f.queen, f.workspaceId, f.request);
  const queuedCase = await api.effectiveness.create(f.queen, f.workspaceId, {
    ...f.request,
    requestKey: "queued-before-busy",
  });
  assert.deepEqual(c.totalBudget.cost, { currency: "USD", amount: "8" });
  assert.equal(c.totalBudget.toolCalls, 0);
  const run = f.db.rows("agent_runs").find((r) => r.id === c.rootRunId)!;
  assert.deepEqual(run.frozen.grant.budgets.cost, {
    currency: "USD",
    amount: "1.20",
  });
  assert.equal(run.frozen.grant.models[0].model, "openai_psu_maker_v1");
  assert.equal(f.db.rows("client_agents").length, 0);
  const w = await api.control.claim(principal, {
    dispatch: {
      protocolVersion: "2.0",
      environment: "dev",
      runId: run.id,
      generation: run.generation,
      dispatchId: run.dispatch.id,
      notBefore: run.notBefore.toISOString(),
      traceId: run.frozen.traceId,
    },
    claimId: "claim:production",
  });
  const binding = {
    runId: w.runId,
    attemptId: w.attemptId,
    workspaceId: w.workspaceId,
    generation: w.generation,
    fence: w.fence,
    leaseId: w.lease.id,
    workerId: principal.workerId,
    workloadClientId: principal.clientId,
    invocationId: "call:first",
    release,
  };
  let providerCalls = 0;
  const runtime = await preparePsuProduction(
    {
      enabled: true,
      release,
      taskArn: "task",
      secretArn:
        "arn:aws:secretsmanager:eu-west-2:123456789012:secret:vamberic/dev/synthetic",
      models: {
        OPENAI_PROJECT_ID: "proj_synthetic",
        PSU_MAKER_MODEL: "gpt-6.1-sol",
        PSU_EVALUATOR_MODEL: "gpt-6-astra",
        PSU_REVISION_MODEL: "gpt-6.1-sol",
      },
    },
    {
      readSecret: async () => '{"OPENAI_API_KEY":"synthetic-not-real"}',
      terminalPolicy: OPENAI_TERMINAL_POLICY,
      capacity: {
        report: async (body) => {
          await api.capacity.report(principal, body);
        },
        prepare: (body) => api.capacity.prepare(principal, body),
        issueSend: (body) => api.capacity.issueSend(principal, body),
        evidence: (body) => api.capacity.evidence(principal, body),
        quarantine: async (body) => {
          await api.capacity.quarantine(principal, body);
        },
      },
      http: async () => {
        providerCalls++;
        const queued = f.db
          .rows("agent_runs")
          .find((row) => row.id === queuedCase.rootRunId)!;
        await assert.rejects(
          api.control.claim(principal, {
            dispatch: {
              protocolVersion: "2.0",
              environment: "dev",
              runId: queued.id,
              generation: queued.generation,
              dispatchId: queued.dispatch.id,
              notBefore: queued.notBefore.toISOString(),
              traceId: queued.frozen.traceId,
            },
            claimId: "claim:must-wait",
          }),
        );
        assert.equal(
          f.db.rows("agent_runs").find((row) => row.id === queued.id)!.status,
          "queued",
        );
        assert.equal(
          f.db.rows("agent_attempts").filter((row) => row.runId === queued.id)
            .length,
          0,
        );
        await assert.rejects(
          api.effectiveness.create(f.queen, f.workspaceId, {
            ...f.request,
            requestKey: "rejected-while-busy",
          }),
        );
        return Response.json({
          model: "gpt-6.1-sol",
          id: "resp_synthetic",
          object: "response",
          background: false,
          service_tier: "default",
          status: "completed",
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            total_tokens: 15,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens_details: { reasoning_tokens: 0 },
          },
          output: [
            {
              type: "message",
              role: "assistant",
              status: "completed",
              content: [{ type: "output_text", text: '{"name":"Fictional"}' }],
            },
          ],
        });
      },
    },
    new AbortController().signal,
  );
  const reply = await runtime!.adaptersForWork(w).models[0]!.invoke({
    selection: {
      provider: "openai",
      model: "openai_psu_maker_v1",
      purpose: "product_understand",
    },
    messages: [{ role: "user", content: "Fictional" }],
    invocationId: "call:first",
    timeoutMs: 1000,
    signal: new AbortController().signal,
    outputSchema: runtimeZ.strictObject({ name: runtimeZ.string() }),
  });
  assert.equal(reply.kind, "success");
  assert.equal(providerCalls, 1);
  const journal = f.db.rows("agent_execution_invocations")[0]!;
  assert.equal(journal.state, "terminal");
  assert.equal(journal.receipt.quantities[1].quantity, 10);
  const provider = journal.provider;
  assert.equal(
    (await api.capacity.issueSend(principal, { binding, provider })).permitted,
    false,
  );
  await assert.rejects(
    api.capacity.prepare(principal, {
      binding: { ...binding, invocationId: "call:excess" },
      provider,
    }),
  );
  now = new Date(+now + 30000);
  assert.equal(await api.capacity.available(), false);
  assert.equal(
    (await api.control.heartbeat(principal, f.lease(w))).continue,
    true,
  );
  await assert.rejects(
    api.capacity.transition(
      principal,
      { ...binding, fence: w.fence + 1 },
      "terminal",
    ),
  );
  assert.equal(run.limits.failures, 0);
  now = new Date(+now + 300001);
  assert.equal(await api.control.reconcile(run.id), "failed");
  assert.equal(
    f.db.rows("agent_runs").find((r) => r.id === run.id)!.status,
    "failed",
  );
  // Replay of the real classifier receipt cannot release a newer slot or regain authority.
  const slot = f.db.rows("agent_execution_slots")[0]!;
  slot.binding = { ...slot.binding, invocationId: "call:newer" };
  slot.state = "occupied";
  const before = structuredClone(slot);
  assert.equal(
    (await api.capacity.evidence(principal, journal.receipt)).accepted,
    true,
  );
  assert.deepEqual(slot, before);
  await assert.rejects(
    api.capacity.evidence(principal, {
      ...journal.receipt,
      binding: { ...journal.receipt.binding, fence: w.fence + 1 },
    }),
  );
  assert.deepEqual(slot, before);
  assert.equal(
    (
      await api.capacity.evidence(principal, {
        ...journal.receipt,
        status: "failed",
      })
    ).accepted,
    false,
  );
  assert.equal(
    f.db.rows("agent_execution_controls")[0]!.state,
    "integrity_hold",
  );
  assert.deepEqual(slot, before);
  assert.equal(providerCalls, 1);
});
