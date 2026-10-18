import test from "node:test";
import assert from "node:assert/strict";
import {
  digest,
  PRODUCT_CLARIFICATION_MANIFEST,
} from "@workspace/agent-runtime-protocol";
import { workspaceAgentFixture } from "./helpers/workspace-agent-v16";
import { composeAgentDeployment } from "../src/services/agent-deployment";
import {
  parsePsuStartupBinding,
  PsuStartupBindingSchema,
} from "../src/services/psu-startup-binding";
import { TERMINAL_QUALIFICATION_DIGEST } from "../src/services/psu-terminal-qualification";
import { PSU_RECONCILIATION_POLICY_DIGEST } from "../src/services/product-service-understanding/execution-policy";
import {
  parsePsuStartupBinding as runtimeParse,
  PsuStartupBindingSchema as runtimeSchema,
} from "../../../../vamberic-agent-runtime/dist/src/worker/psu-startup-binding.js";
const prefix = "arn:aws:ecs:eu-west-2:123456789012:";
const release = {
  environment: "dev",
  workloadClass: "agent_runtime",
  workloadClientId: "client",
  manifestDigest: PRODUCT_CLARIFICATION_MANIFEST.manifestDigest,
  buildDigest: PRODUCT_CLARIFICATION_MANIFEST.buildDigest,
  policyDigest: PSU_RECONCILIATION_POLICY_DIGEST,
  serviceArn: `${prefix}service/cluster/worker`,
  taskDefinitionArn: `${prefix}task-definition/worker:1`,
  imageDigest: `sha256:${"a".repeat(64)}`,
};
const config = {
  schemaVersion: 2,
  enabled: true,
  region: "eu-west-2",
  account: "123456789012",
  release: {
    ...Object.fromEntries(
      Object.entries(release).filter(([k]) => k !== "taskDefinitionArn"),
    ),
    taskDefinitionFamily: "worker",
  },
  secretArn:
    "arn:aws:secretsmanager:eu-west-2:123456789012:secret:vamberic/dev/synthetic",
  models: {
    OPENAI_PROJECT_ID: "proj_synthetic",
    PSU_MAKER_MODEL: "gpt-6.1-sol",
    PSU_EVALUATOR_MODEL: "gpt-6-astra",
    PSU_REVISION_MODEL: "gpt-6.1-sol",
  },
};
const binding = {
  schemaVersion: 2,
  qualificationDigest: TERMINAL_QUALIFICATION_DIGEST,
  specification: structuredClone(config),
  specificationDigest: digest(config),
};
const env = {
  AGENT_WORKLOAD_ISSUER:
    "https://cognito-idp.eu-west-2.amazonaws.com/eu-west-2_synthetic",
  AGENT_WORKLOAD_CLIENT_ID: "client",
  AGENT_WORKLOAD_RESOURCE_SERVER: "vamberic-dev-agent-runtime",
  PSU_PRODUCTION_RELEASE: JSON.stringify(release),
  PSU_TERMINAL_QUALIFICATION: JSON.stringify(binding),
};
test("startup configuration schemas and synthetic release pins agree across repositories", () => {
  for (const value of [
    binding,
    {},
    { ...binding, extra: true },
    ...invalidBindings,
  ]) {
    assert.equal(
      PsuStartupBindingSchema.safeParse(value).success,
      runtimeSchema.safeParse(value).success,
    );
  }
  assert.deepEqual(
    parsePsuStartupBinding(env.PSU_TERMINAL_QUALIFICATION, release),
    runtimeParse(env.PSU_TERMINAL_QUALIFICATION, release),
  );
});
test("actual API startup default remains without production capacity", async () => {
  const f = await workspaceAgentFixture(true, PRODUCT_CLARIFICATION_MANIFEST);
  const api = composeAgentDeployment(f.config, f.db.mongo, {});
  assert.equal("capacity" in api, false);
});
test("actual API startup accepts synthetic exact qualification without network or admission", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const f = await workspaceAgentFixture(true, PRODUCT_CLARIFICATION_MANIFEST);
  f.db.rows("schema_versions")[0]!.version = 23;
  const beforeTerm = process.listeners("SIGTERM"),
    beforeInt = process.listeners("SIGINT");
  try {
    const api = composeAgentDeployment(
      { ...f.config, deploymentEnvironment: "dev" },
      f.db.mongo,
      env,
    );
    assert.ok("capacity" in api);
    assert.equal(await api.capacity.available(), false);
    assert.equal(f.db.rows("agent_runs").length, 0);
  } finally {
    for (const listener of process.listeners("SIGTERM"))
      if (!beforeTerm.includes(listener)) {
        listener();
        process.removeListener("SIGTERM", listener);
      }
    for (const listener of process.listeners("SIGINT"))
      if (!beforeInt.includes(listener))
        process.removeListener("SIGINT", listener);
  }
});
const invalidBindings = [
  { ...binding, schemaVersion: 1 },
  { ...binding, qualificationDigest: "0".repeat(64) },
  { ...binding, specificationDigest: "0".repeat(64) },
  { ...binding, projectReference: "invalid" },
  { ...binding, classifier: "arbitrary" },
  ...["maker", "evaluator", "revision"].map((role) => ({
    ...binding,
    models: { ...config.models, [role]: "unknown" },
  })),
];
for (const [index, value] of invalidBindings.entries())
  test(`API startup rejects qualification mismatch ${index}`, async () => {
    const f = await workspaceAgentFixture(true, PRODUCT_CLARIFICATION_MANIFEST);
    assert.throws(() =>
      composeAgentDeployment(
        { ...f.config, deploymentEnvironment: "dev" },
        f.db.mongo,
        { ...env, PSU_TERMINAL_QUALIFICATION: JSON.stringify(value) },
      ),
    );
    assert.throws(() => runtimeParse(JSON.stringify(value), release));
  });
for (const field of Object.keys(release))
  test(`API startup rejects changed release ${field}`, async () => {
    const f = await workspaceAgentFixture(true, PRODUCT_CLARIFICATION_MANIFEST);
    assert.throws(() =>
      composeAgentDeployment(
        { ...f.config, deploymentEnvironment: "dev" },
        f.db.mongo,
        {
          ...env,
          PSU_PRODUCTION_RELEASE: JSON.stringify({
            ...release,
            [field]: "changed",
          }),
        },
      ),
    );
  });
test("API startup rejects partial, malformed, oversized and cross-environment configuration", async () => {
  const f = await workspaceAgentFixture(true, PRODUCT_CLARIFICATION_MANIFEST);
  for (const patch of [
    { PSU_TERMINAL_QUALIFICATION: undefined },
    { PSU_PRODUCTION_RELEASE: undefined },
    { PSU_TERMINAL_QUALIFICATION: "{" },
    { PSU_TERMINAL_QUALIFICATION: " ".repeat(4097) },
    { AGENT_WORKLOAD_CLIENT_ID: "other" },
    { AGENT_WORKLOAD_RESOURCE_SERVER: "vamberic-prod-agent-runtime" },
  ])
    assert.throws(() =>
      composeAgentDeployment(
        { ...f.config, deploymentEnvironment: "dev" },
        f.db.mongo,
        { ...env, ...patch },
      ),
    );
  assert.throws(() =>
    composeAgentDeployment(
      { ...f.config, deploymentEnvironment: "prod" },
      f.db.mongo,
      env,
    ),
  );
});

test("API qualification errors never echo unknown sensitive fields", () => {
  const marker = "synthetic-sensitive-marker";
  assert.throws(
    () =>
      parsePsuStartupBinding(
        JSON.stringify({ ...binding, OPENAI_API_KEY: marker }),
        release,
      ),
    (error: unknown) =>
      error instanceof Error &&
      !String(error).includes(marker) &&
      !JSON.stringify(error).includes(marker),
  );
});

test("metadata-selected revision never changes Platform's independent exact revision", async () => {
  const { createEcsDeploymentObserver } =
    await import("../src/services/agent-deployment-observer");
  const { CapacityReleaseSchema } =
    await import("../src/domain/agent-capacity");
  const approved = CapacityReleaseSchema.parse(release);
  const taskArn = `${prefix}task/cluster/task`;
  for (const [taskRevision, serviceRevision, expected] of [
    [1, 1, true],
    [42, 1, false],
    [1, 42, false],
    [42, 42, false],
  ] as const) {
    const observer = createEcsDeploymentObserver({
      describeTasks: async () => ({
        tasks: [
          {
            taskArn,
            taskDefinitionArn: `${prefix}task-definition/worker:${taskRevision}`,
            lastStatus: "RUNNING",
            desiredStatus: "RUNNING",
            group: "service:worker",
            containers: [
              {
                name: "worker",
                lastStatus: "RUNNING",
                imageDigest: release.imageDigest,
              },
            ],
          },
        ],
      }),
      describeServices: async () => ({
        services: [
          {
            serviceArn: release.serviceArn,
            taskDefinition: `${prefix}task-definition/worker:${serviceRevision}`,
            status: "ACTIVE",
          },
        ],
      }),
    });
    assert.equal(await observer(taskArn, approved), expected);
  }
});
test("both parsers reject independently rehashed invalid static security pins", () => {
  for (const patch of [
    { region: "us-east-1" },
    { account: "999999999999" },
    {
      secretArn:
        "arn:aws:secretsmanager:eu-west-2:999999999999:secret:vamberic/dev/synthetic",
    },
    { models: { ...config.models, PSU_MAKER_MODEL: "unapproved" } },
    { release: { ...config.release, taskDefinitionFamily: "other" } },
    { release: { ...config.release, imageDigest: `sha256:${"b".repeat(64)}` } },
  ]) {
    const specification = { ...config, ...patch };
    const text = JSON.stringify({
      ...binding,
      specification,
      specificationDigest: digest(specification),
    });
    assert.throws(() => parsePsuStartupBinding(text, release));
    assert.throws(() => runtimeParse(text, release));
  }
});
