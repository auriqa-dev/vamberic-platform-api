import { createHash } from "node:crypto";
import { z } from "zod";
import type { Document } from "mongodb";
import type { AppConfig } from "../../config";
import type { MongoService } from "../mongo";
import type { AuthenticatedUser } from "../../middlewares/auth";
import {
  EventSchema,
  generatePlatformId,
  platformIdSchema,
} from "../../domain";
import { offerAuthority, readOfferFoundation, OfferConflict } from "../offers";
import { readHiveDefinitions } from "../hive-definitions";
import { lockIcpWorkspace } from "../icp/access";
import { OfferBriefProviderFailure } from "./brief-generate";
import { safeOfferFailure } from "./diagnostics";
import {
  OfferBriefInterpretationSchema,
  MethodologyRecommendationSchema,
  type OfferBriefInterpreter,
} from "./brief-schema";

const startSchema = z
  .object({
    offeringId: platformIdSchema("offering"),
    requestKey: z.string().uuid(),
    intent: z.string().trim().min(1).max(6000),
  })
  .strict();
export function createOfferBriefs(
  config: AppConfig,
  mongo: MongoService,
  interpret?: OfferBriefInterpreter,
) {
  const view = (row: Document) => ({
    id: row.id,
    updatedAt: row.updatedAt.toISOString(),
    ...row.payload,
    status:
      row.payload.status === "interpreting" &&
      Date.now() - row.createdAt.getTime() > 120000
        ? "interrupted"
        : row.payload.status,
  });
  // Link by saved generation identity, never by a mutable offer name.
  async function linkedView(row: Document) {
    const db = await mongo.database();
    const generations = await db
      .collection("events")
      .find({
        workspaceId: row.workspaceId,
        eventType: "offer_generation",
        "payload.input.briefId": row.id,
        "payload.status": "complete",
      })
      .sort({ createdAt: -1 })
      .toArray();
    const ids = generations.map((g) => g.payload.offerId).filter(Boolean);
    const active = ids.length
      ? await db
          .collection("offers")
          .find({
            workspaceId: row.workspaceId,
            offeringId: row.payload.input.offeringId,
            id: { $in: ids },
            archived: false,
            status: { $ne: "retired" },
          })
          .toArray()
      : [];
    const linkedOffers: Record<string, string> = {};
    for (const generation of generations) {
      const index = generation.payload.input.briefOfferIndex;
      if (
        Number.isInteger(index) &&
        !linkedOffers[index] &&
        active.some((offer) => offer.id === generation.payload.offerId)
      ) {
        linkedOffers[index] = generation.payload.offerId;
      }
    }
    return { ...view(row), linkedOffers };
  }
  async function read(identity: AuthenticatedUser, w: string, id: string) {
    platformIdSchema("event").parse(id);
    const db = await mongo.database();
    await offerAuthority(db, config, identity, w, "offers", "read");
    const row = await db
      .collection("events")
      .findOne({ workspaceId: w, id, eventType: "offer_brief" });
    if (!row) throw new OfferConflict("Brief not found");
    return linkedView(row);
  }
  const available = async (identity: AuthenticatedUser, w: string) =>
    (
      (await readOfferFoundation(
        mongo,
        config,
        identity,
        w,
        "methodologies",
        {},
      )) as Document
    ).items as Document[];
  const fingerprint = (offer: {
    existingOfferId: string | null;
    brief: unknown;
  }) =>
    createHash("sha256")
      .update(
        JSON.stringify({
          existingOfferId: offer.existingOfferId,
          brief: offer.brief,
        }),
      )
      .digest("hex");
  return {
    read,
    async methodology(identity: AuthenticatedUser, w: string, raw: unknown) {
      const input = z
        .object({
          id: platformIdSchema("event"),
          index: z.number().int().min(0).max(4),
          expectedUpdatedAt: z.string().datetime(),
          selection: z
            .object({
              id: platformIdSchema("offermethodology"),
              version: z.number().int().positive(),
            })
            .strict()
            .optional(),
        })
        .strict()
        .parse(raw);
      if (!mongo.withTransaction) throw new Error("Transactions required");
      const db = await mongo.database();
      await offerAuthority(db, config, identity, w, "offers", "create");
      const before = await db
        .collection("events")
        .findOne({ id: input.id, workspaceId: w, eventType: "offer_brief" });
      if (
        !before ||
        before.updatedAt.toISOString() !== input.expectedUpdatedAt ||
        before.payload.status !== "confirmed"
      )
        throw new OfferConflict("Confirm the current brief first");
      const selected = OfferBriefInterpretationSchema.parse(
        before.payload.interpretation,
      ).offers[input.index];
      if (!selected) throw new OfferConflict("Offer brief not found");
      const methods = await available(identity, w);
      let recommendation = selected.methodologyRecommendation;
      const completed = await db
        .collection("events")
        .find({
          workspaceId: w,
          eventType: "offer_generation",
          "payload.input.briefId": input.id,
          "payload.input.briefOfferIndex": input.index,
          "payload.status": "complete",
        })
        .sort({ createdAt: -1 })
        .next();
      const existingId = selected.existingOfferId ?? completed?.payload.offerId;
      const existing = existingId
        ? await db.collection("offers").findOne({
            id: existingId,
            workspaceId: w,
            archived: false,
          })
        : null;
      const design = existing?.offerDesignId
        ? await db.collection("offer_designs").findOne({
            id: existing.offerDesignId,
            workspaceId: w,
            archived: false,
          })
        : null;
      let usage: unknown;
      let recommendationLease: string | undefined;
      const releaseRecommendation = async () => {
        if (recommendationLease)
          await db.collection("events").updateOne(
            {
              id: input.id,
              workspaceId: w,
              "payload.methodologyPendingAt": recommendationLease,
            },
            { $unset: { "payload.methodologyPendingAt": "" } },
          );
      };
      if (!input.selection && !recommendation) {
        {
          if (!interpret)
            throw new Error("Methodology recommendation unavailable");
          const startedAt = new Date();
          await mongo.withTransaction(async (db, session) => {
            await offerAuthority(
              db,
              config,
              identity,
              w,
              "offers",
              "create",
              session,
            );
            await lockIcpWorkspace(db, w, session);
            const current = await db.collection("events").findOne(
              {
                id: input.id,
                workspaceId: w,
                updatedAt: new Date(input.expectedUpdatedAt),
              },
              { session },
            );
            if (
              !current ||
              (current.payload.methodologyPendingAt &&
                new Date(current.payload.methodologyPendingAt).getTime() >
                  Date.now() - 120000)
            )
              throw new OfferConflict(
                "A recommendation is already being prepared; reload shortly",
              );
            await db.collection("events").updateOne(
              { id: input.id, workspaceId: w },
              {
                $set: {
                  "payload.methodologyPendingAt": startedAt.toISOString(),
                },
              },
              { session },
            );
          });
          recommendationLease = startedAt.toISOString();
          try {
            const result = await interpret(
              {
                intent:
                  "Return exactly one offer: the supplied confirmedOffer. Recommend its methodology without changing its scope or considering other offers.",
                product: {
                  confirmedOffer: selected.brief,
                  currentOffer: existing?.definition,
                },
                existingOffers: [],
                recommendationOnly: selected,
                methodologies: methods.map(
                  ({ id, version, name, description }) => ({
                    id,
                    version,
                    name,
                    description,
                  }),
                ),
              },
              AbortSignal.timeout(90000),
            );
            if (result.interpretation.offers.length !== 1)
              throw new OfferConflict(
                "Henry must recommend for only the selected offer",
              );
            recommendation = MethodologyRecommendationSchema.parse(
              result.interpretation.offers[0]?.methodologyRecommendation,
            );
            usage = result.usage;
          } catch (error) {
            await releaseRecommendation();
            throw error;
          }
        }
      }
      const choice = input.selection ?? recommendation;
      if (
        !choice ||
        !methods.some((m) => m.id === choice.id && m.version === choice.version)
      ) {
        await releaseRecommendation();
        throw new OfferConflict("Choose an available methodology");
      }
      let resultId = input.id;
      await mongo
        .withTransaction(async (db, session) => {
          const actor = await offerAuthority(
            db,
            config,
            identity,
            w,
            "offers",
            "create",
            session,
          );
          const now = await lockIcpWorkspace(db, w, session);
          const row = await db.collection("events").findOne(
            {
              id: input.id,
              workspaceId: w,
              eventType: "offer_brief",
              updatedAt: new Date(input.expectedUpdatedAt),
            },
            { session },
          );
          if (!row || row.payload.status !== "confirmed")
            throw new OfferConflict(
              "Brief changed; reload before choosing a methodology",
            );
          if (
            row.payload.methodologyPendingAt &&
            row.payload.methodologyPendingAt !== recommendationLease &&
            new Date(row.payload.methodologyPendingAt).getTime() >
              Date.now() - 120000
          )
            throw new OfferConflict("Wait for the current recommendation");
          if (
            !(await available(identity, w)).some(
              (m) => m.id === choice.id && m.version === choice.version,
            )
          )
            throw new OfferConflict("Methodology is no longer available");
          const running = await db.collection("events").findOne(
            {
              workspaceId: w,
              eventType: "offer_generation",
              "payload.input.briefId": input.id,
              "payload.input.briefOfferIndex": input.index,
              "payload.status": "generating",
            },
            { session },
          );
          if (running)
            throw new OfferConflict(
              "This brief is already in use; continue its saved offer",
            );
          const approvals = { ...(row.payload.methodologyApprovals ?? {}) };
          const interpretation = OfferBriefInterpretationSchema.parse(
            row.payload.interpretation,
          );
          let existingOffers = [...row.payload.existingOffers];
          if (completed && input.selection) {
            if (!existing || !design)
              throw new OfferConflict("Saved offer no longer available");
            await offerAuthority(
              db,
              config,
              identity,
              w,
              "offers",
              "update",
              session,
            );
            const current = await db.collection("offers").findOne(
              {
                id: existing.id,
                workspaceId: w,
                archived: false,
                updatedAt: existing.updatedAt,
              },
              { session },
            );
            if (!current)
              throw new OfferConflict("Saved offer changed; reload");
            resultId = generatePlatformId("event");
            for (const [index, offer] of interpretation.offers.entries()) {
              const priorGeneration = await db
                .collection("events")
                .find(
                  {
                    workspaceId: w,
                    eventType: "offer_generation",
                    "payload.input.briefId": row.id,
                    "payload.input.briefOfferIndex": index,
                    "payload.status": "complete",
                  },
                  { session },
                )
                .sort({ createdAt: -1 })
                .next();
              const offerId =
                offer.existingOfferId ?? priorGeneration?.payload.offerId;
              if (!offerId) continue;
              const saved = await db
                .collection("offers")
                .findOne(
                  { workspaceId: w, id: offerId, archived: false },
                  { session },
                );
              if (!saved)
                throw new OfferConflict(
                  "A saved sibling offer is unavailable; reload",
                );
              if (offer.existingOfferId !== saved.id)
                delete approvals[String(index)];
              offer.existingOfferId = saved.id;
              existingOffers = [
                ...existingOffers.filter((o: Document) => o.id !== saved.id),
                {
                  id: saved.id,
                  updatedAt: saved.updatedAt.toISOString(),
                  name: saved.definition.name,
                  status: saved.status,
                },
              ];
            }
          }
          if (!input.selection)
            interpretation.offers[input.index]!.methodologyRecommendation =
              recommendation;
          if (input.selection)
            approvals[String(input.index)] = {
              id: choice.id,
              version: choice.version,
              briefHash: fingerprint(interpretation.offers[input.index]!),
              approvedAt: now.toISOString(),
              approvedBy: actor,
            };
          await db.collection("events").insertOne(
            EventSchema.parse({
              id: generatePlatformId("event"),
              workspaceId: w,
              createdAt: now,
              updatedAt: now,
              occurredAt: now,
              createdBy: actor,
              updatedBy: actor,
              eventType: input.selection
                ? "offer_methodology_approved"
                : "offer_methodology_recommended",
              payload: {
                briefId: resultId,
                previousBriefId: row.id,
                index: input.index,
                choice,
                ...(usage ? { usage } : {}),
                briefHash: fingerprint(interpretation.offers[input.index]!),
              },
            }),
            { session },
          );
          if (resultId !== row.id) {
            await db.collection("events").insertOne(
              EventSchema.parse({
                ...Object.fromEntries(
                  Object.entries(row).filter(([key]) => key !== "_id"),
                ),
                id: resultId,
                createdAt: now,
                updatedAt: now,
                occurredAt: now,
                createdBy: actor,
                updatedBy: actor,
                payload: {
                  ...row.payload,
                  parentBriefId: row.id,
                  interpretation,
                  methodologyApprovals: approvals,
                  existingOffers,
                },
              }),
              { session },
            );
            await db.collection("events").updateOne(
              { id: row.id, workspaceId: w, updatedAt: row.updatedAt },
              {
                $set: {
                  "payload.methodologySuccessor": resultId,
                  updatedAt: now,
                  updatedBy: actor,
                },
              },
              { session },
            );
            return;
          }
          await db.collection("events").updateOne(
            { id: row.id, workspaceId: w, updatedAt: row.updatedAt },
            {
              $set: {
                "payload.interpretation": interpretation,
                "payload.methodologyApprovals": approvals,
                updatedAt: now,
                updatedBy: actor,
              },
            },
            { session },
          );
        })
        .finally(releaseRecommendation);
      return read(identity, w, resultId);
    },
    async latest(identity: AuthenticatedUser, w: string, offeringId: string) {
      platformIdSchema("offering").parse(offeringId);
      const db = await mongo.database();
      await offerAuthority(db, config, identity, w, "offers", "read");
      const rows = await db
        .collection("events")
        .find({
          workspaceId: w,
          eventType: "offer_brief",
          "payload.input.offeringId": offeringId,
        })
        .sort({ createdAt: -1, id: -1 })
        .limit(1)
        .toArray();
      return rows[0] ? linkedView(rows[0]) : null;
    },
    async start(identity: AuthenticatedUser, w: string, raw: unknown) {
      const input = startSchema.parse(raw);
      if (!interpret || !mongo.withTransaction)
        throw new Error("Brief interpretation unavailable");
      const product = (await readHiveDefinitions(
        mongo,
        config,
        identity,
        w,
        "offerings",
        {},
        input.offeringId,
      )) as Document;
      if (!product.approvedRevision || product.archived)
        throw new OfferConflict("Approve the product first");
      const approved = (await readHiveDefinitions(
        mongo,
        config,
        identity,
        w,
        "offerings",
        {},
        input.offeringId,
        product.approvedRevision,
      )) as Document;
      const existing: Document[] = [];
      for (let offset = 0; offset <= 10000; offset += 100) {
        const page = (await readOfferFoundation(
          mongo,
          config,
          identity,
          w,
          "offers",
          { offeringId: input.offeringId, limit: 100, offset },
        )) as Document;
        existing.push(...page.items);
        if (!page.hasMore) break;
        if (offset === 10000)
          throw new OfferConflict("Existing offer list is incomplete");
      }
      const prepared = await mongo.withTransaction(async (db, session) => {
        const actor = await offerAuthority(
          db,
          config,
          identity,
          w,
          "offers",
          "create",
          session,
        );
        const now = await lockIcpWorkspace(db, w, session);
        const previous = await db.collection("events").findOne(
          {
            workspaceId: w,
            eventType: "offer_brief",
            "payload.input.requestKey": input.requestKey,
          },
          { session },
        );
        if (previous) {
          if (JSON.stringify(previous.payload.input) !== JSON.stringify(input))
            throw new OfferConflict("Request changed");
          return { row: previous, fresh: false };
        }
        const active = await db.collection("events").findOne(
          {
            workspaceId: w,
            eventType: "offer_brief",
            "payload.status": "interpreting",
            createdAt: { $gt: new Date(now.getTime() - 120000) },
          },
          { session },
        );
        if (active)
          throw new OfferConflict("An offer brief is already being prepared");
        const row = EventSchema.parse({
          id: generatePlatformId("event"),
          workspaceId: w,
          createdAt: now,
          updatedAt: now,
          occurredAt: now,
          createdBy: actor,
          updatedBy: actor,
          eventType: "offer_brief",
          payload: {
            input,
            status: "interpreting",
            requiresMethodologyApproval: true,
            productRevision: product.approvedRevision,
            existingOffers: existing.map((o) => ({
              id: o.id,
              updatedAt: o.updatedAt.toISOString(),
              name: o.definition.name,
              status: o.status,
            })),
          },
        });
        await db.collection("events").insertOne(row, { session });
        return { row, fresh: true };
      });
      if (prepared.fresh)
        void (async () => {
          const db = await mongo.database();
          try {
            const result = await interpret(
              {
                intent: input.intent,
                product: approved.snapshot.definition,
                existingOffers: existing.map((o) => ({
                  id: o.id,
                  definition: o.definition,
                })),
                methodologies: (await available(identity, w)).map(
                  ({ id, version, name, description }) => ({
                    id,
                    version,
                    name,
                    description,
                  }),
                ),
              },
              AbortSignal.timeout(90000),
            );
            const parsed = OfferBriefInterpretationSchema.parse(
              result.interpretation,
            );
            const ids = parsed.offers.flatMap((o) =>
              o.existingOfferId ? [o.existingOfferId] : [],
            );
            if (
              new Set(ids).size !== ids.length ||
              ids.some((id) => !existing.some((o) => o.id === id))
            )
              throw new OfferConflict("Invalid existing offer selection");
            await mongo.withTransaction!(async (db, session) => {
              await offerAuthority(
                db,
                config,
                identity,
                w,
                "offers",
                "create",
                session,
              );
              await lockIcpWorkspace(db, w, session);
              const current = await db
                .collection("offerings")
                .findOne(
                  { workspaceId: w, id: input.offeringId, archived: false },
                  { session },
                );
              if (
                current?.approvedRevision !== product.approvedRevision ||
                Date.now() - prepared.row.createdAt.getTime() > 120000
              )
                throw new OfferConflict("Product or brief changed");
              await db.collection("events").updateOne(
                {
                  id: prepared.row.id,
                  workspaceId: w,
                  "payload.status": "interpreting",
                },
                {
                  $set: {
                    "payload.status": "review",
                    "payload.interpretation": parsed,
                    "payload.usage": result.usage,
                    updatedAt: new Date(),
                  },
                },
                { session },
              );
            });
          } catch (error) {
            const failure = error instanceof OfferBriefProviderFailure
              ? error.diagnostic : safeOfferFailure(error);
            console.warn(JSON.stringify({ event: "offer_brief_failed", workspaceId: w, jobId: prepared.row.id, ...failure }));
            await db.collection("events").updateOne(
              {
                id: prepared.row.id,
                workspaceId: w,
                "payload.status": "interpreting",
              },
              { $set: { "payload.status": "failed", "payload.failure": failure, updatedAt: new Date() } },
            );
          }
        })().catch(() => {});
      return read(identity, w, prepared.row.id);
    },
    async confirm(identity: AuthenticatedUser, w: string, raw: unknown) {
      const input = z
        .object({
          id: platformIdSchema("event"),
          expectedUpdatedAt: z.string().datetime(),
          interpretation: OfferBriefInterpretationSchema,
        })
        .strict()
        .parse(raw);
      if (!mongo.withTransaction) throw new Error("Transactions required");
      await mongo.withTransaction(async (db, session) => {
        const actor = await offerAuthority(
          db,
          config,
          identity,
          w,
          "offers",
          "create",
          session,
        );
        const now = await lockIcpWorkspace(db, w, session);
        const row = await db.collection("events").findOne(
          {
            workspaceId: w,
            id: input.id,
            eventType: "offer_brief",
            updatedAt: new Date(input.expectedUpdatedAt),
            "payload.status": "review",
          },
          { session },
        );
        if (!row)
          throw new OfferConflict("Brief changed; reload before confirming");
        const product = await db.collection("offerings").findOne(
          {
            workspaceId: w,
            id: row.payload.input.offeringId,
            archived: false,
          },
          { session },
        );
        if (product?.approvedRevision !== row.payload.productRevision)
          throw new OfferConflict("Product changed; prepare the brief again");
        for (const [index, offer] of input.interpretation.offers.entries()) {
          const original = row.payload.interpretation?.offers[index];
          if (
            !original ||
            JSON.stringify(original.brief) !== JSON.stringify(offer.brief) ||
            original.existingOfferId !== offer.existingOfferId
          )
            delete offer.methodologyRecommendation;
        }
        const ids = input.interpretation.offers.flatMap((o) =>
          o.existingOfferId ? [o.existingOfferId] : [],
        );
        if (new Set(ids).size !== ids.length)
          throw new OfferConflict("An existing offer may only appear once");
        for (const id of ids) {
          const prior = row.payload.existingOffers.find(
            (o: Document) => o.id === id,
          );
          const current = await db.collection("offers").findOne(
            {
              workspaceId: w,
              id,
              offeringId: row.payload.input.offeringId,
              archived: false,
            },
            { session },
          );
          if (
            !prior ||
            !current ||
            current.updatedAt.toISOString() !== prior.updatedAt
          )
            throw new OfferConflict(
              "Existing offer changed; prepare the brief again",
            );
        }
        await db.collection("events").insertOne(
          EventSchema.parse({
            id: generatePlatformId("event"),
            workspaceId: w,
            createdAt: now,
            updatedAt: now,
            occurredAt: now,
            createdBy: actor,
            updatedBy: actor,
            eventType: "offer_brief_confirmed",
            payload: {
              briefId: row.id,
              original: row.payload.interpretation,
              confirmed: input.interpretation,
            },
          }),
          { session },
        );
        await db.collection("events").updateOne(
          { id: row.id, workspaceId: w },
          {
            $set: {
              "payload.status": "confirmed",
              "payload.interpretation": input.interpretation,
              updatedAt: now,
              updatedBy: actor,
            },
          },
          { session },
        );
      });
      return read(identity, w, input.id);
    },
  };
}
