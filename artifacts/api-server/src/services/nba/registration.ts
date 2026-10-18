import { NBA_FOUNDATION_MANIFEST } from "@workspace/agent-runtime-protocol";
import { OperatingSchemas } from "../../domain/operating";
import { generatePlatformId } from "../../domain";
/** Proposal for the existing Empress publication path. Creating this object does
 * not publish a definition, grant operator access or activate a campaign. */
export function nbaRegistration(actor: unknown, now = new Date()) {
  return OperatingSchemas.agent_definitions.parse({
    id: generatePlatformId("agentdefinition"),
    key: "next_best_action",
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
      name: "Next Best Action",
      description:
        "Review-led NBA decisions, durable reconsideration and existing-Hive research handoffs. No outreach.",
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
      executionImplementation: {
        ...NBA_FOUNDATION_MANIFEST.implementation,
        manifestDigest: NBA_FOUNDATION_MANIFEST.manifestDigest,
        protocolVersion: "2.0",
      },
    },
  });
}
