import { z } from "zod";
import type { Db, Document, ClientSession } from "mongodb";
import type { AppConfig } from "../config";
import type { AuthenticatedUser } from "../middlewares/auth";
import type { MongoService } from "./mongo";
import { resolveHvmContext, withoutMongoId } from "./hvm-context";
import { AuthorizationDenied, type Action } from "../authorization/policy";
import {
  EventSchema,
  generatePlatformId,
  platformIdSchema,
} from "../domain/schemas";
import { partnerHumanSchema } from "../domain/partners";
import { HiveRevisionSchema } from "../domain/hive-definitions";
import {
  listOfferMethodologies,
  getOfferMethodology,
} from "../domain/offer-methodologies";
import {
  OfferDesignWorkSchema,
  OfferDesignSchema,
  OfferSchema,
  OfferContentSchema,
  OfferRevisionSchema,
  CompetitiveAnalysisSchema,
  offerHash,
} from "../domain/offers";

export class OfferConflict extends Error {}
export type OfferResource = "offer_designs" | "offers";
export const OFFER_DESIGN_ACTIONS = [
  "create",
  "update",
  "start",
  "ready",
  "complete",
  "reopen",
  "archive",
] as const;
export const OFFER_ACTIONS = [
  "create",
  "update",
  "approve",
  "revise",
  "archive",
] as const;
const schemas = { offer_designs: OfferDesignSchema, offers: OfferSchema };
const prefixes = { offer_designs: "offerdesign", offers: "offer" } as const;
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
export async function offerAuthority(
  db: Db,
  config: AppConfig,
  identity: AuthenticatedUser,
  workspaceId: string,
  resource: OfferResource,
  action: Action,
  session?: ClientSession,
) {
  platformIdSchema("workspace").parse(workspaceId);
  const resolved = await resolveHvmContext(db, config, identity, session);
  if (
    resolved.context.actor.type !== "human" ||
    resolved.context.application !== "hvmapp"
  )
    throw new AuthorizationDenied();
  resolved.authority.scopeFilter(resolved.context, action, {
    type: resource,
    workspaceId,
  });
  const ledger = await db
    .collection("schema_versions")
    .findOne({ _id: "vapp-v1" } as Document, { session });
  if (
    ![
      8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
      27, 28, 29, 30,
    ].includes(ledger?.version)
  )
    throw new Error("Offer foundation requires reviewed/applied schema v8");
  return partnerHumanSchema.parse(resolved.context.actor);
}
export async function readOfferFoundation(
  mongo: MongoService,
  config: AppConfig,
  identity: AuthenticatedUser,
  workspaceId: string,
  resource: OfferResource | "methodologies",
  raw: unknown,
  id?: string,
  revision?: number,
) {
  const query = z
    .object({
      offeringId: platformIdSchema("offering").optional(),
      archived: z.enum(["true", "false"]).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(20),
      offset: z.coerce.number().int().min(0).max(10000).default(0),
    })
    .strict()
    .parse(raw);
  const db = await mongo.database();
  await offerAuthority(
    db,
    config,
    identity,
    workspaceId,
    resource === "methodologies" ? "offer_designs" : resource,
    "read",
  );
  if (resource === "methodologies") {
    if (query.offeringId || query.archived || query.offset !== 0)
      throw new OfferConflict("Unsupported methodology filter");
    if (id) {
      platformIdSchema("offermethodology").parse(id);
      z.number().int().positive().parse(revision);
      const row = getOfferMethodology(id, revision!);
      if (!row) throw new AuthorizationDenied();
      return row;
    }
    const available = await db
      .collection("methodology_availability")
      .find({
        status: "active",
        archived: false,
        availability: "queens",
      })
      .toArray();
    const items = listOfferMethodologies().filter(
      (m) =>
        m.key === "value_equation" ||
        available.some(
          (r) =>
            r.data.methodology.id === m.id &&
            r.data.methodology.version === m.version,
        ),
    );
    return { items, hasMore: false, limit: items.length, offset: 0 };
  }
  if (id) platformIdSchema(prefixes[resource]).parse(id);
  if (revision !== undefined) {
    if (resource !== "offers") throw new AuthorizationDenied();
    z.number().int().positive().parse(revision);
    const row = await db
      .collection("offer_revisions")
      .findOne({ workspaceId, offerId: id, revision });
    if (!row) throw new AuthorizationDenied();
    return OfferRevisionSchema.parse(withoutMongoId(row));
  }
  if (id) {
    const row = await db.collection(resource).findOne({ workspaceId, id });
    if (!row) throw new AuthorizationDenied();
    return schemas[resource].parse(withoutMongoId(row));
  }
  const rows = await db
    .collection(resource)
    .find({
      workspaceId,
      archived: query.archived === "true",
      ...(query.offeringId ? { offeringId: query.offeringId } : {}),
    })
    .sort({ id: 1 })
    .skip(query.offset)
    .limit(query.limit + 1)
    .toArray();
  return {
    items: rows
      .slice(0, query.limit)
      .map((r) => schemas[resource].parse(withoutMongoId(r))),
    hasMore: rows.length > query.limit,
    limit: query.limit,
    offset: query.offset,
  };
}
async function targets(
  db: Db,
  session: ClientSession,
  workspaceId: string,
  offeringId: string,
  icps: string[],
  buyers: string[],
) {
  const options = { session };
  const offering = await db
    .collection("offerings")
    .findOne({ workspaceId, id: offeringId, archived: false }, options);
  if (!offering) throw new AuthorizationDenied();
  for (const id of icps)
    if (
      !(await db
        .collection("ideal_customer_profiles")
        .findOne({ workspaceId, id, offeringId, archived: false }, options))
    )
      throw new AuthorizationDenied();
  for (const id of buyers) {
    const buyer = await db
      .collection("buyer_profiles")
      .findOne({ workspaceId, id, offeringId, archived: false }, options);
    if (!buyer || !icps.includes(buyer.idealCustomerProfileId))
      throw new AuthorizationDenied();
  }
}
async function approvedReference(
  db: Db,
  session: ClientSession,
  workspaceId: string,
  kind: "offerings" | "ideal_customer_profiles" | "buyer_profiles",
  id: string,
) {
  const current = await db
    .collection(kind)
    .findOne({ workspaceId, id, archived: false }, { session });
  if (!current?.approvedRevision)
    throw new OfferConflict("Approved Hive source required");
  const found = await db.collection("hive_definition_revisions").findOne(
    {
      workspaceId,
      entityType: kind,
      entityId: id,
      revision: current.approvedRevision,
    },
    { session },
  );
  if (!found) throw new OfferConflict("Approved Hive source unavailable");
  const revision = HiveRevisionSchema.parse(withoutMongoId(found));
  return {
    id,
    revision: revision.revision,
    contentHash: revision.snapshot.contentHash,
  };
}
async function captureSources(
  db: Db,
  session: ClientSession,
  workspaceId: string,
  offeringId: string,
  selection: Document,
) {
  return {
    offering: await approvedReference(
      db,
      session,
      workspaceId,
      "offerings",
      offeringId,
    ),
    icps: await Promise.all(
      selection.targetIcpIds.map((id: string) =>
        approvedReference(
          db,
          session,
          workspaceId,
          "ideal_customer_profiles",
          id,
        ),
      ),
    ),
    buyers: await Promise.all(
      selection.targetBuyerProfileIds.map((id: string) =>
        approvedReference(db, session, workspaceId, "buyer_profiles", id),
      ),
    ),
  };
}
export async function mutateOfferFoundation(
  mongo: MongoService,
  config: AppConfig,
  identity: AuthenticatedUser,
  workspaceId: string,
  resource: OfferResource,
  operation: string,
  raw: unknown,
  replacementDesignId?: string,
) {
  const isDesign = resource === "offer_designs";
  if (
    !(isDesign ? OFFER_DESIGN_ACTIONS : OFFER_ACTIONS).some(
      (x) => x === operation,
    )
  )
    throw new AuthorizationDenied();
  const common = {
    id: platformIdSchema(prefixes[resource]),
    expectedUpdatedAt: z.string().datetime(),
  };
  const updateShape: z.ZodRawShape = isDesign
    ? { work: OfferDesignWorkSchema }
    : {
        definition: OfferContentSchema,
        competitiveAnalysis: CompetitiveAnalysisSchema.optional(),
      };
  const input =
    operation === "create"
      ? z
          .object({
            offeringId: platformIdSchema("offering"),
            ...updateShape,
            ...(isDesign
              ? {
                  methodologyId: platformIdSchema("offermethodology"),
                  methodologyVersion: z.number().int().positive(),
                }
              : { offerDesignId: platformIdSchema("offerdesign").optional() }),
          })
          .strict()
          .parse(raw)
      : operation === "update"
        ? z
            .object({ ...common, ...updateShape })
            .strict()
            .parse(raw)
        : z.object(common).strict().parse(raw);
  const body = input as Document;
  if (!mongo.withTransaction) throw new Error("Transactions required");
  return mongo.withTransaction(async (db, session) => {
    const actor = await offerAuthority(
      db,
      config,
      identity,
      workspaceId,
      resource,
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
    const collection = db.collection(resource);
    const previous =
      operation === "create"
        ? undefined
        : await collection.findOne(
            { id: body.id, workspaceId, archived: false },
            options,
          );
    if (operation !== "create" && !previous) throw new AuthorizationDenied();
    if (previous && previous.updatedAt.toISOString() !== body.expectedUpdatedAt)
      throw new OfferConflict("Record changed");
    const now = new Date(
      Math.max(
        Date.now(),
        workspace.updatedAt.getTime() + 1,
        (previous?.updatedAt.getTime() ?? 0) + 1,
      ),
    );
    const lock = await db.collection("crm_workspaces").updateOne(
      {
        id: workspaceId,
        updatedAt: workspace.updatedAt,
        archived: { $ne: true },
      },
      { $set: { updatedAt: now } },
      options,
    );
    if (!lock.matchedCount) throw new OfferConflict("Workspace changed");
    let row: Document = previous
      ? {
          ...structuredClone(withoutMongoId(previous)),
          updatedAt: now,
          updatedBy: actor,
        }
      : {
          id: generatePlatformId(prefixes[resource]),
          workspaceId,
          offeringId: body.offeringId,
          createdAt: now,
          updatedAt: now,
          createdBy: actor,
          updatedBy: actor,
          schemaVersion: 1,
          archived: false,
          status: "draft",
          source: { system: "hvm_offer_foundation" },
          ...(isDesign
            ? { work: body.work }
            : {
                revision: 1,
                definition: body.definition,
                ...(body.offerDesignId
                  ? { offerDesignId: body.offerDesignId }
                  : {}),
                ...(body.competitiveAnalysis
                  ? { competitiveAnalysis: body.competitiveAnalysis }
                  : {}),
              }),
        };
    if (isDesign && operation === "create") {
      const method = getOfferMethodology(
        body.methodologyId,
        body.methodologyVersion,
      );
      if (!method || method.status !== "active")
        throw new OfferConflict("Active methodology version required");
      if (method.key !== "value_equation") {
        const available = await db
          .collection("methodology_availability")
          .findOne(
            {
              "data.methodology.id": method.id,
              "data.methodology.version": method.version,
              status: "active",
              archived: false,
              availability: "queens",
            },
            { session },
          );
        if (!available)
          throw new OfferConflict(
            "Methodology is not published for workspace execution",
          );
      }
      Object.assign(row, {
        methodologyId: method.id,
        methodologyKey: method.key,
        methodologyVersion: method.version,
      });
    }
    if (
      !isDesign &&
      operation === "update" &&
      replacementDesignId &&
      replacementDesignId !== row.offerDesignId
    ) {
      if (row.status !== "draft")
        throw new OfferConflict(
          "Revise the approved offer before changing its design",
        );
      const replacement = await db.collection("offer_designs").findOne(
        {
          id: replacementDesignId,
          workspaceId,
          offeringId: row.offeringId,
          status: "draft",
          archived: false,
        },
        options,
      );
      const used = await db
        .collection("offers")
        .findOne({ workspaceId, offerDesignId: replacementDesignId }, options);
      if (!replacement || used)
        throw new OfferConflict("A new independent draft design is required");
      await offerAuthority(
        db,
        config,
        identity,
        workspaceId,
        "offer_designs",
        "create",
        session,
      );
      row.offerDesignId = replacementDesignId;
      delete row.competitiveAnalysis;
    }
    let design: Document | undefined;
    if (!isDesign && row.offerDesignId && operation !== "archive") {
      const found = await db.collection("offer_designs").findOne(
        {
          workspaceId,
          id: row.offerDesignId,
          offeringId: row.offeringId,
          archived: false,
        },
        options,
      );
      if (!found) throw new AuthorizationDenied();
      design = OfferDesignSchema.parse(withoutMongoId(found));
    }
    if (operation === "update") {
      if (isDesign) {
        if (!["draft", "in_progress", "ready_for_review"].includes(row.status))
          throw new OfferConflict("Reopen the completed design first");
        row.work = body.work;
        row.status = "in_progress";
      } else {
        if (row.status !== "draft")
          throw new OfferConflict("Only Offer drafts may be edited");
        row.definition = body.definition;
        delete row.competitiveAnalysis;
        if (body.competitiveAnalysis)
          row.competitiveAnalysis = body.competitiveAnalysis;
      }
    }
    if (isDesign) {
      const transitions: Record<string, { from: string[]; to: string }> = {
        start: { from: ["draft"], to: "in_progress" },
        ready: { from: ["draft", "in_progress"], to: "ready_for_review" },
        complete: { from: ["ready_for_review"], to: "completed" },
        reopen: { from: ["ready_for_review", "completed"], to: "in_progress" },
      };
      const transition = transitions[operation];
      if (transition) {
        if (!transition.from.includes(row.status))
          throw new OfferConflict("Invalid design transition");
        row.status = transition.to;
        if (operation === "complete")
          row.sourceRevisions = await captureSources(
            db,
            session,
            workspaceId,
            row.offeringId,
            row.work,
          );
        if (operation === "reopen") delete row.sourceRevisions;
      }
    } else if (operation === "revise") {
      if (row.status !== "approved")
        throw new OfferConflict("Only approved Offers may be revised");
      row.status = "draft";
      row.revision += 1;
      delete row.approvedAt;
      delete row.approvedBy;
      delete row.lineage;
    } else if (operation === "approve") {
      if (row.status !== "draft")
        throw new OfferConflict("Only Offer drafts may be approved");
      if (design) {
        if (design.status !== "completed")
          throw new OfferConflict("Complete the linked Offer Design first");
        if (
          JSON.stringify([...design.work.targetIcpIds].sort()) !==
            JSON.stringify([...row.definition.targetIcpIds].sort()) ||
          JSON.stringify([...design.work.targetBuyerProfileIds].sort()) !==
            JSON.stringify([...row.definition.targetBuyerProfileIds].sort())
        )
          throw new OfferConflict(
            "Offer targets differ from its completed design",
          );
        row.competitiveAnalysis = design.work.competitiveAnalysis;
      }
      if (!row.competitiveAnalysis)
        throw new OfferConflict(
          "Competitive analysis required before approval",
        );
      row.lineage = {
        ...(design
          ? design.sourceRevisions
          : await captureSources(
              db,
              session,
              workspaceId,
              row.offeringId,
              row.definition,
            )),
        ...(design
          ? {
              offerDesignId: design.id,
              offerDesignUpdatedAt: design.updatedAt,
              methodology: {
                methodologyId: design.methodologyId,
                methodologyKey: design.methodologyKey,
                methodologyVersion: design.methodologyVersion,
              },
            }
          : {}),
      };
      row.status = "approved";
      row.approvedRevision = row.revision;
      row.approvedAt = now;
      row.approvedBy = actor;
    }
    if (
      (!isDesign || ["ready_for_review", "completed"].includes(row.status)) &&
      !(isDesign ? row.work : row.definition).targetIcpIds.length
    ) {
      const ledger = await db
        .collection("schema_versions")
        .findOne({ _id: "vapp-v1" } as Document, { session });
      if (![27, 28, 29, 30].includes(ledger?.version ?? 0))
        throw new OfferConflict(
          "Offer-first creation requires the reviewed schema v27 update",
        );
    }
    if (operation === "archive") {
      row.status = isDesign ? "abandoned" : "retired";
      row.archived = true;
      row.archivedAt = now;
    }
    if (operation !== "archive") {
      const selection = isDesign ? row.work : row.definition;
      await targets(
        db,
        session,
        workspaceId,
        row.offeringId,
        selection.targetIcpIds,
        selection.targetBuyerProfileIds,
      );
      const analysis = isDesign
        ? row.work.competitiveAnalysis
        : row.competitiveAnalysis;
      if (
        analysis &&
        (new Date(analysis.researchedAt) > now ||
          analysis.findings.some((f: Document) =>
            f.sources.some((s: Document) => new Date(s.observedAt) > now),
          ))
      )
        throw new OfferConflict("Future research dates");
    }
    if (!isDesign)
      row.contentHash = offerHash(row as Parameters<typeof offerHash>[0]);
    row = clean(schemas[resource].parse(row)) as Document;
    if (operation === "approve") {
      const snapshot = OfferRevisionSchema.parse({
        id: generatePlatformId("offerrevision"),
        workspaceId,
        offerId: row.id,
        revision: row.revision,
        snapshot: row,
        ...(design ? { designSnapshot: design } : {}),
      });
      await db
        .collection("offer_revisions")
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
      if (!result.matchedCount) throw new OfferConflict("Record changed");
    }
    await db.collection("events").insertOne(
      EventSchema.parse({
        id: generatePlatformId("event"),
        workspaceId,
        createdAt: now,
        updatedAt: now,
        occurredAt: now,
        actor,
        eventType: "offer_foundation_changed",
        payload: {
          application: "hvmapp",
          resource,
          resourceId: row.id,
          action: operation,
          revision: row.revision,
          contentHash: row.contentHash,
        },
      }),
      options,
    );
    return row;
  });
}
