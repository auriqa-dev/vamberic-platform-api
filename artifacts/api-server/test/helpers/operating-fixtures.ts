import type { Document } from "mongodb";
import { generatePlatformId } from "../../src/domain/ids";
import {
  OperatingSchemas,
  type OperatingResource,
} from "../../src/domain/operating";

export function operatingFixtures(): Record<OperatingResource, Document> {
  const at = new Date("2026-09-30T12:00:00.000Z");
  const human = {
    type: "human",
    issuer: "https://identity.example.test/pool",
    id: "synthetic-parity-human",
  };
  const common = {
    createdAt: at,
    updatedAt: at,
    createdBy: human,
    updatedBy: human,
    archived: false,
    schemaVersion: 1,
    referenceVersion: 0,
  };
  const workspaceId = generatePlatformId("workspace");
  const global = {
    ...common,
    key: "test_definition",
    version: 1,
    status: "draft",
    availability: "queens",
  };
  const workspace = { ...common, workspaceId, revision: 1, status: "draft" };
  const agent = {
    ...global,
    id: generatePlatformId("agentdefinition"),
    data: {
      name: "Synthetic specialist",
      description: "Test fixture, not executable agent software.",
      category: "research",
      providesCapabilityIds: [],
      requiresCapabilityIds: [],
      requiredAgents: [],
      recommendedAgents: [],
      hiveAccess: {
        readResources: [],
        proposeResources: [],
        approval: "human_only",
        scope: "workspace",
      },
      configurationFields: [],
      integrationRequirements: [],
      costDrivers: [],
    },
  };
  const provider = {
    ...global,
    id: generatePlatformId("integrationprovider"),
    data: {
      name: "Synthetic provider",
      description: "Fixture",
      category: "email",
      authentication: "external_account",
      operationalCapabilities: ["email_delivery"],
      customerOwnedAccount: "supported",
      guidance: "Fixture",
      costDrivers: [],
    },
  };
  const template = {
    ...global,
    id: generatePlatformId("swarmtemplate"),
    data: {
      name: "Synthetic job",
      description: "Fixture",
      job: "Generate qualified opportunities",
      requiredAgents: [],
      recommendedAgents: [],
      optionalAgents: [],
      integrationCapabilities: [],
      configurationGuidance: [],
      commercialAssumptions: [],
    },
  };
  const policy = {
    ...global,
    id: generatePlatformId("commercialpolicy"),
    data: {
      name: "Synthetic policy",
      description: "Fixture",
      currency: "GBP",
      targetMargin: 0.5,
      minimumMargin: 0.2,
      defaultOnboardingTreatment: "standard",
      annualDiscount: 0.1,
      maximumQueenDiscount: 0.1,
      maximumQueenFixedDiscountMinor: 10000,
      minimumMonthlyPriceMinor: 1000,
      allowCustomPrice: true,
      permittedQueenTreatments: [
        "standard",
        "internal",
        "waived",
        "promotional",
      ],
      usagePolicy: "Review",
      overagePolicy: "Review",
      serviceEffortAssumptions: [],
      internalTreatmentGuidance: "Explicit approval",
      promotionalTreatmentGuidance: "Explicit decision",
      effectiveFrom: "2026-01-01T00:00:00.000Z",
    },
  };
  const methodology = {
    ...global,
    id: generatePlatformId("methodologyavailability"),
    data: {
      name: "Synthetic governance",
      description: "Fixture",
      methodology: { id: generatePlatformId("offermethodology"), version: 1 },
      compatibleAgents: [],
    },
  };
  const instance = {
    ...workspace,
    id: generatePlatformId("clientagent"),
    data: {
      name: "Synthetic instance",
      definition: { id: agent.id, version: 1 },
      configuration: [],
      bindings: [],
      dependencyInstanceIds: [],
      capabilityInstanceIds: [],
    },
  };
  const swarm = {
    ...workspace,
    id: generatePlatformId("clientswarm"),
    data: {
      name: "Synthetic swarm",
      description: "Fixture",
      job: "Generate qualified opportunities",
      template: { id: template.id, version: 1 },
      agentInstanceIds: [instance.id],
      configuration: [],
      commercialNotes: [],
    },
  };
  const recommendation = {
    ...workspace,
    id: generatePlatformId("pricingrecommendation"),
    status: "recorded",
    data: {
      swarmId: swarm.id,
      policy: { id: policy.id, version: 1 },
      costInputs: [],
      expectedOperatingMonthlyMinor: 20000,
      recommendedOnboardingMinor: 0,
      recommendedMonthlyMinor: 100000,
      recommendedAnnualMinor: 1080000,
      assumptions: [],
      rationale: "Explicit synthetic recommendation",
      uncertainty: [],
      sourceReferences: [],
      configurationSnapshot: {
        swarmId: swarm.id,
        swarmRevision: 1,
        swarm: swarm.data,
        agents: [
          {
            id: instance.id,
            revision: 1,
            configuration: instance.data,
            definition: agent.data,
            bindings: [],
          },
        ],
        template: template.data,
      },
      policySnapshot: policy.data,
      monthlyMargin: 0.8,
      currency: "GBP",
    },
  };
  const agreement = {
    ...workspace,
    id: generatePlatformId("swarmagreement"),
    status: "proposed",
    data: {
      decision: {
        recommendationId: recommendation.id,
        treatment: "standard",
        adjustment: { kind: "accept" },
        reason: "Explicit synthetic decision",
        onboardingMinor: 0,
        commitment: { kind: "monthly", months: 1, renewal: "review" },
        billingFrequency: "monthly",
        effectiveFrom: "2026-10-01T00:00:00.000Z",
        usageAllowances: [],
        overageAssumptions: [],
        commercialNotes: [],
      },
      swarmId: swarm.id,
      recommendationSnapshot: recommendation.data,
      recommendedPeriodMinor: 100000,
      finalRecurringMinor: 100000,
      finalMonthlyEquivalentMinor: 100000,
      currency: "GBP",
      policyResult: "within_policy",
      policyReasons: [],
      decidedBy: human,
      decidedAt: at,
      externalReferenceIds: [],
    },
  };
  const rows = {
    agent_definitions: agent,
    integration_providers: provider,
    swarm_templates: template,
    commercial_policies: policy,
    methodology_availability: methodology,
    client_agents: instance,
    client_swarms: swarm,
    pricing_recommendations: recommendation,
    swarm_agreements: agreement,
  };
  return Object.fromEntries(
    Object.entries(rows).map(([key, row]) => [
      key,
      OperatingSchemas[key as OperatingResource].parse(row),
    ]),
  ) as Record<OperatingResource, Document>;
}
