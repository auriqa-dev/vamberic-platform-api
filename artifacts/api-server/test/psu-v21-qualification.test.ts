import assert from "node:assert/strict";
import test from "node:test";
import { releaseDatabaseTarget } from "../src/db/setup";
import { workspaceAgentFixture } from "./helpers/workspace-agent-v16";
import { psuAppOptions } from "../src/services/psu-app-options";
import { requireAgentControlPlane } from "../src/services/agent-operators";
import { mutateOperating } from "../src/services/operating";
import { PRODUCT_CLARIFICATION_MANIFEST } from "@workspace/agent-runtime-protocol";
test("v21 preserves every prior validator and index used by the PSU operating/control plane", () => {
  const before = releaseDatabaseTarget(20),
    after = releaseDatabaseTarget(21);
  for (const [name, validator] of Object.entries(before.validators))
    assert.deepEqual(after.validators[name], validator, name);
  assert.deepEqual(
    after.collections.filter((c) => c.name !== "client_onboardings"),
    before.collections,
  );
  assert.deepEqual(
    Object.keys(after.validators).filter((k) => !(k in before.validators)),
    ["client_onboardings"],
  );
});
test("v21 workspace PSU discovery needs no Client Agent and still rejects unavailable capacity and Empress-only authority", async () => {
  const f = await workspaceAgentFixture(true, PRODUCT_CLARIFICATION_MANIFEST);
  f.db.rows("schema_versions")[0]!.version = 21;
  const capabilities = {
    manifest: async () => f.manifest,
    available: async () => true,
    reasoningOperations: () => f.manifest.operations,
  };
  const result = await psuAppOptions(
    f.config,
    f.db.mongo,
    f.queen,
    f.workspaceId,
    capabilities,
  );
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]!.target.kind, "workspace_agent");
  assert.equal(f.db.rows("client_agents").length, 0);
  assert.equal(
    (await psuAppOptions(f.config, f.db.mongo, f.queen, f.workspaceId)).items
      .length,
    0,
  );
  assert.equal(
    (
      await psuAppOptions(f.config, f.db.mongo, f.queen, f.workspaceId, {
        ...capabilities,
        available: async () => false,
      })
    ).items[0]!.executionAvailable,
    false,
  );
  await assert.rejects(
    psuAppOptions(
      { ...f.config, empressSubjects: ["empress-only"] },
      f.db.mongo,
      { ...f.queen, subject: "empress-only" },
      f.workspaceId,
      capabilities,
    ),
  );
  f.db.rows("hvm_partner_memberships")[0]!.status = "ended";
  assert.equal(
    (
      await psuAppOptions(
        f.config,
        f.db.mongo,
        f.queen,
        f.workspaceId,
        capabilities,
      )
    ).items.length,
    0,
  );
});
test("v21 Empress may register exact PSU metadata without workspace membership or activation", async () => {
  const f = await workspaceAgentFixture(true, PRODUCT_CLARIFICATION_MANIFEST);
  f.db.rows("schema_versions")[0]!.version = 21;
  const definition = f.db.rows("agent_definitions")[0]!;
  const actor = { ...f.queen, subject: "empress-only" },
    config = { ...f.config, empressSubjects: [actor.subject] };
  f.db.rows("agent_definitions").splice(0);
  const created = await mutateOperating(
    f.db.mongo,
    config,
    actor,
    "agent_definitions",
    "create",
    {
      key: definition.key,
      version: 1,
      availability: "queens",
      data: definition.data,
    },
  );
  assert.ok(created);
  assert.equal(f.db.rows("agent_definitions")[0]!.status, "draft");
  assert.equal(f.db.rows("client_agents").length, 0);
  assert.equal(f.db.rows("agent_runs").length, 0);
  assert.equal(
    f.db
      .rows("workspace_memberships")
      .some((m) => m.human.id === actor.subject),
    false,
  );
});
test("unknown schema24 remains unavailable for Agent control plane and PSU discovery", async () => {
  const f = await workspaceAgentFixture(true, PRODUCT_CLARIFICATION_MANIFEST);
  f.db.rows("schema_versions")[0]!.version = 24;
  await assert.rejects(requireAgentControlPlane(await f.db.mongo.database()));
  await assert.rejects(
    psuAppOptions(f.config, f.db.mongo, f.queen, f.workspaceId),
  );
});
