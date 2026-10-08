import { z } from "zod";
import {
  digest,
  PRODUCT_WEBSITE_MANIFEST,
  RuntimeImplementationManifestSchema,
} from "@workspace/agent-runtime-protocol";
import type { AppConfig } from "../config";
import type { AuthenticatedUser } from "../middlewares/auth";
import type { MongoService } from "./mongo";
import { platformIdSchema } from "../domain/schemas";
import { OperatingSchemas } from "../domain/operating";
import { WorkspaceAgentTarget } from "../domain/agent-operator";
import { resolveHvmContext, withoutMongoId } from "./hvm-context";
import {
  requireAgentControlPlane,
  AgentControlPlaneUnavailable,
} from "./agent-operators";
import {
  unavailableAgentCapabilities,
  type AgentCapabilityProvider,
} from "./agent-execution-readiness";
/** Safe catalogue projection. A listed target is not execution authorization. */
export async function psuAppOptions(
  config: AppConfig,
  mongo: MongoService,
  identity: AuthenticatedUser,
  workspaceValue: unknown,
  capabilities: AgentCapabilityProvider = unavailableAgentCapabilities,
) {
  const workspaceId = platformIdSchema("workspace").parse(workspaceValue);
  const db = await mongo.database();
  await requireAgentControlPlane(db);
  const ledger = await db
    .collection("schema_versions")
    .findOne({ _id: "vapp-v1" } as never);
  if (![16, 17, 18, 19, 20, 21, 22, 23, 24, 25].includes(ledger?.version ?? 0))
    throw new AgentControlPlaneUnavailable(
      "Workspace PSU requires qualified schema 16, 17 or 18",
    );
  const resolved = await resolveHvmContext(db, config, identity);
  resolved.authority.scopeFilter(resolved.context, "read", {
    type: "crm_workspaces",
    workspaceId,
  });
  const rows = await db
    .collection("agent_definitions")
    .find({
      status: "active",
      availability: "queens",
      archived: { $ne: true },
      "data.executionImplementation.key": "product_service_understanding",
    })
    .sort({ id: 1 })
    .limit(101)
    .toArray();
  if (rows.length > 100) throw new Error("PSU catalogue exceeds bound");
  const items = [];
  for (const row of rows) {
    const definition = OperatingSchemas.agent_definitions.parse(
      withoutMongoId(row),
    );
    const binding = definition.data.executionImplementation!;
    const raw = await capabilities.manifest(
      binding.key,
      binding.version,
      binding.manifestDigest,
    );
    if (!raw) continue;
    const manifest = RuntimeImplementationManifestSchema.parse(raw);
    if (
      manifest.manifestDigest !== binding.manifestDigest ||
      manifest.implementation.key !== binding.key ||
      manifest.implementation.version !== binding.version ||
      binding.protocolVersion !== "2.0" ||
      !(manifest.protocolVersions as readonly string[]).includes("2.0") ||
      !manifest.compatibleDefinitions.some(
        (d) => d.key === definition.key && d.version === definition.version,
      )
    )
      continue;
    const roles = capabilities.reasoningOperations?.(manifest) ?? [];
    for (const profile of definition.data.effectiveness ?? []) {
      if (
        ![profile.maker, profile.evaluator, profile.revision].every((o) =>
          roles.includes(o),
        )
      )
        continue;
      const tuple = {
        kind: "workspace_agent" as const,
        workspaceId,
        definition: {
          id: definition.id,
          key: definition.key,
          version: definition.version,
        },
        implementation: {
          ...manifest.implementation,
          manifestDigest: manifest.manifestDigest,
          buildDigest: manifest.buildDigest,
        },
      };
      const target = WorkspaceAgentTarget.parse({
        ...tuple,
        id: digest(tuple),
        revision: definition.version,
      });
      if (
        !resolved.authority.authorizeAgentOperation(
          resolved.context,
          { workspaceId, target, operation: profile.maker, action: "request" },
          new Date(),
        )
      )
        continue;
      const executionState = await capabilities.availabilityState?.(
        manifest,
        profile.maker,
      );
      items.push({
        name: definition.data.name,
        ...(manifest.manifestDigest === PRODUCT_WEBSITE_MANIFEST.manifestDigest
          ? { inputMode: "public_url" as const }
          : {}),
        target,
        operation: profile.maker,
        profile,
        ...(executionState ? { executionState } : {}),
        executionAvailable: executionState
          ? executionState === "idle"
          : await capabilities.available(manifest, profile.maker),
      });
    }
  }
  return { workspaceId, items };
}
// Keep malformed queries at the human HTTP boundary, not in a permissive catalogue.
export const PsuOptionsQuery = z.object({}).strict();
