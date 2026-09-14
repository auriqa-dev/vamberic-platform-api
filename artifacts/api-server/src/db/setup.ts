import type {
  Collection,
  Db,
  Document,
  IndexDescription,
  MongoServerError,
} from "mongodb";
import {
  COLLECTION_DEFINITIONS,
  DATABASE_SCHEMA_VERSION,
  DATABASE_SCHEMA_VERSION_ID,
  SCHEMA_VERSIONS_COLLECTION,
  type CollectionDefinition,
  getDomainCollections,
} from "./collections";

export interface DatabaseSetupResult {
  createdCollections: string[];
  existingCollections: string[];
  createdIndexes: string[];
  schemaVersion: number;
}

export class IncompatibleDatabaseSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IncompatibleDatabaseSchemaError";
  }
}

type ExistingIndex = {
  name?: string;
  key?: Record<string, unknown>;
  unique?: boolean;
  sparse?: boolean;
  partialFilterExpression?: Record<string, unknown>;
};

function indexMatches(
  existing: ExistingIndex,
  expected: IndexDescription,
): boolean {
  return (
    JSON.stringify(existing.key) === JSON.stringify(expected.key) &&
    Boolean(existing.unique) === Boolean(expected.unique) &&
    Boolean(existing.sparse) === Boolean(expected.sparse) &&
    JSON.stringify(existing.partialFilterExpression) ===
      JSON.stringify(expected.partialFilterExpression)
  );
}

async function assertIndexesCompatible<TSchema extends Document>(
  collection: Collection<TSchema>,
  definition: CollectionDefinition,
): Promise<IndexDescription[]> {
  const existing = (await collection
    .listIndexes()
    .toArray()) as ExistingIndex[];
  const byName = new Map(
    existing.filter((index) => index.name).map((index) => [index.name, index]),
  );
  const missing: IndexDescription[] = [];

  for (const expected of definition.indexes) {
    const name = expected.name;
    if (!name) {
      missing.push(expected);
      continue;
    }

    const found = byName.get(name);
    if (!found) {
      missing.push(expected);
      continue;
    }
    if (!indexMatches(found, expected)) {
      throw new IncompatibleDatabaseSchemaError(
        `Index ${definition.name}.${name} has incompatible keys or options; refusing destructive migration`,
      );
    }
  }
  return missing;
}

async function listCollectionNames(db: Db): Promise<Set<string>> {
  const collections = await db
    .listCollections({}, { nameOnly: true })
    .toArray();
  return new Set(collections.map((collection) => collection.name));
}

/**
 * Creates only missing collections and indexes. It never drops, renames, or
 * rewrites domain documents. Existing indexes with changed definitions fail
 * explicitly so a reviewed migration can be authored separately.
 */
export async function setupDatabase(db: Db): Promise<DatabaseSetupResult> {
  const names = await listCollectionNames(db);
  const createdCollections: string[] = [];
  const existingCollections: string[] = [];

  if (!names.has(SCHEMA_VERSIONS_COLLECTION)) {
    await db.createCollection(SCHEMA_VERSIONS_COLLECTION);
    names.add(SCHEMA_VERSIONS_COLLECTION);
    createdCollections.push(SCHEMA_VERSIONS_COLLECTION);
  }

  // Version compatibility is a preflight check. A database created by a
  // newer application must fail before any domain collection/index mutation.
  const versions = db.collection<{
    _id: string;
    version?: number;
    schemaVersion?: number;
    appliedAt?: Date;
    updatedAt?: Date;
    collections?: string[];
  }>(SCHEMA_VERSIONS_COLLECTION);
  const current = await versions.findOne<{
    version?: number;
    schemaVersion?: number;
  }>({ _id: DATABASE_SCHEMA_VERSION_ID });
  const existingVersion = current?.version ?? current?.schemaVersion ?? 0;
  if (existingVersion > DATABASE_SCHEMA_VERSION) {
    throw new IncompatibleDatabaseSchemaError(
      `Database schema version ${existingVersion} is newer than supported version ${DATABASE_SCHEMA_VERSION}`,
    );
  }

  const pendingIndexes = new Map<CollectionDefinition, IndexDescription[]>();
  for (const definition of COLLECTION_DEFINITIONS) {
    if (!names.has(definition.name)) {
      await db.createCollection(definition.name);
      names.add(definition.name);
      createdCollections.push(definition.name);
    } else {
      existingCollections.push(definition.name);
    }
  }

  const domainCollections = getDomainCollections(db);
  for (const definition of COLLECTION_DEFINITIONS) {
    pendingIndexes.set(
      definition,
      await assertIndexesCompatible(
        domainCollections[definition.name] as unknown as Collection<Document>,
        definition,
      ),
    );
  }

  const createdIndexes: string[] = [];
  for (const definition of COLLECTION_DEFINITIONS) {
    const indexes = pendingIndexes.get(definition) ?? [];
    if (indexes.length === 0) continue;
    try {
      await domainCollections[definition.name].createIndexes(indexes);
      createdIndexes.push(
        ...indexes.map(
          (index) => `${definition.name}.${index.name ?? "unnamed"}`,
        ),
      );
    } catch (error: unknown) {
      if ((error as MongoServerError).codeName === "IndexOptionsConflict") {
        throw new IncompatibleDatabaseSchemaError(
          `Index definitions for ${definition.name} conflict with existing indexes`,
        );
      }
      throw error;
    }
  }

  const now = new Date();
  const versionDocument = {
    _id: DATABASE_SCHEMA_VERSION_ID,
    version: DATABASE_SCHEMA_VERSION,
    schemaVersion: DATABASE_SCHEMA_VERSION,
    appliedAt: now,
    collections: [
      ...COLLECTION_DEFINITIONS.map(({ name }) => name),
      SCHEMA_VERSIONS_COLLECTION,
    ],
  };
  if (!current) {
    await versions.insertOne(versionDocument);
  } else if (existingVersion < DATABASE_SCHEMA_VERSION) {
    await versions.updateOne(
      { _id: DATABASE_SCHEMA_VERSION_ID },
      {
        $set: {
          version: DATABASE_SCHEMA_VERSION,
          schemaVersion: DATABASE_SCHEMA_VERSION,
          updatedAt: now,
          collections: versionDocument.collections,
        },
      },
    );
  }

  return {
    createdCollections,
    existingCollections,
    createdIndexes,
    schemaVersion: DATABASE_SCHEMA_VERSION,
  };
}
