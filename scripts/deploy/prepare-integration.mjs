import { createHash } from "node:crypto";
import { readFileSync, mkdirSync, existsSync, symlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const fixture = resolve(root, "scripts/deploy/fixtures");
const target = resolve(root, ".integration");
const manifest = JSON.parse(readFileSync(resolve(fixture, "manifest.json")));
mkdirSync(target, { recursive: true });
for (const [name, expected] of Object.entries(manifest.archives)) {
  const archive = resolve(fixture, name);
  if (
    createHash("sha256").update(readFileSync(archive)).digest("hex") !==
    expected
  )
    throw new Error(`Integration snapshot checksum mismatch: ${name}`);
  execFileSync("tar", ["-xzf", archive, "-C", target]);
}
// Reuse the repository's frozen dependency graph, including Zod's major-version boundary.
for (const [project, packages] of Object.entries({
  "hvm-app-legacy-psu": { zod: "api-server/node_modules/zod" },
  "hvm-app": {
    "react-router-dom": "api-server/node_modules/react-router-dom",
    zod: "api-server/node_modules/zod",
    react: "vapp/node_modules/react",
    "react-dom": "vapp/node_modules/react-dom",
  },
  "vamberic-agent-runtime": {
    zod: "api-server/node_modules/zod4",
    parse5: "api-server/node_modules/parse5",
    "@aws-sdk/client-sqs": "api-server/node_modules/@aws-sdk/client-sqs",
    "@aws-sdk/client-secrets-manager":
      "api-server/node_modules/@aws-sdk/client-secrets-manager",
  },
})) {
  for (const [name, source] of Object.entries(packages)) {
    const destination = resolve(target, project, "node_modules", name);
    mkdirSync(resolve(destination, ".."), { recursive: true });
    if (!existsSync(destination))
      symlinkSync(resolve(root, "artifacts", source), destination, "dir");
  }
}
console.log("Verified integration snapshots prepared inside the API checkout.");
