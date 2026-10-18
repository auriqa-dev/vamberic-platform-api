import type { Db, ClientSession } from "mongodb";
import type { ContentRecord } from "./model";
import { HiveConflict } from "../hive-definitions";
/** Full extracted text is immutable and workspace scoped; audit events retain a compact excerpt. */
export async function fullAssetText(
  db: Db,
  w: string,
  row: ContentRecord,
  session?: ClientSession,
): Promise<ContentRecord> {
  const id = row.data.contentTextId;
  if (row.kind !== "asset" || typeof id !== "string" || !id) return row;
  const source = await db
    .collection("library_text")
    .findOne({ id, workspaceId: w, assetId: row.id }, { session });
  if (!source)
    throw new HiveConflict(
      "The stored source text is unavailable. The original asset is preserved.",
    );
  return { ...row, data: { ...row.data, text: source.text } };
}

export async function requireLibrarySchema(db: Db, session?: ClientSession) {
  const ledger = await db
    .collection("schema_versions")
    .findOne({ _id: "vapp-v1" } as never, { session });
  if (![28, 29, 30].includes(ledger?.version ?? 0))
    throw new HiveConflict(
      "Library storage is awaiting the reviewed database update. Existing records are preserved.",
    );
}
