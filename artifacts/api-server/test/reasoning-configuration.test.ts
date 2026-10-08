import test from "node:test";
import assert from "node:assert/strict";
import { digest } from "@workspace/agent-runtime-protocol";
import { workspaceTarget } from "../src/domain/agent-operator";
import { projectReasoningConfiguration } from "../src/services/reasoning-configuration";
import { operatingFixtures } from "./helpers/operating-fixtures";
function fixture() {
  const row = operatingFixtures().client_agents;
  const target = workspaceTarget({
    kind: "workspace_agent",
    workspaceId: row.workspaceId,
    definition: { ...row.data.definition, key: "synthetic" },
    implementation: {
      key: "synthetic",
      version: 1,
      manifestDigest: "a".repeat(64),
      buildDigest: "b".repeat(64),
    },
  });
  return {
    row,
    target,
    selection: {
      id: row.id,
      revision: row.revision,
      contentHash: digest(JSON.parse(JSON.stringify(row))),
    },
  };
}
test("omitted customization needs no configuration record or read authority", () => {
  const { target } = fixture();
  assert.deepEqual(
    projectReasoningConfiguration({
      target,
      defaults: [],
      authorized: false,
      merge: () => {
        throw new Error("must not run");
      },
    }),
    { configuration: [], dependencies: [] },
  );
});
test("optional overlay is exact, scoped and projects configuration only", () => {
  const { row, target, selection } = fixture();
  let observed: unknown;
  const options = {
    target,
    selection,
    record: row,
    defaults: [],
    authorized: true,
    merge: (_defaults: unknown, configuration: unknown) => {
      observed = configuration;
      return [];
    },
  };
  const result = projectReasoningConfiguration(options);
  assert.deepEqual(observed, row.data.configuration);
  assert.deepEqual(result.configuration, []);
  assert.equal(result.dependencies[0]!.contentHash, selection.contentHash);
  assert.equal("bindings" in result, false);
  assert.equal("grant" in result, false);
  for (const record of [
    { ...row, revision: row.revision + 1 },
    { ...row, workspaceId: "workspace_00000000000000000000000000" },
    { ...row, data: { ...row.data, configuration: [] } },
  ]) {
    if (digest(JSON.parse(JSON.stringify(record))) !== selection.contentHash)
      assert.throws(() =>
        projectReasoningConfiguration({ ...options, record }),
      );
  }
  assert.throws(() =>
    projectReasoningConfiguration({ ...options, authorized: false }),
  );
});
