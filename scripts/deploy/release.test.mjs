import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  healthy,
  validateChanges,
  validatePolicy,
  validateTag,
  validateTemplate,
} from "./release.mjs";

function template() {
  return {
    Parameters: { ApiImageTag: { Type: "String" } },
    Resources: {
      Task: {
        Type: "AWS::ECS::TaskDefinition",
        Properties: {
          ContainerDefinitions: [
            {
              Name: "api",
              Image: {
                "Fn::Join": ["", ["registry:", { Ref: "ApiImageTag" }]],
              },
              Environment: [{ Name: "EXISTING", Value: "preserved" }],
            },
          ],
        },
      },
      Service: {
        Type: "AWS::ECS::Service",
        Properties: {
          ServiceName: "vamberic-dev-api",
          TaskDefinition: { Ref: "Task" },
          DeploymentConfiguration: {
            DeploymentCircuitBreaker: { Enable: true, Rollback: true },
          },
        },
      },
    },
  };
}
function changes() {
  return [
    {
      ResourceChange: {
        LogicalResourceId: "Task",
        ResourceType: "AWS::ECS::TaskDefinition",
        Action: "Modify",
        Replacement: "True",
        Scope: ["Properties"],
        Details: [
          { Target: { Attribute: "Properties", Name: "ContainerDefinitions" } },
        ],
      },
    },
    {
      ResourceChange: {
        LogicalResourceId: "Service",
        ResourceType: "AWS::ECS::Service",
        Action: "Modify",
        Replacement: "False",
        Scope: ["Properties"],
        Details: [
          { Target: { Attribute: "Properties", Name: "TaskDefinition" } },
        ],
      },
    },
  ];
}
test("image ownership requires a parameter used only by api image; preserves template", () => {
  const input = template();
  const before = structuredClone(input);
  assert.deepEqual(validateTemplate(input), {
    taskId: "Task",
    serviceId: "Service",
  });
  assert.deepEqual(input, before);
  delete input.Parameters.ApiImageTag;
  assert.throws(() => validateTemplate(input));
});
test("reject pinned images, extra parameter consumers, disabled rollback and transforms", () => {
  const mutations = [
    (t) => {
      t.Resources.Task.Properties.RuntimePlatform = {
        CpuArchitecture: "ARM64",
      };
    },
    (t) => {
      t.Resources.Task.Properties.ContainerDefinitions[0].Image = "old:1234567";
    },
    (t) => {
      t.Resources.Task.Properties.Cpu = { Ref: "ApiImageTag" };
    },
    (t) => {
      t.Resources.Service.Properties.DeploymentConfiguration.DeploymentCircuitBreaker.Rollback = false;
    },
    (t) => {
      t.Transform = "AWS::LanguageExtensions";
    },
  ];
  for (const mutate of mutations) {
    const t = template();
    mutate(t);
    assert.throws(() => validateTemplate(t));
  }
});
test("only image/task-definition changes allowed, never structural service changes", () => {
  const ids = validateTemplate(template());
  validateChanges(changes(), ids);
  const mutations = [
    (c) => {
      c[1].ResourceChange.Details[0].Target.Name = "NetworkConfiguration";
    },
    (c) => {
      c[1].ResourceChange.Replacement = "True";
    },
    (c) => {
      c[0].ResourceChange.LogicalResourceId = "Role";
    },
    (c) => {
      c[0].ResourceChange.Action = "Remove";
    },
    (c) => {
      c[0].ResourceChange.Details = [];
    },
  ];
  for (const mutate of mutations) {
    const c = changes();
    mutate(c);
    assert.throws(() => validateChanges(c, ids));
  }
  assert.throws(() => validateChanges([], ids));
});
test("readiness requires HTTP200 AND Mongo available in dev", () => {
  const ready = {
    status: "ready",
    environment: "dev",
    dependencies: { mongodb: "available" },
  };
  assert.equal(healthy("ready", 200, ready), true);
  assert.equal(healthy("ready", 503, ready), false);
  assert.equal(healthy("ready", 200, { ...ready, dependencies: {} }), false);
  assert.equal(healthy("ready", 200, { ...ready, environment: "prod" }), false);
  assert.equal(
    healthy("health", 200, { status: "ok", environment: "dev" }),
    true,
  );
});
test("full SHA and explicit no-migration release policy required", () => {
  validateTag("a".repeat(40));
  for (const tag of ["latest", "a830200", "main", "a".repeat(40) + ";x"])
    assert.throws(() => validateTag(tag));
  validatePolicy({ databaseMigrationRequired: false });
  for (const policy of [{}, { databaseMigrationRequired: true }])
    assert.throws(() => validatePolicy(policy));
});
test("workflow gates frontend on healthy API and uses only existing OIDC environments", () => {
  const workflow = readFileSync(
    new URL("../../.github/workflows/deploy-dev.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /deploy-api:\n\s+needs: validate/);
  assert.match(workflow, /deploy-vapp:\n\s+needs: deploy-api/);
  assert.match(
    workflow,
    /release.mjs deploy[\s\S]*release.mjs health[\s\S]*deploy-vapp:/,
  );
  assert.match(workflow, /environment: dev/);
  assert.match(workflow, /environment: vapp/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.doesNotMatch(
    workflow,
    /aws-access-key|secrets\.AWS|db:setup|db:migrate|delete-crm|cdk deploy/,
  );
  const release = readFileSync(
    new URL("./release.mjs", import.meta.url),
    "utf8",
  );
  assert.match(release, /--use-previous-template/);
  assert.doesNotMatch(
    release,
    /"update-service"|"register-task-definition"|"--template-body"|"--template-url"/,
  );
  assert.match(release, /UsePreviousValue: true/);
});

// Exercise the real CLI entrypoint against fake executables; no AWS/network calls.
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
function runFake(mode, command = "deploy") {
  const dir = mkdtempSync(join(tmpdir(), "vamberic-release-test-"));
  const tag = "a".repeat(40);
  const uri = `755905325223.dkr.ecr.eu-west-2.amazonaws.com/vamberic-dev-api:${tag}`;
  const fixture = { template: template(), changes: changes(), tag, uri, mode };
  if (mode === "unsafe")
    fixture.changes[1].ResourceChange.Details[0].Target.Name = "DesiredCount";
  writeFileSync(join(dir, "fixture.json"), JSON.stringify(fixture));
  writeFileSync(join(dir, "calls.jsonl"), "");
  writeFileSync(
    join(dir, "aws"),
    `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const base = __dirname;
const f = JSON.parse(fs.readFileSync(path.join(base, "fixture.json")));
const log = path.join(base, "calls.jsonl");
const prior = fs.readFileSync(log, "utf8");
const a = process.argv.slice(2);
fs.appendFileSync(log, JSON.stringify(a)+"\\n");
const released = prior.includes('"execute-change-set"') || f.mode === "rerun";
const revision = released ? "task:2" : "task:1";
let result;
switch (a[0]+" "+a[1]) {
case "cloudformation describe-stacks": result = {Stacks:[{ RoleARN:"arn:aws:iam::755905325223:role/cfn", StackStatus:"UPDATE_COMPLETE", Parameters:[{ParameterKey:"ApiImageTag",ParameterValue:f.mode === "rerun" ? f.tag : "bbbbbbb"},{ParameterKey:"Other",ParameterValue:"untouched"}]}]}; break;
case "cloudformation get-template": result = {TemplateBody:f.template}; break;
case "cloudformation describe-stack-resource": result = {StackResourceDetail:{PhysicalResourceId:revision}}; break;
case "ecs describe-services": result = {failures:[],services:[{taskDefinition:f.mode === "drift" ? "task:999" : revision, deployments:[{}], desiredCount:1,runningCount:1,pendingCount:0}]}; break;
case "ecr describe-repositories": result = {repositories:[{imageTagMutability:"IMMUTABLE"}]}; break;
case "cloudformation describe-change-set": result = {Changes:f.changes}; break;
case "ecs describe-task-definition": result = {taskDefinition:{containerDefinitions:[{name:"api",image:f.uri}]}}; break;
case "ecs list-tasks": result = {taskArns:["running-task"]}; break;
case "ecs describe-tasks": result = {failures:[],tasks:[{taskDefinitionArn:revision,lastStatus:"RUNNING",containers:[{name:"api",image:f.uri,imageDigest:f.mode === "wrong-digest" ? "bad" : "sha256:expected"}]}]}; break;
case "ecr describe-images": result = {imageDetails:[{imageDigest:"sha256:expected"}]}; break;
case "ecr list-images": result = {imageIds:f.mode === "rerun" ? [{imageTag:f.tag}] : []}; break;
case "cloudformation wait": if (f.mode === "rollback" && a[2] === "stack-update-complete") process.exit(1); result = {}; break;
case "cloudformation create-change-set":
case "cloudformation execute-change-set":
case "cloudformation delete-change-set":
case "ecs wait": result = {}; break;
default: process.exit(9);
}
console.log(JSON.stringify(result));
`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(dir, "docker"),
    `#!${process.execPath}
require("node:fs").appendFileSync(require("node:path").join(__dirname,"calls.jsonl"), JSON.stringify(["docker",...process.argv.slice(2)])+"\\n");
`,
    { mode: 0o755 },
  );
  try {
    const result = spawnSync(
      process.execPath,
      [resolve("scripts/deploy/release.mjs"), command],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${dir}:${process.env.PATH}`,
          GITHUB_SHA: tag,
          GITHUB_REF: "refs/heads/main",
          GITHUB_RUN_ID: "1",
          GITHUB_RUN_ATTEMPT: "1",
          GITHUB_STEP_SUMMARY: join(dir, "summary"),
        },
      },
    );
    const calls = readFileSync(join(dir, "calls.jsonl"), "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(JSON.parse);
    return { ...result, calls };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
test("CLI releases only image parameter and verifies resulting tasks/digest", () => {
  const result = runFake("success");
  assert.equal(result.status, 0, result.stderr);
  const create = result.calls.find((a) => a[1] === "create-change-set");
  assert.ok(create.includes("--use-previous-template"));
  assert.deepEqual(JSON.parse(create[create.indexOf("--parameters") + 1]), [
    { ParameterKey: "ApiImageTag", ParameterValue: "a".repeat(40) },
    { ParameterKey: "Other", UsePreviousValue: true },
  ]);
  assert.match(result.stdout, /Previous task definition: task:1/);
  assert.match(result.stdout, /New task definition: task:2/);
  assert.ok(result.calls.some((a) => a[1] === "describe-tasks"));
});
test("CLI fails closed on drift and unsafe changes before execution", () => {
  for (const mode of ["drift", "unsafe"]) {
    const result = runFake(mode);
    assert.notEqual(result.status, 0);
    assert.ok(!result.calls.some((a) => a[1] === "execute-change-set"));
  }
});
test("CLI fails on stack rollback or image digest mismatch", () => {
  for (const mode of ["rollback", "wrong-digest"]) {
    const result = runFake(mode);
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout, /New task definition/);
  }
});
test("CLI rerun skips identical stack update but still verifies running image", () => {
  const result = runFake("rerun");
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!result.calls.some((a) => a[1] === "create-change-set"));
  assert.ok(result.calls.some((a) => a[1] === "describe-tasks"));
});
test("publisher reuses existing SHA; missing tag builds and pushes linux/amd64", () => {
  const reuse = runFake("rerun", "publish");
  assert.equal(reuse.status, 0, reuse.stderr);
  assert.ok(!reuse.calls.some((a) => a[0] === "docker"));
  const fresh = runFake("success", "publish");
  assert.equal(fresh.status, 0, fresh.stderr);
  const docker = fresh.calls.filter((a) => a[0] === "docker");
  assert.equal(docker.length, 2);
  assert.deepEqual(docker[0].slice(0, 4), [
    "docker",
    "build",
    "--platform",
    "linux/amd64",
  ]);
  assert.equal(docker[1][1], "push");
});
