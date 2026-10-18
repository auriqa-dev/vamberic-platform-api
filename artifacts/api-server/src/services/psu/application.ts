import { reviewedResearchContext } from "../research/evidence-context";
import { independentSources } from "./independent-sources";
import { readGenerationBrandBrief } from "../generation-guidance";
import { z } from "zod";
import type { Db, ClientSession, Document } from "mongodb";
import type { AppConfig } from "../../config";
import type { AuthenticatedUser } from "../../middlewares/auth";
import type { MongoService } from "../mongo";
import { resolveHvmContext, withoutMongoId } from "../hvm-context";
import { AuthorizationDenied } from "../../authorization/policy";
import {
  EventSchema,
  generatePlatformId,
  platformIdSchema,
  partnerHumanSchema,
} from "../../domain";
import {
  OfferingContentSchema,
  semanticHash,
} from "../../domain/hive-definitions";
import { HiveConflict, mutateHiveDefinition } from "../hive-definitions";
import { submittedPagePolicy } from "@workspace/agent-runtime-protocol";
import { WebsiteReviewDraftSchema } from "./website-draft";
import { CompanyProfileSchema, CompanyReviewSchema } from "./company";
import {
  generationFailureCode,
  PsuGenerationFailure,
  type PsuGenerator,
} from "./generate";

const requestSchema = z
  .object({
    requestKey: z.string().uuid(),
    includeWebResearch: z.boolean().optional(),
    kind: z.enum(["company", "product"]).optional(),
    depth: z.enum(["summary", "detailed"]).optional(),
    offeringId: platformIdSchema("offering").optional(),
    expectedUpdatedAt: z.string().datetime().optional(),
    brandId: platformIdSchema("brand"),
    workingLabel: z.string().trim().min(1).max(200),
    orientation: z.string().max(4000),
    websiteUrls: z.array(z.string().max(2048)).min(1).max(6),
  })
  .strict();
const reviewedSchema = z
  .object({
    draftDigest: z.string().regex(/^[a-f0-9]{64}$/),
    fields: z
      .array(
        z
          .object({
            field: z.string(),
            value: z.union([z.string(), z.array(z.string())]),
          })
          .strict(),
      )
      .min(1)
      .max(40),
  })
  .strict();
const REQUEST = "psu_generation_requested",
  RESULT = "psu_generation_finished",
  SAVED = "psu_review_saved";
const timeoutMs = 600000;
const PROGRESS = "psu_generation_progress",
  PREVIEW = "psu_generation_preview";
export function createPsuApplication(
  config: AppConfig,
  mongo: MongoService,
  generate?: PsuGenerator,
) {
  async function authority(
    db: Db,
    identity: AuthenticatedUser,
    workspaceId: string,
    action: "read" | "create" | "approve",
    session?: ClientSession,
  ) {
    platformIdSchema("workspace").parse(workspaceId);
    const r = await resolveHvmContext(db, config, identity, session);
    if (r.context.application !== "hvmapp" || r.context.actor.type !== "human")
      throw new AuthorizationDenied();
    r.authority.scopeFilter(r.context, action, {
      type: "offerings",
      workspaceId,
    });
    return partnerHumanSchema.parse(r.context.actor);
  }
  async function lock(db: Db, workspaceId: string, session: ClientSession) {
    const workspace = await db
      .collection("crm_workspaces")
      .findOne(
        { id: workspaceId, kind: "client", archived: { $ne: true } },
        { session },
      );
    if (!workspace) throw new AuthorizationDenied();
    const updated = new Date(
      Math.max(Date.now(), workspace.updatedAt.getTime() + 1),
    );
    const r = await db
      .collection("crm_workspaces")
      .updateOne(
        { id: workspaceId, updatedAt: workspace.updatedAt },
        { $set: { updatedAt: updated } },
        { session },
      );
    if (!r.matchedCount) throw new HiveConflict("Workspace changed");
    return workspace;
  }
  async function event(
    db: Db,
    workspaceId: string,
    actor: unknown,
    eventType: string,
    payload: Document,
    session?: ClientSession,
  ) {
    const workspace = session
      ? await db
          .collection("crm_workspaces")
          .findOne({ id: workspaceId }, { session })
      : undefined;
    const now = new Date(
      Math.max(Date.now(), workspace?.updatedAt?.getTime() ?? 0),
    );
    const row = EventSchema.parse({
      id: generatePlatformId("event"),
      workspaceId,
      createdAt: now,
      updatedAt: now,
      occurredAt: now,
      actor,
      eventType,
      payload: { ...payload, human: actor },
    });
    await db.collection("events").insertOne(row, { session });
    return row;
  }
  async function getRequest(
    db: Db,
    w: string,
    id: string,
    session?: ClientSession,
  ) {
    platformIdSchema("event").parse(id);
    const row = await db
      .collection("events")
      .findOne({ id, workspaceId: w, eventType: REQUEST }, { session });
    if (!row) throw new AuthorizationDenied();
    return row;
  }
  async function chunks(
    db: Db,
    w: string,
    jobId: string,
    actor: unknown,
    kind: string,
    value: unknown,
    session: ClientSession,
  ) {
    const text = JSON.stringify(value);
    if (Buffer.byteLength(text) > 200000)
      throw new HiveConflict("Product details too large");
    const count = Math.ceil(text.length / 4000);
    for (let ordinal = 0; ordinal < count; ordinal++)
      await event(
        db,
        w,
        actor,
        "psu_content_chunk",
        {
          jobId,
          kind,
          ordinal,
          text: text.slice(ordinal * 4000, (ordinal + 1) * 4000),
        },
        session,
      );
    return { count, digest: semanticHash(value) };
  }
  async function draftFor(
    db: Db,
    w: string,
    id: string,
    result: Document,
    session?: ClientSession,
  ) {
    if (!result?.payload.draftChunks) return undefined;
    const parts = await db
      .collection("events")
      .find(
        {
          workspaceId: w,
          eventType: "psu_content_chunk",
          "payload.jobId": id,
          "payload.kind": result.payload.preview ? "previewDraft" : "draft",
        },
        { session },
      )
      .sort({ "payload.ordinal": 1 })
      .limit(51)
      .toArray();
    if (
      parts.length !== result.payload.draftChunks.count ||
      parts.some((p, i) => p.payload.ordinal !== i)
    )
      throw new HiveConflict("Incomplete source evidence");
    const draft = WebsiteReviewDraftSchema.parse(
      JSON.parse(parts.map((p) => p.payload.text).join("")),
    );
    if (semanticHash(draft) !== result.payload.draftChunks.digest)
      throw new HiveConflict("Source evidence changed");
    return draft;
  }
  async function readChunks(
    db: Db,
    w: string,
    id: string,
    kind: string,
    expected: { count: number; digest: string },
    session?: ClientSession,
  ) {
    const parts = await db
      .collection("events")
      .find(
        {
          workspaceId: w,
          eventType: "psu_content_chunk",
          "payload.jobId": id,
          "payload.kind": kind,
        },
        { session },
      )
      .sort({ "payload.ordinal": 1 })
      .limit(51)
      .toArray();
    if (
      parts.length !== expected.count ||
      parts.some((p, i) => p.payload.ordinal !== i)
    )
      throw new HiveConflict("Incomplete saved details");
    const value: unknown = JSON.parse(
      parts.map((p) => p.payload.text).join(""),
    );
    if (semanticHash(value) !== expected.digest)
      throw new HiveConflict("Saved details changed");
    return value;
  }
  async function latestCompany(
    db: Db,
    w: string,
    brandId: string,
    session?: ClientSession,
  ) {
    return (
      await db
        .collection("events")
        .find(
          {
            workspaceId: w,
            eventType: "psu_company_saved",
            "payload.brandId": brandId,
          },
          { session },
        )
        .sort({ createdAt: -1, id: -1 })
        .limit(1)
        .toArray()
    )[0];
  }
  async function companyValue(
    db: Db,
    w: string,
    row: Document,
    session?: ClientSession,
  ) {
    return CompanyProfileSchema.parse(
      await readChunks(
        db,
        w,
        row.id,
        "company",
        row.payload.profileChunks,
        session,
      ),
    );
  }
  async function approvedCompany(
    db: Db,
    w: string,
    brandId: string,
    session?: ClientSession,
  ) {
    const approval = (
      await db
        .collection("events")
        .find(
          {
            workspaceId: w,
            eventType: "psu_company_approved",
            "payload.brandId": brandId,
          },
          { session },
        )
        .sort({ createdAt: -1, id: -1 })
        .limit(1)
        .toArray()
    )[0];
    if (!approval) return undefined;
    const row = await db.collection("events").findOne(
      {
        workspaceId: w,
        id: approval.payload.versionId,
        eventType: "psu_company_saved",
        "payload.brandId": brandId,
      },
      { session },
    );
    if (!row) throw new HiveConflict("Company version missing");
    return {
      versionId: row.id,
      definition: await companyValue(db, w, row, session),
    };
  }
  async function requireBrand(
    db: Db,
    w: string,
    brandId: string,
    session?: ClientSession,
  ) {
    platformIdSchema("brand").parse(brandId);
    const workspace = await db
      .collection("crm_workspaces")
      .findOne({ id: w, kind: "client", archived: { $ne: true } }, { session });
    const brand =
      workspace &&
      (await db.collection("brands").findOne(
        {
          id: brandId,
          workspaceId: w,
          organisationId: workspace.clientOrganisationId,
          status: "active",
          archived: { $ne: true },
        },
        { session },
      ));
    if (!brand) throw new AuthorizationDenied();
    return brand;
  }
  async function requireProductTarget(
    db: Db,
    w: string,
    input: { offeringId?: string; brandId: string; expectedUpdatedAt?: string },
    session: ClientSession,
  ) {
    const row = await db.collection("offerings").findOne(
      {
        id: input.offeringId,
        workspaceId: w,
        brandId: input.brandId,
        archived: { $ne: true },
      },
      { session },
    );
    if (!row) throw new AuthorizationDenied();
    if (
      !["draft", "approved"].includes(row.status) ||
      row.updatedAt.toISOString() !== input.expectedUpdatedAt
    )
      throw new HiveConflict("Product changed; reload before generating");
    return row;
  }
  async function requireNewProductName(
    db: Db,
    w: string,
    brandId: string,
    name: string,
    session: ClientSession,
  ) {
    const rows = await db
      .collection("offerings")
      .find({ workspaceId: w, brandId, archived: { $ne: true } }, { session })
      .toArray();
    if (
      rows.some(
        (row) =>
          row.definition.name.trim().toLowerCase() ===
          name.trim().toLowerCase(),
      )
    )
      throw new HiveConflict(
        "A product with this name already exists. Select it to generate its summary.",
      );
  }
  async function view(db: Db, row: Document, session?: ClientSession) {
    const filter = { workspaceId: row.workspaceId, "payload.jobId": row.id };
    const saved = await db
      .collection("events")
      .findOne({ ...filter, eventType: SAVED }, { session });
    const final = await db
      .collection("events")
      .findOne({ ...filter, eventType: RESULT }, { session });
    const result =
      final ??
      (await db
        .collection("events")
        .findOne({ ...filter, eventType: PREVIEW }, { session }));
    const progress = (
      await db
        .collection("events")
        .find({ ...filter, eventType: PROGRESS }, { session })
        .sort({ createdAt: -1, id: -1 })
        .limit(1)
        .toArray()
    )[0];
    const draft = result
      ? await draftFor(db, row.workspaceId, row.id, result, session)
      : undefined;
    return {
      ...(progress ? { progress: progress.payload.progress } : {}),
      ...(result?.payload.researchIncomplete
        ? { researchIncomplete: true }
        : {}),
      ...(result?.payload.researchSources
        ? {
            researchSources: independentSources(
              result.payload.researchSources,
              row.payload.input.websiteUrls,
              row.payload.input.workingLabel,
            ),
          }
        : {}),
      ...(result?.payload.researchUnavailable
        ? { researchUnavailable: true }
        : {}),
      id: row.id,
      workspaceId: row.workspaceId,
      createdAt: row.createdAt,
      input: row.payload.input,
      status: saved
        ? "saved"
        : (final?.payload.status ??
          (Date.now() > Date.parse(row.payload.expiresAt)
            ? "interrupted"
            : "generating")),
      ...(draft ? { draft } : {}),
      ...(result?.payload.productDeleted ? { productDeleted: true } : {}),
      ...(result?.payload.competitorSuggestions
        ? { competitorSuggestions: result.payload.competitorSuggestions }
        : {}),
      ...(result?.payload.productCompetitorSuggestions
        ? {
            productCompetitorSuggestions:
              result.payload.productCompetitorSuggestions,
          }
        : {}),
      ...(result?.payload.failureCode
        ? { failureCode: result.payload.failureCode }
        : {}),
      ...(result?.payload.companyDraftChunks
        ? {
            companyDraft: CompanyReviewSchema.parse(
              await readChunks(
                db,
                row.workspaceId,
                row.id,
                result.payload.preview ? "previewCompanyDraft" : "companyDraft",
                result.payload.companyDraftChunks,
                session,
              ),
            ),
          }
        : {}),
      ...(result?.payload.offeringCount
        ? {
            offeringCount: result.payload.offeringCount,
            offeringCountReason: result.payload.offeringCountReason,
            productUnavailable: !!result.payload.productUnavailable,
          }
        : {}),
      ...(row.payload.input.kind === "company"
        ? {
            companySaved: !!(await db.collection("events").findOne(
              {
                workspaceId: row.workspaceId,
                eventType: "psu_company_saved",
                "payload.jobId": row.id,
              },
              { session },
            )),
          }
        : {}),
      ...(result?.payload.unavailable
        ? { unavailable: result.payload.unavailable }
        : {}),
      ...(saved ? { offeringId: saved.payload.offeringId } : {}),
    };
  }
  async function finish(row: Document) {
    const signal = AbortSignal.timeout(
      Math.max(1, Date.parse(row.payload.expiresAt) - Date.now()),
    );
    let payload: Document;
    let preview: Awaited<ReturnType<PsuGenerator>> | undefined;
    try {
      const db = await mongo.database();
      const context = row.payload.contextChunks
        ? z
            .record(z.unknown())
            .parse(
              await readChunks(
                db,
                row.workspaceId,
                row.payload.contextId,
                "context",
                row.payload.contextChunks,
              ),
            )
        : row.payload.context;
      const generated = await generate!(
        { ...row.payload.input, context },
        signal,
        async (progress, partial) => {
          signal.throwIfAborted();
          await mongo.withTransaction!(async (db, session) => {
            await lock(db, row.workspaceId, session);
            if (
              !(await db.collection("events").findOne(
                {
                  workspaceId: row.workspaceId,
                  id: row.id,
                  eventType: REQUEST,
                },
                { session },
              ))
            )
              throw new HiveConflict("Generation removed");
            if (
              await db.collection("events").findOne(
                {
                  workspaceId: row.workspaceId,
                  eventType: RESULT,
                  "payload.jobId": row.id,
                },
                { session },
              )
            )
              throw new HiveConflict("Generation finished");
            await event(
              db,
              row.workspaceId,
              row.payload.human,
              PROGRESS,
              { jobId: row.id, progress },
              session,
            );
            if (partial) {
              const { draft, companyDraft, ...rest } = partial;
              await event(
                db,
                row.workspaceId,
                row.payload.human,
                PREVIEW,
                {
                  ...rest,
                  jobId: row.id,
                  preview: true,
                  ...(draft
                    ? {
                        draftChunks: await chunks(
                          db,
                          row.workspaceId,
                          row.id,
                          row.payload.human,
                          "previewDraft",
                          WebsiteReviewDraftSchema.parse(draft),
                          session,
                        ),
                      }
                    : {}),
                  ...(companyDraft
                    ? {
                        companyDraftChunks: await chunks(
                          db,
                          row.workspaceId,
                          row.id,
                          row.payload.human,
                          "previewCompanyDraft",
                          CompanyReviewSchema.parse(companyDraft),
                          session,
                        ),
                      }
                    : {}),
                },
                session,
              );
            }
          });
          if (partial) preview = partial;
        },
      );
      signal.throwIfAborted();
      payload = {
        jobId: row.id,
        status: "review",
        ...generated,
        ...(generated.draft
          ? { draft: WebsiteReviewDraftSchema.parse(generated.draft) }
          : {}),
        ...(row.payload.input.kind === "company"
          ? { companyDraft: CompanyReviewSchema.parse(generated.companyDraft) }
          : { draft: WebsiteReviewDraftSchema.parse(generated.draft) }),
      };
    } catch (error) {
      payload = {
        jobId: row.id,
        ...(preview ?? {}),
        status: preview ? "review" : "failed",
        ...(preview
          ? { researchIncomplete: true, preliminaryUsage: preview.usage }
          : {}),
        failureCode: generationFailureCode(error),
        ...(error instanceof PsuGenerationFailure && error.validationStage
          ? { validationStage: error.validationStage }
          : {}),
        usage:
          error instanceof PsuGenerationFailure
            ? error.usage
            : { status: "unknown" },
      };
      console.warn(
        JSON.stringify({
          event: "psu_generation_failed",
          workspaceId: row.workspaceId,
          jobId: row.id,
          code: payload.failureCode,
          validationStage: payload.validationStage,
          previewRetained: !!preview,
          validationReason:
            error instanceof PsuGenerationFailure
              ? error.validationReason
              : undefined,
        }),
      );
    }
    // No provider work inside a transaction: transaction retries cannot repeat AI calls.
    await mongo.withTransaction!(async (db, session) => {
      // Capture admitted work and usage even if the requester subsequently loses access.
      // Every read/save still resolves current authority.
      await lock(db, row.workspaceId, session);
      // A deleted generation must never recreate its chunks or result.
      if (
        !(await db
          .collection("events")
          .findOne(
            { workspaceId: row.workspaceId, id: row.id, eventType: REQUEST },
            { session },
          ))
      )
        return;

      if (Date.now() > Date.parse(row.payload.expiresAt))
        payload = {
          jobId: row.id,
          ...(preview ?? {}),
          status: preview ? "review" : "failed",
          ...(preview ? { researchIncomplete: true } : {}),
          failureCode: "timed_out",
          usage: payload.usage ?? { status: "unknown" },
        };
      if (
        await db.collection("events").findOne(
          {
            workspaceId: row.workspaceId,
            eventType: RESULT,
            "payload.jobId": row.id,
          },
          { session },
        )
      )
        return;
      if (payload.companyDraft) {
        const { companyDraft, ...rest } = payload;
        payload = {
          ...rest,
          companyDraftChunks: await chunks(
            db,
            row.workspaceId,
            row.id,
            row.payload.human,
            "companyDraft",
            companyDraft,
            session,
          ),
        };
      }
      if (payload.draft) {
        const { draft, ...rest } = payload;
        payload = {
          ...rest,
          draftChunks: await chunks(
            db,
            row.workspaceId,
            row.id,
            row.payload.human,
            "draft",
            draft,
            session,
          ),
        };
      }
      await event(
        db,
        row.workspaceId,
        row.payload.human,
        RESULT,
        payload,
        session,
      );
    });
  }
  return {
    async referenceData(identity: AuthenticatedUser, w: string) {
      const db = await mongo.database();
      await authority(db, identity, w, "read");
      const read = async (name: string) => {
        const rows = await db
          .collection(name)
          .find(
            { is_active: true },
            {
              projection: {
                _id: 0,
                code: 1,
                name: 1,
                description: 1,
                display_order: 1,
              },
            },
          )
          .sort({ display_order: 1, name: 1 })
          .toArray();
        return rows.map((row) => ({
          code: row.code,
          name: row.name,
          description: row.description ?? "",
        }));
      };
      const [industries, regions] = await Promise.all([
        read("ref_industries"),
        read("ref_regions"),
      ]);
      return { workspaceId: w, industries, regions };
    },
    async approvedCompanyContext(
      identity: AuthenticatedUser,
      w: string,
      brandId: string,
      session?: ClientSession,
    ) {
      const db = await mongo.database();
      await authority(db, identity, w, "read", session);
      await requireBrand(db, w, brandId, session);
      return (await approvedCompany(db, w, brandId, session)) ?? null;
    },
    async company(identity: AuthenticatedUser, w: string, brandId: string) {
      const db = await mongo.database();
      await authority(db, identity, w, "read");
      const brand = await requireBrand(db, w, brandId);
      const row = await latestCompany(db, w, brandId);
      const approved = await approvedCompany(db, w, brandId);
      const onboarding = await db.collection("client_onboardings").findOne({
        "result.workspaceId": w,
        "result.brandId": brandId,
        "result.organisationId": brand.organisationId,
      });
      const primary = (
        await db
          .collection("events")
          .find({
            workspaceId: w,
            eventType: "psu_primary_product_selected",
            "payload.brandId": brandId,
          })
          .sort({ createdAt: -1, id: -1 })
          .limit(1)
          .toArray()
      )[0];
      return {
        workspaceId: w,
        brandId,
        brandName: brand.name,
        websiteUrl:
          onboarding?.details?.intake?.websiteUrl ??
          (brand.primaryDomain ? `https://${brand.primaryDomain}` : ""),
        current: row
          ? {
              versionId: row.id,
              definition: await companyValue(db, w, row),
              approved: approved?.versionId === row.id,
            }
          : null,
        approved: approved ?? null,
        primaryOfferingId: primary?.payload.offeringId ?? null,
      };
    },
    async saveCompany(
      identity: AuthenticatedUser,
      w: string,
      brandId: string,
      raw: unknown,
    ) {
      const input = z
        .object({
          requestKey: z.string().uuid(),
          expectedVersionId: platformIdSchema("event").nullable(),
          definition: z.unknown(),
          jobId: platformIdSchema("event").optional(),
          draftDigest: z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .optional(),
        })
        .strict()
        .parse(raw);
      const definition = CompanyProfileSchema.parse(input.definition);
      if (!mongo.withTransaction) throw new Error("Transactions required");
      return mongo.withTransaction(async (db, session) => {
        const actor = await authority(db, identity, w, "create", session);
        await lock(db, w, session);
        const brand = await requireBrand(db, w, brandId, session);
        const existing = await db.collection("events").findOne(
          {
            workspaceId: w,
            eventType: "psu_company_saved",
            "payload.requestKey": input.requestKey,
          },
          { session },
        );
        if (existing) {
          if (
            existing.payload.reviewDigest !==
            semanticHash({ brandId, ...input })
          )
            throw new HiveConflict("Request changed");
          return { versionId: existing.id };
        }
        const current = await latestCompany(db, w, brandId, session);
        if ((current?.id ?? null) !== input.expectedVersionId)
          throw new HiveConflict("Company changed");
        if (input.jobId) {
          const request = await getRequest(db, w, input.jobId, session);
          if (
            request.payload.input.kind !== "company" ||
            request.payload.input.brandId !== brandId
          )
            throw new AuthorizationDenied();
          if (
            request.payload.companyVersionId !== input.expectedVersionId ||
            request.payload.brandDigest !== semanticHash(withoutMongoId(brand))
          )
            throw new HiveConflict("Company context changed");
          const result = await db.collection("events").findOne(
            {
              workspaceId: w,
              eventType: RESULT,
              "payload.jobId": input.jobId,
            },
            { session },
          );
          if (!result?.payload.companyDraftChunks)
            throw new HiveConflict("Company draft not ready");
          const draft = CompanyReviewSchema.parse(
            await readChunks(
              db,
              w,
              input.jobId,
              "companyDraft",
              result.payload.companyDraftChunks,
              session,
            ),
          );
          if (draft.digest !== input.draftDigest)
            throw new HiveConflict("Company draft changed");
          if (
            await db.collection("events").findOne(
              {
                workspaceId: w,
                eventType: "psu_company_saved",
                "payload.jobId": input.jobId,
              },
              { session },
            )
          )
            throw new HiveConflict("Company draft already saved");
        } else if (input.draftDigest)
          throw new HiveConflict("Missing source draft");
        const versionId = generatePlatformId("event");
        const profileChunks = await chunks(
          db,
          w,
          versionId,
          actor,
          "company",
          definition,
          session,
        );
        const now = new Date(
          Math.max(Date.now(), current ? current.createdAt.getTime() + 1 : 0),
        );
        const row = EventSchema.parse({
          id: versionId,
          workspaceId: w,
          createdAt: now,
          updatedAt: now,
          occurredAt: now,
          actor,
          eventType: "psu_company_saved",
          payload: {
            human: actor,
            brandId,
            organisationId: brand.organisationId,
            requestKey: input.requestKey,
            reviewDigest: semanticHash({ brandId, ...input }),
            previousVersionId: input.expectedVersionId,
            profileChunks,
            ...(input.jobId ? { jobId: input.jobId } : {}),
          },
        });
        await db.collection("events").insertOne(row, { session });
        return { versionId };
      });
    },
    async approveCompany(
      identity: AuthenticatedUser,
      w: string,
      brandId: string,
      raw: unknown,
    ) {
      const input = z
        .object({ versionId: platformIdSchema("event") })
        .strict()
        .parse(raw);
      if (!mongo.withTransaction) throw new Error("Transactions required");
      return mongo.withTransaction(async (db, session) => {
        const actor = await authority(db, identity, w, "approve", session);
        await lock(db, w, session);
        await requireBrand(db, w, brandId, session);
        const current = await latestCompany(db, w, brandId, session);
        if (current?.id !== input.versionId)
          throw new HiveConflict("Company changed");
        await companyValue(db, w, current, session);
        const approved = await approvedCompany(db, w, brandId, session);
        if (approved?.versionId !== input.versionId)
          await event(
            db,
            w,
            actor,
            "psu_company_approved",
            { brandId, versionId: input.versionId },
            session,
          );
        return { versionId: input.versionId };
      });
    },
    async primaryProduct(
      identity: AuthenticatedUser,
      w: string,
      brandId: string,
      raw: unknown,
    ) {
      const input = z
        .object({
          offeringId: platformIdSchema("offering"),
          expectedOfferingId: platformIdSchema("offering").nullable(),
        })
        .strict()
        .parse(raw);
      if (!mongo.withTransaction) throw new Error("Transactions required");
      return mongo.withTransaction(async (db, session) => {
        const actor = await authority(db, identity, w, "create", session);
        await lock(db, w, session);
        await requireBrand(db, w, brandId, session);
        const offering = await db.collection("offerings").findOne(
          {
            id: input.offeringId,
            workspaceId: w,
            brandId,
            status: { $ne: "retired" },
            archived: { $ne: true },
          },
          { session },
        );
        if (!offering) throw new AuthorizationDenied();
        const current = (
          await db
            .collection("events")
            .find(
              {
                workspaceId: w,
                eventType: "psu_primary_product_selected",
                "payload.brandId": brandId,
              },
              { session },
            )
            .sort({ createdAt: -1, id: -1 })
            .limit(1)
            .toArray()
        )[0];
        if (current?.payload.offeringId === input.offeringId) return input;
        if ((current?.payload.offeringId ?? null) !== input.expectedOfferingId)
          throw new HiveConflict("Primary product changed");
        await event(
          db,
          w,
          actor,
          "psu_primary_product_selected",
          { brandId, offeringId: input.offeringId },
          session,
        );
        return input;
      });
    },
    async read(identity: AuthenticatedUser, w: string, id: string) {
      const db = await mongo.database();
      await authority(db, identity, w, "read");
      return view(db, await getRequest(db, w, id));
    },
    async list(identity: AuthenticatedUser, w: string) {
      const db = await mongo.database();
      await authority(db, identity, w, "read");
      const rows = await db
        .collection("events")
        .find({ workspaceId: w, eventType: REQUEST })
        .sort({ createdAt: -1 })
        .limit(101)
        .toArray();
      return {
        workspaceId: w,
        generationAvailable: !!generate,
        items: await Promise.all(rows.slice(0, 100).map((r) => view(db, r))),
        hasMore: rows.length > 100,
      };
    },
    async createProduct(identity: AuthenticatedUser, w: string, raw: unknown) {
      const input = z
        .object({
          requestKey: z.string().uuid(),
          brandId: platformIdSchema("brand"),
          definition: OfferingContentSchema,
        })
        .strict()
        .parse(raw);
      if (!mongo.withTransaction) throw new Error("Transactions unavailable");
      return mongo.withTransaction(async (db, session) => {
        const actor = await authority(db, identity, w, "create", session);
        await lock(db, w, session);
        await requireBrand(db, w, input.brandId, session);
        const previous = await db.collection("events").findOne(
          {
            workspaceId: w,
            eventType: "psu_product_created",
            "payload.requestKey": input.requestKey,
          },
          { session },
        );
        if (previous) {
          if (previous.payload.requestDigest !== semanticHash(input))
            throw new HiveConflict("Request changed");
          return { offeringId: previous.payload.offeringId };
        }
        await requireNewProductName(
          db,
          w,
          input.brandId,
          input.definition.name,
          session,
        );
        const joined = {
          ...mongo,
          withTransaction: <T>(
            work: (db: Db, session: ClientSession) => Promise<T>,
          ) => work(db, session),
        };
        const offering = await mutateHiveDefinition(
          joined,
          config,
          identity,
          w,
          "offerings",
          "create",
          { brandId: input.brandId, definition: input.definition },
        );
        await event(
          db,
          w,
          actor,
          "psu_product_created",
          {
            requestKey: input.requestKey,
            requestDigest: semanticHash(input),
            offeringId: offering.id,
          },
          session,
        );
        return { offeringId: offering.id };
      });
    },
    async start(identity: AuthenticatedUser, w: string, raw: unknown) {
      const input = requestSchema
        .superRefine((v, ctx) => {
          if (
            !!v.offeringId !== !!v.expectedUpdatedAt ||
            (v.kind === "company" && v.offeringId)
          )
            ctx.addIssue({ code: "custom", message: "Invalid product target" });
          try {
            submittedPagePolicy(v.websiteUrls);
          } catch {
            ctx.addIssue({
              code: "custom",
              message: "Use valid public HTTPS page URLs",
            });
          }
        })
        .parse(raw);
      if (!generate || !mongo.withTransaction)
        throw new Error("PSU generation unavailable");
      const result = await mongo.withTransaction(async (db, session) => {
        const actor = await authority(db, identity, w, "create", session);
        const workspace = await lock(db, w, session);
        const previous = await db.collection("events").findOne(
          {
            workspaceId: w,
            eventType: REQUEST,
            "payload.input.requestKey": input.requestKey,
          },
          { session },
        );
        if (previous) {
          if (semanticHash(previous.payload.input) !== semanticHash(input))
            throw new HiveConflict("Request changed");
          return { row: previous, created: false };
        }
        const active = await db
          .collection("events")
          .find(
            {
              workspaceId: w,
              eventType: REQUEST,
              "payload.expiresAt": { $gt: new Date().toISOString() },
            },
            { session },
          )
          .limit(100)
          .toArray();
        for (const row of active)
          if ((await view(db, row, session)).status === "generating")
            throw new HiveConflict("A draft is already being generated");
        const brand = await db.collection("brands").findOne(
          {
            id: input.brandId,
            workspaceId: w,
            organisationId: workspace.clientOrganisationId,
            status: "active",
            archived: { $ne: true },
          },
          { session },
        );
        if (!brand) throw new AuthorizationDenied();
        const context = Object.fromEntries(
          ["name", "description", "primaryDomain"]
            .filter((k) => brand[k] !== undefined)
            .map((k) => [k, brand[k]]),
        );
        if (input.offeringId) {
          const target = await requireProductTarget(db, w, input, session);
          context.product = withoutMongoId(target).definition;
        }
        const company = await approvedCompany(db, w, input.brandId, session);
        if (company) context.company = company;
        const currentCompany = await latestCompany(
          db,
          w,
          input.brandId,
          session,
        );
        if (input.depth === "detailed" && currentCompany)
          context.companyDraft = {
            definition: await companyValue(db, w, currentCompany, session),
            approval: "not_approved",
          };
        context.sharedResearch = await reviewedResearchContext(
          db,
          w,
          input.brandId,
          input.offeringId ? [input.offeringId] : [],
        );
        context.approvedBrandBrief = await readGenerationBrandBrief(
          db,
          config,
          identity,
          w,
          input.brandId,
        );
        const contextId = generatePlatformId("event");
        const contextChunks = await chunks(
          db,
          w,
          contextId,
          actor,
          "context",
          context,
          session,
        );
        const row = await event(
          db,
          w,
          actor,
          REQUEST,
          {
            input,
            contextId,
            contextChunks,
            approvedCompanyVersionId: company?.versionId ?? null,
            companyVersionId: currentCompany?.id ?? null,
            brandDigest: semanticHash(withoutMongoId(brand)),
            expiresAt: new Date(Date.now() + timeoutMs).toISOString(),
          },
          session,
        );
        return { row, created: true };
      });
      if (result.created)
        void finish(result.row).catch(() => {
          /* Interrupted work is visible and explicitly retryable; never auto-repeat a paid request. */
        });
      return { id: result.row.id, workspaceId: w };
    },
    async save(
      identity: AuthenticatedUser,
      w: string,
      id: string,
      raw: unknown,
    ) {
      const input = reviewedSchema.parse(raw);
      if (!mongo.withTransaction) throw new Error("Transactions required");
      return mongo.withTransaction(async (db, session) => {
        const actor = await authority(db, identity, w, "create", session);
        await lock(db, w, session);
        const request = await getRequest(db, w, id, session);
        const existing = await db
          .collection("events")
          .findOne(
            { workspaceId: w, eventType: SAVED, "payload.jobId": id },
            { session },
          );
        if (existing) {
          if (existing.payload.reviewDigest !== semanticHash(input))
            throw new HiveConflict("Review already saved");
          return { offeringId: existing.payload.offeringId };
        }
        const result = await db
          .collection("events")
          .findOne(
            { workspaceId: w, eventType: RESULT, "payload.jobId": id },
            { session },
          );
        const draft = result
          ? await draftFor(db, w, id, result, session)
          : undefined;
        if (!draft)
          throw new HiveConflict("Generation is not ready for review");
        if (draft.digest !== input.draftDigest)
          throw new HiveConflict("Draft changed");
        const brand = await db.collection("brands").findOne(
          {
            id: request.payload.input.brandId,
            workspaceId: w,
            archived: { $ne: true },
          },
          { session },
        );
        if (
          !brand ||
          semanticHash(withoutMongoId(brand)) !== request.payload.brandDigest
        )
          throw new HiveConflict("Brand changed; generate a new draft");
        if (
          new Set(input.fields.map((f) => f.field)).size !== input.fields.length
        )
          throw new HiveConflict("Duplicate fields");
        const company = await approvedCompany(
          db,
          w,
          request.payload.input.brandId,
          session,
        );
        const ownCompany =
          request.payload.input.kind === "company" &&
          company &&
          (await db.collection("events").findOne(
            {
              workspaceId: w,
              id: company.versionId,
              eventType: "psu_company_saved",
              "payload.jobId": id,
            },
            { session },
          ));
        if (
          !ownCompany &&
          (company?.versionId ?? null) !==
            (request.payload.approvedCompanyVersionId ??
              request.payload.context?.company?.versionId ??
              null)
        )
          throw new HiveConflict(
            "Approved company changed; generate a new draft",
          );
        const reviewed = Object.fromEntries(
          input.fields.map((f) => [f.field, f.value]),
        );
        const inheritedModel =
          !reviewed.businessModel && company?.definition.businessModel;
        const definition = OfferingContentSchema.parse({
          ...reviewed,
          ...(inheritedModel ? { businessModel: inheritedModel } : {}),
        });
        const observations = input.fields.map((f) => ({
          field: f.field,
          value: f.value,
          origin: "user_supplied" as const,
          provider: "human_review",
          sourceReference: `psu_review:${id}`,
          observedAt: new Date().toISOString(),
          verification: "human_confirmed" as const,
        }));
        if (inheritedModel)
          observations.push({
            field: "businessModel",
            value: inheritedModel,
            origin: "user_supplied",
            provider: "human_review",
            sourceReference: `company_review:${company!.versionId}`,
            observedAt: new Date().toISOString(),
            verification: "human_confirmed",
          });
        // Join the existing Hive transaction; retain its relationship checks, hashes and audit writer.
        const joined = {
          ...mongo,
          withTransaction: <T>(
            work: (db: Db, session: ClientSession) => Promise<T>,
          ) => work(db, session),
        };
        let target: Document | undefined = request.payload.input.offeringId
          ? await requireProductTarget(db, w, request.payload.input, session)
          : undefined;
        if (!target)
          await requireNewProductName(
            db,
            w,
            request.payload.input.brandId,
            definition.name,
            session,
          );
        if (target?.status === "approved")
          target = await mutateHiveDefinition(
            joined,
            config,
            identity,
            w,
            "offerings",
            "revise",
            {
              id: target.id,
              expectedUpdatedAt: target.updatedAt.toISOString(),
            },
          );
        let offering = await mutateHiveDefinition(
          joined,
          config,
          identity,
          w,
          "offerings",
          target ? "update" : "create",
          target
            ? {
                id: target.id,
                expectedUpdatedAt: target.updatedAt.toISOString(),
                definition: { ...target.definition, ...definition },
              }
            : { brandId: request.payload.input.brandId, definition },
          target ? [] : observations,
        );
        if (target)
          for (const evidence of observations) {
            offering = await mutateHiveDefinition(
              joined,
              config,
              identity,
              w,
              "offerings",
              "observe",
              {
                id: offering.id,
                expectedUpdatedAt: offering.updatedAt.toISOString(),
                evidence,
              },
            );
          }
        await event(
          db,
          w,
          actor,
          SAVED,
          {
            jobId: id,
            offeringId: offering.id,
            reviewDigest: semanticHash(input),
            reviewChunks: await chunks(
              db,
              w,
              id,
              actor,
              "review",
              input,
              session,
            ),
            sourceResultId: result!.id,
          },
          session,
        );
        return { offeringId: offering.id };
      });
    },
  };
}
