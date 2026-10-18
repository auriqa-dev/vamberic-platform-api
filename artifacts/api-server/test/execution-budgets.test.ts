import test from "node:test";
import assert from "node:assert/strict";
import {
  createExecutionBudgets,
  type BudgetTransaction,
  type BudgetStore,
  type BudgetAuthority,
} from "../src/services/execution-budgets";
import { generatePlatformId as id } from "../src/domain/ids";
import {
  ExecutionBudgetPolicySchema,
  type BudgetOperation,
} from "../src/domain/execution-budgets";
function fixture() {
  const now = new Date("2026-01-02T00:00:00Z"),
    workspaceId = id("workspace"),
    configurationId = id("clientagent"),
    integrationId = id("integration");
  const policy = ExecutionBudgetPolicySchema.parse({
    id: id("budgetpolicy"),
    workspaceId,
    version: 1,
    scope: { kind: "configuration", configurationId, binding: "email" },
    measure: { kind: "quantity", unit: "emails" },
    operations: ["send"],
    limit: "10",
    effectiveFrom: new Date("2026-01-01Z"),
    effectiveUntil: new Date("2026-02-01Z"),
    createdAt: new Date("2026-01-01Z"),
    sourceEventId: id("event"),
  });
  const window = {
    id: id("budgetwindow"),
    workspaceId,
    policyId: policy.id,
    policyVersion: 1,
    start: policy.effectiveFrom,
    end: policy.effectiveUntil,
    reserved: "0",
    consumed: "0",
    executionSerial: 0,
    blocked: false,
  };
  const op: BudgetOperation = {
    id: "logical_1",
    workspaceId,
    configurationId,
    configurationRevision: 1,
    binding: "email",
    integrationId,
    integrationSerial: 0,
    operation: "send",
    payloadDigest: "a".repeat(64),
    runId: id("agentrun"),
    attemptId: id("agentattempt"),
    fence: 1,
    expiresAt: new Date("2026-01-03Z"),
  };
  let state = {
    policies: [policy],
    windows: [window],
    reservations: [] as BudgetTransaction["reservations"],
    events: [] as { receiptId?: string }[],
  };
  let queue = Promise.resolve();
  const store: BudgetStore = {
    transaction<T>(f: (tx: BudgetTransaction) => Promise<T>) {
      const run = queue.then(async () => {
        const draft = structuredClone(state);
        const result = await f({
          ...draft,
          receiptSeen: (id) => draft.events.some((e) => e.receiptId === id),
          appendEvent: (e) => draft.events.push(e),
        });
        state = draft;
        return result;
      });
      queue = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };
  let allowed = true;
  const authority: BudgetAuthority = {
    async authorize(_tx, value) {
      return allowed &&
        value.fence === 1 &&
        value.configurationId === configurationId &&
        value.workspaceId === workspaceId
        ? { allocations: [{ windowId: window.id, amount: "6" }] }
        : undefined;
    },
    async receipt(_tx, _r, value) {
      return value as { id: string; amounts: string[]; supersedes?: string };
    },
  };
  const engine = createExecutionBudgets(store, authority, () => now);
  return {
    engine,
    op,
    authority,
    store,
    policy,
    window,
    get state() {
      return state;
    },
    deny() {
      allowed = false;
    },
  };
}
test("concurrent reservations cannot overspend", async () => {
  const f = fixture();
  const r = await Promise.allSettled([
    f.engine.reserve(f.op),
    f.engine.reserve({ ...f.op, id: "logical_2" }),
  ]);
  assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(f.state.windows[0]!.reserved, "6");
  assert.equal(f.state.events.length, 1);
});
test("retry reserves once; changed payload conflicts", async () => {
  const f = fixture();
  const a = await f.engine.reserve(f.op);
  assert.equal((await f.engine.reserve(f.op)).id, a.id);
  await assert.rejects(
    f.engine.reserve({ ...f.op, payloadDigest: "b".repeat(64) }),
  );
  assert.equal(f.state.windows[0]!.reserved, "6");
});
test("workspace, configuration, revocation and fence isolation", async () => {
  for (const change of [
    { workspaceId: id("workspace") },
    { configurationId: id("clientagent") },
    { fence: 2 },
  ]) {
    const f = fixture();
    await assert.rejects(f.engine.reserve({ ...f.op, ...change }));
    assert.equal(f.state.reservations.length, 0);
  }
  const f = fixture();
  f.deny();
  await assert.rejects(f.engine.reserve(f.op));
});
test("missing budget fails closed", async () => {
  const f = fixture();
  f.authority.authorize = async () => ({ allocations: [] });
  await assert.rejects(f.engine.reserve(f.op));
});
test("unknown retains capacity and blocks retry", async () => {
  const f = fixture();
  await f.engine.reserve(f.op);
  await f.engine.markUnknown(f.op);
  await assert.rejects(f.engine.reserve(f.op));
  assert.equal(f.state.windows[0]!.reserved, "6");
});
test("late settlement and correction do not revive revoked execution", async () => {
  const f = fixture();
  const r = await f.engine.reserve(f.op);
  await f.engine.markUnknown(f.op);
  f.deny();
  const receipt = { id: "c".repeat(64), amounts: ["4"] };
  await f.engine.reconcile(f.op.workspaceId, r.id, receipt);
  await f.engine.reconcile(f.op.workspaceId, r.id, receipt);
  assert.equal(f.state.windows[0]!.reserved, "0");
  assert.equal(f.state.windows[0]!.consumed, "4");
  await assert.rejects(f.engine.reserve(f.op));
  await f.engine.reconcile(f.op.workspaceId, r.id, {
    id: "d".repeat(64),
    amounts: ["3"],
    supersedes: receipt.id,
  });
  assert.equal(f.state.windows[0]!.consumed, "3");
  await assert.rejects(f.engine.reconcile(f.op.workspaceId, r.id, receipt));
});
test("over-ceiling usage is honest and blocks new allocation", async () => {
  const f = fixture();
  const r = await f.engine.reserve(f.op);
  await f.engine.reconcile(f.op.workspaceId, r.id, {
    id: "c".repeat(64),
    amounts: ["11"],
  });
  assert.equal(f.state.windows[0]!.consumed, "11");
  assert.equal(f.state.windows[0]!.blocked, true);
  await assert.rejects(f.engine.reserve({ ...f.op, id: "logical_2" }));
});
test("fractional quantities and untrusted receipts rejected", async () => {
  const f = fixture();
  const r = await f.engine.reserve(f.op);
  await assert.rejects(
    f.engine.reconcile(f.op.workspaceId, r.id, {
      id: "c".repeat(64),
      amounts: ["1.5"],
    }),
  );
  assert.equal(f.state.windows[0]!.reserved, "6");
  f.authority.receipt = async () => undefined;
  await assert.rejects(f.engine.reconcile(f.op.workspaceId, r.id, {}));
});
test("account/configuration reservations are all-or-nothing", async () => {
  const f = fixture();
  await f.store.transaction(async (tx) => {
    const p = {
      ...f.policy,
      id: id("budgetpolicy"),
      scope: {
        kind: "account" as const,
        integrationId: f.op.integrationId,
        verifiedAccountDigest: "b".repeat(64),
      },
      limit: "5",
    };
    tx.policies.push(p);
    tx.windows.push({ ...f.window, id: id("budgetwindow"), policyId: p.id });
  });
  f.authority.authorize = async (tx) => ({
    allocations: tx.windows.map((w) => ({ windowId: w.id, amount: "6" })),
    verifiedAccountDigest: "b".repeat(64),
  });
  await assert.rejects(f.engine.reserve(f.op), /Quota/);
  assert.deepEqual(
    f.state.windows.map((w) => w.reserved),
    ["0", "0"],
  );
});
test("prior unresolved window blocks new consumption", async () => {
  const f = fixture();
  await f.store.transaction(async (tx) => {
    tx.windows.push({
      ...f.window,
      id: id("budgetwindow"),
      start: new Date("2025-12-01Z"),
      end: f.window.start,
      reserved: "1",
    });
  });
  await assert.rejects(f.engine.reserve(f.op), /unresolved/);
});
test("policy revision preserves consumed balance", async () => {
  const f = fixture();
  await f.store.transaction(async (tx) => {
    tx.policies.push({ ...f.policy, version: 2, limit: "5" });
    tx.windows[0]!.policyVersion = 2;
    tx.windows[0]!.consumed = "4";
  });
  await assert.rejects(f.engine.reserve(f.op));
});

test("receipt identity cannot settle another reservation or return after supersession", async () => {
  const f = fixture();
  const a = await f.engine.reserve(f.op);
  const receipt = { id: "e".repeat(64), amounts: ["1"] };
  await f.engine.reconcile(f.op.workspaceId, a.id, receipt);
  const b = await f.engine.reserve({ ...f.op, id: "logical_2" });
  await assert.rejects(
    f.engine.reconcile(f.op.workspaceId, b.id, receipt),
    /already consumed/,
  );
  const correction = {
    id: "f".repeat(64),
    amounts: ["0"],
    supersedes: receipt.id,
  };
  await f.engine.reconcile(f.op.workspaceId, a.id, correction);
  await assert.rejects(
    f.engine.reconcile(f.op.workspaceId, a.id, {
      ...receipt,
      supersedes: correction.id,
    }),
    /already consumed/,
  );
  assert.equal(f.state.windows[0]!.consumed, "0");
  assert.equal(f.state.windows[0]!.reserved, "6");
});

test("shared account requires a verified parent policy and cannot omit applicable capacity", async () => {
  const f = fixture();
  f.authority.authorize = async () => ({
    allocations: [{ windowId: f.window.id, amount: "6" }],
    sharedAccount: true,
  });
  await assert.rejects(f.engine.reserve(f.op), /Shared account/);
  await f.store.transaction(async (tx) => {
    const p = {
      ...f.policy,
      id: id("budgetpolicy"),
      scope: {
        kind: "account" as const,
        integrationId: f.op.integrationId,
        verifiedAccountDigest: "b".repeat(64),
      },
    };
    tx.policies.push(p);
    tx.windows.push({ ...f.window, id: id("budgetwindow"), policyId: p.id });
  });
  f.authority.authorize = async () => ({
    allocations: [{ windowId: f.window.id, amount: "6" }],
    sharedAccount: true,
    verifiedAccountDigest: "b".repeat(64),
  });
  await assert.rejects(f.engine.reserve(f.op), /Incomplete/);
  assert.equal(f.state.reservations.length, 0);
});
test("two integration aliases consume the same verified account window", async () => {
  const f = fixture();
  await f.store.transaction(async (tx) => {
    const p = {
      ...f.policy,
      id: id("budgetpolicy"),
      scope: {
        kind: "account" as const,
        integrationId: f.op.integrationId,
        verifiedAccountDigest: "b".repeat(64),
      },
    };
    tx.policies.push(p);
    tx.windows.push({ ...f.window, id: id("budgetwindow"), policyId: p.id });
    tx.policies[0]!.limit = "100";
  });
  f.authority.authorize = async (tx) => ({
    allocations: tx.windows.map((w) => ({ windowId: w.id, amount: "6" })),
    sharedAccount: true,
    verifiedAccountDigest: "b".repeat(64),
  });
  await f.engine.reserve(f.op);
  await assert.rejects(
    f.engine.reserve({
      ...f.op,
      id: "alias",
      integrationId: id("integration"),
    }),
    /Quota/,
  );
  assert.deepEqual(
    f.state.windows.map((w) => w.reserved),
    ["6", "6"],
  );
});
