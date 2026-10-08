import { MongoClient } from "mongodb";
import { loadConfig } from "../config";
import { DATABASE_NAME } from "../services/mongo";
import { setupHiveImportIndexes } from "../db/hive-import-indexes";
const mode = process.argv[2];
if (!["--dry-run", "--apply"].includes(mode ?? ""))
  throw new Error("Use --dry-run or --apply");
const client = new MongoClient(loadConfig().mongodbUri, {
  serverSelectionTimeoutMS: 5000,
});
try {
  await client.connect();
  console.log(
    JSON.stringify(
      await setupHiveImportIndexes(
        client.db(DATABASE_NAME),
        mode === "--apply",
      ),
    ),
  );
} finally {
  await client.close();
}
