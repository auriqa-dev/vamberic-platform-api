import { z } from "zod";
import type { ClientSession, Db, Document } from "mongodb";
import type { AppConfig } from "../../config";
import type { AuthenticatedUser } from "../../middlewares/auth";
import type { MongoService } from "../mongo";
import { COLLECTION_NAMES } from "../../db/collection-names";
import {
  EventSchema,
  generatePlatformId,
  platformIdSchema,
  partnerHumanSchema,
} from "../../domain";
import { semanticHash } from "../../domain/hive-definitions";
import { resolveHvmContext } from "../hvm-context";
import { AuthorizationDenied } from "../../authorization/policy";
import { HiveConflict } from "../hive-definitions";
import { lockIcpWorkspace } from "../icp/access";

const targetSchema = z
  .object({
    kind: z.enum(["company", "product", "generation", "product-draft"]),
    id: z.string(),
  })
  .strict();
const owned = [
  "offerings",
  "ideal_customer_profiles",
  "buyer_profiles",
  "hive_definition_revisions",
  "offers",
  "offer_designs",
  "offer_revisions",
];
const labels: Record<string, string> = {
  offerings: "Products and services",
  ideal_customer_profiles: "Ideal customer profiles",
  buyer_profiles: "Buyer profiles",
  hive_definition_revisions: "Profile revisions",
  offers: "Offers",
  offer_designs: "Offer designs and research",
  offer_revisions: "Offer revisions",
  events: "Company details, generation results and history",
};
const contains = (value: unknown, ids: Set<string>): boolean => {
  if (typeof value === "string")
    return [...ids].some((id) => value.includes(id));
  if (!value || value instanceof Date) return false;
  if (Array.isArray(value)) return value.some((v) => contains(v, ids));
  if (typeof value === "object")
    return Object.values(value).some((v) => contains(v, ids));
  return false;
};
const workflowEvent = (row: Document) =>
  /^(psu_|icp_|offer_|hive_definition_|canonical_support_certified$)/.test(
    row.eventType ?? "",
  );

/** Explicit ownership cascade; references from any surviving record fail closed. */
export function planProfileDeletion(
  rows: Record<string, Document[]>,
  target: z.infer<typeof targetSchema>,
) {
  const events = rows.events ?? [],
    products = rows.offerings ?? [];
  const requested = events.filter(
    (r) => r.eventType === "psu_generation_requested",
  );
  const job = ["generation", "product-draft"].includes(target.kind)
    ? requested.find((r) => r.id === target.id)
    : undefined;
  if (["generation", "product-draft"].includes(target.kind) && !job)
    throw new AuthorizationDenied();
  const deletingCompany =
    target.kind === "company" ||
    (target.kind === "generation" && job?.payload?.input?.kind === "company");
  const brandId = deletingCompany
    ? (job?.payload?.input?.brandId ?? target.id)
    : job?.payload?.input?.brandId;
  const company = deletingCompany
    ? events
        .filter(
          (r) =>
            r.eventType === "psu_company_saved" &&
            r.payload?.brandId === brandId,
        )
        .sort(
          (a, b) =>
            b.createdAt.getTime() - a.createdAt.getTime() ||
            b.id.localeCompare(a.id),
        )[0]
    : undefined;
  const savedProductId =
    job &&
    events.find(
      (r) => r.eventType === "psu_review_saved" && r.payload?.jobId === job.id,
    )?.payload?.offeringId;
  const product = products.find(
    (r) =>
      r.id ===
      (target.kind === "product"
        ? target.id
        : (job?.payload?.input?.offeringId ?? savedProductId)),
  );
  if (
    deletingCompany
      ? !company &&
        !requested.some(
          (r) =>
            r.payload?.input?.brandId === brandId &&
            r.payload?.input?.kind === "company",
        )
      : !product && !job
  )
    throw new AuthorizationDenied();
  const selected = deletingCompany
    ? products.filter((r) => r.brandId === brandId)
    : product
      ? [product]
      : [];
  const ids = new Set<string>(selected.map((r) => r.id));
  const selectedRows = new Map<string, Document[]>([["offerings", selected]]);
  const updates: { original: Document; replacement: Document }[] = [];
  const blockers: string[] =
    target.kind === "generation"
      ? [
          "Refresh this page to use the complete company or product deletion preview.",
        ]
      : [];
  const protectedEvents = new Set<string>();
  const seedEvents: Document[] = [];
  const addEvent = (r: Document) => {
    if (!ids.has(r.id)) {
      seedEvents.push(r);
      ids.add(r.id);
    }
  };
  // Match historic attempts by explicit product identity first. URL matching is
  // only for unsaved attempts, never another saved product with the same URL.
  const urlKey = (value: unknown) => {
    if (typeof value !== "string") return "";
    try {
      const u = new URL(value);
      u.hash = "";
      return u.href.replace(/\/$/, "");
    } catch {
      return value;
    }
  };
  const draftUrl = (j: Document) => {
    const parts = events
      .filter(
        (r) =>
          r.eventType === "psu_content_chunk" &&
          r.payload?.jobId === j.id &&
          r.payload?.kind === "draft",
      )
      .sort((a, b) => a.payload.ordinal - b.payload.ordinal);
    try {
      return JSON.parse(parts.map((r) => r.payload.text).join("")).fields?.find(
        (f: Document) => f.binding?.field === "websiteUrl",
      )?.binding?.value;
    } catch {
      return undefined;
    }
  };
  const ownerByJob = new Map(
    events
      .filter((r) => r.eventType === "psu_review_saved")
      .map((r) => [r.payload?.jobId, r.payload?.offeringId]),
  );
  const productBrand = product?.brandId ?? brandId;
  const jobUrl = (r: Document) =>
    urlKey(
      (r.payload?.input?.kind === "company" ? draftUrl(r) : undefined) ??
        r.payload?.input?.websiteUrls?.[0],
    );
  const identityUrls = new Set(
    [
      urlKey(product?.definition?.websiteUrl),
      ...(job ? [jobUrl(job)] : []),
      ...requested
        .filter(
          (r) =>
            product &&
            r.payload?.input?.brandId === productBrand &&
            (r.payload?.input?.offeringId ?? ownerByJob.get(r.id)) ===
              product.id,
        )
        .map(jobUrl),
    ].filter(Boolean),
  );
  if (deletingCompany) {
    events
      .filter(
        (r) =>
          workflowEvent(r) &&
          (r.payload?.brandId === brandId ||
            r.payload?.input?.brandId === brandId),
      )
      .forEach(addEvent);
  } else {
    for (const j of requested) {
      if (j.payload?.input?.brandId !== productBrand) continue;
      const input = j.payload.input,
        owner = input.offeringId ?? ownerByJob.get(j.id);
      const matches =
        j.id === job?.id ||
        (product && owner === product.id) ||
        (!owner && identityUrls.has(jobUrl(j)));
      if (!matches) continue;
      if (input.kind !== "company") {
        addEvent(j);
        continue;
      }
      // Company discovery can produce a product too. Remove only the product
      // payload; keep the parent company and its evidence intact.
      const family = events.filter(
        (r) => r.id === j.id || r.payload?.jobId === j.id,
      );
      if (!family.some((r) => r.eventType === "psu_generation_finished"))
        blockers.push(
          "Wait for company generation to finish before deleting this product.",
        );
      for (const r of family) {
        if (
          r.eventType === "psu_review_saved" ||
          (r.eventType === "psu_content_chunk" &&
            ["draft", "previewDraft"].includes(r.payload?.kind))
        ) {
          addEvent(r);
          continue;
        }
        protectedEvents.add(r.id);
        if (
          ["psu_generation_finished", "psu_generation_preview"].includes(
            r.eventType,
          )
        ) {
          const payload = { ...r.payload };
          for (const key of [
            "draftChunks",
            "draft",
            "productCompetitorSuggestions",
            "offeringCountReason",
            "productUnavailable",
          ])
            delete payload[key];
          payload.productDeleted = true;
          updates.push({ original: r, replacement: { ...r, payload } });
        }
      }
    }
  }
  selectedRows.set("events", seedEvents);
  let changed = true;
  while (changed) {
    changed = false;
    const eventRows = selectedRows.get("events") ?? [];
    for (const child of [...eventRows]) {
      if (typeof child.payload?.contextId === "string")
        ids.add(child.payload.contextId);
      for (const parentId of [
        child.payload?.jobId,
        child.payload?.generationId,
      ]) {
        const parent = events.find(
          (r) => r.id === parentId && workflowEvent(r),
        );
        if (!parent || ids.has(parent.id)) continue;
        if (!deletingCompany && parent.payload?.input?.kind === "company")
          continue;
        eventRows.push(parent);
        ids.add(parent.id);
        changed = true;
      }
    }
    selectedRows.set("events", eventRows);
    for (const collection of [...owned.slice(1), "events"]) {
      const current = selectedRows.get(collection) ?? [];
      for (const row of rows[collection] ?? []) {
        if (
          ids.has(row.id) ||
          protectedEvents.has(row.id) ||
          (collection === "events" && !workflowEvent(row))
        )
          continue;
        if (!contains(row, ids)) continue;
        if (
          !deletingCompany &&
          collection === "events" &&
          (row.eventType?.startsWith("psu_company_") ||
            row.payload?.kind === "company" ||
            row.payload?.input?.kind === "company")
        )
          continue;

        // Never delete another product's exclusively owned record just because it
        // references this one. It becomes a blocker below instead.
        const owner =
          row.offeringId ??
          row.snapshot?.offeringId ??
          row.payload?.input?.offeringId;
        if (owner && !selected.some((p) => p.id === owner)) continue;
        current.push(row);
        ids.add(row.id);
        changed = true;
      }
      selectedRows.set(collection, current);
    }
  }
  for (const [collection, records] of Object.entries(rows)) {
    const count = records.filter(
      (row) =>
        !ids.has(row.id) &&
        contains(
          updates.find((u) => u.original.id === row.id)?.replacement ?? row,
          ids,
        ),
    ).length;
    if (count)
      blockers.push(
        `${count} surviving record(s) in ${labels[collection] ?? collection} reference these details. Remove or resolve those links before deleting.`,
      );
  }
  // Selected offers/designs can share ICPs only within their product. Check
  // ownership was not corrupted rather than silently cascading another product.
  const survivingProducts = new Set(
    products.filter((p) => !ids.has(p.id)).map((p) => p.id),
  );
  for (const [collection, records] of selectedRows) {
    if (records.some((row) => contains(row, survivingProducts)))
      blockers.push(
        `Shared ${labels[collection] ?? collection} refer to a surviving product; deletion is blocked.`,
      );
  }
  const counts = [...selectedRows]
    .filter(([, v]) => v.length)
    .map(([collection, v]) => ({
      collection,
      label: labels[collection]!,
      count: v.length,
    }));
  if (updates.length)
    counts.push({
      collection: "updated_events",
      label:
        "Shared company history (product details removed; company retained)",
      count: updates.length,
    });
  const fingerprint = semanticHash(
    JSON.parse(
      JSON.stringify(
        [
          ...selectedRows,
          ["updated_events", updates.map((u) => u.original)] as [
            string,
            Document[],
          ],
        ]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([c, rs]) => [
            c,
            rs
              .map(({ _id: ignored, ...r }) => {
                void ignored;
                return r;
              })
              .sort((a, b) => a.id.localeCompare(b.id)),
          ]),
      ),
    ),
  );
  return {
    selectedRows,
    updates,
    preview: {
      kind: target.kind,
      id: target.id,
      name:
        product?.definition?.name ??
        job?.payload?.input?.workingLabel ??
        rows.brands?.find((r) => r.id === brandId)?.name ??
        "Company",
      token: fingerprint,
      counts,
      blockers,
      permanent: true as const,
    },
  };
}

export function createProfileDeletion(config: AppConfig, mongo: MongoService) {
  async function access(
    db: Db,
    user: AuthenticatedUser,
    w: string,
    session: ClientSession,
  ) {
    platformIdSchema("workspace").parse(w);
    const r = await resolveHvmContext(db, config, user, session);
    if (r.context.application !== "hvmapp" || r.context.actor.type !== "human")
      throw new AuthorizationDenied();
    r.authority.scopeFilter(r.context, "delete", {
      type: "offerings",
      workspaceId: w,
    });
    return partnerHumanSchema.parse(r.context.actor);
  }
  return async (
    user: AuthenticatedUser,
    w: string,
    raw: unknown,
    confirm = false,
  ) => {
    const input = (
      confirm
        ? targetSchema
            .extend({
              token: z.string().length(64),
              confirmation: z.string(),
              name: z.string(),
            })
            .strict()
        : targetSchema
    ).parse(raw);
    platformIdSchema(
      input.kind === "company"
        ? "brand"
        : ["generation", "product-draft"].includes(input.kind)
          ? "event"
          : "offering",
    ).parse(input.id);
    if (!mongo.withTransaction) throw new Error("Transactions required");
    // Include extension collections too. Names are metadata, no data is exposed.
    const db = await mongo.database();
    const names =
      typeof db.listCollections === "function"
        ? (await db.listCollections({}, { nameOnly: true }).toArray()).map(
            (c) => c.name,
          )
        : [...COLLECTION_NAMES];
    return mongo.withTransaction(async (db, session) => {
      const actor = await access(db, user, w, session);
      await lockIcpWorkspace(db, w, session);
      const rows: Record<string, Document[]> = {};
      // CRM uploads are independent source records, never owned by a PSU profile.
      // Their schemas have no references to offering/ICP/offer entities.
      const independentCrm = new Set([
        "organisations",
        "people",
        "contact_points",
        "imports",
        "organisation_relationships",
        "marketing_permissions",
      ]);
      for (const name of names.filter(
        (n) => !n.startsWith("system.") && !independentCrm.has(n),
      )) {
        rows[name] = await db
          .collection(name)
          .find({ workspaceId: w }, { session })
          .limit(20001)
          .toArray();
        if (rows[name]!.length > 20000)
          throw new HiveConflict(
            "Too many records for an atomic deletion preview; no data was deleted",
          );
      }
      const plan = planProfileDeletion(rows, input);
      if (input.kind === "company") {
        // Resolve the display name from saved company chunks, keeping brand identity.
        const company = rows
          .events!.filter(
            (r) =>
              r.eventType === "psu_company_saved" &&
              r.payload?.brandId === input.id,
          )
          .sort(
            (a, b) =>
              b.createdAt.getTime() - a.createdAt.getTime() ||
              b.id.localeCompare(a.id),
          )[0]!;
        const parts = rows
          .events!.filter(
            (r) =>
              r.eventType === "psu_content_chunk" &&
              r.payload?.jobId === company?.id &&
              r.payload?.kind === "company",
          )
          .sort((a, b) => a.payload.ordinal - b.payload.ordinal);
        let value: Document = company?.payload.definition ?? {};
        if (parts.length)
          value = JSON.parse(parts.map((r) => r.payload.text).join(""));
        plan.preview.name =
          value.name ??
          rows.brands?.find((r) => r.id === input.id)?.name ??
          "Company";
      }
      if (!confirm) return { workspaceId: w, ...plan.preview };
      const body = input as z.infer<typeof targetSchema> & {
        token: string;
        confirmation: string;
        name: string;
      };
      if (
        body.token !== plan.preview.token ||
        body.name !== plan.preview.name ||
        body.confirmation !==
          (input.kind === "company" ? plan.preview.name : "DELETE") ||
        plan.preview.blockers.length
      )
        throw new HiveConflict(
          "Deletion preview changed or has shared dependencies; review it again",
        );
      for (const [name, records] of plan.selectedRows) {
        if (!records.length) continue;
        const result = await db
          .collection(name)
          .deleteMany(
            { workspaceId: w, id: { $in: records.map((r) => r.id) } },
            { session },
          );
        if (result.deletedCount !== records.length)
          throw new HiveConflict("Records changed during deletion");
      }
      for (const { original, replacement } of plan.updates) {
        const result = await db
          .collection("events")
          .updateOne(
            { workspaceId: w, id: original.id },
            { $set: { payload: replacement.payload } },
            { session },
          );
        if (result.matchedCount !== 1)
          throw new HiveConflict("Records changed during deletion");
      }
      const now = new Date();
      if (input.kind === "product") {
        const product = rows.offerings!.find((r) => r.id === input.id)!;
        const primary = rows
          .events!.filter(
            (r) =>
              r.eventType === "psu_primary_product_selected" &&
              r.payload?.brandId === product.brandId,
          )
          .sort(
            (a, b) =>
              b.createdAt.getTime() - a.createdAt.getTime() ||
              b.id.localeCompare(a.id),
          )[0];
        if (primary?.payload.offeringId === input.id)
          await db.collection("events").insertOne(
            EventSchema.parse({
              id: generatePlatformId("event"),
              workspaceId: w,
              createdAt: now,
              updatedAt: now,
              occurredAt: now,
              eventType: "psu_primary_product_selected",
              actor,
              payload: { brandId: product.brandId, offeringId: null },
            }),
            { session },
          );
      }

      await db.collection("events").insertOne(
        EventSchema.parse({
          id: generatePlatformId("event"),
          workspaceId: w,
          createdAt: now,
          updatedAt: now,
          occurredAt: now,
          eventType: "profile_permanently_deleted",
          actor,
          payload: {
            kind: input.kind,
            counts: plan.preview.counts.map(({ collection, count }) => ({
              collection,
              count,
            })),
          },
        }),
        { session },
      );
      return { workspaceId: w, deleted: true };
    });
  };
}
