import {
  PRODUCT_MANIFEST,
  PRODUCT_WEBSITE_MANIFEST,
  SUBMITTED_PAGE_TOOL,
  digest,
  PRODUCT_GENERAL_MANIFEST,
  ImplementationManifestV2Schema,
  digestWithout,
} from "@workspace/agent-runtime-protocol";
import { workspaceTarget } from "../../src/domain/agent-operator";
import { effectivenessFixture } from "./effectiveness-fixture";
import {
  createProductFoundationProfile,
  createProductProductionProfile,
} from "../../src/services/product-service-understanding/preparation";
import { PRODUCT_EFFECTIVENESS } from "../../src/services/product-service-understanding/profile";
import { createAgentEffectiveness } from "../../src/services/agent-effectiveness";
import { createAgentExecutionReadiness } from "../../src/services/agent-execution-readiness";
import { createAgentControlPlane } from "../../src/services/agent-control-plane";
export async function workspaceAgentFixture(
  general = false,
  override?: typeof PRODUCT_GENERAL_MANIFEST,
  production = false,
) {
  const f = await effectivenessFixture();
  f.db.rows("schema_versions")[0]!.version = 16;
  const next = { ...PRODUCT_MANIFEST, protocolVersions: ["2.0"] };
  const manifest =
    override ??
    (general
      ? PRODUCT_GENERAL_MANIFEST
      : ImplementationManifestV2Schema.parse({
          ...next,
          manifestDigest: digestWithout(next, "manifestDigest"),
        }));
  const def = f.db.rows("agent_definitions")[0]!;
  def.key = "product_service_understanding";
  def.version = 1;
  def.availability = "queens";
  def.data.executionImplementation = {
    ...manifest.implementation,
    manifestDigest: manifest.manifestDigest,
    protocolVersion: "2.0",
  };
  def.data.effectiveness = [PRODUCT_EFFECTIVENESS];
  def.data.hiveAccess.readResources = ["brands", "offerings"];
  def.data.hiveAccess.proposeResources = ["offerings"];
  f.db.rows("client_agents").splice(0);
  const target = workspaceTarget({
    kind: "workspace_agent",
    workspaceId: f.workspaceId,
    definition: { id: def.id, key: def.key, version: 1 },
    implementation: {
      ...manifest.implementation,
      manifestDigest: manifest.manifestDigest,
      buildDigest: manifest.buildDigest,
    },
  });
  let overlayRead = true;
  const readiness = createAgentExecutionReadiness(
    {
      async manifest() {
        return manifest;
      },
      async available() {
        return true;
      },
      reasoningToolAllowed: (m, operation, tool) =>
        m.manifestDigest === PRODUCT_WEBSITE_MANIFEST.manifestDigest &&
        operation === "understand" &&
        digest(tool) === digest(SUBMITTED_PAGE_TOOL),
      reasoningOperations: () => manifest.operations,
      reasoningConfiguration: () => [],
      mergeReasoningConfiguration: (_manifest, _defaults, configuration) => {
        if (
          !Array.isArray(configuration) ||
          configuration.some(
            (v) =>
              !v ||
              typeof v !== "object" ||
              Array.isArray(v) ||
              v.key !== "tone",
          )
        )
          throw new Error("Unknown customization");
        return configuration;
      },
    },
    {
      async allowed() {
        return true;
      },
      async dependencies() {
        return [];
      },
      configurationReadAllowed: async () => overlayRead,
      allowInternal: false,
    },
  );
  const effects = createAgentEffectiveness(
    f.config,
    f.db.mongo,
    f.workloads,
    readiness,
    [
      production
        ? createProductProductionProfile(f.config, () => f.now)
        : createProductFoundationProfile(f.config, manifest, () => f.now),
    ],
    () => f.now,
  );
  const control = createAgentControlPlane(
    f.config,
    f.db.mongo,
    f.workloads,
    readiness.policy,
    () => f.now,
    effects.hooks,
  );
  const request = {
    target,
    operation: "understand",
    requestKey: "workspace-psu",
    input: {
      mode: "create",
      brandId: f.db.rows("brands")[0]!.id,
      workingLabel: "Synthetic assessment",
      orientation: "Synthetic local test",
    },
  };
  return {
    ...f,
    target,
    manifest,
    readiness,
    effects,
    control,
    request,
    denyOverlayRead() {
      overlayRead = false;
    },
  };
}
