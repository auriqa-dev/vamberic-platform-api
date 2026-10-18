import { frozenJsonPlugin } from "./frozen-json-plugin.mjs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import { relocatablePinoPlugin } from "./relocatable-pino-plugin.mjs";
import { rm } from "node:fs/promises";

// Plugins (e.g. 'esbuild-plugin-pino') may use `require` to resolve dependencies
globalThis.require = createRequire(import.meta.url);

const artifactDir = path.dirname(fileURLToPath(import.meta.url));

async function buildAll() {
  const distDir = path.resolve(artifactDir, "dist");
  await rm(distDir, { recursive: true, force: true });

  const result = await esbuild({
    metafile: true,
    entryPoints: {
      "interaction-preparation": path.resolve(artifactDir, "src/commands/interaction-preparation.ts"),
      "nba-preparation": path.resolve(artifactDir, "src/commands/nba-preparation.ts"),
      "library": path.resolve(artifactDir, "src/commands/library.ts"),
      "backfill-contact-strategies": path.resolve(artifactDir, "src/commands/backfill-contact-strategies.ts"),
      "offer-sequence": path.resolve(artifactDir, "src/commands/offer-sequence.ts"),
      "product-profile": path.resolve(artifactDir, "src/commands/product-profile.ts"),
      "provision-hvm-client": path.resolve(artifactDir,"src/commands/provision-hvm-client.ts"),
      "brand-expression": path.resolve(
        artifactDir,
        "src/commands/brand-expression.ts",
      ),
      "onboarding-no-expiry": path.resolve(
        artifactDir,
        "src/commands/onboarding-no-expiry.ts",
      ),
      "hive-esos-repair": path.resolve(
        artifactDir,
        "src/commands/hive-esos-repair.ts",
      ),
      "hive-import-indexes": path.resolve(
        artifactDir,
        "src/commands/hive-import-indexes.ts",
      ),
      index: path.resolve(artifactDir, "src/index.ts"),
      "db-setup": path.resolve(artifactDir, "src/commands/db-setup.ts"),
    },
    platform: "node",
    bundle: true,
    format: "esm",
    outdir: distDir,
    outExtension: { ".js": ".mjs" },
    logLevel: "info",
    // Some packages may not be bundleable, so we externalize them, we can add more here as needed.
    // Some of the packages below may not be imported or installed, but we're adding them in case they are in the future.
    // Examples of unbundleable packages:
    // - uses native modules and loads them dynamically (e.g. sharp)
    // - use path traversal to read files (e.g. @google-cloud/secret-manager loads sibling .proto files)
    // AWS SDK v3 is bundled: the runtime Docker image contains dist only.
    external: [
      "*.node",
      "sharp",
      "better-sqlite3",
      "sqlite3",
      "canvas",
      "bcrypt",
      "argon2",
      "fsevents",
      "re2",
      "farmhash",
      "xxhash-addon",
      "bufferutil",
      "utf-8-validate",
      "ssh2",
      "cpu-features",
      "dtrace-provider",
      "isolated-vm",
      "lightningcss",
      "pg-native",
      "oracledb",
      "mongodb-client-encryption",
      "nodemailer",
      "handlebars",
      "knex",
      "typeorm",
      "protobufjs",
      "onnxruntime-node",
      "@tensorflow/*",
      "@prisma/client",
      "@mikro-orm/*",
      "@grpc/*",
      "@swc/*",
      "@azure/*",
      "@opentelemetry/*",
      "@google-cloud/*",
      "@google/*",
      "googleapis",
      "firebase-admin",
      "@parcel/watcher",
      "@sentry/profiling-node",
      "@tree-sitter/*",
      "aws-sdk",
      "classic-level",
      "dd-trace",
      "ffi-napi",
      "grpc",
      "hiredis",
      "kerberos",
      "leveldown",
      "miniflare",
      "mysql2",
      "newrelic",
      "odbc",
      "piscina",
      "realm",
      "ref-napi",
      "rocksdb",
      "sass-embedded",
      "sequelize",
      "serialport",
      "snappy",
      "tinypool",
      "usb",
      "workerd",
      "wrangler",
      "zeromq",
      "zeromq-prebuilt",
      "playwright",
      "puppeteer",
      "puppeteer-core",
      "electron",
    ],
    sourcemap: "linked",
    plugins: [
      frozenJsonPlugin(),
      // pino relies on workers to handle logging, instead of externalizing it we use a plugin to handle it
      relocatablePinoPlugin({ transports: ["pino-pretty"] }),
    ],
    // Make sure packages that are cjs only (e.g. express) but are bundled continue to work in our esm output file
    banner: {
      js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';

globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
    `,
    },
  });
  const api = Object.entries(result.metafile.outputs).find(([name]) => name.endsWith("/index.mjs"))?.[1];
  if (!api || Object.entries(api.inputs).some(([name, input]) =>
    input.bytesInOutput > 0 && (/\/db\/setup\.ts$/.test(name) || /frozen-v[0-9]+-(target|validators)\.json$/.test(name)))) {
    throw new Error("API runtime must not retain migration setup or frozen validator snapshots");
  }
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
