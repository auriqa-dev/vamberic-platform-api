import test from "node:test";
import assert from "node:assert/strict";
import { digest } from "@workspace/agent-runtime-protocol";
import { workspaceAgentFixture as fixture } from "./helpers/workspace-agent-v16";

test("workspace reasoning prepares and claims PSU without Client Agent; client membership alone is insufficient", async () => {
  const f = await fixture();
  await assert.rejects(f.effects.create(f.client, f.workspaceId, f.request));
  const c = await f.effects.create(f.queen, f.workspaceId, f.request);
  const row = f.db.rows("agent_runs").find((r) => r.id === c.rootRunId)!;
  assert.equal(row.frozen.protocolVersion, "2.0");
  assert.equal("clientAgent" in row.frozen, false);
  assert.equal(f.db.rows("client_agents").length, 0);
  assert.equal(row.target.id, digest(row.frozen.executionTarget));
  const claimed = await f.control.claim(f.principal, {
    dispatch: {
      protocolVersion: "2.0",
      environment: "test",
      runId: row.id,
      generation: row.generation,
      dispatchId: row.dispatch.id,
      notBefore: row.notBefore.toISOString(),
      traceId: row.frozen.traceId,
    },
    claimId: "workspace-claim",
  });
  assert.equal(claimed.protocolVersion, "2.0");
  assert.equal(claimed.resultSchemaVersion, 2);
  const lease = {
    runId: claimed.runId,
    attemptId: claimed.attemptId,
    generation: claimed.generation,
    fence: claimed.fence,
    leaseId: claimed.lease.id,
  };
  await f.control.heartbeat(f.principal, lease);
  await assert.rejects(
    f.control.heartbeat(f.principal, { ...lease, fence: lease.fence + 1 }),
  );
  await assert.rejects(
    f.control.heartbeat(
      { ...f.principal, workerId: "different_process" },
      lease,
    ),
  );
  f.db.rows("agent_definitions")[0]!.status = "retired";
  assert.deepEqual(await f.control.heartbeat(f.principal, lease), {
    continue: false,
  });
});
test("reasoning target rejects wrong workspace, implementation, schema and withdrawn Definition", async () => {
  for (const mutate of [
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.request.target.workspaceId = "workspace_00000000000000000000000000";
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.request.target.implementation.buildDigest = "a".repeat(64);
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.db.rows("schema_versions")[0]!.version = 15;
    },
    (f: Awaited<ReturnType<typeof fixture>>) => {
      f.db.rows("agent_definitions")[0]!.availability = "internal";
    },
  ]) {
    const f = await fixture();
    mutate(f);
    await assert.rejects(f.effects.create(f.queen, f.workspaceId, f.request));
    assert.equal(f.db.rows("agent_runs").length, 0);
  }
});

test("optional customization rechecks exact freshness and independent configuration-read authority", async () => {
  const f = await fixture();
  const c = await f.effects.create(f.queen, f.workspaceId, f.request);
  const run = f.db.rows("agent_runs").find((r) => r.id === c.rootRunId)!;
  const overlay = structuredClone(f.agent);
  overlay.data.configuration = [{ key: "tone", text: "brief" }];
  f.db.rows("client_agents").push(overlay);
  run.frozen.configurationOverlay = {
    id: overlay.id,
    revision: overlay.revision,
    contentHash: digest(JSON.parse(JSON.stringify(overlay))),
  };
  run.frozen.configuration = overlay.data.configuration;
  const session = {} as import("mongodb").ClientSession;
  assert.equal(
    await f.readiness.policy.current(f.db as never, run as never, session),
    true,
  );
  const deps = await f.readiness.policy.dependencies(
    f.db as never,
    run as never,
    session,
  );
  assert.ok(
    deps.some((d) => d.collection === "client_agents" && d.id === overlay.id),
  );
  f.denyOverlayRead();
  assert.equal(
    await f.readiness.policy.current(f.db as never, run as never, session),
    false,
  );
  overlay.revision++;
  await assert.rejects(
    f.readiness.policy.current(f.db as never, run as never, session),
  );
});
