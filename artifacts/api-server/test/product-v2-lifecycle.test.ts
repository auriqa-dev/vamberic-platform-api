import test from "node:test";
import assert from "node:assert/strict";
import {
  digest,
  emptyContent,
  productCriteria,
  type RuntimeClaimedWork,
  type ResultContent,
} from "@workspace/agent-runtime-protocol";
import { workspaceAgentFixture } from "./helpers/workspace-agent-v16";
import { mutateHiveDefinition } from "../src/services/hive-definitions";
import { createProductAgent } from "../../../.integration/vamberic-agent-runtime/dist/src/agents/product-service-understanding/index.js";
import { admitHumanFacts } from "../../../.integration/vamberic-agent-runtime/dist/src/agents/product-service-understanding/fact-admission.js";
import { FakeClock } from "../../../.integration/vamberic-agent-runtime/dist/src/runtime/clock.js";
import { FakeModel } from "../../../.integration/vamberic-agent-runtime/dist/src/models/fake.js";
import { FakePlatformContext } from "../../../.integration/vamberic-agent-runtime/dist/src/platform/context.js";
import { ImplementationRegistry } from "../../../.integration/vamberic-agent-runtime/dist/src/registry/registry.js";
import { MemoryDiagnostics } from "../../../.integration/vamberic-agent-runtime/dist/src/telemetry/diagnostics.js";
import { executeAttempt } from "../../../.integration/vamberic-agent-runtime/dist/src/runtime/executor.js";

for (const schemaVersion of [16, 21, 22])
  for (const scenario of [
    "complete",
    "blocking_gap",
    "revision_clarification",
  ] as const)
    test(`Protocol 2 PSU lifecycle v${schemaVersion} without Client Agent: ${scenario}`, async (t) => {
      const blockingGap = scenario === "blocking_gap";
      const f = await workspaceAgentFixture();
      f.db.rows("schema_versions")[0]!.version = schemaVersion;
      t.mock.method(Date, "now", () => f.now.getTime());
      const candidate = {
        name: "Synthetic meter assessment",
        description: "A remote assessment report.",
        whatItIs: "Meter-data assessment",
        whatCustomerBuys: "An assessment report",
        capabilities: ["Meter data analysis"],
        engagementModel: "Remote one-off delivery",
        boundaries: ["Installation excluded"],
        proofPoints: ["Optional synthetic observation"],
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
        const result = await executeAttempt(w, {
          clock,
          registry,
          models: [
            new FakeModel(clock, [
              { output: JSON.parse(JSON.stringify(output)), latencyMs: 0 },
            ]),
          ],
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
        await f.control.outcome(f.principal, f.lease(w), result.outcome);
        return result.outcome;
      };
      const maker = await claim(c.rootRunId),
        content: ResultContent = emptyContent(),
        source = maker.context.snapshots[0]!;
      const lineage = {
        ...maker.lineage[0]!,
        id: `consumed:${digest(maker.grant.resources[0]!).slice(0, 40)}`,
        role: "consumed" as const,
        fetchedAt: f.now.toISOString(),
      };
      content.lineage = [lineage];
      const concepts = [
        "identity",
        "identity",
        "substance",
        "receipt",
        "capability",
        "delivery",
        "constraint",
        "proof",
      ];
      const statements = Object.entries(candidate).map(([field, value], i) => {
        content.evidence.push({
          id: `e${i}`,
          origin: "user_supplied",
          claim: `Canonical ${field}`,
          candidate: { field, value },
          source: { kind: "reference", id: source.reference.id },
          observedAt: f.now.toISOString(),
          retrievedAt: f.now.toISOString(),
          digest: digest(source.payload),
          verification: "observed",
          provenance: {
            provider: "fake_provider",
            adapterKey: "fake_model_adapter",
            adapterVersion: 1,
            invocationId: "fake:1",
          },
        });
        content.findings.push({
          id: `f${i}`,
          kind: "evidence_backed_finding",
          statement: `Canonical ${field}`,
          evidenceIds: [`e${i}`],
          lineageIds: [lineage.id],
        });
        return {
          id: `s${i}`,
          concept: concepts[i],
          findingId: `f${i}`,
          availability: "current",
          canonicalBinding: { field, value },
        };
      });
      content.domainOutput = JSON.parse(
        JSON.stringify({
          kind: "product_service_understanding",
          schemaVersion: 1,
          scope: (maker.input as Record<string, unknown>).scope,
          proposalId: "offering_understanding",
          statements,
          components: [],
          currentCommercialReality: [],
          currentCustomerReality: [],
          claims: [],
          contradictions: [],
          gapContexts: [],
          resolvedPrerequisites: [],
          changes: [],
          review: { summary: "Synthetic review", confirmationTopics: [] },
        }),
      );
      content.proposals = [
        {
          id: "offering_understanding",
          targetKind: "offerings",
          target: {
            kind: "update",
            reference: source.reference,
            expectedUpdatedAt: row.updatedAt.toISOString(),
          },
          candidate,
          evidenceIds: content.evidence.map((e) => e.id),
          lineageIds: [lineage.id],
          rationale: "Human review",
        },
      ];
      if (blockingGap)
        content.knowledgeGaps = [
          {
            id: "independent_gap",
            question: "What independent constraint remains?",
            whyRequired: "Unresolved synthetic prerequisite",
            severity: "blocking",
            checked: ["Selected Offering"],
            evidenceIds: [],
            findingIds: [],
            lineageIds: [],
            resolution: { kind: "human_input" },
          },
        ];
      await execute(maker, {
        kind: "questions",
        content,
        questions: [
          {
            key: "receipt",
            label: "What report is purchased?",
            reason: "Confirm the exact deliverable",
          },
        ],
      });
      const answer = async (values: unknown[], runId = c.rootRunId) => {
        const r = await f.control.read(f.queen, runId);
        await f.control.respond(f.queen, runId, r.updatedAt, {
          requestId: f.db.rows("agent_runs").find((r) => r.id === runId)!
            .inputRequest.id,
          values,
        });
      };
      await answer([
        {
          key: "receipt",
          value: "A meter assessment report with prioritised findings",
        },
      ]);
      const proposal = {
        key: "confirm_receipt",
        target: "whatCustomerBuys" as const,
        statement: "A meter assessment report with prioritised findings",
        epistemic: "current_claim" as const,
      };
      await execute(await claim(c.rootRunId), { facts: [proposal] });
      await answer([{ key: proposal.key, value: true }]);
      const confirmed = await claim(c.rootRunId),
        facts = admitHumanFacts(confirmed, [proposal]);
      assert.equal(facts[0]!.sourceClassification, "partner_statement");
      await execute(confirmed, {
        selection: [{ target: proposal.target, factIds: [facts[0]!.id] }],
      });
      const state = f.db.rows("agent_effectiveness_cases")[0]!;
      if (blockingGap) {
        assert.equal(state.status, "held");
        assert.equal(state.reason, "knowledge_gap");
        assert.equal(state.candidates.length, 0);
        assert.equal(state.activeRunId, undefined);
        assert.deepEqual(
          f.db.rows("agent_results").at(-1)!.envelope.outcome.content
            .knowledgeGaps,
          content.knowledgeGaps,
        );
        return;
      }
      const immutableMaker = JSON.stringify(
        f.db.rows("agent_results").at(-1)!.envelope,
      );
      assert.ok(state.activeRunId, "An independent evaluator must be queued");
      const evaluator = await claim(state.activeRunId);
      assert.notEqual(evaluator.runId, maker.runId);
      assert.equal(evaluator.operation, "evaluate_understanding");
      await execute(evaluator, {
        assessments: productCriteria()
          .criteria.filter((c) => c.method === "judgement")
          .map((c) => ({
            criterionId: c.id,
            outcome: c.id === "product_offer_boundary" ? "fail" : "pass",
            rationale:
              "Synthetic defect requiring a clearer purchased deliverable",
          })),
      });

      const revision = await claim(
        f.db.rows("agent_effectiveness_cases")[0]!.activeRunId,
      );
      assert.equal(revision.operation, "revise_understanding");
      assert.notEqual(revision.runId, maker.runId);
      assert.notEqual(revision.runId, evaluator.runId);
      const retained = structuredClone(
        revision.context.snapshots.find(
          (s) => s.reference.resourceType === "agent_result_projection",
        )!.payload,
      ) as unknown as ResultContent;
      retained.lineage = revision.grant.resources.map((resource) => ({
        ...revision.lineage.find(
          (l) =>
            l.source.kind === "resource" &&
            l.source.reference.id === resource.reference.id,
        )!,
        id: `consumed:${digest(resource).slice(0, 40)}`,
        role: "consumed" as const,
        fetchedAt: f.now.toISOString(),
      }));
      const imported = retained.lineage.find(
        (l) =>
          l.source.kind === "resource" &&
          l.source.reference.resourceType === "agent_result_projection",
      )!;
      for (const finding of retained.findings)
        finding.lineageIds = [imported.id];
      retained.proposals[0]!.lineageIds = retained.lineage.map((l) => l.id);
      if (scenario === "revision_clarification") {
        await execute(revision, {
          kind: "questions",
          content: { ...emptyContent(), ...retained },
          questions: [
            {
              key: "revision_receipt",
              label: "What exact deliverable corrects the defect?",
              reason: "Fresh facts are required",
            },
          ],
        });
        await answer(
          [
            {
              key: "revision_receipt",
              value: "A synthetic report and briefing",
            },
          ],
          revision.runId,
        );
        const correction = {
          ...proposal,
          key: "confirm_revision_receipt",
          statement: "A synthetic report and briefing",
        };
        await execute(await claim(revision.runId), { facts: [correction] });
        await assert.rejects(
          answer([{ key: correction.key, value: true }], revision.runId),
        );
        const blocked = f.db
          .rows("agent_runs")
          .find((r) => r.id === revision.runId)!;
        assert.equal(blocked.limits.attempts, 2);
        assert.equal(blocked.frozen.grant.budgets.modelCalls, 2);
        assert.equal(blocked.attemptCount, 2);
        assert.equal(blocked.status, "failed");
        assert.equal(blocked.terminalReason, "attempt_limit");
        await assert.rejects(
          claim(revision.runId),
          /Run is not claimable|Resource not found/,
        );
        assert.equal(
          f.db.rows("agent_effectiveness_cases")[0]!.candidates.length,
          1,
        );
        return; // Legacy flow stays bounded without an unclaimable queued state.
      }
      const domain = retained.domainOutput as Record<string, unknown>;
      domain.statements = (
        domain.statements as { canonicalBinding: { field: string } }[]
      ).filter((s) => s.canonicalBinding.field !== "proofPoints");
      delete (retained.proposals[0]!.candidate as Record<string, unknown>)
        .proofPoints;
      retained.proposals[0]!.evidenceIds =
        retained.proposals[0]!.evidenceIds.filter((id) => id !== "e7");
      await execute(revision, {
        kind: "draft",
        content: { ...emptyContent(), ...retained },
      });
      const next = await claim(
        f.db.rows("agent_effectiveness_cases")[0]!.activeRunId,
      );
      await execute(next, {
        assessments: productCriteria()
          .criteria.filter((c) => c.method === "judgement")
          .map((c) => ({
            criterionId: c.id,
            outcome: "pass",
            rationale: "Synthetic exact correction assessed independently",
          })),
      });
      const final = (await f.effects.read(f.queen, c.id)).case;
      assert.equal(
        JSON.stringify(
          f.db
            .rows("agent_results")
            .find((r) => r.id === final.candidates[0]!.reference.resultId)!
            .envelope,
        ),
        immutableMaker,
      );
      assert.equal(final.status, "passed");
      assert.equal(final.candidates.length, 2);
      assert.equal(final.evaluations.length, 2);
      assert.equal(
        f.db.rows("offerings").find((r) => r.id === draft.id)!.status,
        "draft",
      );
      assert.equal(f.db.rows("client_agents").length, 0);
      assert.equal(
        f.db
          .rows("agent_results")
          .every((r) => r.envelope.protocolVersion === "2.0"),
        true,
      );
    });
