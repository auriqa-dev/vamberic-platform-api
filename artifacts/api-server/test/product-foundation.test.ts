import test from "node:test";
import assert from "node:assert/strict";
import {
  digest,
  digestWithout,
  emptyContent,
  PRODUCT_MANIFEST,
  ProductScopeSchema,
  productCriteria,
  type ClaimedWork,
  type ResultContent,
} from "@workspace/agent-runtime-protocol";
import { effectivenessFixture } from "./helpers/effectiveness-fixture";
import { createProductFoundationProfile } from "../src/services/product-service-understanding/preparation";
import { PRODUCT_EFFECTIVENESS } from "../src/services/product-service-understanding/profile";
import { createAgentEffectiveness } from "../src/services/agent-effectiveness";
import { createAgentControlPlane } from "../src/services/agent-control-plane";
import { createAgentExecutionReadiness } from "../src/services/agent-execution-readiness";
import { createAgentProposalReview } from "../src/services/agent-proposals";
import { mutateHiveDefinition } from "../src/services/hive-definitions";
import { approvedProductContext } from "../src/services/product-service-understanding/context";
import { createProductAgent } from "../../../../vamberic-agent-runtime/dist/src/agents/product-service-understanding/index.js";
import { FakeClock } from "../../../../vamberic-agent-runtime/dist/src/runtime/clock.js";
import { FakeModel } from "../../../../vamberic-agent-runtime/dist/src/models/fake.js";
import { FakePlatformContext } from "../../../../vamberic-agent-runtime/dist/src/platform/context.js";
import { ImplementationRegistry } from "../../../../vamberic-agent-runtime/dist/src/registry/registry.js";
import { MemoryDiagnostics } from "../../../../vamberic-agent-runtime/dist/src/telemetry/diagnostics.js";
import { executeAttempt } from "../../../../vamberic-agent-runtime/dist/src/runtime/executor.js";

function domain(scope: unknown, statements: unknown[] = [], complete = false) {
  return {
    kind: "product_service_understanding",
    schemaVersion: 1,
    scope,
    ...(complete ? { proposalId: "offering_understanding" } : {}),
    statements,
    components: [],
    currentCommercialReality: [],
    currentCustomerReality: [],
    claims: [],
    contradictions: [],
    gapContexts: [],
    resolvedPrerequisites: [],
    changes: [],
    review: { summary: "Synthetic meter assessment", confirmationTopics: [] },
  };
}
const candidate = {
  name: "Meter assessment",
  description:
    "A remote meter-data assessment with a report; installation excluded.",
  whatItIs: "Meter-data assessment",
  whatCustomerBuys: "An assessment report",
  capabilities: ["Meter-data analysis"],
  engagementModel: "Remote one-off delivery",
  boundaries: ["Installation excluded"],
};
function answered(
  work: ClaimedWork,
  supplied: Record<string, string | string[]> = candidate,
): ResultContent {
  assert.equal(work.resume?.kind, "input");
  if (work.resume?.kind !== "input") throw new Error("answer missing");
  const response = work.resume.response;
  const content = emptyContent();
  const input = work.input as Record<string, unknown>;
  const scope = ProductScopeSchema.parse(input.scope);
  assert.equal(scope.mode, "create");
  if (scope.mode !== "create") throw new Error("scope");
  const lineage = {
    id: `input:${response.requestId}`,
    role: "consumed" as const,
    purpose: "Attributed Product clarification",
    source: {
      kind: "input" as const,
      requestId: response.requestId,
      contentHash: digest(response),
    },
    observedAt: response.answeredAt,
    fetchedAt: response.answeredAt,
  };
  content.lineage = [lineage];
  // The Brand parent is also consumed and must remain current.
  const grant = work.grant.resources[0]!;
  const requested = work.lineage[0]!;
  const parent = {
    ...requested,
    id: `consumed:${digest(grant).slice(0, 40)}`,
    role: "consumed" as const,
    fetchedAt: response.answeredAt,
  };
  content.lineage.push(parent);
  const concepts = [
    "identity",
    "identity",
    "substance",
    "receipt",
    "capability",
    "delivery",
    "constraint",
  ];
  const statements = Object.entries(supplied).map(([field, value], i) => {
    content.evidence.push({
      id: `e${i}`,
      origin: "user_supplied",
      claim: `The respondent supplied ${field}`,
      candidate: { field, value },
      source: { kind: "reference", id: response.requestId },
      observedAt: response.answeredAt,
      retrievedAt: response.answeredAt,
      digest: digest(response),
      verification: "observed",
      provenance: {
        provider: "human_input",
        adapterKey: "human_input",
        adapterVersion: 1,
        invocationId: response.requestId,
      },
    });
    content.findings.push({
      id: `f${i}`,
      kind: "evidence_backed_finding",
      statement: `Attributed ${field}`,
      evidenceIds: [`e${i}`],
      lineageIds: [lineage.id],
    });
    return {
      id: `s${i}`,
      concept: concepts[i] ?? "proof",
      findingId: `f${i}`,
      availability: "current",
      canonicalBinding: { field, value },
    };
  });
  content.domainOutput = JSON.parse(
    JSON.stringify(domain(scope, statements, true)),
  );
  content.proposals = [
    {
      id: "offering_understanding",
      targetKind: "offerings",
      target: {
        kind: "create",
        parents: [{ relationship: "brand", reference: scope.brand }],
      },
      candidate: supplied,
      evidenceIds: content.evidence.map((e) => e.id),
      lineageIds: [lineage.id, parent.id],
      rationale: "Human review of attributed service facts",
    },
  ];
  return content;
}

for (const scenario of ["pass", "revise"] as const)
  test(`Product foundation ${scenario}: attributed input, independent evaluator, controlled application and approval`, async (t) => {
    const f = await effectivenessFixture();
    t.mock.method(Date, "now", () => f.now.getTime());
    const def = f.db.rows("agent_definitions")[0]!;
    def.key = "product_service_understanding";
    def.version = 1;
    def.data.executionImplementation = {
      ...PRODUCT_MANIFEST.implementation,
      manifestDigest: PRODUCT_MANIFEST.manifestDigest,
      protocolVersion: "1.1",
    };
    def.data.effectiveness = [PRODUCT_EFFECTIVENESS];
    def.data.hiveAccess.readResources = ["brands", "offerings"];
    def.data.hiveAccess.proposeResources = ["offerings"];
    const profile = createProductFoundationProfile(
      f.config,
      PRODUCT_MANIFEST,
      () => f.now,
    );
    const readiness = createAgentExecutionReadiness(
      {
        async manifest() {
          return PRODUCT_MANIFEST;
        },
        async available() {
          return true;
        },
      },
      {
        async allowed() {
          return true;
        },
        async dependencies() {
          return [];
        },
        allowInternal: true,
      },
    );
    const effects = createAgentEffectiveness(
      f.config,
      f.db.mongo,
      f.workloads,
      readiness,
      [profile],
      () => f.now,
    );
    const control = createAgentControlPlane(
      f.config,
      f.db.mongo,
      f.workloads,
      readiness.policy,
      () => f.now,
      effects.hooks,
    );
    const c = await effects.create(f.queen, f.workspaceId, {
      ...f.request,
      operation: "understand",
      input: {
        mode: "create",
        brandId: f.db.rows("brands")[0]!.id,
        workingLabel: "Meter assessment",
        orientation: "Please understand this service",
      },
    });
    let claims = 0;
    const claim = async (runId: string) => {
      const run = f.db.rows("agent_runs").find((r) => r.id === runId)!;
      return control.claim(f.principal, {
        dispatch: {
          protocolVersion: "1.1",
          environment: "test",
          runId,
          generation: run.generation,
          dispatchId: run.dispatch.id,
          notBefore: run.notBefore.toISOString(),
          traceId: run.frozen.traceId,
        },
        claimId: `product:${++claims}`,
      });
    };
    const run = async (work: ClaimedWork, output: unknown) => {
      assert.ok(
        work.grant.budgets.modelCalls > 0,
        JSON.stringify(work.grant.budgets),
      );
      assert.ok(
        work.grant.budgets.providerCalls.some(
          (p) => p.provider === "fake_provider" && p.calls > 0,
        ),
        JSON.stringify(work.grant.budgets),
      );
      const clock = new FakeClock(f.now.getTime());
      const registry = new ImplementationRegistry();
      registry.register(createProductAgent());
      const model = new FakeModel(clock, [
        { output: JSON.parse(JSON.stringify(output)), latencyMs: 0 },
      ]);
      const result = await executeAttempt(work, {
        clock,
        registry,
        models: [model],
        tools: [],
        platform: new FakePlatformContext([]),
        diagnostics: new MemoryDiagnostics(),
      });
      assert.equal(result.status, "executed");
      if (result.status !== "executed") throw new Error(result.error.code);
      assert.ok(
        ["needs_input", "success"].includes(result.outcome.outcome.kind),
        JSON.stringify(result.outcome.outcome),
      );
      if (work.operation === "revise_understanding") {
        const before = f.db.rows("agent_results").length;
        const forged = structuredClone(result.outcome);
        forged.outcome.content.evidence[0]!.claim = "Forged imported assertion";
        forged.payloadDigest = digestWithout(forged, "payloadDigest");
        await assert.rejects(
          control.outcome(f.principal, f.lease(work), forged),
        );
        const foreign = structuredClone(result.outcome);
        foreign.outcome.content.lineage.push({
          id: "foreign_input",
          role: "consumed",
          purpose: "Attempted foreign input reuse",
          source: {
            kind: "input",
            requestId: "not_this_run",
            contentHash: digest("forged"),
          },
          observedAt: f.now.toISOString(),
          fetchedAt: f.now.toISOString(),
        });
        foreign.payloadDigest = digestWithout(foreign, "payloadDigest");
        await assert.rejects(
          control.outcome(f.principal, f.lease(work), foreign),
        );
        assert.equal(f.db.rows("agent_results").length, before);
        assert.equal(
          result.outcome.usage.filter((u) => u.category === "model").length,
          1,
        );
        assert.ok(!work.grant.models.some((m) => m.provider === "human_input"));
      }
      await control.outcome(f.principal, f.lease(work), result.outcome);
      return result.outcome;
    };
    const supplied =
      scenario === "revise"
        ? {
            ...candidate,
            proofPoints: ["Optional promotional observation to remove"],
          }
        : candidate;
    const maker = await claim(c.rootRunId);
    const partial = emptyContent();
    partial.domainOutput = JSON.parse(
      JSON.stringify(domain((maker.input as Record<string, unknown>).scope)),
    );
    partial.knowledgeGaps = [
      {
        id: "core",
        question: "What does the customer receive and how?",
        whyRequired: "Establish core Product knowledge",
        severity: "blocking",
        checked: [
          "Selected Brand context; launch text is not confirmed evidence",
        ],
        evidenceIds: [],
        findingIds: [],
        lineageIds: [],
        resolution: { kind: "human_input" },
      },
    ];
    await run(maker, {
      kind: "questions",
      content: partial,
      questions: [
        {
          key: "facts",
          label: "Confirm or correct the service facts",
          reason: "Attribute the Product facts to a human response",
        },
      ],
    });
    const waiting = await control.read(f.queen, c.rootRunId);
    const request = f.db
      .rows("agent_runs")
      .find((r) => r.id === c.rootRunId)!.inputRequest;
    await control.respond(f.queen, c.rootRunId, waiting.updatedAt, {
      requestId: request.id,
      values: [{ key: "facts", value: JSON.stringify(supplied) }],
    });
    const resumed = await claim(c.rootRunId);
    assert.notEqual(resumed.attemptId, maker.attemptId);
    await run(resumed, { kind: "draft", content: answered(resumed, supplied) });
    const evaluator = await claim(
      f.db.rows("agent_effectiveness_cases")[0]!.activeRunId,
    );
    assert.notEqual(evaluator.runId, maker.runId);
    const judge = (fail = false) => ({
      assessments: productCriteria()
        .criteria.filter((c) => c.method === "judgement")
        .map((c) => ({
          criterionId: c.id,
          outcome: fail && c.id === "product_offer_boundary" ? "fail" : "pass",
          rationale:
            fail && c.id === "product_offer_boundary"
              ? "Remove the optional promotional proof point"
              : "Synthetic attributed facts satisfy the fixture criterion",
        })),
    });
    await run(evaluator, judge(scenario === "revise"));
    if (scenario === "revise") {
      const revision = await claim(
        f.db.rows("agent_effectiveness_cases")[0]!.activeRunId,
      );
      assert.equal(revision.operation, "revise_understanding");
      const content = answered(resumed, supplied);
      const output = content.domainOutput as Record<string, unknown>;
      output.statements = (
        output.statements as { canonicalBinding: { field: string } }[]
      ).filter((s) => s.canonicalBinding.field !== "proofPoints");
      content.proposals[0]!.candidate = candidate;
      content.proposals[0]!.evidenceIds =
        content.proposals[0]!.evidenceIds.slice(0, 7);
      content.lineage = revision.grant.resources.map((resource) => ({
        ...revision.lineage.find(
          (l) =>
            l.source.kind === "resource" &&
            l.source.reference.id === resource.reference.id,
        )!,
        id: `consumed:${digest(resource).slice(0, 40)}`,
        role: "consumed",
        fetchedAt: f.now.toISOString(),
      }));
      const resultLineage = content.lineage.find(
        (l) =>
          l.source.kind === "resource" &&
          l.source.reference.resourceType === "agent_result_projection",
      )!;
      for (const finding of content.findings)
        finding.lineageIds = [resultLineage.id];
      content.proposals[0]!.lineageIds = content.lineage.map((l) => l.id);
      await run(revision, { kind: "draft", content });
      const next = await claim(
        f.db.rows("agent_effectiveness_cases")[0]!.activeRunId,
      );
      await run(next, judge());
    }

    const state = (await effects.read(f.queen, c.id)).case;
    assert.equal(state.status, "passed");
    const result = f.db
      .rows("agent_results")
      .find((r) => r.id === state.candidates.at(-1)!.reference.resultId)!;
    assert.equal(state.candidates.length, scenario === "revise" ? 2 : 1);
    const review = createAgentProposalReview(
      f.config,
      f.db.mongo,
      control,
      undefined,
      () => f.now,
      effects.eligible,
    );
    await assert.rejects(
      review.apply(f.queen, result.runId, {
        resultId: result.id,
        proposalId: "offering_understanding",
        expectedUpdatedAt: result.updatedAt.toISOString(),
        evidenceIds: [],
      }),
    );
    const applied = await review.apply(f.queen, result.runId, {
      resultId: result.id,
      proposalId: "offering_understanding",
      expectedUpdatedAt: result.updatedAt.toISOString(),
      evidenceIds: result.envelope.outcome.content.proposals[0].evidenceIds,
    });
    const draft = f.db
      .rows("offerings")
      .find((r) => r.id === applied.target!.id)!;
    assert.equal(draft.status, "draft");
    assert.equal(draft.evidence.length, 7);
    await mutateHiveDefinition(
      f.db.mongo,
      f.config,
      f.queen,
      f.workspaceId,
      "offerings",
      "approve",
      { id: draft.id, expectedUpdatedAt: draft.updatedAt.toISOString() },
    );
    const snapshot = f.db
      .rows("hive_definition_revisions")
      .find((r) => r.entityId === draft.id)!;
    assert.ok(approvedProductContext(snapshot, f.workspaceId));
    assert.throws(() =>
      approvedProductContext(snapshot, "workspace_00000000000000000000000001"),
    );
  });

test("Product profile retains two-revision ceiling and disabled overrides", () => {
  assert.equal(PRODUCT_EFFECTIVENESS.maxRevisions, 2);
  assert.equal(PRODUCT_EFFECTIVENESS.required, true);
  assert.deepEqual(
    [
      PRODUCT_EFFECTIVENESS.maker,
      PRODUCT_EFFECTIVENESS.evaluator,
      PRODUCT_EFFECTIVENESS.revision,
    ],
    ["understand", "evaluate_understanding", "revise_understanding"],
  );
  assert.equal(
    productCriteria().criteria.filter((c) => c.importance === "mandatory")
      .length,
    14,
  );
});
