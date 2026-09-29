import { HIVE_MONGO_VALIDATORS } from "./hive-validators";
import { HVM_MONGO_VALIDATORS } from "./hvm-validators";
import { BRAND_MONGO_VALIDATORS } from "./brand-validators";
import { ONBOARDING_MONGO_VALIDATORS } from "./onboarding-validators";
import { isDeepStrictEqual } from "node:util";
import { CRM_MONGO_VALIDATORS } from "./crm-validators";
import { PARTNER_MONGO_VALIDATORS } from "./partner-validators";
import { COMMERCIAL_MONGO_VALIDATORS } from "./commercial-validators";
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
  DATABASE_MIGRATION_ID,
  CRM_FOUNDATION_MIGRATION_ID,
  COMMERCIAL_FOUNDATION_MIGRATION_ID,
  BRAND_FOUNDATION_MIGRATION_ID,
  HVM_PHASE1_MIGRATION_ID,
  HIVE_FOUNDATION_MIGRATION_ID,
  SCHEMA_VERSIONS_COLLECTION,
  type CollectionDefinition,
  getDomainCollections,
} from "./collections";

const MONGO_VALIDATORS = {
  ...HIVE_MONGO_VALIDATORS,
  ...CRM_MONGO_VALIDATORS,
  ...COMMERCIAL_MONGO_VALIDATORS,
  ...PARTNER_MONGO_VALIDATORS,
  ...ONBOARDING_MONGO_VALIDATORS,
  ...BRAND_MONGO_VALIDATORS,
  ...HVM_MONGO_VALIDATORS,
};

export interface DatabaseSetupResult {
  createdCollections: string[];
  existingCollections: string[];
  createdIndexes: string[];
  schemaVersion: number;
}

export interface DatabaseSetupPlan {
  validatorsToApply: string[];
  validatorConflicts: string[];
  schemaVersion: number;
  existingCollections: string[];
  collectionsToCreate: string[];
  indexesToCreate: string[];
  incompatibleIndexes: string[];
  uniqueIndexRisks: string[];
  uniqueIndexRiskDiagnostics: {
    index: string;
    status: "confirmed-duplicate" | "no-duplicate-found" | "unable-to-confirm";
    detail: string;
  }[];
  documentCounts: Record<string, number>;
  existingSchemaVersion: number;
  compatibility:
    "new-install" | "compatible" | "upgrade-pending" | "newer-incompatible";
  missingIndexes: Record<string, IndexDescription[]>;
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
  collation?: Record<string, unknown>;
  expireAfterSeconds?: number;
  hidden?: boolean;
};

function indexMatches(
  existing: ExistingIndex,
  expected: IndexDescription,
): boolean {
  return (
    JSON.stringify(existing.key) === JSON.stringify(expected.key) &&
    JSON.stringify(existing.collation) === JSON.stringify(expected.collation) &&
    existing.expireAfterSeconds === expected.expireAfterSeconds &&
    Boolean(existing.hidden) === Boolean(expected.hidden) &&
    Boolean(existing.unique) === Boolean(expected.unique) &&
    Boolean(existing.sparse) === Boolean(expected.sparse) &&
    JSON.stringify(existing.partialFilterExpression) ===
      JSON.stringify(expected.partialFilterExpression)
  );
}

async function listCollectionNames(db: Db): Promise<Set<string>> {
  const collections = await db
    .listCollections({}, { nameOnly: true })
    .toArray();
  return new Set(collections.map((collection) => collection.name));
}

async function inspectIndexes<TSchema extends Document>(
  collection: Collection<TSchema>,
  definition: CollectionDefinition,
): Promise<{ missing: IndexDescription[]; incompatible: string[] }> {
  const existing = (await collection
    .listIndexes()
    .toArray()) as ExistingIndex[];
  const byName = new Map(
    existing.filter((index) => index.name).map((index) => [index.name, index]),
  );
  const missing: IndexDescription[] = [];
  const incompatible: string[] = [];

  for (const expected of definition.indexes) {
    const name = expected.name;
    if (!name) {
      missing.push(expected);
      continue;
    }
    const found = byName.get(name);
    if (!found) {
      const sameKeys = existing.find(
        (index) => JSON.stringify(index.key) === JSON.stringify(expected.key),
      );
      if (sameKeys && !indexMatches(sameKeys, expected)) {
        incompatible.push(
          `${definition.name}.${name} (conflicting existing key)`,
        );
      } else if (!sameKeys) {
        missing.push(expected);
      }
    } else if (!indexMatches(found, expected)) {
      incompatible.push(`${definition.name}.${name}`);
    }
  }
  return { missing, incompatible };
}

async function duplicateRisk(
  collection: Collection<Document>,
  index: IndexDescription,
): Promise<{
  status: "confirmed-duplicate" | "no-duplicate-found" | "unable-to-confirm";
  detail: string;
}> {
  const aggregate = (
    collection as unknown as {
      aggregate?: (pipeline: Document[]) => {
        toArray: () => Promise<Document[]>;
      };
    }
  ).aggregate;
  if (typeof aggregate !== "function") {
    return {
      status: "unable-to-confirm",
      detail: "aggregation is unavailable on this collection adapter",
    };
  }
  const keys = Object.keys(index.key ?? {});
  const keyDocument = Object.fromEntries(
    keys.map((field, index) => [
      `key${index}`,
      { $ifNull: [`$${field}`, null] },
    ]),
  );
  const match: Document = { ...(index.partialFilterExpression ?? {}) };
  if (index.sparse)
    match.$or = keys.map((field) => ({ [field]: { $exists: true } }));
  try {
    const rows = await aggregate
      .call(collection, [
        { $match: match },
        { $group: { _id: keyDocument, count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } },
        { $limit: 1 },
      ])
      .toArray();
    return rows.length > 0
      ? {
          status: "confirmed-duplicate",
          detail:
            "duplicate index keys were confirmed by read-only aggregation",
        }
      : {
          status: "no-duplicate-found",
          detail: "no duplicate keys were found by read-only aggregation",
        };
  } catch {
    return {
      status: "unable-to-confirm",
      detail: "read-only duplicate aggregation was unavailable",
    };
  }
}

/**
 * Read-only setup preflight. It deliberately calls no create, insert, update,
 * or index mutation APIs. In particular, an absent schema_versions collection
 * is only reported as a planned collection and is never opened for writing.
 */
export async function planDatabaseSetup(db: Db): Promise<DatabaseSetupPlan> {
  const names = await listCollectionNames(db);
  const metadata = await db.listCollections({}, { nameOnly: false }).toArray();
  const validatorsToApply: string[] = [];
  const validatorConflicts: string[] = [];
  for (const [name, validator] of Object.entries(MONGO_VALIDATORS)) {
    if (!names.has(name)) {
      validatorsToApply.push(name);
      continue;
    }
    const options = metadata.find((c) => c.name === name)?.options;
    const current = options?.validator;
    if (
      current &&
      Object.keys(current).length &&
      !isDeepStrictEqual(current, validator)
    ) {
      validatorConflicts.push(
        `${name}: existing validator differs; manual review required`,
      );
      continue;
    }
    if (
      !isDeepStrictEqual(current, validator) ||
      (options?.validationLevel ?? "strict") !== "strict" ||
      (options?.validationAction ?? "error") !== "error"
    )
      validatorsToApply.push(name);
    try {
      const invalid = await db
        .collection(name)
        .countDocuments({ $nor: [validator] });
      if (invalid)
        validatorConflicts.push(
          `${name}: ${invalid} documents incompatible with additive validator`,
        );
    } catch {
      validatorConflicts.push(
        `${name}: validator compatibility could not be checked`,
      );
    }
  }
  const collectionsToCreate = [
    ...(names.has(SCHEMA_VERSIONS_COLLECTION)
      ? []
      : [SCHEMA_VERSIONS_COLLECTION]),
  ];
  const existingCollections: string[] = [];
  const missingIndexes: Record<string, IndexDescription[]> = {};
  const indexesToCreate: string[] = [];
  const incompatibleIndexes: string[] = [];
  const uniqueIndexRisks: string[] = [];
  const uniqueIndexRiskDiagnostics: DatabaseSetupPlan["uniqueIndexRiskDiagnostics"] =
    [];
  const documentCounts: Record<string, number> = {};

  for (const definition of COLLECTION_DEFINITIONS) {
    if (!names.has(definition.name)) {
      collectionsToCreate.push(definition.name);
      missingIndexes[definition.name] = [...definition.indexes];
      indexesToCreate.push(
        ...definition.indexes.map(
          (index) => `${definition.name}.${index.name ?? "unnamed"}`,
        ),
      );
      continue;
    }
    existingCollections.push(definition.name);
    const collection = db.collection(definition.name);
    const inspection = await inspectIndexes(
      collection as unknown as Collection<Document>,
      definition,
    );
    missingIndexes[definition.name] = inspection.missing;
    incompatibleIndexes.push(...inspection.incompatible);
    indexesToCreate.push(
      ...inspection.missing.map(
        (index) => `${definition.name}.${index.name ?? "unnamed"}`,
      ),
    );
    const countDocuments = (
      collection as unknown as { countDocuments?: () => Promise<number> }
    ).countDocuments;
    if (countDocuments)
      documentCounts[definition.name] = await countDocuments.call(collection);
    for (const index of inspection.missing) {
      if (index.unique && (documentCounts[definition.name] ?? 0) > 0) {
        const indexName = `${definition.name}.${index.name ?? "unnamed"}`;
        const diagnostic = await duplicateRisk(
          collection as unknown as Collection<Document>,
          index,
        );
        uniqueIndexRiskDiagnostics.push({
          index: indexName,
          ...diagnostic,
        });
        if (diagnostic.status !== "no-duplicate-found") {
          uniqueIndexRisks.push(`${indexName}: ${diagnostic.detail}`);
        }
      }
    }
  }

  let existingSchemaVersion = 0;
  if (names.has(SCHEMA_VERSIONS_COLLECTION)) {
    const current = await db
      .collection<{ _id: string; version?: number; schemaVersion?: number }>(
        SCHEMA_VERSIONS_COLLECTION,
      )
      .findOne<{
        version?: number;
        schemaVersion?: number;
      }>({ _id: DATABASE_SCHEMA_VERSION_ID });
    existingSchemaVersion = current?.version ?? current?.schemaVersion ?? 0;
  }
  const compatibility = !names.has(SCHEMA_VERSIONS_COLLECTION)
    ? "new-install"
    : existingSchemaVersion > DATABASE_SCHEMA_VERSION
      ? "newer-incompatible"
      : existingSchemaVersion < DATABASE_SCHEMA_VERSION
        ? "upgrade-pending"
        : "compatible";

  return {
    validatorsToApply,
    validatorConflicts,
    schemaVersion: DATABASE_SCHEMA_VERSION,
    existingCollections,
    collectionsToCreate,
    indexesToCreate,
    incompatibleIndexes,
    uniqueIndexRisks,
    uniqueIndexRiskDiagnostics,
    documentCounts,
    existingSchemaVersion,
    compatibility,
    missingIndexes,
  };
}

/**
 * Applies a previously read-only-compatible additive plan. It only creates missing
 * resources and advances metadata; it never drops indexes or rewrites domain
 * documents.
 */
export async function setupDatabase(db: Db): Promise<DatabaseSetupResult> {
  const plan = await planDatabaseSetup(db);
  if (
    plan.existingSchemaVersion &&
    plan.existingSchemaVersion > DATABASE_SCHEMA_VERSION
  ) {
    throw new IncompatibleDatabaseSchemaError(
      `Database schema version ${plan.existingSchemaVersion} is newer than supported version ${DATABASE_SCHEMA_VERSION}`,
    );
  }
  if (plan.validatorConflicts.length)
    throw new IncompatibleDatabaseSchemaError(
      plan.validatorConflicts.join("; "),
    );
  if (plan.incompatibleIndexes.length > 0) {
    throw new IncompatibleDatabaseSchemaError(
      `Incompatible indexes: ${plan.incompatibleIndexes.join(", ")}`,
    );
  }
  if (plan.uniqueIndexRisks.length > 0) {
    throw new IncompatibleDatabaseSchemaError(
      `Unresolved unique index risks: ${plan.uniqueIndexRisks.join(", ")}`,
    );
  }

  const createdCollections: string[] = [];
  for (const name of plan.collectionsToCreate) {
    await db.createCollection(
      name,
      MONGO_VALIDATORS[name]
        ? {
            validator: MONGO_VALIDATORS[name],
            validationLevel: "strict",
            validationAction: "error",
          }
        : {},
    );
    createdCollections.push(name);
  }

  for (const name of plan.validatorsToApply) {
    if (!plan.collectionsToCreate.includes(name))
      await db.command({
        collMod: name,
        validator: MONGO_VALIDATORS[name],
        validationLevel: "strict",
        validationAction: "error",
      });
  }
  const domainCollections = getDomainCollections(db);
  const createdIndexes: string[] = [];
  for (const definition of COLLECTION_DEFINITIONS) {
    const indexes = plan.missingIndexes[definition.name] ?? definition.indexes;
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

  const versions = db.collection<{
    _id: string;
    version?: number;
    schemaVersion?: number;
    appliedAt?: Date;
    updatedAt?: Date;
    collections?: string[];
    migrations?: { id: string; version: number; appliedAt: Date }[];
  }>(SCHEMA_VERSIONS_COLLECTION);
  const current = await versions.findOne({ _id: DATABASE_SCHEMA_VERSION_ID });
  if (
    (current?.version ?? current?.schemaVersion ?? 0) > DATABASE_SCHEMA_VERSION
  )
    throw new IncompatibleDatabaseSchemaError(
      "Schema ledger advanced concurrently; rerun preflight",
    );
  const now = new Date();
  const managedCollections = [
    ...COLLECTION_DEFINITIONS.map(({ name }) => name),
    SCHEMA_VERSIONS_COLLECTION,
  ];
  const existingMigrations = current?.migrations ?? [];
  const requiredMigrations = [
    { id: DATABASE_MIGRATION_ID, version: 1 },
    { id: CRM_FOUNDATION_MIGRATION_ID, version: 2 },
    { id: COMMERCIAL_FOUNDATION_MIGRATION_ID, version: 3 },
    { id: BRAND_FOUNDATION_MIGRATION_ID, version: 4 },
    { id: HVM_PHASE1_MIGRATION_ID, version: 5 },
    { id: HIVE_FOUNDATION_MIGRATION_ID, version: 6 },
  ];
  const pending = requiredMigrations.filter(
    (required) => !existingMigrations.some((m) => m.id === required.id),
  );
  const migrations = [
    ...existingMigrations,
    ...pending.map((migration) => ({ ...migration, appliedAt: now })),
  ];
  const versionDocument = {
    _id: DATABASE_SCHEMA_VERSION_ID,
    version: DATABASE_SCHEMA_VERSION,
    schemaVersion: DATABASE_SCHEMA_VERSION,
    appliedAt: current?.appliedAt ?? now,
    collections: managedCollections,
    migrations,
  };
  if (!current) {
    await versions.insertOne(versionDocument);
  } else if (
    (current.version ?? current.schemaVersion ?? 0) < DATABASE_SCHEMA_VERSION ||
    pending.length > 0
  ) {
    const update = await versions.updateOne(
      {
        _id: DATABASE_SCHEMA_VERSION_ID,
        version: current.version ?? { $exists: false },
        migrations: current.migrations ?? { $exists: false },
      },
      {
        $set: {
          version: versionDocument.version,
          schemaVersion: versionDocument.schemaVersion,
          updatedAt: now,
          collections: managedCollections,
          migrations,
        },
      },
    );
    if (update.matchedCount !== 1)
      throw new IncompatibleDatabaseSchemaError(
        "Schema ledger changed concurrently; rerun preflight",
      );
  }

  return {
    createdCollections,
    existingCollections: plan.existingCollections,
    createdIndexes,
    schemaVersion: DATABASE_SCHEMA_VERSION,
  };
}
