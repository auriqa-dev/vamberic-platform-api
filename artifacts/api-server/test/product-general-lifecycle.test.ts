import { provisionQueenClient } from "../src/services/hvm-queen-provision";
import { workspaceTarget } from "../src/domain/agent-operator";
import { createPsuGateway } from "../../../.integration/hvm-app-legacy-psu/src/data/psu";
import { losslessEvaluationContext } from "../../../.integration/vamberic-agent-runtime/dist/src/effectiveness/lossless-context.js";
import { encodeOpenAIRequest } from "../../../.integration/vamberic-agent-runtime/dist/src/models/openai/adapter.js";
import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalProductFinding,
  digest,
  digestWithout,
  emptyContent,
  productCriteria,
  type RuntimeClaimedWork,
  type ResultContent,
  type ProductAppendProof,
} from "@workspace/agent-runtime-protocol";
import { workspaceAgentFixture } from "./helpers/workspace-agent-v16";
import { createAgentProposalReview } from "../src/services/agent-proposals";
import { readCanonicalSupport } from "../src/services/canonical-support";
import { currentAgentSource } from "../src/services/agent-proposal-freshness";
import { mutateHiveDefinition } from "../src/services/hive-definitions";
import { admitHumanFacts } from "../../../.integration/vamberic-agent-runtime/dist/src/agents/product-service-understanding/fact-admission.js";
import { createProductAgent } from "../../../.integration/vamberic-agent-runtime/dist/src/agents/product-service-understanding/index.js";

import { FakeClock } from "../../../.integration/vamberic-agent-runtime/dist/src/runtime/clock.js";
import { FakeModel } from "../../../.integration/vamberic-agent-runtime/dist/src/models/fake.js";
import { FakePlatformContext } from "../../../.integration/vamberic-agent-runtime/dist/src/platform/context.js";
import { ImplementationRegistry } from "../../../.integration/vamberic-agent-runtime/dist/src/registry/registry.js";
import { MemoryDiagnostics } from "../../../.integration/vamberic-agent-runtime/dist/src/telemetry/diagnostics.js";
import { executeAttempt } from "../../../.integration/vamberic-agent-runtime/dist/src/runtime/executor.js";

for (const domainName of [
  "Fictional meter report",
  "Fictional archive assessment",
  "Fictional exclusion append",
  "Fictional rich exclusion append",
  "Fictional maker clarification",
  "Fictional repeated exclusion append",
])
  test(`General PSU exact revision: ${domainName}`, async (t) => {
    const f = await workspaceAgentFixture(true);
    t.mock.method(Date, "now", () => f.now.getTime());
    const append = domainName.includes("exclusion append");
    const rich = domainName.includes("rich exclusion");
    const repeated = domainName.includes("repeated exclusion");
    const makerClarification = domainName.includes("maker clarification");
    const correction = append
      ? "Onsite implementation excluded"
      : "A synthetic report and briefing";
    f.db.rows("schema_versions")[0]!.version = append
      ? 18
      : domainName.includes("archive")
        ? 17
        : 16;
    if (domainName === "Fictional meter report") {
      const provisioned = await provisionQueenClient(
        f.config,
        f.db.mongo,
        f.queen,
        f.db.rows("hvm_partners")[0]!.id,
        {
          requestKey: "psu-new-client-walkthrough",
          organisationName: "Fictional Meter Legal Entity",
          workspaceName: "Fictional Meter",
          brandName: "Fictional Meter",
          brandSlug: "fictional-meter",
        },
      );
      f.workspaceId = provisioned.workspaceId;
      const { id: _id, revision: _revision, ...tuple } = f.target;
      void _id;
      void _revision;
      f.target = workspaceTarget({ ...tuple, workspaceId: f.workspaceId });
      f.request.target = f.target;
      assert.equal(
        f.db
          .rows("workspace_memberships")
          .filter((m) => m.workspaceId === f.workspaceId).length,
        0,
      );
      assert.equal(f.db.rows("client_agents").length, 0);
    }
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
    const execute = async (
      w: RuntimeClaimedWork,
      output: unknown,
      beforeOutcome?: () => void,
    ) => {
      const clock = new FakeClock(f.now.getTime()),
        registry = new ImplementationRegistry();
      registry.register(createProductAgent(undefined, f.manifest));
      if (
        w.operation === "evaluate_understanding" &&
        !(
          (rich || repeated) &&
          (w.input as { candidate?: { revision?: number } }).candidate
            ?.revision === (repeated ? 3 : 2)
        )
      ) {
        const payload = w.context.snapshots.find(
          (x) => x.reference.resourceType === "agent_result_projection",
        )!.payload;
        const measurement = losslessEvaluationContext(
          JSON.parse(
            JSON.stringify({
              input: w.input,
              content: payload,
              instruction: f.manifest.instruction,
            }),
          ),
        );
        t.diagnostic(
          JSON.stringify({
            stage: "evaluation_context",
            role: w.operation,
            fullBytes: measurement.fullBytes,
            packedBytes: measurement.packedBytes,
            selectedBytes: measurement.bytes,
            mode: measurement.mode,
          }),
        );
      }
      const model = new FakeModel(clock, [
        { output: JSON.parse(JSON.stringify(output)), latencyMs: 0 },
      ]);
      const invoke = model.invoke.bind(model);
      model.invoke = async (request) => {
        if (w.operation === "evaluate_understanding") {
          const wire = encodeOpenAIRequest(
            "gpt-6-astra",
            "evaluator",
            request.messages,
            request.outputSchema!,
          );
          const bytes = Buffer.byteLength(wire);
          t.diagnostic(JSON.stringify({ stage: "evaluation_wire", bytes }));
          assert.ok(
            bytes <= 24000,
            "Actual encoded evaluator request exceeds hard ceiling",
          );
        }
        return invoke(request);
      };
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
      if (
        (rich || repeated) &&
        w.operation === "evaluate_understanding" &&
        (w.input as { candidate?: { revision?: number } }).candidate
          ?.revision === (repeated ? 3 : 2)
      ) {
        assert.equal(result.outcome.outcome.kind, "failure");
        assert.equal(model.calls, 0);
        await f.control.outcome(f.principal, f.lease(w), result.outcome);
        return result.outcome;
      }
      assert.notEqual(
        result.outcome.outcome.kind,
        "failure",
        JSON.stringify(result.outcome.outcome),
      );
      if (
        append &&
        w.operation === "revise_understanding" &&
        result.outcome.outcome.kind === "success"
      ) {
        const pristine = structuredClone(f.db.records);
        for (const fault of [
          "candidate",
          "evaluation",
          "source_evidence",
          "attestation",
          "response",
        ] as const) {
          f.db.records = structuredClone(pristine);
          const forged = structuredClone(result.outcome);
          const proof = forged.outcome.content.findings.find(
            (x) => x.payload !== undefined,
          )!.payload as unknown as ProductAppendProof;
          if (fault === "candidate")
            proof.prior.candidate.resultId = "other-candidate";
          if (fault === "evaluation")
            proof.prior.evaluation.resultId = "other-evaluation";
          if (fault === "source_evidence")
            forged.outcome.content.evidence[0]!.claim = "Forged observation";
          if (fault === "attestation")
            f.db
              .rows("events")
              .find(
                (e) => e.payload?.operation === "input_answered",
              )!.payload.actor.id = "other-human";
          if (fault === "response")
            f.db
              .rows("agent_runs")
              .find(
                (r) => r.id === w.runId,
              )!.inputResponses[0].values[0].value = "Other answer";
          proof.digest = digestWithout(proof, "digest");
          forged.payloadDigest = digestWithout(forged, "payloadDigest");
          await assert.rejects(
            f.control.outcome(f.principal, f.lease(w), forged),
          );
        }
        f.db.records = pristine;
      }
      beforeOutcome?.();
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
      "constraint",
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
    await execute(maker, {
      version: 1,
      kind: makerClarification ? "questions" : "draft",
      sourceIds: Object.entries(candidate).map(
        ([field, value]) =>
          `source:${digest({ reference: maker.grant.resources[0], field, value }).slice(0, 32)}`,
      ),
      questions: makerClarification
        ? [
            {
              key: "receipt_details",
              label: "What exactly is purchased?",
              reason: "Resolve purchased deliverable",
            },
          ]
        : [],
    });
    // Actual Platform projections are consumed by the app parser, not reshaped fixtures.
    const app = createPsuGateway(
      "https://synthetic.invalid",
      {
        getAccessToken: async () => "synthetic",
        invalidate: () => {},
      },
      async (url) => {
        const path = new URL(String(url)).pathname;
        const match = /\/agent-runs\/([^/]+)(\/results)?$/.exec(path);
        assert.ok(match);
        return Response.json(
          match[2]
            ? await f.control.results(f.queen, match[1]!)
            : await f.control.read(f.queen, match[1]!),
        );
      },
    );
    const answer = async (
      values: { key: string; value: string | boolean }[],
      runId: string,
    ) => {
      const r = await f.control.read(f.queen, runId);
      await app.run(f.workspaceId, runId, new AbortController().signal);
      assert.equal("checkpoint" in r, false);
      if (r.input?.schemaKey === "psu_revision_fact_submission") {
        assert.ok(r.factReview?.length);
        assert.equal("checkpoint" in r.input, false);
      }
      await app.results(runId, new AbortController().signal);
      return f.control.respond(f.queen, runId, r.updatedAt, {
        requestId: f.db.rows("agent_runs").find((r) => r.id === runId)!
          .inputRequest.id,
        values,
      });
    };
    if (makerClarification) {
      await answer(
        [{ key: "receipt_details", value: "A synthetic review pack" }],
        maker.runId,
      );
      const confirm = await claim(maker.runId);
      const fact = {
        key: "confirm_receipt",
        target: "whatCustomerBuys" as const,
        statement: "A synthetic review pack",
        epistemic: "current_claim" as const,
      };
      await execute(confirm, { facts: [fact] });
      await answer([{ key: "confirm_receipt", value: true }], maker.runId);
      const confirmed = await claim(maker.runId);
      const facts = admitHumanFacts(confirmed, [fact]);
      await execute(confirmed, {
        selection: [{ target: "whatCustomerBuys", factIds: [facts[0]!.id] }],
      });
      assert.equal(
        f.db.rows("agent_runs").find((r) => r.id === maker.runId)!.status,
        "completed",
      );
      assert.equal(
        f.db.rows("agent_runs").find((r) => r.id === maker.runId)!.attemptCount,
        3,
      );
    }
    const state = f.db.rows("agent_effectiveness_cases")[0]!;
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
    for (const finding of retained.findings) finding.lineageIds = [imported.id];
    retained.proposals[0]!.lineageIds = retained.lineage.map((l) => l.id);
    await execute(revision, {
      version: 1,
      kind: "slots",
      evidenceIds: [],
      slots: [
        {
          key: "receipt",
          target: append ? "explicitExclusions" : "whatCustomerBuys",
          defectId: "defect:product_offer_boundary",
        },
      ],
    });
    const beforeAnswer = structuredClone(f.db.records);
    for (const fault of ["input", "candidate", "source", "defect"] as const) {
      f.db.records = structuredClone(beforeAnswer);
      const r = f.db.rows("agent_runs").find((r) => r.id === revision.runId)!;
      const pin = r.checkpoint.payload;
      if (fault === "input") pin.inputDigest = "0".repeat(64);
      if (fault === "candidate")
        pin.base.content.domainOutput.review.summary = "Tampered candidate";
      if (fault === "source") pin.base.sourceDigests[0].digest = "0".repeat(64);
      if (fault === "defect") pin.slots[0].defectId = "unknown_defect";
      r.checkpoint.digest = digestWithout(r.checkpoint, "digest");
      r.inputRequest.checkpoint.digest = r.checkpoint.digest;
      await assert.rejects(
        answer(
          [
            {
              key: "receipt_statement",
              value: correction,
            },
            { key: "receipt_status", value: "current_claim" },
            { key: "receipt_confirm", value: true },
            { key: "receipt_include", value: true },
          ],
          revision.runId,
        ),
        /Fact checkpoint/,
      );
    }
    f.db.records = structuredClone(beforeAnswer);
    await answer(
      [
        { key: "receipt_statement", value: correction },
        { key: "receipt_status", value: "current_claim" },
        { key: "receipt_confirm", value: true },
        { key: "receipt_include", value: true },
      ],
      revision.runId,
    );
    const resumed = await claim(revision.runId);
    await execute(resumed, { never: "must not call model" });
    const finished = f.db
      .rows("agent_runs")
      .find((r) => r.id === revision.runId)!;
    assert.equal(finished.attemptCount, 2);
    assert.equal(finished.limits.attempts, 2);
    assert.equal(finished.status, "completed");
    const revisionResults = f.db
      .rows("agent_results")
      .filter((r) => r.runId === revision.runId);
    assert.deepEqual(
      revisionResults.at(-1)!.envelope.outcome.content.proposals[0].candidate[
        append ? "explicitExclusions" : "whatCustomerBuys"
      ],
      append ? [...candidate.explicitExclusions!, correction] : correction,
    );
    assert.equal(
      revisionResults
        .at(-1)!
        .envelope.usage.filter(
          (u: { category: string }) => u.category === "model",
        ).length,
      0,
    );
    const next = await claim(
      f.db.rows("agent_effectiveness_cases")[0]!.activeRunId,
    );
    await execute(next, {
      assessments: productCriteria()
        .criteria.filter((c) => c.method === "judgement")
        .map((c) => ({
          criterionId: c.id,
          outcome:
            repeated && c.id === "constraint_preservation" ? "fail" : "pass",
          rationale: "Synthetic exact correction assessed independently",
        })),
    });
    if (repeated) {
      const second = await claim(
        f.db.rows("agent_effectiveness_cases")[0]!.activeRunId,
      );
      assert.equal(second.operation, "revise_understanding");
      await execute(second, {
        version: 1,
        kind: "slots",
        evidenceIds: [],
        slots: [
          {
            key: "second",
            target: "explicitExclusions",
            defectId: "defect:constraint_preservation",
          },
        ],
      });
      await answer(
        [
          { key: "second_statement", value: "Maintenance excluded" },
          { key: "second_status", value: "current_claim" },
          { key: "second_confirm", value: true },
          { key: "second_include", value: true },
        ],
        second.runId,
      );
      const nextAttempt = await claim(second.runId);
      const extended = await execute(nextAttempt, {
        never: "zero model calls on exact resume",
      });
      assert.deepEqual(
        extended.outcome.content.proposals[0]!.candidate.explicitExclusions,
        [...candidate.explicitExclusions!, correction, "Maintenance excluded"],
      );
      assert.equal(
        extended.usage.filter((u) => u.category === "model").length,
        0,
      );
      assert.equal(
        extended.outcome.content.findings.filter((f) => f.payload !== undefined)
          .length,
        2,
      );
      const third = await claim(
        f.db.rows("agent_effectiveness_cases")[0]!.activeRunId,
      );
      await execute(third, {
        assessments: productCriteria()
          .criteria.filter((c) => c.method === "judgement")
          .map((c) => ({
            criterionId: c.id,
            outcome: "pass",
            rationale: "Repeated exact composition",
          })),
      });
      assert.equal(
        f.db
          .rows("agent_runs")
          .filter((r) => r.operation === "revise_understanding").length,
        2,
      );
    }
    for (const allocation of (await f.effects.read(f.queen, c.id)).case
      .allocations)
      await app.results(allocation.runId, new AbortController().signal);
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
    if (rich || repeated) {
      assert.equal(final.status, "held");
      return;
    }
    assert.equal(final.status, "passed");
    assert.equal(final.candidates.length, 2);
    assert.equal(final.evaluations.length, 2);
    assert.equal(
      f.db.rows("offerings").find((r) => r.id === draft.id)!.status,
      "draft",
    );
    if (append) {
      const result = revisionResults.at(-1)!;
      const review = createAgentProposalReview(
        f.config,
        f.db.mongo,
        f.control,
        undefined,
        () => f.now,
        f.effects.eligible,
      );
      await review.apply(f.queen, revision.runId, {
        resultId: result.id,
        proposalId: "offering_understanding",
        expectedUpdatedAt: result.updatedAt.toISOString(),
        evidenceIds: result.envelope.outcome.content.proposals[0].evidenceIds,
      });
      const applied = f.db.rows("offerings").find((r) => r.id === draft.id)!;
      assert.deepEqual(applied.definition.explicitExclusions, [
        ...candidate.explicitExclusions!,
        correction,
      ]);
      await mutateHiveDefinition(
        f.db.mongo,
        f.config,
        f.queen,
        f.workspaceId,
        "offerings",
        "approve",
        {
          id: applied.id,
          expectedUpdatedAt: applied.updatedAt.toISOString(),
        },
      );
      const approved = f.db.rows("offerings").find((r) => r.id === draft.id)!;
      const certified = await readCanonicalSupport(
        f.db.mongo,
        f.config,
        f.queen,
        {
          resourceType: "offerings",
          id: approved.id,
          workspaceId: f.workspaceId,
          revision: approved.revision,
          contentHash: approved.contentHash,
        },
      );
      assert.equal(certified.kind, "canonical_support_context");
      assert.equal(certified.composed.length, 1);
      assert.equal(certified.composed[0]!.evidence.length, 2);
      const target = await mutateHiveDefinition(
        f.db.mongo,
        f.config,
        f.queen,
        f.workspaceId,
        "offerings",
        "create",
        {
          definition: {
            name: "Synthetic follow-on service",
            description: "Synthetic follow-on description",
          },
        },
      );
      const reused = await f.effects.create(f.queen, f.workspaceId, {
        ...f.request,
        requestKey: "certified-reuse",
        input: {
          mode: "refresh",
          offeringId: target.id,
          expectedUpdatedAt: target.updatedAt.toISOString(),
          workingLabel: "Synthetic follow-on service",
          orientation: "Reuse exact approved support",
          canonicalSupport: certified.root,
        },
      });
      const beforeReuse = structuredClone(f.db.records);
      for (const fault of ["certificate", "evidence", "membership"] as const) {
        f.db.records = structuredClone(beforeReuse);
        if (fault === "certificate")
          f.db
            .rows("events")
            .find(
              (e) => e.eventType === "canonical_support_certified",
            )!.payload.digest = "0".repeat(64);
        if (fault === "evidence")
          f.db
            .rows("offerings")
            .find((r) => r.id === approved.id)!.evidence[0].verification =
            "rejected";
        if (fault === "membership") {
          f.db
            .rows("workspace_memberships")
            .forEach((r) => (r.status = "ended"));
          f.db
            .rows("hvm_partner_memberships")
            .forEach((r) => (r.status = "revoked"));
        }
        await assert.rejects(claim(reused.rootRunId));
      }
      f.db.records = structuredClone(beforeReuse);
      const reuseWork = await claim(reused.rootRunId);
      const canonicalGrant = reuseWork.grant.resources.find((r) =>
        r.fields.includes("canonicalSupport"),
      )!;
      const claimedState = structuredClone(f.db.records);
      await assert.rejects(
        execute(
          reuseWork,
          {
            version: 1,
            kind: "draft",
            sourceIds: Object.entries(approved.definition).map(
              ([field, value]) =>
                `source:${digest({ reference: canonicalGrant, field, value }).slice(0, 32)}`,
            ),
            questions: [],
          },
          () => {
            f.db
              .rows("events")
              .find(
                (e) => e.eventType === "canonical_support_certified",
              )!.payload.digest = "0".repeat(64);
          },
        ),
      );
      f.db.records = claimedState;
      const safe = await execute(reuseWork, {
        version: 1,
        kind: "draft",
        sourceIds: Object.entries(approved.definition).map(
          ([field, value]) =>
            `source:${digest({ reference: canonicalGrant, field, value }).slice(0, 32)}`,
        ),
        questions: [],
      });
      assert.equal(safe.outcome.kind, "success");
      assert.deepEqual(
        safe.outcome.content.proposals[0]!.candidate.explicitExclusions,
        approved.definition.explicitExclusions,
      );
      for (const e of certified.composed[0]!.evidence)
        assert.deepEqual(
          safe.outcome.content.evidence.find((x) => x.id === e.id),
          e,
        );
      assert.deepEqual(
        safe.outcome.content.findings.find(
          (x) => x.id === canonicalProductFinding(certified.composed[0]!).id,
        )!.payload,
        canonicalProductFinding(certified.composed[0]!).payload,
      );

      const createdCase = await f.effects.create(f.queen, f.workspaceId, {
        ...f.request,
        requestKey: "certified-create",
        input: { ...f.request.input, canonicalSupport: certified.root },
      });
      const createWork = await claim(createdCase.rootRunId);
      const createSource = createWork.grant.resources.find((r) =>
        r.fields.includes("canonicalSupport"),
      )!;
      const created = await execute(createWork, {
        version: 1,
        kind: "draft",
        sourceIds: Object.entries(approved.definition).map(
          ([field, value]) =>
            `source:${digest({ reference: createSource, field, value }).slice(0, 32)}`,
        ),
        questions: [],
      });
      assert.equal(created.outcome.content.proposals[0]!.target.kind, "create");
      assert.deepEqual(
        created.outcome.content.proposals[0]!.candidate.explicitExclusions,
        approved.definition.explicitExclusions,
      );
      assert.equal(
        f.db
          .rows("events")
          .filter((e) => e.eventType === "canonical_support_certified").length,
        1,
      );
      await assert.rejects(
        f.db.mongo.withTransaction!(async (db, session) =>
          currentAgentSource(db, f.workspaceId, source.reference, session),
        ),
        /Agent source changed/,
      );
    }
    assert.equal(f.db.rows("client_agents").length, 0);
    assert.equal(
      f.db
        .rows("agent_results")
        .every((r) => r.envelope.protocolVersion === "2.0"),
      true,
    );
  });
