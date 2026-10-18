import { OPENAI_TERMINAL_POLICY } from "../../../../vamberic-agent-runtime/dist/src/models/openai/terminal-policy.js";
import { openAITerminalQualification } from "../src/services/psu-terminal-qualification";
import { cases } from "./agent-execution-evidence-v23-parity.test";
import { agentMongoParity } from "./helpers/agent-mongo-parity";
import test from "node:test";
import assert from "node:assert/strict";
import { MongoClient, MongoServerError } from "mongodb";
import type { MongoService } from "../src/services/mongo";
import { createAgentWorkloadAuthority } from "../src/authorization/agent-workload";
import { createExecutionReconciliation } from "../src/services/agent-execution-reconciliation";
import {
  EXECUTION_EVIDENCE_COLLECTIONS,
  EXECUTION_EVIDENCE_VALIDATORS,
} from "../src/db/agent-execution-evidence-v23";
import {
  AGENT_CAPACITY_COLLECTIONS,
  AGENT_CAPACITY_VALIDATORS,
} from "../src/db/agent-capacity-v22";

// Opt-in disposable local harness: no env URI, production service, migration or provider access.
const enabled = process.env.PSU_NATIVE_LOCAL === "1";
const client = new MongoClient(
  "mongodb://127.0.0.1:27193/psu_v23_native_verify?directConnection=true&replicaSet=psu_v23_verify",
  { serverSelectionTimeoutMS: 5000 },
);
const database = client.db("psu_v23_native_verify");
const definitions = [
  ...AGENT_CAPACITY_COLLECTIONS,
  ...EXECUTION_EVIDENCE_COLLECTIONS,
];
const validators = {
  ...AGENT_CAPACITY_VALIDATORS,
  ...EXECUTION_EVIDENCE_VALIDATORS,
};
const mongo: MongoService = {
  isAvailable: async () => true,
  database: async () => database,
  close: async () => {},
  withTransaction: async (work) => {
    const session = client.startSession();
    try {
      return await session.withTransaction(() => work(database, session), {
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority" },
      });
    } finally {
      await session.endSession();
    }
  },
};
async function reset() {
  for (const name of [
    ...definitions.map((x) => x.name),
    "schema_versions",
    "agent_attempts",
    "agent_runs",
    "events",
    "agent_usage_observations",
  ])
    await database.collection(name).deleteMany({});
}
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
async function fixture(qualified = true) {
  await reset();
  const db = database;
  await db
    .collection("schema_versions")
    .insertOne({ _id: "vapp-v1", version: 23 } as never);
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
  await db.collection("agent_attempts").insertOne(attempt);
  await db.collection("agent_runs").insertOne(run);
  const api = createExecutionReconciliation(
    mongo,
    authority,
    release,
    async () => true,
    async () => {
      if (!authorized) throw new Error("denied");
    },
    () => now,
    qualified ? openAITerminalQualification("proj_synthetic") : {},
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
async function receipt(f: Awaited<ReturnType<typeof fixture>>) {
  const p = await f.prepare();
  await f.send();
  return {
    schemaVersion: 1,
    ...p,
    binding: f.binding,
    terminalContract: OPENAI_TERMINAL_POLICY.version,
    status: "completed",
    source: "trusted_worker_transport",
    quantities: [{ unit: "calls", quantity: 1 }],
  };
}
test("isolated native v23 verification", { skip: !enabled }, async (t) => {
  await client.connect();
  try {
    const hello = await database.command({ hello: 1 });
    assert.equal(hello.setName, "psu_v23_verify");
    assert.equal(hello.isWritablePrimary, true);
    assert.equal((await database.command({ buildInfo: 1 })).version, "8.0.32");
    // Collection creation is only in this hardcoded disposable database; never run migrations.
    for (const d of definitions) {
      await database.createCollection(d.name, {
        validator: validators[d.name],
        validationLevel: "strict",
        validationAction: "error",
      });
      for (const index of d.indexes)
        await database.collection(d.name).createIndex(index.key, index);
    }
    for (const n of [
      "schema_versions",
      "agent_attempts",
      "agent_runs",
      "events",
      "agent_usage_observations",
    ])
      await database.createCollection(n);
    await t.test(
      "actual Runtime terminal classifier drives native receipt release; HTTP errors stay occupied",
      async () => {
        const f = await fixture();
        await f.ready();
        const prepared = await f.prepare();
        await f.send();
        const context = {
          ...prepared,
          projectReference: "proj_synthetic",
          model: "gpt-6.1-sol",
          role: "maker" as const,
        };
        const body = {
          object: "response",
          id: "resp_synthetic",
          model: context.model,
          background: false,
          output: [],
          status: "completed",
          error: null,
          incomplete_details: null,
        };
        assert.equal(
          OPENAI_TERMINAL_POLICY.classify(
            { status: 500, body, invocationContext: context },
            context,
          ),
          undefined,
        );
        assert.equal(
          (await database.collection("agent_execution_slots").findOne({}))!
            .state,
          "occupied",
        );
        const status = OPENAI_TERMINAL_POLICY.classify(
          { status: 200, body, invocationContext: context },
          context,
        );
        assert.equal(status, "completed");
        assert.equal(
          (
            await f.api.evidence(f.principal, {
              schemaVersion: 1,
              ...prepared,
              binding: f.binding,
              terminalContract: OPENAI_TERMINAL_POLICY.version,
              status,
              source: "trusted_worker_transport",
              quantities: [{ unit: "calls", quantity: 1 }],
            })
          ).accepted,
          true,
        );
        assert.equal(
          (await database.collection("agent_execution_slots").findOne({}))!
            .state,
          "released",
        );
      },
    );
    await t.test(
      "all 16 boundary cases against installed v23 validators",
      async () => {
        process.env.AGENT_INSTALLED_MONGO_PARITY = "1";
        try {
          await agentMongoParity(cases, EXECUTION_EVIDENCE_VALIDATORS);
        } finally {
          delete process.env.AGENT_INSTALLED_MONGO_PARITY;
        }
      },
    );
    await t.test(
      "installed validators and all four v23 indexes match canonical definitions",
      async () => {
        const metadata = await database.listCollections().toArray();
        for (const d of EXECUTION_EVIDENCE_COLLECTIONS) {
          const m = metadata.find((x) => x.name === d.name)!;
          assert.deepEqual(m.options!.validator, validators[d.name]);
          assert.equal(m.options!.validationLevel, "strict");
          assert.equal(m.options!.validationAction, "error");
          const indexes = await database
            .collection(d.name)
            .listIndexes()
            .toArray();
          assert.equal(indexes.length, d.indexes.length + 1);
          for (const i of d.indexes) {
            const actual = indexes.find((x) => x.name === i.name)!;
            assert.deepEqual(actual.key, i.key);
            assert.equal(actual.unique, true);
            assert.equal(actual.expireAfterSeconds, undefined);
            assert.equal(actual.partialFilterExpression, undefined);
            assert.equal(actual.sparse, undefined);
          }
        }
      },
    );
    await t.test(
      "each unique index rejects duplicate keys natively",
      async () => {
        const f = await fixture();
        await f.ready();
        await f.prepare();
        const row = (await database
          .collection("agent_execution_invocations")
          .findOne({}))!;
        delete (row as Record<string, unknown>)._id;
        const dup = async (doc: typeof row) =>
          assert.rejects(
            database.collection("agent_execution_invocations").insertOne(doc),
            (e) => e instanceof MongoServerError && e.code === 11000,
          );
        await dup({
          ...row,
          correlationId: "different",
          binding: { ...row.binding, invocationId: "different" },
        });
        await dup({ ...row, id: "different", correlationId: "different" });
        await dup({
          ...row,
          id: "different",
          binding: { ...row.binding, invocationId: "different" },
        });
        await assert.rejects(
          database
            .collection("agent_execution_controls")
            .insertOne({ id: "dev:agent_runtime", state: "open", revision: 1 }),
          (e) => e instanceof MongoServerError && e.code === 11000,
        );
      },
    );
    await t.test(
      "simultaneous preparations and permissions have exactly one winner",
      async () => {
        const f = await fixture();
        await f.ready();
        const results = await Promise.allSettled(
          Array.from({ length: 8 }, (_, i) =>
            f.api.prepare(f.principal, {
              binding: { ...f.binding, invocationId: `call:${i}` },
              provider,
            }),
          ),
        );
        assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
        const j = (await database
          .collection("agent_execution_invocations")
          .findOne({}))!;
        const sent = await Promise.all(
          Array.from({ length: 8 }, () =>
            f.api.issueSend(f.principal, { binding: j.binding, provider }),
          ),
        );
        assert.equal(sent.filter((x) => x.permitted).length, 1);
        assert.equal(await f.api.status(), "busy");
      },
    );
    await t.test(
      "late receipt after revoked execution preserves terminal Run and is immutable/idempotent",
      async () => {
        const f = await fixture();
        await f.ready();
        const r = await receipt(f);
        f.advance(300001);
        f.deny();
        await database
          .collection("agent_attempts")
          .updateOne(
            { id: f.binding.attemptId },
            { $set: { status: "expired" } },
          );
        await database
          .collection("agent_runs")
          .updateOne({ id: f.binding.runId }, { $set: { status: "failed" } });
        assert.equal((await f.api.evidence(f.principal, r)).accepted, true);
        const n = await database.collection("events").countDocuments();
        await f.api.evidence(f.principal, r);
        assert.equal(await database.collection("events").countDocuments(), n);
        assert.equal(
          (await database.collection("agent_runs").findOne({}))!.status,
          "failed",
        );
        assert.equal(
          await database
            .collection("agent_usage_observations")
            .countDocuments(),
          0,
        );
        assert.equal(
          (await f.api.evidence(f.principal, { ...r, status: "failed" }))
            .accepted,
          false,
        );
        assert.equal(
          (await database.collection("agent_execution_controls").findOne({}))!
            .state,
          "integrity_hold",
        );
        assert.equal(
          (await database
            .collection("agent_execution_invocations")
            .findOne({}))!.receipt.status,
          "completed",
        );
      },
    );
    await t.test(
      "old receipt cannot release a genuinely newer occupied slot",
      async () => {
        const f = await fixture();
        await f.ready();
        const r = await receipt(f);
        await f.api.evidence(f.principal, r);
        const binding = { ...f.binding, invocationId: "call:next" };
        await f.api.prepare(f.principal, { binding, provider });
        await f.api.issueSend(f.principal, { binding, provider });
        await f.api.evidence(f.principal, r);
        const slot = (await database
          .collection("agent_execution_slots")
          .findOne({}))!;
        assert.equal(slot.state, "occupied");
        assert.equal(slot.binding.invocationId, "call:next");
      },
    );
    await t.test(
      "expired prepared work races send to no-send without resurrection",
      async () => {
        const f = await fixture();
        await f.ready();
        await f.prepare();
        f.advance(300001);
        await Promise.allSettled([f.send(), f.api.reconcile(f.binding)]);
        assert.equal(
          (await database
            .collection("agent_execution_invocations")
            .findOne({}))!.state,
          "no_send",
        );
        assert.equal((await f.send()).permitted, false);
      },
    );
    await t.test(
      "possibly-sent ambiguity remains quarantined despite time and readiness",
      async () => {
        const f = await fixture();
        await f.ready();
        await f.prepare();
        await f.send();
        await f.api.quarantine(f.principal, f.binding);
        f.advance(172800000);
        await f.ready();
        assert.equal((await f.api.reconcile(f.binding)).released, false);
        assert.equal(await f.api.available(), false);
      },
    );
    await t.test(
      "audit validation failure rolls back control, slot and journal transaction",
      async () => {
        const f = await fixture();
        await f.ready();
        const before = await database
          .collection("agent_execution_controls")
          .findOne({});
        await database.command({
          collMod: "events",
          validator: {
            $jsonSchema: { required: ["impossibleSyntheticField"] },
          },
          validationLevel: "strict",
          validationAction: "error",
        });
        try {
          await assert.rejects(f.prepare());
          assert.equal(
            await database
              .collection("agent_execution_invocations")
              .countDocuments(),
            0,
          );
          assert.equal(
            await database.collection("agent_execution_slots").countDocuments(),
            0,
          );
          assert.deepEqual(
            await database.collection("agent_execution_controls").findOne({}),
            before,
          );
        } finally {
          await database.command({ collMod: "events", validator: {} });
        }
      },
    );
    await t.test(
      "application denies mismatched binding, unqualified contract and forged principal",
      async () => {
        const f = await fixture();
        await f.ready();
        const r = await receipt(f);
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
        ]) {
          const b = {
            ...r.binding,
            [field]:
              typeof r.binding[field as keyof typeof r.binding] === "number"
                ? 2
                : "other",
          };
          await assert.rejects(
            f.api.evidence(f.principal, { ...r, binding: b }),
          );
        }
        await assert.rejects(
          f.api.evidence(f.principal, {
            ...r,
            terminalContract: "unqualified",
          }),
        );
        await assert.rejects(f.api.evidence({ ...f.principal }, r));
        assert.equal(
          (await database.collection("agent_execution_slots").findOne({}))!
            .state,
          "occupied",
        );
      },
    );
  } finally {
    await client.close();
  }
});
