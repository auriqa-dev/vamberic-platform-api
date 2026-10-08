import { z } from "zod";
import type { Db, ClientSession, Document } from "mongodb";
import type { AppConfig } from "../config";
import type { AuthenticatedUser } from "../middlewares/auth";
import type { MongoService } from "./mongo";
import { resolveHvmContext } from "./hvm-context";
import { AuthorizationDenied } from "../authorization/policy";
import {
  PersonSchema,
  OrganisationSchema,
  ContactPointSchema,
  OrganisationRelationshipSchema,
  EventSchema,
  generatePlatformId,
  platformIdSchema,
  normalizeContactValue,
} from "../domain";
import { lockIcpWorkspace } from "./icp/access";
import { ESOS_SUPPORTING_SOURCE } from "./icp/esos-recovery";

export class ContactConflict extends Error {}
const text = z.string().trim().max(300);
export const contactFields = z
  .object({
    firstName: text.min(1).max(100),
    lastName: text.max(100),
    title: text.max(200),
    email: z.union([z.literal(""), z.string().trim().email().max(254)]),
    phone: text
      .max(100)
      .refine(
        (v) => !v || /^[+\d\s().-]{5,100}$/.test(v),
        "Enter a valid phone number",
      ),
    organisationId: z.union([z.literal(""), platformIdSchema("org")]),
  })
  .strict();
export const organisationFields = z
  .object({
    name: text.min(1),
    website: z
      .union([z.literal(""), z.string().trim().url().max(2000)])
      .refine(
        (v) => !v || /^https?:\/\//i.test(v),
        "Use an http or https website",
      ),
    industry: text.max(200),
    country: z
      .string()
      .trim()
      .regex(/^([A-Za-z]{2})?$/, "Use a two-letter country code"),
    region: text.max(100),
    description: z.string().trim().max(10000),
    type: z.enum(["prospect", "customer", "partner", "vendor", "other"]),
  })
  .strict();
export type RecordKind = "contacts" | "organisations";
export const kindSchema = z.enum(["contacts", "organisations"]);
const collection = (kind: RecordKind) =>
  kind === "contacts" ? "people" : "organisations";
const prefix = (kind: RecordKind) =>
  kind === "contacts" ? ("person" as const) : ("org" as const);
const visible = { "source.system": { $ne: ESOS_SUPPORTING_SOURCE } };
const literal = (s: string) =>
  new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
async function access(
  db: Db,
  config: AppConfig,
  identity: AuthenticatedUser,
  w: string,
  kind: RecordKind,
  action: "read" | "create" | "update",
  session?: ClientSession,
) {
  platformIdSchema("workspace").parse(w);
  const r = await resolveHvmContext(db, config, identity, session);
  if (r.context.application !== "hvmapp" || r.context.actor.type !== "human")
    throw new AuthorizationDenied();
  r.authority.scopeFilter(r.context, action, {
    type: collection(kind) as "people" | "organisations",
    workspaceId: w,
  });
  return { type: "human" as const, id: r.context.actor.id };
}
// Count only recorded communication outcomes, never import/edit events or future meetings.
export function engagementLookup(
  w: string,
  kind: RecordKind,
  now = new Date(),
): Document {
  return {
    $lookup: {
      from: "events",
      let: { recordId: "$id" },
      pipeline: [
        {
          $match: {
            workspaceId: w,
            archived: { $ne: true },
            occurredAt: { $lte: now },
            $expr:
              kind === "contacts"
                ? {
                    $or: [
                      { $eq: ["$personId", "$$recordId"] },
                      { $in: ["$$recordId", { $ifNull: ["$personIds", []] }] },
                    ],
                  }
                : { $eq: ["$organisationId", "$$recordId"] },
            $or: [
              {
                "interaction.details.type": "call",
                "interaction.details.outcome": "connected",
              },
              {
                "interaction.details.type": "email",
                "interaction.details.outcome": { $in: ["sent", "received"] },
              },
              {
                "interaction.details.type": "meeting",
                "interaction.details.outcome": "held",
              },
              { "interaction.details.type": "communication" },
            ],
          },
        },
        { $sort: { occurredAt: -1, id: 1 } },
        { $limit: 1 },
        { $project: { _id: 0, occurredAt: 1 } },
      ],
      as: "engagement",
    },
  };
}
export function recordPipeline(
  w: string,
  kind: RecordKind,
  filter: Document,
  limit: number,
  offset: number,
) {
  return [
    { $match: filter },
    engagementLookup(w, kind),
    {
      $set: {
        lastEngagedAt: {
          $ifNull: [{ $arrayElemAt: ["$engagement.occurredAt", 0] }, null],
        },
      },
    },
    { $sort: { lastEngagedAt: -1, id: 1 } },
    {
      $facet: {
        items: [{ $skip: offset }, { $limit: limit }],
        count: [{ $count: "total" }],
      },
    },
  ];
}
async function dto(
  db: Db,
  w: string,
  kind: RecordKind,
  row: Document,
  session?: ClientSession,
) {
  const base = {
    id: row.id,
    updatedAt: row.updatedAt.toISOString(),
    archived: row.archived === true,
    lastEngagedAt: row.lastEngagedAt?.toISOString() ?? null,
  };
  if (kind === "organisations")
    return {
      ...base,
      name: row.name,
      website: row.website ?? (row.domain ? `https://${row.domain}` : ""),
      industry: row.industry ?? "",
      country: row.country ?? row.address?.countryCode ?? "",
      region: row.region ?? row.address?.region ?? "",
      description: row.description ?? "",
      type: row.type,
      registration: row.source?.reference?.startsWith("GB:")
        ? row.source.reference.slice(3)
        : "",
    };
  const points = await db
    .collection("contact_points")
    .find(
      { workspaceId: w, personId: row.id, archived: { $ne: true } },
      { session },
    )
    .sort({ primary: -1, id: 1 })
    .toArray();
  const rel = await db
    .collection("organisation_relationships")
    .find(
      {
        workspaceId: w,
        personId: row.id,
        current: true,
        archived: { $ne: true },
      },
      { session },
    )
    .sort({ createdAt: 1, id: 1 })
    .limit(1)
    .next();
  const org = rel
    ? await db
        .collection("organisations")
        .findOne(
          { workspaceId: w, id: rel.organisationId, ...visible },
          { session },
        )
    : null;
  return {
    ...base,
    name:
      row.displayName ??
      [row.firstName, row.lastName].filter(Boolean).join(" "),
    firstName: row.firstName,
    lastName: row.lastName ?? "",
    title: row.title ?? rel?.jobTitle ?? "",
    email: points.find((p) => p.type === "email")?.value ?? "",
    phone: points.find((p) => p.type === "phone")?.value ?? "",
    organisationId: org?.id ?? "",
    organisationName: org?.name ?? "",
  };
}
async function duplicates(
  db: Db,
  w: string,
  kind: RecordKind,
  fields: Record<string, string>,
  id?: string,
  session?: ClientSession,
) {
  if (kind === "contacts") {
    if (
      !fields.email &&
      !fields.phone &&
      (await db.collection("people").findOne(
        {
          workspaceId: w,
          id: { $ne: id ?? "" },
          archived: { $ne: true },
          firstName: new RegExp(
            `^${fields.firstName!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
            "i",
          ),
          lastName: fields.lastName || { $exists: false },
        },
        { session },
      ))
    )
      throw new ContactConflict(
        "A contact with this name exists. Add an email or phone to distinguish a different person.",
      );
    for (const type of ["email", "phone"] as const)
      if (fields[type]) {
        const match = await db.collection("contact_points").findOne(
          {
            workspaceId: w,
            type,
            normalizedValue: normalizeContactValue(type, fields[type]),
            archived: { $ne: true },
            personId: { $ne: id ?? "" },
          },
          { session },
        );
        if (match)
          throw new ContactConflict(
            `Another contact already uses this ${type}. Search for the existing contact first.`,
          );
      }
  } else {
    const or: Document[] = [
      {
        name: new RegExp(
          `^${fields.name!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
          "i",
        ),
      },
    ];
    if (fields.website) {
      const domain = new URL(fields.website).hostname
        .toLowerCase()
        .replace(/^www\./, "");
      or.push({ normalizedDomain: domain }, { domain });
    }
    if (
      await db.collection("organisations").findOne(
        {
          workspaceId: w,
          id: { $ne: id ?? "" },
          archived: { $ne: true },
          $or: or,
        },
        { session },
      )
    )
      throw new ContactConflict(
        "An organisation with this name or website already exists. Search for it before creating another.",
      );
  }
}
export function createContactManagement(
  config: AppConfig,
  mongo: MongoService,
) {
  async function list(
    identity: AuthenticatedUser,
    w: string,
    kind: RecordKind,
    raw: unknown,
  ) {
    const q = z
      .object({
        search: z.string().max(200).default(""),
        offset: z.coerce.number().int().min(0).max(1000000).default(0),
        limit: z.coerce.number().int().min(1).max(50).default(25),
        archived: z.enum(["true", "false"]).default("false"),
      })
      .strict()
      .parse(raw);
    const db = await mongo.database();
    await access(db, config, identity, w, kind, "read");
    const filter: Document = {
      workspaceId: w,
      ...visible,
      archived: q.archived === "true" ? true : { $ne: true },
    };
    if (q.search.trim()) {
      const re = literal(q.search.trim());
      if (kind === "organisations")
        filter.$or = [{ name: re }, { domain: re }, { website: re }];
      else {
        // Joins remain server-side; no full collection is returned to the browser.
        const points = await db
          .collection("contact_points")
          .find({
            workspaceId: w,
            archived: { $ne: true },
            normalizedValue: re,
          })
          .project({ personId: 1 })
          .toArray();
        const orgs = await db
          .collection("organisations")
          .find({
            workspaceId: w,
            ...visible,
            name: re,
            archived: { $ne: true },
          })
          .project({ id: 1 })
          .toArray();
        const links = await db
          .collection("organisation_relationships")
          .find({
            workspaceId: w,
            current: true,
            archived: { $ne: true },
            organisationId: { $in: orgs.map((o) => o.id) },
          })
          .project({ personId: 1 })
          .toArray();
        filter.$or = [
          { firstName: re },
          { lastName: re },
          { displayName: re },
          { id: { $in: [...points, ...links].map((p) => p.personId) } },
        ];
      }
    }
    const [result] = await db
      .collection(collection(kind))
      .aggregate(recordPipeline(w, kind, filter, q.limit, q.offset), {
        maxTimeMS: 10000,
      })
      .toArray();
    let canWrite = true;
    try {
      await access(db, config, identity, w, kind, "update");
    } catch {
      canWrite = false;
    }
    return {
      items: await Promise.all(
        (result?.items ?? []).map((r: Document) => dto(db, w, kind, r)),
      ),
      total: result?.count[0]?.total ?? 0,
      limit: q.limit,
      offset: q.offset,
      canWrite,
    };
  }
  async function read(
    identity: AuthenticatedUser,
    w: string,
    kind: RecordKind,
    id: string,
  ) {
    platformIdSchema(prefix(kind)).parse(id);
    const db = await mongo.database();
    await access(db, config, identity, w, kind, "read");
    const [r] = await db
      .collection(collection(kind))
      .aggregate([
        { $match: { workspaceId: w, id, ...visible } },
        engagementLookup(w, kind),
        {
          $set: {
            lastEngagedAt: { $arrayElemAt: ["$engagement.occurredAt", 0] },
          },
        },
      ])
      .toArray();
    if (!r) throw new AuthorizationDenied();
    return dto(db, w, kind, r);
  }
  async function write(
    identity: AuthenticatedUser,
    w: string,
    kind: RecordKind,
    id: string | undefined,
    raw: unknown,
    mode: "save" | "archive" | "restore" = "save",
  ) {
    const input = z
      .object({
        updatedAt: z.string().datetime().optional(),
        fields: z.unknown().optional(),
      })
      .strict()
      .parse(raw);
    const fields =
      mode === "save"
        ? (kind === "contacts" ? contactFields : organisationFields).parse(
            input.fields,
          )
        : undefined;
    if (id) {
      platformIdSchema(prefix(kind)).parse(id);
      if (!input.updatedAt)
        throw new ContactConflict("Refresh this record before saving.");
    }
    if (!mongo.withTransaction) throw Error("Transactions required");
    return mongo.withTransaction(async (db, session) => {
      const actor = await access(
        db,
        config,
        identity,
        w,
        kind,
        id ? "update" : "create",
        session,
      );
      const now = await lockIcpWorkspace(db, w, session);
      const c = db.collection(collection(kind));
      const old = id
        ? await c.findOne({ workspaceId: w, id, ...visible }, { session })
        : null;
      if (id && !old) throw new AuthorizationDenied();
      if (old && old.updatedAt.toISOString() !== input.updatedAt)
        throw new ContactConflict(
          "This record changed. Reopen it before saving your edits.",
        );
      if (mode === "save" && old?.archived)
        throw new ContactConflict("Restore this record before editing it.");
      if (mode !== "save" && !old) throw new AuthorizationDenied();
      const recordId = id ?? generatePlatformId(prefix(kind));
      if (mode !== "archive") {
        const candidate = fields ?? (await dto(db, w, kind, old!, session));
        await duplicates(
          db,
          w,
          kind,
          candidate as Record<string, string>,
          recordId,
          session,
        );
      }
      if (mode === "save") {
        const f = fields as Record<string, string>;
        if (kind === "contacts" && f.organisationId) {
          await access(
            db,
            config,
            identity,
            w,
            "organisations",
            "read",
            session,
          );
          if (
            !(await db.collection("organisations").findOne(
              {
                workspaceId: w,
                id: f.organisationId,
                archived: { $ne: true },
                ...visible,
              },
              { session },
            ))
          )
            throw new ContactConflict(
              "Choose an active organisation in this workspace.",
            );
        }
        const changes: Document =
          kind === "contacts"
            ? {
                firstName: f.firstName,
                lastName: f.lastName,
                title: f.title,
                displayName: [f.firstName, f.lastName]
                  .filter(Boolean)
                  .join(" "),
              }
            : { ...f, country: f.country!.toUpperCase() };
        if (kind === "organisations") {
          if (f.website)
            changes.domain = changes.normalizedDomain = new URL(
              f.website,
            ).hostname
              .toLowerCase()
              .replace(/^www\./, "");
          else {
            delete changes.website;
          }
        }
        const next: Document = {
          ...old,
          ...changes,
          id: recordId,
          workspaceId: w,
          createdAt: old?.createdAt ?? now,
          updatedAt: now,
          updatedBy: actor,
          ...(!old
            ? { createdBy: actor, source: { system: "hvm_contact_management" } }
            : {}),
        };
        if (kind === "organisations" && !f.website) {
          delete next.website;
          delete next.domain;
          delete next.normalizedDomain;
        }
        if (kind === "contacts" && !f.lastName) {
          delete next.lastName;
          delete changes.lastName;
        }
        (kind === "contacts" ? PersonSchema : OrganisationSchema).parse(next);
        if (old) {
          const update: Document = {
            $set: { ...changes, updatedAt: now, updatedBy: actor },
          };
          if (kind === "contacts" && !f.lastName)
            update.$unset = { lastName: "" };
          if (kind === "organisations" && !f.website)
            update.$unset = { website: "", domain: "", normalizedDomain: "" };
          await c.updateOne(
            { workspaceId: w, id: recordId, updatedAt: old.updatedAt },
            update,
            { session },
          );
        } else
          await c.insertOne(
            (kind === "contacts" ? PersonSchema : OrganisationSchema).parse(
              next,
            ),
            { session },
          );
        if (kind === "contacts") {
          for (const type of ["email", "phone"] as const) {
            const cp = db.collection("contact_points");
            const existing = await cp
              .find(
                {
                  workspaceId: w,
                  personId: recordId,
                  type,
                  archived: { $ne: true },
                },
                { session },
              )
              .sort({ primary: -1, id: 1 })
              .limit(1)
              .next();
            if ((existing?.value ?? "") === f[type]) continue;
            // Changed addresses are new contact points; never transfer deliverability or consent.
            if (existing)
              await cp.updateOne(
                { workspaceId: w, id: existing.id },
                {
                  $set: {
                    archived: true,
                    primary: false,
                    archivedAt: now,
                    updatedAt: now,
                    updatedBy: actor,
                  },
                },
                { session },
              );
            const historical = f[type]
              ? await cp.findOne(
                  {
                    workspaceId: w,
                    personId: recordId,
                    type,
                    normalizedValue: normalizeContactValue(type, f[type]!),
                  },
                  { session },
                )
              : null;
            if (historical && f[type])
              await cp.updateOne(
                { workspaceId: w, id: historical.id },
                {
                  $set: {
                    value: f[type],
                    archived: false,
                    primary: true,
                    updatedAt: now,
                    updatedBy: actor,
                  },
                  $unset: { archivedAt: "" },
                },
                { session },
              );
            else if (f[type])
              await cp.insertOne(
                ContactPointSchema.parse({
                  id: generatePlatformId("contact"),
                  workspaceId: w,
                  personId: recordId,
                  type,
                  value: f[type],
                  normalizedValue: normalizeContactValue(type, f[type]!),
                  primary: true,
                  createdAt: now,
                  updatedAt: now,
                  createdBy: actor,
                }),
                { session },
              );
          }
          const rels = db.collection("organisation_relationships");
          const rel = await rels
            .find(
              {
                workspaceId: w,
                personId: recordId,
                current: true,
                archived: { $ne: true },
              },
              { session },
            )
            .sort({ createdAt: 1, id: 1 })
            .limit(1)
            .next();
          if ((rel?.organisationId ?? "") !== f.organisationId) {
            if (rel)
              await rels.updateOne(
                { workspaceId: w, id: rel.id },
                { $set: { current: false, endDate: now, updatedAt: now } },
                { session },
              );
            if (f.organisationId)
              await rels.insertOne(
                OrganisationRelationshipSchema.parse({
                  id: generatePlatformId("orgrel"),
                  workspaceId: w,
                  personId: recordId,
                  organisationId: f.organisationId,
                  current: true,
                  jobTitle: f.title,
                  createdAt: now,
                  updatedAt: now,
                }),
                { session },
              );
          } else if (rel && rel.jobTitle !== f.title)
            await rels.updateOne(
              { workspaceId: w, id: rel.id },
              { $set: { jobTitle: f.title, updatedAt: now } },
              { session },
            );
        }
      } else
        await c.updateOne(
          { workspaceId: w, id: recordId, updatedAt: old!.updatedAt },
          {
            $set: {
              archived: mode === "archive",
              updatedAt: now,
              updatedBy: actor,
              ...(mode === "archive" ? { archivedAt: now } : {}),
            },
            ...(mode === "restore" ? { $unset: { archivedAt: "" } } : {}),
          },
          { session },
        );
      await db.collection("events").insertOne(
        EventSchema.parse({
          id: generatePlatformId("event"),
          workspaceId: w,
          eventType:
            "hvm_record_" +
            (mode === "save" ? (old ? "updated" : "created") : mode),
          occurredAt: now,
          createdAt: now,
          updatedAt: now,
          createdBy: actor,
          payload: {
            recordId,
            kind,
            action: mode,
            fields: fields ? Object.keys(fields) : [],
          },
        }),
        { session },
      );
      return { id: recordId };
    });
  }
  return { list, read, write };
}
