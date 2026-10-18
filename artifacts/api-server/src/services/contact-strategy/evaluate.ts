import type { ContactStrategyPolicyV14 } from "../../domain/identity-value-v14";
import { strategyTemplate } from "./catalogue";
import { templateSource } from "./provision";
export function currentContactStrategies(policies: ContactStrategyPolicyV14[]) {
  const latest = new Map<string, ContactStrategyPolicyV14>();
  for (const p of [...policies].sort((a,b) => b.version - a.version))
    if (p.status !== "draft" && !latest.has(p.key)) latest.set(p.key, p);
  return [...latest.values()].filter(p => p.status === "recorded");
}
/** Internal admission contract, never accept these assessments from a public request.
 * The future NBA adapter must resolve current authoritative evidence for this exact
 * workspace, subject, proposition, channel and action before calling this function.
 */
export type PolicyContext = {
  workspaceId: string;
  evaluatedAt: Date;
  /** Identity of the proposed action, never a universal contact lifecycle. */
  target?: {
    personId?: string;
    organisationId?: string;
    productId?: string;
    offerId?: string;
    channel: string;
    purpose: "marketing" | "service";
    actionId: string;
    intent?: "acquisition" | "nurture" | "service";
    contactPointId?: string;
  };
  legal: "permitted" | "prohibited" | "unknown";
  suppression: "clear" | "suppressed" | "unknown";
  platform: "permitted" | "prohibited" | "unknown";
  assessments: Record<
    string,
    {
      policyId: string;
      version: number;
      applies: boolean;
      effect: "permitted" | "prohibited" | "deferred" | "escalated";
      reason: string;
      evidenceIds: string[];
    }
  >;
};
/** Restrictions win. Missing assessments cannot be converted into permission by
 * an optional template or model suggestion. No execution or consent mutations.
 */
export function evaluateContactStrategies(
  policies: ContactStrategyPolicyV14[],
  context: PolicyContext,
) {
  if (policies.some((p) => p.workspaceId !== context.workspaceId))
    throw new Error("Workspace mismatch");
  const trace: {
    policyId: string;
    version: number;
    effect: string;
    reason: string;
    evidenceIds: string[];
  }[] = [];
  let prohibited =
    context.legal === "prohibited" ||
    context.suppression === "suppressed" ||
    context.platform === "prohibited";
  let deferred =
      context.legal === "unknown" ||
      context.suppression === "unknown" ||
      context.platform === "unknown",
    escalated = false;
  for (const policy of currentContactStrategies(policies)) {
    const key = policy.key;
    let supported = /^custom_[0-9a-f]{32}$/.test(key) &&
      policy.source.reference === templateSource(key, 1);
    try {
      const t = strategyTemplate(key);
      supported = policy.source.reference === templateSource(t.id, t.version);
    } catch {
      /* Legacy policies also require explicit assessment. */
    }
    const result = context.assessments[policy.id];
    if (
      !supported ||
      !result ||
      result.policyId !== policy.id ||
      result.version !== policy.version ||
      !result.reason.trim() ||
      !result.evidenceIds.length
    ) {
      deferred = true;
      trace.push({
        policyId: policy.id,
        version: policy.version,
        effect: "deferred",
        reason: "Current policy assessment and authoritative evidence required",
        evidenceIds: [],
      });
      continue;
    }
    const effect = result.applies ? result.effect : "not_applicable";
    prohibited ||= effect === "prohibited";
    deferred ||= effect === "deferred";
    escalated ||= effect === "escalated";
    trace.push({
      policyId: policy.id,
      version: policy.version,
      effect,
      reason: result.reason,
      evidenceIds: result.evidenceIds,
    });
  }
  return {
    workspaceId: context.workspaceId,
    evaluatedAt: context.evaluatedAt,
    effect: prohibited
      ? "prohibited"
      : escalated
        ? "escalated"
        : deferred
          ? "deferred"
          : "permitted",
    trace,
    target: context.target,
    guards: {
      legal: context.legal,
      suppression: context.suppression,
      platform: context.platform,
    },
    executionAuthorised: false as const,
  };
}
