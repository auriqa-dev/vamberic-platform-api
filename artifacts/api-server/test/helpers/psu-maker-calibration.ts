/** Test-only composition. Actual Platform preparation, no database connection. */
import {
  PRODUCT_GENERAL_MANIFEST,
  PRODUCT_PROFILE,
  productCriteria,
} from "@workspace/agent-runtime-protocol";
import { workspaceAgentFixture } from "./workspace-agent-v16";
import { createProductFoundationProfile } from "../../src/services/product-service-understanding/preparation";
import { createAgentEffectiveness } from "../../src/services/agent-effectiveness";
import { createAgentControlPlane } from "../../src/services/agent-control-plane";
import { mutateHiveDefinition } from "../../src/services/hive-definitions";
import { parseFrozenWork } from "../../src/domain/agent-control-plane";
import {
  captureMakerRequest,
  CALIBRATION_ID,
} from "../../../../.integration/vamberic-agent-runtime/dist/scripts/psu/general-maker-calibration.js";
import { GeneralMakerDto } from "../../../../.integration/vamberic-agent-runtime/dist/src/agents/product-service-understanding/general-composition.js";
import { structuredOutput } from "../../../../.integration/vamberic-agent-runtime/dist/src/models/openai/schema.js";

export async function prepareOfflineMakerCalibration() {
  const f = await workspaceAgentFixture(true);
  f.db.rows("schema_versions")[0]!.version = 18;
  const base = createProductFoundationProfile(
    f.config,
    f.manifest,
    () => f.now,
  );
  const budget = {
    deadline: new Date(f.now.getTime() + 60000).toISOString(),
    modelCalls: 1,
    toolCalls: 0,
    providerCalls: [{ provider: "openai", calls: 1 }],
    cost: { currency: "USD", amount: "0.2" },
  };
  const model = {
    provider: "openai",
    model: "openai_psu_maker_v1",
    purpose: "product_understand",
  };
  // Test composition selects the model before persistence/claim. Never rewrite
  // a claimed grant or enable this policy in server production defaults.
  const profile: typeof base = {
    ...base,
    async prepareCase(context) {
      const prepared = await base.prepareCase(context);
      return { ...prepared, totalBudget: budget };
    },
    async prepareRun(context) {
      if (context.role !== "maker") throw new Error("Maker only calibration");
      const prepared = await base.prepareRun(context);
      return {
        ...prepared,
        frozen: parseFrozenWork({
          ...prepared.frozen,
          input: { ...(prepared.frozen.input as object), model },
          grant: {
            ...prepared.frozen.grant,
            models: [model],
            tools: [],
            budgets: budget,
          },
        }),
        limits: { attempts: 1, failures: 1, inputCycles: 1, continuations: 1 },
      };
    },
  };
  const effects = createAgentEffectiveness(
    f.config,
    f.db.mongo,
    f.workloads,
    f.readiness,
    [profile],
    () => f.now,
  );
  const control = createAgentControlPlane(
    f.config,
    f.db.mongo,
    f.workloads,
    f.readiness.policy,
    () => f.now,
    effects.hooks,
  );
  const definition = {
    name: "Fictional Meter Report",
    description: "A remote assessment report.",
    whatItIs: "Meter-data assessment",
    whatCustomerBuys: "An assessment report",
    capabilities: ["Meter data analysis"],
    engagementModel: "Remote one-off delivery",
    boundaries: ["Installation excluded"],
    proofPoints: ["Synthetic observation for offline calibration only"],
  };
  const draft = await mutateHiveDefinition(
    f.db.mongo,
    f.config,
    f.queen,
    f.workspaceId,
    "offerings",
    "create",
    { definition },
  );
  for (const [field, value] of Object.entries(definition)) {
    const row = f.db.rows("offerings").find((r) => r.id === draft.id)!;
    await mutateHiveDefinition(
      f.db.mongo,
      f.config,
      f.queen,
      f.workspaceId,
      "offerings",
      "observe",
      {
        id: draft.id,
        expectedUpdatedAt: row.updatedAt.toISOString(),
        evidence: {
          field,
          value,
          origin: "user_supplied",
          provider: "Synthetic offline calibration",
          observedAt: f.now.toISOString(),
          verification: "observed",
        },
      },
    );
  }
  const row = f.db.rows("offerings").find((r) => r.id === draft.id)!;
  const c = await effects.create(f.queen, f.workspaceId, {
    ...f.request,
    requestKey: CALIBRATION_ID,
    input: {
      mode: "refresh",
      offeringId: draft.id,
      expectedUpdatedAt: row.updatedAt.toISOString(),
      workingLabel: definition.name,
      orientation: "Describe the exact supported synthetic service only",
    },
  });
  const run = f.db.rows("agent_runs").find((r) => r.id === c.rootRunId)!;
  const work = await control.claim(f.principal, {
    dispatch: {
      protocolVersion: "2.0",
      environment: "test",
      runId: run.id,
      generation: run.generation,
      dispatchId: run.dispatch.id,
      notBefore: run.notBefore.toISOString(),
      traceId: run.frozen.traceId,
    },
    claimId: CALIBRATION_ID,
  });
  const bundle = {
    calibrationId: CALIBRATION_ID,
    now: f.now.toISOString(),
    work,
    manifest: PRODUCT_GENERAL_MANIFEST,
    profile: PRODUCT_PROFILE,
    criteria: productCriteria(),
    wire: await captureMakerRequest(work, f.now.toISOString()),
    schema: structuredOutput(GeneralMakerDto).schema,
  };
  return { bundle, db: f.db, definition };
}
