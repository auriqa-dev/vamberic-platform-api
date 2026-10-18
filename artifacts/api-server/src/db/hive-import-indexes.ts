import type { Db, IndexDescription } from "mongodb";
export const HIVE_IMPORT_INDEXES: {
  collection: string;
  index: IndexDescription;
}[] = [
  {
    collection: "organisations",
    index: {
      key: { workspaceId: 1, "source.reference": 1 },
      name: "hive_import_registration",
    },
  },
  {
    collection: "organisations",
    index: { key: { workspaceId: 1, name: 1 }, name: "hive_import_name" },
  },
  {
    collection: "imports",
    index: {
      key: { workspaceId: 1, provider: 1, reference: 1 },
      name: "hive_import_replay",
    },
  },
  {
    collection: "events",
    index: {
      key: { workspaceId: 1, eventType: 1, "payload.importId": 1 },
      name: "hive_import_receipt",
    },
  },
  {
    collection: "events",
    index: {
      key: {
        workspaceId: 1,
        eventType: 1,
        "payload.jobId": 1,
        "payload.batchIndex": 1,
      },
      name: "hive_import_progress",
    },
  },
  {
    collection: "events",
    index: {
      key: { workspaceId: 1, eventType: 1, "payload.companyId": 1, id: 1 },
      name: "hive_import_company_facts",
    },
  },
  {
    collection: "events",
    index: {
      key: {
        workspaceId: 1,
        eventType: 1,
        "payload.origin.notification": 1,
        id: 1,
      },
      name: "hive_import_notification_facts",
    },
  },
  {
    collection: "events",
    index: {
      key: { workspaceId: 1, eventType: 1, "payload.personId": 1, id: 1 },
      name: "hive_import_contact_facts",
    },
  },
];
/** Additive only: no validators, migrations, drops or document updates. */
export async function setupHiveImportIndexes(db: Db, apply = false) {
  const result = [];
  for (const item of HIVE_IMPORT_INDEXES) {
    const indexes = await db
      .collection(item.collection)
      .listIndexes()
      .toArray();
    const existing = indexes.find((x) => x.name === item.index.name);
    if (
      existing &&
      JSON.stringify(existing.key) !== JSON.stringify(item.index.key)
    )
      throw new Error("Unexpected existing import index definition");
    if (!existing && apply)
      await db.collection(item.collection).createIndexes([item.index]);
    result.push({
      collection: item.collection,
      name: item.index.name,
      status: existing ? "existing" : apply ? "created" : "missing",
    });
  }
  return result;
}
