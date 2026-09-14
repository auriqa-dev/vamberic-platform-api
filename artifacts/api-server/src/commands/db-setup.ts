import { MongoClient } from "mongodb";
import { loadConfig } from "../config";
import { logger } from "../lib/logger";
import { DATABASE_NAME } from "../services/mongo";
import { setupDatabase } from "../db/setup";

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new MongoClient(config.mongodbUri, {
    connectTimeoutMS: 5_000,
    serverSelectionTimeoutMS: 5_000,
  });

  try {
    await client.connect();
    const result = await setupDatabase(client.db(DATABASE_NAME));
    logger.info(
      {
        schemaVersion: result.schemaVersion,
        createdCollections: result.createdCollections,
        createdIndexes: result.createdIndexes,
      },
      "MongoDB schema setup complete",
    );
  } catch {
    // Deliberately avoid serializing Mongo driver errors: they can contain the
    // configured URI and credentials. The command's non-zero exit is enough
    // for operators; detailed diagnostics belong in the database provider.
    logger.error("MongoDB schema setup failed safely");
    process.exitCode = 1;
  } finally {
    await client.close().catch(() => undefined);
  }
}

void main();
