import test from "node:test";
import assert from "node:assert/strict";
import { EnquiryMemoryDb } from "./helpers/enquiry-db";
import { createAgentWorkloadAuthority } from "../src/authorization/agent-workload";
import { createExecutionReconciliation } from "../src/services/agent-execution-reconciliation";
import { releaseDatabaseTarget, createDatabaseSetup } from "../src/db/setup";
import { validateReceipt } from "../src/domain/agent-execution-evidence";
import { FakeDb } from "./helpers/commercial-migration-db";
import type { Db } from "mongodb";
const release = {
  environment: "dev" as const,
  workloadClass: "agent_runtime" as const,
  workloadClientId: "client",
  manifestDigest: "a".repeat(64),
  buildDigest: "b".repeat(64),
  policyDigest: "c".repeat(64),
  serviceArn: "service",
  taskDefinitionArn: "task",
  imageDigest: `sha256:${"d".repeat(64)}`,
};
const provider = {
  provider: "openai",
  model: "gpt-6.1-sol",
  role: "maker",
  projectReference: "proj_synthetic",
  transportVersion: "psu_execution_evidence_v1",
  requestDigest: "a".repeat(64),
};
function fixture(qualified = true) {
  const db = new EnquiryMemoryDb();
  db.rows("schema_versions").push({ _id: "vapp-v1", version: 29 });
  const authority = createAgentWorkloadAuthority("dev", ["client", "other"]);
  const identity = {
    environment: "dev" as const,
    clientId: "client",
    workerId: "worker:00000000-0000-4000-8000-000000000001",
    workloadClass: "agent_runtime" as const,
    scopes: ["capacity", "execution_evidence"] as (
      "capacity" | "execution_evidence"
    )[],
  };
  const principal = authority.authenticated(identity);
  let now = new Date("2026-10-05T00:00:00Z"),
    authorized = true;
  const binding = {
    runId: "run:one",
    attemptId: "attempt:one",
    workspaceId: "workspace_00000000000000000000000001",
    generation: 1,
    fence: 1,
    leaseId: "lease:one",
    workerId: principal.workerId,
    workloadClientId: principal.clientId,
    invocationId: "call:one",
    release,
  };
  const attempt = {
    id: binding.attemptId,
    runId: binding.runId,
    workspaceId: binding.workspaceId,
    generation: 1,
    fence: 1,
    leaseId: binding.leaseId,
    workerId: binding.workerId,
    workloadClientId: binding.workloadClientId,
    status: "running",
    leaseUntil: new Date(+now + 300000),
  };
  const run = {
    id: binding.runId,
    status: "running",
    activeAttemptId: binding.attemptId,
    generation: 1,
    fence: 1,
    frozen: { operation: "understand" },
  };
  db.rows("agent_attempts").push(attempt);
  db.rows("agent_runs").push(run);
  const api = createExecutionReconciliation(
    db.mongo,
    authority,
    release,
    async () => true,
    async () => {
      if (!authorized) throw new Error("denied");
    },
    () => now,
    qualified
      ? {
          projectReference: "proj_synthetic",
          terminalContracts: ["synthetic_terminal_v1"],
        }
      : {},
  );
  const ready = async () => {
    await api.report(principal, { release, taskArn: "task", ready: true });
    await api.observe();
  };
  const prepare = () => api.prepare(principal, { binding, provider });
  const send = () => api.issueSend(principal, { binding, provider });
  return {
    db,
    api,
    principal,
    identity,
    authority,
    binding,
    ready,
    prepare,
    send,
    attempt,
    run,
    advance: (ms: number) => {
      now = new Date(+now + ms);
    },
    deny: () => {
      authorized = false;
    },
  };
}
async function receipt(f: ReturnType<typeof fixture>) {
  const p = await f.prepare();
  await f.send();
  return {
    schemaVersion: 1,
    ...p,
    binding: f.binding,
    terminalContract: "synthetic_terminal_v1",
    status: "completed",
    source: "trusted_worker_transport",
    quantities: [
      { unit: "calls", quantity: 1 },
      { unit: "input_tokens", quantity: 100 },
    ],
  };
}
test("v23 only adds two collections/four indexes and preserves every predecessor target", async () => {
  const old = releaseDatabaseTarget(22),
    next = releaseDatabaseTarget(23);
  for (const [name, v] of Object.entries(old.validators))
    assert.deepEqual(next.validators[name], v);
  assert.deepEqual(
    next.collections.slice(0, old.collections.length),
    old.collections,
  );
  assert.equal(next.collections.length - old.collections.length, 2);
  assert.equal(next.collections.slice(-2).flatMap((c) => c.indexes).length, 4);
  assert.ok(
    next.collections
      .slice(-2)
      .every((c) => c.indexes.every((i) => i.expireAfterSeconds === undefined)),
  );
  const db = new FakeDb();
  const target = createDatabaseSetup(next);
  assert.ok(
    (await target.planDatabaseSetup(db as unknown as Db)).validatorConflicts
      .length,
  );
  for (let v = 12; v <= 22; v++)
    await createDatabaseSetup({
      ...releaseDatabaseTarget(v as 22),
      ordered: v !== 12,
    }).setupDatabase(db as unknown as Db);
  const plan = await target.planDatabaseSetup(db as unknown as Db);
  assert.deepEqual(plan.validatorConflicts, []);
  assert.equal(plan.collectionsToCreate.length, 2);
  await target.setupDatabase(db as unknown as Db);
  assert.equal(db.collection("agent_execution_invocations").documents.size, 0);
  assert.deepEqual(
    (await target.planDatabaseSetup(db as unknown as Db)).validatorsToApply,
    [],
  );
});
test("unqualified provider blocks admission and prepare without provider probing", async () => {
  const f = fixture(false);
  await f.ready();
  assert.equal(await f.api.status(), "unavailable");
  await assert.rejects(f.prepare());
});
test("prepare is busy; exactly one send permission; acquisition replay cannot call again", async () => {
  const f = fixture();
  await f.ready();
  assert.equal(await f.api.status(), "idle");
  await f.prepare();
  assert.equal(await f.api.status(), "busy");
  assert.equal(await f.api.available(), false);
  await assert.rejects(f.prepare());
  assert.equal((await f.send()).permitted, true);
  assert.equal((await f.send()).permitted, false);
});
test("terminal late evidence releases exact slot despite expired lease/revoked execution; no usage mutation", async () => {
  const f = fixture();
  await f.ready();
  const r = await receipt(f);
  f.advance(300001);
  f.attempt.status = "expired";
  f.run.status = "failed";
  f.deny();
  assert.equal((await f.api.evidence(f.principal, r)).accepted, true);
  assert.equal(f.db.rows("agent_execution_slots")[0]!.state, "released");
  assert.equal(f.db.rows("agent_usage_observations").length, 0);
  assert.equal(f.run.status, "failed");
});
test("ACK replay is idempotent and cannot release a later slot", async () => {
  const f = fixture();
  await f.ready();
  const r = await receipt(f);
  await f.api.evidence(f.principal, r);
  const n = f.db.rows("events").length;
  f.db.rows("agent_execution_slots")[0]!.binding = {
    ...f.binding,
    invocationId: "call:next",
  };
  f.db.rows("agent_execution_slots")[0]!.state = "occupied";
  await f.api.evidence(f.principal, r);
  assert.equal(f.db.rows("events").length, n);
  assert.equal(f.db.rows("agent_execution_slots")[0]!.state, "occupied");
});
test("conflicting evidence holds environment once without overwriting first receipt", async () => {
  const f = fixture();
  await f.ready();
  const r = await receipt(f);
  await f.api.evidence(f.principal, r);
  const different = { ...r, status: "failed" };
  assert.equal((await f.api.evidence(f.principal, different)).accepted, false);
  const n = f.db.rows("events").length;
  await f.api.evidence(f.principal, different);
  assert.equal(f.db.rows("events").length, n);
  assert.equal(await f.api.status(), "unavailable");
  assert.equal(
    (f.db.rows("agent_execution_invocations")[0]!.receipt as { status: string })
      .status,
    "completed",
  );
});
for (const field of [
  "workerId",
  "workloadClientId",
  "workspaceId",
  "runId",
  "attemptId",
  "leaseId",
  "invocationId",
  "generation",
  "fence",
] as const)
  test(`evidence denies altered ${field}`, async () => {
    const f = fixture();
    await f.ready();
    const r = await receipt(f);
    await assert.rejects(
      f.api.evidence(f.principal, {
        ...r,
        binding: {
          ...r.binding,
          [field]: typeof r.binding[field] === "number" ? 2 : "other",
        },
      }),
    );
  });
for (const field of [
  "journalId",
  "correlationId",
  "requestDigest",
  "terminalContract",
] as const)
  test(`evidence denies altered ${field}`, async () => {
    const f = fixture();
    await f.ready();
    const r = await receipt(f);
    await assert.rejects(
      f.api.evidence(f.principal, {
        ...r,
        [field]: field === "requestDigest" ? "f".repeat(64) : "other",
      }),
    );
  });
test("forged principal/missing scope/other authenticated class client rejected", async () => {
  const f = fixture();
  await f.ready();
  const r = await receipt(f);
  await assert.rejects(f.api.evidence({ ...f.principal }, r));
  await assert.rejects(
    f.api.evidence(
      f.authority.authenticated({ ...f.identity, scopes: ["capacity"] }),
      r,
    ),
  );
  await assert.rejects(
    f.api.evidence(
      f.authority.authenticated({ ...f.identity, clientId: "other" }),
      r,
    ),
  );
});
for (const ms of [86399999, 86400000, 86400001])
  test(`receipt cutoff ${ms}`, async () => {
    const f = fixture();
    await f.ready();
    const r = await receipt(f);
    f.advance(ms);
    if (ms < 86400000)
      assert.equal((await f.api.evidence(f.principal, r)).accepted, true);
    else await assert.rejects(f.api.evidence(f.principal, r));
  });
test("prepared cancellation/expiry proves no-send; delayed issue-send cannot resurrect", async () => {
  const f = fixture();
  await f.ready();
  await f.prepare();
  assert.equal((await f.api.reconcile(f.binding)).released, false);
  f.advance(300001);
  assert.equal((await f.api.reconcile(f.binding)).released, true);
  assert.equal((await f.send()).permitted, false);
  assert.equal(f.db.rows("agent_execution_invocations")[0]!.state, "no_send");
});
test("permission ACK loss/crash/timeout never becomes no-send or clock takeover", async () => {
  const f = fixture();
  await f.ready();
  await f.prepare();
  await f.send();
  await f.api.quarantine(f.principal, f.binding);
  f.advance(86400000 * 2);
  assert.equal((await f.api.reconcile(f.binding)).released, false);
  assert.equal(f.db.rows("agent_execution_slots")[0]!.state, "quarantined");
  await f.ready();
  assert.equal(await f.api.available(), false);
});
test("audit failure rolls back slot, journal and control changes", async () => {
  const f = fixture();
  await f.ready();
  f.db.failCollection = "events";
  await assert.rejects(f.prepare());
  assert.equal(f.db.rows("agent_execution_slots").length, 0);
  assert.equal(f.db.rows("agent_execution_invocations").length, 0);
});
test("strict receipt excludes secrets, duplicate quantities and oversized fields", async () => {
  const f = fixture();
  await f.ready();
  const r = await receipt(f);
  assert.throws(() => validateReceipt({ ...r, secret: "synthetic" }));
  assert.throws(() =>
    validateReceipt({ ...r, providerRequestId: "x".repeat(257) }),
  );
  assert.throws(() =>
    validateReceipt({
      ...r,
      quantities: [
        { unit: "calls", quantity: 1 },
        { unit: "calls", quantity: 1 },
      ],
    }),
  );
});

test("no-send versus send race serializes to one irreversible decision", async () => {
  for (const sendFirst of [true, false]) {
    const f = fixture();
    await f.ready();
    await f.prepare();
    if (!sendFirst) f.advance(300001);
    const results = await Promise.allSettled(
      sendFirst
        ? [f.send(), f.api.reconcile(f.binding)]
        : [f.api.reconcile(f.binding), f.send()],
    );
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 2);
    const row = f.db.rows("agent_execution_invocations")[0]!;
    assert.equal(row.state, sendFirst ? "possibly_sent" : "no_send");
    assert.equal(
      f.db.rows("agent_execution_slots")[0]!.state,
      sendFirst ? "occupied" : "released",
    );
  }
});
test("concurrent preparations have one owner; quarantine stops admission despite new readiness", async () => {
  const f = fixture();
  await f.ready();
  const attempts = await Promise.allSettled([
    f.prepare(),
    f.api.prepare(f.principal, {
      binding: { ...f.binding, invocationId: "call:two" },
      provider,
    }),
  ]);
  assert.equal(attempts.filter((x) => x.status === "fulfilled").length, 1);
  const b = f.db.rows("agent_execution_invocations")[0]!.binding;
  await f.api.issueSend(f.principal, { binding: b, provider });
  await f.api.quarantine(f.principal, b);
  await f.ready();
  assert.equal(await f.api.status(), "unavailable");
  assert.equal(
    await f.db.mongo.withTransaction!((db, s) => f.api.admit(db, s)),
    false,
  );
});
test("legacy v22 occupied slot cannot gain fabricated journal or release", async () => {
  const f = fixture();
  await f.ready();
  f.db.rows("agent_execution_slots").push({
    id: "dev:agent_runtime",
    state: "occupied",
    binding: f.binding,
    revision: 1,
    updatedAt: new Date(),
  });
  assert.equal(await f.api.status(), "unavailable");
  await assert.rejects(f.prepare());
  await assert.rejects(f.api.reconcile(f.binding));
});
test("provider project/model/digest and release cannot drift after preparation", async () => {
  const f = fixture();
  await f.ready();
  await assert.rejects(
    f.api.prepare(f.principal, {
      binding: f.binding,
      provider: { ...provider, projectReference: "proj_other" },
    }),
  );
  await assert.rejects(
    f.api.prepare(f.principal, {
      binding: f.binding,
      provider: { ...provider, model: "gpt-6-astra" },
    }),
  );
  await f.prepare();
  await assert.rejects(
    f.api.issueSend(f.principal, {
      binding: f.binding,
      provider: { ...provider, requestDigest: "f".repeat(64) },
    }),
  );
  await assert.rejects(
    f.api.issueSend(f.principal, {
      binding: {
        ...f.binding,
        release: { ...release, policyDigest: "f".repeat(64) },
      },
      provider,
    }),
  );
});
test("explicit disablement and lost ownership deny send; never turn into permission", async () => {
  const f = fixture();
  await f.ready();
  await f.prepare();
  await f.api.report(f.principal, { release, taskArn: "task", ready: false });
  await assert.rejects(f.send());
  assert.equal(f.db.rows("agent_execution_invocations")[0]!.state, "prepared");
  await f.ready();
  f.deny();
  await assert.rejects(f.send());
});
test("post-terminal measured interval is retained as pending evidence without fabricated usage", async () => {
  const f = fixture();
  await f.ready();
  const r = await receipt(f);
  f.attempt.status = "expired";
  f.deny();
  await f.api.evidence(f.principal, {
    ...r,
    measuredInterval: {
      startedAt: "2026-10-05T00:00:00Z",
      endedAt: "2026-10-05T00:01:00Z",
    },
  });
  assert.equal(
    f.db.rows("agent_execution_invocations")[0]!.financialReconciliationPending,
    true,
  );
  assert.equal(f.db.rows("agent_usage_observations").length, 0);
});

test("schema24 preserves execution qualification and capacity path", async () => {
  const f = fixture();
  f.db.rows("schema_versions")[0].version = 24;
  await f.ready();
  const prepared = await f.prepare();
  assert.ok(prepared);
});
