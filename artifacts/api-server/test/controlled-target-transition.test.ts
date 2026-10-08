import { snapshotInterleaving } from "./helpers/agent-snapshot-db";
import { readCanonicalSupport } from "../src/services/canonical-support";
import test from "node:test";
import assert from "node:assert/strict";
import { digest, digestWithout } from "@workspace/agent-runtime-protocol";
import { effectivenessFixture } from "./helpers/effectiveness-fixture";
import { mutateHiveDefinition } from "../src/services/hive-definitions";
import { createAgentProposalReview } from "../src/services/agent-proposals";
import {
  currentAgentSource,
  requireFreshAgentApplications,
} from "../src/services/agent-proposal-freshness";

async function fixture() {
  const f = await effectivenessFixture();
  f.db.rows("agent_definitions")[0]!.data.hiveAccess.readResources = [
    "offerings",
  ];
  f.db.rows("agent_definitions")[0]!.data.hiveAccess.proposeResources = [
    "offerings",
  ];
  const before = await mutateHiveDefinition(
    f.db.mongo,
    f.config,
    f.queen,
    f.workspaceId,
    "offerings",
    "create",
    {
      definition: {
        name: "Original",
        description: "Synthetic original service",
      },
    },
  );
  const independent = await mutateHiveDefinition(
    f.db.mongo,
    f.config,
    f.queen,
    f.workspaceId,
    "offerings",
    "create",
    {
      definition: {
        name: "Independent",
        description: "Synthetic independent source",
      },
    },
  );
  const refs = [before, independent].map((row) => ({
    resourceType: "offerings",
    id: row.id,
    workspaceId: f.workspaceId,
    revision: row.revision,
    contentHash: row.contentHash,
  }));
  f.p.selector = { kind: "proposal", proposalId: "understanding" };
  const prepare = f.p.prepareRun;
  f.p.prepareRun = async (context) => {
    const prepared = await prepare(context);
    const w = prepared.frozen;
    if (context.role === "maker") {
      w.grant.resources = refs.map((reference) => ({
        reference,
        fields: ["definition"],
      }));
      w.context.references = structuredClone(w.grant.resources);
      w.grant.proposalTargets = [
        { kind: "update", targetKind: "offerings", reference: refs[0]! },
      ];
    }
    return prepared;
  };
  const c = await f.effects.create(f.queen, f.workspaceId, f.request);
  const maker = await f.claim(c.rootRunId);
  const outcome = f.result(maker);
  outcome.outcome.content.lineage = refs.map((reference, i) => ({
    id: `source:${i}`,
    role: "consumed",
    purpose: "Synthetic refresh source",
    source: { kind: "resource", reference },
    observedAt: f.now.toISOString(),
    fetchedAt: f.now.toISOString(),
    fields: ["definition"],
  }));
  outcome.outcome.content.proposals = [
    {
      id: "understanding",
      targetKind: "offerings",
      target: {
        kind: "update",
        reference: refs[0]!,
        expectedUpdatedAt: before.updatedAt.toISOString(),
      },
      candidate: {
        name: "Controlled successor",
        description: "Synthetic reviewed service",
      },
      evidenceIds: [],
      lineageIds: ["source:0", "source:1"],
      rationale: "Synthetic controlled refresh",
    },
  ];
  outcome.payloadDigest = digestWithout(outcome, "payloadDigest");
  await f.control.outcome(f.principal, f.lease(maker), outcome);
  const evaluating = f.db.rows("agent_effectiveness_cases")[0]!;
  const evaluator = await f.claim(evaluating.activeRunId);
  const evaluation = f.result(evaluator);
  evaluation.outcome.content.lineage = [
    {
      id: "candidate_source",
      role: "consumed",
      purpose: "Exact candidate context",
      source: {
        kind: "resource",
        reference: evaluator.grant.resources[0]!.reference,
      },
      fields: ["domainOutput"],
      observedAt: f.now.toISOString(),
      fetchedAt: f.now.toISOString(),
    },
  ];
  evaluation.payloadDigest = digestWithout(evaluation, "payloadDigest");
  await f.control.outcome(f.principal, f.lease(evaluator), evaluation);
  const result = f.db
    .rows("agent_results")
    .find((r) => r.runId === maker.runId)!;
  const review = createAgentProposalReview(
    f.config,
    f.db.mongo,
    f.control,
    undefined,
    () => f.now,
    f.effects.eligible,
  );
  await review.apply(f.queen, maker.runId, {
    resultId: result.id,
    proposalId: "understanding",
    expectedUpdatedAt: result.updatedAt.toISOString(),
  });
  const target = () => f.db.rows("offerings").find((r) => r.id === before.id)!;
  const check = () =>
    f.db.mongo.withTransaction!(async (db, session) =>
      requireFreshAgentApplications(
        db,
        f.workspaceId,
        "offerings",
        target(),
        session,
      ),
    );
  return {
    f,
    before,
    independent,
    refs,
    result,
    target,
    check,
    evaluator,
    evaluation: f.db
      .rows("agent_results")
      .find((r) => r.runId === evaluator.runId)!,
    state: f.db.rows("agent_effectiveness_cases")[0]!,
  };
}

test("canonical approval accepts exact controlled A-C-E-P-B transition with current independent sources", async () => {
  const x = await fixture();
  await x.check();
  await mutateHiveDefinition(
    x.f.db.mongo,
    x.f.config,
    x.f.queen,
    x.f.workspaceId,
    "offerings",
    "approve",
    {
      id: x.target().id,
      expectedUpdatedAt: x.target().updatedAt.toISOString(),
    },
  );
  assert.equal(x.target().status, "approved");
});

test("ordinary freshness still rejects the historical target after controlled application", async () => {
  const x = await fixture();
  await assert.rejects(
    x.f.db.mongo.withTransaction!(async (db, session) =>
      currentAgentSource(db, x.f.workspaceId, x.refs[0]!, session),
    ),
    /Agent source changed/,
  );
});

const corruptions: Record<
  string,
  (x: Awaited<ReturnType<typeof fixture>>) => void
> = {
  "draft edited": (x) => {
    x.target().definition.name = "Edited";
    x.target().contentHash = digest("edited");
  },
  "same-looking content after edit and revert": (x) => {
    x.target().updatedAt = new Date(x.target().updatedAt.getTime() + 1);
  },
  "different applied proposal": (x) => {
    x.result.dispositions[0].proposalId = "different";
  },
  "Candidate mismatch": (x) => {
    x.state.candidates[0].reference.contentDigest = digest("different");
  },
  "Evaluation mismatch": (x) => {
    x.evaluation.envelope.outcome.content.domainOutput.candidate.contentDigest =
      digest("different");
    x.evaluation.envelope.payloadDigest = digestWithout(
      x.evaluation.envelope,
      "payloadDigest",
    );
  },
  "Evaluation not PASS": (x) => {
    x.state.status = "held";
  },
  "original target mismatch": (x) => {
    x.result.envelope.outcome.content.proposals[0].target.reference.contentHash =
      digest("different");
    x.result.envelope.payloadDigest = digestWithout(
      x.result.envelope,
      "payloadDigest",
    );
  },
  "proposal Result lineage mismatch": (x) => {
    x.result.envelope.outcome.content.lineage[0].source.reference.contentHash =
      digest("different");
    x.result.envelope.payloadDigest = digestWithout(
      x.result.envelope,
      "payloadDigest",
    );
  },
  "independent source changed": (x) => {
    x.f.db
      .rows("offerings")
      .find((r) => r.id === x.independent.id)!.contentHash = digest("changed");
  },
  "missing application target hash": (x) => {
    delete x.result.dispositions[0].target.contentHash;
  },
  "unrelated historical source": (x) => {
    x.f.db.rows("offerings").find((r) => r.id === x.independent.id)!.revision +=
      1;
  },
};
for (const [name, corrupt] of Object.entries(corruptions))
  test(`canonical approval rejects ${name}`, async () => {
    const x = await fixture();
    corrupt(x);
    await assert.rejects(x.check());
  });

test("E1 reuse gate: approved current Offering is fresh, but its source Result remains historical for ordinary execution", async () => {
  const x = await fixture();
  const sourceResult = {
    resourceType: "agent_result_projection",
    id: x.result.id,
    workspaceId: x.f.workspaceId,
    contentHash: x.result.envelope.payloadDigest,
  };
  const immutableEnvelope = JSON.stringify(x.result.envelope);
  await x.check();
  await mutateHiveDefinition(
    x.f.db.mongo,
    x.f.config,
    x.f.queen,
    x.f.workspaceId,
    "offerings",
    "approve",
    {
      id: x.target().id,
      expectedUpdatedAt: x.target().updatedAt.toISOString(),
    },
  );
  assert.equal(x.target().status, "approved");
  const current = {
    ...x.refs[0]!,
    revision: x.target().revision,
    contentHash: x.target().contentHash,
  };
  await x.f.db.mongo.withTransaction!(async (db, session) => {
    const row = await currentAgentSource(db, x.f.workspaceId, current, session);
    assert.equal(row.id, x.target().id);
    await assert.rejects(
      currentAgentSource(db, x.f.workspaceId, sourceResult, session),
      /Agent source changed/,
    );
  });
  assert.equal(JSON.stringify(x.result.envelope), immutableEnvelope);
});

test("v18 approval atomically certifies exact support while the old Result remains stale", async () => {
  const x = await fixture();
  x.f.db.rows("schema_versions")[0]!.version = 18;
  const approved = await mutateHiveDefinition(
    x.f.db.mongo,
    x.f.config,
    x.f.queen,
    x.f.workspaceId,
    "offerings",
    "approve",
    {
      id: x.target().id,
      expectedUpdatedAt: x.target().updatedAt.toISOString(),
    },
  );
  const certificates = x.f.db
    .rows("events")
    .filter((e) => e.eventType === "canonical_support_certified");
  assert.equal(certificates.length, 1);
  const certificate = certificates[0]!.payload;
  assert.equal(certificate.entityId, approved.id);
  assert.equal(certificate.revision, approved.revision);
  assert.equal(certificate.applications.length, 1);
  assert.equal(certificate.applications[0].selfEdges.length, 1);
  assert.equal(certificate.applications[0].independent.length, 1);
  assert.equal(certificate.applications[0].independent[0].id, x.independent.id);
  await assert.rejects(
    x.f.db.mongo.withTransaction!(async (db, session) =>
      currentAgentSource(
        db,
        x.f.workspaceId,
        {
          resourceType: "agent_result_projection",
          id: x.result.id,
          workspaceId: x.f.workspaceId,
          contentHash: x.result.envelope.payloadDigest,
        },
        session,
      ),
    ),
  );
});
test("v18 stale approval emits no certificate or snapshot", async () => {
  const x = await fixture();
  x.f.db.rows("schema_versions")[0]!.version = 18;
  x.target().updatedAt = new Date(x.target().updatedAt.getTime() + 1);
  const snapshots = x.f.db.rows("hive_definition_revisions").length;
  await assert.rejects(
    mutateHiveDefinition(
      x.f.db.mongo,
      x.f.config,
      x.f.queen,
      x.f.workspaceId,
      "offerings",
      "approve",
      {
        id: x.target().id,
        expectedUpdatedAt: x.target().updatedAt.toISOString(),
      },
    ),
  );
  assert.equal(x.f.db.rows("hive_definition_revisions").length, snapshots);
  assert.equal(
    x.f.db
      .rows("events")
      .filter((e) => e.eventType === "canonical_support_certified").length,
    0,
  );
});
async function certifiedFixture() {
  const x = await fixture();
  x.f.db.rows("schema_versions")[0]!.version = 18;
  const approved = await mutateHiveDefinition(
    x.f.db.mongo,
    x.f.config,
    x.f.queen,
    x.f.workspaceId,
    "offerings",
    "approve",
    {
      id: x.target().id,
      expectedUpdatedAt: x.target().updatedAt.toISOString(),
    },
  );
  const reference = {
    resourceType: "offerings",
    id: approved.id,
    workspaceId: x.f.workspaceId,
    revision: approved.revision,
    contentHash: approved.contentHash,
  };
  return {
    ...x,
    approved,
    read: () =>
      readCanonicalSupport(x.f.db.mongo, x.f.config, x.f.queen, reference),
  };
}
test("v18 exact approved canonical support reuses attribution with independent freshness", async () => {
  const x = await certifiedFixture();
  const projection = await x.read();
  assert.equal(projection.root.id, x.approved.id);
  assert.equal(projection.dependencies.length, 1);
  assert.equal(projection.dependencies[0]!.id, x.independent.id);
  assert.equal("results" in projection, false);
});
for (const fault of [
  "edited",
  "evidence",
  "reopened",
  "archived",
  "independent",
  "independent_evidence",
  "certificate",
  "snapshot",
  "result",
  "application",
  "policy",
  "scope",
] as const)
  test(`v18 canonical support rejects ${fault}`, async () => {
    const x = await certifiedFixture();
    if (fault === "edited") x.target().definition.description = "Changed";
    if (fault === "evidence") x.target().evidence.push({ unexpected: true });
    if (fault === "reopened") x.target().status = "draft";
    if (fault === "archived") x.target().archived = true;
    if (fault === "independent")
      x.f.db
        .rows("offerings")
        .find((r) => r.id === x.independent.id)!.contentHash = "0".repeat(64);
    if (fault === "independent_evidence")
      x.f.db
        .rows("offerings")
        .find((r) => r.id === x.independent.id)!
        .evidence.push({ changed: true });
    if (fault === "certificate")
      x.f.db
        .rows("events")
        .find(
          (e) => e.eventType === "canonical_support_certified",
        )!.payload.digest = "0".repeat(64);
    if (fault === "snapshot")
      x.f.db.rows(
        "hive_definition_revisions",
      )[0]!.snapshot.definition.description = "Changed";
    if (fault === "result")
      x.result.envelope.outcome.content.proposals[0].candidate.description =
        "Changed";
    if (fault === "application")
      x.result.dispositions[0].target.contentHash = "0".repeat(64);
    if (fault === "policy")
      x.f.db.rows("agent_definitions")[0]!.status = "draft";
    if (fault === "scope") x.target().workspaceId = "workspace_unrelated";
    await assert.rejects(x.read());
  });
test("v18 canonical support rejects revoked workspace authority independently of historical approval", async () => {
  const x = await certifiedFixture();
  for (const collection of ["workspace_memberships", "hvm_partner_memberships"])
    for (const row of x.f.db.rows(collection)) row.status = "ended";
  await assert.rejects(x.read());
});
test("v18 canonical support serializes concurrent source mutation", async () => {
  const x = await certifiedFixture();
  const interleaved = snapshotInterleaving(x.f.db, async () => {
    const workspace = x.f.db
      .rows("crm_workspaces")
      .find((r) => r.id === x.f.workspaceId)!;
    workspace.updatedAt = new Date(workspace.updatedAt.getTime() + 1);
    x.f.db
      .rows("offerings")
      .find((r) => r.id === x.independent.id)!.contentHash = "0".repeat(64);
  });
  await assert.rejects(
    readCanonicalSupport(interleaved.mongo, x.f.config, x.f.queen, {
      resourceType: "offerings",
      id: x.approved.id,
      workspaceId: x.f.workspaceId,
      revision: x.approved.revision,
      contentHash: x.approved.contentHash,
    }),
    /Snapshot write conflict/,
  );
});
test("certificate graph rejects ambiguous duplicate self-target edges", async () => {
  const x = await fixture();
  const edge = x.result.envelope.outcome.content.lineage[0];
  x.result.envelope.outcome.content.lineage.push({
    ...structuredClone(edge),
    id: "independent_use",
    purpose: "Another independent use",
  });
  x.result.envelope.payloadDigest = digestWithout(
    x.result.envelope,
    "payloadDigest",
  );
  const { collectSupportGraph } =
    await import("../src/services/canonical-support-graph");
  await assert.rejects(
    x.f.db.mongo.withTransaction!(async (db, session) =>
      collectSupportGraph(
        db,
        x.f.workspaceId,
        session,
        [x.result.id],
        { before: x.refs[0]!, resultIds: new Set([x.result.id]) },
        [],
      ),
    ),
    /Ambiguous self-transition roles/,
  );
});
