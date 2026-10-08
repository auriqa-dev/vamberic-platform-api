import {
  currentAgentSource,
  assertProposalFresh,
} from "../src/services/agent-proposal-freshness";
import type { Db, ClientSession } from "mongodb";
import { createAgentProposalReview } from "../src/services/agent-proposals";
import { mutateHiveDefinition } from "../src/services/hive-definitions";
import test from "node:test";
import assert from "node:assert/strict";
import {
  PRODUCT_WEBSITE_MANIFEST,
  digest,
  WebsiteReviewCheckpointSchema,
  startWebsiteReview,
  encodeWebsiteReview,
  type RuntimeClaimedWork,
} from "@workspace/agent-runtime-protocol";
import { workspaceAgentFixture } from "./helpers/workspace-agent-v16";
import { createProductAgent } from "../../../../vamberic-agent-runtime/dist/src/agents/product-service-understanding/index.js";
import { submittedPageTool } from "../../../../vamberic-agent-runtime/dist/src/tools/submitted-page-policy.js";
import { FakeClock } from "../../../../vamberic-agent-runtime/dist/src/runtime/clock.js";
import { FakeModel } from "../../../../vamberic-agent-runtime/dist/src/models/fake.js";
import { FakePlatformContext } from "../../../../vamberic-agent-runtime/dist/src/platform/context.js";
import { ImplementationRegistry } from "../../../../vamberic-agent-runtime/dist/src/registry/registry.js";
import { MemoryDiagnostics } from "../../../../vamberic-agent-runtime/dist/src/telemetry/diagnostics.js";
import { executeAttempt } from "../../../../vamberic-agent-runtime/dist/src/runtime/executor.js";

test("URL generation crosses Platform/Runtime through review, independent evaluation, approval and replacement", async (t) => {
  const f = await workspaceAgentFixture(true, PRODUCT_WEBSITE_MANIFEST);
  f.db.rows("schema_versions")[0]!.version = 23;
  t.mock.method(Date, "now", () => f.now.getTime());
  const pageText =
    "A remote planning service. Customers receive a report. Implementation is excluded.";
  const candidate = {
    name: "Planning",
    description: "Remote planning service",
    whatItIs: "Planning service",
    whatCustomerBuys: "Written report",
    capabilities: ["Planning"],
    engagementModel: "Remote delivery",
    boundaries: ["Implementation excluded"],
  };
  const dto = {
    version: 1,
    fields: Object.entries(candidate).map(([field, value]) => ({
      binding: { field, value },
      basis: "interpretation",
      support: [{ pageDigest: digest(pageText), quote: pageText }],
    })),
    unknowns: [],
    questions: [],
  };
  const created = await f.effects.create(f.queen, f.workspaceId, {
    ...f.request,
    input: {
      ...f.request.input,
      websiteUrls: ["https://example.com/planning"],
    },
  });
  async function claim(runId = created.rootRunId) {
    const run = f.db.rows("agent_runs").find((r) => r.id === runId)!;
    return f.control.claim(f.principal, {
      dispatch: {
        protocolVersion: "2.0",
        environment: "test",
        runId: run.id,
        generation: run.generation,
        dispatchId: run.dispatch.id,
        notBefore: run.notBefore.toISOString(),
        traceId: run.frozen.traceId,
      },
      claimId: `claim:${run.id}:${run.generation}`,
    });
  }
  let fetches = 0;
  async function execute(w: RuntimeClaimedWork) {
    const clock = new FakeClock(f.now.getTime()),
      registry = new ImplementationRegistry();
    registry.register(createProductAgent(undefined, PRODUCT_WEBSITE_MANIFEST));
    const input = w.input as Record<string, unknown>;
    const result = await executeAttempt(w, {
      clock,
      registry,
      models: [
        new FakeModel(clock, [
          {
            output: JSON.parse(
              JSON.stringify(
                w.operation === "evaluate_understanding"
                  ? {
                      assessments: (
                        input.criteria as {
                          criteria: { id: string; method: string }[];
                        }
                      ).criteria
                        .filter((c) => c.method === "judgement")
                        .map((c) => ({
                          criterionId: c.id,
                          outcome: "pass",
                          rationale: "Offline fixture supports this criterion",
                        })),
                    }
                  : dto,
              ),
            ),
            latencyMs: 0,
          },
        ]),
      ],
      tools: input.submittedPages
        ? [
            submittedPageTool(
              input.submittedPages,
              {
                resolve: async () => ["8.8.8.8"],
                read: async () => {
                  fetches++;
                  return {
                    access: "allowed",
                    text: pageText,
                    title: "Planning",
                    decodedBytes: pageText.length,
                  };
                },
              },
              "GBP",
            ),
          ]
        : [],
      platform: new FakePlatformContext([]),
      diagnostics: new MemoryDiagnostics(),
    });
    assert.equal(result.status, "executed");
    if (result.status !== "executed") throw new Error("Execution rejected");
    assert.notEqual(
      result.outcome.outcome.kind,
      "failure",
      JSON.stringify(result.outcome.outcome),
    );
    await f.control.outcome(f.principal, f.lease(w), result.outcome);
    return result.outcome.outcome;
  }
  const paused = await execute(await claim());
  assert.equal(paused.kind, "needs_input");
  if (paused.kind !== "needs_input") return;
  const view = await f.control.read(f.queen, created.rootRunId);
  assert.ok(view.websiteReview);
  assert.equal(view.websiteReview.approval, "not_approved");
  const review = startWebsiteReview(
    WebsiteReviewCheckpointSchema.parse(paused.checkpoint.payload).draft,
  );
  for (const row of review.fields)
    row.confirmedValueDigest = digest(row.binding);
  const run = f.db.rows("agent_runs").find((r) => r.id === created.rootRunId)!;
  const response = {
    requestId: paused.inputRequest.id,
    values: encodeWebsiteReview(review),
  };
  const bad = structuredClone(response);
  bad.values.at(-1)!.value = false;
  await assert.rejects(
    f.control.respond(f.queen, run.id, run.updatedAt.toISOString(), bad),
  );
  await assert.rejects(
    f.control.respond(
      { ...f.queen, subject: "not-authorized" },
      run.id,
      run.updatedAt.toISOString(),
      response,
    ),
  );
  await f.control.respond(
    f.queen,
    run.id,
    run.updatedAt.toISOString(),
    response,
  );
  f.now.setTime(f.now.getTime() + 1000);
  const completed = await execute(await claim());
  assert.equal(completed.kind, "success");
  assert.equal(completed.completeness.kind, "complete");
  assert.equal(fetches, 1);
  const state = (await f.effects.read(f.queen, created.id)).case;
  assert.equal(state.candidates.length, 1);
  assert.equal(state.evaluations.length, 1);
  assert.notEqual(state.status, "passed");
  assert.equal(f.db.rows("offerings").length, 0);
  await execute(await claim(state.evaluations[0]!.runId));
  const passed = (await f.effects.read(f.queen, created.id)).case;
  assert.equal(passed.status, "passed");
  const result = f.db
    .rows("agent_results")
    .find((r) => r.id === passed.candidates[0]!.reference.resultId)!;
  const reviewApi = createAgentProposalReview(
    f.config,
    f.db.mongo,
    f.control,
    undefined,
    () => f.now,
    f.effects.eligible,
  );
  await reviewApi.apply(f.queen, created.rootRunId, {
    resultId: result.id,
    proposalId: "offering_understanding",
    expectedUpdatedAt: result.updatedAt.toISOString(),
    evidenceIds: result.envelope.outcome.content.proposals[0].evidenceIds,
  });
  const saved = f.db.rows("offerings")[0]!;
  assert.equal(saved.status, "draft");
  await mutateHiveDefinition(
    f.db.mongo,
    f.config,
    f.queen,
    f.workspaceId,
    "offerings",
    "approve",
    { id: saved.id, expectedUpdatedAt: saved.updatedAt.toISOString() },
  );
  const approved = f.db.rows("offerings")[0]!;
  assert.equal(approved.status, "approved");
  const reference = {
    resourceType: "offerings",
    id: approved.id,
    workspaceId: f.workspaceId,
    revision: approved.revision,
    contentHash: approved.contentHash,
  };
  const oldDefinition = structuredClone(approved.definition),
    oldUpdatedAt = approved.updatedAt.toISOString();
  await mutateHiveDefinition(
    f.db.mongo,
    f.config,
    f.queen,
    f.workspaceId,
    "offerings",
    "revise",
    { id: approved.id, expectedUpdatedAt: oldUpdatedAt },
  );
  const session = {} as ClientSession;
  const active = await currentAgentSource(
    f.db as unknown as Db,
    f.workspaceId,
    reference,
    session,
  );
  assert.deepEqual(active.definition, oldDefinition);
  assert.equal(active.status, "approved");
  const draft = f.db.rows("offerings")[0]!;
  const approvedRevision = draft.approvedRevision;
  draft.approvedRevision = approvedRevision + 1;
  await assert.rejects(
    currentAgentSource(
      f.db as unknown as Db,
      f.workspaceId,
      reference,
      session,
    ),
  );
  draft.approvedRevision = approvedRevision;
  draft.archived = true;
  await assert.rejects(
    currentAgentSource(
      f.db as unknown as Db,
      f.workspaceId,
      reference,
      session,
    ),
  );
  draft.archived = false;

  await assert.rejects(
    assertProposalFresh(
      f.db as unknown as Db,
      f.workspaceId,
      {
        id: "test",
        targetKind: "offerings",
        target: { kind: "update", reference, expectedUpdatedAt: oldUpdatedAt },
        candidate: oldDefinition,
        evidenceIds: [],
        lineageIds: ["test"],
        rationale: "test",
      },
      [],
      session,
    ),
  );
});
