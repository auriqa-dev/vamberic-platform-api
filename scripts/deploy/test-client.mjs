import { globSync } from "node:fs";
import { execFileSync } from "node:child_process";
const tests = globSync(
  [
    "artifacts/vapp/**/*.test.{ts,tsx}",
    "lib/api-client-react/**/*.test.{ts,tsx}",
  ],
  { exclude: ["**/node_modules/**"] },
);
if (!tests.length) throw new Error("No client tests discovered");
execFileSync(
  "pnpm",
  [
    "--filter",
    "@workspace/scripts",
    "exec",
    "node",
    "--import",
    "tsx",
    "--test",
    ...tests.map((file) => `../${file}`),
  ],
  { stdio: "inherit" },
);
