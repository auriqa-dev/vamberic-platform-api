import { digest } from "@workspace/agent-runtime-protocol";
export const PSU_PRODUCTION_POLICY = Object.freeze({
  key: "psu_production_execution_v1",
  version: 1,
  currency: "USD",
  caseCalls: 16,
  caseAmount: "8",
  deadlineMs: 3600000,
  toolCalls: 0,
  concurrency: 1,
  failureRetries: 0,
  providerRetries: 0,
  providerTimeoutMs: 120000,
  reportMs: 10000,
  freshnessMs: 30000,
  maker: { calls: 6, amount: "1.20" },
  evaluator: { calls: 2, amount: "2" },
  revision: { calls: 2, amount: "0.40" },
});
export const PSU_PRODUCTION_POLICY_DIGEST = digest(PSU_PRODUCTION_POLICY);
export function productionCaseBudget(deadline: string) {
  return {
    deadline,
    modelCalls: 16,
    toolCalls: 0,
    providerCalls: [{ provider: "openai", calls: 16 }],
    cost: { currency: "USD", amount: "8" },
  };
}
export function productionRunBudget(
  role: "maker" | "evaluator" | "revision",
  deadline: string,
) {
  const envelope = PSU_PRODUCTION_POLICY[role];
  return {
    deadline,
    modelCalls: envelope.calls,
    toolCalls: 0,
    providerCalls: [{ provider: "openai", calls: envelope.calls }],
    cost: { currency: "USD", amount: envelope.amount },
  };
}
/** Forward operational release pin; the approved v1 monetary envelopes remain immutable. */
export const PSU_RECONCILIATION_POLICY_DIGEST = digest({
  key: "psu_production_execution_v2",
  version: 2,
  allocationPolicy: PSU_PRODUCTION_POLICY_DIGEST,
  operationalContract: "psu_execution_evidence_v1",
  schema: 23,
  evidenceWindowMs: 86400000,
  receiptBytes: 16384,
  metadataAttempts: 3,
  metadataWindowMs: 10000,
});

/** New immutable URL release envelope; existing monetary ceilings are retained. */
export function websiteCaseBudget(deadline: string) {
  return {
    ...productionCaseBudget(deadline),
    toolCalls: 6,
    providerCalls: [
      { provider: "openai", calls: 16 },
      { provider: "public_web", calls: 6 },
    ],
  };
}
export function websiteRunBudget(
  role: "maker" | "evaluator" | "revision",
  deadline: string,
) {
  const base = productionRunBudget(role, deadline);
  return role === "maker"
    ? {
        ...base,
        toolCalls: 6,
        providerCalls: [
          ...base.providerCalls,
          { provider: "public_web", calls: 6 },
        ],
      }
    : base;
}
