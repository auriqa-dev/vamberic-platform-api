import { readResearchContext } from "./context";
import { resolveHvmContext } from "../hvm-context";
import type { ResourceType } from "../../authorization/policy";
import { createLibrary } from "../content-strategy/library";
import { currentRecords } from "../content-strategy/application";
import { createOfferResearch } from "../offer-architecture/research";

import { createHash, randomUUID } from "node:crypto";
import type { Document, Db, ClientSession } from "mongodb";
import type { AppConfig } from "../../config";
import type { AuthenticatedUser } from "../../middlewares/auth";
import type { MongoService } from "../mongo";
import {
  EventSchema,
  generatePlatformId,
  platformIdSchema,
} from "../../domain";
import { contentAccess } from "../content-strategy/application";
import { contentContext } from "../content-strategy/context";
import type { ContentGenerator } from "../content-strategy/generate";
import { lockIcpWorkspace } from "../icp/access";
import { HiveConflict } from "../hive-definitions";
import {
  researchRequest,
  researchOutput,
  policyInput,
  destination,
} from "./model";
import { crawlProfile } from "../psu/research-crawl";
import { publicPageHttp } from "../psu/page-http";
import { z } from "zod";
const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
function excerpts(text: string) {
  if (text.length <= 6000) return text;
  return Array.from({ length: 10 }, (_, i) => {
    const start = Math.floor((i * (text.length - 600)) / 9);
    return text.slice(start, start + 600);
  }).join("\n[…]\n");
}
const terminal = ["completed", "partial", "failed", "cancelled"];
const present = (r: Document) => ({
  id: r.id,
  updatedAt: r.updatedAt.toISOString(),
  ...r.payload,
  identity: undefined,
});
const event = (w: string, type: string, payload: Document) =>
  EventSchema.parse({
    id: generatePlatformId("event"),
    workspaceId: w,
    eventType: type,
    occurredAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    payload,
  });
export function createResearchService(
  config: AppConfig,
  mongo: MongoService,
  generator?: ContentGenerator,
  dependencies: {
    crawl?: typeof crawlProfile;
    search?: ReturnType<typeof createOfferResearch>;
  } = {},
) {
  async function authorised(
    identity: AuthenticatedUser,
    w: string,
    action: "read" | "create" | "update" = "read",
  ) {
    const db = await mongo.database();
    await contentAccess(db, config, identity, w, action);
    return db;
  }
  async function targets(
    db: Awaited<ReturnType<typeof authorised>>,
    w: string,
    refs: z.infer<typeof destination>[],
    brandId: string,
    identity: AuthenticatedUser,
  ) {
    const authority = await resolveHvmContext(db, config, identity);
    const context: Document[] = [];
    for (const ref of refs) {
      authority.authority.scopeFilter(authority.context, "read", {
        type: ({
          content_brief: "content_strategy",
          interaction: "events",
          campaign: "campaigns",
          people: "people",
          organisations: "organisations",
          offerings: "offerings",
          offers: "offers",
          ideal_customer_profiles: "ideal_customer_profiles",
        }[ref.type] ?? ref.type) as ResourceType,
        workspaceId: w,
      });
      const collection = ["content_brief", "interaction"].includes(ref.type)
        ? "events"
        : ref.type === "campaign"
          ? "campaigns"
          : ref.type;
      const row = await db.collection(collection).findOne(
        {
          ...(ref.type === "content_brief"
            ? {
                "payload.record.id": ref.id,
                eventType: "content_strategy_record",
              }
            : { id: ref.id }),
          workspaceId: w,
          archived: { $ne: true },
        },
        { sort: { "payload.record.version": -1 } },
      );
      if (!row || (row.brandId && row.brandId !== brandId))
        throw new HiveConflict(
          "Research destination unavailable in this brand/workspace",
        );
      if (
        ref.type === "content_brief" &&
        (row.eventType !== "content_strategy_record" ||
          row.payload?.record?.kind !== "brief" ||
          ["removed", "archived"].includes(row.payload?.record?.status))
      )
        throw new HiveConflict("Select a content brief");
      if (row.offeringId) {
        const parent = await db.collection("offerings").findOne({
          workspaceId: w,
          id: row.offeringId,
          brandId,
          archived: { $ne: true },
        });
        if (!parent)
          throw new HiveConflict(
            "Research destination belongs to another brand or a removed product",
          );
      }
      if (
        ref.type === "content_brief" &&
        row.payload.record.data.scope.brandId !== brandId
      )
        throw new HiveConflict("Select a brief from this brand");
      // Only business fields relevant to the requested target, never credentials or whole documents.
      context.push({
        type: ref.type,
        id: ref.id,
        updatedAt: row.updatedAt,
        name: row.name,
        firstName: row.firstName,
        lastName: row.lastName,
        title: row.title,
        domain: row.domain,
        website: row.website,
        industry: row.industry,
        description: row.description,
        lifecycleStage: row.lifecycleStage,
        preferredLanguage: row.preferredLanguage,
        timezone: row.timezone,
        definition: row.definition,
        brief:
          ref.type === "content_brief" ? row.payload.record.data : undefined,
      });
    }
    return context;
  }
  async function librarySources(
    identity: AuthenticatedUser,
    w: string,
    ids: string[],
    brand: string,
  ) {
    const library = createLibrary(config, mongo),
      result = [];
    for (const id of ids) {
      const asset = await library.asset(identity, w, id);
      const data = asset.data as Document;
      if (
        data.scope?.brandId !== brand ||
        ["archived", "removed"].includes(asset.status)
      )
        throw new HiveConflict(
          "Select current Library material from this brand.",
        );
      result.push({
        recordId: id,
        revision: asset.version,
        title: String(data.title),
        extract: String(data.text ?? "").slice(0, 6000),
        access: "workspace",
        restrictions: data.restrictions ?? [],
        approval: asset.status,
        sourceLength: String(data.text ?? "").length,
      });
    }
    return result;
  }
  async function start(
    identity: AuthenticatedUser,
    w: string,
    raw: unknown,
    mode: "requested" | "triggered" | "scheduled" = "requested",
    admission?: (db: Db, session: ClientSession) => Promise<void>,
  ) {
    const input = researchRequest.parse(raw);
    if (JSON.stringify(input).length > 6000)
      throw new HiveConflict(
        "Shorten the objective or source list before saving this request.",
      );
    const db = await authorised(identity, w, "create");
    await targets(db, w, input.destinations, input.scope.brandId, identity);
    await librarySources(
      identity,
      w,
      input.libraryAssetIds,
      input.scope.brandId,
    );
    await readResearchContext(db, w, input.documents);
    const context = await contentContext(db, config, identity, w, input.scope);
    if (input.campaignVersion) {
      const consumer = context.snapshots.some(
        (r) =>
          r.entityType === "ideal_customer_profiles" &&
          ["b2c", "d2c"].includes(
            r.snapshot.definition?.profileType ?? r.snapshot.profileType,
          ),
      );
      if (
        (consumer || input.destinations.some((d) => d.type === "people")) &&
        (input.sourceMode !== "existing" || input.type !== "market_buyer")
      )
        throw new HiveConflict(
          "Consumer campaign research uses existing records only; private-person discovery is unavailable.",
        );
      if (!consumer && input.destinations.some((d) => d.type === "people"))
        throw new HiveConflict(
          "Select a consumer ICP to assess existing consumer contacts.",
        );
    }
    if (!mongo.withTransaction) throw new Error("Transactions required");
    return mongo.withTransaction(async (db, session) => {
      await contentAccess(db, config, identity, w, "create", session);
      await lockIcpWorkspace(db, w, session);
      await admission?.(db, session);
      // Campaign start and setup changes share the workspace transaction fence.
      for (const destination of input.destinations.filter(
        (d) => d.type === "campaign",
      )) {
        const campaign = await db.collection("events").findOne(
          {
            workspaceId: w,
            campaignId: destination.id,
            eventType: "campaign_setup",
          },
          { sort: { "payload.version": -1 }, session },
        );
        if (
          campaign &&
          (campaign.payload.status !== "ready" ||
            campaign.payload.version !== input.campaignVersion ||
            hash(input.scope) !==
              hash({
                brandId: campaign.payload.setup.brandId,
                products: campaign.payload.setup.products,
                offers: campaign.payload.setup.offers,
                audiences: campaign.payload.setup.audiences,
              }))
        )
          throw new HiveConflict(
            "The campaign setup changed or is not approved. Review it before starting research.",
          );
      }
      if (input.campaignVersion) {
        const ids = input.destinations
          .filter((d) => ["organisations", "people"].includes(d.type))
          .map((d) => d.id);
        if (ids.length) {
          const active = await db
            .collection("events")
            .find(
              {
                workspaceId: w,
                eventType: "research_job",
                "payload.status": { $in: ["queued", "running"] },
                "payload.request.requestKey": { $ne: input.requestKey },
                "payload.request.destinations": {
                  $elemMatch: {
                    type: { $in: ["organisations", "people"] },
                    id: { $in: ids },
                  },
                },
              },
              { session },
            )
            .limit(1)
            .toArray();
          if (active.length)
            throw new HiveConflict(
              "An organisation or contact is already being researched. Reuse its current research before requesting another investigation.",
            );
        }
      }
      const previous = await db.collection("events").findOne(
        {
          workspaceId: w,
          eventType: "research_job",
          "payload.request.requestKey": input.requestKey,
        },
        { session },
      );
      if (previous) {
        if (previous.payload.inputHash !== hash(input))
          throw new HiveConflict("Research request changed");
        return present(previous);
      }
      const row = event(w, "research_job", {
        request: input,
        inputHash: hash(input),
        contextHash: context.hash,
        identity,
        mode,
        status: "queued",
        phase: "Waiting to research",
        attempt: 0,
        lease: null,
        error: "",
        summary: "",
        gaps: [],
        usage: [],
        createdFrom: mode,
      });
      await db.collection("events").insertOne(row, { session });
      return present(row);
    });
  }
  async function read(identity: AuthenticatedUser, w: string, id: string) {
    platformIdSchema("event").parse(id);
    const db = await authorised(identity, w);
    const job = await db
      .collection("events")
      .findOne({ workspaceId: w, id, eventType: "research_job" });
    if (!job) throw new HiveConflict("Research unavailable");
    const findings = await db
      .collection("events")
      .find({
        workspaceId: w,
        eventType: "research_finding",
        "payload.jobId": id,
      })
      .toArray();
    const linked = await db
      .collection("events")
      .find({
        workspaceId: w,
        eventType: "research_source",
        "payload.jobId": id,
      })
      .toArray();
    const ids = [
      ...new Set([
        ...linked.map((r) => r.payload.evidenceId),
        ...findings.flatMap((r) => r.payload.evidenceIds),
      ]),
    ];
    const evidence = ids.length
      ? await db
          .collection("events")
          .find({
            workspaceId: w,
            eventType: "research_evidence",
            id: { $in: ids },
          })
          .toArray()
      : [];
    const savedDiscoveries = (
      await db
        .collection("events")
        .find({
          workspaceId: w,
          eventType: "research_discovery",
          "payload.jobId": id,
        })
        .toArray()
    ).map((r) =>
      r.payload.expiresAt &&
      r.payload.expiresAt <= new Date().toISOString() &&
      r.payload.result.status !== "promoted"
        ? {
            candidateId: r.id,
            kind: r.payload.result.kind,
            type: r.payload.result.type,
            status: "expired",
            name: "Expired candidate",
            details: {},
            evidenceIds: [],
            reason: "Working candidate data has expired",
          }
        : r.payload.result,
    );
    const recordWrites = await db
      .collection("events")
      .find({
        workspaceId: w,
        "payload.origin": "research",
        "payload.researchJobId": id,
        eventType: { $in: ["hvm_record_created", "hvm_record_updated"] },
      })
      .toArray();
    for (const record of recordWrites)
      if (!savedDiscoveries.some((r) => r.id === record.payload.recordId))
        savedDiscoveries.push({
          id: record.payload.recordId,
          type: record.payload.kind === "contacts" ? "people" : "organisations",
          status:
            record.eventType === "hvm_record_created" ? "created" : "enriched",
          reason:
            "Saved through Contact Management; retained if later research is interrupted.",
        });
    return {
      job: {
        ...present(job),
        gaps: (
          await db
            .collection("events")
            .find({
              workspaceId: w,
              eventType: "research_gap",
              "payload.jobId": id,
            })
            .toArray()
        ).map((r) => r.payload.text),
        discovery: savedDiscoveries,
      },
      findings: findings.map(present),
      evidence: evidence.map(present),
    };
  }
  async function list(identity: AuthenticatedUser, w: string) {
    const db = await authorised(identity, w);
    const jobs = await db
      .collection("events")
      .find({
        workspaceId: w,
        eventType: "research_job",
        archived: { $ne: true },
      })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();
    const policies = await db
      .collection("events")
      .find({
        workspaceId: w,
        eventType: "research_policy",
        archived: { $ne: true },
      })
      .toArray();
    const brands = await db
      .collection("brands")
      .find({ workspaceId: w, archived: { $ne: true } })
      .project({ id: 1, name: 1 })
      .toArray();
    const choices: Record<string, Document[]> = {};
    for (const name of ["offerings", "offers", "ideal_customer_profiles"]) {
      choices[name] = (
        await db
          .collection(name)
          .find({
            workspaceId: w,
            archived: { $ne: true },
            approvedRevision: { $gt: 0 },
            status: { $ne: "retired" },
          })
          .limit(200)
          .toArray()
      ).map((r) => ({
        id: r.id,
        revision: r.approvedRevision,
        name: r.definition?.name ?? r.name ?? r.id,
        brandId:
          r.brandId ??
          choices.offerings?.find((p) => p.id === r.offeringId)?.brandId ??
          null,
      }));
    }
    const assets = currentRecords(
      await db
        .collection("events")
        .find({
          workspaceId: w,
          eventType: "content_strategy_record",
          "payload.record.kind": "asset",
        })
        .toArray(),
    )
      .filter((r) => !["archived", "removed"].includes(r.status))
      .map((r) => ({
        id: r.id,
        name: String(r.data.title),
        brandId: (r.data.scope as Document)?.brandId,
      }));
    return {
      documents: (
        await db
          .collection("events")
          .find({
            workspaceId: w,
            eventType: "research_document",
            "payload.status": "ready",
          })
          .toArray()
      ).map((r) => ({
        id: r.id,
        revision: r.payload.revision,
        name: r.payload.details.name,
      })),
      assets,
      workerEnabled: process.env.HVM_RESEARCH_WORKER_ENABLED === "true",
      choices,
      jobs: jobs.map(present),
      policies: policies.map(present),
      brands: brands.map((r) => ({ id: r.id, name: r.name })),
      generationAvailable: !!generator,
    };
  }
  async function run(identity: AuthenticatedUser, w: string, id: string) {
    const db = await authorised(identity, w, "create");
    platformIdSchema("event").parse(id);
    const job = await db
      .collection("events")
      .findOne({ workspaceId: w, id, eventType: "research_job" });
    if (!job) throw new HiveConflict("Research unavailable");
    if (terminal.includes(job.payload.status)) return read(identity, w, id);
    if (job.payload.lease && new Date(job.payload.lease) > new Date())
      return read(identity, w, id);
    if (job.payload.attempt >= 3) {
      await db.collection("events").updateOne(
        { workspaceId: w, id, updatedAt: job.updatedAt },
        {
          $set: {
            updatedAt: new Date(),
            "payload.status": "failed",
            "payload.error":
              "Research was interrupted repeatedly. Review it before retrying.",
            "payload.phase": "Retry needed",
          },
        },
      );
      return read(identity, w, id);
    }
    const lease = randomUUID(),
      expires = new Date(Date.now() + 10 * 60000).toISOString();
    const claimed = await db.collection("events").updateOne(
      {
        workspaceId: w,
        id,
        updatedAt: job.updatedAt,
        "payload.status": job.payload.status,
        "payload.leaseToken": job.payload.leaseToken ?? { $exists: false },
      },
      {
        $set: {
          updatedAt: new Date(),
          "payload.status": "running",
          "payload.phase": "Gathering evidence",
          "payload.lease": expires,
          "payload.leaseToken": lease,
          "payload.attempt": job.payload.attempt + 1,
        },
      },
    );
    if (!claimed.matchedCount) return read(identity, w, id);
    const fence = {
      workspaceId: w,
      id,
      "payload.leaseToken": lease,
      "payload.status": "running",
    };
    const request = researchRequest.parse(job.payload.request);
    async function update(fields: Document) {
      const r = await db.collection("events").updateOne(fence, {
        $set: {
          updatedAt: new Date(),
          ...Object.fromEntries(
            Object.entries(fields).map(([k, v]) => ["payload." + k, v]),
          ),
        },
      });
      if (!r.matchedCount) throw new Error("Research cancelled or superseded");
    }
    try {
      const context = await contentContext(
        db,
        config,
        identity,
        w,
        request.scope,
      );
      if (
        request.campaignVersion &&
        context.snapshots.some(
          (r) =>
            r.entityType === "ideal_customer_profiles" &&
            ["b2c", "d2c"].includes(
              r.snapshot.definition?.profileType ?? r.snapshot.profileType,
            ),
        ) &&
        (request.sourceMode !== "existing" || request.type !== "market_buyer")
      )
        throw new HiveConflict(
          "Consumer campaign research requires existing records. Review the campaign before retrying.",
        );
      const destinationContext = await targets(
        db,
        w,
        request.destinations,
        request.scope.brandId,
        identity,
      );
      if (request.campaignVersion) {
        const campaignId = request.destinations.find(
          (d) => d.type === "campaign",
        )?.id;
        const approved = await db.collection("events").findOne({
          workspaceId: w,
          campaignId,
          eventType: "campaign_setup",
          "payload.version": request.campaignVersion,
          "payload.status": "ready",
        });
        if (
          !approved ||
          approved.payload.setup.brandId !== request.scope.brandId
        )
          throw new HiveConflict("Approved campaign context is unavailable.");
        // Full, version-bound business instructions stay in authorised model context,
        // rather than being truncated or included in a public search query.
        const setup = approved.payload.setup;
        destinationContext.push({
          type: "campaign_setup",
          id: campaignId,
          version: request.campaignVersion,
          objective: setup.objective,
          researchPriority: setup.researchPriority,
          source: setup.source,
          goal: setup.goal,
          overlapProposal: setup.overlapPolicy,
          instruction:
            "Assess each approved ICP independently. Preserve overlaps and unknowns. Reuse Hive evidence. The overlap proposal is not execution authority.",
        });
      }
      let sources: Document[] = await db
        .collection("events")
        .find({
          workspaceId: w,
          eventType: "research_evidence",
          "payload.brandId": request.scope.brandId,
          "payload.retrievedAt": {
            $gte: new Date(
              Date.now() - request.freshnessDays * 86400000,
            ).toISOString(),
          },
        })
        .limit(100)
        .toArray();
      // Reuse only explicitly related sources, never the entire tenant's evidence by default.
      sources = sources
        .filter((r) => r.payload.access === "public")
        .filter(
          (r) =>
            request.urls.includes(r.payload.url) ||
            r.payload.objective === request.objective,
        );
      const searchUsage: unknown[] = [];
      let publicUrls = [...request.urls];
      if (request.sourceMode === "web" && !publicUrls.length) {
        const search =
          dependencies.search ??
          (process.env.HVM_PSU_API_KEY && process.env.HVM_PSU_OPENAI_PROJECT
            ? createOfferResearch({
                apiKey: process.env.HVM_PSU_API_KEY,
                project: process.env.HVM_PSU_OPENAI_PROJECT,
                purpose: "research-discovery",
              })
            : undefined);
        if (!search) throw new Error("Search provider unavailable");
        // Private records/Library context never enter the public search request.
        const result = await search(
          { objective: request.objective, type: request.type },
          AbortSignal.timeout(90000),
        );
        publicUrls = result.urls;
        searchUsage.push(result.usage);
      }
      if (request.campaignVersion && publicUrls.length) {
        const reusable = await db
          .collection("events")
          .find({
            workspaceId: w,
            eventType: "research_evidence",
            "payload.brandId": request.scope.brandId,
            "payload.access": "public",
            "payload.url": { $in: publicUrls },
            "payload.retrievedAt": {
              $gte: new Date(
                Date.now() - request.freshnessDays * 86400000,
              ).toISOString(),
            },
          })
          .toArray();
        sources.push(...reusable);
      }
      if (request.sourceMode === "web" && publicUrls.length) {
        const existing = new Set(sources.map((r) => r.payload.url));
        const urls = publicUrls.filter((u) => !existing.has(u));
        if (urls.length) {
          const pages = await (dependencies.crawl ?? crawlProfile)(
            urls,
            AbortSignal.timeout(240000),
            publicPageHttp(),
            {
              progress: async (p) => {
                await update({
                  phase: `Reading websites · ${p.pagesRead} pages read`,
                });
              },
            },
          );
          for (const page of pages.pages) {
            await authorised(identity, w, "create");
            const payload = {
              brandId: request.scope.brandId,
              url: page.url,
              title: page.title,
              extract: excerpts(page.text),
              sourceLength: page.text.length,
              excerptOnly: page.text.length > 6000,
              retrievedAt: page.retrievedAt,
              digest: page.digest,
              objective: request.objective,
              access: "public",
              publicationDate: null,
            };
            const old = await db.collection("events").findOne({
              workspaceId: w,
              eventType: "research_evidence",
              "payload.brandId": request.scope.brandId,
              "payload.digest": page.digest,
              "payload.url": page.url,
            });
            if (old) {
              sources.push(old);
              continue;
            }
            const row = event(w, "research_evidence", payload);
            await db.collection("events").insertOne(row);
            sources.push(row);
          }
        }
      }
      for (const snapshot of context.snapshots) {
        const payload = {
          brandId: request.scope.brandId,
          url: "",
          title: `Approved ${snapshot.entityType}`,
          extract: JSON.stringify(snapshot.snapshot).slice(0, 6000),
          retrievedAt: new Date().toISOString(),
          digest: hash(snapshot),
          objective: request.objective,
          access: "workspace",
          recordId: snapshot.id,
          revision: snapshot.revision,
        };
        const old = await db.collection("events").findOne({
          workspaceId: w,
          eventType: "research_evidence",
          "payload.brandId": request.scope.brandId,
          "payload.digest": payload.digest,
        });
        if (old) sources.push(old);
        else {
          const row = event(w, "research_evidence", payload);
          await db.collection("events").insertOne(row);
          sources.push(row);
        }
      }
      for (const asset of await librarySources(
        identity,
        w,
        request.libraryAssetIds,
        request.scope.brandId,
      )) {
        const payload = {
          ...asset,
          brandId: request.scope.brandId,
          url: "",
          retrievedAt: new Date().toISOString(),
          digest: hash(asset),
          objective: request.objective,
          excerptOnly: asset.sourceLength > 6000,
        };
        const row = event(w, "research_evidence", payload);
        await db.collection("events").insertOne(row);
        sources.push(row);
      }
      const documents = await readResearchContext(db, w, request.documents);
      for (const document of documents.sources) {
        const row = event(w, "research_evidence", {
          brandId: request.scope.brandId,
          url: "",
          title: document.name,
          extract: document.extract,
          grain: document.grain,
          provenance: document.provenance,
          recordId: document.id,
          revision: document.revision,
          access: "workspace",
          reviewedExcerptOnly: true,
          retrievedAt: new Date().toISOString(),
          digest: hash(document),
        });
        await db.collection("events").insertOne(row);
        sources.push(row);
      }
      if (request.campaignVersion) {
        for (const target of destinationContext.filter(
          (t) => t.type === "organisations" || t.type === "people",
        )) {
          const row = event(w, "research_evidence", {
            brandId: request.scope.brandId,
            url: "",
            title: `Existing Hive record: ${target.name ?? target.id}`,
            extract: JSON.stringify(target),
            retrievedAt: new Date().toISOString(),
            recordId: target.id,
            recordUpdatedAt: target.updatedAt,
            digest: hash(target),
            access: "workspace",
            restrictions: [
              "Existing record is not proof of current qualification or permission to contact.",
            ],
          });
          await db.collection("events").insertOne(row);
          sources.push(row);
        }
      }
      sources = [...new Map(sources.map((s) => [s.id, s])).values()];
      for (const source of sources) {
        await db
          .collection("events")
          .insertOne(
            event(w, "research_source", { jobId: id, evidenceId: source.id }),
          );
      }
      await update({
        phase: `Assessing ${sources.length} sources`,
        sourceCount: sources.length,
      });
      if (!generator) throw new Error("Research generation is not configured");
      const output = await generator("research", {
        objective: request.objective,
        type: request.type,
        destinationContext,
        context,
        documentInstructions: documents.instructions,
        sourceInstructions:
          "Sources may be excerpts. Do not imply exhaustive coverage; retain private restrictions and approval status. Reporting group figures do not belong to member companies.",
        sources: sources.map((r) => ({
          id: r.id,
          ...r.payload,
          extract: r.payload.extract.slice(
            0,
            Math.max(600, Math.floor(90000 / Math.max(1, sources.length))),
          ),
        })),
      });
      if (
        (await contentContext(db, config, identity, w, request.scope)).hash !==
        context.hash
      )
        throw new HiveConflict("Approved context changed during research");
      await update({ usage: [...searchUsage, output.usage] });
      const parsed = researchOutput.parse(output.result),
        allowed = new Set(sources.map((s) => s.id));
      const findings = parsed.findings.map((f) => ({
        ...f,
        evidenceIds: f.evidenceIds.filter((id) => allowed.has(id)),
      }));
      const discoveryResults: Document[] = [];
      if (
        ["account_discovery", "contact_discovery", "enrichment"].includes(
          request.type,
        )
      ) {
        await update({ phase: "Preparing candidates for review" });
        for (const candidate of parsed.organisations) {
          const cited = sources.filter((s) =>
            candidate.evidenceIds.includes(s.id),
          );
          let domain = "";
          try {
            domain = new URL(candidate.website).hostname
              .toLowerCase()
              .replace(/^www\./, "");
          } catch {
            continue;
          }
          if (
            !cited.some((s) => {
              try {
                return (
                  new URL(s.payload.url).hostname
                    .toLowerCase()
                    .replace(/^www\./, "") === domain &&
                  s.payload.extract
                    .toLowerCase()
                    .includes(candidate.name.trim().toLowerCase())
                );
              } catch {
                return false;
              }
            })
          )
            continue;
          const matches = await db
            .collection("organisations")
            .find({
              workspaceId: w,
              archived: { $ne: true },
              $or: [{ domain }, { normalizedDomain: domain }],
            })
            .limit(2)
            .toArray();
          discoveryResults.push({
            candidateId: generatePlatformId("event"),
            kind: "organisation",
            name: candidate.name,
            type: "organisations",
            status: matches.length === 1 ? "matched" : "candidate",
            ...(matches.length === 1 ? { id: matches[0]!.id } : {}),
            reason:
              matches.length > 1
                ? "Multiple existing organisations need review"
                : "Review and select before researching people",
            details: { ...candidate, domain },
            evidenceIds: cited.map((s) => s.id),
          });
        }
        for (const candidate of parsed.contacts) {
          const cited = sources.filter((s) =>
            candidate.evidenceIds.includes(s.id),
          );
          if (
            !candidate.firstName ||
            !candidate.lastName ||
            !cited.some((s) =>
              [candidate.firstName, candidate.lastName].every((n) =>
                s.payload.extract.toLowerCase().includes(n.toLowerCase()),
              ),
            )
          )
            continue;
          let domain = "";
          try {
            domain = new URL(candidate.companyWebsite).hostname
              .toLowerCase()
              .replace(/^www\./, "");
          } catch {
            continue;
          }
          discoveryResults.push({
            candidateId: generatePlatformId("event"),
            kind: "person",
            name: [candidate.firstName, candidate.lastName].join(" "),
            type: "people",
            status: "candidate",
            reason:
              "Check current employment and role before requesting an A+ email",
            details: {
              firstName: candidate.firstName,
              lastName: candidate.lastName,
              title: candidate.title,
              companyWebsite: candidate.companyWebsite,
              domain,
            },
            evidenceIds: cited.map((s) => s.id),
          });
        }
      }
      if (!mongo.withTransaction) throw new Error("Transactions required");
      await mongo.withTransaction(async (db, session) => {
        await contentAccess(db, config, identity, w, "create", session);
        await lockIcpWorkspace(db, w, session);
        if (!(await db.collection("events").findOne(fence, { session })))
          throw new HiveConflict("Research cancelled");
        for (const text of parsed.gaps)
          await db
            .collection("events")
            .insertOne(event(w, "research_gap", { jobId: id, text }), {
              session,
            });
        for (const result of discoveryResults)
          await db.collection("events").insertOne(
            {
              ...event(w, "research_discovery", {
                jobId: id,
                result,
                scope: request.scope,
                expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
              }),
              ...(result.candidateId ? { id: result.candidateId } : {}),
            },
            {
              session,
            },
          );
        if (request.campaignVersion)
          for (const assessment of parsed.assessments) {
            if (
              !request.scope.offers.some((o) => o.id === assessment.offerId) ||
              !request.scope.audiences.some((a) => a.id === assessment.icpId)
            )
              continue;
            const profile = await db
              .collection("ideal_customer_profiles")
              .findOne({ workspaceId: w, id: assessment.icpId }, { session });
            if (profile?.offer?.id !== assessment.offerId) continue;
            const snapshot = context.snapshots.find(
              (r) =>
                r.entityType === "ideal_customer_profiles" &&
                r.id === assessment.icpId,
            )?.snapshot;
            const consumer = ["b2c", "d2c"].includes(
              snapshot?.definition?.profileType ?? snapshot?.profileType,
            );
            if (assessment.personId) {
              if (
                !consumer ||
                request.sourceMode !== "existing" ||
                !request.destinations.some(
                  (d) => d.type === "people" && d.id === assessment.personId,
                )
              )
                continue;
              const personEvidence = sources
                .filter((s) => s.payload.recordId === assessment.personId)
                .map((s) => s.id);
              const evidenceIds = assessment.evidenceIds.filter((e) =>
                allowed.has(e),
              );
              await db.collection("events").insertOne(
                event(w, "campaign_audience_assessment", {
                  ...assessment,
                  organisationId: "",
                  website: "",
                  evidenceIds,
                  fit: evidenceIds.some((e) => personEvidence.includes(e))
                    ? assessment.fit
                    : "needs_research",
                  decision: "proposed",
                  jobId: id,
                  campaignId: request.destinations.find(
                    (d) => d.type === "campaign",
                  )?.id,
                  campaignVersion: request.campaignVersion,
                  scope: request.scope,
                }),
                { session },
              );
              continue;
            }
            if (consumer) continue;
            let organisationId = assessment.organisationId;
            const allowedOrganisations = [
              ...request.destinations
                .filter((d) => d.type === "organisations")
                .map((d) => d.id),
              ...discoveryResults
                .filter((d) => d.type === "organisations")
                .map((d) => d.id),
            ];
            if (
              !allowedOrganisations.includes(organisationId) &&
              assessment.website
            ) {
              let domain = "";
              try {
                domain = new URL(assessment.website).hostname
                  .toLowerCase()
                  .replace(/^www\./, "");
              } catch {
                continue;
              }
              const matches = await db
                .collection("organisations")
                .find(
                  {
                    workspaceId: w,
                    id: { $in: allowedOrganisations },
                    $or: [{ domain }, { normalizedDomain: domain }],
                  },
                  { session },
                )
                .limit(2)
                .toArray();
              if (matches.length !== 1) {
                const candidates = discoveryResults.filter(
                  (d) =>
                    d.kind === "organisation" && d.details?.domain === domain,
                );
                if (candidates.length === 1) {
                  const saved = await db
                    .collection("events")
                    .findOne(
                      { workspaceId: w, id: candidates[0]!.candidateId },
                      { session },
                    );
                  await db.collection("events").updateOne(
                    {
                      workspaceId: w,
                      id: candidates[0]!.candidateId,
                      eventType: "research_discovery",
                    },
                    {
                      $set: {
                        "payload.result.assessments": [
                          ...(saved?.payload.result.assessments ?? []),
                          {
                            ...assessment,
                            evidenceIds: assessment.evidenceIds.filter((e) =>
                              allowed.has(e),
                            ),
                            decision: "proposed",
                            campaignVersion: request.campaignVersion,
                          },
                        ],
                      },
                    },
                    { session },
                  );
                }
                continue;
              }
              organisationId = matches[0].id;
            }
            if (!allowedOrganisations.includes(organisationId)) continue;
            const evidenceIds = assessment.evidenceIds.filter((e) =>
              allowed.has(e),
            );
            await db.collection("events").insertOne(
              event(w, "campaign_audience_assessment", {
                ...assessment,
                organisationId,
                evidenceIds,
                fit: evidenceIds.length ? assessment.fit : "needs_research",
                decision: "proposed",
                jobId: id,
                campaignId: request.destinations.find(
                  (d) => d.type === "campaign",
                )?.id,
                campaignVersion: request.campaignVersion,
                scope: request.scope,
              }),
              { session },
            );
          }
        for (const f of findings) {
          const unsupported = f.kind === "fact" && !f.evidenceIds.length;
          await db.collection("events").insertOne(
            event(w, "research_finding", {
              ...f,
              kind: unsupported ? "inference" : f.kind,
              verification: "needs_review",
              jobId: id,
              brandId: request.scope.brandId,
              destinations: [
                ...request.destinations,
                ...discoveryResults
                  .filter(
                    (r) =>
                      r.id &&
                      r.evidenceIds.some((source: string) =>
                        f.evidenceIds.includes(source),
                      ),
                  )
                  .map((r) => ({ type: r.type, id: r.id })),
              ],
              contextHash: context.hash,
              reviewNote: unsupported
                ? "No supporting source was returned; confirm before use."
                : "",
              decision: "proposed",
            }),
            { session },
          );
        }
        await db.collection("events").updateOne(
          fence,
          {
            $set: {
              updatedAt: new Date(),
              "payload.status":
                parsed.gaps.length ||
                discoveryResults.some((r) => r.status === "needs_review")
                  ? "partial"
                  : "completed",
              "payload.summary": parsed.summary,
              "payload.gapCount": parsed.gaps.length,
              "payload.usage": [...searchUsage, output.usage],
              "payload.discoveryCount": discoveryResults.length,
              "payload.phase": "Research available for review",
              "payload.lease": null,
            },
          },
          { session },
        );
        await db.collection("events").insertOne(
          event(w, "research_completed", {
            jobId: id,
            brandId: request.scope.brandId,
            destinations: [
              ...request.destinations,
              ...discoveryResults
                .filter((r) => r.id)
                .map((r) => ({ type: r.type, id: r.id })),
            ],
            nbaStatus: "available_for_evaluation",
            executionAuthorised: false,
          }),
          { session },
        );
      });
    } catch {
      await db.collection("events").updateOne(fence, {
        $set: {
          updatedAt: new Date(),
          "payload.status": "failed",
          "payload.phase": "Research needs attention",
          "payload.error": generator
            ? "Research could not finish. Retained evidence is available for a retry."
            : "Research generation is not configured.",
          "payload.lease": null,
        },
      });
    }
    return read(identity, w, id);
  }
  async function mutate(
    identity: AuthenticatedUser,
    w: string,
    id: string,
    raw: unknown,
  ) {
    const input = z
      .object({
        action: z.enum(["cancel", "retry", "archive"]),
        expectedUpdatedAt: z.string().datetime(),
      })
      .strict()
      .parse(raw);
    const db = await authorised(identity, w, "update");
    const row = await db.collection("events").findOne({
      workspaceId: w,
      id,
      eventType: "research_job",
      updatedAt: new Date(input.expectedUpdatedAt),
    });
    if (!row)
      throw new HiveConflict("Research changed. Refresh before continuing.");
    if (
      input.action === "retry" &&
      !["failed", "partial"].includes(row.payload.status)
    )
      throw new HiveConflict("Only interrupted research can be retried");
    if (input.action === "retry")
      return start(identity, w, {
        ...row.payload.request,
        requestKey: randomUUID(),
      });
    const r = await db.collection("events").updateOne(
      { workspaceId: w, id, updatedAt: row.updatedAt },
      {
        $set: {
          updatedAt: new Date(),
          ...(input.action === "archive"
            ? {
                archived: true,
                "payload.leaseToken": null,
                "payload.status": terminal.includes(row.payload.status)
                  ? row.payload.status
                  : "cancelled",
              }
            : {
                "payload.status": "cancelled",
                "payload.leaseToken": null,
                "payload.phase": "Cancelled",
              }),
        },
      },
    );
    if (!r.matchedCount) throw new HiveConflict("Research changed");
    return { id };
  }
  async function policy(identity: AuthenticatedUser, w: string, raw: unknown) {
    const input = policyInput.parse(raw),
      db = await authorised(identity, w, "update");
    await targets(
      db,
      w,
      input.request.destinations,
      input.request.scope.brandId,
      identity,
    );
    await contentContext(db, config, identity, w, input.request.scope);
    const { id, expectedUpdatedAt, ...data } = input;
    if (id) {
      const r = await db.collection("events").updateOne(
        {
          workspaceId: w,
          id,
          eventType: "research_policy",
          updatedAt: new Date(expectedUpdatedAt ?? 0),
        },
        {
          $set: {
            updatedAt: new Date(),
            payload: {
              ...data,
              identity,
              cursorAt: new Date().toISOString(),
              nextAt: new Date(
                Date.now() +
                  (data.mode === "scheduled"
                    ? data.intervalDays * 86400000
                    : 0),
              ).toISOString(),
            },
          },
        },
      );
      if (!r.matchedCount) throw new HiveConflict("Policy changed");
      return { id };
    }
    const row = event(w, "research_policy", {
      ...data,
      identity,
      cursorAt: new Date().toISOString(),
      nextAt: new Date(
        Date.now() +
          (data.mode === "scheduled" ? data.intervalDays * 86400000 : 0),
      ).toISOString(),
    });
    await db.collection("events").insertOne(row);
    return { id: row.id };
  }
  async function review(
    identity: AuthenticatedUser,
    w: string,
    id: string,
    raw: unknown,
  ) {
    const input = z
      .object({
        expectedUpdatedAt: z.string().datetime(),
        decision: z.enum(["accepted", "rejected", "proposed"]),
        statement: z.string().trim().min(1).max(2000),
        note: z.string().trim().max(2000),
      })
      .strict()
      .parse(raw);
    await authorised(identity, w, "update");
    if (!mongo.withTransaction) throw new Error("Transactions required");
    return mongo.withTransaction(async (db, session) => {
      await contentAccess(db, config, identity, w, "update", session);
      await lockIcpWorkspace(db, w, session);
      const row = await db.collection("events").findOne(
        {
          id,
          workspaceId: w,
          eventType: "research_finding",
          updatedAt: new Date(input.expectedUpdatedAt),
        },
        { session },
      );
      if (!row)
        throw new HiveConflict("Finding changed. Refresh before saving.");
      const now = new Date();
      await db.collection("events").updateOne(
        { id, workspaceId: w, updatedAt: row.updatedAt },
        {
          $set: {
            updatedAt: now,
            "payload.statement": input.statement,
            "payload.decision": input.decision,
            "payload.reviewNote": input.note,
            "payload.verification":
              input.decision === "accepted" ? "human_reviewed" : "needs_review",
          },
        },
        { session },
      );
      await db.collection("events").insertOne(
        event(w, "research_finding_reviewed", {
          findingId: id,
          before: row.payload.statement,
          decision: input.decision,
          note: input.note,
          reviewedBy: identity.subject,
        }),
        { session },
      );
      return { id };
    });
  }
  async function removePolicy(
    identity: AuthenticatedUser,
    w: string,
    id: string,
    raw: unknown,
  ) {
    const input = z
      .object({ expectedUpdatedAt: z.string().datetime() })
      .strict()
      .parse(raw);
    const db = await authorised(identity, w, "update");
    const r = await db.collection("events").updateOne(
      {
        workspaceId: w,
        id,
        eventType: "research_policy",
        updatedAt: new Date(input.expectedUpdatedAt),
      },
      {
        $set: {
          archived: true,
          updatedAt: new Date(),
          "payload.enabled": false,
        },
      },
    );
    if (!r.matchedCount) throw new HiveConflict("Policy changed");
    return { id };
  }
  async function evidenceFor(
    identity: AuthenticatedUser,
    w: string,
    type: string,
    id: string,
  ) {
    const db = await authorised(identity, w);
    const ref = destination.parse({ type, id });
    const resolved = await resolveHvmContext(db, config, identity);
    resolved.authority.scopeFilter(resolved.context, "read", {
      type: ({
        content_brief: "content_strategy",
        interaction: "events",
        campaign: "campaigns",
        people: "people",
        organisations: "organisations",
        offerings: "offerings",
        offers: "offers",
        ideal_customer_profiles: "ideal_customer_profiles",
      }[ref.type] ?? ref.type) as ResourceType,
      workspaceId: w,
    });
    const rows = await db
      .collection("events")
      .find({
        workspaceId: w,
        eventType: "research_finding",
        "payload.destinations": { $elemMatch: { type, id } },
      })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();
    return rows.map(present);
  }
  // Invoked by trusted server composition. Saved identity is an audit principal, never a token;
  // start/run resolve its CURRENT memberships on each execution.
  async function tick() {
    const db = await mongo.database();
    // Remove working personal data after the finite candidate retention window; keep counts and billing history.
    await db.collection("events").updateMany(
      {
        eventType: "research_discovery",
        "payload.expiresAt": { $lte: new Date().toISOString() },
        "payload.result.status": { $nin: ["promoted", "expired"] },
      },
      {
        $set: {
          "payload.result.status": "expired",
          "payload.result.name": "Expired candidate",
          "payload.result.details": {},
          "payload.result.evidenceIds": [],
          updatedAt: new Date(),
        },
        $unset: {
          "payload.result.verifiedEmail": "",
          "payload.result.employmentReview": "",
          "payload.result.reviewedBy": "",
        },
      },
    );
    await db.collection("events").updateMany(
      {
        eventType: "lusha_lookup",
        "payload.expiresAt": { $lte: new Date().toISOString() },
      },
      { $unset: { "payload.lookupKey": "" } },
    );
    const jobs = await db
      .collection("events")
      .find({
        eventType: "research_job",
        archived: { $ne: true },
        "payload.status": { $in: ["queued", "running"] },
      })
      .sort({ createdAt: 1 })
      .limit(10)
      .toArray();
    for (const job of jobs) {
      try {
        await run(job.payload.identity, job.workspaceId, job.id);
      } catch {
        await db.collection("events").updateOne(
          {
            id: job.id,
            workspaceId: job.workspaceId,
            updatedAt: job.updatedAt,
          },
          {
            $set: {
              updatedAt: new Date(),
              "payload.status": "failed",
              "payload.phase": "Research needs attention",
              "payload.error":
                "Current workspace access could not be verified. Review access before retrying.",
            },
          },
        );
      }
    }
    const policies = await db
      .collection("events")
      .find({
        eventType: "research_policy",
        archived: { $ne: true },
        "payload.enabled": true,
        "payload.nextAt": { $lte: new Date().toISOString() },
      })
      .limit(20)
      .toArray();
    for (const row of policies) {
      try {
        let triggerId = "scheduled:" + row.payload.nextAt,
          cursorAt = row.payload.cursorAt,
          cursorId = row.payload.cursorId ?? "",
          request = { ...row.payload.request };
        if (row.payload.mode === "triggered") {
          const selector =
            row.payload.trigger === "contact.created"
              ? { eventType: "hvm_record_created", "payload.kind": "contacts" }
              : row.payload.trigger === "contact.enriched"
                ? {
                    eventType: "hvm_record_updated",
                    "payload.kind": "contacts",
                  }
                : row.payload.trigger === "organisation.updated"
                  ? {
                      eventType: "hvm_record_updated",
                      "payload.kind": "organisations",
                    }
                  : { eventType: "contact_context_changed" };
          const cursor = new Date(cursorAt ?? row.updatedAt);
          const events = await db
            .collection("events")
            .find({
              workspaceId: row.workspaceId,
              ...selector,
              "payload.origin": { $ne: "research" },
              $or: [
                { createdAt: { $gt: cursor } },
                { createdAt: cursor, id: { $gt: cursorId } },
              ],
            })
            .sort({ createdAt: 1, id: 1 })
            .limit(1)
            .toArray();
          const match = events[0];
          if (!match) continue;
          triggerId = match.id;
          cursorAt = match.createdAt.toISOString();
          cursorId = match.id;
          const triggeredRecordId =
            match.payload.recordId ?? match.payload.subjectId;
          if (triggeredRecordId) {
            request = {
              ...request,
              destinations: [
                ...request.destinations,
                {
                  type:
                    match.payload.kind === "contacts" ||
                    match.eventType === "contact_context_changed"
                      ? "people"
                      : "organisations",
                  id: triggeredRecordId,
                },
              ],
            };
          }
        }
        const scope = { ...request.scope };
        for (const [key, collection] of [
          ["products", "offerings"],
          ["offers", "offers"],
          ["audiences", "ideal_customer_profiles"],
        ] as const) {
          scope[key] = await Promise.all(
            scope[key].map(async (ref: { id: string; revision: number }) => {
              const current = await db.collection(collection).findOne({
                workspaceId: row.workspaceId,
                id: ref.id,
                archived: { $ne: true },
                status: { $ne: "retired" },
                approvedRevision: { $gt: 0 },
              });
              if (!current)
                throw new HiveConflict("Selected approved context unavailable");
              return { id: ref.id, revision: current.approvedRevision };
            }),
          );
        }
        request = { ...request, scope };
        const digest = hash([row.id, triggerId]);
        const key = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
        await start(
          row.payload.identity,
          row.workspaceId,
          { ...request, requestKey: key },
          row.payload.mode,
        );
        await db.collection("events").updateOne(
          {
            id: row.id,
            workspaceId: row.workspaceId,
            updatedAt: row.updatedAt,
          },
          {
            $set: {
              updatedAt: new Date(),
              "payload.cursorAt": cursorAt,
              "payload.cursorId": cursorId,
              "payload.error": "",
              "payload.nextAt": new Date(
                Date.now() +
                  (row.payload.mode === "scheduled"
                    ? row.payload.intervalDays * 86400000
                    : 30000),
              ).toISOString(),
            },
          },
        );
      } catch {
        await db.collection("events").updateOne(
          {
            id: row.id,
            workspaceId: row.workspaceId,
            updatedAt: row.updatedAt,
          },
          {
            $set: {
              updatedAt: new Date(),
              "payload.enabled": false,
              "payload.error":
                "Refresh paused: review current access, selected records and approved context before enabling again.",
            },
          },
        );
      }
    }
  }
  async function resume(identity: AuthenticatedUser, w: string, id: string) {
    await authorised(identity, w, "create");
    return read(identity, w, id);
  }
  return {
    start,
    read,
    list,
    run,
    mutate,
    policy,
    evidenceFor,
    tick,
    resume,
    review,
    removePolicy,
  };
}
