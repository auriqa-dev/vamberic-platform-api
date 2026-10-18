import { OperatingSchemas } from "../../domain/operating";
import { generatePlatformId } from "../../domain";
/** Catalogue proposal only. Publication and website enablement are separate actions. */
export function interactionRegistration(actor: unknown, now = new Date()) {
  return OperatingSchemas.agent_definitions.parse({
    id: generatePlatformId("agentdefinition"),
    key: "website_interaction",
    version: 1,
    referenceVersion: 0,
    status: "draft",
    availability: "queens",
    schemaVersion: 1,
    archived: false,
    createdAt: now,
    updatedAt: now,
    createdBy: actor,
    updatedBy: actor,
    data: {
      name: "Website Interaction",
      description:
        "Client-bound website conversations and enquiries using explicitly permitted public knowledge and the approved Brand Kit. No outreach or workspace administration.",
      category: "marketing_operations",
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
  });
}
