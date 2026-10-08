import { EffectivenessDefinitionSchema } from "./agent-effectiveness";
import { z } from "zod";
import {
  basePersistenceSchema,
  platformIdSchema,
  OrganisationSchema,
} from "./schemas";
import { partnerHumanSchema } from "./partners";
import { billingTreatmentSchema } from "./commercial-fields";
import type { PlatformIdPrefix } from "./ids";
const text = (max = 2000) => z.string().trim().min(1).max(max);
export const operatingKey = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
const texts = z.array(text()).max(40);
const ids = (p: PlatformIdPrefix) =>
  z
    .array(platformIdSchema(p))
    .max(40)
    .refine((v) => new Set(v).size === v.length, "Duplicate references");
const fraction = z.number().min(0).max(1);
const minor = z.number().int().safe().nonnegative();
export const OperatingMoneySchema = OrganisationSchema.shape.annualRevenue
  .unwrap()
  .omit({ observedAt: true });
export const VersionRefSchema = z
  .object({
    id: z.string().min(1).max(100),
    version: z.number().int().positive(),
  })
  .strict();
const ref = (p: PlatformIdPrefix) =>
  VersionRefSchema.extend({ id: platformIdSchema(p) }).strict();
const refs = (p: PlatformIdPrefix) =>
  z
    .array(ref(p))
    .max(40)
    .refine(
      (v) => new Set(v.map((r) => r.id)).size === v.length,
      "Duplicate references",
    );
export const ConfigFieldSchema = z
  .object({
    key: operatingKey,
    label: text(200),
    type: z.enum(["text", "number", "boolean", "choice"]),
    required: z.boolean(),
    choices: z.array(text(200)).max(30).default([]),
    guidance: text().optional(),
  })
  .strict();
export const ConfigValueSchema = z
  .object({
    key: operatingKey,
    text: text().optional(),
    number: z
      .number()
      .min(-Number.MAX_SAFE_INTEGER)
      .max(Number.MAX_SAFE_INTEGER)
      .optional(),
    boolean: z.boolean().optional(),
  })
  .strict()
  .refine(
    (v) =>
      [v.text, v.number, v.boolean].filter((x) => x !== undefined).length === 1,
    "Exactly one value required",
  );
export const ConfigurationSchema = z
  .array(ConfigValueSchema)
  .max(40)
  .refine(
    (v) => new Set(v.map((x) => x.key)).size === v.length,
    "Duplicate configuration key",
  );
const costDriver = z
  .object({
    key: operatingKey,
    name: text(200),
    unit: text(100),
    description: text(),
    expectedQuantity: z.number().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    unitCost: OperatingMoneySchema.optional(),
  })
  .strict();
const requirement = z
  .object({
    slot: operatingKey,
    operationalCapability: operatingKey,
    required: z.boolean(),
    minimumProviders: z.number().int().min(0).max(10),
    supportedProviderIds: ids("integrationprovider"),
  })
  .strict()
  .refine(
    (v) => !v.required || v.minimumProviders > 0,
    "Required slot needs a minimum provider",
  );
const base = basePersistenceSchema
  .omit({ workspaceId: true })
  .extend({
    referenceVersion: z.number().int().nonnegative().default(0),
    createdBy: partnerHumanSchema,
    updatedBy: partnerHumanSchema,
  })
  .strict();
const global = {
  key: operatingKey,
  version: z.number().int().positive(),
  status: z.enum(["draft", "active", "retired"]),
  availability: z.enum(["internal", "queens", "experimental"]),
};
export const AgentDefinitionDataV9 = z
  .object({
    name: text(200),
    description: text(),
    category: operatingKey,
    providesCapabilityIds: ids("capability"),
    requiresCapabilityIds: ids("capability"),
    requiredAgents: refs("agentdefinition"),
    recommendedAgents: refs("agentdefinition"),
    hiveAccess: z
      .object({
        readResources: z
          .array(
            z.enum([
              "brands",
              "brand_kits",
              "offerings",
              "ideal_customer_profiles",
              "buyer_profiles",
              "offer_designs",
              "offers",
              "people",
              "contact_points",
            ]),
          )
          .max(20),
        proposeResources: z
          .array(
            z.enum([
              "brands",
              "brand_kits",
              "offerings",
              "ideal_customer_profiles",
              "buyer_profiles",
              "offer_designs",
              "offers",
              "people",
              "contact_points",
            ]),
          )
          .max(20),
        approval: z.literal("human_only"),
        scope: z.literal("workspace"),
      })
      .strict(),
    configurationFields: z.array(ConfigFieldSchema).max(40),
    integrationRequirements: z.array(requirement).max(20),
    costDrivers: z.array(costDriver).max(40),
  })
  .strict();
// Metadata only: executable code and registry publication remain deployment controlled.
export const AgentDefinitionDataV10 = AgentDefinitionDataV9.extend({
  executionImplementation: z
    .object({
      key: operatingKey,
      version: z.number().int().min(1).max(1_000_000),
      manifestDigest: z.string().regex(/^[a-f0-9]{64}$/),
      protocolVersion: z.enum(["1.1", "1.2", "2.0"]),
    })
    .strict()
    .optional(),
});
export const AgentDefinitionData = AgentDefinitionDataV10.extend({
  effectiveness: z.array(EffectivenessDefinitionSchema).max(6).optional(),
});
export const IntegrationProviderData = z
  .object({
    name: text(200),
    description: text(),
    category: operatingKey,
    authentication: z.enum([
      "oauth",
      "api_key_reference",
      "external_account",
      "none",
    ]),
    operationalCapabilities: z.array(operatingKey).min(1).max(30),
    customerOwnedAccount: z.enum(["required", "supported", "unsupported"]),
    guidance: text(),
    documentationUrl: z.string().url().max(1000).optional(),
    costDrivers: z.array(costDriver).max(40),
  })
  .strict();
export const SwarmTemplateData = z
  .object({
    name: text(200),
    description: text(),
    job: text(),
    requiredAgents: refs("agentdefinition"),
    recommendedAgents: refs("agentdefinition"),
    optionalAgents: refs("agentdefinition"),
    integrationCapabilities: z.array(operatingKey).max(20),
    configurationGuidance: texts,
    commercialAssumptions: texts,
  })
  .strict();
export const CommercialPolicyData = z
  .object({
    name: text(200),
    description: text(),
    currency: OperatingMoneySchema.shape.currency,
    targetMargin: fraction,
    minimumMargin: fraction,
    defaultOnboardingTreatment: billingTreatmentSchema,
    annualDiscount: fraction,
    maximumQueenDiscount: fraction,
    maximumQueenFixedDiscountMinor: minor,
    minimumMonthlyPriceMinor: minor,
    allowCustomPrice: z.boolean(),
    permittedQueenTreatments: z.array(billingTreatmentSchema).min(1).max(5),
    usagePolicy: text(),
    overagePolicy: text(),
    serviceEffortAssumptions: texts,
    internalTreatmentGuidance: text(),
    promotionalTreatmentGuidance: text(),
    effectiveFrom: z.string().datetime(),
    effectiveUntil: z.string().datetime().optional(),
  })
  .strict()
  .superRefine((v, c) => {
    if (
      v.minimumMargin > v.targetMargin ||
      (v.effectiveUntil && v.effectiveUntil <= v.effectiveFrom)
    )
      c.addIssue({
        code: "custom",
        message: "Invalid policy margin or effective interval",
      });
  });
export const MethodologyAvailabilityData = z
  .object({
    name: text(200),
    description: text(),
    methodology: ref("offermethodology"),
    compatibleAgents: refs("agentdefinition"),
  })
  .strict();
export const BindingSchema = z
  .object({
    slot: operatingKey,
    integrationId: platformIdSchema("integration"),
    provider: ref("integrationprovider"),
    costTreatment: z.enum([
      "client_funded",
      "hvm_funded",
      "pass_through",
      "included_allowance",
    ]),
    expectedQuantity: z.number().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    unit: text(100).optional(),
    costAssumption: OperatingMoneySchema.optional(),
    allowance: z.number().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    overageAssumption: text().optional(),
  })
  .strict();
export const ClientAgentData = z
  .object({
    name: text(200),
    definition: ref("agentdefinition"),
    configuration: ConfigurationSchema,
    bindings: z.array(BindingSchema).max(40),
    dependencyInstanceIds: ids("clientagent"),
    capabilityInstanceIds: ids("capinstance"),
  })
  .strict();
export const ClientSwarmData = z
  .object({
    name: text(200),
    description: text(),
    job: text(),
    template: ref("swarmtemplate").optional(),
    agentInstanceIds: ids("clientagent"),
    configuration: ConfigurationSchema,
    commercialNotes: texts,
  })
  .strict();
const configurationSnapshot = z
  .object({
    swarmId: platformIdSchema("clientswarm"),
    swarmRevision: z.number().int().positive(),
    swarm: ClientSwarmData,
    agents: z
      .array(
        z
          .object({
            id: platformIdSchema("clientagent"),
            revision: z.number().int().positive(),
            configuration: ClientAgentData,
            definition: AgentDefinitionData,
            bindings: z
              .array(
                z
                  .object({
                    integrationId: platformIdSchema("integration"),
                    providerKey: operatingKey,
                    provider: IntegrationProviderData,
                  })
                  .strict(),
              )
              .max(40),
          })
          .strict(),
      )
      .max(40),
    template: SwarmTemplateData.optional(),
  })
  .strict();
export const RecommendationInput = z
  .object({
    swarmId: platformIdSchema("clientswarm"),
    policy: ref("commercialpolicy"),
    costInputs: z.array(costDriver).max(40),
    expectedOperatingMonthlyMinor: minor,
    recommendedOnboardingMinor: minor,
    recommendedMonthlyMinor: minor,
    recommendedAnnualMinor: minor,
    assumptions: texts,
    rationale: text(),
    uncertainty: texts,
    sourceReferences: z.array(text(1000)).max(30),
  })
  .strict();
export const RecommendationData = RecommendationInput.extend({
  configurationSnapshot,
  policySnapshot: CommercialPolicyData,
  monthlyMargin: z.number().min(-Number.MAX_SAFE_INTEGER).max(1).nullable(),
  currency: OperatingMoneySchema.shape.currency,
}).strict();
export const DecisionInput = z
  .object({
    recommendationId: platformIdSchema("pricingrecommendation"),
    treatment: billingTreatmentSchema,
    adjustment: z
      .object({
        kind: z.enum([
          "accept",
          "percentage_discount",
          "fixed_discount",
          "custom",
        ]),
        percentage: fraction.optional(),
        amountMinor: minor.optional(),
      })
      .strict(),
    reason: text(),
    onboardingMinor: minor,
    commitment: z
      .object({
        kind: z.enum(["monthly", "annual", "custom"]),
        months: z.number().int().min(1).max(120),
        renewal: z.enum(["none", "review", "renew"]),
      })
      .strict(),
    billingFrequency: z.enum(["monthly", "annual"]),
    effectiveFrom: z.string().datetime(),
    effectiveUntil: z.string().datetime().optional(),
    usageAllowances: texts,
    overageAssumptions: texts,
    commercialNotes: texts,
  })
  .strict()
  .superRefine((v, c) => {
    const a = v.adjustment;
    if (
      (a.kind === "percentage_discount") !== (a.percentage !== undefined) ||
      ["fixed_discount", "custom"].includes(a.kind) !==
        (a.amountMinor !== undefined) ||
      (v.commitment.kind === "monthly" && v.commitment.months !== 1) ||
      (v.commitment.kind === "annual" && v.commitment.months !== 12) ||
      (v.billingFrequency === "annual" && v.commitment.months < 12) ||
      (v.effectiveUntil && v.effectiveUntil <= v.effectiveFrom)
    )
      c.addIssue({
        code: "custom",
        message: "Inconsistent adjustment or term",
      });
  });
const agreementData = z
  .object({
    decision: DecisionInput,
    swarmId: platformIdSchema("clientswarm"),
    recommendationSnapshot: RecommendationData,
    recommendedPeriodMinor: minor,
    finalRecurringMinor: minor,
    finalMonthlyEquivalentMinor: minor,
    currency: OperatingMoneySchema.shape.currency,
    policyResult: z.enum([
      "within_policy",
      "requires_empress_approval",
      "approved_by_empress",
    ]),
    policyReasons: texts,
    decidedBy: partnerHumanSchema,
    decidedAt: z.date(),
    empressApproval: z
      .object({ actor: partnerHumanSchema, at: z.date(), reason: text() })
      .strict()
      .optional(),
    externalReferenceIds: ids("externalref").default([]),
  })
  .strict();
const record = (
  prefix: PlatformIdPrefix,
  data: z.ZodTypeAny,
  platform: boolean,
) =>
  base
    .extend({
      id: platformIdSchema(prefix),
      ...(platform
        ? global
        : {
            workspaceId: platformIdSchema("workspace"),
            revision: z.number().int().positive(),
            status:
              prefix === "pricingrecommendation"
                ? z.enum(["recorded", "superseded", "retired"])
                : prefix === "swarmagreement"
                  ? z.enum(["proposed", "approved", "superseded", "retired"])
                  : z.enum(["draft", "configured", "retired"]),
          }),
      data,
    })
    .strict();
export const OPERATING_PREFIXES = {
  agent_definitions: "agentdefinition",
  integration_providers: "integrationprovider",
  swarm_templates: "swarmtemplate",
  commercial_policies: "commercialpolicy",
  methodology_availability: "methodologyavailability",
  client_agents: "clientagent",
  client_swarms: "clientswarm",
  pricing_recommendations: "pricingrecommendation",
  swarm_agreements: "swarmagreement",
} as const;
export type OperatingResource = keyof typeof OPERATING_PREFIXES;
export const PLATFORM_OPERATING_RESOURCES = [
  "agent_definitions",
  "integration_providers",
  "swarm_templates",
  "commercial_policies",
  "methodology_availability",
] as const;
export const OperatingDataSchemas = {
  agent_definitions: AgentDefinitionData,
  integration_providers: IntegrationProviderData,
  swarm_templates: SwarmTemplateData,
  commercial_policies: CommercialPolicyData,
  methodology_availability: MethodologyAvailabilityData,
  client_agents: ClientAgentData,
  client_swarms: ClientSwarmData,
  pricing_recommendations: RecommendationData,
  swarm_agreements: agreementData,
};
export const OperatingRecordSchemas = Object.fromEntries(
  Object.entries(OperatingDataSchemas).map(([k, s]) => [
    k,
    record(
      OPERATING_PREFIXES[k as OperatingResource],
      s,
      (PLATFORM_OPERATING_RESOURCES as readonly string[]).includes(k),
    ),
  ]),
) as unknown as Record<OperatingResource, z.ZodObject<z.ZodRawShape>>;
// Frozen predecessor contracts for additive validator migration recognition.
const recommendationV9 = RecommendationData.extend({
  configurationSnapshot: configurationSnapshot.extend({
    agents: z
      .array(
        configurationSnapshot.shape.agents.element.extend({
          definition: AgentDefinitionDataV9,
        }),
      )
      .max(40),
  }),
});
export const OperatingRecordSchemasV9 = {
  ...OperatingRecordSchemas,
  agent_definitions: record("agentdefinition", AgentDefinitionDataV9, true),
  pricing_recommendations: record(
    "pricingrecommendation",
    recommendationV9,
    false,
  ),
  swarm_agreements: record(
    "swarmagreement",
    agreementData.extend({ recommendationSnapshot: recommendationV9 }),
    false,
  ),
};
const recommendationV10 = RecommendationData.extend({
  configurationSnapshot: configurationSnapshot.extend({
    agents: z
      .array(
        configurationSnapshot.shape.agents.element.extend({
          definition: AgentDefinitionDataV10,
        }),
      )
      .max(40),
  }),
});
export const OperatingRecordSchemasV10 = {
  ...OperatingRecordSchemas,
  agent_definitions: record("agentdefinition", AgentDefinitionDataV10, true),
  pricing_recommendations: record(
    "pricingrecommendation",
    recommendationV10,
    false,
  ),
  swarm_agreements: record(
    "swarmagreement",
    agreementData.extend({ recommendationSnapshot: recommendationV10 }),
    false,
  ),
};
export const OperatingSchemas = Object.fromEntries(
  Object.entries(OperatingRecordSchemas).map(([k, s]) => [
    k,
    s.superRefine((v, c) => {
      if (
        v.updatedAt < v.createdAt ||
        v.archived !== Boolean(v.archivedAt) ||
        (v.archivedAt &&
          (v.archivedAt < v.createdAt || v.archivedAt > v.updatedAt)) ||
        (v.status === "retired") !== v.archived
      )
        c.addIssue({ code: "custom", message: "Invalid lifecycle chronology" });
      if (Buffer.byteLength(JSON.stringify(v)) > 200000)
        c.addIssue({
          code: "custom",
          message: "Operating record exceeds 200KB",
        });
    }),
  ]),
) as unknown as Record<OperatingResource, z.ZodTypeAny>;
