import test from "node:test";
import assert from "node:assert/strict";
import { digest, digestWithout } from "@workspace/agent-runtime-protocol";
import { effectivenessFixture } from "./helpers/effectiveness-fixture";
import {
  AgentProposalStale,
  currentAgentSource,
} from "../src/services/agent-proposal-freshness";
import { AgentResultSchema } from "../src/domain/agent-control-plane";

/** Offline prerequisite characterization, not a Product implementation. The
 * synthetic accepted Result is assembled before the freshness checks; no live
 * database or provider is used and no production Result is mutated. */
async function fixture() {
  const f = await effectivenessFixture();
  const c = await f.effects.create(f.queen, f.workspaceId, f.request);
  const work = await f.claim(c.rootRunId);
  await f.control.outcome(f.principal, f.lease(work), f.result(work));
  const result = f.db.rows("agent_results")[0]!;
  const target = {
    id: "offering:synthetic",
    workspaceId: f.workspaceId,
    revision: 2,
    contentHash: digest("draft before application"),
    archived: false,
  };
  const other = {
    ...target,
    id: "offering:other",
    contentHash: digest("independent source"),
  };
  f.db.rows("offerings").push(target, other);
  result.envelope.outcome.content.lineage = [target, other].map((row, i) => ({
    id: `source:${i}`,
    role: "consumed",
    purpose: "Refresh consumes the draft and an independent source",
    source: {
      kind: "resource",
      reference: {
        resourceType: "offerings",
        id: row.id,
        workspaceId: row.workspaceId,
        revision: row.revision,
        contentHash: row.contentHash,
      },
    },
    observedAt: result.envelope.startedAt,
    fetchedAt: result.envelope.endedAt,
  }));
  result.envelope.payloadDigest = digestWithout(
    result.envelope,
    "payloadDigest",
  );
  AgentResultSchema.parse(result);
  const reference = {
    resourceType: "agent_result_projection",
    id: result.id,
    workspaceId: f.workspaceId,
    contentHash: result.envelope.payloadDigest,
  };
  const check = () =>
    f.db.mongo.withTransaction!(async (db, session) =>
      currentAgentSource(db, f.workspaceId, reference, session),
    );
  return { f, target, other, reference, check };
}

test("4C prerequisite: exact Result lineage accepts unchanged refresh dependencies", async () => {
  const f = await fixture();
  await f.check();
});

test("4C blocker reproduced: applying the refreshed target invalidates transitive Result freshness", async () => {
  const f = await fixture();
  await f.check();
  // Same canonical revision, as with proposal application to an existing draft.
  f.target.contentHash = digest("reviewed replacement applied to draft");
  await assert.rejects(
    f.check(),
    (error: unknown) =>
      error instanceof AgentProposalStale &&
      error.message === "Agent source changed",
  );
});

test("4C invariant: an independent changed source must remain stale", async () => {
  const f = await fixture();
  f.other.contentHash = digest("changed independent source");
  await assert.rejects(f.check(), /Agent source changed/);
});
