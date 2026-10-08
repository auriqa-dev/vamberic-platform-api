import { MongoClient } from "mongodb";
import manifest from "./esos-repair-manifest.json";
import {
  applyEsosRepair,
  inspectEsosRepair,
  rollbackEsosRepair,
  type RepairManifest,
} from "../services/icp/esos-repair";
const mode = process.argv[2];
if (!["--dry-run", "--apply", "--rollback"].includes(mode ?? ""))
  throw Error("Use --dry-run, --apply or --rollback");
const uri = process.env.MONGODB_URI;
if (!uri || new URL(uri).hostname !== "vamberic-studio-dev.xzauunm.mongodb.net")
  throw Error("Unexpected database target");
const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000, socketTimeoutMS: 30000 });
const deadline = setTimeout(() => { console.error("ESOS_REPAIR_TIMEOUT"); process.exit(1); }, 300000);
try {
  await client.connect();
  const db = client.db("vamberic_studio"),
    m = manifest as RepairManifest;
  if (mode === "--dry-run") {
    const r = await inspectEsosRepair(db, m);
    console.log(
      JSON.stringify({
        mode,
        total: r.total,
        supporting: r.supporting.length,
        writes: 0,
      }),
    );
  } else {
    const session = client.startSession();
    try {
      const result = await session.withTransaction(async () =>
        mode === "--apply"
          ? await applyEsosRepair(db, m, session)
          : await rollbackEsosRepair(db, m, session),
      );
      console.log(JSON.stringify({ mode, ...result }));
    } finally {
      await session.endSession();
    }
  }
} catch {
  console.error("ESOS_REPAIR_STOPPED_DETAILS_WITHHELD");
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  await client.close();
}
