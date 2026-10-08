import assert from "node:assert/strict";
import { test } from "node:test";
import { generatePlatformId } from "../src/domain/ids";
import { resolveHvmContext } from "../src/services/hvm-context";
import { createAgentOperatorService } from "../src/services/agent-operators";
import { agentOperatorFixture } from "./helpers/agent-operator-fixture";

test("Queen grants, discovers, reaffirms and revokes without granting canonical authority", async () => {
  const f = await agentOperatorFixture();
  const created = await f.service.grant(f.queen, f.workspaceId, f.request);
  const grants = await f.service.readGrants(
    f.queen,
    f.workspaceId,
    f.membership.id,
  );
  assert.equal(grants.grants.length, 1);
  assert.equal(grants.grants[0]?.grantedBy.id, "queen");
  const discovered = await f.service.discover(f.client, f.workspaceId, {});
  assert.equal(discovered.items.length, 1);
  assert.equal(discovered.items[0]?.executionAvailable, true);
  assert.equal(JSON.stringify(discovered).includes("grantedBy"), false);
  assert.equal(JSON.stringify(discovered).includes("bindings"), false);
  const context = await resolveHvmContext(
    await f.db.mongo.database(),
    f.config,
    f.client,
  );
  assert.equal(
    context.authority.authorize(context.context, "update", {
      type: "client_agents",
      workspaceId: f.workspaceId,
    }),
    false,
  );
  assert.ok(
    context.authority.authorizeAgentOperation(
      context.context,
      {
        workspaceId: f.workspaceId,
        target: grants.grants[0]!.target,
        operation: "exercise",
        action: "request",
      },
      new Date("2030-01-01T12:00:00.000Z"),
    ),
  );
  f.agent.revision = 2;
  assert.equal(
    (await f.service.discover(f.client, f.workspaceId, {})).items.length,
    0,
  );
  f.tick();
  const reaffirmed = await f.service.grant(f.queen, f.workspaceId, {
    ...f.request,
    target: { ...f.request.target, revision: 2 },
    expectedUpdatedAt: created.updatedAt,
  });
  assert.notEqual(reaffirmed.grantId, created.grantId);
  assert.equal(
    (await f.service.readGrants(f.queen, f.workspaceId, f.membership.id)).grants
      .length,
    1,
  );
  f.tick();
  await f.service.revoke(f.queen, f.workspaceId, {
    membershipId: f.membership.id,
    grantId: reaffirmed.grantId,
    expectedUpdatedAt: reaffirmed.updatedAt,
  });
  assert.equal(
    (await f.service.discover(f.client, f.workspaceId, {})).items.length,
    0,
  );
  const audit = f.db
    .rows("events")
    .filter((e) => e.eventType.startsWith("agent_operation_grant_"));
  assert.deepEqual(
    audit.map((e) => e.eventType),
    [
      "agent_operation_grant_created",
      "agent_operation_grant_reaffirmed",
      "agent_operation_grant_revoked",
    ],
  );
  assert.ok(
    audit.every(
      (e) => e.workspaceId === f.workspaceId && e.payload.actor.id === "queen",
    ),
  );
  assert.equal(audit[1]?.payload.supersededGrantId, created.grantId);
});
test("client admin cannot self-grant or grant others; strict requests reject authority injection", async () => {
  const f = await agentOperatorFixture();
  for (const role of ["member", "admin"] as const) {
    f.membership.role = role;
    await assert.rejects(f.service.grant(f.client, f.workspaceId, f.request));
    await assert.rejects(
      f.service.readGrants(f.client, f.workspaceId, f.membership.id),
    );
  }
  await assert.rejects(
    f.service.grant(f.queen, f.workspaceId, {
      ...f.request,
      grantedBy: f.client,
    }),
  );
  await assert.rejects(
    f.service.grant(f.queen, f.workspaceId, {
      ...f.request,
      operations: ["apply"],
    }),
  );
  await assert.rejects(
    f.service.grant(f.queen, generatePlatformId("workspace"), f.request),
  );
  assert.equal(
    f.db.rows("workspace_memberships").find((m) => m.id === f.membership.id)
      ?.agentOperationGrants,
    undefined,
  );
});
test("concurrent Queens cannot overwrite grants using the same membership token", async () => {
  const f = await agentOperatorFixture();
  const results = await Promise.allSettled([
    f.service.grant(f.queen, f.workspaceId, f.request),
    f.service.grant(f.queen, f.workspaceId, f.request),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.filter((r) => r.status === "rejected").length, 1);
  assert.equal(
    f.db
      .rows("events")
      .filter((e) => e.eventType === "agent_operation_grant_created").length,
    1,
  );
});
test("old schema and absent execution catalogue fail closed without writes", async () => {
  const f = await agentOperatorFixture();
  const unavailable = createAgentOperatorService(f.config, f.db.mongo);
  await assert.rejects(unavailable.grant(f.queen, f.workspaceId, f.request));
  f.db.rows("schema_versions")[0]!.version = 9;
  await assert.rejects(f.service.grant(f.queen, f.workspaceId, f.request));
  assert.equal(
    f.db
      .rows("events")
      .filter((e) => e.eventType === "agent_operation_grant_created").length,
    0,
  );
});

test("audit failure rolls back membership grant and workspace serialization together", async () => {
  const f = await agentOperatorFixture();
  const before = structuredClone(f.db.records);
  f.db.failCollection = "events";
  await assert.rejects(f.service.grant(f.queen, f.workspaceId, f.request));
  assert.deepEqual(f.db.records, before);
});
