import assert from "node:assert/strict";
import { test } from "node:test";
import { workspaceAgentFixture } from "./helpers/workspace-agent-v16";
import { psuAppOptions } from "../src/services/psu-app-options";
import { createPsuGateway } from "../../../.integration/hvm-app-legacy-psu/src/data/psu";
test("PSU discovery uses current Partner authority, exact manifest and no Client Agent", async () => {
  const f = await workspaceAgentFixture(true);
  const capabilities = {
    manifest: async () => f.manifest,
    available: async () => true,
    reasoningOperations: () => f.manifest.operations,
  };
  const options = await psuAppOptions(
    f.config,
    f.db.mongo,
    f.queen,
    f.workspaceId,
    capabilities,
  );
  assert.equal(options.items.length, 1);
  assert.deepEqual(options.items[0]!.target, f.target);
  assert.equal(f.db.rows("client_agents").length, 0);
  const gateway = createPsuGateway(
    "https://synthetic.invalid",
    { getAccessToken: async () => "synthetic", invalidate: () => {} },
    async () => Response.json(options),
  );
  assert.equal(
    (await gateway.options(f.workspaceId, new AbortController().signal)).length,
    1,
  );
  assert.equal(
    (await psuAppOptions(f.config, f.db.mongo, f.queen, f.workspaceId)).items
      .length,
    0,
  );
  f.db.rows("hvm_partner_memberships")[0]!.status = "ended";
  f.db.rows("workspace_memberships").forEach((m) => {
    m.status = "ended";
  });
  await assert.rejects(
    psuAppOptions(f.config, f.db.mongo, f.queen, f.workspaceId, capabilities),
  );
});
test("PSU discovery does not list an altered manifest or an Empress-only identity", async () => {
  const f = await workspaceAgentFixture(true);
  const changed = { ...f.manifest, manifestDigest: "0".repeat(64) };
  await assert.rejects(() =>
    psuAppOptions(f.config, f.db.mongo, f.queen, f.workspaceId, {
      manifest: async () => changed,
      available: async () => true,
    }),
  );
  await assert.rejects(() =>
    psuAppOptions(
      { ...f.config, empressSubjects: ["empress-only"] },
      f.db.mongo,
      { ...f.queen, subject: "empress-only" },
      f.workspaceId,
    ),
  );
});

test("workspace PSU discovery fails closed on schema 11", async () => {
  const f = await workspaceAgentFixture(true);
  f.db.rows("schema_versions")[0]!.version = 11;
  await assert.rejects(
    () => psuAppOptions(f.config, f.db.mongo, f.queen, f.workspaceId),
    /qualified schema/,
  );
});

test("real frontend PSU start serialization reaches the case service without Client Agent configuration", async () => {
  const f = await workspaceAgentFixture(true);
  f.db.rows("schema_versions")[0]!.version = 23;
  const options = await psuAppOptions(
    f.config,
    f.db.mongo,
    f.queen,
    f.workspaceId,
    {
      manifest: async () => f.manifest,
      available: async () => true,
      reasoningOperations: () => f.manifest.operations,
    },
  );
  const gateway = createPsuGateway(
    "https://synthetic.invalid",
    {
      getAccessToken: async () => "synthetic",
      invalidate: () => {},
    },
    async (url, init) => {
      assert.equal(
        new URL(String(url)).pathname,
        `/api/v1/hvm/workspaces/${f.workspaceId}/agent-effectiveness-cases`,
      );
      assert.equal(init?.method, "POST");
      return Response.json(
        await f.effects.create(
          f.queen,
          f.workspaceId,
          JSON.parse(String(init?.body)),
        ),
      );
    },
  );
  const input = { ...f.request.input, mode: "create" as const };
  const result = await gateway.start(
    f.workspaceId,
    options.items[0]!,
    input,
    "frontend-start",
    new AbortController().signal,
  );
  assert.ok(result);
  assert.equal(f.db.rows("agent_effectiveness_cases").length, 1);
  assert.equal(f.db.rows("agent_runs").length, 1);
  assert.equal(f.db.rows("client_agents").length, 0);
});
