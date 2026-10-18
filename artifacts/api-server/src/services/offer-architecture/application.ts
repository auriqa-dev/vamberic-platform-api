import { reviewedResearchContext } from "../research/evidence-context";
import { contentAccess } from "../content-strategy/application";
import { offerOutput, outputAsset, registerOfferOutput } from "./output";
import { createHash } from "node:crypto";
import { recordReviewChanges, readReviewHistory } from "./review-history";
import { proposalGroups } from "./review-proposals";
import {
  safeOfferFailure,
  OfferIncompleteError,
  type OfferDiagnostic,
  type OfferObserver,
  type OfferStage,
} from "./diagnostics";
import { researchSelection, readResearchContext } from "../research/context";
import { OfferBriefInterpretationSchema } from "./brief-schema";
import { generationBrandBrief } from "../generation-guidance";
import { z } from "zod";
import type { Document, Db, ClientSession } from "mongodb";
import type { AppConfig } from "../../config";
import type { MongoService } from "../mongo";
import type { AuthenticatedUser } from "../../middlewares/auth";
import {
  EventSchema,
  generatePlatformId,
  platformIdSchema,
} from "../../domain";
import { OfferContentSchema, OfferDesignWorkSchema } from "../../domain/offers";
import {
  listOfferMethodologies,
  getOfferMethodology,
} from "../../domain/offer-methodologies";
import {
  offerAuthority,
  readOfferFoundation,
  mutateOfferFoundation,
  OfferConflict,
} from "../offers";
import { readHiveDefinitions } from "../hive-definitions";
import { lockIcpWorkspace } from "../icp/access";
import { createPsuApplication } from "../psu/application";
import { resolveHvmContext } from "../hvm-context";
import { readApprovedBrandContext } from "../brand-context";
import type { OfferGenerator, OfferGenerationResult } from "./generate";
import { briefKeys } from "./generate";
const selection = z
  .object({
    offeringId: platformIdSchema("offering"),
    targetIcpIds: z.array(platformIdSchema("icp")).max(20).default([]),
    targetBuyerProfileIds: z
      .array(platformIdSchema("buyerprofile"))
      .max(20)
      .default([]),
  })
  .strict();
const startSchema = selection
  .extend({
    methodology: z
      .object({
        id: platformIdSchema("offermethodology"),
        version: z.number().int().positive(),
      })
      .strict()
      .optional(),
    requestKey: z.string().uuid(),
    briefId: platformIdSchema("event").optional(),
    briefOfferIndex: z.number().int().min(0).max(4).optional(),
    allowCommercialChanges: z.boolean().default(false),
    useCustomerPatterns: z.boolean().default(true),
    researchDocuments: researchSelection.optional(),
    instructions: z.string().max(4000),
    sourceUrls: z
      .array(
        z
          .string()
          .url()
          .max(2048)
          .refine((x) => x.startsWith("https://")),
      )
      .max(6)
      .default([]),
  })
  .strict();
const saveSchema = z
  .object({
    id: platformIdSchema("offer"),
    expectedUpdatedAt: z.string().datetime(),
    designId: platformIdSchema("offerdesign"),
    expectedDesignUpdatedAt: z.string().datetime(),
    definition: OfferContentSchema,
    work: OfferDesignWorkSchema,
  })
  .strict();
export function generationWork(
  result: OfferGenerationResult,
  targets: z.infer<typeof selection>,
) {
  const evidence = result.sources.map((s, i) => ({
    key: `source_${i}`,
    kind: "external_evidence" as const,
    reference: s.url,
    observedAt: s.observedAt,
  }));
  return OfferDesignWorkSchema.parse({
    name: result.draft.definition.name,
    targetIcpIds: targets.targetIcpIds,
    targetBuyerProfileIds: targets.targetBuyerProfileIds,
    currentStageKey: result.draft.stages[0]?.stageKey,
    completedStageKeys: [],
    stages: result.draft.stages.map((s) => ({
      stageKey: s.stageKey,
      status: "in_progress",
      notes: [
        s.summary,
        ...(s.stageKey === result.draft.stages[0]?.stageKey
          ? result.limitations
          : []),
      ],
      unknowns: [
        ...new Set([
          ...s.questions,
          ...(s.proposals ?? []).map((p) => p.question),
        ]),
      ],
      evidence,
      groups: [
        ...proposalGroups(s.proposals ?? []),
        ...(s.stageKey === result.draft.stages[0]?.stageKey
          ? briefKeys.map((key) => ({
              key,
              name: key.replaceAll("_", " "),
              items: result.draft.researchBrief[key],
            }))
          : []),
      ],
    })),
    ...(result.draft.competitors.length
      ? {
          competitiveAnalysis: {
            researchedAt: new Date().toISOString(),
            scope: "Public-source offer research",
            findings: result.draft.competitors.map((c, i) => ({
              key: `comparison_${i}`,
              identity: c.identity,
              kind: c.kind,
              sources: c.sourceIndexes.map((n) => evidence[n]),
              relevance: c.relevance,
              positioning: c.positioning,
              strengths: c.strengths,
              weaknessesGaps: c.weaknessesGaps,
            })),
            selectedPositioning:
              result.draft.definition.competitivePositioning ||
              result.draft.definition.valueProposition,
            limitations: [
              "AI-assisted comparison of retrieved public sources; review before approval.",
              ...result.limitations,
            ],
          },
        }
      : {}),
  });
}
async function contextChanged(
  db: Db,
  w: string,
  refs: Document | undefined,
  session?: ClientSession,
) {
  if (!refs?.brandId) return false;
  const approvals = await db
    .collection("events")
    .find(
      {
        workspaceId: w,
        eventType: "psu_company_approved",
        "payload.brandId": refs.brandId,
      },
      { session },
    )
    .sort({ createdAt: -1, id: -1 })
    .limit(1)
    .toArray();
  const kits = await db
    .collection("brand_kits")
    .find(
      {
        workspaceId: w,
        brandId: refs.brandId,
        status: "approved",
        archived: { $ne: true },
      },
      { session },
    )
    .limit(2)
    .toArray();
  return (
    (approvals[0]?.payload.versionId ?? null) !== refs.companyVersionId ||
    kits.length > 1 ||
    (kits[0]?.id ?? null) !== refs.brandKitId ||
    (kits[0]?.updatedAt?.toISOString() ?? null) !== refs.brandRevision
  );
}
export function createOfferArchitecture(
  config: AppConfig,
  mongo: MongoService,
  generate?: OfferGenerator,
) {
  async function sources(
    identity: AuthenticatedUser,
    w: string,
    input: z.infer<typeof selection>,
  ) {
    const refs: Document[] = [];
    const snapshots: Document[] = [];
    for (const [kind, ids] of [
      ["offerings", [input.offeringId]],
      ["ideal_customer_profiles", input.targetIcpIds],
      ["buyer_profiles", input.targetBuyerProfileIds],
    ] as const) {
      for (const id of ids) {
        const current = (await readHiveDefinitions(
          mongo,
          config,
          identity,
          w,
          kind,
          {},
          id,
        )) as Document;
        if (current.archived || !current.approvedRevision)
          throw new OfferConflict(
            "Approve the selected product and customer profiles first",
          );
        if (kind !== "offerings" && current.offeringId !== input.offeringId)
          throw new OfferConflict("Select profiles for this product");
        if (
          kind === "buyer_profiles" &&
          !input.targetIcpIds.includes(current.idealCustomerProfileId)
        )
          throw new OfferConflict("Select the buyer's customer profile");
        const revision = (await readHiveDefinitions(
          mongo,
          config,
          identity,
          w,
          kind,
          {},
          id,
          current.approvedRevision,
        )) as Document;
        refs.push({ kind, id, revision: current.approvedRevision });
        snapshots.push({
          kind,
          id,
          definition: revision.snapshot.definition,
          brandId: current.brandId,
        });
      }
    }
    return { refs, snapshots };
  }
  async function read(identity: AuthenticatedUser, w: string, id: string) {
    platformIdSchema("event").parse(id);
    const db = await mongo.database();
    await offerAuthority(db, config, identity, w, "offers", "read");
    const e = await db
      .collection("events")
      .findOne({ workspaceId: w, id, eventType: "offer_generation" });
    if (!e) throw new OfferConflict("Generation not found");
    return {
      id: e.id,
      ...e.payload,
      status:
        e.payload.status === "generating" &&
        Date.now() - e.createdAt.getTime() > 360000
          ? "interrupted"
          : e.payload.status,
    };
  }
  async function bundle(identity: AuthenticatedUser, w: string, id: string) {
    const offer = (await readOfferFoundation(
      mongo,
      config,
      identity,
      w,
      "offers",
      {},
      id,
    )) as Document;
    const design = offer.offerDesignId
      ? await readOfferFoundation(
          mongo,
          config,
          identity,
          w,
          "offer_designs",
          {},
          offer.offerDesignId,
        )
      : null;
    const db = await mongo.database();
    const [generation] = await db
      .collection("events")
      .find({
        workspaceId: w,
        eventType: "offer_generation",
        "payload.offerId": id,
        "payload.status": "complete",
      })
      .sort({ createdAt: -1, id: -1 })
      .limit(1)
      .toArray();
    const current = await sources(identity, w, {
      offeringId: offer.offeringId,
      targetIcpIds: offer.definition.targetIcpIds,
      targetBuyerProfileIds: offer.definition.targetBuyerProfileIds,
    }).catch(() => null);
    const libraryOutput = (await outputAsset(db, w, id))?.payload.record;
    return {
      offer,
      design,
      reviewHistory: await readReviewHistory(db, w, id),
      output: {
        ...offerOutput(offer, design as Document | null),
        assetId:
          libraryOutput?.status !== "removed"
            ? (libraryOutput?.id ?? null)
            : null,
      },
      sourceChanged:
        !!generation &&
        (!current ||
          (await contextChanged(db, w, generation.payload.contextRefs)) ||
          JSON.stringify(current.refs) !==
            JSON.stringify(generation.payload.sources)),
      sourceReferences: generation?.payload.sources ?? [],
      ...(generation?.payload.refinement
        ? {
            refinement: {
              generationId: generation.id,
              previousDefinition:
                generation.payload.refinement.previousOffer.definition,
              proposedWork: generation.payload.refinement.proposedWork,
              commercialChangesAuthorised:
                generation.payload.refinement.commercialChangesAuthorised,
            },
          }
        : {}),
    };
  }
  return {
    read,
    bundle,
    async approvedBrief(identity: AuthenticatedUser, w: string, id: string) {
      const current = (await readOfferFoundation(
        mongo,
        config,
        identity,
        w,
        "offers",
        {},
        id,
      )) as Document;
      if (current.archived || !current.approvedRevision)
        throw new OfferConflict("No active approved offer");
      const revision = (await readOfferFoundation(
        mongo,
        config,
        identity,
        w,
        "offers",
        {},
        id,
        current.approvedRevision,
      )) as Document;
      const product = (await readHiveDefinitions(
        mongo,
        config,
        identity,
        w,
        "offerings",
        {},
        current.offeringId,
      )) as Document;
      const db = await mongo.database();
      const resolved = await resolveHvmContext(db, config, identity);
      const brand = product.brandId
        ? await readApprovedBrandContext(
            db,
            resolved.authority,
            resolved.context,
            w,
            product.brandId,
            "interaction",
          )
        : null;
      return {
        offerId: id,
        revision: current.approvedRevision,
        definition: revision.snapshot.definition,
        researchBrief:
          revision.designSnapshot?.work.stages.flatMap(
            (s: Document) => s.groups,
          ) ?? [],
        decisionContext: revision.designSnapshot?.work.stages ?? [],
        brand,
        marketingEnabled: false,
      };
    },
    async permissions(identity: AuthenticatedUser, w: string) {
      const db = await mongo.database();
      await offerAuthority(db, config, identity, w, "offers", "read");
      const allowed = async (action: "create" | "update" | "approve") => {
        try {
          await offerAuthority(db, config, identity, w, "offers", action);
          await offerAuthority(
            db,
            config,
            identity,
            w,
            "offer_designs",
            action,
          );
          return true;
        } catch {
          return false;
        }
      };
      return {
        canCreate: await allowed("create"),
        canUpdate: await allowed("update"),
        canApprove: await allowed("approve"),
        generationAvailable: !!generate,
      };
    },
    async latest(identity: AuthenticatedUser, w: string, offeringId: string) {
      platformIdSchema("offering").parse(offeringId);
      const db = await mongo.database();
      await offerAuthority(db, config, identity, w, "offers", "read");
      const rows = await db
        .collection("events")
        .find({
          workspaceId: w,
          eventType: "offer_generation",
          "payload.input.offeringId": offeringId,
        })
        .sort({ createdAt: -1, id: -1 })
        .limit(1)
        .toArray();
      return rows[0] ? read(identity, w, rows[0].id) : null;
    },
    async start(identity: AuthenticatedUser, w: string, raw: unknown) {
      const input = startSchema.parse(raw);
      if (!generate || !mongo.withTransaction)
        throw new Error("Offer generation unavailable");
      const db = await mongo.database();
      await offerAuthority(db, config, identity, w, "offers", "create");
      await offerAuthority(db, config, identity, w, "offer_designs", "create");
      if (!input.targetIcpIds.length) {
        const ledger = await db
          .collection("schema_versions")
          .findOne({ _id: "vapp-v1" } as Document);
        if (![27, 28, 29, 30].includes(ledger?.version ?? 0))
          throw new OfferConflict(
            "Offer-first creation requires the reviewed schema v27 update",
          );
      }
      const sequenceLedger = await db
        .collection("schema_versions")
        .findOne({ _id: "vapp-v1" } as Document);
      if (
        [27, 28, 29, 30].includes(sequenceLedger?.version ?? 0) &&
        !input.briefId
      )
        throw new OfferConflict("Confirm the offer brief before generation");
      let confirmedBrief: Document | undefined;
      let existingOffer: Document | undefined;
      let approvedMethod: { id: string; version: number } | undefined;
      let methodologyBriefUpdatedAt: Date | undefined;
      if (input.briefId) {
        const brief = await db.collection("events").findOne({
          workspaceId: w,
          id: input.briefId,
          eventType: "offer_brief",
          "payload.status": "confirmed",
          "payload.input.offeringId": input.offeringId,
        });
        const interpretation = OfferBriefInterpretationSchema.parse(
          brief?.payload.interpretation,
        );
        const selected = interpretation.offers[input.briefOfferIndex ?? -1];
        if (!brief || !selected)
          throw new OfferConflict("Confirm the offer brief first");
        const approval =
          brief.payload.methodologyApprovals?.[String(input.briefOfferIndex)];
        if (
          brief.payload.requiresMethodologyApproval ||
          approval ||
          input.methodology
        ) {
          const hash = createHash("sha256")
            .update(
              JSON.stringify({
                existingOfferId: selected.existingOfferId,
                brief: selected.brief,
              }),
            )
            .digest("hex");
          if (!approval || approval.briefHash !== hash)
            throw new OfferConflict(
              "Approve a methodology for this offer first",
            );
          approvedMethod = { id: approval.id, version: approval.version };
          methodologyBriefUpdatedAt = brief.updatedAt;
          if (
            input.methodology &&
            (input.methodology.id !== approval.id ||
              input.methodology.version !== approval.version)
          )
            throw new OfferConflict(
              "Methodology differs from this offer’s approved choice",
            );
        }
        if (selected.existingOfferId) {
          existingOffer = (await readOfferFoundation(
            mongo,
            config,
            identity,
            w,
            "offers",
            {},
            selected.existingOfferId,
          )) as Document;
          const prior = brief.payload.existingOffers.find(
            (row: Document) => row.id === selected.existingOfferId,
          );
          if (!prior || existingOffer.offeringId !== input.offeringId)
            throw new OfferConflict("Existing offer does not match this brief");
          // An archived test design is historical context, not a refinement target.
          // Keep the confirmed brief and methodology hash intact; create a new draft.
          if (existingOffer.archived || existingOffer.status === "retired") {
            existingOffer = undefined;
          } else {
            if (
              existingOffer.updatedAt.toISOString() !== prior.updatedAt ||
              !existingOffer.offerDesignId
            )
              throw new OfferConflict(
                "Existing offer changed; prepare the brief again",
              );
            await offerAuthority(db, config, identity, w, "offers", "update");
            await offerAuthority(
              db,
              config,
              identity,
              w,
              "offer_designs",
              "update",
            );
          }
        }
        confirmedBrief = {
          briefId: brief.id,
          productRevision: brief.payload.productRevision,
          brief: selected.brief,
          ...(approvedMethod ? { methodology: approvedMethod } : {}),
        };
      } else if (input.briefOfferIndex !== undefined)
        throw new OfferConflict("Brief is required");
      const existingDesign = existingOffer?.offerDesignId
        ? await db
            .collection("offer_designs")
            .findOne({ workspaceId: w, id: existingOffer.offerDesignId })
        : null;
      const methodRef =
        approvedMethod ??
        (existingDesign
          ? {
              id: existingDesign.methodologyId,
              version: existingDesign.methodologyVersion,
            }
          : input.methodology);
      const replacingDesign =
        !!existingDesign &&
        !!approvedMethod &&
        (approvedMethod.id !== existingDesign.methodologyId ||
          approvedMethod.version !== existingDesign.methodologyVersion);
      const method = methodRef
        ? getOfferMethodology(methodRef.id, methodRef.version)
        : listOfferMethodologies()[0]!;
      if (!method || method.status !== "active")
        throw new OfferConflict("Active methodology version required");
      if (
        (!existingDesign || replacingDesign) &&
        method.key !== "value_equation"
      ) {
        const availability = await db
          .collection("methodology_availability")
          .findOne({
            "data.methodology.id": method.id,
            "data.methodology.version": method.version,
            status: "active",
            archived: false,
            availability: "queens",
          });
        if (!availability)
          throw new OfferConflict(
            "Methodology is not published for this workspace",
          );
      }
      const source = await sources(identity, w, input);
      const researchDocuments = await readResearchContext(
        db,
        w,
        input.researchDocuments,
      );
      if (
        confirmedBrief &&
        source.refs.find((r) => r.kind === "offerings")?.revision !==
          confirmedBrief.productRevision
      )
        throw new OfferConflict("Product changed; prepare the brief again");
      const product = source.snapshots.find((s) => s.kind === "offerings")!;
      const psu = createPsuApplication(config, mongo);
      const company = product.brandId
        ? await psu.company(identity, w, product.brandId)
        : null;
      const resolved = await resolveHvmContext(db, config, identity);
      const brand = product.brandId
        ? await readApprovedBrandContext(
            db,
            resolved.authority,
            resolved.context,
            w,
            product.brandId,
            "website",
          )
        : null;
      let customerPatterns: unknown = null;
      if (input.useCustomerPatterns) {
        resolved.authority.scopeFilter(resolved.context, "read", {
          type: "organisations",
          workspaceId: w,
        });
        const records = await db
          .collection("organisations")
          .find(
            { workspaceId: w, type: "customer", archived: { $ne: true } },
            { projection: { industry: 1, country: 1, region: 1, _id: 0 } },
          )
          .sort({ id: 1 })
          .limit(101)
          .toArray();
        const sample = records.slice(0, 100);
        const counts = (key: string) =>
          Object.entries(
            sample.reduce<Record<string, number>>((a, r) => {
              if (typeof r[key] === "string" && r[key].trim())
                a[r[key]] = (a[r[key]] ?? 0) + 1;
              return a;
            }, {}),
          ).map(([value, count]) => ({ value, count }));
        customerPatterns = {
          sampleCount: sample.length,
          sampled: records.length > 100,
          selection:
            "First 100 active customer organisations by stable ID; not a representative sample or market estimate",
          industries: counts("industry"),
          countries: counts("country"),
          regions: counts("region"),
        };
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
        await offerAuthority(
          db,
          config,
          identity,
          w,
          "offer_designs",
          "create",
          session,
        );
        const now = await lockIcpWorkspace(db, w, session);
        // A completed event is historical evidence, not proof its offer is still usable.
        const reusable = async (event: Document) => {
          if (event.payload.status !== "complete") return true;
          return Boolean(
            await db.collection("offers").findOne(
              {
                workspaceId: w,
                id: event.payload.offerId,
                offeringId: input.offeringId,
                archived: { $ne: true },
                status: { $ne: "retired" },
              },
              { session },
            ),
          );
        };
        const previous = await db.collection("events").findOne(
          {
            workspaceId: w,
            eventType: "offer_generation",
            "payload.input.requestKey": input.requestKey,
          },
          { session },
        );
        if (previous) {
          if (JSON.stringify(previous.payload.input) !== JSON.stringify(input))
            throw new OfferConflict("Generation key reused");
          if (!(await reusable(previous)))
            throw new OfferConflict(
              "The previous result was archived or retired. Start a new generation request from the saved brief.",
            );
          return { row: previous, fresh: false };
        }
        if (input.briefId) {
          if (
            methodologyBriefUpdatedAt &&
            !(await db.collection("events").findOne(
              {
                id: input.briefId,
                workspaceId: w,
                updatedAt: methodologyBriefUpdatedAt,
              },
              { session },
            ))
          )
            throw new OfferConflict(
              "Offer methodology changed; reload before generating",
            );
          const generations = await db
            .collection("events")
            .find(
              {
                workspaceId: w,
                eventType: "offer_generation",
                "payload.input.briefId": input.briefId,
                "payload.input.briefOfferIndex": input.briefOfferIndex,
                "payload.status": { $in: ["generating", "complete"] },
              },
              { session },
            )
            .sort({ createdAt: -1 })
            .toArray();
          // Check in-flight work first, including when an older result was archived.
          const inFlight = generations.find(
            (event) => event.payload.status === "generating",
          );
          if (inFlight) return { row: inFlight, fresh: false };
          for (const generated of generations) {
            if (await reusable(generated))
              return { row: generated, fresh: false };
          }
        }
        const active = await db.collection("events").findOne(
          {
            workspaceId: w,
            eventType: "offer_generation",
            "payload.status": "generating",
            createdAt: { $gt: new Date(Date.now() - 360000) },
          },
          { session },
        );
        if (active)
          throw new OfferConflict("An offer is already being generated");
        const row = EventSchema.parse({
          id: generatePlatformId("event"),
          workspaceId: w,
          createdAt: now,
          updatedAt: now,
          occurredAt: now,
          actor,
          eventType: "offer_generation",
          payload: {
            input,
            sources: source.refs,
            status: "generating",
            ...(customerPatterns ? { customerPatterns } : {}),
            contextRefs: {
              brandId: product.brandId ?? null,
              companyVersionId: company?.approved?.versionId ?? null,
              brandKitId: brand?.kitId ?? null,
              brandRevision: brand?.revision ?? null,
            },
          },
        });
        await db.collection("events").insertOne(row, { session });
        return { row, fresh: true };
      });
      if (prepared.fresh)
        void (async () => {
          const started = Date.now();
          let stage: OfferStage = "starting";
          const diagnostics: OfferDiagnostic[] = [];
          const observe: OfferObserver = async (entry) => {
            stage = entry.stage;
            diagnostics.push(entry);
            try {
              await db.collection("events").updateOne(
                {
                  workspaceId: w,
                  id: prepared.row.id,
                  "payload.status": "generating",
                },
                { $set: { "payload.diagnostics": diagnostics.slice(-24) } },
              );
            } catch {
              // Metadata only: also retain a correlation point if Mongo is unavailable.
              console.warn(
                JSON.stringify({
                  event: "offer_diagnostic_write_failed",
                  generationId: prepared.row.id,
                  stage,
                }),
              );
            }
          };
          await observe({ stage, outcome: "started", elapsedMs: 0 });
          try {
            const result = await generate(
              {
                approvedBrandBrief: generationBrandBrief(brand),
                context: {
                  sharedResearch: await reviewedResearchContext(
                    db,
                    w,
                    String(product.brandId ?? ""),
                    [
                      input.offeringId,
                      ...(existingOffer ? [existingOffer.id] : []),
                      ...input.targetIcpIds,
                    ],
                  ),
                  sources: source.snapshots,
                  confirmedBrief,
                  existingOffer: existingOffer?.definition,
                  ...(replacingDesign
                    ? {
                        previousDesignContext: existingDesign?.work,
                        previousMethodology: {
                          id: existingDesign?.methodologyId,
                          version: existingDesign?.methodologyVersion,
                        },
                        methodologyChange:
                          "Use old decisions and evidence as context only; no previous completion or approval carries into this new methodology.",
                      }
                    : {}),
                  preserveCommercialTerms: !input.allowCommercialChanges,
                  company: company?.approved?.definition,
                  customerPatterns,
                  researchDocuments,
                },
                methodology: { id: method.id, version: method.version },
                researchContext: {
                  name: product.definition.name,
                  description: product.definition.description,
                  website: company?.approved?.definition.websiteUrl,
                },
                instructions: input.instructions,
                sourceUrls: input.sourceUrls,
                targetIcpIds: input.targetIcpIds,
                targetBuyerProfileIds: input.targetBuyerProfileIds,
              },
              AbortSignal.timeout(300000),
              observe,
            );
            await observe({
              stage: "design",
              outcome: "started",
              elapsedMs: Date.now() - started,
            });
            const work = generationWork(result, input);

            await observe({
              stage: "persistence",
              outcome: "started",
              elapsedMs: Date.now() - started,
            });
            await mongo.withTransaction!(async (db, session) => {
              await lockIcpWorkspace(db, w, session);
              await offerAuthority(
                db,
                config,
                identity,
                w,
                "offers",
                "create",
                session,
              );
              await offerAuthority(
                db,
                config,
                identity,
                w,
                "offer_designs",
                "create",
                session,
              );
              const event = await db.collection("events").findOne(
                {
                  workspaceId: w,
                  id: prepared.row.id,
                  "payload.status": "generating",
                },
                { session },
              );
              if (!event) return;
              if (
                await contextChanged(db, w, event.payload.contextRefs, session)
              )
                throw new OfferConflict(
                  "Brand or company changed during generation",
                );
              if (Date.now() - event.createdAt.getTime() > 360000)
                throw new OfferConflict("Generation expired");
              for (const ref of source.refs) {
                const row = await db
                  .collection(ref.kind)
                  .findOne(
                    { workspaceId: w, id: ref.id, archived: false },
                    { session },
                  );
                if (row?.approvedRevision !== ref.revision)
                  throw new OfferConflict("Source changed during generation");
              }
              const scoped: MongoService = {
                ...mongo,
                database: async () => db,
                isAvailable: () => mongo.isAvailable(),
                close: () => mongo.close(),
                withTransaction: async (fn) => fn(db, session),
              };
              let offer: Document;
              if (existingOffer) {
                let current: Document | null = await db
                  .collection("offers")
                  .findOne(
                    { workspaceId: w, id: existingOffer.id, archived: false },
                    { session },
                  );
                let design: Document | null = await db
                  .collection("offer_designs")
                  .findOne(
                    {
                      workspaceId: w,
                      id: existingOffer.offerDesignId,
                      archived: false,
                    },
                    { session },
                  );
                if (
                  !current ||
                  !design ||
                  design.updatedAt.toISOString() !==
                    existingDesign?.updatedAt.toISOString() ||
                  current.updatedAt.toISOString() !==
                    existingOffer.updatedAt.toISOString()
                )
                  throw new OfferConflict(
                    "Offer changed during refinement; your saved content is unchanged",
                  );
                if (
                  !replacingDesign &&
                  ["completed", "ready_for_review"].includes(design.status)
                )
                  design = await mutateOfferFoundation(
                    scoped,
                    config,
                    identity,
                    w,
                    "offer_designs",
                    "reopen",
                    {
                      id: design.id,
                      expectedUpdatedAt: design.updatedAt.toISOString(),
                    },
                  );
                if (current.status === "approved")
                  current = await mutateOfferFoundation(
                    scoped,
                    config,
                    identity,
                    w,
                    "offers",
                    "revise",
                    {
                      id: current.id,
                      expectedUpdatedAt: current.updatedAt.toISOString(),
                    },
                  );
                let replacementDesign: Document | undefined;
                if (replacingDesign) {
                  replacementDesign = await mutateOfferFoundation(
                    scoped,
                    config,
                    identity,
                    w,
                    "offer_designs",
                    "create",
                    {
                      offeringId: input.offeringId,
                      methodologyId: method.id,
                      methodologyVersion: method.version,
                      work,
                    },
                  );
                } else {
                  // Preserve all accumulated research/evidence and decisions. Refinement
                  // invalidates stage sign-off, not the underlying work or audit history.
                  await mutateOfferFoundation(
                    scoped,
                    config,
                    identity,
                    w,
                    "offer_designs",
                    "update",
                    {
                      id: design.id,
                      expectedUpdatedAt: design.updatedAt.toISOString(),
                      work: {
                        ...design.work,
                        completedStageKeys: [],
                        stages: design.work.stages.map((stage: Document) => ({
                          ...stage,
                          status: "in_progress",
                        })),
                      },
                    },
                  );
                }
                const messaging = [
                  "headlineProposition",
                  "valueProposition",
                  "differentiators",
                  "whyChooseThisOffer",
                  "competitivePositioning",
                ];
                const definition = input.allowCommercialChanges
                  ? {
                      ...result.draft.definition,
                      name: current.definition.name,
                      targetIcpIds: current.definition.targetIcpIds,
                      targetBuyerProfileIds:
                        current.definition.targetBuyerProfileIds,
                    }
                  : {
                      ...current.definition,
                      ...Object.fromEntries(
                        messaging
                          .filter(
                            (key) =>
                              result.draft.definition[
                                key as keyof typeof result.draft.definition
                              ] !== undefined,
                          )
                          .map((key) => [
                            key,
                            result.draft.definition[
                              key as keyof typeof result.draft.definition
                            ],
                          ]),
                      ),
                    };
                offer = await mutateOfferFoundation(
                  scoped,
                  config,
                  identity,
                  w,
                  "offers",
                  "update",
                  {
                    id: current.id,
                    expectedUpdatedAt: current.updatedAt.toISOString(),
                    definition,
                    ...(!replacementDesign && current.competitiveAnalysis
                      ? { competitiveAnalysis: current.competitiveAnalysis }
                      : {}),
                  },
                  replacementDesign?.id,
                );
                await db.collection("events").updateOne(
                  { workspaceId: w, id: prepared.row.id },
                  {
                    $set: {
                      "payload.refinement": {
                        previousOffer: existingOffer,
                        previousDesignId: design.id,
                        ...(replacementDesign
                          ? {
                              replacementDesignId: replacementDesign.id,
                              methodologyApproval: approvedMethod,
                            }
                          : {}),
                        proposedWork: work,
                        commercialChangesAuthorised:
                          input.allowCommercialChanges,
                      },
                    },
                  },
                  { session },
                );
              } else {
                const design = await mutateOfferFoundation(
                  scoped,
                  config,
                  identity,
                  w,
                  "offer_designs",
                  "create",
                  {
                    offeringId: input.offeringId,
                    methodologyId: method.id,
                    methodologyVersion: method.version,
                    work,
                  },
                );
                offer = await mutateOfferFoundation(
                  scoped,
                  config,
                  identity,
                  w,
                  "offers",
                  "create",
                  {
                    offeringId: input.offeringId,
                    offerDesignId: design.id,
                    definition: result.draft.definition,
                  },
                );
              }
              await db.collection("events").updateOne(
                {
                  workspaceId: w,
                  id: prepared.row.id,
                  "payload.status": "generating",
                },
                {
                  $set: {
                    "payload.status": "complete",
                    "payload.diagnostics": [
                      ...diagnostics,
                      {
                        stage: "persistence",
                        outcome: "complete",
                        elapsedMs: Date.now() - started,
                      },
                    ].slice(-24),
                    "payload.offerId": offer.id,
                    "payload.usage": result.usage,
                    ...(result.researchUsage
                      ? { "payload.researchUsage": result.researchUsage }
                      : {}),
                    "payload.limitations": result.limitations,
                    updatedAt: new Date(),
                  },
                },
                { session },
              );
            });
          } catch (error) {
            const failure: OfferDiagnostic = {
              stage,
              outcome: "failed",
              elapsedMs: Date.now() - started,
              ...safeOfferFailure(error),
            };
            await observe(failure);
            console.warn(
              JSON.stringify({
                event: "offer_generation_failed",
                generationId: prepared.row.id,
                ...failure,
              }),
            );
            await db.collection("events").updateOne(
              {
                workspaceId: w,
                id: prepared.row.id,
                "payload.status": "generating",
              },
              {
                $set: {
                  "payload.status": "failed",
                  ...(error instanceof OfferIncompleteError && error.usage
                    ? { "payload.usage": error.usage }
                    : {}),
                  updatedAt: new Date(),
                },
              },
            );
          }
        })().catch(() => {
          /* Requested state becomes interrupted after deadline. */
        });
      return read(identity, w, prepared.row.id);
    },
    async registerOutput(identity: AuthenticatedUser, w: string, raw: unknown) {
      const input = z
        .object({
          id: platformIdSchema("offer"),
          expectedUpdatedAt: z.string().datetime(),
          expectedDesignUpdatedAt: z.string().datetime(),
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
          "update",
          session,
        );
        await contentAccess(db, config, identity, w, "update", session);
        const now = await lockIcpWorkspace(db, w, session);
        const offer = await db
          .collection("offers")
          .findOne(
            { workspaceId: w, id: input.id, archived: false },
            { session },
          );
        const design =
          offer &&
          (await db
            .collection("offer_designs")
            .findOne(
              { workspaceId: w, id: offer.offerDesignId, archived: false },
              { session },
            ));
        if (
          !offer ||
          !design ||
          offer.updatedAt.toISOString() !== input.expectedUpdatedAt ||
          design.updatedAt.toISOString() !== input.expectedDesignUpdatedAt
        )
          throw new OfferConflict(
            "Offer changed; reload before registering its output",
          );
        await registerOfferOutput(db, session, w, offer, design, actor, now);
      });
      return bundle(identity, w, input.id);
    },
    async save(identity: AuthenticatedUser, w: string, raw: unknown) {
      const input = saveSchema.parse(raw);
      if (!mongo.withTransaction) throw new Error("Transactions required");
      await mongo.withTransaction(async (db, session) => {
        const actor = await offerAuthority(
          db,
          config,
          identity,
          w,
          "offers",
          "update",
          session,
        );
        const row = await db
          .collection("offers")
          .findOne(
            { workspaceId: w, id: input.id, archived: false },
            { session },
          );
        if (!row || row.offerDesignId !== input.designId)
          throw new OfferConflict("Offer design mismatch");
        if (
          JSON.stringify(input.definition.targetIcpIds) !==
            JSON.stringify(input.work.targetIcpIds) ||
          JSON.stringify(input.definition.targetBuyerProfileIds) !==
            JSON.stringify(input.work.targetBuyerProfileIds)
        )
          throw new OfferConflict("Offer targets must match its design");
        const priorDesign = await db
          .collection("offer_designs")
          .findOne({ workspaceId: w, id: input.designId }, { session });
        const scoped: MongoService = {
          ...mongo,
          database: async () => db,
          isAvailable: () => mongo.isAvailable(),
          close: () => mongo.close(),
          withTransaction: async (fn) => fn(db, session),
        };
        await mutateOfferFoundation(
          scoped,
          config,
          identity,
          w,
          "offer_designs",
          "update",
          {
            id: input.designId,
            expectedUpdatedAt: input.expectedDesignUpdatedAt,
            work: input.work,
          },
        );
        await mutateOfferFoundation(
          scoped,
          config,
          identity,
          w,
          "offers",
          "update",
          {
            id: input.id,
            expectedUpdatedAt: input.expectedUpdatedAt,
            definition: input.definition,
          },
        );
        await registerOfferOutput(
          db,
          session,
          w,
          (await db
            .collection("offers")
            .findOne({ workspaceId: w, id: input.id }, { session }))!,
          (await db
            .collection("offer_designs")
            .findOne({ workspaceId: w, id: input.designId }, { session }))!,
          actor,
          new Date(),
          true,
        );
        if (priorDesign)
          await recordReviewChanges(
            db,
            session,
            w,
            input.id,
            input.designId,
            actor,
            priorDesign.work,
            input.work,
          );
      });
      return bundle(identity, w, input.id);
    },
    async transition(identity: AuthenticatedUser, w: string, raw: unknown) {
      const input = z
        .object({
          id: platformIdSchema("offer"),
          expectedUpdatedAt: z.string().datetime(),
          expectedDesignUpdatedAt: z.string().datetime(),
          action: z.enum(["approve", "revise"]),
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
          input.action === "approve" ? "approve" : "update",
          session,
        );
        const offer = await db
          .collection("offers")
          .findOne(
            { workspaceId: w, id: input.id, archived: false },
            { session },
          );
        const design = offer?.offerDesignId
          ? await db
              .collection("offer_designs")
              .findOne(
                { workspaceId: w, id: offer.offerDesignId, archived: false },
                { session },
              )
          : null;
        if (
          !offer ||
          !design ||
          design.updatedAt.toISOString() !== input.expectedDesignUpdatedAt
        )
          throw new OfferConflict("Offer changed; reload before continuing");
        const scoped: MongoService = {
          ...mongo,
          database: async () => db,
          isAvailable: () => mongo.isAvailable(),
          close: () => mongo.close(),
          withTransaction: async (fn) => fn(db, session),
        };
        if (input.action === "approve") {
          const event = await db.collection("events").findOne(
            {
              workspaceId: w,
              eventType: "offer_generation",
              "payload.offerId": offer.id,
            },
            { session },
          );
          if (await contextChanged(db, w, event?.payload.contextRefs, session))
            throw new OfferConflict(
              "Brand or company changed; generate a fresh offer draft",
            );
          for (const ref of event?.payload.sources ?? []) {
            const r = await db
              .collection(ref.kind)
              .findOne(
                { workspaceId: w, id: ref.id, archived: false },
                { session },
              );
            if (r?.approvedRevision !== ref.revision)
              throw new OfferConflict(
                "Source changed; generate a fresh offer draft",
              );
          }
          let d: Document = design;
          if (d.status !== "completed") {
            if (d.status !== "ready_for_review")
              d = await mutateOfferFoundation(
                scoped,
                config,
                identity,
                w,
                "offer_designs",
                "ready",
                { id: d.id, expectedUpdatedAt: d.updatedAt.toISOString() },
              );
            await mutateOfferFoundation(
              scoped,
              config,
              identity,
              w,
              "offer_designs",
              "complete",
              { id: d.id, expectedUpdatedAt: d.updatedAt.toISOString() },
            );
          }
        } else if (["completed", "ready_for_review"].includes(design.status))
          await mutateOfferFoundation(
            scoped,
            config,
            identity,
            w,
            "offer_designs",
            "reopen",
            {
              id: design.id,
              expectedUpdatedAt: design.updatedAt.toISOString(),
            },
          );
        await mutateOfferFoundation(
          scoped,
          config,
          identity,
          w,
          "offers",
          input.action,
          { id: offer.id, expectedUpdatedAt: input.expectedUpdatedAt },
        );
        await registerOfferOutput(
          db,
          session,
          w,
          (await db
            .collection("offers")
            .findOne({ workspaceId: w, id: offer.id }, { session }))!,
          (await db
            .collection("offer_designs")
            .findOne({ workspaceId: w, id: design.id }, { session }))!,
          actor,
          new Date(),
          input.action !== "approve",
        );
      });
      return bundle(identity, w, input.id);
    },
  };
}
