import { generatePlatformId } from "../src/domain/ids";
import {
  protocolArtifacts,
  protocolMongoStructure,
} from "../src/db/agent-protocol-validators";
import { workspaceTarget, grantPermits } from "../src/domain/agent-operator";
import test from "node:test";
import assert from "node:assert/strict";
import {
  PRODUCT_REVIEWED_UNCERTAINTY_MANIFEST,
  PRODUCT_GENERAL_MANIFEST,
  digest,
  PSU_REVIEWED_QUESTION,
  productCriteria,
  type RuntimeClaimedWork,
} from "@workspace/agent-runtime-protocol";
import { workspaceAgentFixture } from "./helpers/workspace-agent-v16";
import { mutateHiveDefinition } from "../src/services/hive-definitions";
import { createProductAgent } from "../../../.integration/vamberic-agent-runtime/dist/src/agents/product-service-understanding/index.js";
import { FakeClock } from "../../../.integration/vamberic-agent-runtime/dist/src/runtime/clock.js";
import { FakeModel } from "../../../.integration/vamberic-agent-runtime/dist/src/models/fake.js";
import { FakePlatformContext } from "../../../.integration/vamberic-agent-runtime/dist/src/platform/context.js";
import { ImplementationRegistry } from "../../../.integration/vamberic-agent-runtime/dist/src/registry/registry.js";
import { MemoryDiagnostics } from "../../../.integration/vamberic-agent-runtime/dist/src/telemetry/diagnostics.js";
import { executeAttempt } from "../../../.integration/vamberic-agent-runtime/dist/src/runtime/executor.js";
for (const answerMode of [
  "current_claim",
  "unknown",
  "unrelated_legal",
  "client_claim",
])
  test(`same-target uncertainty lifecycle: ${answerMode}`, async (t) => {
    const f = await workspaceAgentFixture(
      true,
      PRODUCT_REVIEWED_UNCERTAINTY_MANIFEST,
    );
    t.mock.method(Date, "now", () => f.now.getTime());
    const actor = answerMode === "client_claim" ? f.client : f.queen;
    const currentAnswer = answerMode !== "unknown";
    if (answerMode === "client_claim") {
      const m = f.db
        .rows("workspace_memberships")
        .find((m) => m.human.id === f.client.subject)!;
      m.updatedAt = f.now;
      m.agentOperationGrants = [
        {
          id: generatePlatformId("agentoperatorgrant"),
          target: f.target,
          operations: [
            "understand",
            "evaluate_understanding",
            "revise_understanding",
          ],
          grantedAt: f.now,
          grantedBy: {
            type: "human",
            issuer: f.queen.issuer,
            id: f.queen.subject,
          },
        },
      ];
    }
    const domainName =
        answerMode === "unrelated_legal"
          ? "MOCK legal contract review"
          : "MOCK meter report",
      append = false,
      rich = false;
    const candidate = {
      name: domainName,
      description:
        answerMode === "unrelated_legal"
          ? "A legal contract review"
          : "A remote assessment report.",
      whatItIs:
        answerMode === "unrelated_legal"
          ? "Contract document review"
          : "Meter-data assessment",
      whatCustomerBuys: "An assessment report",
      capabilities: [
        answerMode === "unrelated_legal"
          ? "Contract analysis"
          : "Meter data analysis",
      ],
      engagementModel: "Remote one-off delivery",
      ...(!append || rich
        ? {
            boundaries: ["Installation excluded"],
            proofPoints: ["Optional synthetic observation"],
          }
        : {}),
      ...(append
        ? {
            explicitExclusions: [
              "Equipment supply excluded",
              "Installation excluded",
            ],
          }
        : {}),
    };
    const draft = await mutateHiveDefinition(
      f.db.mongo,
      f.config,
      f.queen,
      f.workspaceId,
      "offerings",
      "create",
      { definition: candidate },
    );
    for (const [field, value] of Object.entries(candidate))
      await mutateHiveDefinition(
        f.db.mongo,
        f.config,
        f.queen,
        f.workspaceId,
        "offerings",
        "observe",
        {
          id: draft.id,
          expectedUpdatedAt: f.db
            .rows("offerings")
            .find((r) => r.id === draft.id)!
            .updatedAt.toISOString(),
          evidence: {
            field,
            value,
            origin: "user_supplied",
            provider: "Synthetic canonical fixture",
            observedAt: f.now.toISOString(),
            verification: "observed",
          },
        },
      );
    const row = f.db.rows("offerings").find((r) => r.id === draft.id)!;
    const c = await f.effects.create(actor, f.workspaceId, {
      ...f.request,
      input: {
        mode: "refresh",
        offeringId: row.id,
        expectedUpdatedAt: row.updatedAt.toISOString(),
        workingLabel: candidate.name,
        orientation: "Clarify the purchased deliverable",
      },
    });
    let ordinal = 0;
    const claim = async (runId: string) => {
      const r = f.db.rows("agent_runs").find((r) => r.id === runId)!;
      return f.control.claim(f.principal, {
        dispatch: {
          protocolVersion: "2.0",
          environment: "test",
          runId,
          generation: r.generation,
          dispatchId: r.dispatch.id,
          notBefore: r.notBefore.toISOString(),
          traceId: r.frozen.traceId,
        },
        claimId: `v2:${++ordinal}`,
      });
    };

    const execute = async (w: RuntimeClaimedWork, output: unknown) => {
      const clock = new FakeClock(f.now.getTime()),
        registry = new ImplementationRegistry();
      registry.register(createProductAgent(undefined, f.manifest));
      const model = new FakeModel(clock, [
        { output: JSON.parse(JSON.stringify(output)), latencyMs: 0 },
      ]);
      const result = await executeAttempt(w, {
        clock,
        registry,
        models: [model],
        tools: [],
        platform: new FakePlatformContext([]),
        diagnostics: new MemoryDiagnostics(),
      });
      assert.equal(result.status, "executed");
      if (result.status !== "executed") throw new Error(result.error.code);
      assert.notEqual(
        result.outcome.outcome.kind,
        "failure",
        JSON.stringify(result.outcome.outcome),
      );
      if ((w.input as Record<string, unknown>).uncertaintyOrigin)
        assert.equal(model.calls, 0);
      await assert.rejects(
        f.control.outcome(
          f.principal,
          { ...f.lease(w), fence: w.fence + 1 },
          result.outcome,
        ),
      );
      await f.control.outcome(f.principal, f.lease(w), result.outcome);
      return result.outcome;
    };
    const maker = await claim(c.rootRunId);
    await execute(maker, {
      version: 1,
      kind: "draft",
      sourceIds: Object.entries(candidate).map(
        ([field, value]) =>
          `source:${digest({ reference: maker.grant.resources[0], field, value }).slice(0, 32)}`,
      ),
      questions: [],
    });
    let current = (await f.effects.read(actor, c.id)).case;
    const judgement = (uncertain: boolean) => ({
      assessments: productCriteria()
        .criteria.filter((c) => c.method === "judgement")
        .map((c) => ({
          criterionId: c.id,
          outcome:
            uncertain &&
            ["receipt_and_delivery", "downstream_sufficiency"].includes(c.id)
              ? "uncertain"
              : "pass",
          rationale: "MOCK independent assessment",
        })),
    });
    await execute(
      await claim(current.evaluations.at(-1)!.runId),
      judgement(true),
    );
    current = (await f.effects.read(actor, c.id)).case;
    assert.equal(current.status, "held");
    const oldResults = digest(
      f.db.rows("agent_results").map((r) => r.envelope),
    );
    const allocation = {
      deadline: new Date(f.now.getTime() + 3600000).toISOString(),
      modelCalls: 16,
      toolCalls: 6,
      providerCalls: [
        { provider: "fake_provider", calls: 16 },
        { provider: "public_web", calls: 6 },
      ],
      cost: { currency: "GBP", amount: "1" },
    };
    const acceptedCandidate = f.db
      .rows("agent_results")
      .find((r) => r.id === current.candidates.at(-1)!.reference.resultId)!;
    const acceptedEvaluation = f.db
      .rows("agent_results")
      .find((r) => r.id === current.evaluations.at(-1)!.resultId)!;
    const evidence = acceptedCandidate.envelope.outcome.content.evidence.find(
      (e: { candidate?: { field?: string } }) =>
        e.candidate?.field === "whatItIs",
    );
    assert.ok(evidence);
    const applicability = {
      contractDigest: PSU_REVIEWED_QUESTION.digest,
      support: [
        {
          evidenceId: evidence.id,
          evidenceDigest: digest(evidence),
          field: "candidate.value",
          start: 0,
          excerpt: evidence.candidate.value,
        },
      ],
      assessments: ["receipt_and_delivery", "downstream_sufficiency"].map(
        (criterionId) => ({
          criterionId,
          digest: digest(
            acceptedEvaluation.envelope.outcome.content.domainOutput.assessments.find(
              (a: { criterionId: string }) => a.criterionId === criterionId,
            ),
          ),
        }),
      ),
      confirmations: Object.fromEntries(
        [
          "meterAssessment",
          "dataSupplyUncertainty",
          "bothResponsibilitySlots",
        ].map((key) => [key, { confirmed: true, supportIndexes: [0] }]),
      ),
    };
    const request = {
      ...f.request,
      requestKey: "mock-linked",
      predecessorCaseId: c.id,
      input: {
        mode: "refresh",
        offeringId: row.id,
        expectedUpdatedAt: row.updatedAt.toISOString(),
        workingLabel: candidate.name,
        orientation: "MOCK ONLY",
        uncertainty: {
          expectedRevision: current.stateRevision,
          gapKey: "assessment_input_responsibilities",
          criterionIds: ["receipt_and_delivery", "downstream_sufficiency"],
          allocation,
          applicability,
        },
      },
    };
    if (answerMode === "unrelated_legal") {
      Reflect.deleteProperty(request.input.uncertainty, "applicability");
      const before = JSON.stringify(f.db.records);
      await assert.rejects(f.effects.create(actor, f.workspaceId, request));
      assert.equal(JSON.stringify(f.db.records), before);
      assert.equal((await f.effects.read(actor, c.id)).case.status, "held");
      return;
    }
    const baseline = structuredClone(f.db.records);
    for (const fault of [
      "missing_applicability",
      "forged_actor",
      "wrong_assessment",
      "wrong_support",
      "wrong_excerpt",
      "no_confirmation",
      "wrong_contract",
      "wrong_capacity",
      "inaccessible_source",
      "stale_revision",
      "wrong_criterion",
      "budget",
      "expired_budget",
      "missing_predecessor",
      "candidate",
      "evaluation",
      "criteria",
      "closed",
      "cycle",
      "question_limit",
      "source_changed",
      "forged_origin",
      "old_target",
      "different_target",
    ])
      await t.test(fault, async () => {
        f.db.records = structuredClone(baseline);
        const bad = structuredClone(request);
        const prior = f.db
          .rows("agent_effectiveness_cases")
          .find((x) => x.id === c.id)!;
        if (fault === "old_target" || fault === "different_target") {
          const { id, revision, ...tuple } = prior.target;
          void id;
          void revision;
          prior.target = workspaceTarget({
            ...tuple,
            ...(fault === "old_target"
              ? {
                  implementation: {
                    ...PRODUCT_GENERAL_MANIFEST.implementation,
                    manifestDigest: PRODUCT_GENERAL_MANIFEST.manifestDigest,
                    buildDigest: PRODUCT_GENERAL_MANIFEST.buildDigest,
                  },
                }
              : {
                  definition: {
                    ...tuple.definition,
                    version: tuple.definition.version + 1,
                  },
                }),
          });
        }
        if (fault === "missing_applicability")
          Reflect.deleteProperty(bad.input.uncertainty, "applicability");
        if (fault === "forged_actor")
          Object.assign(bad.input.uncertainty.applicability, {
            actor: { type: "human", id: "forged", issuer: "forged" },
          });
        if (fault === "wrong_assessment")
          bad.input.uncertainty.applicability.assessments[0]!.digest =
            "f".repeat(64);
        if (fault === "wrong_support")
          bad.input.uncertainty.applicability.support[0]!.evidenceDigest =
            "f".repeat(64);
        if (fault === "wrong_excerpt")
          bad.input.uncertainty.applicability.support[0]!.excerpt =
            "Invented meter reference";
        if (fault === "no_confirmation")
          bad.input.uncertainty.applicability.confirmations.meterAssessment!.confirmed = false;
        if (fault === "wrong_contract")
          bad.input.uncertainty.applicability.contractDigest = "f".repeat(64);
        if (fault === "wrong_capacity") {
          await assert.rejects(
            f.effects.create(
              { ...f.queen, subject: "unassigned-human" },
              f.workspaceId,
              bad,
            ),
          );
          return;
        }
        if (fault === "inaccessible_source")
          bad.input.uncertainty.applicability.support[0]!.evidenceId =
            "other-workspace-evidence";
        if (fault === "stale_revision")
          bad.input.uncertainty.expectedRevision++;
        if (fault === "wrong_criterion")
          bad.input.uncertainty.criterionIds = [
            "product_clarity",
            "downstream_sufficiency",
          ];
        if (fault === "budget")
          bad.input.uncertainty.allocation.modelCalls = 100;
        if (fault === "expired_budget")
          bad.input.uncertainty.allocation.deadline = f.now.toISOString();
        if (fault === "missing_predecessor")
          bad.predecessorCaseId = "effectivenesscase_missing";
        if (fault === "candidate")
          prior.candidates[0].reference.contentDigest = "0".repeat(64);
        if (fault === "evaluation")
          prior.evaluations[0].resultId =
            prior.candidates[0].reference.resultId;
        if (fault === "criteria") prior.criteria.digest = "0".repeat(64);
        if (fault === "closed") prior.status = "closed";
        if (fault === "cycle")
          prior.predecessorCase = {
            id: c.id,
            candidateDigest: prior.candidates[0].reference.contentDigest,
            criteriaDigest: prior.criteria.digest,
          };
        if (fault === "question_limit")
          f.db
            .rows("agent_runs")
            .find((r) => r.id === c.rootRunId)!.inputCycles = 3;
        if (fault === "source_changed")
          f.db.rows("offerings").find((r) => r.id === row.id)!.contentHash =
            "0".repeat(64);
        if (fault === "forged_origin")
          Object.assign(bad.input, { uncertaintyOrigin: { kind: "forged" } });
        await assert.rejects(f.effects.create(actor, f.workspaceId, bad));
      });
    f.db.records = structuredClone(baseline);
    const linked = await f.effects.create(actor, f.workspaceId, request);
    assert.equal(
      (await f.effects.create(actor, f.workspaceId, request)).id,
      linked.id,
    );
    await assert.rejects(
      f.effects.create(actor, f.workspaceId, {
        ...request,
        requestKey: "duplicate-origin",
        input: {
          ...request.input,
          uncertainty: {
            ...request.input.uncertainty,
            expectedRevision: current.stateRevision + 1,
          },
        },
      }),
    );
    await assert.rejects(
      f.effects.create(actor, f.workspaceId, {
        ...request,
        input: { ...request.input, orientation: "changed" },
      }),
    );
    assert.equal(
      digest(f.db.rows("agent_results").map((r) => r.envelope)),
      oldResults,
    );
    const allocatedRun = f.db
      .rows("agent_runs")
      .find((r) => r.id === linked.rootRunId)!;
    assert.equal(
      allocatedRun.frozen.input.uncertaintyOrigin.applicability.actor.id,
      actor.subject,
    );
    assert.equal(
      allocatedRun.frozen.input.uncertaintyOrigin.applicability.capacity,
      answerMode === "client_claim" ? "client" : "partner",
    );
    assert.ok(
      f.db
        .rows("events")
        .some(
          (e) =>
            e.eventType === "agent_effectiveness_changed" &&
            e.payload.caseId === linked.id &&
            e.payload.action === "requested_maker",
        ),
    );
    const needed = await execute(await claim(linked.rootRunId), {});
    assert.equal(needed.outcome.kind, "needs_input");
    const run = f.db.rows("agent_runs").find((r) => r.id === linked.rootRunId)!;
    const view = await f.control.read(actor, run.id);
    assert.deepEqual(view.factReview, [
      {
        key: "customer_role",
        target: "customerRole",
        before: null,
        effect: "replace",
      },
      {
        key: "supplier_role",
        target: "supplierRole",
        before: null,
        effect: "replace",
      },
    ]);
    assert.equal("checkpoint" in view, false);
    assert.equal("frozen" in view, false);
    const answer = {
      requestId: run.inputRequest.id,
      values: ["customer_role", "supplier_role"].flatMap((key) => [
        {
          key: `${key}_statement`,
          value: `MOCK ONLY ${key} supplies the agreed data.`,
        },
        {
          key: `${key}_status`,
          value: currentAnswer ? "current_claim" : "unknown",
        },
        { key: `${key}_confirm`, value: currentAnswer },
        { key: `${key}_include`, value: currentAnswer },
      ]),
    };
    const waiting = structuredClone(f.db.records);
    for (const fault of [
      "missing_slot",
      "wrong_question",
      "cancelled",
      "expired",
      "unassigned_actor",
      "stale_source",
      "revoked_authority",
    ]) {
      await t.test("respond rejects " + fault, async () => {
        f.db.records = structuredClone(waiting);
        const bad = structuredClone(answer);
        let responder = actor;
        const stored = f.db.rows("agent_runs").find((r) => r.id === run.id)!;
        if (fault === "missing_slot") bad.values.splice(4, 4);
        if (fault === "wrong_question")
          stored.inputRequest.question = "Different question";
        if (fault === "cancelled")
          await f.control.cancel(actor, run.id, stored.updatedAt.toISOString());
        if (fault === "expired") f.now.setTime(f.now.getTime() + 3600001);
        if (fault === "unassigned_actor")
          responder = { ...actor, subject: "unassigned-human" };
        if (fault === "stale_source")
          f.db.rows("offerings").find((r) => r.id === row.id)!.contentHash =
            "f".repeat(64);
        if (fault === "revoked_authority") {
          if (answerMode === "client_claim")
            f.db
              .rows("workspace_memberships")
              .find((m) => m.human.id === actor.subject)!.agentOperationGrants =
              [];
          else responder = { ...actor, subject: "revoked-queen" };
        }
        try {
          await assert.rejects(
            f.control.respond(
              responder,
              run.id,
              run.updatedAt.toISOString(),
              bad,
            ),
          );
        } finally {
          if (fault === "expired") f.now.setTime(f.now.getTime() - 3600001);
        }
      });
    }
    f.db.records = structuredClone(waiting);
    await f.control.respond(actor, run.id, run.updatedAt.toISOString(), answer);
    f.db.records = structuredClone(f.db.records);
    f.now.setTime(f.now.getTime() + 1000);
    await execute(await claim(linked.rootRunId), {});
    const next = (await f.effects.read(actor, linked.id)).case;
    if (answerMode === "unknown") {
      assert.equal(next.candidates.length, 0);
      assert.equal(next.status, "held");
      return;
    }
    assert.equal(next.candidates.length, 1);
    await execute(
      await claim(next.evaluations.at(-1)!.runId),
      judgement(false),
    );
    assert.equal(
      (await f.effects.read(actor, linked.id)).case.status,
      "passed",
    );
    assert.equal((await f.effects.read(actor, c.id)).case.status, "held");
  });

test("new checkpoint uses existing canonical validator extension points", () => {
  const schema = protocolMongoStructure(protocolArtifacts.Checkpoint!);
  assert.equal(schema.properties.schemaVersion.minimum, 1);
  assert.ok(schema.properties.schemaVersion.maximum >= 2);
  assert.ok(schema.properties.payload.bsonType.includes("object"));
  const request = protocolMongoStructure(protocolArtifacts.InputRequest!);
  assert.equal(request.properties.fields.maxItems, 12);
  assert.equal(request.properties.schemaKey.enum, undefined);
});
test("new implementation changes target identity and does not inherit old grants", async () => {
  const old = await workspaceAgentFixture(true),
    next = await workspaceAgentFixture(
      true,
      PRODUCT_REVIEWED_UNCERTAINTY_MANIFEST,
    );
  const { id: ignored, revision: unused, ...tuple } = old.target;
  void ignored;
  void unused;
  const target = workspaceTarget({
    ...tuple,
    implementation: next.target.implementation,
  });
  assert.notEqual(target.id, old.target.id);
  const grant = {
    target: old.target,
    operations: ["understand"],
    grantedAt: new Date("2020-01-01"),
  } as Parameters<typeof grantPermits>[0];
  assert.equal(grantPermits(grant, old.target, "understand", old.now), true);
  assert.equal(grantPermits(grant, target, "understand", old.now), false);
});
