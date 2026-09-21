import { createHash } from "node:crypto";
import type { ClientSession, Db, Document, Filter } from "mongodb";
import { isPlatformId } from "../domain";
import type { DomainCollectionName } from "../db/collections";
import type { MongoService } from "./mongo";
import { logger } from "../lib/logger";

export type DeleteKind = "person" | "organisation" | "opportunity";
const targets = {
  person: "people",
  organisation: "organisations",
  opportunity: "opportunities",
} as const;
export interface DeleteGroup {
  collection: string;
  count: number;
  ids: string[];
}
export interface DeleteBlocker extends DeleteGroup {
  code: string;
  reason: string;
}
export class CrmDeleteError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly blockedBy: DeleteBlocker[] = [],
  ) {
    super(message);
  }
}
const group = (collection: string, rows: Document[]): DeleteGroup => ({
  collection,
  count: rows.length,
  ids: rows
    .map((r) => r.id)
    .filter((id): id is string => isPlatformId(id))
    .sort(),
});
const allowedEventKeys = new Set([
  "opportunityId",
  "form",
  "formVersion",
  "name",
  "firstName",
  "lastName",
  "workEmail",
  "company",
  "message",
  "website",
  "jobTitle",
  "serviceInterest",
  "source",
  "medium",
  "campaign",
  "content",
  "term",
  "landingPage",
  "referrer",
  "marketingOptIn",
]);
const referenceIds = (rows: Document[], key: string) =>
  [
    ...new Set(
      rows.flatMap((r) =>
        Array.isArray(r[key]) ? r[key] : r[key] ? [r[key]] : [],
      ),
    ),
  ] as string[];

async function plan(
  db: Db,
  session: ClientSession,
  kind: DeleteKind,
  id: string,
) {
  const snapshots: unknown[] = [];
  const read = async (
    collection: DomainCollectionName,
    filter: Filter<Document>,
  ) => {
    const rows = await db
      .collection(collection)
      .find(filter, { session })
      .sort({ id: 1 })
      .limit(1001)
      .toArray();
    if (rows.length > 1000)
      throw new CrmDeleteError(
        409,
        "DELETE_SCOPE_TOO_LARGE",
        "More than 1,000 related records require a separate administrative review.",
      );
    if (rows.some((r) => !isPlatformId(r.id)))
      throw new CrmDeleteError(
        409,
        "INVALID_DEPENDENCY",
        "A related record requires administrative review.",
      );
    snapshots.push({ collection, rows });
    return rows;
  };
  const target = (await read(targets[kind], { id }))[0];
  if (!target)
    throw new CrmDeleteError(404, "RECORD_NOT_FOUND", "Record not found.");
  const blockedBy: DeleteBlocker[] = [];
  const block = (
    collection: string,
    rows: Document[],
    code: string,
    reason: string,
  ) => {
    if (rows.length)
      blockedBy.push({ ...group(collection, rows), code, reason });
  };
  const opportunities =
    kind === "opportunity"
      ? [target]
      : await read(
          "opportunities",
          kind === "person" ? { personIds: id } : { organisationId: id },
        );
  block(
    "opportunities",
    opportunities.filter(
      (o) =>
        o.source?.system !== "public_enquiry" ||
        o.status !== "open" ||
        o.stage !== "enquiry" ||
        o.estimatedValueMinor !== undefined ||
        o.currency !== undefined ||
        o.wonAt ||
        o.lostAt ||
        o.campaignId ||
        o.nextAction ||
        o.nextActionAt ||
        o.expectedCloseAt ||
        o.probability !== undefined,
    ),
    "OPPORTUNITY_HISTORY",
    "Only unvalued, open public-enquiry opportunities without follow-up or commercial history can be deleted.",
  );
  if (kind === "person")
    block(
      "opportunities",
      opportunities.filter((o) =>
        o.personIds.some((personId: string) => personId !== id),
      ),
      "SHARED_OPPORTUNITY",
      "An opportunity is shared with another person.",
    );
  const personIds = [
    ...new Set([
      ...(kind === "person" ? [id] : []),
      ...referenceIds(opportunities, "personIds"),
    ]),
  ];
  const organisationIds = [
    ...new Set([
      ...(kind === "organisation" ? [id] : []),
      ...referenceIds(opportunities, "organisationId"),
    ]),
  ];
  const subjectFilter = {
    $or: [
      { personId: { $in: personIds } },
      { organisationId: { $in: organisationIds } },
    ],
  };
  // Include inactive/archived financial history. No financial records are ever cascaded.
  for (const collection of [
    "transactions",
    "subscriptions",
    "entitlements",
  ] as const)
    block(
      collection,
      await read(collection, subjectFilter),
      "COMMERCIAL_HISTORY",
      "Financial, subscription or entitlement history must be retained (all statuses).",
    );
  const organisations = await read("organisations", {
    id: { $in: organisationIds },
  });
  block(
    "organisations",
    organisations.filter((o) => o.type === "customer" || o.type === "partner"),
    "CUSTOMER_ORGANISATION",
    "Customer or partner organisation history prevents this deletion.",
  );
  const productRelationships = await read(
    "product_relationships",
    subjectFilter,
  );
  block(
    "product_relationships",
    productRelationships.filter(
      (r) => !["prospect", "engaged"].includes(r.status) || r.customerSince,
    ),
    "CUSTOMER_RELATIONSHIP",
    "Customer, former customer, trial or partner Product history must be retained.",
  );

  const contactPoints =
    kind === "person" ? await read("contact_points", { personId: id }) : [];
  const organisationRelationships =
    kind === "opportunity"
      ? []
      : await read(
          "organisation_relationships",
          kind === "person" ? { personId: id } : { organisationId: id },
        );
  const deleteProductRelationships =
    kind === "opportunity"
      ? []
      : productRelationships.filter((r) =>
          kind === "person" ? r.personId === id : r.organisationId === id,
        );
  const opportunityIds = opportunities.map((o) => o.id);
  const eventFilters: Filter<Document>[] = [
    { "payload.opportunityId": { $in: opportunityIds } },
  ];
  if (kind === "person") eventFilters.push({ personId: id });
  if (kind === "organisation") eventFilters.push({ organisationId: id });
  const events = await read("events", { $or: eventFilters });
  const safeEvents = events.filter((e) => {
    const o = opportunities.find((o) => o.id === e.payload?.opportunityId);
    return (
      o &&
      e.eventType === "enquiry_submitted" &&
      e.source?.system === "public_enquiry" &&
      e.payload.form === "public_product_enquiry" &&
      ["1", "2"].includes(e.payload.formVersion) &&
      e.productId === o.productId &&
      e.organisationId === o.organisationId &&
      o.personIds.includes(e.personId) &&
      !e.campaignId &&
      !e.externalReference &&
      !e.sessionReference &&
      Object.keys(e.payload).every((key) => allowedEventKeys.has(key))
    );
  });
  block(
    "events",
    events.filter((e) => !safeEvents.includes(e)),
    "RETAINED_EVENT",
    "A related event has lifecycle significance or an unknown/inconsistent enquiry linkage.",
  );
  // Permission evidence is the existing JSON-string link to an enquiry Event.
  // Find even evidence-only references owned by a different person.
  const permissionFilters: Filter<Document>[] = [
    { personId: { $in: personIds } },
  ];
  if (contactPoints.length)
    permissionFilters.push({
      contactPointId: { $in: contactPoints.map((c) => c.id) },
    });
  if (events.length)
    permissionFilters.push({
      evidence: { $regex: events.map((e) => e.id).join("|") },
    });
  const permissions = await read("marketing_permissions", {
    $or: permissionFilters,
  });
  const affectedPermissions = permissions.filter((p) => {
    if (
      kind === "person" &&
      (p.personId === id ||
        contactPoints.some((c) => c.id === p.contactPointId))
    )
      return true;
    return events.some(
      (e) => typeof p.evidence === "string" && p.evidence.includes(e.id),
    );
  });
  const safePermissions = affectedPermissions.filter(
    (p) =>
      p.source?.system === "test" &&
      (kind !== "person" ||
        ((!p.personId || p.personId === id) &&
          (!p.contactPointId ||
            contactPoints.some((c) => c.id === p.contactPointId)))),
  );
  block(
    "marketing_permissions",
    affectedPermissions.filter((p) => !safePermissions.includes(p)),
    "CONSENT_HISTORY",
    "Non-test or shared marketing permission history must be retained. Public enquiry consent is not automatically test data.",
  );
  // Protect supersession links from retained permissions into the deletion set.
  if (safePermissions.length) {
    const superseding = await read("marketing_permissions", {
      supersedesPermissionId: { $in: safePermissions.map((p) => p.id) },
    });
    block(
      "marketing_permissions",
      superseding.filter((p) => !safePermissions.some((s) => s.id === p.id)),
      "RETAINED_PERMISSION_REFERENCE",
      "Retained permission history references a permission selected for deletion.",
    );
  }

  const deletionRows: { collection: DomainCollectionName; rows: Document[] }[] =
    [
      { collection: "marketing_permissions", rows: safePermissions },
      { collection: "events", rows: safeEvents },
      { collection: "opportunities", rows: opportunities },
      { collection: "product_relationships", rows: deleteProductRelationships },
      {
        collection: "organisation_relationships",
        rows: organisationRelationships,
      },
      { collection: "contact_points", rows: contactPoints },
      ...(kind === "opportunity"
        ? []
        : [{ collection: targets[kind], rows: [target] }]),
    ];
  const willDelete = deletionRows
    .filter((item) => item.rows.length)
    .map((item) => group(item.collection, item.rows));
  const previewToken = createHash("sha256")
    .update(JSON.stringify({ kind, id, snapshots }))
    .digest("hex");
  return {
    recordId: id,
    recordType: kind,
    willDelete,
    blockedBy,
    previewToken,
  };
}

export interface DeleteAuditLogger {
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
}
export function auditDelete(
  actorSubject: string,
  recordType: DeleteKind,
  recordId: string,
  code: string,
  deleted: DeleteGroup[] = [],
  audit: DeleteAuditLogger = logger,
) {
  const fields = {
    actorSubject,
    recordType,
    recordId,
    code,
    timestamp: new Date().toISOString(),
    deletedCounts: Object.fromEntries(
      deleted.map((g) => [g.collection, g.count]),
    ),
  };
  try {
    if (code === "DELETED") audit.info(fields, "CRM hard delete completed");
    else audit.warn(fields, "CRM hard delete refused or failed");
  } catch {
    /* Never report a committed deletion as failed because logging failed. */
  }
}
export async function previewCrmDelete(
  mongo: MongoService,
  kind: DeleteKind,
  id: string,
) {
  if (!mongo.withTransaction)
    throw new CrmDeleteError(
      503,
      "TRANSACTIONS_REQUIRED",
      "Transactional deletion is unavailable.",
    );
  return mongo.withTransaction((db, session) => plan(db, session, kind, id));
}
export async function hardDeleteCrm(
  mongo: MongoService,
  kind: DeleteKind,
  id: string,
  previewToken: string,
  actorSubject: string,
  audit: DeleteAuditLogger = logger,
) {
  try {
    if (!mongo.withTransaction)
      throw new CrmDeleteError(
        503,
        "TRANSACTIONS_REQUIRED",
        "Transactional deletion is unavailable.",
      );
    const result = await mongo.withTransaction(async (db, session) => {
      const preview = await plan(db, session, kind, id);
      if (preview.blockedBy.length)
        throw new CrmDeleteError(
          409,
          "DELETE_BLOCKED",
          "Protected dependencies prevent deletion. Review the blockers.",
          preview.blockedBy,
        );
      if (preview.previewToken !== previewToken)
        throw new CrmDeleteError(
          409,
          "PREVIEW_CHANGED",
          "The record or its dependencies changed. Load a new preview and confirm again.",
        );
      for (const item of preview.willDelete) {
        const result = await db
          .collection(item.collection)
          .deleteMany({ id: { $in: item.ids } }, { session });
        if (result.deletedCount !== item.count)
          throw new CrmDeleteError(
            409,
            "PREVIEW_CHANGED",
            "Dependencies changed. Load a new preview and confirm again.",
          );
      }
      return { recordId: id, recordType: kind, deleted: preview.willDelete };
    });
    auditDelete(actorSubject, kind, id, "DELETED", result.deleted, audit);
    return result;
  } catch (error) {
    auditDelete(
      actorSubject,
      kind,
      id,
      error instanceof CrmDeleteError ? error.code : "DELETE_FAILED",
      [],
      audit,
    );
    throw error instanceof CrmDeleteError
      ? error
      : new CrmDeleteError(
          503,
          "DELETE_FAILED",
          "Deletion could not be completed. Reload the record before retrying.",
        );
  }
}
