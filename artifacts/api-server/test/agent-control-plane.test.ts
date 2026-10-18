import assert from "node:assert/strict";
import { createAgentOperatorService } from "../src/services/agent-operators";
import { snapshotInterleaving } from "./helpers/agent-snapshot-db";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  digest,
  digestWithout,
  type Outcome,
  type ClaimedWork,
} from "@workspace/agent-runtime-protocol";
import { generatePlatformId } from "../src/domain/ids";
import { parseFrozenWork } from "../src/domain/agent-control-plane";
import { createAgentControlPlane } from "../src/services/agent-control-plane";
import { createAgentWorkloadAuthority } from "../src/authorization/agent-workload";
import { agentOperatorFixture } from "./helpers/agent-operator-fixture";

const fixtureJson = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL(
        `../../../lib/agent-runtime-protocol/fixtures/${name}.json`,
        import.meta.url,
      ),
      "utf8",
    ),
  );
async function fixture(protocolVersion: "1.1" | "1.2" = "1.1") {
  const f = await agentOperatorFixture();
  const source = fixtureJson("claimedWork");
  source.protocolVersion = protocolVersion;
  if (protocolVersion === "1.2") f.db.rows("schema_versions")[0]!.version = 12;
  const runId = generatePlatformId("agentrun");
  const organisationId = f.db.rows("organisations")[0]!.id;
  const replacements = new Map<string, string>([
    [source.runId, runId],
    [source.workspaceId, f.workspaceId],
    [source.clientId, organisationId],
    [source.clientAgent.id, f.agent.id],
  ]);
  function replace<T>(v: T): T {
    return JSON.parse(
      JSON.stringify(v, (_k, x) =>
        typeof x === "string" && replacements.has(x) ? replacements.get(x) : x,
      ),
    );
  }
  const work = replace(source);
  work.clientAgent.revision = 1;
  work.grant.expiresAt = "2030-01-02T12:00:00.000Z";
  work.grant.budgets.deadline = work.grant.expiresAt;
  work.grant.budgets.cost.amount = "1";
  for (const key of ["attemptId", "generation", "fence", "lease", "resume"])
    delete work[key];
  work.context.snapshots = [
    {
      id: "snapshot-1",
      reference: work.context.references[0].reference,
      fields: ["label"],
      payload: { label: "synthetic" },
      payloadDigest: digest({ label: "synthetic" }),
    },
  ];
  const frozen = parseFrozenWork(work);
  let now = new Date("2030-01-01T12:00:00.000Z");
  let enabled = true;
  const workloads = createAgentWorkloadAuthority("test", ["runtime"]);
  const principal = workloads.authenticated({
    environment: "test",
    clientId: "runtime",
    workerId: "worker",
    workloadClass: "agent_runtime",
    scopes: ["claim", "heartbeat", "context", "outcome", "receipt", "usage"],
  });
  const service = createAgentControlPlane(
    f.config,
    f.db.mongo,
    workloads,
    {
      async dependencies() {
        return [];
      },
      async current() {
        return enabled;
      },
    },
    () => now,
  );
  const manifest = fixtureJson("manifest");
  manifest.protocolVersions = [protocolVersion];
  manifest.manifestDigest = digestWithout(manifest, "manifestDigest");
  frozen.implementation.manifestDigest = manifest.manifestDigest;
  const prepared = {
    frozen,
    requestKey: "request-1",
    manifest,
    limits: { attempts: 4, failures: 2, inputCycles: 2, continuations: 2 },
  };
  function dispatch() {
    const r = f.db.rows("agent_runs")[0]!;
    return {
      protocolVersion,
      environment: "test",
      runId,
      generation: r.generation,
      dispatchId: r.dispatch.id,
      notBefore: r.notBefore.toISOString(),
      traceId: r.frozen.traceId,
    };
  }
  function lease(w: ClaimedWork) {
    return {
      runId,
      attemptId: w.attemptId,
      fence: w.fence,
      generation: w.generation,
      leaseId: w.lease.id,
    };
  }
  function outcome(name: string, w: ClaimedWork): Outcome {
    const e = replace(fixtureJson(name));
    e.protocolVersion = w.protocolVersion;
    e.implementation = w.implementation;
    e.attemptId = w.attemptId;
    e.fence = w.fence;
    e.generation = w.generation;
    e.startedAt = f.db
      .rows("agent_attempts")
      .find((a) => a.id === w.attemptId)!
      .startedAt.toISOString();
    e.endedAt = now.toISOString();
    for (const usage of e.usage) {
      usage.attemptId = w.attemptId;
      usage.startedAt = e.startedAt;
      usage.endedAt = e.startedAt;
      usage.durationMs = 0;
    }
    if (e.outcome.checkpoint) {
      e.outcome.checkpoint.createdAt = e.endedAt;
      e.outcome.checkpoint.digest = digestWithout(
        e.outcome.checkpoint,
        "digest",
      );
      if (e.outcome.inputRequest) {
        e.outcome.inputRequest.expiresAt = "2030-01-02T00:00:00.000Z";
        e.outcome.inputRequest.checkpoint.digest = e.outcome.checkpoint.digest;
      }
    }
    e.payloadDigest = digestWithout(e, "payloadDigest");
    return e;
  }
  return {
    ...f,
    service,
    principal,
    workloads,
    prepared,
    dispatch,
    lease,
    outcome,
    runId,
    advance(ms = 100) {
      now = new Date(now.getTime() + ms);
    },
    disable() {
      enabled = false;
    },
  };
}
test("request/claim/outcome are atomic and duplicate claims/receipts recover identical work", async () => {
  const f = await fixture();
  const created = await f.service.acceptPrepared(f.queen, f.prepared);
  assert.deepEqual(
    await f.service.acceptPrepared(f.queen, f.prepared),
    created,
  );
  assert.equal(f.db.rows("agent_runs").length, 1);
  const claim = { dispatch: f.dispatch(), claimId: "claim-1" };
  const work = await f.service.claim(f.principal, claim);
  assert.deepEqual(await f.service.claim(f.principal, claim), work);
  await assert.rejects(
    f.service.claim(f.principal, { ...claim, claimId: "competing" }),
  );
  assert.equal(f.db.rows("agent_attempts").length, 1);
  f.advance();
  const envelope = f.outcome("success", work);
  const receipt = await f.service.outcome(f.principal, f.lease(work), envelope);
  assert.deepEqual(
    await f.service.outcome(f.principal, f.lease(work), envelope),
    receipt,
  );
  assert.equal(f.db.rows("agent_runs")[0]!.status, "completed");
  assert.equal(f.db.rows("agent_results").length, 1);
  assert.equal(f.db.rows("agent_attempts")[0]!.status, "succeeded");
  assert.equal(
    f.db.rows("agent_results")[0]!.dispositions[0].status,
    "pending",
  );
  const modified = structuredClone(envelope);
  modified.traceId = "different";
  modified.payloadDigest = digestWithout(modified, "payloadDigest");
  await assert.rejects(f.service.outcome(f.principal, f.lease(work), modified));
});
test("claim and finalization rollback on audit failure", async () => {
  const f = await fixture();
  await f.service.acceptPrepared(f.queen, f.prepared);
  const before = structuredClone(f.db.records);
  f.db.failCollection = "events";
  await assert.rejects(
    f.service.claim(f.principal, {
      dispatch: f.dispatch(),
      claimId: "claim-1",
    }),
  );
  assert.deepEqual(f.db.records, before);
  f.db.failCollection = undefined;
  const work = await f.service.claim(f.principal, {
    dispatch: f.dispatch(),
    claimId: "claim-1",
  });
  f.advance();
  const claimed = structuredClone(f.db.records);
  f.db.failCollection = "events";
  await assert.rejects(
    f.service.outcome(f.principal, f.lease(work), f.outcome("success", work)),
  );
  assert.deepEqual(f.db.records, claimed);
});
test("revoked execution stops heartbeat and prevents sensitive context/outcomes", async () => {
  const f = await fixture();
  await f.service.acceptPrepared(f.queen, f.prepared);
  const work = await f.service.claim(f.principal, {
    dispatch: f.dispatch(),
    claimId: "claim-1",
  });
  f.disable();
  f.advance();
  await assert.rejects(
    f.service.context(f.principal, {
      ...f.lease(work),
      snapshotId: work.context.snapshots[0]!.id,
    }),
  );
  assert.deepEqual(await f.service.heartbeat(f.principal, f.lease(work)), {
    continue: false,
  });
  assert.equal(f.db.rows("agent_runs")[0]!.terminalReason, "revoked");
  await assert.rejects(
    f.service.outcome(f.principal, f.lease(work), f.outcome("success", work)),
  );
});

test("publisher crash and duplicate delivery recover through generation and publisher leases", async () => {
  const f = await fixture();
  await f.service.acceptPrepared(f.queen, f.prepared);
  const messages: unknown[] = [];
  await assert.rejects(
    f.service.publish(f.runId, "publisher-a", {
      async send(message) {
        messages.push(message);
        throw new Error("synthetic crash after send");
      },
    }),
  );
  assert.equal(
    await f.service.publish(f.runId, "publisher-b", {
      async send(message) {
        messages.push(message);
      },
    }),
    false,
  );
  f.advance(31_000);
  assert.equal(
    await f.service.publish(f.runId, "publisher-b", {
      async send(message) {
        messages.push(message);
      },
    }),
    true,
  );
  assert.deepEqual(messages[0], messages[1]);
  assert.deepEqual(
    Object.keys(messages[0] as object).sort(),
    [
      "protocolVersion",
      "environment",
      "runId",
      "generation",
      "dispatchId",
      "notBefore",
      "traceId",
    ].sort(),
  );
  await f.service.claim(f.principal, {
    dispatch: messages[0],
    claimId: "claim-1",
  });
  assert.equal(
    await f.service.publish(f.runId, "publisher-c", {
      async send() {
        assert.fail("claimed intent must not publish");
      },
    }),
    false,
  );
});

test("expired leases fence stale workers and retries retain the original total budget", async () => {
  const f = await fixture();
  await f.service.acceptPrepared(f.queen, f.prepared);
  const originalDispatch = f.dispatch();
  const first = await f.service.claim(f.principal, {
    dispatch: originalDispatch,
    claimId: "claim-1",
  });
  f.advance(91_000);
  assert.equal(await f.service.reconcile(f.runId), "queued");
  await assert.rejects(f.service.heartbeat(f.principal, f.lease(first)));
  await assert.rejects(
    f.service.outcome(f.principal, f.lease(first), f.outcome("success", first)),
  );
  f.advance(3000);
  await assert.rejects(
    f.service.claim(f.principal, {
      dispatch: originalDispatch,
      claimId: "claim-2",
    }),
  );
  const second = await f.service.claim(f.principal, {
    dispatch: f.dispatch(),
    claimId: "claim-2",
  });
  assert.notEqual(first.attemptId, second.attemptId);
  assert.ok(second.fence > first.fence);
  assert.equal(second.grant.budgets.cost.amount, "0.25");
  assert.equal(f.db.rows("agent_attempts")[0]!.status, "expired");
});

test("input is attributed to the human once and resumes a new Attempt", async () => {
  const f = await fixture();
  await f.service.acceptPrepared(f.queen, f.prepared);
  const first = await f.service.claim(f.principal, {
    dispatch: f.dispatch(),
    claimId: "claim-1",
  });
  f.advance();
  await f.service.outcome(
    f.principal,
    f.lease(first),
    f.outcome("needsInput", first),
  );
  const read = await f.service.read(f.queen, f.runId);
  assert.equal(read.status, "awaiting_input");
  assert.ok(read.input);
  assert.equal(JSON.stringify(read).includes("checkpoint"), false);
  const body = {
    requestId: read.input!.id,
    values: [{ key: "answer", value: "confirmed" }],
  };
  f.advance();
  await assert.rejects(
    f.service.respond(f.queen, f.runId, read.updatedAt, {
      ...body,
      actorReference: "forged",
    }),
  );
  const answered = await f.service.respond(
    f.queen,
    f.runId,
    read.updatedAt,
    body,
  );
  assert.equal(answered.status, "queued");
  assert.deepEqual(
    await f.service.respond(f.queen, f.runId, read.updatedAt, body),
    answered,
  );
  const second = await f.service.claim(f.principal, {
    dispatch: f.dispatch(),
    claimId: "claim-2",
  });
  assert.notEqual(second.attemptId, first.attemptId);
  assert.equal(second.resume?.kind, "input");
  if (second.resume?.kind === "input")
    assert.equal(second.resume.response.actorReference, f.queen.subject);
  assert.equal(f.db.rows("agent_runs")[0]!.failures, 0);
  f.advance();
  const completed = f.outcome("success", second);
  for (const observation of completed.usage) observation.id += ":resumed";
  const answer = f.db.rows("agent_runs")[0]!.inputResponses[0];
  const inputLineage = completed.outcome.content.lineage[0]!;
  inputLineage.source = {
    kind: "input",
    requestId: answer.requestId,
    contentHash: digest("confirmed"),
  };
  inputLineage.observedAt = answer.answeredAt;
  inputLineage.fetchedAt = completed.endedAt;
  delete inputLineage.fields;
  delete inputLineage.snapshotId;
  const inputEvidence = completed.outcome.content.evidence[0]!;
  inputEvidence.origin = "user_supplied";
  inputEvidence.provenance.provider = "human_input";
  inputEvidence.source = { kind: "reference", id: answer.requestId };
  inputEvidence.digest = digest("confirmed");
  inputEvidence.observedAt = answer.answeredAt;
  inputEvidence.retrievedAt = completed.endedAt;
  completed.payloadDigest = digestWithout(completed, "payloadDigest");
  const forged = structuredClone(completed);
  forged.outcome.content.evidence[0]!.digest = digest("not the stored answer");
  forged.payloadDigest = digestWithout(forged, "payloadDigest");
  await assert.rejects(f.service.outcome(f.principal, f.lease(second), forged));
  await f.service.outcome(f.principal, f.lease(second), completed);
  assert.equal(f.db.rows("agent_runs")[0]!.status, "completed");
  assert.deepEqual(f.db.rows("agent_runs")[0]!.inputResponses, [answer]);
  assert.equal(
    (await f.service.respond(f.queen, f.runId, read.updatedAt, body)).status,
    "completed",
  );
});

test("cancellation requested before success prevents accepting success", async () => {
  const f = await fixture();
  const created = await f.service.acceptPrepared(f.queen, f.prepared);
  const work = await f.service.claim(f.principal, {
    dispatch: f.dispatch(),
    claimId: "claim-1",
  });
  const read = await f.service.read(f.queen, created.id);
  f.advance();
  await f.service.cancel(f.queen, f.runId, read.updatedAt);
  await assert.rejects(
    f.service.outcome(f.principal, f.lease(work), f.outcome("success", work)),
  );
  assert.equal(await f.service.reconcile(f.runId), "cancelled");
  assert.equal(f.db.rows("agent_results").length, 0);
});

for (const scenario of [
  "gapNonBlocking",
  "gapBlocking",
  "gapHuman",
  "gapCapability",
  "gapResearch",
  "gapUnresolved",
]) {
  test(`accepted ${scenario} preserves immutable gaps and completeness without dispatching resolution`, async () => {
    const f = await fixture();
    await f.service.acceptPrepared(f.queen, f.prepared);
    const work = await f.service.claim(f.principal, {
      dispatch: f.dispatch(),
      claimId: "claim-gap",
    });
    f.advance();
    const envelope = f.outcome(scenario, work);
    await f.service.outcome(f.principal, f.lease(work), envelope);
    const results = await f.service.results(f.queen, f.runId);
    assert.deepEqual(results[0]!.content, envelope.outcome.content);
    assert.deepEqual(results[0]!.completeness, envelope.outcome.completeness);
    assert.equal(f.db.rows("agent_runs").length, 1);
    assert.equal(f.db.rows("agent_attempts").length, 1);
    assert.equal(
      f.db.rows("agent_runs")[0]!.status,
      envelope.outcome.kind === "needs_input" ? "awaiting_input" : "completed",
    );
    assert.equal(
      f.db.rows("agent_usage_observations").length,
      envelope.usage.length,
    );
  });
}

test("SECURITY: revocation committed during claim must prevent stale-snapshot lease issuance", async () => {
  const f = await fixture();
  const operators = createAgentOperatorService(
    f.config,
    f.db.mongo,
    {
      async operations() {
        return ["exercise"];
      },
    },
    () => new Date("2030-01-01T12:00:00.000Z"),
  );
  const grant = await operators.grant(f.queen, f.workspaceId, f.request);
  await f.service.acceptPrepared(f.client, f.prepared);
  const interleaved = snapshotInterleaving(f.db, async () => {
    // Commit Queen revocation after the claim snapshot has been established.
    const revoker = createAgentOperatorService(
      f.config,
      f.db.mongo,
      undefined,
      () => new Date("2030-01-01T12:00:01.000Z"),
    );
    await revoker.revoke(f.queen, f.workspaceId, {
      membershipId: f.membership.id,
      grantId: grant.grantId,
      expectedUpdatedAt: grant.updatedAt,
    });
  });
  const claimant = createAgentControlPlane(
    f.config,
    interleaved.mongo,
    f.workloads,
    {
      async dependencies() {
        return [];
      },
      async current() {
        return true;
      },
    },
    () => new Date("2030-01-01T12:00:02.000Z"),
  );
  let issued = false;
  try {
    await claimant.claim(f.principal, {
      dispatch: f.dispatch(),
      claimId: "revocation-race",
    });
    issued = true;
  } catch {
    // Either conflict/retry or authorization denial must prevent stale issuance.
  }
  assert.deepEqual(
    f.db.rows("workspace_memberships").find((m) => m.id === f.membership.id)!
      .agentOperationGrants,
    [],
  );
  assert.equal(
    issued,
    false,
    `Revoked client received a new lease; claim writes: ${interleaved.writes.map((w) => w.split(":")[0]).join(", ")}`,
  );
  assert.equal(f.db.rows("agent_attempts").length, 0);
});

async function clientFixture() {
  const f = await fixture();
  const operators = createAgentOperatorService(
    f.config,
    f.db.mongo,
    {
      async operations() {
        return ["exercise"];
      },
    },
    () => new Date("2030-01-01T12:00:00.000Z"),
  );
  const grant = await operators.grant(f.queen, f.workspaceId, f.request);
  return {
    ...f,
    async revoke() {
      const revoker = createAgentOperatorService(
        f.config,
        f.db.mongo,
        undefined,
        () => new Date("2030-01-01T12:00:01.000Z"),
      );
      await revoker.revoke(f.queen, f.workspaceId, {
        membershipId: f.membership.id,
        grantId: grant.grantId,
        expectedUpdatedAt: grant.updatedAt,
      });
    },
  };
}
function interleavedService(
  f: Awaited<ReturnType<typeof fixture>>,
  reduction: () => Promise<void>,
) {
  const interleaved = snapshotInterleaving(f.db, reduction);
  return createAgentControlPlane(
    f.config,
    interleaved.mongo,
    f.workloads,
    {
      async dependencies() {
        return [];
      },
      async current() {
        return true;
      },
    },
    () => new Date("2030-01-01T12:00:02.000Z"),
  );
}
test("authority reduction first prevents stale Run creation without changing history", async () => {
  const f = await clientFixture();
  const stale = interleavedService(f, f.revoke);
  await assert.rejects(stale.acceptPrepared(f.client, f.prepared));
  assert.equal(f.db.rows("agent_runs").length, 0);
  assert.equal(f.db.rows("agent_attempts").length, 0);
  await assert.rejects(f.service.acceptPrepared(f.client, f.prepared));
});
test("Run creation first preserves history but revocation prevents subsequent claim", async () => {
  const f = await clientFixture();
  await f.service.acceptPrepared(f.client, f.prepared);
  const before = structuredClone(f.db.rows("agent_runs"));
  await f.revoke();
  await assert.rejects(
    f.service.claim(f.principal, {
      dispatch: f.dispatch(),
      claimId: "after-revoke",
    }),
  );
  assert.deepEqual(f.db.rows("agent_runs"), before);
  assert.equal(f.db.rows("agent_attempts").length, 0);
});
test("claim first then revoke: context denied, heartbeat stops Attempt, Queen cancellation remains available", async () => {
  const f = await clientFixture();
  await f.service.acceptPrepared(f.client, f.prepared);
  const work = await f.service.claim(f.principal, {
    dispatch: f.dispatch(),
    claimId: "before-revoke",
  });
  await f.revoke();
  assert.equal(f.db.rows("agent_attempts")[0]!.status, "running");
  await assert.rejects(
    f.service.context(f.principal, {
      ...f.lease(work),
      snapshotId: work.context.snapshots[0]!.id,
    }),
  );
  assert.deepEqual(await f.service.heartbeat(f.principal, f.lease(work)), {
    continue: false,
  });
  assert.equal(f.db.rows("agent_attempts")[0]!.status, "cancelled");
  const row = await f.service.read(f.queen, f.runId);
  await f.service.cancel(f.queen, f.runId, row.updatedAt);
  await assert.rejects(
    f.service.claim(f.principal, {
      dispatch: f.dispatch(),
      claimId: "after-revoke",
    }),
  );
});
test("revocation first prevents stale input response from queuing another generation", async () => {
  const f = await clientFixture();
  await f.service.acceptPrepared(f.client, f.prepared);
  const work = await f.service.claim(f.principal, {
    dispatch: f.dispatch(),
    claimId: "input",
  });
  f.advance();
  await f.service.outcome(
    f.principal,
    f.lease(work),
    f.outcome("needsInput", work),
  );
  const before = structuredClone(f.db.rows("agent_runs"));
  const read = await f.service.read(f.client, f.runId);
  const stale = interleavedService(f, f.revoke);
  await assert.rejects(
    stale.respond(f.client, f.runId, read.updatedAt, {
      requestId: read.input!.id,
      values: [{ key: "answer", value: "confirmed" }],
    }),
  );
  assert.deepEqual(f.db.rows("agent_runs"), before);
  assert.equal(f.db.rows("agent_results").length, 1);
});
for (const collection of [
  "workspace_partner_assignments",
  "hvm_partner_memberships",
  "hvm_partners",
  "client_agents",
  "crm_workspaces",
]) {
  test(`authority reduction in ${collection} conflicts with stale Queen claim`, async () => {
    const f = await fixture();
    // Exercise delegated-only authority. Provisioning also grants an independent
    // client-admin membership; retaining that would legitimately permit access.
    f.db.rows("workspace_memberships").forEach((m) => {
      if (m.human.id === f.queen.subject) m.status = "revoked";
    });
    await f.service.acceptPrepared(f.queen, f.prepared);
    const stale = interleavedService(f, async () => {
      // Local fixture mutation represents the concurrent authority transaction's
      // committed document write; no production bypass or persistent record.
      const row = f.db.rows(collection)[0]!;
      if (collection === "client_agents") row.revision++;
      else if (collection === "crm_workspaces") row.archived = true;
      else {
        row.status = "ended";
        row.endedAt = new Date("2030-01-01T12:00:01.000Z");
      }
      row.updatedAt = new Date("2030-01-01T12:00:01.000Z");
    });
    await assert.rejects(
      stale.claim(f.principal, {
        dispatch: f.dispatch(),
        claimId: "stale-queen",
      }),
    );
    assert.equal(f.db.rows("agent_attempts").length, 0);
    await assert.rejects(
      f.service.claim(f.principal, {
        dispatch: f.dispatch(),
        claimId: "fresh-queen",
      }),
    );
  });
}
for (const kind of ["failure", "yield"]) {
  test(`revocation prevents stale ${kind} from creating a new generation`, async () => {
    const f = await clientFixture();
    await f.service.acceptPrepared(f.client, f.prepared);
    const work = await f.service.claim(f.principal, {
      dispatch: f.dispatch(),
      claimId: kind,
    });
    f.advance();
    const before = structuredClone(f.db.rows("agent_runs"));
    const stale = interleavedService(f, f.revoke);
    await assert.rejects(
      stale.outcome(f.principal, f.lease(work), f.outcome(kind, work)),
    );
    assert.deepEqual(f.db.rows("agent_runs"), before);
    assert.equal(f.db.rows("agent_results").length, 0);
    assert.equal(await f.service.reconcile(f.runId), "cancelled");
    assert.equal(f.db.rows("agent_attempts")[0]!.status, "cancelled");
  });
}
test("expiry still denies claim without any revocation write", async () => {
  const f = await clientFixture();
  await f.service.acceptPrepared(f.client, f.prepared);
  const membership = f.db
    .rows("workspace_memberships")
    .find((m) => m.id === f.membership.id)!;
  membership.agentOperationGrants[0].expiresAt = new Date(
    "2030-01-01T12:00:00.001Z",
  );
  membership.updatedAt = new Date("2030-01-01T12:00:00.001Z");
  f.advance(10);
  await assert.rejects(
    f.service.claim(f.principal, {
      dispatch: f.dispatch(),
      claimId: "expired",
    }),
  );
  assert.equal(f.db.rows("agent_attempts").length, 0);
});

for (const collection of [
  "agent_definitions",
  "workspace_integrations",
  "capability_instances",
] as const) {
  test(`persisted readiness dependency ${collection} reduction conflicts with stale claim`, async () => {
    const f = await fixture();
    await f.service.acceptPrepared(f.queen, f.prepared);
    // Synthetic trusted policy fixture: exact persisted dependency, no provider call.
    f.db.rows(collection).push({
      id: "policy-test-dependency",
      status: "active",
      referenceVersion: 0,
    });
    const interleaved = snapshotInterleaving(f.db, async () => {
      f.db.rows(collection)[0]!.status = "retired";
    });
    const policy = {
      async dependencies() {
        return [{ collection, id: "policy-test-dependency" }];
      },
      async current(db: import("mongodb").Db) {
        return (
          (
            await db
              .collection(collection)
              .findOne({ id: "policy-test-dependency" })
          )?.status === "active"
        );
      },
    };
    const stale = createAgentControlPlane(
      f.config,
      interleaved.mongo,
      f.workloads,
      policy,
      () => new Date("2030-01-01T12:00:02.000Z"),
    );
    await assert.rejects(
      stale.claim(f.principal, {
        dispatch: f.dispatch(),
        claimId: "stale-policy",
      }),
    );
    assert.equal(f.db.rows("agent_attempts").length, 0);
    const fresh = createAgentControlPlane(
      f.config,
      f.db.mongo,
      f.workloads,
      policy,
      () => new Date("2030-01-01T12:00:02.000Z"),
    );
    await assert.rejects(
      fresh.claim(f.principal, {
        dispatch: f.dispatch(),
        claimId: "fresh-policy",
      }),
    );
  });
}

test("human/workload HTTP boundaries expose Results but never accept body authority or human-token workload auth", async (t) => {
  const { createApp } = await import("../src/app");
  const { createTestAuth } = await import("./helpers/auth");
  const { createServer } = await import("node:http");
  const { once } = await import("node:events");
  const f = await fixture();
  await f.service.acceptPrepared(f.queen, f.prepared);
  const work = await f.service.claim(f.principal, {
    dispatch: f.dispatch(),
    claimId: "http",
  });
  f.advance();
  const outcome = f.outcome("gapBlocking", work);
  await f.service.outcome(f.principal, f.lease(work), outcome);
  const auth = await createTestAuth();
  const server = createServer(
    createApp(f.config, f.db.mongo, { jwtKeyResolver: auth.keyResolver }),
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address() as import("node:net").AddressInfo;
  const token = await auth.sign({ client_id: "hvmclient", sub: "queen" });
  const url = `http://127.0.0.1:${address.port}/api/v1`;
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
  const response = await fetch(`${url}/hvm/agent-runs/${f.runId}/results`, {
    headers,
  });
  assert.equal(response.status, 200);
  const results = await response.json();
  assert.deepEqual(
    results[0].content.knowledgeGaps,
    outcome.outcome.content.knowledgeGaps,
  );
  assert.deepEqual(results[0].completeness, outcome.outcome.completeness);
  for (const path of [
    "claim",
    "heartbeat",
    "context",
    "outcome",
    "receipt",
    "usage",
  ]) {
    const blocked = await fetch(`${url}/agent-workload/${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ principal: f.principal, ...f.lease(work) }),
    });
    assert.equal(blocked.status, 503);
  }
  const forged = await fetch(
    `${url}/hvm/workspaces/${f.workspaceId}/agent-runs`,
    { method: "POST", headers, body: JSON.stringify(f.prepared) },
  );
  assert.equal(forged.status, 400);
  const other = await auth.sign({ client_id: "hvmclient", sub: "unrelated" });
  assert.equal(
    (
      await fetch(`${url}/hvm/agent-runs/${f.runId}`, {
        headers: { authorization: `Bearer ${other}` },
      })
    ).status,
    404,
  );
});

test("proposal rejection is Queen-only, idempotent and leaves accepted content and execution status unchanged", async () => {
  const { createAgentProposalReview } =
    await import("../src/services/agent-proposals");
  const f = await clientFixture();
  await f.service.acceptPrepared(f.client, f.prepared);
  const work = await f.service.claim(f.principal, {
    dispatch: f.dispatch(),
    claimId: "reject",
  });
  f.advance();
  await f.service.outcome(
    f.principal,
    f.lease(work),
    f.outcome("success", work),
  );
  const row = f.db.rows("agent_results")[0]!;
  const immutable = structuredClone(row.envelope);
  const review = createAgentProposalReview(
    f.config,
    f.db.mongo,
    f.service,
    new Map(),
    () => new Date("2030-01-01T12:00:02.000Z"),
  );
  const request = {
    resultId: row.id,
    proposalId: row.dispositions[0].proposalId,
    expectedUpdatedAt: row.updatedAt.toISOString(),
    reason: "Reviewed",
  };
  await assert.rejects(review.reject(f.client, f.runId, request));
  const result = await review.reject(f.queen, f.runId, request);
  assert.equal(result.status, "rejected");
  assert.deepEqual(await review.reject(f.queen, f.runId, request), result);
  assert.deepEqual(f.db.rows("agent_results")[0]!.envelope, immutable);
  assert.equal(f.db.rows("agent_runs")[0]!.status, "completed");
});

async function proposalFixture(createTarget = false) {
  const { mutateHiveDefinition } =
    await import("../src/services/hive-definitions");
  const { createAgentProposalReview, hiveDraftProposalHandler } =
    await import("../src/services/agent-proposals");
  const f = await fixture();
  const definition = {
    name: "Synthetic offering",
    description: "Synthetic description",
    primaryOfferingType: "professional_service",
    implementationModel: "supplier_mobilisation",
    deliveryModes: ["on_site_service"],
    unknowns: ["Measured savings"],
  };
  const target = await mutateHiveDefinition(
    f.db.mongo,
    f.config,
    f.queen,
    f.workspaceId,
    "offerings",
    "create",
    { definition },
  );
  const reference = {
    resourceType: "offerings",
    id: target.id,
    workspaceId: f.workspaceId,
    revision: target.revision,
    contentHash: target.contentHash,
  };
  const brand = f.db.rows("brands")[0]!;
  const parent = {
    relationship: "brand",
    reference: {
      resourceType: "brands",
      id: brand.id,
      workspaceId: f.workspaceId,
      contentHash: digest(JSON.parse(JSON.stringify(brand))),
    },
  };
  const work = f.prepared.frozen;
  work.grant.resources = [{ reference, fields: ["definition"] }];
  work.grant.proposalTargets = [
    createTarget
      ? { kind: "create", targetKind: "offerings", parents: [parent] }
      : { kind: "update", targetKind: "offerings", reference },
  ];
  work.context.references = structuredClone(work.grant.resources);
  for (const lineage of work.lineage)
    if (lineage.source.kind === "resource") {
      lineage.source.reference = reference;
      lineage.fields = ["definition"];
    }
  work.context.snapshots = [
    {
      id: "canonical-offering",
      reference,
      fields: ["definition"],
      payload: { definition: target.definition },
      payloadDigest: digest({ definition: target.definition }),
    },
  ];
  await f.service.acceptPrepared(f.queen, f.prepared);
  const claimed = await f.service.claim(f.principal, {
    dispatch: f.dispatch(),
    claimId: "proposal",
  });
  f.advance(1000);
  const envelope = f.outcome("success", claimed);
  const proposal = envelope.outcome.content.proposals[0]!;
  proposal.targetKind = "offerings";
  proposal.target = createTarget
    ? { kind: "create", parents: [parent] }
    : {
        kind: "update",
        reference,
        expectedUpdatedAt: target.updatedAt.toISOString(),
      };
  proposal.candidate = { ...definition, name: "Human-reviewed proposal" };
  for (const lineage of envelope.outcome.content.lineage)
    if (lineage.source.kind === "resource") {
      lineage.source.reference = reference;
      lineage.fields = ["definition"];
      delete lineage.snapshotId;
    }
  envelope.outcome.content.evidence[0]!.candidate = {
    field: "name",
    value: "Observed candidate name",
  };
  envelope.payloadDigest = digestWithout(envelope, "payloadDigest");
  await f.service.outcome(f.principal, f.lease(claimed), envelope);
  const row = f.db.rows("agent_results")[0]!;
  const review = createAgentProposalReview(
    f.config,
    f.db.mongo,
    f.service,
    new Map([["offerings", hiveDraftProposalHandler("offerings")]]),
    () => new Date("2030-01-01T12:00:03.000Z"),
  );
  const request = {
    resultId: row.id,
    proposalId: proposal.id,
    expectedUpdatedAt: row.updatedAt.toISOString(),
    evidenceIds: proposal.evidenceIds,
  };
  return { ...f, review, request, target, envelope, mutateHiveDefinition };
}
test("human applies reviewed proposal through canonical draft service, preserves observed provenance and never approves", async () => {
  const f = await proposalFixture();
  const receipt = await f.review.apply(f.queen, f.runId, f.request);
  assert.equal(receipt.status, "applied_to_draft");
  const row = f.db.rows("offerings")[0]!;
  assert.equal(row.status, "draft");
  assert.equal(row.definition.name, "Human-reviewed proposal");
  assert.equal(row.evidence[0].origin, "external_evidence");
  assert.equal(row.evidence[0].verification, "observed");
  assert.equal(row.evidence[0].actor.id, f.queen.subject);
  assert.ok(row.evidence[0].sourceReference.includes(f.request.resultId));
  assert.deepEqual(f.db.rows("agent_results")[0]!.envelope, f.envelope);
  assert.deepEqual(await f.review.apply(f.queen, f.runId, f.request), receipt);
  assert.equal(row.evidence.length, 1);
});
test("stale target blocks proposal and audit failure rolls back canonical draft plus disposition", async () => {
  const f = await proposalFixture();
  const before = structuredClone(f.db.records);
  f.db.failCollection = "events";
  await assert.rejects(f.review.apply(f.queen, f.runId, f.request));
  assert.deepEqual(f.db.records, before);
  f.db.failCollection = undefined;
  f.db.rows("offerings")[0]!.updatedAt = new Date("2030-01-01T12:00:04.000Z");
  await assert.rejects(f.review.apply(f.queen, f.runId, f.request));
  assert.equal(
    f.db.rows("agent_results")[0]!.dispositions[0].status,
    "pending",
  );
});
test("prepared context refuses oversharing beyond explicit projection", async () => {
  const f = await fixture();
  const snapshot = f.prepared.frozen.context.snapshots[0]!;
  snapshot.payload = { label: "synthetic", ungranted: "must not reach worker" };
  snapshot.payloadDigest = digest(snapshot.payload);
  assert.throws(() => parseFrozenWork(f.prepared.frozen));
  await assert.rejects(f.service.acceptPrepared(f.queen, f.prepared));
  assert.equal(f.db.rows("agent_runs").length, 0);
});

test("execution readiness pins deployment metadata and configuration; capacity and workspace policy fail closed independently", async () => {
  const { createAgentExecutionReadiness } =
    await import("../src/services/agent-execution-readiness");
  const { operatingFixtures } = await import("./helpers/operating-fixtures");
  const f = await fixture();
  const definition = operatingFixtures().agent_definitions;
  Object.assign(definition, {
    id: f.prepared.frozen.definition.id,
    key: f.prepared.frozen.definition.key,
    status: "active",
  });
  definition.data.executionImplementation = {
    protocolVersion: "1.1",
    key: f.prepared.manifest.implementation.key,
    version: f.prepared.manifest.implementation.version,
    manifestDigest: f.prepared.manifest.manifestDigest,
  };
  f.agent.data.definition = { id: definition.id, version: definition.version };
  f.db.rows("agent_definitions").push(definition);
  f.prepared.frozen.clientAgent.configuration = structuredClone(
    f.agent.data.configuration,
  );
  f.prepared.frozen.grant.resources = [];
  f.prepared.frozen.grant.proposalTargets = [];
  f.prepared.frozen.context = { references: [], snapshots: [] };
  f.prepared.frozen.lineage = [];
  f.prepared.frozen.grant.bindings = [];
  f.prepared.frozen.grant.tools = [];
  let capacity = true;
  let allowed = true;
  const readiness = createAgentExecutionReadiness(
    {
      async manifest() {
        return f.prepared.manifest;
      },
      async available() {
        return capacity;
      },
    },
    {
      allowInternal: false,
      async allowed() {
        return allowed;
      },
      async dependencies() {
        return [];
      },
    },
  );
  await f.service.acceptPrepared(f.queen, f.prepared);
  const run = f.db.rows("agent_runs")[0]!;
  const { AgentRunSchema } = await import("../src/domain/agent-control-plane");
  await f.db.mongo.withTransaction!(async (db, session) => {
    const parsed = AgentRunSchema.parse(run);
    const state = await readiness.inspect(
      db,
      parsed.workspaceId,
      parsed.target,
      session,
    );
    assert.deepEqual(state.reasons, []);
    assert.equal(await readiness.policy.current(db, parsed, session), true);
    assert.deepEqual(await readiness.policy.dependencies(db, parsed, session), [
      { collection: "agent_definitions", id: definition.id },
    ]);
    capacity = false;
    assert.equal(await readiness.policy.current(db, parsed, session), false);
    capacity = true;
    allowed = false;
    assert.equal(await readiness.policy.current(db, parsed, session), false);
    allowed = true;
    definition.status = "draft";
    assert.equal(await readiness.policy.current(db, parsed, session), false);
    definition.status = "active";
    definition.data.executionImplementation.manifestDigest = "0".repeat(64);
    assert.equal(await readiness.policy.current(db, parsed, session), false);
  });
});

test("canonical approval freshness retains consumed source assumptions after a human applies a proposal", async () => {
  const { requireFreshAgentApplications, AgentProposalStale } =
    await import("../src/services/agent-proposal-freshness");
  const f = await proposalFixture();
  await f.review.apply(f.queen, f.runId, f.request);
  const result = f.db.rows("agent_results")[0]!;
  // Synthetic accepted provenance with a second canonical consumed source.
  const source = await f.mutateHiveDefinition(
    f.db.mongo,
    f.config,
    f.queen,
    f.workspaceId,
    "offerings",
    "create",
    { definition: f.target.definition },
  );
  result.envelope.outcome.content.lineage.push({
    id: "secondary-source",
    role: "consumed",
    purpose: "Configuration assumption",
    source: {
      kind: "resource",
      reference: {
        resourceType: "offerings",
        id: source.id,
        workspaceId: f.workspaceId,
        revision: source.revision,
        contentHash: source.contentHash,
      },
    },
    observedAt: result.envelope.startedAt,
    fetchedAt: result.envelope.endedAt,
  });
  result.envelope.payloadDigest = digestWithout(
    result.envelope,
    "payloadDigest",
  );
  const target = f.db.rows("offerings").find((r) => r.id === f.target.id)!;
  await f.db.mongo.withTransaction!(async (db, session) => {
    await requireFreshAgentApplications(
      db,
      f.workspaceId,
      "offerings",
      target,
      session,
    );
  });
  f.db.rows("offerings").find((r) => r.id === source.id)!.contentHash =
    "0".repeat(64);
  await assert.rejects(
    f.db.mongo.withTransaction!(async (db, session) => {
      await requireFreshAgentApplications(
        db,
        f.workspaceId,
        "offerings",
        target,
        session,
      );
    }),
    AgentProposalStale,
  );
  assert.equal(target.status, "draft");
});

test("workload HTTP surface uses issued identity and exact lease for claim/context/heartbeat/usage/outcome/receipt", async (t) => {
  const express = (await import("express")).default;
  const { createAgentWorkloadRouter } =
    await import("../src/routes/agent-control-plane");
  const { createServer } = await import("node:http");
  const { once } = await import("node:events");
  const f = await fixture();
  await f.service.acceptPrepared(f.queen, f.prepared);
  let principal = f.principal;
  // Synthetic trusted transport authenticator; no production authentication bypass.
  const app = express();
  app.use(createAgentWorkloadRouter(f.service, async () => principal));
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const url = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
  const post = (path: string, body: unknown) =>
    fetch(url + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  assert.equal(
    (
      await post("/claim", {
        dispatch: f.dispatch(),
        claimId: "http",
        principal: {},
      })
    ).status,
    400,
  );
  const claim = await post("/claim", {
    dispatch: f.dispatch(),
    claimId: "http",
  });
  assert.equal(claim.status, 200);
  const work = (await claim.json()) as ClaimedWork;
  const lease = f.lease(work);
  principal = { ...f.principal };
  assert.equal((await post("/heartbeat", { lease })).status, 404);
  principal = f.principal;
  assert.equal(
    (await post("/heartbeat", { lease: { ...lease, leaseId: "wrong" } }))
      .status,
    404,
  );
  assert.equal((await post("/heartbeat", { lease })).status, 200);
  const context = await post("/context", { lease, snapshotId: "snapshot-1" });
  assert.equal(context.status, 200);
  assert.deepEqual((await context.json()).payload, { label: "synthetic" });
  f.advance();
  const outcome = f.outcome("success", work);
  assert.equal(
    (await post("/usage", { lease, payload: outcome.usage[0] })).status,
    200,
  );
  const receipt = {
    lease,
    submissionId: outcome.submissionId,
    payloadDigest: outcome.payloadDigest,
  };
  const missingReceipt = await post("/receipt", receipt);
  assert.equal(missingReceipt.status, 200);
  assert.equal(await missingReceipt.json(), null);
  assert.equal(
    (await post("/outcome", { lease, payload: outcome })).status,
    200,
  );
  const accepted = await post("/receipt", receipt);
  assert.equal(accepted.status, 200);
  assert.equal(
    (await accepted.json()).resultId,
    f.db.rows("agent_results")[0]!.id,
  );
  assert.equal(f.db.rows("agent_results").length, 1);
  assert.equal(
    f.db.rows("agent_usage_observations").length,
    outcome.usage.length,
  );
});

test("human Run preparation is server-owned, idempotent, scoped and preview is read-only", async () => {
  const { createAgentExecutionReadiness } =
    await import("../src/services/agent-execution-readiness");
  const { createAgentRunRequests } =
    await import("../src/services/agent-run-requests");
  const { operatingFixtures } = await import("./helpers/operating-fixtures");
  const f = await fixture();
  const definition = operatingFixtures().agent_definitions;
  Object.assign(definition, {
    id: f.prepared.frozen.definition.id,
    key: f.prepared.frozen.definition.key,
    status: "active",
  });
  definition.data.executionImplementation = {
    protocolVersion: "1.1",
    ...f.prepared.manifest.implementation,
    manifestDigest: f.prepared.manifest.manifestDigest,
  };
  f.agent.data.definition = { id: definition.id, version: definition.version };
  f.db.rows("agent_definitions").push(definition);
  const readiness = createAgentExecutionReadiness(
    {
      async manifest() {
        return f.prepared.manifest;
      },
      async available() {
        return true;
      },
    },
    {
      allowInternal: false,
      async allowed() {
        return true;
      },
      async dependencies() {
        return [];
      },
    },
  );
  const clock = () => new Date("2030-01-01T12:00:00.000Z");
  const preparer = {
    manifestDigest: f.prepared.manifest.manifestDigest,
    operation: "exercise",
    async prepare({ runId, input }: { runId: string; input: unknown }) {
      const frozen = structuredClone(f.prepared.frozen);
      frozen.runId = frozen.grant.runId = runId;
      frozen.input = input as ClaimedWork["input"];
      frozen.clientAgent.configuration = structuredClone(
        f.agent.data.configuration,
      );
      frozen.grant.resources = [];
      frozen.grant.proposalTargets = [];
      frozen.grant.bindings = [];
      frozen.grant.tools = [];
      frozen.context = { references: [], snapshots: [] };
      frozen.lineage = [];
      return { frozen, limits: f.prepared.limits };
    },
  };
  const requests = createAgentRunRequests(
    f.config,
    f.db.mongo,
    f.workloads,
    readiness,
    [preparer],
    clock,
  );
  const body = {
    clientAgentId: f.agent.id,
    revision: 1,
    operation: "exercise",
    requestKey: "human-request",
    input: { purpose: "synthetic" },
  };
  f.db.rows("agent_runs"); // Initialize the test double's read-only collection view.
  const before = structuredClone(f.db.records);
  assert.equal(
    (await requests.readiness(f.queen, f.workspaceId, body)).executionReady,
    true,
  );
  assert.deepEqual(f.db.records, before);
  await assert.rejects(requests.create(f.client, f.workspaceId, body));
  await assert.rejects(
    requests.create(f.queen, f.workspaceId, {
      ...body,
      grant: { admin: true },
    }),
  );
  const created = await requests.create(f.queen, f.workspaceId, body);
  assert.deepEqual(
    await requests.create(f.queen, f.workspaceId, body),
    created,
  );
  assert.equal(f.db.rows("agent_runs").length, 1);
  await assert.rejects(
    requests.create(f.queen, f.workspaceId, {
      ...body,
      input: { purpose: "changed" },
    }),
  );
  const disabled = createAgentRunRequests(
    f.config,
    f.db.mongo,
    f.workloads,
    readiness,
    [],
    clock,
  );
  assert.equal(
    (
      await disabled.readiness(f.queen, f.workspaceId, {
        ...body,
        requestKey: "unregistered",
      })
    ).executionReady,
    false,
  );
});

test("proposal create uses canonical parent scope and never becomes an arbitrary collection write", async () => {
  const f = await proposalFixture(true);
  const applied = await f.review.apply(f.queen, f.runId, f.request);
  assert.equal(applied.status, "applied_to_draft");
  assert.notEqual(applied.target?.id, f.target.id);
  const created = f.db
    .rows("offerings")
    .find((r) => r.id === applied.target?.id)!;
  assert.equal(created.workspaceId, f.workspaceId);
  assert.equal(created.brandId, f.db.rows("brands")[0]!.id);
  assert.equal(created.status, "draft");
  assert.equal(f.db.rows("offerings").length, 2);
  const other = await proposalFixture(true);
  other.db.rows("brands")[0]!.workspaceId = generatePlatformId("workspace");
  await assert.rejects(
    other.review.apply(other.queen, other.runId, other.request),
  );
  assert.equal(other.db.rows("offerings").length, 1);
  assert.equal(
    other.db.rows("agent_results")[0]!.dispositions[0].status,
    "pending",
  );
});

test("transport rejection binds original owner, is replay safe, and creates no fabricated Result", async () => {
  const f = await fixture();
  await f.service.acceptPrepared(f.queen, f.prepared);
  const work = await f.service.claim(f.principal, {
    dispatch: f.dispatch(),
    claimId: "reject-test",
  });
  const other = f.workloads.authenticated({
    ...f.principal,
    workerId: "other-worker",
  });
  await assert.rejects(
    f.service.rejectWork(other, f.lease(work), "configuration_error"),
  );
  await assert.rejects(
    f.service.rejectWork(
      f.principal,
      { ...f.lease(work), fence: work.fence + 1 },
      "configuration_error",
    ),
  );
  assert.deepEqual(
    await f.service.rejectWork(
      f.principal,
      f.lease(work),
      "configuration_error",
    ),
    { status: "terminal" },
  );
  const events = f.db.rows("events").length;
  assert.deepEqual(
    await f.service.rejectWork(
      f.principal,
      f.lease(work),
      "configuration_error",
    ),
    { status: "terminal" },
  );
  assert.equal(f.db.rows("events").length, events);
  assert.equal(f.db.rows("agent_results").length, 0);
  assert.equal(f.db.rows("agent_runs")[0].terminalReason, "runtime_failure");
  assert.equal(f.db.rows("agent_attempts")[0].status, "failed");
});
test("dispatch disposition never discards a live duplicate and discards terminal delivery", async () => {
  const f = await fixture();
  await f.service.acceptPrepared(f.queen, f.prepared);
  const dispatch = f.dispatch();
  assert.deepEqual(await f.service.dispatchStatus(f.principal, dispatch), {
    disposition: "retry",
  });
  const work = await f.service.claim(f.principal, {
    dispatch,
    claimId: "duplicate",
  });
  assert.deepEqual(await f.service.dispatchStatus(f.principal, dispatch), {
    disposition: "retry",
  });
  await f.service.rejectWork(f.principal, f.lease(work), "invalid_work");
  assert.deepEqual(await f.service.dispatchStatus(f.principal, dispatch), {
    disposition: "discard",
  });
  await assert.rejects(
    f.service.dispatchStatus(f.principal, {
      ...dispatch,
      generation: dispatch.generation + 1,
    }),
  );
});
test("every owned operation denies another session even with the same Cognito class", async () => {
  const f = await fixture();
  await f.service.acceptPrepared(f.queen, f.prepared);
  const work = await f.service.claim(f.principal, {
    dispatch: f.dispatch(),
    claimId: "owner",
  });
  const other = f.workloads.authenticated({
    ...f.principal,
    workerId: "other-worker",
  });
  const lease = f.lease(work);
  const outcome = f.outcome("success", work);
  await assert.rejects(f.service.heartbeat(other, lease));
  await assert.rejects(
    f.service.context(other, { ...lease, snapshotId: "snapshot-1" }),
  );
  await assert.rejects(f.service.outcome(other, lease, outcome));
  await assert.rejects(
    f.service.receipt(other, {
      ...lease,
      submissionId: outcome.submissionId,
      payloadDigest: outcome.payloadDigest,
    }),
  );
  await assert.rejects(f.service.reportUsage(other, lease, outcome.usage[0]));
  await assert.rejects(
    f.service.claim(other, { dispatch: f.dispatch(), claimId: "owner" }),
  );
  assert.equal(f.db.rows("agent_attempts").length, 1);
});

test("explicit dispatch scheduler reconciles and publishes durable intent without executing work", async () => {
  const { createDispatchScheduler } =
    await import("../src/services/agent-dispatch");
  const f = await fixture();
  await f.service.acceptPrepared(f.queen, f.prepared);
  let sent: unknown;
  let published!: () => void;
  const ready = new Promise<void>((resolve) => {
    published = resolve;
  });
  const scheduler = createDispatchScheduler(
    f.db.mongo,
    f.service,
    {
      async send(message) {
        sent = message;
        published();
      },
    },
    () => {
      throw new Error("Dispatch failed");
    },
  );
  scheduler.start();
  const timeout = setTimeout(published, 1000);
  try {
    await ready;
  } finally {
    clearTimeout(timeout);
    await scheduler.stop();
  }
  assert.deepEqual(sent, f.dispatch());
  assert.equal(f.db.rows("agent_attempts").length, 0);
});

test("Effectiveness eligibility gates proposal use but a pass still only permits separately authorized draft application", async () => {
  const f = await proposalFixture();
  const { createAgentProposalReview, hiveDraftProposalHandler } =
    await import("../src/services/agent-proposals");
  const row = f.db.rows("agent_runs")[0]!;
  row.effectiveness = {
    caseId: generatePlatformId("effectivenesscase"),
    role: "maker",
    ordinal: 1,
    transitionKey: digest("transition"),
  };
  let eligible = false;
  const review = createAgentProposalReview(
    f.config,
    f.db.mongo,
    f.service,
    new Map([["offerings", hiveDraftProposalHandler("offerings")]]),
    () => new Date("2030-01-01T12:00:03.000Z"),
    async () => eligible,
  );
  await assert.rejects(review.apply(f.queen, f.runId, f.request));
  assert.equal(
    f.db.rows("agent_results")[0]!.dispositions[0].status,
    "pending",
  );
  eligible = true;
  await assert.rejects(review.apply(f.client, f.runId, f.request));
  const applied = await review.apply(f.queen, f.runId, f.request);
  assert.equal(applied.status, "applied_to_draft");
  assert.equal(f.db.rows("offerings")[0]!.status, "draft");
});
test("schema v11 canonical approval does not bypass an Effectiveness hold after draft application", async () => {
  const f = await proposalFixture();
  await f.review.apply(f.queen, f.runId, f.request);
  const { effectivenessFixture } =
    await import("./helpers/effectiveness-fixture");
  const effect = await effectivenessFixture();
  const c = await effect.effects.create(
    effect.queen,
    effect.workspaceId,
    effect.request,
  );
  c.workspaceId = f.workspaceId;
  c.status = "held";
  delete c.activeRunId;
  f.db.rows("agent_effectiveness_cases").push(c);
  f.db.rows("schema_versions")[0]!.version = 11;
  f.db.rows("agent_runs")[0]!.effectiveness = {
    caseId: c.id,
    role: "maker",
    ordinal: 1,
    transitionKey: digest("transition"),
  };
  const { requireFreshAgentApplications } =
    await import("../src/services/agent-proposal-freshness");
  await assert.rejects(
    f.db.mongo.withTransaction!(async (db, session) =>
      requireFreshAgentApplications(
        db,
        f.workspaceId,
        "offerings",
        f.db.rows("offerings")[0]!,
        session,
      ),
    ),
    /Effectiveness pass is not current/,
  );
});

test("4C characterization: input resume preserves identity but has no authenticated answering-capacity binding", async () => {
  const f = await fixture();
  await f.service.acceptPrepared(f.queen, f.prepared);
  const first = await f.service.claim(f.principal, {
    dispatch: f.dispatch(),
    claimId: "provenance-first",
  });
  f.advance();
  await f.service.outcome(
    f.principal,
    f.lease(first),
    f.outcome("needsInput", first),
  );
  const read = await f.service.read(f.queen, f.runId);
  f.advance();
  await f.service.respond(f.queen, f.runId, read.updatedAt, {
    requestId: read.input!.id,
    values: [{ key: "answer", value: "confirmed" }],
  });
  const resumed = await f.service.claim(f.principal, {
    dispatch: f.dispatch(),
    claimId: "provenance-resumed",
  });
  assert.equal(resumed.resume?.kind, "input");
  if (resumed.resume?.kind !== "input")
    throw new Error("Expected input resume");
  assert.deepEqual(Object.keys(resumed.resume.response).sort(), [
    "actorReference",
    "answeredAt",
    "requestId",
    "schemaKey",
    "schemaVersion",
    "values",
  ]);
  assert.equal(resumed.resume.response.actorReference, f.queen.subject);
  assert.deepEqual(resumed.context, first.context);
  assert.deepEqual(resumed.grant.resources, first.grant.resources);
  const event = f.db
    .rows("events")
    .find((e) => e.payload?.operation === "input_answered")!;
  assert.ok(event);
  assert.equal(event.payload.actor.id, f.queen.subject);
  assert.deepEqual(Object.keys(event.payload).sort(), [
    "actor",
    "application",
    "generation",
    "operation",
    "runId",
  ]);
  assert.deepEqual(Object.keys(event.payload.actor).sort(), [
    "id",
    "issuer",
    "type",
  ]);
  await assert.rejects(
    f.service.context(f.principal, {
      ...f.lease(resumed),
      snapshotId: "input-provenance-not-frozen",
    }),
  );
});

for (const capacity of ["partner", "client"] as const)
  test(`1.2 ${capacity} answer audit survives fresh control plane and retries; current authority remains independent`, async () => {
    const f = await fixture("1.2");
    const actor = capacity === "partner" ? f.queen : f.client;
    if (capacity === "partner")
      f.db.rows("workspace_memberships").forEach((m) => {
        if (m.human.id === f.queen.subject) m.status = "revoked";
      });
    if (capacity === "client") {
      const operators = createAgentOperatorService(
        f.config,
        f.db.mongo,
        {
          async operations() {
            return ["exercise"];
          },
        },
        () => new Date("2030-01-01T12:00:00.000Z"),
      );
      await operators.grant(f.queen, f.workspaceId, f.request);
    }
    await f.service.acceptPrepared(actor, f.prepared);
    const first = await f.service.claim(f.principal, {
      dispatch: f.dispatch(),
      claimId: "first",
    });
    f.advance();
    await f.service.outcome(
      f.principal,
      f.lease(first),
      f.outcome("needsInput", first),
    );
    const read = await f.service.read(actor, f.runId);
    const body = {
      requestId: read.input!.id,
      values: [{ key: "answer", value: "confirmed" }],
    };
    await assert.rejects(
      f.service.respond(actor, f.runId, read.updatedAt, {
        ...body,
        answerProvenance: { capacity: "partner" },
      }),
    );
    await f.service.respond(actor, f.runId, read.updatedAt, body);
    const event = f.db
      .rows("events")
      .find((e) => e.payload?.operation === "input_answered")!;
    const accepted = structuredClone(event);
    assert.equal(event.payload.answerProvenance.capacity, capacity);
    await f.service.respond(actor, f.runId, read.updatedAt, body);
    assert.deepEqual(event, accepted);
    const fresh = createAgentControlPlane(
      f.config,
      f.db.mongo,
      f.workloads,
      {
        async dependencies() {
          return [];
        },
        async current() {
          return true;
        },
      },
      () => new Date("2030-01-01T12:00:01.000Z"),
    );
    const work = await fresh.claim(f.principal, {
      dispatch: f.dispatch(),
      claimId: "fresh",
    });
    assert.equal(work.resume?.kind, "input");
    if (work.resume?.kind === "input")
      assert.deepEqual(
        work.resume.answerProvenance,
        event.payload.answerProvenance,
      );
    // Revocation cannot rewrite the historical event or authorize future execution.
    if (capacity === "client")
      f.db
        .rows("workspace_memberships")
        .find((m) => m.human.id === "client")!.status = "revoked";
    else
      f.db.rows("hvm_partner_memberships").forEach((a) => {
        a.status = "revoked";
      });
    await assert.rejects(
      fresh.claim(f.principal, { dispatch: f.dispatch(), claimId: "fresh" }),
    );
    assert.deepEqual(event, accepted);
  });

test("Platform confirmation reaches a fresh Runtime executor and PSU admission", async () => {
  const { admitHumanFacts, confirmationLabel } =
    await import("../../../../vamberic-agent-runtime/dist/src/agents/product-service-understanding/fact-admission.js");
  const { executeAttempt } =
    await import("../../../../vamberic-agent-runtime/dist/src/runtime/executor.js");
  const { ImplementationRegistry } =
    await import("../../../../vamberic-agent-runtime/dist/src/registry/registry.js");
  const { createFakeAgent } =
    await import("../../../../vamberic-agent-runtime/dist/src/agents/fake.js");
  const { FakeClock } =
    await import("../../../../vamberic-agent-runtime/dist/src/runtime/clock.js");
  const { FakePlatformContext } =
    await import("../../../../vamberic-agent-runtime/dist/src/platform/context.js");
  const f = await fixture("1.2");
  await f.service.acceptPrepared(f.queen, f.prepared);
  const initial = await f.service.claim(f.principal, {
    dispatch: f.dispatch(),
    claimId: "initial",
  });
  const paused = f.outcome("needsInput", initial);
  if (paused.outcome.kind !== "needs_input") throw new Error("fixture");
  const proposition = {
    key: "delivery",
    target: "supplierRole" as const,
    statement: "We email a report.",
    epistemic: "current_claim" as const,
  };
  paused.outcome.inputRequest.schemaKey = "psu_fact_confirmation";
  paused.outcome.inputRequest.fields = [
    {
      key: "delivery",
      type: "boolean",
      required: true,
      label: confirmationLabel(proposition),
    },
  ];
  paused.payloadDigest = digestWithout(paused, "payloadDigest");
  await f.service.outcome(f.principal, f.lease(initial), paused);
  const read = await f.service.read(f.queen, f.runId);
  await f.service.respond(f.queen, f.runId, read.updatedAt, {
    requestId: read.input!.id,
    values: [{ key: "delivery", value: true }],
  });
  const fresh = createAgentControlPlane(
    f.config,
    f.db.mongo,
    f.workloads,
    {
      async dependencies() {
        return [];
      },
      async current() {
        return true;
      },
    },
    () => new Date("2030-01-01T12:00:01.000Z"),
  );
  const delivered = JSON.parse(
    JSON.stringify(
      await fresh.claim(f.principal, {
        dispatch: f.dispatch(),
        claimId: "fresh-executor",
      }),
    ),
  );
  const registry = new ImplementationRegistry();
  const agent = createFakeAgent();
  let admitted: ReturnType<typeof admitHumanFacts> | undefined;
  registry.register({
    ...agent,
    manifest: f.prepared.manifest,
    operations: {
      ...agent.operations,
      exercise: {
        ...agent.operations.exercise!,
        requirements: { context: false, models: false, tools: false },
        async execute(i) {
          admitted = admitHumanFacts({ ...delivered, resume: i.resume }, [
            proposition,
          ]);
          return {
            kind: "success",
            completeness: { kind: "complete" },
            content: {
              assumptions: [],
              unknowns: [],
              artifacts: [],
              findings: [],
              evidence: [],
              proposals: [],
              lineage: [],
              knowledgeGaps: [],
              warnings: [],
              domainOutput: { summary: admitted[0]!.statement },
            },
          };
        },
      },
    },
  });
  const result = await executeAttempt(delivered, {
    registry,
    clock: new FakeClock(new Date("2030-01-01T12:00:01.000Z").getTime()),
    platform: new FakePlatformContext([]),
    models: [],
    tools: [],
  });
  assert.equal(result.status, "executed");
  if (result.status === "executed")
    assert.equal(result.outcome.outcome.kind, "success");
  const event = f.db
    .rows("events")
    .find((e) => e.payload?.operation === "input_answered")!;
  assert.deepEqual(admitted?.[0]?.provenance, event.payload.answerProvenance);
  assert.equal(admitted?.[0]?.policyVersion, "psu_human_facts_v1");
  assert.equal(admitted?.[0]?.sourceClassification, "partner_statement");
});

for (const corruption of [
  "missing",
  "duplicate",
  "actor",
  "generation",
  "workspace",
  "response",
] as const)
  test(`1.2 persisted attestation rejects ${corruption}`, async () => {
    const f = await fixture("1.2");
    await f.service.acceptPrepared(f.queen, f.prepared);
    const work = await f.service.claim(f.principal, {
      dispatch: f.dispatch(),
      claimId: "initial",
    });
    await f.service.outcome(
      f.principal,
      f.lease(work),
      f.outcome("needsInput", work),
    );
    const read = await f.service.read(f.queen, f.runId);
    await f.service.respond(f.queen, f.runId, read.updatedAt, {
      requestId: read.input!.id,
      values: [{ key: "answer", value: "accepted" }],
    });
    const event = f.db
      .rows("events")
      .find((e) => e.payload?.operation === "input_answered")!;
    if (corruption === "missing") delete event.payload.answerProvenance;
    if (corruption === "duplicate")
      f.db.rows("events").push(structuredClone(event));
    if (corruption === "actor") event.payload.actor.id = "other";
    if (corruption === "generation") event.payload.generation++;
    if (corruption === "workspace")
      event.workspaceId = generatePlatformId("workspace");
    if (corruption === "response") {
      event.payload.answerProvenance.responseDigest = digest("changed");
      event.payload.answerProvenance.digest = digestWithout(
        event.payload.answerProvenance,
        "digest",
      );
    }
    await assert.rejects(
      f.service.claim(f.principal, {
        dispatch: f.dispatch(),
        claimId: "resumed",
      }),
    );
  });
test("1.2 execution requires applied v12; declared dispatch and outcome versions cannot be switched", async () => {
  const f = await fixture("1.2");
  f.db.rows("schema_versions")[0]!.version = 11;
  await assert.rejects(f.service.acceptPrepared(f.queen, f.prepared), /v12/);
  f.db.rows("schema_versions")[0]!.version = 12;
  await f.service.acceptPrepared(f.queen, f.prepared);
  await assert.rejects(
    f.service.claim(f.principal, {
      dispatch: { ...f.dispatch(), protocolVersion: "1.1" },
      claimId: "wrong-version",
    }),
  );
  const work = await f.service.claim(f.principal, {
    dispatch: f.dispatch(),
    claimId: "correct",
  });
  const outcome = f.outcome("success", work);
  outcome.protocolVersion = "1.1";
  outcome.payloadDigest = digestWithout(outcome, "payloadDigest");
  await assert.rejects(f.service.outcome(f.principal, f.lease(work), outcome));
});

test("Partner respondent on a client-delegated Run records and serializes the respondent capacity", async () => {
  const f = await fixture("1.2");
  const operators = createAgentOperatorService(
    f.config,
    f.db.mongo,
    {
      async operations() {
        return ["exercise"];
      },
    },
    () => new Date("2030-01-01T12:00:00.000Z"),
  );
  await operators.grant(f.queen, f.workspaceId, f.request);
  await f.service.acceptPrepared(f.client, f.prepared);
  const work = await f.service.claim(f.principal, {
    dispatch: f.dispatch(),
    claimId: "initial",
  });
  await f.service.outcome(
    f.principal,
    f.lease(work),
    f.outcome("needsInput", work),
  );
  const read = await f.service.read(f.queen, f.runId);
  const before = f.db.rows("hvm_partner_memberships")[0]!.executionSerial ?? 0;
  await f.service.respond(f.queen, f.runId, read.updatedAt, {
    requestId: read.input!.id,
    values: [{ key: "answer", value: "Partner statement" }],
  });
  const event = f.db
    .rows("events")
    .find((e) => e.payload?.operation === "input_answered")!;
  assert.equal(event.payload.answerProvenance.capacity, "partner");
  assert.equal(event.payload.answerProvenance.actor.id, f.queen.subject);
  assert.ok(f.db.rows("hvm_partner_memberships")[0]!.executionSerial > before);
});


test("independent client admin authority survives delegated partner revocation", async () => {
  const f = await fixture();
  await f.service.acceptPrepared(f.queen, f.prepared);
  f.db.rows("hvm_partner_memberships").forEach((m) => { m.status = "revoked"; });
  const work = await f.service.claim(f.principal, {dispatch: f.dispatch(), claimId: "direct-admin"});
  assert.equal(work.runId, f.runId);
});
