import test from "node:test";
import assert from "node:assert/strict";
import type { Db } from "mongodb";
import { releaseDatabaseTarget, createDatabaseSetup } from "../src/db/setup";
import { EnquiryMemoryDb } from "./helpers/enquiry-db";
import { FakeDb } from "./helpers/commercial-migration-db";
import { createAgentWorkloadAuthority } from "../src/authorization/agent-workload";
import { createAgentCapacity } from "../src/services/agent-capacity";
import {
  CapacityObservationSchema,
  ExecutionSlotSchema,
  capacityFresh,
} from "../src/domain/agent-capacity";
import {
  productionCaseBudget,
  productionRunBudget,
} from "../src/services/product-service-understanding/execution-policy";
const release = {
  environment: "dev" as const,
  workloadClass: "agent_runtime" as const,
  workloadClientId: "client",
  manifestDigest: "a".repeat(64),
  buildDigest: "b".repeat(64),
  policyDigest: "c".repeat(64),
  serviceArn: "service",
  taskDefinitionArn: "definition",
  imageDigest: `sha256:${"d".repeat(64)}`,
};
function fixture() {
  const db = new EnquiryMemoryDb();
  db.rows("schema_versions").push({ _id: "vapp-v1", version: 22 });
  const authority = createAgentWorkloadAuthority("dev", ["client"]);
  const principal = authority.authenticated({
    environment: "dev",
    clientId: "client",
    workerId: "worker:00000000-0000-4000-8000-000000000001",
    workloadClass: "agent_runtime",
    scopes: ["capacity"],
  });
  let now = new Date("2026-10-05T00:00:00Z"),
    matches = true,
    owned = true;
  const capacity = createAgentCapacity(
    db.mongo,
    authority,
    release,
    async () => matches,
    async () => {
      if (!owned) throw new Error("ownership denied");
    },
    () => now,
  );
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
  return {
    db,
    principal,
    capacity,
    binding,
    report: () =>
      capacity.report(principal, { release, taskArn: "task", ready: true }),
    advance: () => {
      now = new Date(+now + 30000);
    },
    deny: () => {
      owned = false;
    },
    mismatch: () => {
      matches = false;
    },
  };
}
test("v22 is additive and v12–21 targets retain exact prior validators/indexes", () => {
  const before = releaseDatabaseTarget(21),
    after = releaseDatabaseTarget(22);
  for (const [name, value] of Object.entries(before.validators))
    assert.deepEqual(after.validators[name], value, name);
  assert.deepEqual(
    after.collections.slice(0, before.collections.length),
    before.collections,
  );
  assert.deepEqual(
    after.collections.slice(before.collections.length).map((c) => c.name),
    ["agent_capacity_observations", "agent_execution_slots"],
  );
  assert.equal(
    after.collections.slice(before.collections.length).flatMap((c) => c.indexes)
      .length,
    4,
  );
  assert.ok(
    after.collections
      .slice(before.collections.length)
      .every((c) => c.indexes.every((i) => i.expireAfterSeconds === undefined)),
  );
});
test("v22 rejects skip/new-install; synthetic ordered21→22 adds only two empty operational collections", async () => {
  const db = new FakeDb();
  const target = createDatabaseSetup(releaseDatabaseTarget(22));
  assert.ok(
    (await target.planDatabaseSetup(db as unknown as Db)).validatorConflicts
      .length,
  );
  for (let v = 12; v <= 21; v++) {
    // Install synthetic fixture through previous fixed target; exact predecessor ledger is constructed below.
    if (v === 12)
      await createDatabaseSetup({
        ...releaseDatabaseTarget(12),
        ordered: false,
      }).setupDatabase(db as unknown as Db);
    else
      await createDatabaseSetup(releaseDatabaseTarget(v as 13)).setupDatabase(
        db as unknown as Db,
      );
  }
  const plan = await target.planDatabaseSetup(db as unknown as Db);
  assert.deepEqual(plan.validatorConflicts, []);
  assert.deepEqual(plan.collectionsToCreate, [
    "agent_capacity_observations",
    "agent_execution_slots",
  ]);
  assert.equal(plan.indexesToCreate.length, 4);
  await target.setupDatabase(db as unknown as Db);
  assert.equal(db.collection("agent_execution_slots").documents.size, 0);
  const rerun = await target.planDatabaseSetup(db as unknown as Db);
  assert.equal(rerun.existingSchemaVersion, 22);
  assert.deepEqual(rerun.indexesToCreate, []);
  assert.deepEqual(rerun.validatorsToApply, []);
});
test("readiness needs both observations; stale, mismatched or explicitly disabled fails closed", async () => {
  const f = fixture();
  assert.equal(await f.capacity.available(), false);
  await f.report();
  assert.equal(await f.capacity.available(), false);
  await f.capacity.observe();
  assert.equal(await f.capacity.available(), true);
  f.advance();
  assert.equal(await f.capacity.available(), false);
  await f.report();
  assert.equal(await f.capacity.available(), false);
  await f.capacity.observe();
  assert.equal(await f.capacity.available(), true);
  f.mismatch();
  await f.capacity.observe();
  assert.equal(await f.capacity.available(), false);
  await f.capacity.report(f.principal, {
    release,
    taskArn: "task",
    ready: false,
  });
  assert.equal(await f.capacity.available(), false);
});
test("one concurrent owner; terminal releases capacity independently of monetary estimates; replay denied", async () => {
  const f = fixture();
  await f.report();
  await f.capacity.observe();
  const results = await Promise.allSettled([
    f.capacity.transition(f.principal, f.binding, "acquire"),
    f.capacity.transition(
      f.principal,
      { ...f.binding, invocationId: "call:two" },
      "acquire",
    ),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const slot = ExecutionSlotSchema.parse(f.db.rows("agent_execution_slots")[0]);
  await f.capacity.transition(f.principal, slot.binding, "terminal");
  await assert.rejects(
    f.capacity.transition(f.principal, slot.binding, "acquire"),
  );
  await f.capacity.transition(
    f.principal,
    { ...slot.binding, invocationId: "call:three" },
    "acquire",
  );
  assert.equal(f.db.rows("agent_usage_observations").length, 0);
  assert.equal(f.db.rows("events").length, 3);
});
test("ambiguous slot never expires/takes over and stale fence cannot finish another invocation", async () => {
  const f = fixture();
  await f.report();
  await f.capacity.observe();
  await f.capacity.transition(f.principal, f.binding, "acquire");
  await assert.rejects(
    f.capacity.transition(f.principal, { ...f.binding, fence: 2 }, "terminal"),
  );
  await f.capacity.transition(f.principal, f.binding, "quarantine");
  f.advance();
  await f.report();
  await f.capacity.observe();
  await assert.rejects(
    f.capacity.transition(
      f.principal,
      { ...f.binding, invocationId: "call:next" },
      "acquire",
    ),
  );
  await assert.rejects(
    f.capacity.transition(f.principal, f.binding, "terminal"),
  );
  assert.equal(f.db.rows("agent_execution_slots")[0]!.state, "quarantined");
});
test("forged principal, wrong release, lost ownership and transaction audit failure fail closed", async () => {
  const f = fixture();
  await assert.rejects(
    f.capacity.report(
      { ...f.principal },
      { release, taskArn: "task", ready: true },
    ),
  );
  await assert.rejects(
    f.capacity.report(f.principal, {
      release: { ...release, policyDigest: "f".repeat(64) },
      taskArn: "task",
      ready: true,
    }),
  );
  await f.report();
  await f.capacity.observe();
  f.db.failCollection = "events";
  await assert.rejects(
    f.capacity.transition(f.principal, f.binding, "acquire"),
  );
  assert.equal(f.db.rows("agent_execution_slots").length, 0);
  f.db.failCollection = undefined;
  f.deny();
  await assert.rejects(
    f.capacity.transition(f.principal, f.binding, "acquire"),
  );
});
test("structural schemas are strict; timestamp/release/role semantics require application checks", () => {
  const row = CapacityObservationSchema.parse({
    id: "observation",
    release,
    workerId: "worker:00000000-0000-4000-8000-000000000001",
    taskArn: "task",
    roles: ["maker", "maker", "maker"],
    ready: true,
    reportedAt: new Date(),
    observedAt: new Date(),
    deploymentMatches: true,
    revision: 1,
  });
  assert.equal(capacityFresh(row, new Date()), false);
  assert.throws(() =>
    CapacityObservationSchema.parse({ ...row, secret: "never" }),
  );
});
test("approved immutable USD envelopes fit maximum bounded lifecycle exactly", () => {
  const deadline = "2026-10-05T01:00:00Z";
  const maker = productionRunBudget("maker", deadline),
    evalBudget = productionRunBudget("evaluator", deadline),
    revision = productionRunBudget("revision", deadline),
    total = productionCaseBudget(deadline);
  assert.equal(
    maker.modelCalls + 3 * evalBudget.modelCalls + 2 * revision.modelCalls,
    total.modelCalls,
  );
  assert.equal(
    Math.round(Number(maker.cost.amount) * 100) +
      3 * Math.round(Number(evalBudget.cost.amount) * 100) +
      2 * Math.round(Number(revision.cost.amount) * 100),
    800,
  );
  assert.equal(total.cost.currency, "USD");
  assert.equal(total.toolCalls, 0);
});

test("trusted deployment observer checks exact service/task definition/image and rejects worker-only assertions", async () => {
  const { createEcsDeploymentObserver } =
    await import("../src/services/agent-deployment-observer");
  const approved = {
    ...release,
    serviceArn: "arn:aws:ecs:eu-west-2:123456789012:service/dev/worker",
    taskDefinitionArn:
      "arn:aws:ecs:eu-west-2:123456789012:task-definition/worker:1",
  };
  const taskArn = "arn:aws:ecs:eu-west-2:123456789012:task/dev/one";
  const task = {
    taskArn,
    taskDefinitionArn: approved.taskDefinitionArn,
    lastStatus: "RUNNING",
    desiredStatus: "RUNNING",
    group: "service:worker",
    containers: [
      {
        name: "worker",
        lastStatus: "RUNNING",
        imageDigest: approved.imageDigest,
      },
    ],
  };
  const observer = createEcsDeploymentObserver({
    describeTasks: async () => ({ tasks: [task] }),
    describeServices: async () => ({
      services: [
        {
          serviceArn: approved.serviceArn,
          taskDefinition: approved.taskDefinitionArn,
          status: "ACTIVE",
        },
      ],
    }),
  });
  assert.equal(await observer(taskArn, approved), true);
  task.containers[0]!.imageDigest = `sha256:${"e".repeat(64)}`;
  assert.equal(await observer(taskArn, approved), false);
  assert.equal(await observer("arbitrary-task", approved), false);
});

test("unapplied or conflicting schema cannot admit work even with leftover capacity rows", async () => {
  const f = fixture();
  await f.report();
  await f.capacity.observe();
  f.db.rows("schema_versions")[0]!.version = 21;
  await assert.rejects(f.capacity.available());
  await assert.rejects(
    f.db.mongo.withTransaction!((db, session) => f.capacity.admit(db, session)),
  );
});
