import test from "node:test";
import assert from "node:assert/strict";
import {
  projectChannelReadiness,
  type ChannelReadinessObservation,
} from "../src/services/channel-readiness";
import { generatePlatformId } from "../src/domain/ids";
const workspaceId = generatePlatformId("workspace"),
  configurationId = generatePlatformId("clientagent");
const row: ChannelReadinessObservation = {
  workspaceId,
  definition: { id: generatePlatformId("agentdefinition"), version: 1 },
  implementation: {
    key: "synthetic",
    version: 1,
    manifestDigest: "a".repeat(64),
    buildDigest: "b".repeat(64),
  },
  integrationReference: {
    id: generatePlatformId("integration"),
    executionSerial: 0,
  },
  providerReference: {
    id: generatePlatformId("integrationprovider"),
    version: 1,
    key: "synthetic",
  },
  channel: "email",
  policyIds: [],
  windowIds: [],
  configurationId,
  configurationRevision: 1,
  binding: "email",
  operation: "send",
  configuration: "current",
  integration: "connected",
  permission: "allowed",
  budget: "sufficient",
  observedAt: new Date(),
};
const ids = new Set([configurationId]);
test("channel discovery is scoped, bounded, strict and never an execution permit", () => {
  assert.equal(
    projectChannelReadiness(workspaceId, [row], ids)[0]!.executable,
    false,
  );
  assert.throws(() =>
    projectChannelReadiness(generatePlatformId("workspace"), [row], ids),
  );
  assert.throws(() => projectChannelReadiness(workspaceId, [row], new Set()));
  assert.throws(() =>
    projectChannelReadiness(workspaceId, Array(51).fill(row), ids),
  );
  assert.throws(() =>
    projectChannelReadiness(
      workspaceId,
      [{ ...row, secretRef: "denied" } as ChannelReadinessObservation],
      ids,
    ),
  );
});
test("independent failures remain visible without disclosing pooled account capacity", () => {
  const result = projectChannelReadiness(
    workspaceId,
    [
      {
        ...row,
        configuration: "stale",
        integration: "disconnected",
        permission: "denied",
        budget: "unknown",
      },
    ],
    ids,
  )[0]!;
  assert.equal(result.executable, false);
  assert.equal(result.permission, "denied");
  assert.equal(result.budget, "unknown");
  assert.equal("accountRemaining" in result, false);
});
