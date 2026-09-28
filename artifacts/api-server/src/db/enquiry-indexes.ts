import type { Db, IndexDescription } from "mongodb";

// Scoped to this ingestion source: existing CRM email sharing stays legal.
// The extra key avoids conflicting with the existing nonunique email index.
export const PUBLIC_ENQUIRY_INDEXES: {
  collection: "contact_points" | "organisations";
  index: IndexDescription;
}[] = [
  {
    collection: "contact_points",
    index: {
      name: "public_enquiry_email_unique",
      key: { normalizedValue: 1, "source.system": 1 },
      unique: true,
      partialFilterExpression: {
        type: "email",
        "source.system": "public_enquiry",
      },
    },
  },
  {
    collection: "organisations",
    index: {
      name: "public_enquiry_org_unique",
      key: { domain: 1, name: 1, "source.system": 1 },
      unique: true,
      partialFilterExpression: {
        domain: { $type: "string" },
        "source.system": "public_enquiry",
      },
    },
  },
];

/** Fail closed if deployment has not provisioned the concurrency guarantees. */
export const WORKSPACE_ENQUIRY_INDEXES = PUBLIC_ENQUIRY_INDEXES.map(
  ({ collection, index }) => ({
    collection,
    index: {
      ...index,
      name: `workspace_${index.name}`,
      key: { workspaceId: 1, ...index.key },
      partialFilterExpression: {
        ...index.partialFilterExpression,
        "source.system": "workspace_public_enquiry",
        workspaceId: { $type: "string" },
      },
    },
  }),
);
export async function assertEnquiryIndexes(
  db: Db,
  workspace = false,
): Promise<void> {
  for (const { collection, index } of workspace
    ? WORKSPACE_ENQUIRY_INDEXES
    : PUBLIC_ENQUIRY_INDEXES) {
    const found = (
      await db.collection(collection).listIndexes().toArray()
    ).find((item) => item.name === index.name);
    if (
      !found ||
      found.unique !== true ||
      JSON.stringify(found.key) !== JSON.stringify(index.key) ||
      JSON.stringify(found.partialFilterExpression) !==
        JSON.stringify(index.partialFilterExpression)
    ) {
      throw new Error("Public enquiry indexes unavailable");
    }
  }
}
