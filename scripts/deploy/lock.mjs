import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
const bucket = "vamberic-dev-release-locks-755905325223",
  key = "hvm-api-worker.json";
const receipt = ".release-lock-receipt.json",
  body = ".release-lock-body.json";
function aws(args) {
  try {
    return JSON.parse(
      execFileSync(
        "aws",
        [...args, "--region", "eu-west-2", "--output", "json"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      ).trim() || "{}",
    );
  } catch {
    throw new Error(
      "Release lock operation failed; do not bypass or forcibly clear an unreviewed lock",
    );
  }
}
if (globalThis.process.argv[2] === "acquire") {
  if (existsSync(receipt)) throw new Error("Local lock receipt already exists");
  writeFileSync(
    body,
    JSON.stringify({
      owner: randomUUID(),
      repository: globalThis.process.env.GITHUB_REPOSITORY,
      run: globalThis.process.env.GITHUB_RUN_ID,
      commit: globalThis.process.env.GITHUB_SHA,
    }),
  );
  const result = aws([
    "s3api",
    "put-object",
    "--bucket",
    bucket,
    "--key",
    key,
    "--body",
    body,
    "--if-none-match",
    "*",
    "--server-side-encryption",
    "AES256",
  ]);
  writeFileSync(receipt, JSON.stringify({ etag: result.ETag }));
  unlinkSync(body);
  globalThis.console.log("Acquired shared API/worker release lock");
} else if (globalThis.process.argv[2] === "release") {
  if (existsSync(receipt)) {
    const r = JSON.parse(readFileSync(receipt));
    aws([
      "s3api",
      "delete-object",
      "--bucket",
      bucket,
      "--key",
      key,
      "--if-match",
      r.etag,
    ]);
    unlinkSync(receipt);
    globalThis.console.log("Released owned lock");
  }
} else throw new Error("Expected acquire or release");
