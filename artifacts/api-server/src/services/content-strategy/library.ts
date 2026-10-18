import { fullAssetText, requireLibrarySchema } from "./library-text";
import {
  requirementsForOffers,
  assessRequirement,
  sharedRequirements,
  planningAttention,
  type OfferPlanningSource,
} from "./library-planning";
import { z } from "zod";
import type { AppConfig } from "../../config";
import type { AuthenticatedUser } from "../../middlewares/auth";
import type { MongoService } from "../mongo";
import { EventSchema, generatePlatformId } from "../../domain";
import { HiveConflict } from "../hive-definitions";
import {
  contentAccess,
  currentRecords,
  createContentStrategy,
  fingerprint,
} from "./application";
import { assetData } from "./model";
import {
  discoveryStep,
  startDiscovery,
  ingestionRecommendation,
  type DiscoveryState,
} from "./library-discovery";
import { discoverWebsite } from "./discovery";

export function normaliseDiscoveryUrl(value: unknown) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : "https://" + trimmed;
}
const startInput = z
  .object({
    brandId: z.string().min(1),
    url: z.preprocess(normaliseDiscoveryUrl, z.string().url().max(2048)),
    mode: z.enum(["website", "page"]).default("website"),
    smallSiteThreshold: z.number().int().min(10).max(500).default(200),
    requestKey: z.string().uuid(),
  })
  .strict();
const importInput = z
  .object({
    id: z.string().min(1),
    url: z.string().url().max(2048),
    requestKey: z.string().uuid(),
    selectionReason: z
      .string()
      .trim()
      .max(180)
      .default("Selected by the user from the reviewed discovery scope"),
  })
  .strict();
export function createLibrary(
  config: AppConfig,
  mongo: MongoService,
  dependencies: { readPage?: typeof discoverWebsite } = {},
) {
  const content = createContentStrategy(config, mongo);
  async function access(
    identity: AuthenticatedUser,
    w: string,
    action: "read" | "update" = "read",
  ) {
    const db = await mongo.database();
    const actor = await contentAccess(db, config, identity, w, action);
    await requireLibrarySchema(db);
    return { db, actor };
  }
  return {
    async asset(identity: AuthenticatedUser, w: string, id: string) {
      const { db } = await access(identity, w);
      const event = await db.collection("events").findOne(
        {
          workspaceId: w,
          eventType: "content_strategy_record",
          "payload.record.id": id,
          "payload.record.kind": "asset",
        },
        { sort: { "payload.record.version": -1 } },
      );
      if (!event || event.payload.record.status === "removed")
        throw new HiveConflict("This asset is unavailable.");
      return fullAssetText(db, w, event.payload.record);
    },
    async search(identity: AuthenticatedUser, w: string, query: string) {
      const { db } = await access(identity, w);
      const q = z.string().trim().min(2).max(200).parse(query),
        escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const rows = await db
        .collection("library_text")
        .find(
          { workspaceId: w, text: { $regex: escaped, $options: "i" } },
          { projection: { id: 1, assetId: 1 } },
        )
        .limit(501)
        .toArray();
      return {
        matches: rows
          .slice(0, 500)
          .map((r) => ({ id: r.assetId, contentTextId: r.id })),
        more: rows.length > 500,
      };
    },
    async planning(identity: AuthenticatedUser, w: string) {
      const { db } = await access(identity, w);
      const offers = await db
        .collection("offers")
        .find({ workspaceId: w, approvedRevision: { $gt: 0 } })
        .toArray();
      const sources: OfferPlanningSource[] = [];
      for (const o of offers) {
        const parent = await db
          .collection("offerings")
          .findOne({ workspaceId: w, id: o.offeringId });
        const revision = await db.collection("offer_revisions").findOne({
          workspaceId: w,
          offerId: o.id,
          revision: o.approvedRevision,
        });
        const d = revision?.snapshot?.definition;
        if (!d || !parent) continue;
        sources.push({
          id: o.id,
          revision: o.approvedRevision,
          brandId: parent.brandId,
          active:
            !o.archived &&
            o.status !== "retired" &&
            !parent.archived &&
            parent.status !== "retired",
          name: d.name,
          audienceIds: d.targetIcpIds ?? [],
          buyerIds: d.targetBuyerProfileIds ?? [],
          messages: [
            d.headlineProposition,
            ...(d.supportableClaims ?? []),
          ].filter(Boolean),
          evidence: d.evidenceRequirements ?? [],
          questions: (d.objections ?? []).map(
            (x: { objection: string }) => x.objection,
          ),
        });
      }
      for (const source of sources) {
        source.audienceRevisions = [];
        source.buyerRevisions = [];
        for (const [entityType, ids] of [
          ["ideal_customer_profiles", source.audienceIds],
          ["buyer_profiles", source.buyerIds],
        ] as const) {
          for (const id of ids) {
            const entity = await db.collection(entityType).findOne({
              workspaceId: w,
              id,
              archived: { $ne: true },
              status: { $ne: "retired" },
              approvedRevision: { $gt: 0 },
            });
            if (!entity) continue;
            const parent = await db.collection("offerings").findOne({
              workspaceId: w,
              id: entity.offeringId,
              brandId: source.brandId,
            });
            if (!parent) continue;
            const revision = await db
              .collection("hive_definition_revisions")
              .findOne({
                workspaceId: w,
                entityType,
                entityId: id,
                revision: entity.approvedRevision,
              });
            const definition = revision?.snapshot?.definition;
            if (!definition) continue;
            const list = (key: string): string[] =>
              Array.isArray(definition[key])
                ? definition[key].filter(
                    (v: unknown): v is string => typeof v === "string",
                  )
                : [];
            if (entityType === "buyer_profiles") {
              source.buyerRevisions.push({
                id,
                revision: entity.approvedRevision,
              });
              source.evidence.push(...list("evidenceRequired"));
              source.questions.push(
                ...list("informationNeeds"),
                ...list("decisionConcerns"),
                ...list("objections"),
              );
            } else {
              source.audienceRevisions.push({
                id,
                revision: entity.approvedRevision,
              });
              source.questions.push(
                ...list("problems"),
                ...list("desiredOutcomes"),
              );
            }
          }
        }
      }
      const settings = await db
        .collection("events")
        .findOne(
          { workspaceId: w, eventType: "content_strategy_scope" },
          { sort: { createdAt: -1 } },
        );
      const selected: string[] | undefined = settings?.payload.offerIds;
      const managed = sources.map((o) => ({
        ...o,
        active: o.active && (!selected || selected.includes(o.id)),
      }));
      const requirements = requirementsForOffers(managed);
      const rows = currentRecords(
        await db
          .collection("events")
          .find({ workspaceId: w, eventType: "content_strategy_record" })
          .toArray(),
      );
      // Match the full retained extraction, not only the compact audit-event excerpt.
      const textIds = rows
        .filter((r) => r.kind === "asset" && r.status !== "removed")
        .map((r) => r.data.contentTextId)
        .filter((id): id is string => typeof id === "string" && !!id);
      const texts = textIds.length
        ? await db
            .collection("library_text")
            .find({ workspaceId: w, id: { $in: textIds } })
            .toArray()
        : [];
      const fullRows = rows.map((r) => {
        const text = texts.find(
          (t) => t.id === r.data.contentTextId && t.assetId === r.id,
        );
        return text ? { ...r, data: { ...r.data, text: text.text } } : r;
      });
      const jobs = await db
        .collection("library_discovery")
        .find({ workspaceId: w, eventType: "library_discovery" })
        .sort({ createdAt: -1 })
        .limit(20)
        .toArray();
      const assessments = requirements
        .filter((r) => r.active)
        .map((r) =>
          assessRequirement(
            r,
            fullRows,
            jobs
              .filter((j) => j.payload.state.brandId === r.brandId)
              .flatMap((j) => j.payload.state.pages),
          ),
        );
      return {
        scopeVersion: settings?.payload.version ?? 0,
        managedOfferIds: managed.filter((o) => o.active).map((o) => o.id),
        offers: sources,
        requirements: assessments,
        shared: sharedRequirements(requirements),
        attention: planningAttention(requirements),
        retired: requirements.filter((r) => !r.active),
        strategyRevisions: rows
          .filter((r) => r.kind === "strategy" && r.status !== "removed")
          .map((r) => ({
            id: r.id,
            version: r.version,
            title: r.data.title,
            status: r.status,
          })),
        readiness: {
          scope: "content_only",
          ready:
            assessments.length > 0 &&
            assessments.every((a) => a.status === "available"),
          missing: assessments.filter((a) => a.status === "missing").length,
          needsReview: assessments.filter((a) => a.status !== "available")
            .length,
          note: "Content availability does not authorise campaign execution, recipient selection or communication.",
        },
      };
    },
    async manageOffers(identity: AuthenticatedUser, w: string, raw: unknown) {
      await access(identity, w, "update");
      const input = z
        .object({
          offerIds: z.array(z.string().min(1)).max(200),
          expectedVersion: z.number().int().nonnegative(),
          requestKey: z.string().uuid(),
        })
        .strict()
        .parse(raw);
      if (!mongo.withTransaction)
        throw new HiveConflict("Strategy persistence is unavailable.");
      return mongo.withTransaction(async (db, session) => {
        const actor = await contentAccess(
          db,
          config,
          identity,
          w,
          "update",
          session,
        );
        const { lockIcpWorkspace } = await import("../icp/access");
        const now = await lockIcpWorkspace(db, w, session);
        const retry = await db.collection("events").findOne(
          {
            workspaceId: w,
            eventType: "content_strategy_scope",
            "payload.requestKey": input.requestKey,
          },
          { session },
        );
        if (retry) {
          if (retry.payload.requestHash !== fingerprint(input))
            throw new HiveConflict("The request changed.");
          return { version: retry.payload.version };
        }
        const old = await db
          .collection("events")
          .findOne(
            { workspaceId: w, eventType: "content_strategy_scope" },
            { session, sort: { createdAt: -1 } },
          );
        if ((old?.payload.version ?? 0) !== input.expectedVersion)
          throw new HiveConflict(
            "Strategy scope changed. Refresh before saving.",
          );
        for (const id of input.offerIds)
          if (
            !(await db.collection("offers").findOne(
              {
                id,
                workspaceId: w,
                approvedRevision: { $gt: 0 },
                archived: { $ne: true },
                status: { $ne: "retired" },
              },
              { session },
            ))
          )
            throw new HiveConflict(
              "Choose active approved offers in this workspace.",
            );
        const version = input.expectedVersion + 1;
        await db.collection("events").insertOne(
          EventSchema.parse({
            id: generatePlatformId("event"),
            workspaceId: w,
            eventType: "content_strategy_scope",
            occurredAt: now,
            createdAt: now,
            updatedAt: now,
            createdBy: actor,
            updatedBy: actor,
            source: { system: "content_strategy" },
            payload: { ...input, version, requestHash: fingerprint(input) },
          }),
          { session },
        );
        return { version };
      });
    },
    async list(identity: AuthenticatedUser, w: string) {
      const { db } = await access(identity, w);
      const jobs = await db
        .collection("library_discovery")
        .find(
          { workspaceId: w, eventType: "library_discovery" },
          {
            projection: {
              "payload.state.pages": 0,
              "payload.state.pending": 0,
              "payload.state.visited": 0,
              "payload.imports": 0,
            },
          },
        )
        .sort({ createdAt: -1 })
        .limit(100)
        .toArray();
      return jobs.map((e) => ({
        id: e.id,
        version: e.payload.version,
        state: { ...e.payload.state, pages: [] },
        recommendation:
          e.payload.summary ??
          ingestionRecommendation({ ...e.payload.state, pages: [] }),
      }));
    },
    async discovery(identity: AuthenticatedUser, w: string, id: string) {
      const { db } = await access(identity, w);
      const e = await db
        .collection("library_discovery")
        .findOne({ workspaceId: w, eventType: "library_discovery", id });
      if (!e)
        throw new HiveConflict("Discovery is unavailable in this workspace.");
      return {
        id: e.id,
        version: e.payload.version,
        state: e.payload.state,
        recommendation: ingestionRecommendation(e.payload.state),
      };
    },
    async start(identity: AuthenticatedUser, w: string, raw: unknown) {
      const input = startInput.parse(raw);
      const { db, actor } = await access(identity, w, "update");
      if (
        !(await db.collection("brands").findOne({
          id: input.brandId,
          workspaceId: w,
          archived: { $ne: true },
        }))
      )
        throw new HiveConflict("Choose a brand in this workspace.");
      if (!mongo.withTransaction)
        throw new HiveConflict("Discovery persistence is unavailable.");
      return mongo.withTransaction(async (db, session) => {
        // Existing workspace serialisation protects request idempotency without a new authority layer.
        const { lockIcpWorkspace } = await import("../icp/access");
        await lockIcpWorkspace(db, w, session);
        const existing = await db.collection("library_discovery").findOne(
          {
            workspaceId: w,
            eventType: "library_discovery",
            "payload.requestKey": input.requestKey,
          },
          { session },
        );
        if (existing) {
          if (existing.payload.requestHash !== fingerprint(input))
            throw new HiveConflict(
              "This discovery request changed. Start a new request.",
            );
          return { id: existing.id };
        }
        const now = new Date(),
          id = generatePlatformId("event");
        await db.collection("library_discovery").insertOne(
          {
            id,
            workspaceId: w,
            eventType: "library_discovery",
            occurredAt: now,
            createdAt: now,
            updatedAt: now,
            createdBy: actor,
            updatedBy: actor,
            source: { system: "content_strategy" },
            payload: {
              requestKey: input.requestKey,
              requestHash: fingerprint(input),
              version: 1,
              state: startDiscovery(
                input.url,
                input.brandId,
                input.smallSiteThreshold,
                input.mode,
              ),
            },
          },
          { session },
        );
        return { id };
      });
    },
    async step(identity: AuthenticatedUser, w: string, id: string) {
      const { db } = await access(identity, w, "update");
      const event = await db
        .collection("library_discovery")
        .findOne({ workspaceId: w, eventType: "library_discovery", id });
      if (!event)
        throw new HiveConflict("Discovery is unavailable in this workspace.");
      const version = event.payload.version;
      if (event.payload.state.status !== "running")
        return {
          id,
          version,
          state: event.payload.state,
          recommendation: ingestionRecommendation(event.payload.state),
        };
      const leaseKey = generatePlatformId("event");
      const claimed = await db.collection("library_discovery").updateOne(
        {
          id,
          workspaceId: w,
          "payload.version": version,
          $or: [
            { "payload.stepLease": { $exists: false } },
            { "payload.stepLease.until": { $lt: new Date() } },
          ],
        },
        {
          $set: {
            "payload.stepLease": {
              key: leaseKey,
              until: new Date(Date.now() + 60000),
            },
          },
        },
      );
      if (!claimed.matchedCount)
        throw new HiveConflict(
          "Discovery is already progressing. Refresh its status before continuing.",
        );
      try {
        const state = await discoveryStep(event.payload.state);
        if (state.status === "complete") {
          const prior = await db.collection("library_discovery").findOne(
            {
              workspaceId: w,
              eventType: "library_discovery",
              id: { $ne: id },
              "payload.state.root": state.root,
              "payload.state.brandId": state.brandId,
              "payload.state.status": "complete",
              createdAt: { $lt: event.createdAt },
            },
            { sort: { createdAt: -1 } },
          );
          if (prior) {
            const before = (
                prior.payload.state.pages as DiscoveryState["pages"]
              ).map((p) => p.url),
              now = new Set(state.pages.map((p) => p.url)),
              removed = before.filter((u) => !now.has(u)),
              added = state.pages.filter((p) => !before.includes(p.url));
            state.warnings = [
              ...state.warnings,
              `Compared with the previous complete discovery: ${added.length} new URLs; ${removed.length} no longer discovered. Existing assets and approvals are retained. A missing sitemap entry does not prove a page was deleted.`,
              ...removed.slice(0, 10).map((u) => `No longer discovered: ${u}`),
            ].slice(-30);
          }
        }
        const updated = await db.collection("library_discovery").updateOne(
          {
            workspaceId: w,
            eventType: "library_discovery",
            id,
            "payload.version": version,
          },
          {
            $set: {
              "payload.state": state,
              "payload.summary": ingestionRecommendation(state),
              "payload.version": version + 1,
              updatedAt: new Date(),
            },
          },
        );
        if (!updated.matchedCount)
          throw new HiveConflict(
            "Discovery changed in another session. Refresh before continuing.",
          );
        return {
          id,
          version: version + 1,
          state,
          recommendation: ingestionRecommendation(state),
        };
      } finally {
        await db
          .collection("library_discovery")
          .updateOne(
            { id, workspaceId: w, "payload.stepLease.key": leaseKey },
            { $unset: { "payload.stepLease": "" } },
          );
      }
    },
    async importPage(identity: AuthenticatedUser, w: string, raw: unknown) {
      const input = importInput.parse(raw),
        { db } = await access(identity, w, "update");
      const event = await db.collection("library_discovery").findOne({
        workspaceId: w,
        eventType: "library_discovery",
        id: input.id,
      });
      if (!event)
        throw new HiveConflict("Discovery is unavailable in this workspace.");
      const state = event.payload.state as DiscoveryState;
      if (state.status === "running")
        throw new HiveConflict(
          "Finish discovery before importing its selected pages.",
        );
      const index = state.pages.findIndex((p) => p.url === input.url);
      if (index < 0)
        throw new HiveConflict("Select a discovered page before importing.");
      const p = state.pages[index]!;
      const brand = await db
        .collection("brands")
        .findOne({ id: state.brandId, workspaceId: w });
      let external = true;
      try {
        external =
          new URL(input.url).hostname !==
          new URL(
            String(brand?.primaryDomain ?? "").startsWith("http")
              ? String(brand!.primaryDomain)
              : `https://${brand?.primaryDomain}`,
          ).hostname;
      } catch {
        /* Unknown ownership is an external reference. */
      }
      const claim = `payload.imports.${fingerprint(input.url)}`;
      const lease = await db.collection("library_discovery").updateOne(
        {
          id: input.id,
          workspaceId: w,
          eventType: "library_discovery",
          $or: [
            { [claim]: { $exists: false } },
            { [claim + ".until"]: { $lt: new Date() } },
          ],
        },
        {
          $set: {
            [claim]: {
              key: input.requestKey,
              until: new Date(Date.now() + 60000),
            },
          },
        },
      );
      if (!lease.matchedCount)
        throw new HiveConflict(
          "This page is being imported. Refresh its status before retrying.",
        );
      try {
        const read = await (dependencies.readPage ?? discoverWebsite)(
          input.url,
          "read",
        );
        if (!("text" in read))
          throw new HiveConflict("Readable page content is unavailable.");
        const rows = currentRecords(
          await db
            .collection("events")
            .find({
              workspaceId: w,
              eventType: "content_strategy_record",
              "payload.record.kind": "asset",
            })
            .toArray(),
        );
        const old = rows.find(
          (r) =>
            r.status !== "removed" &&
            r.data.scope &&
            (r.data.scope as { brandId: string }).brandId === state.brandId &&
            (r.data.url === input.url ||
              (r.data.sourceMetadata as { canonicalUrl?: string })
                .canonicalUrl === read.canonical),
        );
        const oldData = old ? assetData.parse(old.data) : undefined;
        let saved = old;
        if (!oldData || oldData.contentHash !== read.fingerprint) {
          const data = assetData.parse({
            ...oldData,
            title: read.title.slice(0, 200) || p.title,
            classification: oldData?.classification ?? "unclassified",
            assetType: oldData?.assetType ?? "webpage",
            channel: oldData?.channel ?? "website",
            url: read.canonical,
            text: read.text.slice(0, 180000),
            description: read.description,
            sourceDocumentId: oldData?.sourceDocumentId ?? "",
            sourceMetadata: {
              ...oldData?.sourceMetadata,
              canonicalUrl: read.canonical,
              headings: read.headings,
              checkedAt: read.checkedAt,
              producer:
                oldData?.sourceMetadata.producer ??
                `Website import: ${input.selectionReason}`.slice(0, 200),
              briefId: oldData?.sourceMetadata.briefId ?? "",
              briefVersion: oldData?.sourceMetadata.briefVersion ?? 0,
              capabilityId: oldData?.sourceMetadata.capabilityId ?? "",
              integrationId: oldData?.sourceMetadata.integrationId ?? "",
            },
            sourceAssetIds: oldData?.sourceAssetIds ?? [],
            scope: oldData?.scope ?? {
              brandId: state.brandId,
              products: [],
              offers: [],
              audiences: [],
            },
            topics: oldData?.topics ?? [],
            buyerStages: oldData?.buyerStages ?? [],
            claims: oldData?.claims ?? [],
            evidence: oldData?.evidence ?? [],
            gaps:
              read.text.length > 180000
                ? [
                    "Page exceeds the text storage bound; extracted content is truncated. Review the original source.",
                  ]
                : (oldData?.gaps ?? []),
            reuse: oldData?.reuse ?? [],
            restrictions: oldData?.restrictions ?? [],
            analysisStatus: "needs_review",
            sourceType: external ? "external_url" : "website",
            visibility: external ? "external_reference" : "published",
            contentHash: read.fingerprint,
            discoveredAt: p.discoveredAt,
            modifiedAt: p.modifiedAt,
            language: p.language,
            region: p.region,
            associations: (oldData?.associations ?? []).map((a) => ({
              ...a,
              decision: "suggested",
            })),
          });
          saved = await content.mutate(identity, w, {
            id: old?.id,
            kind: "asset",
            expectedVersion: old?.version ?? 0,
            operation: "save",
            data,
            requestKey: input.requestKey,
          });
        }
        await db.collection("library_discovery").updateOne(
          {
            id: input.id,
            workspaceId: w,
            "payload.version": event.payload.version,
          },
          {
            $set: {
              [`payload.state.pages.${index}.ingestion`]: "imported",
              [`payload.state.pages.${index}.assetId`]: saved!.id,
              [`payload.state.pages.${index}.fingerprint`]: read.fingerprint,
              [`payload.state.pages.${index}.error`]: "",
              updatedAt: new Date(),
            },
          },
        );
        return { asset: saved, unchanged: old === saved };
      } catch (e) {
        await db.collection("library_discovery").updateOne(
          {
            id: input.id,
            workspaceId: w,
            "payload.version": event.payload.version,
          },
          {
            $set: {
              [`payload.state.pages.${index}.ingestion`]: "failed",
              [`payload.state.pages.${index}.error`]:
                "Page unavailable or content changed. Retry this page; other imports are preserved.",
            },
          },
        );
        throw e;
      } finally {
        await db.collection("library_discovery").updateOne(
          {
            id: input.id,
            workspaceId: w,
            [claim + ".key"]: input.requestKey,
          },
          { $unset: { [claim]: "" } },
        );
      }
    },
  };
}
