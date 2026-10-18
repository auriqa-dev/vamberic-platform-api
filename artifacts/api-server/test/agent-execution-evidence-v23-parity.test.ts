import test from "node:test";
import assert from "node:assert/strict";
import { agentMongoParity } from "./helpers/agent-mongo-parity";
import { EXECUTION_EVIDENCE_VALIDATORS } from "../src/db/agent-execution-evidence-v23";
import { InvocationJournalSchema } from "../src/domain/agent-execution-evidence";
const release = {
  environment: "dev",
  workloadClass: "agent_runtime",
  workloadClientId: "client",
  manifestDigest: "a".repeat(64),
  buildDigest: "b".repeat(64),
  policyDigest: "c".repeat(64),
  serviceArn: "service",
  taskDefinitionArn: "task",
  imageDigest: `sha256:${"d".repeat(64)}`,
};
const row = {
  id: "invocation:synthetic",
  schemaVersion: 1,
  policy: "psu_execution_evidence_v1",
  binding: {
    runId: "run:one",
    attemptId: "attempt:one",
    workspaceId: "workspace_00000000000000000000000001",
    generation: 1,
    fence: 1,
    leaseId: "lease:one",
    workloadClientId: "client",
    workerId: "worker:one",
    invocationId: "call:one",
    release,
  },
  provider: {
    provider: "openai",
    model: "gpt-6.1-sol",
    role: "maker",
    projectReference: "proj_synthetic",
    transportVersion: "psu_execution_evidence_v1",
    requestDigest: "e".repeat(64),
  },
  correlationId: "correlation:synthetic",
  preparedAt: new Date("2026-10-05T00:00:00Z"),
  revision: 1,
  state: "prepared",
  financialReconciliationPending: true,
};
export const cases = [
  {
    collection: "agent_execution_invocations",
    name: "prepared valid",
    document: row,
    valid: true,
  },
  {
    collection: "agent_execution_invocations",
    name: "missing binding",
    document: { ...row, binding: undefined },
    valid: false,
  },
  {
    collection: "agent_execution_invocations",
    name: "date must be BSON date",
    document: { ...row, preparedAt: row.preparedAt.toISOString() },
    valid: false,
  },
  {
    collection: "agent_execution_invocations",
    name: "unknown state",
    document: { ...row, state: "reset" },
    valid: false,
  },
  {
    collection: "agent_execution_invocations",
    name: "unknown secret field",
    document: { ...row, secret: "synthetic" },
    valid: false,
  },
  {
    collection: "agent_execution_invocations",
    name: "zero revision",
    document: { ...row, revision: 0 },
    valid: false,
  },
  {
    collection: "agent_execution_invocations",
    name: "negative fence",
    document: { ...row, binding: { ...row.binding, fence: -1 } },
    valid: false,
  },
  {
    collection: "agent_execution_invocations",
    name: "wrong environment",
    document: {
      ...row,
      binding: { ...row.binding, release: { ...release, environment: "prod" } },
    },
    valid: false,
  },
  {
    collection: "agent_execution_invocations",
    name: "bad hash",
    document: {
      ...row,
      provider: { ...row.provider, requestDigest: "not-hash" },
    },
    valid: false,
  },
  {
    collection: "agent_execution_invocations",
    name: "unsupported transport",
    document: {
      ...row,
      provider: { ...row.provider, transportVersion: "latest" },
    },
    valid: false,
  },
  {
    collection: "agent_execution_invocations",
    name: "oversized correlation",
    document: { ...row, correlationId: "x".repeat(257) },
    valid: false,
  },
  // Structural acceptance is intentional; server state machine must prove the receipt and permission.
  {
    collection: "agent_execution_invocations",
    name: "terminal without receipt is an application-state violation",
    document: { ...row, state: "terminal" },
    valid: true,
  },
  {
    collection: "agent_execution_controls",
    name: "open control",
    document: { id: "dev:agent_runtime", state: "open", revision: 1 },
    valid: true,
  },
  {
    collection: "agent_execution_controls",
    name: "hold control",
    document: {
      id: "dev:agent_runtime",
      state: "integrity_hold",
      revision: 2,
      conflictJournalId: row.id,
    },
    valid: true,
  },
  {
    collection: "agent_execution_controls",
    name: "bad control id",
    document: { id: "prod:agent_runtime", state: "open", revision: 1 },
    valid: false,
  },
  {
    collection: "agent_execution_controls",
    name: "manual reset field",
    document: {
      id: "dev:agent_runtime",
      state: "open",
      revision: 1,
      reset: true,
    },
    valid: false,
  },
];
test("v23 structural contracts do not claim to prove terminal transition semantics", () => {
  assert.equal(
    InvocationJournalSchema.parse({ ...row, state: "terminal" }).state,
    "terminal",
  );
  assert.equal(cases.length, 16);
});
test(
  "v23 proposed Mongo validators: 16 read-only synthetic boundary cases",
  { skip: process.env.AGENT_V23_MONGO_PARITY !== "1" },
  async () => {
    assert.notEqual(process.env.AGENT_INSTALLED_MONGO_PARITY, "1");
    await agentMongoParity(cases, EXECUTION_EVIDENCE_VALIDATORS);
  },
);
