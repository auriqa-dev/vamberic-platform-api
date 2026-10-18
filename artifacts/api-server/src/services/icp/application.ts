import {reviewedResearchContext} from "../research/evidence-context";
import { researchSelection, readResearchContext } from "../research/context";
import { readOfferFoundation } from "../offers";
import type { Document } from "mongodb";
import { readGenerationBrandBrief } from "../generation-guidance";
import { createPsuApplication } from "../psu/application";
import { ESOS_SUPPORTING_SOURCE } from "./esos-recovery";
import { importedFacts } from "./import-observations";
import { IcpContentSchema, semanticHash } from "../../domain/hive-definitions";
import { z } from "zod";
import type { AppConfig } from "../../config";
import type { MongoService } from "../mongo";
import type { AuthenticatedUser } from "../../middlewares/auth";
import {
  EventSchema,
  generatePlatformId,
  platformIdSchema,
} from "../../domain";
import { icpAccess, lockIcpWorkspace } from "./access";
import {
  HiveConflict,
  readHiveDefinitions,
  mutateHiveDefinition,
} from "../hive-definitions";
import { IcpGenerationError, type IcpGenerator } from "./generate";
const inputSchema = z
  .object({
    requestKey: z.string().uuid(),
    offeringId: platformIdSchema("offering"),
    offer: z
      .object({
        id: platformIdSchema("offer"),
        revision: z.number().int().positive(),
      })
      .strict()
      .optional(),
    profileType: z.enum(["b2b", "b2c", "d2c"]),
    instructions: z.string().max(4000),
    researchDocuments: researchSelection.optional(),
    customerUrls: z
      .array(
        z
          .string()
          .url()
          .max(2048)
          .refine((value) => value.startsWith("https://")),
      )
      .max(6)
      .optional(),
    examples: z
      .array(
        z
          .object({
            id: z.string().max(100),
            type: z.enum(["company", "contact"]),
            reason: z.string().max(500),
          })
          .strict(),
      )
      .max(10),
  })
  .strict();
export function createIcpApplication(
  config: AppConfig,
  mongo: MongoService,
  generate?: IcpGenerator,
) {
  async function read(identity: AuthenticatedUser, w: string, id: string) {
    platformIdSchema("event").parse(id);
    const db = await mongo.database();
    await icpAccess(db, config, identity, w, "read");
    const row = await db
      .collection("events")
      .findOne({ id, workspaceId: w, eventType: "icp_generation" });
    if (!row) throw new HiveConflict("Generation not found");
    const result = row.payload.resultId
      ? await db.collection("events").findOne({
          id: row.payload.resultId,
          workspaceId: w,
          eventType: "icp_generation_result",
        })
      : undefined;
    const recoveredInput=structuredClone(row.payload.input);
    if(recoveredInput?.examples) for(const example of recoveredInput.examples) {
      const record=await db.collection(example.type === "company" ? "organisations" : "people").findOne({id:example.id,workspaceId:w,archived:{$ne:true}});
      example.name=record ? (example.type === "company" ? record.name : [record.firstName,record.lastName].filter(Boolean).join(" ")) || "Selected example" : "Unavailable example — remove or replace";
    }
    return {
      ...(result?.payload ?? {}),
      id: row.id,
      ...row.payload,
      input:recoveredInput,
      status:
        row.payload.status === "generating" &&
        Date.now() - row.createdAt.getTime() > 180000
          ? "interrupted"
          : row.payload.status,
    };
  }
  const setupScope = z.object({offeringId: platformIdSchema("offering"), offerId: platformIdSchema("offer")});
  const setupInput = inputSchema.omit({requestKey:true}).extend({
    profileType: z.enum(["b2b", "b2c", "d2c"]).nullable(),
    examples: z.array(z.object({id:z.string().max(100),type:z.enum(["company","contact"]),reason:z.string().max(500),name:z.string().max(300)}).strict()).max(10),
  });
  return {
    read,
    async readSetup(identity: AuthenticatedUser, w: string, raw: unknown) {
      const scope=setupScope.parse(raw), db=await mongo.database();
      await icpAccess(db,config,identity,w,"read");
      const row=await db.collection("events").findOne({workspaceId:w,eventType:"icp_setup","payload.input.offeringId":scope.offeringId,"payload.input.offer.id":scope.offerId});
      return row ? {input:row.payload.input, revision:row.payload.revision} : null;
    },
    async saveSetup(identity: AuthenticatedUser,w:string,raw:unknown) {
      const value=z.object({input:setupInput,revision:z.number().int().nonnegative()}).strict().parse(raw);
      if(!value.input.offer) throw new HiveConflict("Select an offer before saving setup");
      if(!mongo.withTransaction) throw new Error("Transactions required");
      return mongo.withTransaction(async(db,session)=>{
        const actor=await icpAccess(db,config,identity,w,"create",session);
        const now=await lockIcpWorkspace(db,w,session);
        const filter={workspaceId:w,eventType:"icp_setup","payload.input.offeringId":value.input.offeringId,"payload.input.offer.id":value.input.offer!.id};
        const previous=await db.collection("events").findOne(filter,{session});
        if((previous?.payload.revision ?? 0)!==value.revision) throw new HiveConflict("Setup changed in another session. Reload before saving.");
        const payload={input:value.input,revision:value.revision+1};
        if(previous) await db.collection("events").updateOne({id:previous.id,workspaceId:w},{$set:{payload,updatedAt:now,updatedBy:actor}},{session});
        else await db.collection("events").insertOne(EventSchema.parse({id:generatePlatformId("event"),workspaceId:w,eventType:"icp_setup",payload,createdAt:now,updatedAt:now,occurredAt:now,createdBy:actor,updatedBy:actor}),{session});
        return payload;
      });
    },
    async latest(identity: AuthenticatedUser, w: string, raw: unknown) {
      const { offeringId, offerId } = z
        .object({
          offeringId: platformIdSchema("offering"),
          offerId: platformIdSchema("offer").optional(),
        })
        .strict()
        .parse(raw);
      const db = await mongo.database();
      await icpAccess(db, config, identity, w, "read");
      const rows = await db
        .collection("events")
        .find({
          workspaceId: w,
          eventType: "icp_generation",
          "payload.input.offeringId": offeringId,
          ...(offerId ? { "payload.input.offer.id": offerId } : {}),
        })
        .sort({ createdAt: -1, id: -1 })
        .limit(1)
        .toArray();
      return rows.length ? read(identity, w, rows[0]!.id) : null;
    },
    async save(
      identity: AuthenticatedUser,
      w: string,
      id: string,
      raw: unknown,
    ) {
      platformIdSchema("event").parse(id);
      const definition = IcpContentSchema.parse(raw);
      if (!mongo.withTransaction) throw new Error("Transactions required");
      return mongo.withTransaction(async (db, session) => {
        await icpAccess(db, config, identity, w, "create", session);
        await lockIcpWorkspace(db, w, session);
        const event = await db
          .collection("events")
          .findOne(
            { id, workspaceId: w, eventType: "icp_generation" },
            { session },
          );
        if (!event) throw new HiveConflict("Generation unavailable");
        if (event.payload.savedId) {
          if (event.payload.savedHash !== semanticHash(definition))
            throw new HiveConflict(
              "This draft was already saved; edit its saved profile",
            );
          return db
            .collection("ideal_customer_profiles")
            .findOne(
              { workspaceId: w, id: event.payload.savedId },
              { session },
            );
        }
        if (event.payload.status !== "review")
          throw new HiveConflict("Generation is not ready for review");
        const product = await db.collection("offerings").findOne(
          {
            workspaceId: w,
            id: event.payload.input.offeringId,
            archived: { $ne: true },
          },
          { session },
        );
        if (
          !product ||
          product.approvedRevision !== event.payload.productRevision
        )
          throw new HiveConflict(
            "Approved product changed; generate a new profile",
          );
        const offer = event.payload.input.offer;
        if (
          offer &&
          !(await db
            .collection("offers")
            .findOne(
              {
                workspaceId: w,
                id: offer.id,
                offeringId: product.id,
                archived: { $ne: true },
                approvedRevision: offer.revision,
              },
              { session },
            ))
        )
          throw new HiveConflict(
            "Approved offer changed; generate a new profile",
          );
        const generated = await db.collection("events").findOne(
          {
            workspaceId: w,
            id: event.payload.resultId,
            eventType: "icp_generation_result",
          },
          { session },
        );
        if (!generated) throw new HiveConflict("Generated result unavailable");
        const scopedMongo: MongoService = {
          ...mongo,
          database: async () => db,
          isAvailable: () => mongo.isAvailable(),
          close: () => mongo.close(),
          withTransaction: async (work) => work(db, session),
        };
        const row = await mutateHiveDefinition(
          scopedMongo,
          config,
          identity,
          w,
          "ideal_customer_profiles",
          "create",
          { offeringId: product.id, offer, definition },
          [
            {
              field: "description",
              value: generated.payload.definition.description,
              origin: "ai_inferred",
              provider: "openai",
              sourceReference: id,
              observedAt: event.createdAt.toISOString(),
              verification: "observed",
            },
          ],
        );
        await db.collection("events").updateOne(
          { id, workspaceId: w },
          {
            $set: {
              "payload.savedId": row.id,
              "payload.savedHash": semanticHash(definition),
              updatedAt: new Date(),
            },
          },
          { session },
        );
        return row;
      });
    },
    async examples(identity: AuthenticatedUser, w: string, raw: unknown) {
      const { q, type } = z
        .object({
          q: z.string().max(100).default(""),
          type: z.enum(["company", "contact"]),
        })
        .strict()
        .parse(raw);
      const db = await mongo.database();
      await icpAccess(db, config, identity, w, "read");
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const rows = await db
        .collection(type === "company" ? "organisations" : "people")
        .find({
          workspaceId: w,
          archived: { $ne: true },
          ...(type === "company"
            ? { "source.system": { $ne: ESOS_SUPPORTING_SOURCE } }
            : {}),
          ...(q
            ? {
                $or: (type === "company"
                  ? ["name"]
                  : ["displayName", "firstName", "lastName"]
                ).map((field) => ({
                  [field]: { $regex: escaped, $options: "i" },
                })),
              }
            : {}),
        })
        .sort({ id: 1 })
        .limit(30)
        .toArray();
      return rows.map((row) => ({
        id: row.id,
        name: row.name || row.displayName || row.firstName,
        type,
      }));
    },
    async start(identity: AuthenticatedUser, w: string, raw: unknown) {
      const input = inputSchema.parse(raw);
      if (!generate) throw new Error("Generation unavailable");
      if (!mongo.withTransaction) throw new Error("Transactions required");
      // Existing definition read enforces scope and provides the approved revision.
      const current = await readHiveDefinitions(
        mongo,
        config,
        identity,
        w,
        "offerings",
        {},
        input.offeringId,
      );
      if (!("approvedRevision" in current) || !current.approvedRevision)
        throw new HiveConflict("Approve the product before generation");
      const product = await readHiveDefinitions(
        mongo,
        config,
        identity,
        w,
        "offerings",
        {},
        input.offeringId,
        current.approvedRevision as number,
      );
      const offerNow = input.offer
        ? ((await readOfferFoundation(
            mongo,
            config,
            identity,
            w,
            "offers",
            {},
            input.offer.id,
          )) as Document)
        : undefined;
      if (
        input.offer &&
        (offerNow?.archived ||
          offerNow?.offeringId !== input.offeringId ||
          offerNow?.approvedRevision !== input.offer.revision)
      )
        throw new HiveConflict(
          "Select a current approved offer for this product",
        );
      const offerRevision = input.offer
        ? ((await readOfferFoundation(
            mongo,
            config,
            identity,
            w,
            "offers",
            {},
            input.offer.id,
            input.offer.revision,
          )) as Document)
        : undefined;
      const prepared = await mongo.withTransaction(async (db, session) => {
        const actor = await icpAccess(
          db,
          config,
          identity,
          w,
          "create",
          session,
        );
        const now = await lockIcpWorkspace(db, w, session);
        const productNow = await db
          .collection("offerings")
          .findOne(
            { workspaceId: w, id: input.offeringId, archived: { $ne: true } },
            { session },
          );
        if (
          !productNow ||
          productNow.approvedRevision !== current.approvedRevision
        )
          throw new HiveConflict("Product changed");
        const ledger = await db
          .collection("schema_versions")
          .findOne({ _id: "vapp-v1" } as Document, { session });
        if ([27, 28, 29, 30].includes(ledger?.version ?? 0) && !input.offer)
          throw new HiveConflict("Choose an approved offer for this profile");
        if (
          input.offer &&
          !(await db
            .collection("offers")
            .findOne(
              {
                workspaceId: w,
                id: input.offer.id,
                offeringId: input.offeringId,
                archived: { $ne: true },
                approvedRevision: input.offer.revision,
              },
              { session },
            ))
        )
          throw new HiveConflict("Approved offer changed");
        const previous = await db.collection("events").findOne(
          {
            workspaceId: w,
            eventType: "icp_generation",
            "payload.input.requestKey": input.requestKey,
          },
          { session },
        );
        if (previous) {
          if (JSON.stringify(previous.payload.input) !== JSON.stringify(input))
            throw new HiveConflict("Generation key reused");
          return { row: previous, fresh: false, examples: [] };
        }
        const active = await db.collection("events").findOne(
          {
            workspaceId: w,
            eventType: "icp_generation",
            "payload.status": "generating",
            createdAt: { $gte: new Date(Date.now() - 180000) },
          },
          { session },
        );
        if (active) throw new HiveConflict("A generation is already running");
        const examples = [];
        for (const example of input.examples) {
          const row = await db
            .collection(example.type === "company" ? "organisations" : "people")
            .findOne(
              {
                workspaceId: w,
                id: example.id,
                archived: { $ne: true },
                ...(example.type === "company"
                  ? { "source.system": { $ne: ESOS_SUPPORTING_SOURCE } }
                  : {}),
              },
              { session },
            );
          if (!row) throw new HiveConflict("Example unavailable");
          if (example.type === "company")
            examples.push({
              id: row.id,
              reason: example.reason,
              industry: row.industry,
              size: row.size,
              region: row.region,
              country: row.country,
              description: row.description,
              importedObservations: await importedFacts(
                db,
                w,
                row.id,
                session,
                Math.floor(12000 / Math.max(1, input.examples.length)),
              ),
            });
          else {
            if (input.profileType !== "b2b") {
              examples.push({
                id: row.id, reason: example.reason,
                importedContactObservations: await importedFacts(db, w, row.id, session, Math.floor(6000 / Math.max(1, input.examples.length)), "contact"),
              });
              continue;
            }
            const links = await db
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
              .limit(2)
              .toArray();
            if (links.length !== 1)
              throw new HiveConflict(
                "Select a company for contacts with missing or multiple current employers",
              );
            const company = await db.collection("organisations").findOne(
              {
                workspaceId: w,
                id: links[0]!.organisationId,
                archived: { $ne: true },
              },
              { session },
            );
            if (!company) throw new HiveConflict("Example company unavailable");
            examples.push({
              id: row.id,
              companyId: company.id,
              reason: example.reason,
              jobTitle: links[0]!.jobTitle,
              importedContactObservations: await importedFacts(
                db,
                w,
                row.id,
                session,
                Math.floor(6000 / Math.max(1, input.examples.length)),
                "contact",
              ),
              industry: company.industry,
              importedObservations: await importedFacts(
                db,
                w,
                company.id,
                session,
                Math.floor(6000 / Math.max(1, input.examples.length)),
              ),
              size: company.size,
              country: company.country,
              region: company.region,
              description: company.description,
            });
          }
        }
        const row = EventSchema.parse({
          id: generatePlatformId("event"),
          workspaceId: w,
          createdAt: now,
          updatedAt: now,
          occurredAt: now,
          createdBy: actor,
          updatedBy: actor,
          eventType: "icp_generation",
          payload: {
            input,
            status: "generating",
            productRevision: current.approvedRevision,
          },
        });
        await db.collection("events").insertOne(row, { session });
        return { row, fresh: true, examples };
      });
      if (prepared.fresh)
        void (async () => {
          const db = await mongo.database();
          let stage="context";
          try {
            const psu = createPsuApplication(config, mongo);
            const company =
              "brandId" in current && typeof current.brandId === "string"
                ? await psu.company(identity, w, current.brandId)
                : undefined;
            const references = await psu.referenceData(identity, w);
            const researchDocuments = await readResearchContext(db, w, input.researchDocuments);
            stage="generation";
            const result = await generate(
              {
                approvedBrandBrief:
                  "brandId" in current && typeof current.brandId === "string"
                    ? await readGenerationBrandBrief(
                        db,
                        config,
                        identity,
                        w,
                        current.brandId,
                      )
                    : null,
                profileType: input.profileType,
                instructions: input.instructions,
                customerUrls: input.customerUrls,
                company: company?.approved?.definition,
                references: {
                  industries: references.industries.map((row) => row.name),
                  regions: references.regions.map((row) => row.name),
                },
                product:
                  "snapshot" in product ? product.snapshot.definition : {},
                offer: offerRevision
                  ? {
                      ...input.offer,
                      definition: offerRevision.snapshot.definition,
                    }
                  : undefined,
                offerResearch: offerRevision?.designSnapshot?.work.stages ?? [],
                examples: prepared.examples,
                researchDocuments,
                sharedResearch:await reviewedResearchContext(db,w,String("brandId" in current?current.brandId:""),[current.id,...(input.offer?[input.offer.id]:[])]),
              },
              AbortSignal.timeout(120000),
            );
            stage="persistence";
            if (!mongo.withTransaction)
              throw new Error("Transactions required");
            await mongo.withTransaction(async (db, session) => {
              await lockIcpWorkspace(db, w, session);
              const current = await db.collection("events").findOne(
                {
                  id: prepared.row.id,
                  workspaceId: w,
                  "payload.status": "generating",
                },
                { session },
              );
              if (!current) return;
              const now = new Date();
              const resultRow = EventSchema.parse({
                id: generatePlatformId("event"),
                workspaceId: w,
                createdAt: now,
                updatedAt: now,
                occurredAt: now,
                createdBy: prepared.row.createdBy,
                updatedBy: prepared.row.createdBy,
                eventType: "icp_generation_result",
                payload: { generationId: prepared.row.id, ...result },
              });
              await db.collection("events").insertOne(resultRow, { session });
              await db.collection("events").updateOne(
                {
                  id: prepared.row.id,
                  workspaceId: w,
                  "payload.status": "generating",
                },
                {
                  $set: {
                    "payload.status": "review",
                    "payload.resultId": resultRow.id,
                    updatedAt: now,
                  },
                },
                { session },
              );
            });
          } catch (error) {
            const allowed=["Context too large","Generation unavailable","Invalid generated result","Customer website unavailable","Invalid profile type"];
            const code=error instanceof Error && allowed.includes(error.message) ? error.message : error instanceof z.ZodError ? "Invalid response structure" : error instanceof Error && /timeout|abort/i.test(error.name) ? "Generation timed out" : "Generation failed";
            await db.collection("events").updateOne(
              {
                id: prepared.row.id,
                workspaceId: w,
                "payload.status": "generating",
              },
              { $set: { "payload.status": "failed", "payload.failure": {stage:error instanceof IcpGenerationError?error.stage:stage,code:error instanceof IcpGenerationError?error.code:code,correlationId:prepared.row.id}, updatedAt: new Date() } },
            );
          }
        })().catch(() => {
          /* Durable requested state becomes interrupted after timeout. */
        });
      return read(identity, w, prepared.row.id);
    },
  };
}
