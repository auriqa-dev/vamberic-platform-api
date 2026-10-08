import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
const root = new URL("../lib/agent-runtime-protocol/", import.meta.url);
const manifest = JSON.parse(
  readFileSync(new URL("provenance.json", root), "utf8"),
);
for (const [source, expected] of Object.entries(manifest.files)) {
  const local = source.startsWith("dist/contracts/")
    ? source.replace("dist/", "")
    : source.startsWith("contracts/fixtures/v1.1/")
      ? source.replace("contracts/fixtures/v1.1/", "fixtures/")
      : source.startsWith("contracts/fixtures/v1.2/")
        ? source.replace("contracts/fixtures/v1.2/", "fixtures/v1.2/")
        : source.startsWith("contracts/fixtures/v1/")
          ? source.replace("contracts/fixtures/v1/", "historical/v1.0/")
          : source.startsWith("contracts/json-schema/")
            ? source.replace("contracts/", "")
            : source.replace("contracts/", "source/");
  for (const path of [
    new URL(local, root),
    ...(process.argv[2] ? [resolve(process.argv[2], source)] : []),
  ]) {
    if (
      createHash("sha256").update(readFileSync(path)).digest("hex") !== expected
    )
      throw new Error(`Runtime protocol artifact drift: ${source}`);
  }
}
console.log(
  `Protocol ${manifest.protocolVersion}: ${Object.keys(manifest.files).length} files verified${process.argv[2] ? " against upstream" : ""}`,
);
