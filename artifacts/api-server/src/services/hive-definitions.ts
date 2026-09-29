import { z } from "zod";
import type { Db, ClientSession, Document } from "mongodb";
import type { AppConfig } from "../config";
import type { AuthenticatedUser } from "../middlewares/auth";
import type { MongoService } from "./mongo";
import { resolveHvmContext, withoutMongoId } from "./hvm-context";
import { AuthorizationDenied, type Action } from "../authorization/policy";
import {
  generatePlatformId,
  platformIdSchema,
  EventSchema,
  partnerHumanSchema,
} from "../domain";
import {
  HIVE_CONTENT_SCHEMAS,
  HIVE_RECORD_SCHEMAS,
  HIVE_PREFIXES,
  HiveEvidenceInputSchema,
  HiveRevisionSchema,
  definitionHash,
  type HiveKind,
} from "../domain/hive-definitions";

export class HiveConflict extends Error {}
const expected = z.string().datetime();
export const HIVE_OPERATIONS = [
  "create",
  "update",
  "revise",
  "approve",
  "archive",
  "observe",
] as const;
export type HiveOperation = (typeof HIVE_OPERATIONS)[number];
const clean = (v: unknown): unknown =>
  v instanceof Date
    ? v
    : Array.isArray(v)
      ? v.map(clean)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .filter(([, x]) => x !== undefined)
              .map(([k, x]) => [k, clean(x)]),
          )
        : v;
async function requireSchema(db: Db, session?: ClientSession) {
  const ledger = await db
    .collection("schema_versions")
    .findOne({ _id: "vapp-v1" } as Document, { session });
  if (ledger?.version !== 6)
    throw new Error("Hive requires reviewed/applied schema v6");
}
async function authorized(
  db: Db,
  config: AppConfig,
  identity: AuthenticatedUser,
  workspaceId: string,
  kind: HiveKind,
  action: Action,
  session?: ClientSession,
) {
  platformIdSchema("workspace").parse(workspaceId);
  const resolved = await resolveHvmContext(db, config, identity, session);
  if (
    resolved.context.application !== "hvmapp" ||
    resolved.context.actor.type !== "human"
  )
    throw new AuthorizationDenied();
  resolved.authority.scopeFilter(resolved.context, action, {
    type: kind,
    workspaceId,
  });
  await requireSchema(db, session);
  return partnerHumanSchema.parse(resolved.context.actor);
}
/** Reads include retired definitions by explicit opt-in; exact history remains readable after archival. */
export async function readHiveDefinitions(
  mongo: MongoService,
  config: AppConfig,
  identity: AuthenticatedUser,
  workspaceId: string,
  kind: HiveKind,
  raw: unknown,
  id?: string,
  revision?: number,
) {
  const query = z
    .object({
      offeringId: platformIdSchema("offering").optional(),
      idealCustomerProfileId: platformIdSchema("icp").optional(),
      brandId: platformIdSchema("brand").optional(),
      archived: z.enum(["true", "false"]).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(20),
      offset: z.coerce.number().int().min(0).max(10000).default(0),
    })
    .strict()
    .parse(raw);
  if (
    (query.brandId && kind !== "offerings") ||
    (query.offeringId && kind === "offerings") ||
    (query.idealCustomerProfileId && kind !== "buyer_profiles")
  )
    throw new AuthorizationDenied();
  const db = await mongo.database();
  await authorized(db, config, identity, workspaceId, kind, "read");
  if (id) platformIdSchema(HIVE_PREFIXES[kind]).parse(id);
  if (revision !== undefined) {
    z.number().int().positive().parse(revision);
    const row = await db
      .collection("hive_definition_revisions")
      .findOne({ workspaceId, entityType: kind, entityId: id, revision });
    if (!row) throw new AuthorizationDenied();
    return HiveRevisionSchema.parse(withoutMongoId(row));
  }
  if (id) {
    const row = await db.collection(kind).findOne({ workspaceId, id });
    if (!row) throw new AuthorizationDenied();
    return HIVE_RECORD_SCHEMAS[kind].parse(withoutMongoId(row));
  }
  const filter = {
    workspaceId,
    archived: query.archived === "true",
    ...(query.offeringId ? { offeringId: query.offeringId } : {}),
    ...(query.idealCustomerProfileId
      ? { idealCustomerProfileId: query.idealCustomerProfileId }
      : {}),
    ...(query.brandId ? { brandId: query.brandId } : {}),
  };
  const rows = await db
    .collection(kind)
    .find(filter)
    .sort({ id: 1 })
    .skip(query.offset)
    .limit(query.limit + 1)
    .toArray();
  return {
    items: rows
      .slice(0, query.limit)
      .map((row) => HIVE_RECORD_SCHEMAS[kind].parse(withoutMongoId(row))),
    hasMore: rows.length > query.limit,
    limit: query.limit,
    offset: query.offset,
  };
}
/** Human-only composition boundary. Agents are not supported; no caller-supplied actor/scope/source authority. */
export async function mutateHiveDefinition(
  mongo: MongoService,
  config: AppConfig,
  identity: AuthenticatedUser,
  workspaceId: string,
  kind: HiveKind,
  operation: HiveOperation,
  raw: unknown,
) {
  const content = HIVE_CONTENT_SCHEMAS[kind];
  const common = {
    id: platformIdSchema(HIVE_PREFIXES[kind]),
    expectedUpdatedAt: expected,
  };
  const input =
    operation === "create"
      ? z
          .object({
            definition: content,
            ...(kind === "offerings"
              ? { brandId: platformIdSchema("brand").optional() }
              : {
                  offeringId: platformIdSchema("offering"),
                  ...(kind === "buyer_profiles"
                    ? { idealCustomerProfileId: platformIdSchema("icp") }
                    : {}),
                }),
          })
          .strict()
          .parse(raw)
      : operation === "update"
        ? z
            .object({ ...common, definition: content })
            .strict()
            .parse(raw)
        : operation === "observe"
          ? z
              .object({ ...common, evidence: HiveEvidenceInputSchema })
              .strict()
              .parse(raw)
          : z.object(common).strict().parse(raw);
  const body = input as Document;
  if (!mongo.withTransaction) throw new Error("Transactions required");
  return mongo.withTransaction(async (db, session) => {
    const actor = await authorized(
      db,
      config,
      identity,
      workspaceId,
      kind,
      operation === "approve" || operation === "archive"
        ? "approve"
        : operation === "create"
          ? "create"
          : "update",
      session,
    );
    const options = { session };
    const workspace = await db
      .collection("crm_workspaces")
      .findOne(
        { id: workspaceId, kind: "client", archived: { $ne: true } },
        options,
      );
    if (!workspace) throw new AuthorizationDenied();
    const collection = db.collection(kind);
    const previous =
      operation === "create"
        ? undefined
        : await collection.findOne(
            { id: body.id, workspaceId, archived: { $ne: true } },
            options,
          );
    if (operation !== "create" && !previous) throw new AuthorizationDenied();
    if (previous && previous.updatedAt.toISOString() !== body.expectedUpdatedAt)
      throw new HiveConflict("Record changed");
    const now = new Date(
      Math.max(
        Date.now(),
        workspace.updatedAt.getTime() + 1,
        (previous?.updatedAt.getTime() ?? 0) + 1,
      ),
    );
    // Shared lock serializes relationship changes, parent archival and HVM membership mutations.
    const lock = await db.collection("crm_workspaces").updateOne(
      {
        id: workspaceId,
        updatedAt: workspace.updatedAt,
        archived: { $ne: true },
      },
      { $set: { updatedAt: now } },
      options,
    );
    if (!lock.matchedCount) throw new HiveConflict("Workspace changed");
    let row: Document = previous
      ? {
          ...structuredClone(withoutMongoId(previous)),
          updatedAt: now,
          updatedBy: actor,
        }
      : {
          id: generatePlatformId(HIVE_PREFIXES[kind]),
          workspaceId,
          createdAt: now,
          updatedAt: now,
          createdBy: actor,
          updatedBy: actor,
          source: { system: "hvm_hive" },
          status: "draft",
          archived: false,
          schemaVersion: 1,
          revision: 1,
          evidence: [],
          definition: body.definition,
          ...(kind === "offerings"
            ? {
                organisationId: workspace.clientOrganisationId,
                ...(body.brandId ? { brandId: body.brandId } : {}),
              }
            : {
                offeringId: body.offeringId,
                ...(kind === "buyer_profiles"
                  ? { idealCustomerProfileId: body.idealCustomerProfileId }
                  : {}),
              }),
        };
    if (operation === "revise") {
      if (row.status !== "approved")
        throw new HiveConflict(
          "Only approved definitions start another revision",
        );
      row.status = "draft";
      row.revision += 1;
      delete row.approvedAt;
      delete row.approvedBy;
    } else if (operation === "update") {
      if (row.status !== "draft")
        throw new HiveConflict("Only drafts may be edited");
      row.definition = body.definition;
    } else if (operation === "approve") {
      if (row.status !== "draft")
        throw new HiveConflict("Only drafts may be approved");
      row.status = "approved";
      row.approvedRevision = row.revision;
      row.approvedAt = now;
      row.approvedBy = actor;
    } else if (operation === "archive") {
      row.status = "retired";
      row.archived = true;
      row.archivedAt = now;
    } else if (operation === "observe") {
      if (row.status !== "draft")
        throw new HiveConflict("Evidence changes require a draft");
      const evidence = body.evidence;
      const candidate = structuredClone(row.definition);
      const path = evidence.field.split(".");
      // Strict schema validation of the candidate prevents unknown/prototype/identity paths.
      if (
        path.some((part: string) =>
          ["__proto__", "constructor", "prototype"].includes(part),
        )
      )
        throw new AuthorizationDenied();
      if (path.length === 1) candidate[path[0]] = evidence.value;
      else
        candidate[path[0]] = {
          ...candidate[path[0]],
          [path[1]]: evidence.value,
        };
      content.parse(candidate);
      const observedAt = new Date(evidence.observedAt);
      if (observedAt > now) throw new HiveConflict("Future observation");
      row.evidence = [
        ...row.evidence,
        { ...evidence, observedAt, recordedAt: now, actor },
      ];
      // Observations NEVER promote or overwrite canonical content, even when confirmed.
    }
    if (operation !== "archive")
      await references(
        db,
        session,
        workspaceId,
        workspace.clientOrganisationId,
        kind,
        row,
      );
    row.contentHash = definitionHash(
      row as Parameters<typeof definitionHash>[0],
    );
    row = clean(HIVE_RECORD_SCHEMAS[kind].parse(row)) as Document;
    if (operation === "approve") {
      const snapshot = HiveRevisionSchema.parse({
        id: generatePlatformId("hiverevision"),
        workspaceId,
        entityType: kind,
        entityId: row.id,
        revision: row.revision,
        snapshot: row,
      });
      await db
        .collection("hive_definition_revisions")
        .insertOne(clean(snapshot) as Document, options);
    }
    if (!previous) await collection.insertOne(row, options);
    else {
      const unset = Object.fromEntries(
        Object.keys(withoutMongoId(previous))
          .filter((k) => !(k in row))
          .map((k) => [k, ""]),
      );
      const result = await collection.updateOne(
        { id: row.id, workspaceId, updatedAt: previous.updatedAt },
        { $set: row, ...(Object.keys(unset).length ? { $unset: unset } : {}) },
        options,
      );
      if (!result.matchedCount) throw new HiveConflict("Record changed");
    }
    await db.collection("events").insertOne(
      EventSchema.parse({
        id: generatePlatformId("event"),
        workspaceId,
        createdAt: now,
        updatedAt: now,
        occurredAt: now,
        actor,
        eventType: "hive_definition_changed",
        payload: {
          application: "hvmapp",
          resource: kind,
          resourceId: row.id,
          action: operation,
          revision: row.revision,
          contentHash: row.contentHash,
          human: actor,
        },
      }),
      options,
    );
    return row;
  });
}
async function references(
  db: Db,
  session: ClientSession,
  workspaceId: string,
  organisationId: string,
  kind: HiveKind,
  row: Document,
) {
  const options = { session };
  if (kind === "offerings") {
    if (row.organisationId !== organisationId) throw new AuthorizationDenied();
    const org = await db.collection("organisations").findOne(
      {
        id: organisationId,
        workspaceId: { $exists: false },
        archived: { $ne: true },
      },
      options,
    );
    if (!org) throw new AuthorizationDenied();
    const lock = await db
      .collection("organisations")
      .updateOne(
        { id: organisationId, archived: { $ne: true } },
        { $inc: { _crmReferenceRevision: 1 } },
        options,
      );
    if (!lock.matchedCount) throw new HiveConflict("Organisation changed");
    if (
      row.brandId &&
      !(await db.collection("brands").findOne(
        {
          id: row.brandId,
          workspaceId,
          organisationId,
          status: "active",
          archived: { $ne: true },
        },
        options,
      ))
    )
      throw new AuthorizationDenied();
  } else {
    const offering = await db
      .collection("offerings")
      .findOne({ id: row.offeringId, workspaceId, archived: false }, options);
    if (!offering) throw new AuthorizationDenied();
    if (
      kind === "buyer_profiles" &&
      !(await db.collection("ideal_customer_profiles").findOne(
        {
          id: row.idealCustomerProfileId,
          offeringId: row.offeringId,
          workspaceId,
          archived: false,
        },
        options,
      ))
    )
      throw new AuthorizationDenied();
  }
}
