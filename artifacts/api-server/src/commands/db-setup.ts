import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";
import { loadConfig, type AppConfig } from "../config";
import { planDatabaseSetup, setupDatabase } from "../db/setup";
import { logger } from "../lib/logger";
import { DATABASE_NAME } from "../services/mongo";

export type SetupMode = "dry-run" | "apply";
export const SETUP_USAGE =
  "Usage: db:setup --dry-run (read-only preflight) | db:setup --apply";

export interface SetupClient {
  connect(): Promise<unknown>;
  db(name: string): import("mongodb").Db;
  close(): Promise<void>;
}

export interface DatabaseSetupCommandDependencies {
  loadConfig: () => AppConfig;
  createClient: (uri: string) => SetupClient;
  logger: Pick<typeof logger, "info" | "error">;
}

const defaultDependencies: DatabaseSetupCommandDependencies = {
  loadConfig,
  createClient: (uri) =>
    new MongoClient(uri, {
      connectTimeoutMS: 5_000,
      serverSelectionTimeoutMS: 5_000,
    }),
  logger,
};

export function parseSetupMode(args: readonly string[]): SetupMode {
  if (args.length !== 1 || (args[0] !== "--dry-run" && args[0] !== "--apply")) {
    throw new Error(SETUP_USAGE);
  }
  return args[0] === "--dry-run" ? "dry-run" : "apply";
}

export async function runDatabaseSetup(
  mode: SetupMode,
  dependencies: DatabaseSetupCommandDependencies = defaultDependencies,
): Promise<void> {
  let client: SetupClient | undefined;
  try {
    const config = dependencies.loadConfig();
    client = dependencies.createClient(config.mongodbUri);
    await client.connect();
    const db = client.db(DATABASE_NAME);
    if (mode === "dry-run") {
      const plan = await planDatabaseSetup(db);
      dependencies.logger.info(
        {
          schemaVersion: plan.schemaVersion,
          existingCollections: plan.existingCollections,
          collectionsToCreate: plan.collectionsToCreate,
          indexesToCreate: plan.indexesToCreate,
          incompatibleIndexes: plan.incompatibleIndexes,
          uniqueIndexRisks: plan.uniqueIndexRisks,
          uniqueIndexRiskDiagnostics: plan.uniqueIndexRiskDiagnostics,
          existingSchemaVersion: plan.existingSchemaVersion,
          compatibility: plan.compatibility,
          documentCounts: plan.documentCounts,
        },
        "MongoDB schema preflight complete; no changes made",
      );
      return;
    }

    const result = await setupDatabase(db);
    dependencies.logger.info(
      {
        schemaVersion: result.schemaVersion,
        createdCollections: result.createdCollections,
        createdIndexes: result.createdIndexes,
      },
      "MongoDB schema setup complete",
    );
  } catch {
    // Never serialize Mongo driver errors: they can include the configured URI
    // and credentials. The command's non-zero exit is enough for operators.
    dependencies.logger.error("MongoDB schema setup failed safely");
    process.exitCode = 1;
  } finally {
    await client?.close().catch(() => undefined);
  }
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  let mode: SetupMode;
  try {
    mode = parseSetupMode(args);
  } catch {
    logger.error(SETUP_USAGE);
    process.exitCode = 2;
    return;
  }
  await runDatabaseSetup(mode);
}

const invokedScript = process.argv[1];
if (invokedScript && fileURLToPath(import.meta.url) === invokedScript) {
  void main();
}
