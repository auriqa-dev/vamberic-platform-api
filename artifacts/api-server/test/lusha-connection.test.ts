import assert from "node:assert/strict";
import { test } from "node:test";
import { lushaFixture } from "./helpers/lusha";
test("workspace connection stores only a secret reference, permissions are independent, and disconnect fences use", async () => {
  const f = await lushaFixture();
  const c = await f.service.connect(f.identity, f.w, {
    apiKey: "test-secret-only",
    expectedUpdatedAt: null,
    permissions: { research: false, discovery: false, enrichment: false },
  });
  assert.equal(c.status, "connected");
  assert.equal(c.credits?.remaining, 90);
  assert.equal(f.requests(), 1);
  assert.ok(
    !JSON.stringify(f.db.rows("workspace_integrations")).includes(
      "test-secret-only",
    ),
  );
  assert.ok(!JSON.stringify(f.db.rows("events")).includes("test-secret-only"));
  assert.ok(!JSON.stringify(c).includes("secretReference"));
  await assert.rejects(f.service.active(f.identity, f.w, "enrichment"));
  const enabled = await f.service.update(f.identity, f.w, {
    expectedUpdatedAt: c.updatedAt,
    permissions: { research: true, enrichment: true, discovery: false },
  });
  assert.ok(await f.service.active(f.identity, f.w, "enrichment"));
  await assert.rejects(f.service.active(f.identity, f.w, "discovery"));
  await f.service.update(f.identity, f.w, {
    expectedUpdatedAt: enabled.updatedAt,
    permissions: { research: true, enrichment: true, discovery: false },
    disconnect: true,
  });
  await assert.rejects(f.service.active(f.identity, f.w, "enrichment"));
});
test("foreign workspace and retired catalogue cannot connect or resolve credentials", async () => {
  const f = await lushaFixture();
  await assert.rejects(
    f.service.connect({ ...f.identity, subject: "outsider" }, f.w, {
      apiKey: "test-secret-only",
      expectedUpdatedAt: null,
      permissions: { research: true, enrichment: true, discovery: true },
    }),
  );
  assert.equal(f.requests(), 0);
  f.db.rows("integration_providers")[0]!.status = "retired";
  await assert.rejects(
    f.service.connect(f.identity, f.w, {
      apiKey: "test-secret-only",
      expectedUpdatedAt: null,
      permissions: { research: true, enrichment: true, discovery: true },
    }),
  );
  assert.equal(f.requests(), 0);
});

test("new and reconnected records survive Mongo BSON without null lifecycle fields", async () => {
  const { BSON } = await import("mongodb");
  const { WorkspaceIntegrationSchema } = await import("../src/domain");
  const f = await lushaFixture();
  const input = {
    apiKey: "test-secret-only",
    expectedUpdatedAt: null as string | null,
    permissions: { research: true, discovery: true, enrichment: true },
  };
  const first = await f.service.connect(f.identity, f.w, input);
  const row = f.db.rows("workspace_integrations")[0]!;
  const persisted = BSON.deserialize(
    BSON.serialize(row, { ignoreUndefined: false }),
  );
  for (const field of [
    "disconnectedAt",
    "lastSyncAt",
    "lastSuccessfulSyncAt",
    "errorCode",
  ])
    assert.equal(Object.hasOwn(persisted, field), false);
  WorkspaceIntegrationSchema.parse(persisted);
  const disconnected = await f.service.update(f.identity, f.w, {
    expectedUpdatedAt: first.updatedAt,
    permissions: input.permissions,
    disconnect: true,
  });
  Object.assign(row, { _id: new BSON.ObjectId() });
  const second = await f.service.connect(f.identity, f.w, {
    ...input,
    expectedUpdatedAt: disconnected.updatedAt,
  });
  assert.equal(second.status, "connected");
  const replacement = BSON.deserialize(
    BSON.serialize(f.db.rows("workspace_integrations")[0]!, {
      ignoreUndefined: false,
    }),
  );
  const { _id: mongoId, ...domainRecord } = replacement;
  assert.ok(mongoId instanceof BSON.ObjectId);
  WorkspaceIntegrationSchema.parse(domainRecord);
  assert.equal(Object.hasOwn(replacement, "disconnectedAt"), false);
});
