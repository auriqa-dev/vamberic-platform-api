import type { Db, ClientSession, Document } from "mongodb";
import type { AppConfig } from "../../config";
import type { AuthenticatedUser } from "../../middlewares/auth";
import type { MongoService } from "../mongo";
import {
  EventSchema,
  generatePlatformId,
  platformIdSchema,
} from "../../domain";
import { lockIcpWorkspace } from "../icp/access";
import { HiveConflict } from "../hive-definitions";
import {
  contentAccess,
  currentRecords,
  fingerprint,
} from "../content-strategy/application";
import { contentContext } from "../content-strategy/context";
import { fullAssetText } from "../content-strategy/library-text";
import { assetData, type ContentRecord } from "../content-strategy/model";
import type { ContentGenerator } from "../content-strategy/generate";
import { contactContextAccess, readContactContext } from "../contact-context";
import { nbaContext } from "../nba/context";
import {
  emailAssets,
  emailEvidenceAssets,
  validateEmailBody,
} from "./selection";
import {
  emailRequest,
  emailMutation,
  emailOutput,
  emailRecord,
  type EmailRecord,
} from "./model";

async function allContent(db: Db, w: string, session?: ClientSession) {
  return currentRecords(
    await db
      .collection("events")
      .find(
        { workspaceId: w, eventType: "content_strategy_record" },
        { session },
      )
      .toArray(),
  );
}
async function latest(db: Db, w: string, id: string, session?: ClientSession) {
  const row = await db
    .collection("events")
    .find(
      {
        workspaceId: w,
        eventType: "email_content_record",
        "payload.record.id": id,
      },
      { session },
    )
    .sort({ "payload.record.version": -1 })
    .limit(1)
    .next();
  return row ? emailRecord.parse(row.payload.record) : undefined;
}
function event(w: string, actor: unknown, eventType: string, payload: unknown) {
  const now = new Date();
  return EventSchema.parse({
    id: generatePlatformId("event"),
    workspaceId: w,
    eventType,
    createdAt: now,
    updatedAt: now,
    occurredAt: now,
    createdBy: actor,
    payload,
  });
}
export function createEmailContent(
  config: AppConfig,
  mongo: MongoService,
  generate?: ContentGenerator,
) {
  async function context(
    db: Db,
    user: AuthenticatedUser,
    w: string,
    input: ReturnType<typeof emailRequest.parse>,
    session?: ClientSession,
  ) {
    await contentAccess(db, config, user, w, "update", session);
    await contactContextAccess(db, config, user, w, "read", session);
    platformIdSchema("person").parse(input.contactId);
    const all = await allContent(db, w, session),
      brief = all.find(
        (r) =>
          r.id === input.briefId &&
          r.kind === "brief" &&
          r.status === "approved" &&
          r.version === input.briefVersion,
      );
    if (!brief || !/email/i.test(String(brief.data.channel)))
      throw new HiveConflict(
        "Select a current approved email brief in Content Strategy.",
      );
    if (
      brief.sourceVersions.some(
        (ref) =>
          !all.some(
            (r) =>
              r.id === ref.id &&
              r.version === ref.version &&
              r.status !== "removed",
          ),
      )
    )
      throw new HiveConflict(
        "The brief sources have changed. Review and approve an updated brief first.",
      );
    const scope = brief.data.scope as {
      brandId: string;
      offers: { id: string; revision: number }[];
    };
    const approved = await contentContext(
      db,
      config,
      user,
      w,
      scope,
      session,
      "email",
    );
    const contact = await readContactContext(db, w, input.contactId, session);
    const person = await db
      .collection("people")
      .findOne(
        { workspaceId: w, id: input.contactId, archived: { $ne: true } },
        { session },
      );
    if (!person) throw new HiveConflict("Select a current contact.");
    let campaign = null;
    if (input.campaignId) {
      campaign = await nbaContext(
        db,
        config,
        user,
        w,
        input.campaignId,
        input.campaignVersion,
        { type: "person", id: input.contactId },
        session,
      );
      if (
        campaign.brandId !== scope.brandId ||
        scope.offers.some((o) => !campaign!.offerIds.includes(o.id))
      )
        throw new HiveConflict(
          "The brief must belong to this campaign's brand and offers.",
        );
    }
    const words = String(brief.data.objective ?? brief.data.title)
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 3);
    const candidates = emailAssets(all, brief)
      .sort((a, b) => {
        const score = (r: ContentRecord) =>
          (r.id === input.ctaAssetId ? 10000 : 0) +
          words.filter((word) =>
            `${r.data.title} ${r.data.description}`
              .toLowerCase()
              .includes(word),
          ).length;
        return score(b) - score(a);
      })
      .slice(0, 60);
    if (input.ctaAssetId && !candidates.some((r) => r.id === input.ctaAssetId))
      throw new HiveConflict(
        "This CTA needs current public content approved for email use. Review it in the Library.",
      );
    const sources = await Promise.all(
      emailEvidenceAssets(all, brief).map((r) =>
        fullAssetText(db, w, r, session),
      ),
    );
    const old = input.draftId
      ? await latest(db, w, input.draftId, session)
      : undefined;
    if (
      input.draftId &&
      (!old ||
        old.status === "removed" ||
        old.version !== input.expectedVersion ||
        old.briefId !== input.briefId ||
        old.contactId !== input.contactId)
    )
      throw new HiveConflict("The draft changed. Reload it before refining.");
    if (input.currentDraft && !old)
      throw new HiveConflict(
        "Select a saved draft before refining its edited content.",
      );
    const sourceVersions = [
      brief,
      ...candidates,
      ...sources.filter((r) => !candidates.some((c) => c.id === r.id)),
    ]
      .map((r) => ({
        id: r.id,
        version: r.version,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    const hash = fingerprint({
      approved: approved.hash,
      emailBrand: approved.approvedBrandBrief,
      contact: contact.revision,
      sourceVersions,
      campaign: campaign?.versions,
    });
    return {
      brief,
      approved,
      contact,
      person,
      candidates,
      sources,
      old,
      sourceVersions,
      hash,
      campaign,
    };
  }
  async function persist(
    db: Db,
    session: ClientSession,
    w: string,
    actor: unknown,
    row: EmailRecord,
    key: string,
    hash: string,
  ) {
    await db.collection("events").insertOne(
      event(w, actor, "email_content_record", {
        record: row,
        requestKey: key,
        requestHash: hash,
      }),
      { session },
    );
    // Register the produced asset in the same transaction. Email approval is NOT
    // approval for public reuse, distribution or authoritative core content.
    const asset = assetData.parse({
      title: row.content.subject,
      classification: "channel",
      assetType: "email_draft",
      sourceType: "email_content",
      channel: "email",
      url: "",
      text: row.content.body,
      description: "Personalised email draft; no sending authority.",
      sourceDocumentId: "",
      sourceAssetIds: [],
      scope: (await allContent(db, w, session)).find(
        (r) => r.id === row.briefId,
      )!.data.scope,
      topics: [],
      buyerStages: [],
      claims: [],
      evidence: [],
      gaps: row.content.reviewIssues,
      reuse: [],
      restrictions: [
        "Private recipient-specific draft. Not approved for distribution or reuse.",
      ],
      usageRights: "restricted",
      allowedUses: [],
      visibility: "private",
      analysisStatus: "needs_review",
      archived: row.status === "removed",
    });
    const record: ContentRecord = {
      id: row.libraryAssetId,
      version: row.version,
      kind: "asset",
      status: row.status === "removed" ? "removed" : "draft",
      data: asset,
      updatedAt: row.updatedAt,
      fingerprint: fingerprint(asset),
      sourceVersions: [],
      needsReview: true,
    };
    await db
      .collection("events")
      .insertOne(event(w, actor, "content_strategy_record", { record }), {
        session,
      });
    return row;
  }
  return {
    async list(user: AuthenticatedUser, w: string) {
      const db = await mongo.database();
      await contentAccess(db, config, user, w, "read");
      await contactContextAccess(db, config, user, w, "read");
      const rows = await db
        .collection("events")
        .find({ workspaceId: w, eventType: "email_content_record" })
        .sort({ "payload.record.version": -1 })
        .toArray();
      const unique = new Map<string, EmailRecord>();
      for (const r of rows) {
        const p = emailRecord.parse(r.payload.record);
        if (!unique.has(p.id)) unique.set(p.id, p);
      }
      return {
        records: [...unique.values()]
          .filter((r) => r.status !== "removed")
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
        generationAvailable: !!generate,
      };
    },
    async history(user: AuthenticatedUser, w: string, id: string) {
      const db = await mongo.database();
      await contentAccess(db, config, user, w, "read");
      await contactContextAccess(db, config, user, w, "read");
      return (
        await db
          .collection("events")
          .find({
            workspaceId: w,
            eventType: "email_content_record",
            "payload.record.id": id,
          })
          .sort({ "payload.record.version": -1 })
          .toArray()
      ).map((r) => emailRecord.parse(r.payload.record));
    },
    async generate(
      user: AuthenticatedUser,
      w: string,
      raw: unknown,
      guard?: (db: Db, s: ClientSession) => Promise<void>,
      nbaDecisionId = "",
    ) {
      if (!mongo.withTransaction || !generate)
        throw new HiveConflict("Email generation is unavailable.");
      const input = emailRequest.parse(raw),
        hash = fingerprint(input);
      const reserved = await mongo.withTransaction(async (db, s) => {
        const actor = await contentAccess(db, config, user, w, "update", s);
        await lockIcpWorkspace(db, w, s);
        await guard?.(db, s);
        const prior = await db.collection("events").findOne(
          {
            workspaceId: w,
            eventType: "email_content_generation",
            "payload.requestKey": input.requestKey,
          },
          { session: s },
        );
        if (prior) {
          if (prior.payload.requestHash !== hash)
            throw new HiveConflict(
              "This request key was used for different instructions.",
            );
          if (prior.payload.status === "completed")
            return { result: emailRecord.parse(prior.payload.result) };
          throw new HiveConflict(
            prior.payload.status === "running" &&
              Date.now() - new Date(prior.createdAt).getTime() < 90000
              ? "Henry is preparing this email. Refresh shortly to see the saved result."
              : "This attempt did not complete. Start a new generation; saved drafts are retained.",
          );
        }
        const ctx = await context(db, user, w, input, s);
        const row = event(w, actor, "email_content_generation", {
          requestKey: input.requestKey,
          requestHash: hash,
          status: "running",
          request: input,
          contextHash: ctx.hash,
          sourceVersions: ctx.sourceVersions,
          approvedBrandBrief: ctx.approved.approvedBrandBrief,
        });
        await db.collection("events").insertOne(row, { session: s });
        return { ctx, row };
      });
      if (reserved.result) return reserved.result;
      const ctx = reserved.ctx!;
      let usage: unknown;
      try {
        const output = await generate("email", {
          instruction: input.instruction,
          brief: ctx.brief.data,
          approved: ctx.approved,
          recipient: {
            name:
              ctx.person.displayName ??
              ctx.person.name ??
              [ctx.person.firstName, ctx.person.lastName]
                .filter(Boolean)
                .join(" "),
            jobTitle: ctx.person.jobTitle ?? ctx.person.title,
            context: {
              relationships: ctx.contact.relationships,
              productRelationships: ctx.contact.productRelationships,
              interactions: ctx.contact.interactions
                .slice(0, 10)
                .map((i) => ({ ...i, body: String(i.body).slice(0, 1500) })),
            },
          },
          // Authoritative context is supplied once above. Do not repeat the NBA's
          // full approved snapshots, contact history and capability catalogue.
          campaign: ctx.campaign ? {
            setup: (ctx.campaign.data as Document).setup,
            engagementPolicy: (ctx.campaign.data as Document).engagementPolicy,
            restriction: (ctx.campaign.data as Document).restriction,
            approvedResearch: (ctx.campaign.data as Document).approvedResearch,
          } : null,
          currentDraft: input.currentDraft ?? ctx.old?.content,
          preferredCtaAssetId: input.ctaAssetId,
          candidates: ctx.candidates.slice(0, 60).map((r) => ({
            id: r.id,
            title: r.data.title,
            description: r.data.description,
            scope: r.data.scope,
            restrictions: r.data.restrictions,
            text: String(r.data.text).slice(0, 4000),
          })),
          evidence: ctx.sources.map((r) => ({
            id: r.id,
            text:
              r.data.visibility === "private"
                ? "Private original withheld; use only the approved claims and evidence below within their restrictions."
                : String(r.data.text).slice(0, 10000),
            claims: r.data.claims,
            evidence: r.data.evidence,
            restrictions: r.data.restrictions,
          })),
        });
        usage = output.usage;
        const content = emailOutput.parse(output.result);
        if (!validateEmailBody(content.body)) {
          content.body = content.body
            .replace(/(?:https?:\/\/|www\.)\S+/gi, "[unverified link removed]")
            .replace(/<\/?[a-z][^>]*>/gi, "");
          content.reviewIssues = [
            "An unverified link or markup was removed. Review the body and structured CTA.",
            ...content.reviewIssues,
          ].slice(0, 20);
        }
        content.subject = content.subject.replace(/[\r\n]+/g, " ");
        const chosen = ctx.candidates.find(
          (r) => r.id === (input.ctaAssetId || content.ctaAssetId),
        );
        if (content.ctaAssetId && !chosen) {
          content.ctaAssetId = "";
          content.reviewIssues = [
            "Select a permitted Library destination before approving this email.",
            ...content.reviewIssues,
          ].slice(0, 20);
        }
        if (chosen) content.ctaAssetId = chosen.id;
        if (
          !chosen &&
          String(ctx.brief.data.cta).trim() &&
          !/\brepl(y|ies)|respond|answer this email/i.test(
            String(ctx.brief.data.cta),
          )
        )
          content.reviewIssues = [
            ...new Set([
              ...content.reviewIssues,
              "The brief requests a CTA destination. Select a suitable permitted page or revise the brief for a reply-based CTA.",
            ]),
          ].slice(0, 20);
        return await mongo.withTransaction(async (db, s) => {
          const actor = await contentAccess(db, config, user, w, "update", s);
          await lockIcpWorkspace(db, w, s);
          await guard?.(db, s);
          const fresh = await context(db, user, w, input, s);
          if (fresh.hash !== ctx.hash)
            throw new HiveConflict(
              "The brief, recipient, Library or brand changed during generation. Retry with current context.",
            );
          const row = emailRecord.parse({
            id: ctx.old?.id ?? generatePlatformId("event"),
            version: (ctx.old?.version ?? 0) + 1,
            status: "draft",
            briefId: ctx.brief.id,
            briefVersion: ctx.brief.version,
            contactId: input.contactId,
            recipientName: String(
              ctx.person.displayName ??
                ctx.person.name ??
                [ctx.person.firstName, ctx.person.lastName]
                  .filter(Boolean)
                  .join(" "),
            ),
            brandId: (ctx.brief.data.scope as { brandId: string }).brandId,
            campaignId: input.campaignId,
            campaignVersion: input.campaignVersion,
            content,
            ctaUrl: chosen?.data.url ?? "",
            contextHash: ctx.hash,
            sourceVersions: ctx.sourceVersions,
            updatedAt: new Date().toISOString(),
            brandNotice: ctx.approved.approvedBrandBrief
              ? "Uses the approved Brand Kit."
              : "No approved Brand Kit: neutral British English.",
            libraryAssetId:
              ctx.old?.libraryAssetId ?? generatePlatformId("event"),
            nbaDecisionId,
          });
          await persist(db, s, w, actor, row, input.requestKey, hash);
          await db.collection("events").updateOne(
            { id: reserved.row!.id, workspaceId: w },
            {
              $set: {
                "payload.status": "completed",
                "payload.result": row,
                "payload.usage": usage,
              },
            },
            { session: s },
          );
          return row;
        });
      } catch (error) {
        await (await mongo.database()).collection("events").updateOne(
          { id: reserved.row!.id, workspaceId: w },
          {
            $set: {
              "payload.status": "failed",
              "payload.failureCode": error && typeof error === "object" && "generationFailureCode" in error &&
                ["empty_output", "invalid_json", "result_contract", "refusal", "incomplete_output"].includes(String(error.generationFailureCode))
                ? String(error.generationFailureCode) : "generation_failed",
              ...(usage
                ? { "payload.usage": usage }
                : error && typeof error === "object" && "usage" in error
                  ? { "payload.usage": error.usage }
                  : {}),
            },
          },
        );
        throw error;
      }
    },
    async mutate(user: AuthenticatedUser, w: string, id: string, raw: unknown) {
      if (!mongo.withTransaction)
        throw new HiveConflict("Transactions unavailable.");
      const input = emailMutation.parse(raw),
        hash = fingerprint({ id, ...input });
      return mongo.withTransaction(async (db, s) => {
        const actor = await contentAccess(
          db,
          config,
          user,
          w,
          input.operation === "approve" ? "approve" : "update",
          s,
        );
        await contactContextAccess(db, config, user, w, "read", s);
        await lockIcpWorkspace(db, w, s);
        const prior = await db.collection("events").findOne(
          {
            workspaceId: w,
            eventType: "email_content_record",
            "payload.requestKey": input.requestKey,
          },
          { session: s },
        );
        if (prior) {
          if (prior.payload.requestHash !== hash)
            throw new HiveConflict("Request key conflict.");
          return emailRecord.parse(prior.payload.record);
        }
        const old = await latest(db, w, id, s);
        if (
          !old ||
          old.status === "removed" ||
          old.version !== input.expectedVersion
        )
          throw new HiveConflict("Draft changed. Reload before saving.");
        const content =
          input.operation === "save"
            ? emailOutput.parse(input.content)
            : old.content;
        let ctaUrl = old.ctaUrl;
        if (input.operation !== "remove") {
          const ctx = await context(
            db,
            user,
            w,
            emailRequest.parse({
              requestKey: input.requestKey,
              briefId: old.briefId,
              briefVersion: old.briefVersion,
              contactId: old.contactId,
              campaignId: old.campaignId,
              campaignVersion: old.campaignVersion,
              instruction: "",
            }),
            s,
          );
          if (input.operation === "approve" && ctx.hash !== old.contextHash)
            throw new HiveConflict(
              "Context changed. Regenerate and review before approving.",
            );
          if (!validateEmailBody(content.body))
            throw new HiveConflict(
              "Use the CTA selector for links and plain text for the email body.",
            );
          const chosen = ctx.candidates.find(
            (r) => r.id === content.ctaAssetId,
          );
          if (content.ctaAssetId && !chosen)
            throw new HiveConflict(
              "Select a current permitted CTA in the Library.",
            );
          ctaUrl = String(chosen?.data.url ?? "");
          if (
            input.operation === "approve" &&
            !chosen &&
            String(ctx.brief.data.cta).trim() &&
            !/\brepl(y|ies)|respond|answer this email/i.test(
              String(ctx.brief.data.cta),
            )
          )
            throw new HiveConflict(
              "This brief requires a CTA destination. Select a permitted page or revise the brief.",
            );
          if (input.operation === "approve" && content.reviewIssues.length)
            throw new HiveConflict(
              "Resolve the review issues before approving this draft.",
            );
        }
        return persist(
          db,
          s,
          w,
          actor,
          {
            ...old,
            version: old.version + 1,
            status:
              input.operation === "remove"
                ? "removed"
                : input.operation === "approve"
                  ? "approved"
                  : "draft",
            content,
            ctaUrl,
            updatedAt: new Date().toISOString(),
          },
          input.requestKey,
          hash,
        );
      });
    },
    async candidates(user: AuthenticatedUser, w: string, briefId: string) {
      const db = await mongo.database();
      await contentAccess(db, config, user, w, "read");
      const all = await allContent(db, w),
        brief = all.find(
          (r) =>
            r.id === briefId && r.kind === "brief" && r.status === "approved",
        );
      if (!brief) throw new HiveConflict("Select an approved brief.");
      return emailAssets(all, brief).map((r) => ({
        id: r.id,
        title: r.data.title,
        url: r.data.url,
        version: r.version,
        description: r.data.description,
      }));
    },
  };
}
