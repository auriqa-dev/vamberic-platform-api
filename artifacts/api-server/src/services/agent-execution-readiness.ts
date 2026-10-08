import {
  projectReasoningConfiguration,
  type ConfigurationSelection,
} from "./reasoning-configuration";
import type { z } from "zod";
import { readOperatingTarget } from "./agent-operators";
import type { AgentTarget } from "../domain/agent-operator";
import { CapabilityInstanceSchema } from "../domain/commercial-records";
import type { ClientSession, Db, Document } from "mongodb";
import {
  RuntimeImplementationManifestSchema as ImplementationManifestSchema,
  digest,
  RESULT_SCHEMA_VERSION,
  type RuntimeImplementationManifest as ImplementationManifest,
} from "@workspace/agent-runtime-protocol";
import { OperatingSchemas } from "../domain/operating";
import { WorkspaceIntegrationSchema } from "../domain/workspace-integrations";
import { configurationIssues } from "../domain/operating-logic";
import type { FrozenAgentWork } from "../domain/agent-control-plane";
import type { AgentOperationCatalogue } from "./agent-operators";
import type { AgentExecutionPolicy } from "./agent-control-plane";
import type { AuthorityAnchor } from "./agent-authority-serialization";
import { withoutMongoId } from "./hvm-context";

/** Trusted deployment metadata, not a user registration/upload endpoint. */
export interface AgentCapabilityProvider {
  availabilityState?(
    manifest: ImplementationManifest,
    operation: string,
  ): Promise<"idle" | "busy" | "unavailable">;
  /** Serialize persisted operational readiness with admission/claim. */
  admission?(
    db: Db,
    session: ClientSession,
    manifest: ImplementationManifest,
    operation: string,
  ): Promise<boolean>;
  /** Narrow trusted lease-continuation check; never used for admission/claim. */
  continuing?(
    manifest: ImplementationManifest,
    operation: string,
  ): Promise<boolean>;
  mergeReasoningConfiguration?(
    manifest: ImplementationManifest,
    defaults: import("@workspace/agent-runtime-protocol").Json,
    configuration: import("@workspace/agent-runtime-protocol").Json,
  ): import("@workspace/agent-runtime-protocol").Json;
  /** Code-owned classification for bounded non-channel tools only. Paid reads
   * and external mutations must use channel authority/budgets and return false. */
  reasoningToolAllowed?(
    manifest: ImplementationManifest,
    operation: string,
    tool: import("@workspace/agent-runtime-protocol").ToolGrant,
  ): boolean;
  reasoningOperations?(manifest: ImplementationManifest): readonly string[];
  reasoningConfiguration?(
    manifest: ImplementationManifest,
  ): import("@workspace/agent-runtime-protocol").Json;
  manifest(
    key: string,
    version: number,
    digest: string,
  ): Promise<ImplementationManifest | undefined>;
  available(
    manifest: ImplementationManifest,
    operation: string,
  ): Promise<boolean>;
}
export interface WorkspaceExecutionPolicy {
  /** Reuse current workspace configuration-read authorization; omission denies overlays. */
  configurationReadAllowed?(
    db: Db,
    run: import("../domain/agent-control-plane").AgentRun,
    session: ClientSession,
  ): Promise<boolean>;
  /** Explicit server-owned approval; paid agreements alone never enable execution. */
  allowed(
    db: Db,
    workspaceId: string,
    work: FrozenAgentWork,
    session: ClientSession,
  ): Promise<boolean>;
  /** Every persisted input read by allowed must be declared here. */
  dependencies(
    db: Db,
    workspaceId: string,
    session: ClientSession,
  ): Promise<readonly AuthorityAnchor[]>;
  allowInternal: boolean;
}
export const unavailableAgentCapabilities: AgentCapabilityProvider = {
  async manifest() {
    return undefined;
  },
  async available() {
    return false;
  },
};
export const disabledWorkspaceExecution: WorkspaceExecutionPolicy = {
  async allowed() {
    return false;
  },
  async dependencies() {
    return [];
  },
  allowInternal: false,
};

/** Configuration readiness is necessary but never establishes runtime capacity.
 * Only safe reason codes leave this service; integration credentials never do. */
export function createAgentExecutionReadiness(
  capabilities: AgentCapabilityProvider = unavailableAgentCapabilities,
  execution: WorkspaceExecutionPolicy = disabledWorkspaceExecution,
) {
  async function inspect(
    db: Db,
    workspaceId: string,
    target: AgentTarget,
    session?: ClientSession,
    overlay?: ConfigurationSelection,
  ) {
    const reasons: string[] = [];
    const dependencies: AuthorityAnchor[] = [];
    const options = { session };
    if (target.kind === "workspace_agent") {
      const definition = await readOperatingTarget(
        db,
        workspaceId,
        target,
        session,
      );
      if (!("executionImplementation" in definition.data))
        return {
          reasons: ["definition_unavailable"],
          dependencies,
          agent: undefined,
        };
      dependencies.push({
        collection: "agent_definitions",
        id: target.definition.id,
      });
      const implementation = target.implementation;
      const candidate = await capabilities.manifest(
        implementation.key,
        implementation.version,
        implementation.manifestDigest,
      );
      const parsed =
        candidate && ImplementationManifestSchema.safeParse(candidate);
      if (
        !parsed?.success ||
        parsed.data.manifestDigest !== implementation.manifestDigest ||
        parsed.data.buildDigest !== implementation.buildDigest ||
        digest(parsed.data.implementation) !==
          digest({
            key: implementation.key,
            version: implementation.version,
          }) ||
        !(parsed.data.protocolVersions as readonly string[]).includes("2.0") ||
        !parsed.data.compatibleDefinitions.some(
          (d) =>
            d.key === target.definition.key &&
            d.version === target.definition.version,
        ) ||
        definition.data.executionImplementation?.protocolVersion !== "2.0"
      )
        return {
          reasons: ["implementation_unavailable"],
          dependencies,
          agent: undefined,
        };
      const manifest = parsed.data;
      const operations = capabilities.reasoningOperations?.(manifest);
      if (
        !operations?.length ||
        operations.some((o) => !manifest.operations.includes(o))
      )
        return {
          reasons: ["reasoning_policy_unavailable"],
          dependencies,
          agent: undefined,
        };
      const defaults = capabilities.reasoningConfiguration?.(manifest) ?? {};
      let configuration: import("@workspace/agent-runtime-protocol").Json =
        defaults;
      if (overlay) {
        if (!capabilities.mergeReasoningConfiguration)
          throw new Error("Configuration overlay policy unavailable");
        const record = await db
          .collection("client_agents")
          .findOne({ id: overlay.id, workspaceId }, { session });
        const projected = projectReasoningConfiguration({
          target,
          defaults,
          selection: overlay,
          record,
          authorized: true,
          merge: (d, c) =>
            capabilities.mergeReasoningConfiguration!(manifest, d, c),
        });
        configuration = projected.configuration;
        dependencies.push(...projected.dependencies);
      }
      return {
        reasons,
        dependencies,
        definition: definition as z.infer<
          typeof OperatingSchemas.agent_definitions
        >,
        manifest,
        agent: undefined,
        reasoningOperations: operations,
        configuration,
      };
    }
    if (target.kind !== "client_agent")
      return { reasons: ["swarm_execution_unavailable"], dependencies };
    const raw = await db
      .collection("client_agents")
      .findOne({ id: target.id, workspaceId }, options);
    const agent =
      raw && OperatingSchemas.client_agents.safeParse(withoutMongoId(raw));
    if (
      !agent?.success ||
      agent.data.status !== "configured" ||
      agent.data.archived ||
      agent.data.revision !== target.revision
    )
      return { reasons: ["agent_not_configured"], dependencies };
    const data = agent.data.data;
    const row = await db
      .collection("agent_definitions")
      .findOne(
        { id: data.definition.id, version: data.definition.version },
        options,
      );
    const parsed =
      row && OperatingSchemas.agent_definitions.safeParse(withoutMongoId(row));
    if (!parsed?.success)
      return { reasons: ["definition_unavailable"], dependencies };
    const definition = parsed.data;
    dependencies.push({ collection: "agent_definitions", id: definition.id });
    if (
      definition.archived ||
      definition.status !== "active" ||
      (definition.availability !== "queens" && !execution.allowInternal)
    )
      reasons.push("definition_unavailable");
    if (
      configurationIssues(
        definition.data.configurationFields,
        data.configuration,
      ).length
    )
      reasons.push("configuration_invalid");
    for (const id of data.dependencyInstanceIds) {
      dependencies.push({ collection: "client_agents", id });
      const dependency = await db
        .collection("client_agents")
        .findOne(
          { id, workspaceId, status: "configured", archived: { $ne: true } },
          options,
        );
      if (!dependency) reasons.push("dependency_unavailable");
    }
    for (const required of definition.data.requiredAgents) {
      const found = await db.collection("client_agents").findOne(
        {
          id: { $in: data.dependencyInstanceIds },
          workspaceId,
          "data.definition.id": required.id,
          "data.definition.version": required.version,
          status: "configured",
          archived: { $ne: true },
        },
        options,
      );
      if (!found) reasons.push("required_dependency_unavailable");
    }
    // Reuse the operating layer's explicit enabled capability-instance prerequisite.
    // It is necessary configuration, never an execution or commercial entitlement.
    for (const capabilityId of definition.data.requiresCapabilityIds) {
      const rows = await db
        .collection("capability_instances")
        .find(
          {
            id: { $in: data.capabilityInstanceIds },
            workspaceId,
            capabilityId,
            status: "enabled",
            archived: { $ne: true },
          },
          options,
        )
        .limit(101)
        .toArray();
      const instance = rows.find(
        (row) =>
          CapabilityInstanceSchema.safeParse(withoutMongoId(row)).success,
      );
      if (!instance || rows.length > 100)
        reasons.push("required_capability_unavailable");
      else
        dependencies.push({
          collection: "capability_instances",
          id: instance.id,
        });
    }
    for (const binding of data.bindings) {
      dependencies.push(
        { collection: "workspace_integrations", id: binding.integrationId },
        { collection: "integration_providers", id: binding.provider.id },
      );
      const integration = await db
        .collection("workspace_integrations")
        .findOne({ id: binding.integrationId, workspaceId }, options);
      const connection =
        integration &&
        WorkspaceIntegrationSchema.safeParse(withoutMongoId(integration));
      const providerRow = await db
        .collection("integration_providers")
        .findOne(
          { id: binding.provider.id, version: binding.provider.version },
          options,
        );
      const provider =
        providerRow &&
        OperatingSchemas.integration_providers.safeParse(
          withoutMongoId(providerRow),
        );
      const slot = definition.data.integrationRequirements.find(
        (r: Document) => r.slot === binding.slot,
      );
      if (
        !connection?.success ||
        connection.data.archived ||
        connection.data.status !== "connected" ||
        !provider?.success ||
        provider.data.archived ||
        provider.data.status !== "active" ||
        (provider.data.availability !== "queens" && !execution.allowInternal) ||
        connection.data.provider !== provider.data.key ||
        !slot ||
        !slot.supportedProviderIds.includes(provider.data.id) ||
        !provider.data.data.operationalCapabilities.includes(
          slot.operationalCapability,
        )
      )
        reasons.push("binding_unavailable");
    }
    for (const slot of definition.data.integrationRequirements) {
      const count = data.bindings.filter(
        (b: Document) => b.slot === slot.slot,
      ).length;
      if (slot.required && count < slot.minimumProviders)
        reasons.push("binding_cardinality_invalid");
    }
    const implementation = definition.data.executionImplementation;
    if (!implementation)
      return {
        reasons: [...reasons, "implementation_unconfigured"],
        dependencies,
      };
    if (implementation.protocolVersion === "1.2") {
      const ledger = await db
        .collection<{ _id: string; version: number }>("schema_versions")
        .findOne({ _id: "vapp-v1" }, { session });
      if (
        ![12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25].includes(
          ledger?.version ?? 0,
        )
      )
        return {
          reasons: [...reasons, "protocol_schema_upgrade_required"],
          dependencies,
        };
    }
    const candidate = await capabilities.manifest(
      implementation.key,
      implementation.version,
      implementation.manifestDigest,
    );
    const manifest =
      candidate && ImplementationManifestSchema.safeParse(candidate);
    if (
      !manifest?.success ||
      manifest.data.manifestDigest !== implementation.manifestDigest ||
      manifest.data.implementation.key !== implementation.key ||
      manifest.data.implementation.version !== implementation.version ||
      !manifest.data.protocolVersions.includes(
        implementation.protocolVersion,
      ) ||
      !manifest.data.resultSchemaVersions.includes(RESULT_SCHEMA_VERSION) ||
      !manifest.data.compatibleDefinitions.some(
        (d) => d.key === definition.key && d.version === definition.version,
      )
    )
      return {
        reasons: [...reasons, "implementation_unavailable"],
        dependencies,
      };
    return {
      reasons,
      dependencies,
      manifest: manifest.data,
      agent: agent.data,
      definition,
    };
  }
  const catalogue: AgentOperationCatalogue = {
    async operations(db, workspaceId, target, session) {
      const state = await inspect(db, workspaceId, target, session);
      return state.reasons.length
        ? []
        : (state.reasoningOperations ?? state.manifest?.operations ?? []);
    },
  };
  const policy: AgentExecutionPolicy = {
    async dependencies(db, run, session) {
      const state = await inspect(
        db,
        run.workspaceId,
        run.target,
        session,
        run.frozen.protocolVersion === "2.0"
          ? run.frozen.configurationOverlay
          : undefined,
      );
      return [
        ...state.dependencies,
        ...(await execution.dependencies(db, run.workspaceId, session)),
      ];
    },
    async current(db, run, session) {
      const state = await inspect(
        db,
        run.workspaceId,
        run.target,
        session,
        run.frozen.protocolVersion === "2.0"
          ? run.frozen.configurationOverlay
          : undefined,
      );
      if (run.frozen.protocolVersion === "2.0") {
        if (
          run.frozen.configurationOverlay &&
          (await execution.configurationReadAllowed?.(db, run, session)) !==
            true
        )
          return false;
        if (
          state.reasons.length ||
          !state.manifest ||
          !state.definition ||
          !state.reasoningOperations?.includes(run.operation) ||
          digest(state.configuration) !== digest(run.frozen.configuration) ||
          digest(state.manifest) !== digest(run.manifest) ||
          run.target.kind !== "workspace_agent" ||
          digest(run.frozen.executionTarget) !== run.target.id
        )
          return false;
        if (
          run.frozen.grant.bindings.length ||
          run.frozen.grant.tools.some(
            (tool) =>
              tool.class !== "read_only" ||
              capabilities.reasoningToolAllowed?.(
                state.manifest!,
                run.operation,
                tool,
              ) !== true,
          )
        )
          return false; // Channel execution remains unavailable.
        if (
          run.frozen.grant.resources.some(
            (g) =>
              !(
                run.effectiveness &&
                g.reference.resourceType === "agent_result_projection"
              ) &&
              !state.definition!.data.hiveAccess.readResources.includes(
                g.reference.resourceType,
              ),
          )
        )
          return false;
        if (
          run.frozen.grant.proposalTargets.some(
            (g) =>
              !state.definition!.data.hiveAccess.proposeResources.includes(
                g.kind === "update" ? g.reference.resourceType : g.targetKind,
              ),
          )
        )
          return false;
        const profiles = state.definition.data.effectiveness ?? [];
        const profile = profiles.find(
          (p: { maker: string; evaluator: string; revision: string }) =>
            [p.maker, p.evaluator, p.revision].includes(run.operation),
        );
        if (Boolean(profile) !== Boolean(run.effectiveness)) return false;
        return (
          (await execution.allowed(db, run.workspaceId, run.frozen, session)) &&
          (run.status === "running" && capabilities.continuing
            ? await capabilities.continuing(state.manifest, run.operation)
            : capabilities.admission
              ? await capabilities.admission(
                  db,
                  session,
                  state.manifest,
                  run.operation,
                )
              : await capabilities.available(state.manifest, run.operation))
        );
      }
      if (
        state.reasons.length ||
        !state.manifest ||
        !state.agent ||
        !state.definition
      )
        return false;
      if (
        run.frozen.protocolVersion !==
          state.definition.data.executionImplementation?.protocolVersion ||
        !state.manifest.protocolVersions.some(
          (v) => v === run.frozen.protocolVersion,
        ) ||
        run.frozen.clientSwarm !== undefined ||
        run.frozen.definition.key !== state.definition.key ||
        digest(run.frozen.clientAgent.configuration) !==
          digest(state.agent.data.configuration) ||
        run.frozen.grant.resources.some(
          (g) =>
            !(
              run.effectiveness &&
              g.reference.resourceType === "agent_result_projection"
            ) &&
            !state.definition!.data.hiveAccess.readResources.includes(
              g.reference.resourceType,
            ),
        ) ||
        run.frozen.grant.proposalTargets.some(
          (g) =>
            !state.definition!.data.hiveAccess.proposeResources.includes(
              g.kind === "update" ? g.reference.resourceType : g.targetKind,
            ),
        ) ||
        !state.manifest.operations.includes(run.operation) ||
        digest(state.manifest) !== digest(run.manifest) ||
        state.definition.id !== run.frozen.definition.id ||
        state.definition.version !== run.frozen.definition.version ||
        state.agent.revision !== run.target.revision ||
        run.frozen.grant.bindings.some(
          (id) =>
            !state.agent!.data.bindings.some(
              (b: Document) => b.integrationId === id,
            ),
        )
      )
        return false;
      const profiles = state.definition.data.effectiveness ?? [];
      const requiredProfile = profiles.find(
        (p: { maker: string; evaluator: string; revision: string }) =>
          [p.maker, p.evaluator, p.revision].includes(run.operation),
      );
      if (requiredProfile && !run.effectiveness) return false;
      if (run.effectiveness && !requiredProfile) return false;
      return (
        (await execution.allowed(db, run.workspaceId, run.frozen, session)) &&
        (run.status === "running" && capabilities.continuing
          ? await capabilities.continuing(state.manifest, run.operation)
          : capabilities.admission
            ? await capabilities.admission(
                db,
                session,
                state.manifest,
                run.operation,
              )
            : await capabilities.available(state.manifest, run.operation))
      );
    },
  };
  return { inspect, catalogue, policy };
}
