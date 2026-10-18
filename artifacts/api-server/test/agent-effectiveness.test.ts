import test from "node:test";
import assert from "node:assert/strict";
import { effectivenessFixture } from "./helpers/effectiveness-fixture";
import { EffectivenessCaseSchema } from "../src/domain/agent-effectiveness";

test("separate maker and evaluator Runs produce immutable Results and a deterministic pass", async () => {
  const f = await effectivenessFixture();
  const c = await f.effects.create(f.queen, f.workspaceId, f.request);
  const maker = await f.claim(c.rootRunId);
  await f.control.outcome(f.principal, f.lease(maker), f.result(maker));
  const next = f.db.rows("agent_effectiveness_cases")[0]!;
  assert.equal(next.status, "evaluating");
  assert.notEqual(next.activeRunId, c.rootRunId);
  const evaluator = await f.claim(next.activeRunId);
  const outcome = f.result(evaluator);
  const receipt = await f.control.outcome(
    f.principal,
    f.lease(evaluator),
    outcome,
  );
  assert.deepEqual(
    await f.control.outcome(f.principal, f.lease(evaluator), outcome),
    receipt,
  );
  const passed = await f.effects.read(f.queen, c.id);
  assert.equal(passed.case.status, "passed");
  assert.equal(passed.case.candidates.length, 1);
  assert.equal(passed.case.evaluations.length, 1);
  assert.equal(f.db.rows("agent_runs").length, 2);
  assert.equal(f.db.rows("agent_results").length, 2);
  EffectivenessCaseSchema.parse(passed.case);
});
test("failed criterion creates a revision Run, then independently evaluates v2", async () => {
  const f = await effectivenessFixture();
  const c = await f.effects.create(f.queen, f.workspaceId, f.request);
  const maker = await f.claim(c.rootRunId);
  await f.control.outcome(f.principal, f.lease(maker), f.result(maker));
  const e = await f.claim(
    f.db.rows("agent_effectiveness_cases")[0]!.activeRunId,
  );
  await f.control.outcome(f.principal, f.lease(e), f.result(e, "fail"));
  const r = await f.claim(
    f.db.rows("agent_effectiveness_cases")[0]!.activeRunId,
  );
  assert.equal(r.operation, "revise");
  await f.control.outcome(
    f.principal,
    f.lease(r),
    f.result(r, "pass", "better"),
  );
  const e2 = await f.claim(
    f.db.rows("agent_effectiveness_cases")[0]!.activeRunId,
  );
  await f.control.outcome(f.principal, f.lease(e2), f.result(e2));
  const state = (await f.effects.read(f.queen, c.id)).case;
  assert.equal(state.status, "passed");
  assert.equal(state.candidates.length, 2);
  assert.equal(
    state.candidates[1]!.predecessorDigest,
    state.candidates[0]!.reference.contentDigest,
  );
  assert.equal(f.db.rows("agent_results").length, 4);
});
test("repeated candidate stops automatic revision and escalates to Queen", async () => {
  const f = await effectivenessFixture();
  const c = await f.effects.create(f.queen, f.workspaceId, f.request);
  const m = await f.claim(c.rootRunId);
  await f.control.outcome(f.principal, f.lease(m), f.result(m));
  const e = await f.claim(
    f.db.rows("agent_effectiveness_cases")[0]!.activeRunId,
  );
  await f.control.outcome(f.principal, f.lease(e), f.result(e, "fail"));
  const r = await f.claim(
    f.db.rows("agent_effectiveness_cases")[0]!.activeRunId,
  );
  await f.control.outcome(f.principal, f.lease(r), f.result(r));
  const state = (await f.effects.read(f.queen, c.id)).case;
  assert.equal(state.status, "escalated");
  assert.equal(state.reason, "no_progress");
  await assert.rejects(
    f.effects.review(f.queen, c.id, {
      expectedRevision: state.stateRevision,
      requestKey: "override",
      action: "pass",
      reason: "Override",
    }),
  );
});
test("explicit evaluation permissions and schema v11 are required; client role gives no automatic authority", async () => {
  const f = await effectivenessFixture();
  await assert.rejects(f.effects.create(f.client, f.workspaceId, f.request));
  f.db.rows("schema_versions")[0]!.version = 10;
  await assert.rejects(f.effects.create(f.queen, f.workspaceId, f.request));
  assert.equal(f.db.rows("agent_runs").length, 0);
});

async function evaluated(
  assessment: "pass" | "fail" | "uncertain" = "uncertain",
) {
  const f = await effectivenessFixture();
  const c = await f.effects.create(f.queen, f.workspaceId, f.request);
  const m = await f.claim(c.rootRunId);
  await f.control.outcome(f.principal, f.lease(m), f.result(m));
  const e = await f.claim(
    f.db.rows("agent_effectiveness_cases")[0]!.activeRunId,
  );
  await f.control.outcome(f.principal, f.lease(e), f.result(e, assessment));
  return { ...f, caseId: c.id };
}
test("uncertainty holds; Queen review and explicit reevaluation preserve history and request idempotency", async () => {
  const f = await evaluated();
  let c = (await f.effects.read(f.queen, f.caseId)).case;
  assert.equal(c.status, "held");
  const review = {
    expectedRevision: c.stateRevision,
    requestKey: "review",
    action: "hold",
    reason: "Resolve uncertainty",
  };
  await assert.rejects(f.effects.review(f.client, c.id, review));
  c = await f.effects.review(f.queen, c.id, review);
  assert.equal(c.dispositions.length, 1);
  assert.equal(
    (await f.effects.review(f.queen, c.id, review)).dispositions.length,
    1,
  );
  const request = {
    expectedRevision: c.stateRevision,
    requestKey: "reeval",
    reason: "Verifier restored",
  };
  const next = await f.effects.requestExecution(
    f.queen,
    c.id,
    "evaluator",
    request,
  );
  assert.equal(
    (await f.effects.requestExecution(f.queen, c.id, "evaluator", request))
      .runId,
    next.runId,
  );
  await assert.rejects(
    f.effects.requestExecution(f.queen, c.id, "evaluator", {
      ...request,
      reason: "changed",
    }),
  );
  const e = await f.claim(next.runId);
  await f.control.outcome(f.principal, f.lease(e), f.result(e));
  c = (await f.effects.read(f.queen, c.id)).case;
  assert.equal(c.status, "passed");
  assert.equal(c.evaluations.length, 2);
  assert.equal(c.decisions[0]!.kind, "hold");
  assert.equal(c.dispositions.length, 1);
  const listed = await f.effects.list(f.queen, f.workspaceId, {});
  assert.equal(listed.items.length, 1);
  assert.equal(
    (await f.effects.list(f.client, f.workspaceId, {})).items.length,
    0,
  );
});
test("cancel closes case and fences the active worker without losing prior candidates", async () => {
  const f = await effectivenessFixture();
  const c = await f.effects.create(f.queen, f.workspaceId, f.request);
  const w = await f.claim(c.rootRunId);
  const closed = await f.effects.cancel(f.queen, c.id);
  assert.equal(closed.status, "closed");
  assert.equal(closed.activeRunId, undefined);
  await assert.rejects(f.control.outcome(f.principal, f.lease(w), f.result(w)));
  assert.equal((await f.effects.cancel(f.queen, c.id)).status, "closed");
  assert.equal(f.db.rows("agent_results").length, 0);
});
test("total case allocations never recycle spend; exhausted next execution retains accepted Result", async () => {
  const f = await effectivenessFixture();
  const prepare = f.p.prepareCase;
  f.p.prepareCase = async (ctx) => {
    const x = await prepare(ctx);
    return {
      ...x,
      totalBudget: { ...x.totalBudget, cost: { currency: "GBP", amount: "1" } },
    };
  };
  const c = await f.effects.create(f.queen, f.workspaceId, f.request);
  const w = await f.claim(c.rootRunId);
  await f.control.outcome(f.principal, f.lease(w), f.result(w));
  const state = (await f.effects.read(f.queen, c.id)).case;
  assert.equal(state.status, "held");
  assert.equal(state.reason, "next_execution_unavailable");
  assert.equal(state.candidates.length, 1);
  assert.equal(state.allocations.length, 1);
  assert.equal(f.db.rows("agent_results").length, 1);
});
test("policy withdrawal and changed immutable candidate bytes prevent pass reuse", async () => {
  const f = await evaluated("pass");
  const c = await f.effects.read(f.queen, f.caseId);
  assert.equal(c.fresh, true);
  f.db.rows("agent_definitions")[0]!.data.effectiveness = [];
  assert.equal((await f.effects.read(f.queen, f.caseId)).fresh, false);
  await assert.rejects(
    f.effects.requestExecution(f.queen, f.caseId, "evaluator", {
      expectedRevision: c.case.stateRevision,
      requestKey: "after-withdrawal",
      reason: "Try again",
    }),
  );
});
test("wrong worker and fence cannot submit an Effectiveness outcome", async () => {
  const f = await effectivenessFixture();
  const c = await f.effects.create(f.queen, f.workspaceId, f.request);
  const w = await f.claim(c.rootRunId);
  const other = f.workloads.authenticated({
    environment: "test",
    clientId: "runtime",
    workerId: "other",
    workloadClass: "agent_runtime",
    scopes: ["claim", "heartbeat", "context", "outcome", "receipt", "usage"],
  });
  await assert.rejects(f.control.outcome(other, f.lease(w), f.result(w)));
  await assert.rejects(
    f.control.outcome(
      f.principal,
      { ...f.lease(w), fence: w.fence + 1 },
      f.result(w),
    ),
  );
  assert.equal(f.db.rows("agent_results").length, 0);
});
test("a fresh service instance recovers persisted state and receipt replay does not schedule twice", async () => {
  const f = await evaluated();
  const { createAgentEffectiveness } =
    await import("../src/services/agent-effectiveness");
  const recovered = createAgentEffectiveness(
    f.config,
    f.db.mongo,
    f.workloads,
    f.readiness,
    [f.p],
    () => f.now,
  );
  const c = (await recovered.read(f.queen, f.caseId)).case;
  const r = await recovered.requestExecution(f.queen, c.id, "evaluator", {
    expectedRevision: c.stateRevision,
    requestKey: "recover",
    reason: "Resolved",
  });
  assert.ok(r.runId);
  assert.equal(f.db.rows("agent_runs").length, 3);
});

test("closed cases cannot reopen and changed criteria use a separately linked case", async () => {
  const f = await evaluated();
  let c = (await f.effects.read(f.queen, f.caseId)).case;
  c = await f.effects.review(f.queen, c.id, {
    expectedRevision: c.stateRevision,
    requestKey: "close",
    action: "close",
    reason: "Use newly frozen context",
  });
  await assert.rejects(
    f.effects.review(f.queen, c.id, {
      expectedRevision: c.stateRevision,
      requestKey: "reopen",
      action: "hold",
      reason: "Reopen",
    }),
  );
  const next = await f.effects.create(f.queen, f.workspaceId, {
    ...f.request,
    requestKey: "new-context",
    predecessorCaseId: c.id,
  });
  assert.equal(next.predecessorCase?.id, c.id);
  assert.notEqual(next.rootRunId, c.rootRunId);
  assert.equal((await f.effects.read(f.queen, c.id)).case.status, "closed");
});
test("partial maker Knowledge Gap remains a hold without a fabricated Candidate or Evaluation", async () => {
  const { digestWithout } = await import("@workspace/agent-runtime-protocol");
  const { readFileSync } = await import("node:fs");
  const f = await effectivenessFixture();
  const c = await f.effects.create(f.queen, f.workspaceId, f.request);
  const w = await f.claim(c.rootRunId);
  const result = f.result(w);
  const gap = JSON.parse(
    readFileSync(
      new URL(
        "../../../lib/agent-runtime-protocol/fixtures/gapBlocking.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  result.outcome.content.knowledgeGaps = [
    {
      ...gap.outcome.content.knowledgeGaps[0],
      lineageIds: [],
      checked: ["Reviewed the synthetic input"],
    },
  ];
  result.outcome.completeness = gap.outcome.completeness;
  result.payloadDigest = digestWithout(result, "payloadDigest");
  await f.control.outcome(f.principal, f.lease(w), result);
  const state = (await f.effects.read(f.queen, c.id)).case;
  assert.equal(state.status, "held");
  assert.equal(state.reason, "knowledge_gap");
  assert.equal(state.candidates.length, 0);
  assert.equal(state.evaluations.length, 0);
});

test("maker permission never delegates evaluator/revision authority; revocation stops the whole case", async () => {
  const f = await effectivenessFixture();
  const { createAgentOperatorService } =
    await import("../src/services/agent-operators");
  const operators = createAgentOperatorService(
    f.config,
    f.db.mongo,
    {
      async operations() {
        return ["exercise", "evaluate", "revise"];
      },
    },
    () => f.now,
  );
  const body = {
    membershipId: f.membership.id,
    expectedUpdatedAt: f.membership.updatedAt.toISOString(),
    target: { kind: "client_agent", id: f.agent.id, revision: 1 },
    operations: ["exercise"],
  };
  await operators.grant(f.queen, f.workspaceId, body);
  await assert.rejects(f.effects.create(f.client, f.workspaceId, f.request));
  assert.equal(f.db.rows("agent_runs").length, 0);
  const membership = f.db
    .rows("workspace_memberships")
    .find((x) => x.id === f.membership.id)!;
  await operators.grant(f.queen, f.workspaceId, {
    ...body,
    expectedUpdatedAt: membership.updatedAt.toISOString(),
    operations: ["exercise", "evaluate", "revise"],
  });
  const c = await f.effects.create(f.client, f.workspaceId, f.request);
  const w = await f.claim(c.rootRunId);
  membership.status = "revoked";
  membership.updatedAt = new Date(f.now.getTime() + 1);
  assert.deepEqual(await f.control.heartbeat(f.principal, f.lease(w)), {
    continue: false,
  });
  assert.equal(f.db.rows("agent_effectiveness_cases")[0]!.status, "held");
  await assert.rejects(f.effects.read(f.client, c.id));
  assert.equal((await f.effects.read(f.queen, c.id)).case.id, c.id);
});

test("imported evidence is exact authorized Result data, without inherited provider grant or usage", async () => {
  const f = await effectivenessFixture();
  const { readFileSync } = await import("node:fs");
  const { digest, digestWithout, EvaluationInputSchema } =
    await import("@workspace/agent-runtime-protocol");
  const evidence = JSON.parse(
    readFileSync(
      new URL(
        "../../../lib/agent-runtime-protocol/fixtures/evidence.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const prepare = f.p.prepareRun;
  f.p.prepareRun = async (context) => {
    const prepared = await prepare(context);
    const work = prepared.frozen;
    if (context.role === "maker")
      work.grant.models = [
        {
          provider: "fake_provider",
          model: "fake_model",
          purpose: "summarize",
        },
      ];
    if (context.role === "evaluator") {
      const candidate = context.case.candidates.at(-1)!.reference;
      const input = EvaluationInputSchema.parse(work.input);
      input.importedSupport = [
        {
          localEvidenceId: "imported:1",
          sourceResultId: candidate.resultId,
          sourceEnvelopeDigest: candidate.envelopeDigest,
          sourceEvidenceId: evidence.id,
          sourceEvidenceDigest: digest(evidence),
        },
      ];
      work.input = JSON.parse(JSON.stringify(input));
      work.context.references[0]!.fields.push("evidence");
      work.context.snapshots[0]!.fields.push("evidence");
      work.grant.resources[0]!.fields.push("evidence");
      const snapshot = work.context.snapshots[0]!;
      snapshot.payload = {
        ...(snapshot.payload as object),
        evidence: [evidence],
      };
      snapshot.payloadDigest = digest(snapshot.payload);
    }
    return prepared;
  };
  const c = await f.effects.create(f.queen, f.workspaceId, f.request);
  const m = await f.claim(c.rootRunId);
  const maker = f.result(m);
  maker.outcome.content.evidence = [evidence];
  maker.payloadDigest = digestWithout(maker, "payloadDigest");
  await f.control.outcome(f.principal, f.lease(m), maker);
  const e = await f.claim(
    f.db.rows("agent_effectiveness_cases")[0]!.activeRunId,
  );
  assert.deepEqual(e.grant.models, []);
  const evaluation = f.result(e);
  evaluation.outcome.content.evidence = [{ ...evidence, id: "imported:1" }];
  evaluation.payloadDigest = digestWithout(evaluation, "payloadDigest");
  const forged = structuredClone(evaluation);
  forged.outcome.content.evidence[0]!.claim = "Unsupported rewrite";
  forged.payloadDigest = digestWithout(forged, "payloadDigest");
  await assert.rejects(f.control.outcome(f.principal, f.lease(e), forged));
  await f.control.outcome(f.principal, f.lease(e), evaluation);
  const state = (await f.effects.read(f.queen, c.id)).case;
  assert.equal(state.status, "passed");
  assert.equal(f.db.rows("agent_usage_observations").length, 0);
  assert.deepEqual(
    f.db.rows("agent_results")[1]!.envelope.outcome.content.evidence[0]
      .provenance,
    evidence.provenance,
  );
});

test("pre-execution rejection holds a case without fabricating Result provenance", async () => {
  const f = await effectivenessFixture();
  const c = await f.effects.create(f.queen, f.workspaceId, f.request);
  const w = await f.claim(c.rootRunId);
  assert.deepEqual(
    await f.control.rejectWork(f.principal, f.lease(w), "configuration_error"),
    { status: "terminal" },
  );
  const state = (await f.effects.read(f.queen, c.id)).case;
  assert.equal(state.status, "held");
  assert.equal(state.activeRunId, undefined);
  assert.equal(state.candidates.length, 0);
  assert.equal(f.db.rows("agent_results").length, 0);
});
test("reviewed required profile cannot be bypassed by removing the Run case link", async () => {
  const f = await effectivenessFixture();
  const c = await f.effects.create(f.queen, f.workspaceId, f.request);
  const row = f.db.rows("agent_runs")[0]!;
  const frozen = structuredClone(row.frozen);
  const runId = (await import("../src/domain/ids")).generatePlatformId(
    "agentrun",
  );
  frozen.runId = runId;
  frozen.grant.runId = runId;
  f.db.rows("agent_definitions")[0]!.data.effectiveness = [];
  await assert.rejects(
    f.control.acceptPrepared(f.queen, {
      frozen,
      manifest: f.manifest,
      limits: row.limits,
      requestKey: "bypass",
    }),
  );
  assert.equal(f.db.rows("agent_runs").length, 1);
  assert.equal(f.db.rows("agent_effectiveness_cases")[0]!.id, c.id);
});

test("repeated normalized defects escalate even when revision content changed", async () => {
  const f = await evaluated("fail");
  const r = await f.claim(
    f.db.rows("agent_effectiveness_cases")[0]!.activeRunId,
  );
  await f.control.outcome(
    f.principal,
    f.lease(r),
    f.result(r, "pass", "changed output"),
  );
  const e = await f.claim(
    f.db.rows("agent_effectiveness_cases")[0]!.activeRunId,
  );
  await f.control.outcome(f.principal, f.lease(e), f.result(e, "fail"));
  const c = (await f.effects.read(f.queen, f.caseId)).case;
  assert.equal(c.status, "escalated");
  assert.equal(c.reason, "no_progress");
  assert.equal(c.allocations.filter((a) => a.role === "revision").length, 1);
});
test("case listing uses bounded scoped cursor pages", async () => {
  const f = await effectivenessFixture();
  for (let i = 0; i < 3; i++)
    await f.effects.create(f.queen, f.workspaceId, {
      ...f.request,
      requestKey: "case:" + i,
    });
  const first = await f.effects.list(f.queen, f.workspaceId, { limit: 2 });
  assert.equal(first.items.length, 2);
  const next = await f.effects.list(f.queen, f.workspaceId, {
    limit: 2,
    after: first.next,
  });
  assert.equal(next.items.length, 1);
  assert.ok(!first.items.some((c) => c.id === next.items[0]!.id));
  await assert.rejects(f.effects.list(f.queen, f.workspaceId, { limit: 101 }));
});
