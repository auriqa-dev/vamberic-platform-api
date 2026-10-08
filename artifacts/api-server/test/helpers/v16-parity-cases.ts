import { V16_BUDGET_SCHEMAS } from "../../src/db/agent-foundation-v16";
import { v16IdentityParityCases } from "./v16-identity-parity";
const identity = await v16IdentityParityCases();
const id = (prefix: string) => `${prefix}_00000000000000000000000000`;
const now = new Date("2030-01-01T00:00:00Z"),
  end = new Date("2030-02-01T00:00:00Z");
const policy = {
  id: id("budgetpolicy"),
  workspaceId: id("workspace"),
  version: 1,
  scope: {
    kind: "configuration",
    configurationId: id("clientagent"),
    binding: "email",
  },
  measure: { kind: "quantity", unit: "emails" },
  operations: ["send"],
  limit: "10",
  effectiveFrom: now,
  effectiveUntil: end,
  createdAt: now,
  sourceEventId: id("event"),
};
const window = {
  id: id("budgetwindow"),
  workspaceId: id("workspace"),
  policyId: policy.id,
  policyVersion: 1,
  start: now,
  end,
  reserved: "0",
  consumed: "0",
  executionSerial: 0,
  blocked: false,
};
const operation = {
  id: "synthetic",
  workspaceId: id("workspace"),
  runId: id("agentrun"),
  attemptId: id("agentattempt"),
  fence: 1,
  configurationId: id("clientagent"),
  configurationRevision: 1,
  binding: "email",
  integrationId: id("integration"),
  integrationSerial: 0,
  operation: "send",
  payloadDigest: "a".repeat(64),
  expiresAt: end,
};
const reservation = {
  id: id("budgetreservation"),
  workspaceId: id("workspace"),
  logicalOperation: operation,
  allocations: [{ windowId: window.id, amount: "1" }],
  state: "reserved",
  executionSerial: 0,
};
export const cases = [
  {
    collection: "execution_budget_policies",
    name: "valid",
    document: policy,
    valid: true,
    applicationValid: true,
  },
  {
    collection: "execution_budget_windows",
    name: "valid",
    document: window,
    valid: true,
    applicationValid: true,
  },
  {
    collection: "execution_budget_reservations",
    name: "valid",
    document: reservation,
    valid: true,
    applicationValid: true,
  },
  {
    collection: "execution_budget_policies",
    name: "fractional count is application semantic check",
    document: { ...policy, limit: "1.5" },
    valid: true,
    applicationValid: false,
  },
  {
    collection: "execution_budget_policies",
    name: "negative limit rejected structurally",
    document: { ...policy, limit: "-1" },
    valid: false,
    applicationValid: false,
  },
  {
    collection: "execution_budget_policies",
    name: "unknown authority field rejected structurally",
    document: { ...policy, permissions: ["execute"] },
    valid: false,
    applicationValid: false,
  },
  {
    collection: "execution_budget_policies",
    name: "interval ordering is application semantic check",
    document: { ...policy, effectiveUntil: now },
    valid: true,
    applicationValid: false,
  },
  {
    collection: "execution_budget_windows",
    name: "fractional serial rejected structurally",
    document: { ...window, executionSerial: 1.5 },
    valid: false,
    applicationValid: false,
  },
  {
    collection: "execution_budget_reservations",
    name: "workspace equality is application semantic check",
    document: {
      ...reservation,
      workspaceId: "workspace_00000000000000000000000001",
    },
    valid: true,
    applicationValid: false,
  },
  {
    collection: "execution_budget_reservations",
    name: "missing settlement is application semantic check",
    document: { ...reservation, state: "settled" },
    valid: true,
    applicationValid: false,
  },
  {
    collection: "execution_budget_reservations",
    name: "no allocation rejected structurally",
    document: { ...reservation, allocations: [] },
    valid: false,
    applicationValid: false,
  },
  {
    collection: "execution_budget_reservations",
    name: "nonpositive fence rejected structurally",
    document: { ...reservation, logicalOperation: { ...operation, fence: 0 } },
    valid: false,
    applicationValid: false,
  },
];
cases.push(...identity.cases);

export const schemas = { ...V16_BUDGET_SCHEMAS, ...identity.schemas };
