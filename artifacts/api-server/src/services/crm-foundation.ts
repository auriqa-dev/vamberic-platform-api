import { INTERNAL_SCOPE } from "../authorization/policy";
import { z } from "zod";
import type { ClientSession, Db, Document } from "mongodb";
import { isDeepStrictEqual } from "node:util";
import {
  PersonSchema,
  ContactPointSchema,
  OrganisationSchema,
  OrganisationRelationshipSchema,
  ProductRelationshipSchema,
  OpportunitySchema,
  EventSchema,
  CampaignSchema,
  generatePlatformId,
  platformIdSchema,
} from "../domain/schemas";
import {
  CrmPipelineSchema,
  CrmWorkspaceSchema,
  CrmLeadSchema,
  CrmTaskSchema,
  ExternalReferenceSchema,
  externalEntityTypeSchema,
  EXTERNAL_ENTITY_PREFIXES,
} from "../domain/crm-records";
import {
  crmActorSchema,
  fieldEvidenceSchema,
  type FieldEvidence,
} from "../domain/crm-fields";
import type { MongoService } from "./mongo";
import type { DomainCollectionName } from "../db/collections";

export const CRM_SCHEMAS = {
  people: PersonSchema,
  contact_points: ContactPointSchema,
  organisations: OrganisationSchema,
  organisation_relationships: OrganisationRelationshipSchema,
  product_relationships: ProductRelationshipSchema,
  opportunities: OpportunitySchema,
  crm_pipelines: CrmPipelineSchema,
  events: EventSchema,
  campaigns: CampaignSchema,
  crm_workspaces: CrmWorkspaceSchema,
  crm_leads: CrmLeadSchema,
  crm_tasks: CrmTaskSchema,
  external_references: ExternalReferenceSchema,
} as const;
export type CrmWriteCollection = keyof typeof CRM_SCHEMAS;
const prefixes = {
  people: "person",
  contact_points: "contact",
  organisations: "org",
  organisation_relationships: "orgrel",
  product_relationships: "prodrel",
  opportunities: "opportunity",
  crm_pipelines: "pipeline",
  events: "event",
  campaigns: "campaign",
  crm_workspaces: "workspace",
  crm_leads: "lead",
  crm_tasks: "task",
  external_references: "externalref",
} as const;
export const ENRICHABLE_FIELDS: Partial<
  Record<CrmWriteCollection, readonly string[]>
> = {
  people: ["title", "preferredLanguage", "timezone", "socialProfiles"],
  organisations: [
    "description",
    "website",
    "normalizedDomain",
    "industryGroup",
    "foundedYear",
    "linkedinUrl",
    "revenueBand",
    "annualRevenue",
    "telephone",
    "address",
    "size.employees",
    "size.band",
    "address.line1",
    "address.line2",
    "address.city",
    "address.region",
    "address.postalCode",
    "address.countryCode",
  ],
  organisation_relationships: [
    "jobTitle",
    "department",
    "seniority",
    "employmentRole",
  ],
  crm_leads: [
    "salesLifecycleStage",
    "leadStatus",
    "targetAccount",
    "icpTier",
    "persona.label",
    "persona.reference",
    "qualificationReason",
    "disqualificationReason",
    "nextAction",
    "nextActionAt",
  ],
  product_relationships: [
    "salesLifecycleStage",
    "leadStatus",
    "targetAccount",
    "icpTier",
    "persona.label",
    "persona.reference",
    "qualificationReason",
    "disqualificationReason",
    "nextAction",
    "nextActionAt",
  ],
  opportunities: ["description", "priority", "dealType", "wonReason"],
};
const forbidden = new Set([
  "id",
  "_id",
  "createdAt",
  "updatedAt",
  "createdBy",
  "updatedBy",
  "schemaVersion",
  "_crmReferenceRevision",
]);
function objectSchema(collection: CrmWriteCollection): z.AnyZodObject {
  let schema: z.ZodTypeAny = CRM_SCHEMAS[collection];
  while (schema instanceof z.ZodEffects) schema = schema.innerType();
  return schema as z.AnyZodObject;
}
/** Strict patches are internal only; merged persistence validation runs before writes. */
export function crmPatchSchema(collection: CrmWriteCollection) {
  const shape = objectSchema(collection).shape as z.ZodRawShape;
  return z
    .object(
      Object.fromEntries(
        Object.entries(shape).filter(([key]) => !forbidden.has(key)),
      ),
    )
    .partial()
    .strict();
}
const getPath = (record: Document, path: string): unknown =>
  path
    .split(".")
    .reduce<unknown>(
      (v, key) =>
        v && typeof v === "object" ? (v as Document)[key] : undefined,
      record,
    );
function setPath(record: Document, path: string, value: unknown) {
  const keys = path.split(".");
  let target = record;
  for (const key of keys.slice(0, -1)) target = target[key] ??= {};
  target[keys.at(-1)!] = value;
}
// Objects are patched by leaf so existing siblings and unknown legacy fields survive.
function patchEntries(record: Document, prefix = ""): [string, unknown][] {
  return Object.entries(record).flatMap(([key, value]) => {
    if (
      ["__proto__", "prototype", "constructor"].includes(key) ||
      key.includes(".") ||
      key.startsWith("$")
    )
      throw new Error("Unsafe persistence field path");
    const path = prefix ? `${prefix}.${key}` : key;
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      !(value instanceof Date)
    )
      return patchEntries(value, path);
    return value === undefined ? [] : [[path, value] as [string, unknown]];
  });
}
export class CrmFoundationError extends Error {
  constructor(
    readonly code:
      | "INVALID_REFERENCE"
      | "CONFLICT"
      | "PROTECTED_VALUE"
      | "TRANSACTIONS_REQUIRED",
    message: string,
  ) {
    super(message);
  }
}
const invalid = () => {
  throw new CrmFoundationError(
    "INVALID_REFERENCE",
    "CRM references or product scope are inconsistent",
  );
};

export async function validateCrmReferences(
  db: Db,
  collection: CrmWriteCollection,
  record: Document,
  session?: ClientSession,
  lock = false,
) {
  const linked = new Map<string, Document>();
  const get = async (name: DomainCollectionName, id?: string) => {
    if (!id) return undefined;
    const key = `${name}:${id}`;
    if (linked.has(key)) return linked.get(key)!;
    const value = await db.collection(name).findOne({ id }, { session });
    if (!value) return invalid();
    linked.set(key, value);
    return value;
  };
  const workspace = await get("crm_workspaces", record.workspaceId);
  if (workspace?.archived) invalid();
  await get("organisations", record.clientOrganisationId);
  const task = await get("crm_tasks", record.taskId);
  await get("products", record.productId);
  await get("people", record.personId);
  await get("organisations", record.organisationId);
  for (const id of record.personIds ?? []) await get("people", id);
  const opp = await get("opportunities", record.opportunityId);
  const campaign = await get("campaigns", record.campaignId);
  const pipeline = await get("crm_pipelines", record.pipelineId);
  const scopes = [
    record.productId,
    opp?.productId,
    campaign?.productId,
    pipeline?.productId,
    task?.productId,
  ].filter(Boolean);
  if (new Set(scopes).size > 1) invalid();
  if (
    task &&
    ((record.opportunityId &&
      task.opportunityId &&
      record.opportunityId !== task.opportunityId) ||
      (record.organisationId &&
        task.organisationId &&
        record.organisationId !== task.organisationId) ||
      (record.personId && task.personId && record.personId !== task.personId))
  )
    invalid();
  if (opp) {
    if (record.organisationId && opp.organisationId !== record.organisationId)
      invalid();
    if (
      [
        ...(record.personIds ?? []),
        ...(record.personId ? [record.personId] : []),
      ].some((id) => !opp.personIds?.includes(id))
    )
      invalid();
  }
  if (pipeline) {
    const stage = pipeline.stages.find((s: Document) => s.id === record.stage);
    if (
      (pipeline.productId && pipeline.productId !== record.productId) ||
      !stage ||
      stage.status !== record.status
    )
      invalid();
  }
  for (const attribution of [
    record.firstAttribution,
    record.latestAttribution,
  ]) {
    const source = await get("campaigns", attribution?.campaignId);
    if (source?.productId && source.productId !== record.productId) invalid();
  }
  if (record.ownerAssignedAt && !record.owner) invalid();
  if (
    record.firstAttribution &&
    record.latestAttribution &&
    record.firstAttribution.observedAt > record.latestAttribution.observedAt
  )
    invalid();
  const employment = await get(
    "organisation_relationships",
    record.organisationRelationshipId,
  );
  if (employment && employment.personId !== record.personId) invalid();
  if (
    collection === "organisation_relationships" &&
    record.startDate &&
    record.endDate &&
    record.endDate < record.startDate
  )
    invalid();
  if (collection === "organisations") {
    const seen = new Set([record.id]);
    let parent = record.parentOrganisationId;
    for (let depth = 0; parent; depth++) {
      if (depth > 100 || seen.has(parent)) invalid();
      seen.add(parent);
      parent = (await get("organisations", parent))?.parentOrganisationId;
    }
  }
  if (collection === "opportunities") {
    for (const name of ["events", "crm_tasks"] as const) {
      const history = await db
        .collection(name)
        .find({ opportunityId: record.id }, { session })
        .toArray();
      if (
        history.some(
          (h) =>
            (h.productId && h.productId !== record.productId) ||
            (h.organisationId && h.organisationId !== record.organisationId) ||
            [...(h.personIds ?? []), ...(h.personId ? [h.personId] : [])].some(
              (personId) => !record.personIds.includes(personId),
            ),
        )
      )
        invalid();
    }
  }
  if (collection === "external_references") {
    await get(record.entityType, record.entityId);
    if (
      record.entityType === "crm_workspaces" &&
      record.workspaceId &&
      record.workspaceId !== record.entityId
    )
      invalid();
  }
  // Pipeline edits cannot invalidate any existing opportunity, including archived history.
  if (collection === "crm_pipelines") {
    const opportunities = await db
      .collection("opportunities")
      .find({ pipelineId: record.id }, { session })
      .toArray();
    if (
      opportunities.some(
        (o) =>
          o.workspaceId !== record.workspaceId ||
          (record.productId && o.productId !== record.productId) ||
          !record.stages.some(
            (s: Document) => s.id === o.stage && s.status === o.status,
          ),
      )
    )
      invalid();
  }
  // Ownership is independent of commercial product context. Cross-workspace sharing
  // needs a future explicit grant; no implicit permission comes from a linked product.
  for (const [key, linkedRecord] of linked) {
    const name = key.split(":")[0];
    if (name === "products" || name === "crm_workspaces") continue;
    if (
      collection === "crm_workspaces" &&
      linkedRecord.id === record.clientOrganisationId
    ) {
      if (linkedRecord.workspaceId) invalid(); // client registry belongs to the internal portfolio
      continue;
    }
    if (linkedRecord.workspaceId !== record.workspaceId) invalid();
  }
  if (lock && session) {
    // A write on referenced documents serializes against concurrent hard deletion
    // and pipeline edits. This internal counter is not a domain/audit field.
    for (const [key, value] of linked) {
      const name = key.slice(0, key.indexOf(":"));
      const result = await db
        .collection(name)
        .updateOne(
          { id: value.id },
          { $inc: { _crmReferenceRevision: 1 } },
          { session },
        );
      if (!result.matchedCount) invalid();
    }
  }
}
function checkEvidence(
  collection: CrmWriteCollection,
  record: Document,
  actor: z.infer<typeof crmActorSchema>,
  previous?: Document,
) {
  for (const item of record.fieldEvidence ?? []) {
    if (!(ENRICHABLE_FIELDS[collection] ?? []).includes(item.field))
      throw new Error("Unsupported evidence field");
    if (
      item.verification === "human_verified" &&
      actor.type !== "human" &&
      !(previous?.fieldEvidence ?? []).some((old: Document) =>
        isDeepStrictEqual(old, item),
      )
    )
      throw new CrmFoundationError(
        "PROTECTED_VALUE",
        "Human verification requires a human actor",
      );
    const candidate = structuredClone(record);
    setPath(candidate, item.field, item.value);
    CRM_SCHEMAS[collection].parse(candidate);
  }
  if (
    previous?.fieldEvidence &&
    !(previous.fieldEvidence as Document[]).every((old) =>
      (record.fieldEvidence ?? []).some((item: Document) =>
        isDeepStrictEqual(old, item),
      ),
    )
  )
    throw new CrmFoundationError(
      "PROTECTED_VALUE",
      "Evidence history cannot be removed or rewritten",
    );
}
async function write(
  mongo: MongoService,
  collection: CrmWriteCollection,
  input: unknown,
  actorInput: unknown,
  existing?: { id: string; updatedAt: Date },
  observation?: FieldEvidence,
) {
  if (existing && collection === "events")
    throw new CrmFoundationError("PROTECTED_VALUE", "Events are append-only");
  const actor = crmActorSchema.parse(actorInput);
  const patch = crmPatchSchema(collection).parse(input);
  if (!mongo.withTransaction)
    throw new CrmFoundationError(
      "TRANSACTIONS_REQUIRED",
      "CRM writes require transactions",
    );
  return mongo.withTransaction(async (db, session) => {
    const target = db.collection(collection);
    const previous = existing
      ? await target.findOne(
          { id: existing.id, updatedAt: existing.updatedAt },
          { session },
        )
      : undefined;
    if (existing && !previous)
      throw new CrmFoundationError(
        "CONFLICT",
        "CRM record changed; reload before updating",
      );
    if (
      previous?.source &&
      "source" in patch &&
      !isDeepStrictEqual(previous.source, patch.source)
    )
      throw new CrmFoundationError(
        "PROTECTED_VALUE",
        "Original source evidence cannot be replaced",
      );
    if (previous && collection === "contact_points")
      for (const key of ["type", "value", "normalizedValue"]) {
        if (key in patch && !isDeepStrictEqual(patch[key], previous[key]))
          throw new CrmFoundationError(
            "PROTECTED_VALUE",
            "Contact identity is immutable; create another contact point",
          );
      }
    if (previous && collection === "crm_workspaces")
      for (const key of ["kind", "clientOrganisationId"])
        if (key in patch && !isDeepStrictEqual(patch[key], previous[key]))
          throw new CrmFoundationError(
            "PROTECTED_VALUE",
            "Workspace ownership cannot be reassigned",
          );
    // Relation endpoints are immutable; create another historical relationship instead.
    if (previous)
      for (const key of collection === "external_references"
        ? [
            "workspaceId",
            "provider",
            "providerAccountId",
            "objectType",
            "externalId",
            "entityType",
            "entityId",
          ]
        : [
            "workspaceId",
            "productId",
            "personId",
            "organisationId",
            "opportunityId",
            "pipelineId",
          ].filter(
            (key) => collection !== "opportunities" || key !== "pipelineId",
          )) {
        if (key in patch && !isDeepStrictEqual(patch[key], previous[key]))
          throw new CrmFoundationError(
            "PROTECTED_VALUE",
            "Existing CRM scope/identity cannot be reassigned",
          );
      }
    if (previous?.workspaceId || patch.workspaceId)
      throw new CrmFoundationError(
        "PROTECTED_VALUE",
        "Workspace operations require a future application authorization boundary",
      );
    const now = new Date(
      Math.max(Date.now(), (previous?.updatedAt?.getTime() ?? 0) + 1),
    );
    const merged: Document = {
      ...structuredClone(previous),
      id: existing?.id ?? generatePlatformId(prefixes[collection]),
      createdAt: previous?.createdAt ?? now,
      createdBy: previous?.createdBy ?? actor,
      updatedAt: now,
      updatedBy: actor,
    };
    const entries = patchEntries(patch);
    for (const [path, value] of entries)
      setPath(merged, path, structuredClone(value));
    let promotedField: string | undefined;
    if (observation) {
      const item = fieldEvidenceSchema.parse(observation);
      if (!(ENRICHABLE_FIELDS[collection] ?? []).includes(item.field))
        throw new Error("Unsupported evidence field");
      merged.fieldEvidence = [...(previous?.fieldEvidence ?? []), item];
      // Observations do not overwrite facts. A verified observation may only fill
      // an absent field; changing an existing fact requires an explicit human edit.
      if (
        ["provider_verified", "human_verified"].includes(item.verification) &&
        getPath(merged, item.field) === undefined
      ) {
        setPath(merged, item.field, item.value);
        promotedField = item.field;
      }
    }
    const parsed: Document = CRM_SCHEMAS[collection].parse(merged);
    checkEvidence(collection, parsed, actor, previous ?? undefined);
    if (!observation && actor.type !== "human")
      for (const field of ENRICHABLE_FIELDS[collection] ?? []) {
        if (
          !isDeepStrictEqual(
            getPath(previous ?? {}, field),
            getPath(parsed, field),
          )
        )
          throw new CrmFoundationError(
            "PROTECTED_VALUE",
            "Enrichment must use the observation path",
          );
      }
    await validateCrmReferences(db, collection, parsed, session, true);
    if (previous) {
      const keys = new Set([
        ...entries.map(([path]) => path),
        "updatedAt",
        "updatedBy",
        ...(observation ? ["fieldEvidence"] : []),
        ...(promotedField ? [promotedField] : []),
      ]);
      const update = Object.fromEntries(
        [...keys]
          .filter((key) => getPath(parsed, key) !== undefined)
          .map((key) => [key, getPath(parsed, key)]),
      );
      const result = await target.updateOne(
        { id: previous.id, updatedAt: existing!.updatedAt },
        { $set: update },
        { session },
      );
      if (!result.matchedCount)
        throw new CrmFoundationError("CONFLICT", "CRM record changed");
    } else await target.insertOne(parsed, { session });
    return parsed;
  });
}
export const createCrmRecord = (
  mongo: MongoService,
  collection: CrmWriteCollection,
  input: unknown,
  actor: unknown,
) => write(mongo, collection, input, actor);
export const updateCrmRecord = (
  mongo: MongoService,
  collection: CrmWriteCollection,
  id: string,
  updatedAt: Date,
  patch: unknown,
  actor: unknown,
) => write(mongo, collection, patch, actor, { id, updatedAt });
export const observeCrmField = (
  mongo: MongoService,
  collection: CrmWriteCollection,
  id: string,
  updatedAt: Date,
  observation: FieldEvidence,
  actor: unknown,
) => write(mongo, collection, {}, actor, { id, updatedAt }, observation);

/** Internal query surfaces for the declared queue/timeline indexes; no HTTP exposure. */
export async function listCrmEventTimeline(
  db: Db,
  subject: {
    personId?: string;
    organisationId?: string;
    opportunityId?: string;
    productId?: string;
  },
) {
  const parsed = z
    .object({
      personId: PersonSchema.shape.id.optional(),
      organisationId: OrganisationSchema.shape.id.optional(),
      opportunityId: platformIdSchema("opportunity").optional(),
      productId: platformIdSchema("product").optional(),
    })
    .strict()
    .refine((v) => Object.values(v).filter(Boolean).length === 1)
    .parse(subject);
  const filter = parsed.personId
    ? { $or: [{ personId: parsed.personId }, { personIds: parsed.personId }] }
    : parsed;
  return db
    .collection("events")
    .find({ ...INTERNAL_SCOPE, ...filter })
    .sort({ occurredAt: -1 })
    .limit(100)
    .toArray();
}
export async function listCrmTaskQueue(
  db: Db,
  input: {
    productId: string;
    assignedToId?: string;
    status: string;
    dueBefore?: Date;
  },
) {
  const query = z
    .object({
      productId: platformIdSchema("product"),
      assignedToId: z.string().min(1).max(300).optional(),
      status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
      dueBefore: z.date().optional(),
    })
    .strict()
    .parse(input);
  return db
    .collection("crm_tasks")
    .find({
      ...INTERNAL_SCOPE,
      productId: query.productId,
      ...(query.assignedToId ? { "assignedTo.id": query.assignedToId } : {}),
      status: query.status,
      ...(query.dueBefore ? { dueAt: { $lt: query.dueBefore } } : {}),
    })
    .sort({ dueAt: 1 })
    .limit(100)
    .toArray();
}
export async function findOrganisationCandidates(
  db: Db,
  normalizedDomain: string,
) {
  const domain = OrganisationSchema.shape.normalizedDomain
    .unwrap()
    .parse(normalizedDomain);
  return db
    .collection("organisations")
    .find({ ...INTERNAL_SCOPE, normalizedDomain: domain })
    .limit(100)
    .toArray();
}
export async function listCrmPipelines(
  db: Db,
  productId: string,
  archived = false,
) {
  return db
    .collection("crm_pipelines")
    .find({
      ...INTERNAL_SCOPE,
      productId: platformIdSchema("product").parse(productId),
      archived: z.boolean().parse(archived),
    })
    .limit(100)
    .toArray();
}
export async function listProductLeads(
  db: Db,
  input: { productId: string; leadStatus: string; ownerId?: string },
) {
  const query = z
    .object({
      productId: platformIdSchema("product"),
      leadStatus: objectSchema(
        "product_relationships",
      ).shape.leadStatus.unwrap(),
      ownerId: z.string().min(1).max(300).optional(),
    })
    .strict()
    .parse(input);
  return db
    .collection("product_relationships")
    .find({
      ...INTERNAL_SCOPE,
      productId: query.productId,
      leadStatus: query.leadStatus,
      ...(query.ownerId ? { "owner.id": query.ownerId } : {}),
    })
    .sort({ nextActionAt: 1 })
    .limit(100)
    .toArray();
}
export async function listPipelineOpportunities(
  db: Db,
  input: {
    productId: string;
    pipelineId: string;
    status: string;
    stage: string;
  },
) {
  const query = z
    .object({
      productId: platformIdSchema("product"),
      pipelineId: platformIdSchema("pipeline"),
      status: z.enum(["open", "won", "lost", "paused"]),
      stage: z.string().min(1).max(100),
    })
    .strict()
    .parse(input);
  return db
    .collection("opportunities")
    .find({ ...INTERNAL_SCOPE, ...query })
    .limit(100)
    .toArray();
}
export async function listOwnerOpportunities(
  db: Db,
  productId: string,
  ownerId: string,
) {
  return db
    .collection("opportunities")
    .find({
      ...INTERNAL_SCOPE,
      productId: platformIdSchema("product").parse(productId),
      "owner.id": z.string().min(1).max(300).parse(ownerId),
    })
    .sort({ nextActionAt: 1 })
    .limit(100)
    .toArray();
}
export async function findExternalMappings(
  db: Db,
  entityType: string,
  entityId: string,
) {
  const type = externalEntityTypeSchema.parse(entityType);
  const id = platformIdSchema(EXTERNAL_ENTITY_PREFIXES[type]).parse(entityId);
  return db
    .collection("external_references")
    .find({ ...INTERNAL_SCOPE, entityType: type, entityId: id })
    .limit(100)
    .toArray();
}
