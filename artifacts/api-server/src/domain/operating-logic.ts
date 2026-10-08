import type { Document } from "mongodb";
import {
  ConfigFieldSchema,
  ConfigurationSchema,
  DecisionInput,
  RecommendationData,
} from "./operating";
import { z } from "zod";
export function configurationIssues(
  fields: z.infer<typeof ConfigFieldSchema>[],
  raw: unknown,
): string[] {
  const values = ConfigurationSchema.parse(raw);
  const issues: string[] = [];
  for (const v of values) {
    const f = fields.find((f) => f.key === v.key);
    if (!f) {
      issues.push(`unknown_configuration:${v.key}`);
      continue;
    }
    if (
      (f.type === "number" && v.number === undefined) ||
      (f.type === "boolean" && v.boolean === undefined) ||
      (["text", "choice"].includes(f.type) && v.text === undefined) ||
      (f.type === "choice" && !f.choices.includes(v.text!))
    )
      issues.push(`invalid_configuration:${v.key}`);
  }
  for (const f of fields)
    if (f.required && !values.some((v) => v.key === f.key))
      issues.push(`missing_configuration:${f.key}`);
  return issues;
}
export interface OperatingReadinessModel {
  swarm: Document;
  agents: Document[];
  definitions: Document[];
  providers: Document[];
  integrations: Document[];
  capabilityInstances: Document[];
  template?: Document;
  allowInternal: boolean;
}
export function evaluateSwarmReadiness(m: OperatingReadinessModel) {
  const issues: string[] = [];
  const ws = m.swarm.workspaceId;
  const selected = m.agents.filter((a) =>
    m.swarm.data.agentInstanceIds.includes(a.id),
  );
  if (!m.swarm.data.agentInstanceIds.length) issues.push("no_agents");
  for (const id of m.swarm.data.agentInstanceIds)
    if (
      !selected.some((a) => a.id === id && a.workspaceId === ws && !a.archived)
    )
      issues.push(`missing_agent:${id}`);
  if (m.template) {
    if (
      m.template.status !== "active" ||
      (m.template.availability !== "queens" && !m.allowInternal)
    )
      issues.push("template_unavailable");
    for (const r of m.template.data.requiredAgents)
      if (
        !selected.some(
          (a) =>
            a.data.definition.id === r.id &&
            a.data.definition.version === r.version,
        )
      )
        issues.push(`required_agent:${r.id}`);
  }
  const edges = new Map<string, string[]>();
  for (const a of selected) {
    if (a.workspaceId !== ws || a.archived || a.status !== "configured") {
      issues.push(`agent_not_configured:${a.id}`);
      continue;
    }
    const d = m.definitions.find(
      (d) =>
        d.id === a.data.definition.id &&
        d.version === a.data.definition.version,
    );
    if (
      !d ||
      d.status !== "active" ||
      (d.availability !== "queens" && !m.allowInternal)
    ) {
      issues.push(`definition_unavailable:${a.id}`);
      continue;
    }
    issues.push(
      ...configurationIssues(
        d.data.configurationFields,
        a.data.configuration,
      ).map((i) => `${a.id}:${i}`),
    );
    edges.set(a.id, a.data.dependencyInstanceIds);
    for (const id of a.data.dependencyInstanceIds)
      if (!selected.some((x) => x.id === id && x.workspaceId === ws))
        issues.push(`dependency_missing:${id}`);
    for (const r of d.data.requiredAgents)
      if (
        !selected.some(
          (x) =>
            a.data.dependencyInstanceIds.includes(x.id) &&
            x.data.definition.id === r.id &&
            x.data.definition.version === r.version &&
            x.status === "configured",
        )
      )
        issues.push(`required_dependency:${r.id}`);
    for (const id of d.data.requiresCapabilityIds)
      if (
        !m.capabilityInstances.some(
          (c) =>
            a.data.capabilityInstanceIds.includes(c.id) &&
            c.workspaceId === ws &&
            c.capabilityId === id &&
            c.status === "enabled" &&
            !c.archived,
        )
      )
        issues.push(`required_capability:${id}`);
    const seen = new Set<string>();
    for (const b of a.data.bindings) {
      const unique = b.slot + ":" + b.integrationId;
      if (seen.has(unique)) issues.push(`duplicate_binding:${b.slot}`);
      seen.add(unique);
      const slot = d.data.integrationRequirements.find(
        (s: Document) => s.slot === b.slot,
      );
      const p = m.providers.find(
        (p) => p.id === b.provider.id && p.version === b.provider.version,
      );
      const connection = m.integrations.find(
        (i) => i.id === b.integrationId && i.workspaceId === ws,
      );
      if (
        !slot ||
        !p ||
        !slot.supportedProviderIds.includes(p.id) ||
        !p.data.operationalCapabilities.includes(slot.operationalCapability)
      )
        issues.push(`incompatible_provider:${b.slot}`);
      if (
        !p ||
        p.status !== "active" ||
        (p.availability !== "queens" && !m.allowInternal)
      )
        issues.push(`provider_unavailable:${b.slot}`);
      if (
        !connection ||
        connection.archived ||
        connection.status !== "connected" ||
        connection.provider !== p?.key
      )
        issues.push(`connection_not_ready:${b.integrationId}`);
    }
    for (const slot of d.data.integrationRequirements)
      if (
        slot.required &&
        a.data.bindings.filter((b: Document) => b.slot === slot.slot).length <
          slot.minimumProviders
      )
        issues.push(`integration_required:${slot.slot}`);
  }
  if (m.template)
    for (const capability of m.template.data.integrationCapabilities)
      if (
        !selected.some((a) =>
          a.data.bindings.some((b: Document) => {
            const p = m.providers.find((p) => p.id === b.provider.id);
            return p?.data.operationalCapabilities.includes(capability);
          }),
        )
      )
        issues.push(`template_integration:${capability}`);
  const visiting = new Set<string>(),
    done = new Set<string>();
  function visit(id: string) {
    if (visiting.has(id)) {
      issues.push("dependency_cycle");
      return;
    }
    if (done.has(id)) return;
    visiting.add(id);
    for (const next of edges.get(id) ?? []) visit(next);
    visiting.delete(id);
    done.add(id);
  }
  for (const id of edges.keys()) visit(id);
  return { ready: issues.length === 0, issues: [...new Set(issues)].sort() };
}
function amount(n: number) {
  if (!Number.isSafeInteger(n) || n < 0)
    throw new Error("Invalid derived commercial amount");
  return n;
}
export function evaluateCommercialDecision(
  raw: unknown,
  recommendation: unknown,
) {
  const d = DecisionInput.parse(raw),
    r = RecommendationData.parse(recommendation),
    p = r.policySnapshot;
  const monthly =
    d.commitment.kind === "annual"
      ? Math.round(r.recommendedAnnualMinor / 12)
      : r.recommendedMonthlyMinor;
  const base =
    d.billingFrequency === "annual" ? r.recommendedAnnualMinor : monthly;
  let final = base;
  if (d.adjustment.kind === "percentage_discount")
    final = Math.round(base * (1 - d.adjustment.percentage!));
  if (d.adjustment.kind === "fixed_discount")
    final = base - d.adjustment.amountMinor!;
  if (d.adjustment.kind === "custom") final = d.adjustment.amountMinor!;
  if (["internal", "waived"].includes(d.treatment)) {
    final = 0;
    if (d.onboardingMinor !== 0)
      throw new Error("Exempt treatment requires zero onboarding amount");
  }
  amount(final);
  const equivalent = amount(
    d.billingFrequency === "annual" ? Math.round(final / 12) : final,
  );
  const reasons: string[] = [];
  if (!p.permittedQueenTreatments.includes(d.treatment))
    reasons.push("treatment_authority");
  if (d.adjustment.kind === "custom" && !p.allowCustomPrice)
    reasons.push("custom_price_authority");
  const discount = base - final;
  if (
    discount > 0 &&
    ((base > 0 && discount / base > p.maximumQueenDiscount) ||
      (d.adjustment.kind === "fixed_discount" &&
        discount > p.maximumQueenFixedDiscountMinor))
  )
    reasons.push("discount_authority");
  if (equivalent < p.minimumMonthlyPriceMinor) reasons.push("minimum_price");
  if (
    equivalent === 0
      ? r.expectedOperatingMonthlyMinor > 0
      : (equivalent - r.expectedOperatingMonthlyMinor) / equivalent <
        p.minimumMargin
  )
    reasons.push("minimum_margin");
  if (d.onboardingMinor < r.recommendedOnboardingMinor)
    reasons.push("onboarding_adjustment");
  return {
    recommendedPeriodMinor: base,
    finalRecurringMinor: final,
    finalMonthlyEquivalentMinor: equivalent,
    currency: r.currency,
    policyResult: reasons.length
      ? ("requires_empress_approval" as const)
      : ("within_policy" as const),
    policyReasons: reasons,
  };
}
