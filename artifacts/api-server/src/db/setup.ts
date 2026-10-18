import { extendInteractionValidators } from "./interaction-v30";
import { extendNbaPreparationValidators, withApprovedIcpRecovery } from "./nba-preparation-v29";
import { LIBRARY_MIGRATION_ID, LIBRARY_COLLECTIONS, LIBRARY_VALIDATORS } from "./library-v28";
import {
  OFFER_SEQUENCE_MIGRATION_ID,
  extendOfferSequenceValidators,
} from "./offer-sequence-v27";
import {
  PRODUCT_PROFILE_MIGRATION_ID,
  extendProductValidators,
} from "./product-profile-v26";
import {
  BRAND_EXPRESSION_MIGRATION_ID,
  BRAND_EXPRESSION_STRUCTURE,
} from "./brand-expression-v25";
import {
  ONBOARDING_NO_EXPIRY_MIGRATION_ID,
  ONBOARDING_NO_EXPIRY_VALIDATOR,
} from "./client-onboarding-v24";
import {
  EXECUTION_EVIDENCE_MIGRATION_ID,
  EXECUTION_EVIDENCE_VALIDATORS,
  EXECUTION_EVIDENCE_COLLECTIONS,
} from "./agent-execution-evidence-v23";
import {
  AGENT_CAPACITY_MIGRATION_ID,
  AGENT_CAPACITY_VALIDATORS,
  AGENT_CAPACITY_COLLECTIONS,
} from "./agent-capacity-v22";
import {
  CLIENT_ONBOARDING_MIGRATION_ID,
  CLIENT_ONBOARDING_VALIDATOR,
  CLIENT_ONBOARDING_COLLECTION,
} from "./client-onboarding-v21";
import frozenV19Target from "./frozen-v19-target.json";
import {
  ACTION_NUMERIC_V20_MIGRATION_ID,
  ACTION_NUMERIC_V20_VALIDATORS,
} from "./action-numeric-v20";
import frozenV18Target from "./frozen-v18-target.json";
import {
  WORKSPACE_BILLING_MIGRATION_ID,
  WORKSPACE_BILLING_VALIDATOR,
} from "./workspace-billing-v19";
import frozenV17Target from "./frozen-v17-target.json";
import { CANONICAL_SUPPORT_MIGRATION_ID } from "./canonical-support-v18";
import frozenV16Target from "./frozen-v16-target.json";
import { ACTION_LIBRARY_V17_MIGRATION_ID } from "./action-library-v17";
import { V14_SETUP_COLLECTIONS, V15_SETUP_COLLECTIONS } from "./collections";
import frozenV12Target from "./frozen-v12-target.json";
import frozenV13Target from "./frozen-v13-target.json";
import {
  V16_MIGRATION_ID,
  V16_BUDGET_VALIDATORS,
  v16IdentityValidators,
} from "./agent-foundation-v16";
import frozenV14 from "./frozen-v14-validators.json";
import frozenV15 from "./frozen-v15-validators.json";
import {
  isV14Predecessor,
  COMMERCIAL_OUTCOMES_V15_MIGRATION_ID,
} from "./commercial-outcomes-v15";
import {
  IDENTITY_VALUE_V14_MIGRATION_ID,
  V14_VALIDATORS,
  isV13Predecessor,
} from "./identity-value-v14";
import {
  REASONING_MIGRATION_ID,
  REASONING_VALIDATORS,
  REASONING_V12_PREDECESSORS,
} from "./reasoning-foundation";
import {
  isProtocolV11Predecessor,
  historicalProtocolValidator,
} from "./protocol-v12-migration";
import { EFFECTIVENESS_VALIDATORS } from "./agent-effectiveness-validators";
import { AGENT_CONTROL_PLANE_VALIDATORS } from "./agent-control-plane-validators";
import {
  EXECUTION_SERIALIZATION_VALIDATORS,
  EXECUTION_SERIALIZATION_PREDECESSORS,
} from "./execution-serialization-validators";
import { WORKSPACE_MEMBERSHIP_OPERATOR_VALIDATOR } from "./agent-operator-validators";
import { CONTROL_PLANE_OPERATING_MONGO_VALIDATORS } from "./operating-validators";
import { OPERATING_MONGO_VALIDATORS } from "./operating-validators";
import { OFFER_MONGO_VALIDATORS } from "./offer-validators";
import { HIVE_V6_MONGO_VALIDATORS } from "./hive-validators-v6";
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
  DATABASE_SCHEMA_VERSION_ID,
  DATABASE_MIGRATION_ID,
  CRM_FOUNDATION_MIGRATION_ID,
  COMMERCIAL_FOUNDATION_MIGRATION_ID,
  BRAND_FOUNDATION_MIGRATION_ID,
  HVM_PHASE1_MIGRATION_ID,
  HIVE_FOUNDATION_MIGRATION_ID,
  HIVE_VALIDATOR_CORRECTION_MIGRATION_ID,
  OFFER_FOUNDATION_MIGRATION_ID,
  OPERATING_FOUNDATION_MIGRATION_ID,
  AGENT_CONTROL_PLANE_MIGRATION_ID,
  EFFECTIVENESS_MIGRATION_ID,
  PROTOCOL_V12_MIGRATION_ID,
  SCHEMA_VERSIONS_COLLECTION,
  type CollectionDefinition,
} from "./collections";

export const CURRENT_BASE_VALIDATORS: Record<string, Document> = {
  ...OPERATING_MONGO_VALIDATORS,
  ...OFFER_MONGO_VALIDATORS,
  ...HIVE_MONGO_VALIDATORS,
  ...CRM_MONGO_VALIDATORS,
  ...COMMERCIAL_MONGO_VALIDATORS,
  ...PARTNER_MONGO_VALIDATORS,
  ...ONBOARDING_MONGO_VALIDATORS,
  ...BRAND_MONGO_VALIDATORS,
  ...HVM_MONGO_VALIDATORS,
  ...CONTROL_PLANE_OPERATING_MONGO_VALIDATORS,
  ...EXECUTION_SERIALIZATION_VALIDATORS,
  workspace_memberships: WORKSPACE_MEMBERSHIP_OPERATOR_VALIDATOR,
  ...AGENT_CONTROL_PLANE_VALIDATORS,
  ...EFFECTIVENESS_VALIDATORS,
  ...REASONING_VALIDATORS,
  ...V14_VALIDATORS,
};
export const V14_SETUP_VALIDATORS: Record<string, Document> =
  structuredClone(frozenV14);
export const V15_SETUP_VALIDATORS: Record<string, Document> =
  structuredClone(frozenV15);
export const AGENT_VALIDATOR_PREDECESSORS: Record<string, Document> = {
  ...EXECUTION_SERIALIZATION_PREDECESSORS,
  ...Object.fromEntries(
    Object.entries(OPERATING_MONGO_VALIDATORS).filter(
      ([name, validator]) =>
        !isDeepStrictEqual(
          validator,
          CONTROL_PLANE_OPERATING_MONGO_VALIDATORS[name],
        ),
    ),
  ),
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
export interface DatabaseSetupTarget {
  version: number;
  ordered?: boolean;
  /** Scoped additive releases still inspect all metadata, but scan only changed validators. */
  changedRecordsOnly?: boolean;
  validators: Record<string, Document>;
  collections: readonly CollectionDefinition[];
}
/** Code-owned target injection for historical migration verification; not an API/CLI selector. */
export function createDatabaseSetup(target: DatabaseSetupTarget) {
  const DATABASE_SCHEMA_VERSION = target.version;
  let predecessorValidators: Record<string, Document> | undefined;
  let recoveryValidators: Record<string, Document> | undefined;
  const matchesPredecessor = (name:string,current:unknown) => {
    const prior = predecessorValidators ??= releaseDatabaseTarget((DATABASE_SCHEMA_VERSION - 1) as 25).validators;
    return isDeepStrictEqual(current,prior[name]) || (DATABASE_SCHEMA_VERSION===29 && isDeepStrictEqual(current,(recoveryValidators ??= withApprovedIcpRecovery(prior))[name]));
  };
  const MONGO_VALIDATORS = target.validators;
  const COLLECTION_DEFINITIONS = target.collections;
  const requiredMigrations = [
    { id: DATABASE_MIGRATION_ID, version: 1 },
    { id: CRM_FOUNDATION_MIGRATION_ID, version: 2 },
    { id: COMMERCIAL_FOUNDATION_MIGRATION_ID, version: 3 },
    { id: BRAND_FOUNDATION_MIGRATION_ID, version: 4 },
    { id: HVM_PHASE1_MIGRATION_ID, version: 5 },
    { id: HIVE_FOUNDATION_MIGRATION_ID, version: 6 },
    { id: HIVE_VALIDATOR_CORRECTION_MIGRATION_ID, version: 7 },
    { id: OFFER_FOUNDATION_MIGRATION_ID, version: 8 },
    { id: OPERATING_FOUNDATION_MIGRATION_ID, version: 9 },
    { id: AGENT_CONTROL_PLANE_MIGRATION_ID, version: 10 },
    { id: EFFECTIVENESS_MIGRATION_ID, version: 11 },
    { id: PROTOCOL_V12_MIGRATION_ID, version: 12 },
    { id: REASONING_MIGRATION_ID, version: 13 },
    { id: IDENTITY_VALUE_V14_MIGRATION_ID, version: 14 },
    { id: COMMERCIAL_OUTCOMES_V15_MIGRATION_ID, version: 15 },
    { id: V16_MIGRATION_ID, version: 16 },
    { id: ACTION_LIBRARY_V17_MIGRATION_ID, version: 17 },
    { id: CANONICAL_SUPPORT_MIGRATION_ID, version: 18 },
    { id: WORKSPACE_BILLING_MIGRATION_ID, version: 19 },
    { id: ACTION_NUMERIC_V20_MIGRATION_ID, version: 20 },
    { id: CLIENT_ONBOARDING_MIGRATION_ID, version: 21 },
    { id: AGENT_CAPACITY_MIGRATION_ID, version: 22 },
    { id: EXECUTION_EVIDENCE_MIGRATION_ID, version: 23 },
    { id: ONBOARDING_NO_EXPIRY_MIGRATION_ID, version: 24 },
    { id: BRAND_EXPRESSION_MIGRATION_ID, version: 25 },
    { id: PRODUCT_PROFILE_MIGRATION_ID, version: 26 },
    { id: OFFER_SEQUENCE_MIGRATION_ID, version: 27 },
    { id: LIBRARY_MIGRATION_ID, version: 28 },
    { id: "029-nba-preparation", version: 29 },
    { id: "030-interaction-brand-kit", version: 30 },
  ];
  async function planDatabaseSetup(db: Db): Promise<DatabaseSetupPlan> {
    const names = await listCollectionNames(db);
    const metadata = await db
      .listCollections({}, { nameOnly: false })
      .toArray();
    let existingSchemaVersion = 0;
    let inconsistentSchemaVersions = false;
    let existingMigrationHistory: { id: string; version: number }[] = [];
    if (names.has(SCHEMA_VERSIONS_COLLECTION)) {
      const current = await db
        .collection<{ _id: string; version?: number; schemaVersion?: number }>(
          SCHEMA_VERSIONS_COLLECTION,
        )
        .findOne<{
          version?: number;
          schemaVersion?: number;
          migrations?: { id: string; version: number }[];
        }>({ _id: DATABASE_SCHEMA_VERSION_ID });
      inconsistentSchemaVersions =
        current?.version !== undefined &&
        current?.schemaVersion !== undefined &&
        current.version !== current.schemaVersion;
      existingSchemaVersion = current?.version ?? current?.schemaVersion ?? 0;
      existingMigrationHistory = current?.migrations ?? [];
    }
    const validatorsToApply: string[] = [];
    const validatorConflicts: string[] = [];
    if (
      DATABASE_SCHEMA_VERSION === 23 &&
      ![22, 23].includes(existingSchemaVersion)
    )
      validatorConflicts.push("v23 requires installed ordered v22 or v23");
    if (
      DATABASE_SCHEMA_VERSION === 22 &&
      ![21, 22].includes(existingSchemaVersion)
    )
      validatorConflicts.push("v22 requires installed ordered v21 or v22");
    if (
      DATABASE_SCHEMA_VERSION === 21 &&
      ![20, 21].includes(existingSchemaVersion)
    )
      validatorConflicts.push("v21 requires installed ordered v20 or v21");
    if (
      target.ordered &&
      existingSchemaVersion !== 0 &&
      (![target.version - 1, target.version].includes(existingSchemaVersion) ||
        inconsistentSchemaVersions ||
        !isDeepStrictEqual(
          existingMigrationHistory.map(({ id, version }) => ({ id, version })),
          requiredMigrations.filter((m) => m.version <= existingSchemaVersion),
        ))
    )
      validatorConflicts.push(
        "Release artifact requires its exact ordered predecessor or installed target",
      );
    if (DATABASE_SCHEMA_VERSION >= 15 && inconsistentSchemaVersions)
      validatorConflicts.push(
        "Conflicting schema version fields; migration requires a consistent ledger",
      );
    if (
      DATABASE_SCHEMA_VERSION === 15 &&
      existingSchemaVersion > 0 &&
      existingSchemaVersion < 14
    )
      validatorConflicts.push(
        "v15 requires the reviewed v12 → v13 → v14 predecessors; upgrade to schema 14 with their qualified releases first",
      );
    if (
      DATABASE_SCHEMA_VERSION === 15 &&
      [14, 15].includes(existingSchemaVersion) &&
      !isDeepStrictEqual(
        existingMigrationHistory.map(({ id, version }) => ({ id, version })),
        requiredMigrations.filter((m) => m.version <= existingSchemaVersion),
      )
    )
      validatorConflicts.push(
        "v15 requires exact ordered migration history through the installed schema",
      );
    if (DATABASE_SCHEMA_VERSION === 16 && existingSchemaVersion !== 0) {
      if (
        ![15, 16].includes(existingSchemaVersion) ||
        inconsistentSchemaVersions ||
        !isDeepStrictEqual(
          existingMigrationHistory.map(({ id, version }) => ({ id, version })),
          requiredMigrations.filter((m) => m.version <= existingSchemaVersion),
        )
      )
        validatorConflicts.push(
          "v16 requires exact ordered reviewed predecessors through v15 and consistent schema ledger",
        );
    }
    if (
      DATABASE_SCHEMA_VERSION === 17 &&
      existingSchemaVersion !== 0 &&
      (![16, 17].includes(existingSchemaVersion) ||
        inconsistentSchemaVersions ||
        !isDeepStrictEqual(
          existingMigrationHistory.map(({ id, version }) => ({ id, version })),
          requiredMigrations.filter((m) => m.version <= existingSchemaVersion),
        ))
    )
      validatorConflicts.push(
        "v17 requires exact ordered reviewed predecessors through v16 and consistent schema ledger",
      );
    if (
      DATABASE_SCHEMA_VERSION === 18 &&
      existingSchemaVersion !== 0 &&
      (![17, 18].includes(existingSchemaVersion) ||
        inconsistentSchemaVersions ||
        !isDeepStrictEqual(
          existingMigrationHistory.map(({ id, version }) => ({ id, version })),
          requiredMigrations.filter((m) => m.version <= existingSchemaVersion),
        ))
    )
      validatorConflicts.push(
        "v18 requires exact ordered reviewed predecessors through v17 and consistent schema ledger",
      );
    if (
      DATABASE_SCHEMA_VERSION === 19 &&
      existingSchemaVersion !== 0 &&
      (![18, 19].includes(existingSchemaVersion) ||
        inconsistentSchemaVersions ||
        !isDeepStrictEqual(
          existingMigrationHistory.map(({ id, version }) => ({ id, version })),
          requiredMigrations.filter((m) => m.version <= existingSchemaVersion),
        ))
    )
      validatorConflicts.push(
        "v19 requires exact ordered predecessor v18 and consistent schema ledger",
      );
    if (
      DATABASE_SCHEMA_VERSION === 20 &&
      existingSchemaVersion !== 0 &&
      (![19, 20].includes(existingSchemaVersion) ||
        inconsistentSchemaVersions ||
        !isDeepStrictEqual(
          existingMigrationHistory.map(({ id, version }) => ({ id, version })),
          requiredMigrations.filter((m) => m.version <= existingSchemaVersion),
        ))
    )
      validatorConflicts.push(
        "v20 requires exact ordered predecessor v19 and consistent schema ledger",
      );
    for (const [name, validator] of Object.entries(MONGO_VALIDATORS)) {
      if (!names.has(name)) {
        validatorsToApply.push(name);
        continue;
      }
      const options = metadata.find((c) => c.name === name)?.options;
      const current = options?.validator;
      if (
        [25, 26, 27, 28, 29, 30].includes(DATABASE_SCHEMA_VERSION) &&
        (!(existingSchemaVersion === DATABASE_SCHEMA_VERSION - 1
          ? matchesPredecessor(name,current)
          : isDeepStrictEqual(current,validator)) ||
          (options?.validationLevel ?? "strict") !== "strict" ||
          (options?.validationAction ?? "error") !== "error")
      )
        validatorConflicts.push(
          name +
            `: v${DATABASE_SCHEMA_VERSION} requires exact predecessor validators`,
        );

      if (
        DATABASE_SCHEMA_VERSION === 24 &&
        (!isDeepStrictEqual(
          current,
          existingSchemaVersion === 23
            ? releaseDatabaseTarget(23).validators[name]
            : validator,
        ) ||
          (options?.validationLevel ?? "strict") !== "strict" ||
          (options?.validationAction ?? "error") !== "error")
      )
        validatorConflicts.push(
          `${name}: v24 requires exact reviewed predecessor validators`,
        );
      if (
        [21, 22, 23].includes(DATABASE_SCHEMA_VERSION) &&
        (!isDeepStrictEqual(current, validator) ||
          (options?.validationLevel ?? "strict") !== "strict" ||
          (options?.validationAction ?? "error") !== "error")
      )
        validatorConflicts.push(
          `${name}: v${DATABASE_SCHEMA_VERSION} requires exact canonical installed validators and strict/error mode`,
        );
      if (
        current &&
        !(
          [25, 26, 27, 28, 29, 30].includes(DATABASE_SCHEMA_VERSION) &&
          existingSchemaVersion === DATABASE_SCHEMA_VERSION - 1 &&
          matchesPredecessor(name,current) &&
          (options?.validationLevel ?? "strict") === "strict" &&
          (options?.validationAction ?? "error") === "error"
        ) &&
        Object.keys(current).length &&
        !isDeepStrictEqual(current, validator) &&
        !(
          DATABASE_SCHEMA_VERSION === 24 &&
          existingSchemaVersion === 23 &&
          isDeepStrictEqual(
            current,
            releaseDatabaseTarget(23).validators[name],
          ) &&
          (options?.validationLevel ?? "strict") === "strict" &&
          (options?.validationAction ?? "error") === "error"
        ) &&
        !(
          existingSchemaVersion === 14 &&
          isV14Predecessor(name, current) &&
          (options?.validationLevel ?? "strict") === "strict" &&
          (options?.validationAction ?? "error") === "error"
        ) &&
        !(
          DATABASE_SCHEMA_VERSION === 20 &&
          existingSchemaVersion === 19 &&
          isDeepStrictEqual(
            current,
            (frozenV19Target.validators as Record<string, Document>)[name],
          ) &&
          (options?.validationLevel ?? "strict") === "strict" &&
          (options?.validationAction ?? "error") === "error"
        ) &&
        !(
          DATABASE_SCHEMA_VERSION === 19 &&
          existingSchemaVersion === 18 &&
          isDeepStrictEqual(
            current,
            (frozenV18Target.validators as Record<string, Document>)[name],
          ) &&
          (options?.validationLevel ?? "strict") === "strict" &&
          (options?.validationAction ?? "error") === "error"
        ) &&
        !(
          DATABASE_SCHEMA_VERSION === 18 &&
          existingSchemaVersion === 17 &&
          isDeepStrictEqual(
            current,
            (frozenV17Target.validators as Record<string, Document>)[name],
          ) &&
          (options?.validationLevel ?? "strict") === "strict" &&
          (options?.validationAction ?? "error") === "error"
        ) &&
        !(
          DATABASE_SCHEMA_VERSION === 17 &&
          existingSchemaVersion === 16 &&
          isDeepStrictEqual(
            current,
            (frozenV16Target.validators as Record<string, Document>)[name],
          ) &&
          (options?.validationLevel ?? "strict") === "strict" &&
          (options?.validationAction ?? "error") === "error"
        ) &&
        !(
          DATABASE_SCHEMA_VERSION === 16 &&
          existingSchemaVersion === 15 &&
          isDeepStrictEqual(current, V15_SETUP_VALIDATORS[name]) &&
          (options?.validationLevel ?? "strict") === "strict" &&
          (options?.validationAction ?? "error") === "error"
        ) &&
        !(
          existingSchemaVersion === 13 &&
          isV13Predecessor(name, current) &&
          (options?.validationLevel ?? "strict") === "strict" &&
          (options?.validationAction ?? "error") === "error"
        ) &&
        !(
          existingSchemaVersion === 12 &&
          isDeepStrictEqual(current, REASONING_V12_PREDECESSORS[name]) &&
          (options?.validationLevel ?? "strict") === "strict" &&
          (options?.validationAction ?? "error") === "error"
        ) &&
        !(
          existingSchemaVersion === 11 &&
          isProtocolV11Predecessor(name, current) &&
          (options?.validationLevel ?? "strict") === "strict" &&
          (options?.validationAction ?? "error") === "error"
        ) &&
        !(
          existingSchemaVersion === 10 &&
          isDeepStrictEqual(
            current,
            historicalProtocolValidator(
              (
                {
                  ...CONTROL_PLANE_OPERATING_MONGO_VALIDATORS,
                  ...AGENT_CONTROL_PLANE_VALIDATORS,
                } as Record<string, Document>
              )[name],
            ),
          ) &&
          (options?.validationLevel ?? "strict") === "strict" &&
          (options?.validationAction ?? "error") === "error"
        ) &&
        !(
          existingSchemaVersion <= 9 &&
          AGENT_VALIDATOR_PREDECESSORS[name] &&
          isDeepStrictEqual(
            current,
            historicalProtocolValidator(AGENT_VALIDATOR_PREDECESSORS[name]),
          ) &&
          (options?.validationLevel ?? "strict") === "strict" &&
          (options?.validationAction ?? "error") === "error"
        ) &&
        !(
          existingSchemaVersion === 6 &&
          HIVE_V6_MONGO_VALIDATORS[name] &&
          isDeepStrictEqual(current, HIVE_V6_MONGO_VALIDATORS[name]) &&
          (options?.validationLevel ?? "strict") === "strict" &&
          (options?.validationAction ?? "error") === "error"
        )
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
      if (target.changedRecordsOnly && !validatorsToApply.includes(name)) continue;
      try {
        const invalid = await db
          .collection(name)
          .countDocuments({ $nor: [validator] }, target.changedRecordsOnly ? { maxTimeMS: 60000 } : {});
        if (invalid)
          validatorConflicts.push(
            `${name}: ${invalid} documents incompatible with target validator`,
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
      if (countDocuments && (!target.changedRecordsOnly || inspection.missing.some((index) => index.unique)))
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
  async function setupDatabase(db: Db): Promise<DatabaseSetupResult> {
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
    const createdIndexes: string[] = [];
    for (const definition of COLLECTION_DEFINITIONS) {
      const indexes =
        plan.missingIndexes[definition.name] ?? definition.indexes;
      if (indexes.length === 0) continue;
      try {
        await db.collection(definition.name).createIndexes(indexes);
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
      (current?.version ?? current?.schemaVersion ?? 0) >
      DATABASE_SCHEMA_VERSION
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
    const pending = requiredMigrations
      .filter((m) => m.version <= DATABASE_SCHEMA_VERSION)
      .filter(
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
      (current.version ?? current.schemaVersion ?? 0) <
        DATABASE_SCHEMA_VERSION ||
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

  return { planDatabaseSetup, setupDatabase };
}
export const V16_SETUP_VALIDATORS: Record<string, Document> = {
  ...V15_SETUP_VALIDATORS,
  ...Object.fromEntries(
    [
      "workspace_memberships",
      "agent_definitions",
      "pricing_recommendations",
      "swarm_agreements",
    ].map((n) => [n, CURRENT_BASE_VALIDATORS[n]]),
  ),
  ...v16IdentityValidators(),
  ...V16_BUDGET_VALIDATORS,
};
const V19_MONGO_VALIDATORS: Record<string, Document> = {
  ...frozenV18Target.validators,
  crm_workspaces: WORKSPACE_BILLING_VALIDATOR,
};
/** Build-time release pin only; no environment/CLI option can skip a target. */
export function releaseDatabaseTarget(
  version:
    | 12
    | 13
    | 14
    | 15
    | 16
    | 17
    | 18
    | 19
    | 20
    | 21
    | 22
    | 23
    | 24
    | 25
    | 26
    | 27
    | 28
    | 29
    | 30,
): DatabaseSetupTarget {
  const targets: Record<number, DatabaseSetupTarget> = {
    12: frozenV12Target as DatabaseSetupTarget,
    13: frozenV13Target as DatabaseSetupTarget,
    14: {
      version: 14,
      validators: V14_SETUP_VALIDATORS,
      collections: V14_SETUP_COLLECTIONS,
    },
    15: {
      version: 15,
      validators: V15_SETUP_VALIDATORS,
      collections: V15_SETUP_COLLECTIONS,
    },
    16: frozenV16Target as DatabaseSetupTarget,
    17: frozenV17Target as DatabaseSetupTarget,
    18: frozenV18Target as DatabaseSetupTarget,
    22: {
      version: 22,
      validators: {
        ...ACTION_NUMERIC_V20_VALIDATORS,
        client_onboardings: CLIENT_ONBOARDING_VALIDATOR,
        ...AGENT_CAPACITY_VALIDATORS,
      },
      collections: [
        ...(frozenV19Target.collections as readonly CollectionDefinition[]),
        CLIENT_ONBOARDING_COLLECTION,
        ...AGENT_CAPACITY_COLLECTIONS,
      ],
    },
    21: {
      version: 21,
      validators: {
        ...ACTION_NUMERIC_V20_VALIDATORS,
        client_onboardings: CLIENT_ONBOARDING_VALIDATOR,
      },
      collections: [
        ...(frozenV19Target.collections as readonly CollectionDefinition[]),
        CLIENT_ONBOARDING_COLLECTION,
      ],
    },
    20: {
      version: 20,
      validators: ACTION_NUMERIC_V20_VALIDATORS,
      collections:
        frozenV19Target.collections as readonly CollectionDefinition[],
    },
    19: {
      version: 19,
      validators: V19_MONGO_VALIDATORS,
      collections: COLLECTION_DEFINITIONS,
    },
  };
  if (version === 30) {
    const previous=releaseDatabaseTarget(29);
    return {...previous,version:30,validators:extendInteractionValidators(previous.validators)};
  }
  if (version === 29) {
    const previous=releaseDatabaseTarget(28);
    return {...previous, version:29, validators:extendNbaPreparationValidators(previous.validators)};
  }
  if (version === 28) {
    const previous=releaseDatabaseTarget(27);
    return {...previous, version:28, validators:{...previous.validators,...LIBRARY_VALIDATORS},collections:[...previous.collections,...LIBRARY_COLLECTIONS]};
  }
  if (version === 27) {
    const previous = releaseDatabaseTarget(26);
    return {
      ...previous,
      version: 27,
      validators: extendOfferSequenceValidators(previous.validators),
    };
  }
  if (version === 26) {
    const previous = releaseDatabaseTarget(25);
    return {
      ...previous,
      version: 26,
      validators: extendProductValidators(previous.validators),
    };
  }
  if (version === 25) {
    const previous = releaseDatabaseTarget(24);
    const validators = structuredClone(previous.validators);
    validators.brand_kits!.$and[0].$jsonSchema.properties.expression =
      BRAND_EXPRESSION_STRUCTURE;
    return { ...previous, version: 25, validators };
  }
  if (version === 24) {
    const previous = releaseDatabaseTarget(23);
    return {
      ...previous,
      version: 24,
      validators: {
        ...previous.validators,
        client_onboardings: ONBOARDING_NO_EXPIRY_VALIDATOR,
      },
    };
  }
  if (version === 23)
    return {
      version: 23,
      ordered: true,
      validators: {
        ...targets[22]!.validators,
        ...EXECUTION_EVIDENCE_VALIDATORS,
      },
      collections: [
        ...targets[22]!.collections,
        ...EXECUTION_EVIDENCE_COLLECTIONS,
      ],
    };
  const target = targets[version];
  if (!target) throw new Error("Unsupported release target");
  return { ...target, ordered: true };
}
declare const __MIGRATION_RELEASE_TARGET__:
  12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24 | 25 | 26 | 27 | 28 | 29 | 30;
export const { planDatabaseSetup, setupDatabase } = createDatabaseSetup(
  releaseDatabaseTarget(
    typeof __MIGRATION_RELEASE_TARGET__ === "undefined"
      ? 20
      : __MIGRATION_RELEASE_TARGET__,
  ),
);

export const MONGO_VALIDATORS = ACTION_NUMERIC_V20_VALIDATORS;
