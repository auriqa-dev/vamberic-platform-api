import { isDeepStrictEqual } from "node:util";
import type { ClientSession, Db, Document } from "mongodb";
import type { MongoService } from "../../src/services/mongo";
import { EnquiryMemoryDb } from "./enquiry-db";

/** Narrow local snapshot/write-conflict model for authorization interleavings.
 * Unlike EnquiryMemoryDb's global queue, disjoint document writes may commit.
 * This is not a Mongo emulator or a claim of live replica-set verification.
 */
export function snapshotInterleaving(
  live: EnquiryMemoryDb,
  afterSnapshot: () => Promise<void>,
): { mongo: MongoService; writes: string[] } {
  const writes: string[] = [];
  return {
    writes,
    mongo: {
      ...live.mongo,
      async withTransaction<T>(
        work: (db: Db, session: ClientSession) => Promise<T>,
      ): Promise<T> {
        const before = structuredClone(live.records);
        const snapshot = new EnquiryMemoryDb();
        snapshot.records = structuredClone(before);
        let paused = false;
        const view = {
          collection(name: string) {
            const collection = snapshot.collection(name);
            return {
              ...collection,
              async updateOne(
                ...args: Parameters<typeof collection.updateOne>
              ) {
                if (!paused) {
                  paused = true;
                  await afterSnapshot();
                }
                return collection.updateOne(...args);
              },
              async insertOne(
                ...args: Parameters<typeof collection.insertOne>
              ) {
                if (!paused) {
                  paused = true;
                  await afterSnapshot();
                }
                return collection.insertOne(...args);
              },
            };
          },
        };
        const result = await work(view as unknown as Db, {} as ClientSession);
        const changes: { collection: string; id: unknown; row: Document }[] =
          [];
        for (const [collection, rows] of Object.entries(snapshot.records)) {
          for (const row of rows) {
            const id = row.id ?? row._id;
            const prior = before[collection]?.find(
              (r) => (r.id ?? r._id) === id,
            );
            if (isDeepStrictEqual(prior, row)) continue;
            const current = live
              .rows(collection)
              .find((r) => (r.id ?? r._id) === id);
            if (!isDeepStrictEqual(prior, current))
              throw new Error("Snapshot write conflict");
            changes.push({ collection, id, row });
          }
        }
        // Validate the entire write set before committing any change.
        for (const { collection, id, row } of changes) {
          const rows = live.rows(collection);
          const index = rows.findIndex((r) => (r.id ?? r._id) === id);
          if (index === -1) rows.push(structuredClone(row));
          else rows[index] = structuredClone(row);
          writes.push(`${collection}:${String(id)}`);
        }
        return result;
      },
    },
  };
}
