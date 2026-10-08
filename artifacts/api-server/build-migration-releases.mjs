import { frozenJsonPlugin } from "./frozen-json-plugin.mjs";
import { relocatablePinoPlugin } from "./relocatable-pino-plugin.mjs";
import { createRequire } from "node:module";
globalThis.require = createRequire(import.meta.url);
// Build only. No credentials, database connection, migration or deployment.
import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.dirname(fileURLToPath(import.meta.url));
const releases = [];
for (const version of [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]) {
  const outfile = path.join(root, `dist/migrations/v${version}/db-setup.mjs`);
  await mkdir(path.dirname(outfile), { recursive: true });
  await build({
    entryPoints: { "db-setup": path.join(root, "src/commands/db-setup.ts") },
    outdir: path.dirname(outfile),
    outExtension: { ".js": ".mjs" },
    plugins: [
      frozenJsonPlugin(),
      relocatablePinoPlugin({ transports: ["pino-pretty"] }),
    ],
    platform: "node",
    bundle: true,
    format: "esm",
    target: "node24",
    define: { __MIGRATION_RELEASE_TARGET__: String(version) },
    banner: {
      js: 'import {createRequire as __migrationRequire} from "node:module"; import __migrationPath from "node:path"; import {fileURLToPath as __migrationFile} from "node:url"; globalThis.require=__migrationRequire(import.meta.url); globalThis.__filename=__migrationFile(import.meta.url); globalThis.__dirname=__migrationPath.dirname(globalThis.__filename);',
    },
  });
  releases.push({
    from: version - 1,
    to: version,
    artifact: path.relative(root, outfile),
    sha256: createHash("sha256")
      .update(await readFile(outfile))
      .digest("hex"),
  });
}
await writeFile(
  path.join(root, "dist/migrations/manifest.json"),
  JSON.stringify(
    { status: "LOCAL_BUILD_ONLY_NOT_AUTHORIZED_FOR_APPLICATION", releases },
    null,
    2,
  ) + "\n",
);
console.log(JSON.stringify(releases, null, 2));
