import { CapabilitySchema } from "./commercial-records";
import { OperatingSchemas } from "./operating";
import { generatePlatformId } from "./ids";
import { partnerHumanSchema } from "./partners";
/** Local registration proposal only. No database, activation, implementation or grant. */
export function contactStrategyRegistration(actor: unknown, at: Date) {
  const human = partnerHumanSchema.parse(actor);
  const common = {
    createdAt: at,
    updatedAt: at,
    createdBy: human,
    updatedBy: human,
    archived: false,
    schemaVersion: 1,
  };
  const capability = CapabilitySchema.parse({
    ...common,
    id: generatePlatformId("capability"),
    name: "Contact Strategy",
    supportedScopeTypes: ["workspace"],
    dependencies: [],
  });
  const agentDefinition = OperatingSchemas.agent_definitions.parse({
    ...common,
    id: generatePlatformId("agentdefinition"),
    referenceVersion: 0,
    key: "contact_strategy",
    version: 1,
    status: "draft",
    availability: "internal",
    data: {
      name: "Contact Strategy Agent",
      description:
        "Foundation registration for future cross-proposition contact policy. No execution implementation or activation.",
      category: "contact_strategy",
      providesCapabilityIds: [capability.id],
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
  });
  return { capability, agentDefinition };
}
