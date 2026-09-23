import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const stackName = "VambericDevApi";
export const repository =
  "755905325223.dkr.ecr.eu-west-2.amazonaws.com/vamberic-dev-api";
const service = "vamberic-dev-api";
const parameter = "ApiImageTag";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const summary = (text) => {
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
};
// Only classified diagnostics leave this boundary. Never retain raw stderr, stdout,
// subprocess errors (which contain arguments), or an Error cause with those values.
export function awsFailure(args, stderr) {
  const action = args.slice(0, args[1] === "wait" ? 3 : 2).join(" ");
  const raw = typeof stderr === "string" ? stderr : "";
  const parsed = raw.match(
    /An error occurred \(([A-Za-z][A-Za-z0-9.]{0,63})\)(?: when calling the ([A-Za-z]+) operation)?: ([^\r\n]*)/,
  );
  const codes = new Set([
    "AccessDenied",
    "AccessDeniedException",
    "UnauthorizedOperation",
    "ValidationError",
    "ChangeSetNotFound",
    "ChangeSetNotFoundException",
    "InvalidChangeSetStatus",
    "InvalidChangeSetStatusException",
    "Throttling",
    "ThrottlingException",
    "ExpiredToken",
    "ExpiredTokenException",
    "InvalidClientTokenId",
    "RequestExpired",
    "ServiceUnavailable",
    "InternalFailure",
  ]);
  const code =
    parsed && codes.has(parsed[1]) ? parsed[1] : "UnclassifiedCliError";
  const operations = new Set([
    "CreateChangeSet",
    "DescribeChangeSet",
    "ExecuteChangeSet",
    "DeleteChangeSet",
    "DescribeStacks",
  ]);
  const apiAction = operations.has(parsed?.[2])
    ? parsed[2]
    : args[1] === "wait" && args[2] === "change-set-create-complete"
      ? "DescribeChangeSet"
      : undefined;
  let reason = "AWS CLI failed; unrecognized stderr omitted";
  let benignCleanup = false;
  if (
    ["AccessDenied", "AccessDeniedException", "UnauthorizedOperation"].includes(
      code,
    )
  ) {
    reason =
      "AWS authorization denied; inspect the action, resource and policy conditions";
  } else if (
    [
      "ExpiredToken",
      "ExpiredTokenException",
      "InvalidClientTokenId",
      "RequestExpired",
    ].includes(code)
  ) {
    reason = "AWS authentication failed or expired";
  } else if (code !== "UnclassifiedCliError") {
    reason = "AWS service rejected the request; free-form message omitted";
  } else if (/Waiter [A-Za-z]+ failed: Max attempts exceeded/.test(raw)) {
    reason = "AWS waiter exhausted its attempts";
  } else if (
    /Waiter [A-Za-z]+ failed: Waiter encountered a terminal failure state/.test(
      raw,
    )
  ) {
    reason = "AWS waiter encountered a terminal failure state";
  }
  const lifecycle = raw.match(
    /\b(CREATE_IN_PROGRESS|DELETE_IN_PROGRESS|EXECUTE_IN_PROGRESS|EXECUTE_COMPLETE)\b/,
  )?.[1];
  if (
    ["InvalidChangeSetStatus", "InvalidChangeSetStatusException"].includes(
      code,
    ) &&
    lifecycle
  ) {
    reason = `Change set lifecycle prevents this operation: ${lifecycle}`;
  }
  if (
    args[0] === "cloudformation" &&
    args[1] === "delete-change-set" &&
    parsed?.[2] === "DeleteChangeSet"
  ) {
    const name = args[args.indexOf("--change-set-name") + 1];
    if (/^app-[a-f0-9]{40}-[0-9]+-[0-9]+$/.test(name ?? "")) {
      // Match only this change set and complete known messages, never generic
      // 'not found' text that might describe a missing stack or another failure.
      const identifier = `(?:${name}|arn:aws:cloudformation:eu-west-2:755905325223:changeSet/${name}/[A-Za-z0-9-]+)`;
      const absent = new RegExp(
        `^ChangeSet (?:\\[${identifier}\\]|${identifier}) (?:does not exist|has already been deleted)\\.?$`,
      );
      const consumed = new RegExp(
        `^ChangeSet (?:\\[${identifier}\\]|${identifier}) cannot be deleted because it has already been executed\\.?$`,
      );
      benignCleanup =
        ["ChangeSetNotFound", "ChangeSetNotFoundException"].includes(code) ||
        ([
          "ValidationError",
          "InvalidChangeSetStatus",
          "InvalidChangeSetStatusException",
        ].includes(code) &&
          (absent.test(parsed[3]) || consumed.test(parsed[3])));
    }
    if (benignCleanup)
      reason = "Change set absent or already consumed; cleanup is a no-op";
  }
  const error = new Error(
    `AWS command failed: ${action}; code=${code}; ${apiAction ? `apiAction=${apiAction}; ` : ""}${reason}`,
  );
  error.name = "AwsCliError";
  error.awsCode = code;
  error.benignCleanup = benignCleanup;
  return error;
}
export function cleanupChangeSet(name) {
  try {
    aws(
      "cloudformation",
      "delete-change-set",
      "--stack-name",
      stackName,
      "--change-set-name",
      name,
    );
  } catch (error) {
    if (error.benignCleanup) {
      console.log(
        "CloudFormation cleanup: change set absent or consumed (no-op)",
      );
      return;
    }
    throw error;
  }
}
function aws(...args) {
  // Never print AWS responses: task definitions may contain configuration values.
  try {
    const result = execFileSync(
      "aws",
      [...args, "--region", "eu-west-2", "--output", "json"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    return result.trim() ? JSON.parse(result) : {};
  } catch (error) {
    throw awsFailure(args, error.stderr);
  }
}
export function validatePolicy(policy) {
  assert.equal(
    policy.databaseMigrationRequired,
    false,
    "Complete the separate database migration and review the release policy before deploying",
  );
}
export function validateTag(tag) {
  assert.match(
    tag ?? "",
    /^[a-f0-9]{40}$/,
    "Release requires a full commit SHA",
  );
  return tag;
}
export function validateTemplate(template) {
  assert.equal(
    template.Parameters?.[parameter]?.Type,
    "String",
    "Infrastructure prerequisite missing: ApiImageTag parameter",
  );
  assert.equal(
    template.Transform,
    undefined,
    "Transforms require separate review",
  );
  const entries = Object.entries(template.Resources);
  const tasks = entries.filter(
    ([, r]) => r.Type === "AWS::ECS::TaskDefinition",
  );
  const services = entries.filter(([, r]) => r.Type === "AWS::ECS::Service");
  assert.equal(tasks.length, 1);
  assert.equal(services.length, 1);
  const [taskId, task] = tasks[0];
  const [serviceId, svc] = services[0];
  assert.equal(
    task.Properties.RuntimePlatform?.CpuArchitecture ?? "X86_64",
    "X86_64",
    "Review the image build platform before changing task architecture",
  );
  assert.equal(
    task.Properties.RuntimePlatform?.OperatingSystemFamily ?? "LINUX",
    "LINUX",
  );
  assert.equal(svc.Properties.ServiceName, service);
  assert.deepEqual(svc.Properties.TaskDefinition, { Ref: taskId });
  assert.deepEqual(
    svc.Properties.DeploymentConfiguration.DeploymentCircuitBreaker,
    { Enable: true, Rollback: true },
  );
  const container = task.Properties.ContainerDefinitions.filter(
    (c) => c.Name === "api",
  );
  assert.equal(container.length, 1);
  // CDK emits an Fn::Join with a registry import and this parameter as the final tag.
  const image = container[0].Image;
  assert.deepEqual(image?.["Fn::Join"]?.[1]?.at(-1), { Ref: parameter });
  const clone = structuredClone(template);
  delete clone.Parameters[parameter];
  delete clone.Resources[taskId].Properties.ContainerDefinitions.find(
    (c) => c.Name === "api",
  ).Image;
  assert.ok(
    !JSON.stringify(clone).includes(parameter),
    "Image parameter must affect only the api image",
  );
  return { taskId, serviceId };
}
export function validateChanges(changes, ids) {
  assert.ok(changes.length > 0 && changes.length <= 2);
  for (const { ResourceChange: change } of changes) {
    const task = change.LogicalResourceId === ids.taskId;
    assert.ok(
      task || change.LogicalResourceId === ids.serviceId,
      "Unexpected infrastructure change",
    );
    assert.equal(
      change.ResourceType,
      task ? "AWS::ECS::TaskDefinition" : "AWS::ECS::Service",
    );
    assert.equal(change.Action, "Modify");
    if (!task) assert.equal(change.Replacement, "False");
    assert.deepEqual(change.Scope, ["Properties"]);
    assert.ok(change.Details?.length);
    for (const detail of change.Details) {
      assert.equal(detail.Target.Attribute, "Properties");
      assert.equal(
        detail.Target.Name,
        task ? "ContainerDefinitions" : "TaskDefinition",
      );
    }
  }
}
function describeService() {
  const result = aws(
    "ecs",
    "describe-services",
    "--cluster",
    service,
    "--services",
    service,
  );
  assert.equal(result.failures?.length ?? 0, 0);
  assert.equal(result.services.length, 1);
  return result.services[0];
}
function preflight() {
  validatePolicy(
    JSON.parse(readFileSync(new URL("./policy.json", import.meta.url))),
  );
  validateTag(process.env.GITHUB_SHA);
  assert.equal(
    process.env.GITHUB_REF,
    "refs/heads/main",
    "Deployments are restricted to main",
  );
  const stack = aws(
    "cloudformation",
    "describe-stacks",
    "--stack-name",
    stackName,
  ).Stacks[0];
  assert.match(
    stack.RoleARN ?? "",
    /^arn:aws:iam::755905325223:role\//,
    "The stack must have its existing CloudFormation execution role",
  );
  assert.ok(
    ["CREATE_COMPLETE", "UPDATE_COMPLETE", "UPDATE_ROLLBACK_COMPLETE"].includes(
      stack.StackStatus,
    ),
    "Stack is busy or requires recovery",
  );
  assert.ok(
    stack.Parameters.some((p) => p.ParameterKey === parameter),
    "Provision the image ownership parameter first",
  );
  const raw = aws(
    "cloudformation",
    "get-template",
    "--stack-name",
    stackName,
    "--template-stage",
    "Original",
  ).TemplateBody;
  const ids = validateTemplate(typeof raw === "string" ? JSON.parse(raw) : raw);
  const svc = describeService();
  assert.equal(svc.deployments.length, 1, "Another deployment is active");
  assert.ok(svc.desiredCount > 0);
  assert.equal(svc.runningCount, svc.desiredCount);
  assert.equal(svc.pendingCount, 0);
  const owned = aws(
    "cloudformation",
    "describe-stack-resource",
    "--stack-name",
    stackName,
    "--logical-resource-id",
    ids.taskId,
  ).StackResourceDetail.PhysicalResourceId;
  assert.equal(
    svc.taskDefinition,
    owned,
    "Resolve existing ECS/CloudFormation drift before releasing",
  );
  const ecr = aws("ecr", "describe-repositories", "--repository-names", service)
    .repositories[0];
  assert.equal(ecr.imageTagMutability, "IMMUTABLE");
  return { stack, ids, previous: svc.taskDefinition };
}
async function deploy() {
  const { stack, ids, previous } = preflight();
  const tag = validateTag(process.env.GITHUB_SHA);
  summary(
    `Previous task definition: ${previous}\nRequested image: ${repository}:${tag}`,
  );
  if (
    stack.Parameters.find((p) => p.ParameterKey === parameter)
      .ParameterValue !== tag
  ) {
    const name = `app-${tag}-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`;
    const parameters = stack.Parameters.map((p) =>
      p.ParameterKey === parameter
        ? { ParameterKey: parameter, ParameterValue: tag }
        : { ParameterKey: p.ParameterKey, UsePreviousValue: true },
    );
    aws(
      "cloudformation",
      "create-change-set",
      "--stack-name",
      stackName,
      "--change-set-name",
      name,
      "--change-set-type",
      "UPDATE",
      "--use-previous-template",
      "--parameters",
      JSON.stringify(parameters),
      "--capabilities",
      "CAPABILITY_NAMED_IAM",
    );
    try {
      aws(
        "cloudformation",
        "wait",
        "change-set-create-complete",
        "--stack-name",
        stackName,
        "--change-set-name",
        name,
      );
      const changeSet = aws(
        "cloudformation",
        "describe-change-set",
        "--stack-name",
        stackName,
        "--change-set-name",
        name,
      );
      assert.equal(
        changeSet.NextToken,
        undefined,
        "Unexpected paginated changes",
      );
      validateChanges(changeSet.Changes, ids);
    } catch (error) {
      console.error(`Primary deployment failure: ${error.message}`);
      try {
        cleanupChangeSet(name);
      } catch (cleanupError) {
        console.error(`Additional cleanup failure: ${cleanupError.message}`);
      }
      // Cleanup never replaces the primary failure or turns this into success.
      throw error;
    }
    aws(
      "cloudformation",
      "execute-change-set",
      "--stack-name",
      stackName,
      "--change-set-name",
      name,
    );
    aws(
      "cloudformation",
      "wait",
      "stack-update-complete",
      "--stack-name",
      stackName,
    );
  }
  aws(
    "ecs",
    "wait",
    "services-stable",
    "--cluster",
    service,
    "--services",
    service,
  );
  const expected = aws(
    "cloudformation",
    "describe-stack-resource",
    "--stack-name",
    stackName,
    "--logical-resource-id",
    ids.taskId,
  ).StackResourceDetail.PhysicalResourceId;
  const svc = describeService();
  assert.equal(svc.taskDefinition, expected);
  assert.equal(svc.deployments.length, 1);
  assert.equal(svc.runningCount, svc.desiredCount);
  assert.ok(svc.runningCount > 0);
  const task = aws(
    "ecs",
    "describe-task-definition",
    "--task-definition",
    expected,
  ).taskDefinition;
  assert.equal(
    task.containerDefinitions.find((c) => c.name === "api").image,
    `${repository}:${tag}`,
  );
  const tasks = aws(
    "ecs",
    "list-tasks",
    "--cluster",
    service,
    "--service-name",
    service,
  ).taskArns;
  assert.equal(tasks.length, svc.desiredCount);
  const running = aws(
    "ecs",
    "describe-tasks",
    "--cluster",
    service,
    "--tasks",
    ...tasks,
  );
  assert.equal(running.failures?.length ?? 0, 0);
  const digest = aws(
    "ecr",
    "describe-images",
    "--repository-name",
    service,
    "--image-ids",
    `imageTag=${tag}`,
  ).imageDetails[0].imageDigest;
  for (const t of running.tasks) {
    assert.equal(t.taskDefinitionArn, expected);
    assert.equal(t.lastStatus, "RUNNING");
    const c = t.containers.find((c) => c.name === "api");
    assert.equal(c.image, `${repository}:${tag}`);
    assert.equal(c.imageDigest, digest);
  }
  summary(`New task definition: ${expected}\nVerified image digest: ${digest}`);
}
export function healthy(path, status, body) {
  return (
    status === 200 &&
    body.environment === "dev" &&
    (path === "ready"
      ? body.status === "ready" && body.dependencies?.mongodb === "available"
      : body.status === "ok")
  );
}
async function health() {
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      const checks = await Promise.all(
        ["health", "ready"].map(async (path) => {
          const res = await fetch(`https://api.vamberic.com/${path}`, {
            signal: AbortSignal.timeout(10000),
            redirect: "error",
          });
          return healthy(path, res.status, await res.json());
        }),
      );
      if (checks.every(Boolean)) {
        summary("API health and MongoDB readiness passed.");
        return;
      }
    } catch {
      /* Retry without logging response bodies. */
    }
    await sleep(Math.min(5000 * (attempt + 1), 15000));
  }
  throw new Error("API health/readiness failed; Vapp deployment blocked");
}
function publish() {
  const tag = validateTag(process.env.GITHUB_SHA);
  // list-images succeeds for an absent tag; permission/network errors fail closed.
  const images = aws(
    "ecr",
    "list-images",
    "--repository-name",
    service,
  ).imageIds;
  if (images.some((i) => i.imageTag === tag)) {
    summary(`Reusing immutable image ${repository}:${tag}`);
    return;
  }
  execFileSync(
    "docker",
    [
      "build",
      "--platform",
      "linux/amd64",
      "--tag",
      `${repository}:${tag}`,
      ".",
    ],
    { stdio: "inherit" },
  );
  execFileSync("docker", ["push", `${repository}:${tag}`], {
    stdio: "inherit",
  });
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const commands = { preflight, deploy, health, publish };
  assert.ok(
    Object.hasOwn(commands, process.argv[2]),
    "Unknown release command",
  );
  await commands[process.argv[2]]();
}
