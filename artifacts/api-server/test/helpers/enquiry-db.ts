import { isDeepStrictEqual } from "node:util";
import type { ClientSession, Db, Document } from "mongodb";
import { COLLECTION_DEFINITIONS } from "../../src/db/collections";
import type { MongoService } from "../../src/services/mongo";

function valueAt(record: Document, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (value, key) =>
        value && typeof value === "object"
          ? (value as Document)[key]
          : undefined,
      record,
    );
}
function matches(record: Document, filter: Document): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    if (key === "$or")
      return expected.some((item: Document) => matches(record, item));
    const actual = valueAt(record, key);
    if (
      expected &&
      typeof expected === "object" &&
      !(expected instanceof Date)
    ) {
      if ("$ne" in expected) return actual !== expected.$ne;
      if ("$exists" in expected)
        return (actual !== undefined) === expected.$exists;
      if ("$in" in expected)
        return Array.isArray(actual)
          ? actual.some((item) => expected.$in.includes(item))
          : expected.$in.includes(actual);
      if ("$regex" in expected)
        return (
          typeof actual === "string" &&
          new RegExp(expected.$regex, expected.$options).test(actual)
        );
      if ("$type" in expected) return typeof actual === expected.$type;
    }
    return Array.isArray(actual) && !Array.isArray(expected)
      ? actual.includes(expected)
      : isDeepStrictEqual(actual, expected);
  });
}

/** Transactional test substitute: serial isolation, rollback, partial uniqueness. */
export class EnquiryMemoryDb {
  records: Record<string, Document[]> = {};
  missingIndexes = false;
  failCollection?: string;
  failDeleteCollection?: string;
  duplicateOnce = false;
  attempts = 0;
  databaseCalls = 0;
  private queue = Promise.resolve();
  rows(name: string) {
    return (this.records[name] ??= []);
  }
  collection(name: string) {
    const indexes =
      COLLECTION_DEFINITIONS.find((item) => item.name === name)?.indexes ?? [];
    return {
      listIndexes: () => ({
        toArray: async () => (this.missingIndexes ? [] : indexes),
      }),
      find: (filter: Document = {}) => {
        let limit = Infinity;
        let offset = 0;
        let sort: Record<string, number> = {};
        const cursor = {
          limit(value: number) {
            limit = value;
            return cursor;
          },
          skip(value: number) {
            offset = value;
            return cursor;
          },
          sort(value: Record<string, number>) {
            sort = value;
            return cursor;
          },
          toArray: async () =>
            this.rows(name)
              .filter((row) => matches(row, filter))
              .sort((a, b) => {
                for (const [key, direction] of Object.entries(sort)) {
                  const left = valueAt(a, key);
                  const right = valueAt(b, key);
                  if (isDeepStrictEqual(left, right)) continue;
                  if (left === undefined) return -direction;
                  if (right === undefined) return direction;
                  return (
                    ((left as string | number) < (right as string | number)
                      ? -1
                      : 1) * direction
                  );
                }
                return 0;
              })
              .slice(offset, offset + limit),
        };
        return cursor;
      },
      findOne: async (filter: Document) => {
        return this.rows(name).find((row) => matches(row, filter)) ?? null;
      },
      insertOne: async (record: Document) => {
        if (this.failCollection === name)
          throw new Error(
            "mongodb://secret@example.invalid email=private@example.invalid",
          );
        if (this.duplicateOnce && name === "contact_points") {
          this.duplicateOnce = false;
          throw Object.assign(
            new Error("duplicate key private@example.invalid"),
            { code: 11000 },
          );
        }
        for (const index of indexes) {
          const filter = index.partialFilterExpression ?? {};
          if (!index.unique || !matches(record, filter)) continue;
          if (
            this.rows(name).some(
              (row) =>
                matches(row, filter) &&
                Object.keys(index.key).every((key) =>
                  isDeepStrictEqual(valueAt(row, key), valueAt(record, key)),
                ),
            )
          )
            throw Object.assign(new Error("duplicate key"), { code: 11000 });
        }
        this.rows(name).push(record);
        return { acknowledged: true };
      },
      updateOne: async (filter: Document, update: Document) => {
        const record = this.rows(name).find((row) => matches(row, filter));
        if (!record) return { matchedCount: 0 };
        Object.assign(record, update.$set);
        return { matchedCount: 1 };
      },
      deleteMany: async (filter: Document) => {
        if (this.failDeleteCollection === name)
          throw new Error("private@example.com internal Mongo failure");
        const before = this.rows(name).length;
        this.records[name] = this.rows(name).filter(
          (row) => !matches(row, filter),
        );
        return { deletedCount: before - this.records[name].length };
      },
      countDocuments: async (filter: Document = {}) => {
        return this.rows(name).filter((row) => matches(row, filter)).length;
      },
    };
  }
  readonly mongo: MongoService = {
    isAvailable: async () => true,
    database: async () => {
      this.databaseCalls++;
      return this as unknown as Db;
    },
    close: async () => undefined,
    withTransaction: async <T>(
      work: (db: Db, session: ClientSession) => Promise<T>,
    ): Promise<T> => {
      const previous = this.queue;
      let release!: () => void;
      this.queue = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      this.attempts++;
      const before = structuredClone(this.records);
      try {
        return await work(this as unknown as Db, {} as ClientSession);
      } catch (error) {
        this.records = before;
        throw error;
      } finally {
        release();
      }
    },
  };
}
