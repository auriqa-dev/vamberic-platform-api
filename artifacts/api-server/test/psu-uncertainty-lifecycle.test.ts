import {
  protocolArtifacts,
  protocolMongoStructure,
} from "../src/db/agent-protocol-validators";
import { workspaceTarget, grantPermits } from "../src/domain/agent-operator";
import test from "node:test";
import assert from "node:assert/strict";
import {
  PRODUCT_UNCERTAINTY_MANIFEST,
  PRODUCT_GENERAL_MANIFEST,
  digest,
  productCriteria,
  type RuntimeClaimedWork,
} from "@workspace/agent-runtime-protocol";
import { workspaceAgentFixture } from "./helpers/workspace-agent-v16";
import { mutateHiveDefinition } from "../src/services/hive-definitions";
import { createProductAgent } from "../../../../vamberic-agent-runtime/dist/src/agents/product-service-understanding/index.js";
import { FakeClock } from "../../../../vamberic-agent-runtime/dist/src/runtime/clock.js";
import { FakeModel } from "../../../../vamberic-agent-runtime/dist/src/models/fake.js";
import { FakePlatformContext } from "../../../../vamberic-agent-runtime/dist/src/platform/context.js";
import { ImplementationRegistry } from "../../../../vamberic-agent-runtime/dist/src/registry/registry.js";
import { MemoryDiagnostics } from "../../../../vamberic-agent-runtime/dist/src/telemetry/diagnostics.js";
import { executeAttempt } from "../../../../vamberic-agent-runtime/dist/src/runtime/executor.js";
for (const answerMode of ["current_claim", "unknown"])
  test(`same-target uncertainty lifecycle: ${answerMode}`, async (t) => {
    const f = await workspaceAgentFixture(true, PRODUCT_UNCERTAINTY_MANIFEST);
    t.mock.method(Date, "now", () => f.now.getTime());
    const domainName = "MOCK meter report",
      append = false,
      rich = false;
    const candidate = {
      name: domainName,
      description: "A remote assessment report.",
      whatItIs: "Meter-data assessment",
      whatCustomerBuys: "An assessment report",
      capabilities: ["Meter data analysis"],
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
    const c = await f.effects.create(f.queen, f.workspaceId, {
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
    let current = (await f.effects.read(f.queen, c.id)).case;
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
    current = (await f.effects.read(f.queen, c.id)).case;
    assert.equal(current.status, "held");
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
        },
      },
    };
    const baseline = structuredClone(f.db.records);
    for (const fault of [
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
        await assert.rejects(f.effects.create(f.queen, f.workspaceId, bad));
      });
    f.db.records = structuredClone(baseline);
    await assert.rejects(
      f.effects.create(f.queen, f.workspaceId, request),
      /Uncertainty implementation required/,
    );
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
    next = await workspaceAgentFixture(true, PRODUCT_UNCERTAINTY_MANIFEST);
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
