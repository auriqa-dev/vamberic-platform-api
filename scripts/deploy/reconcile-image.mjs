import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  parameter,
  repository,
  validateDigest,
  validateTemplate,
} from "./release.mjs";

// Offline preparation only. No AWS client, subprocess, deployment or secret lookup.
export function reconcileImage(template, expectedImage) {
  assert.ok(
    expectedImage.startsWith(`${repository}@`),
    "Unexpected image repository",
  );
  const digest = validateDigest(expectedImage.slice(repository.length + 1));
  const candidate = structuredClone(template);
  assert.equal(
    candidate.Parameters?.[parameter],
    undefined,
    "Already reconciled; inspect current state",
  );
  const tasks = Object.values(candidate.Resources).filter(
    (r) => r.Type === "AWS::ECS::TaskDefinition",
  );
  assert.equal(tasks.length, 1);
  const containers = tasks[0].Properties.ContainerDefinitions.filter(
    (c) => c.Name === "api",
  );
  assert.equal(containers.length, 1);
  assert.equal(
    containers[0].Image,
    expectedImage,
    "Live predecessor changed; refresh review",
  );
  containers[0].Image = {
    "Fn::Join": ["", [`${repository}@`, { Ref: parameter }]],
  };
  delete candidate.Parameters.ApiImageTag;
  assert.ok(
    !JSON.stringify(candidate).includes("ApiImageTag"),
    "Legacy parameter has other consumers",
  );
  candidate.Parameters[parameter] = {
    Type: "String",
    AllowedPattern: "sha256:[a-f0-9]{64}",
    Description:
      "Immutable API image digest; retained across infrastructure deployments",
    ConstraintDescription:
      "Use the verified SHA-256 digest from the existing API repository.",
  };
  validateTemplate(candidate);
  return {
    template: candidate,
    parameter: { ParameterKey: parameter, ParameterValue: digest },
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [input, expectedImage, output] = process.argv.slice(2);
  assert.ok(
    input && expectedImage && output,
    "Usage: reconcile-image.mjs template.json expected-image output.json",
  );
  const result = reconcileImage(
    JSON.parse(readFileSync(input, "utf8")),
    expectedImage,
  );
  // Templates can contain private runtime configuration. Never print their contents.
  writeFileSync(output, JSON.stringify(result, null, 2), {
    mode: 0o600,
    flag: "wx",
  });
  console.log(
    "Offline candidate prepared; no AWS operations performed. Review before separately authorised application.",
  );
}
