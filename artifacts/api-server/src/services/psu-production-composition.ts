import {
  PRODUCT_WEBSITE_MANIFEST,
  PSU_WEBSITE_POLICY_DIGEST,
  SUBMITTED_PAGE_TOOL,
} from "@workspace/agent-runtime-protocol";
import { createWebsiteProductProductionProfile } from "./product-service-understanding/preparation";
import { websiteRunBudget } from "./product-service-understanding/execution-policy";
import {
  PRODUCT_CLARIFICATION_MANIFEST,
  digest,
} from "@workspace/agent-runtime-protocol";
import {
  CapacityReleaseSchema,
  type CapacityRelease,
} from "../domain/agent-capacity";
import { type DeploymentObserver } from "./agent-capacity";
import { createExecutionReconciliation } from "./agent-execution-reconciliation";
import { createAgentSubsystem } from "./agent-subsystem";
import { createProductProductionProfile } from "./product-service-understanding/preparation";
import {
  productionRunBudget,
  PSU_RECONCILIATION_POLICY_DIGEST,
} from "./product-service-understanding/execution-policy";
import type { AppConfig } from "../config";
import type { MongoService } from "./mongo";
import type { createCognitoWorkloadAuthentication } from "../authorization/agent-workload-cognito";
/** Explicit trusted factory, absent from normal startup. Metadata registration does not enable it. */
export function composePsuProduction(
  config: AppConfig,
  mongo: MongoService,
  authentication: ReturnType<typeof createCognitoWorkloadAuthentication>,
  releaseValue: CapacityRelease,
  observer: DeploymentObserver,
  clock = () => new Date(),
  qualification: {
    projectReference?: string;
    terminalContracts?: readonly string[];
  } = {},
) {
  const release = CapacityReleaseSchema.parse(releaseValue),
    website =
      release.manifestDigest === PRODUCT_WEBSITE_MANIFEST.manifestDigest,
    manifest = website
      ? PRODUCT_WEBSITE_MANIFEST
      : PRODUCT_CLARIFICATION_MANIFEST;
  if (
    config.deploymentEnvironment !== "dev" ||
    release.manifestDigest !== manifest.manifestDigest ||
    release.buildDigest !== manifest.buildDigest ||
    release.policyDigest !==
      (website ? PSU_WEBSITE_POLICY_DIGEST : PSU_RECONCILIATION_POLICY_DIGEST)
  )
    throw new Error("Unreviewed PSU production binding");
  const capacity = createExecutionReconciliation(
    mongo,
    authentication.authority,
    release,
    observer,
    (...args) => subsystem.control.authorizeInvocation(...args),
    clock,
    qualification,
  );
  const subsystem = createAgentSubsystem(config, mongo, {
    ...authentication,
    capacity,
    clock,
    capabilities: {
      availabilityState: async (value, operation) =>
        value.manifestDigest === manifest.manifestDigest &&
        manifest.operations.includes(operation)
          ? capacity.status()
          : "unavailable",
      admission: async (db, session, value, operation) =>
        value.manifestDigest === manifest.manifestDigest &&
        manifest.operations.includes(operation) &&
        (await capacity.admit(db, session)),
      continuing: async (value, operation) =>
        value.manifestDigest === manifest.manifestDigest &&
        manifest.operations.includes(operation),
      manifest: async (key, version, value) =>
        key === manifest.implementation.key &&
        version === manifest.implementation.version &&
        value === manifest.manifestDigest
          ? manifest
          : undefined,
      available: async (value, operation) =>
        value.manifestDigest === manifest.manifestDigest &&
        manifest.operations.includes(operation) &&
        (await capacity.available()),
      reasoningToolAllowed: (m, operation, tool) =>
        website &&
        m.manifestDigest === manifest.manifestDigest &&
        operation === "understand" &&
        digest(tool) === digest(SUBMITTED_PAGE_TOOL),
      reasoningOperations: () => manifest.operations,
      reasoningConfiguration: () => [],
    },
    execution: {
      allowInternal: false,
      dependencies: async () => [],
      allowed: async (_db, _workspace, work) => {
        const role =
          work.operation === "understand"
            ? "maker"
            : work.operation === "evaluate_understanding"
              ? "evaluator"
              : work.operation === "revise_understanding"
                ? "revision"
                : undefined;
        return (
          !!role &&
          work.protocolVersion === "2.0" &&
          work.definition.key === "product_service_understanding" &&
          manifest.compatibleDefinitions.some(
            (d) =>
              d.key === work.definition.key &&
              d.version === work.definition.version,
          ) &&
          work.implementation.manifestDigest === manifest.manifestDigest &&
          work.implementation.buildDigest === manifest.buildDigest &&
          digest(work.grant.tools) ===
            digest(website && role === "maker" ? [SUBMITTED_PAGE_TOOL] : []) &&
          digest(work.grant.budgets) ===
            digest(
              (website ? websiteRunBudget : productionRunBudget)(
                role,
                work.grant.budgets.deadline,
              ),
            ) &&
          work.grant.models.length === 1 &&
          work.grant.models[0]?.provider === "openai" &&
          work.grant.models[0]?.model === `openai_psu_${role}_v1`
        );
      },
    },
    effectivenessProfiles: [
      (website
        ? createWebsiteProductProductionProfile
        : createProductProductionProfile)(config, clock),
    ],
  });
  return { ...subsystem, capacity };
}
