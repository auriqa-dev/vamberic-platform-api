import type { BrandImageStore } from "../brand-images";
import { readToken } from "../website-tracking/service";
import { similarity } from "../content-strategy/library-planning";
import { associateEnquiry } from "./association";
import { z } from "zod";
import type { Db, Document } from "mongodb";
import type { AppConfig } from "../../config";
import type { MongoService } from "../mongo";
import type { AuthenticatedUser } from "../../middlewares/auth";
import { generatePlatformId } from "../../domain";
import { resolveHvmContext } from "../hvm-context";
import { readCurrentBrandKit } from "../brand-kits";
import { projectBrandContext } from "../brand-context";
import { contentAccess, currentRecords } from "../content-strategy/application";
import { fullAssetText } from "../content-strategy/library-text";
import type { ContentGenerator } from "../content-strategy/generate";
import { trackingSite, trackingRow } from "../website-tracking/service";
import { lockIcpWorkspace } from "../icp/access";
import { HiveConflict } from "../hive-definitions";
import { publicChatAssets } from "./knowledge";
import {
  interactionSettings,
  messageInput,
  enquiryInput,
  secretHash,
  sessionSecret,
  safeReply,
  startInput,
} from "./model";
const settingsKind = "interaction_installation",
  sessionKind = "interaction_session",
  turnKind = "interaction_turn";
export function createInteraction(
  config: AppConfig,
  mongo: MongoService,
  generate?: ContentGenerator,
  imageStore?: BrandImageStore,
) {
  async function kit(db: Db, u: AuthenticatedUser, w: string, b: string) {
    const auth = await resolveHvmContext(db, config, u);
    return readCurrentBrandKit(db, auth.authority, auth.context, w, b);
  }
  async function assets(db: Db, w: string) {
    return currentRecords(
      await db
        .collection("events")
        .find({ workspaceId: w, eventType: "content_strategy_record" })
        .toArray(),
    );
  }
  async function list(u: AuthenticatedUser, w: string, cursor?: string) {
    const db = await mongo.database();
    await contentAccess(db, config, u, w, "read");
    const [beforeAt, beforeId] = cursor ? cursor.split("|") : [];
    if (cursor) {
      z.string().datetime().parse(beforeAt);
      z.string()
        .regex(/^event_[a-z0-9]{26}$/)
        .parse(beforeId);
    }
    const installations = await db
      .collection("events")
      .find({ workspaceId: w, eventType: settingsKind })
      .sort({ updatedAt: -1 })
      .toArray();
    const found = await db
      .collection("events")
      .find({
        workspaceId: w,
        eventType: { $in: [sessionKind, "interaction_enquiry"] },
        "payload.expired": { $ne: true },
        ...(cursor
          ? {
              $or: [
                { updatedAt: { $lt: new Date(beforeAt) } },
                { updatedAt: new Date(beforeAt), id: { $lt: beforeId } },
              ],
            }
          : {}),
      })
      .sort({ updatedAt: -1, id: -1 })
      .limit(201)
      .toArray();
    const rows = found.slice(0, 200),
      last = rows.at(-1);
    const allAssets = await assets(db, w);
    let canManage = false;
    try {
      await contentAccess(db, config, u, w, "approve");
      await contentAccess(db, config, u, w, "update");
      canManage = true;
    } catch {
      /* Read-only review remains available. */
    }
    return {
      canManage,
      nextCursor:
        found.length > 200 && last
          ? `${new Date(last.updatedAt).toISOString()}|${last.id}`
          : null,
      installations: installations
        .filter((r) => r.eventType === settingsKind)
        .map((r) => ({
          id: r.id,
          ...r.payload,
          archived: !!r.archived,
          publisher: undefined,
        })),
      conversations: rows
        .filter((r) => r.eventType !== settingsKind)
        .map((r) => ({
          id: r.id,
          kind: r.eventType,
          updatedAt: r.updatedAt,
          ...r.payload,
          tokenHash: undefined,
          trackingSessionId: undefined,
          archived: !!r.archived,
        })),
      sites: (
        await db
          .collection("events")
          .find({
            workspaceId: w,
            eventType: "website_tracking_site",
            "payload.revoked": false,
          })
          .toArray()
      ).map((r) => ({
        id: r.id,
        brandId: r.payload.brandId,
        origin: r.payload.origin,
        verified: !!r.payload.verifiedAt,
      })),
      assets: allAssets
        .filter((r) => r.kind === "asset" && r.status === "approved")
        .map((r) => ({
          id: r.id,
          title: r.data.title,
          brandId: (r.data.scope as Document)?.brandId,
          publicReady:
            publicChatAssets(
              allAssets,
              String((r.data.scope as Document)?.brandId),
              [r.id],
            ).length > 0,
        })),
    };
  }
  async function mutate(u: AuthenticatedUser, w: string, raw: unknown) {
    const i = z
      .object({
        id: z.string().default(""),
        expectedVersion: z.number().int().nonnegative(),
        operation: z.enum([
          "save",
          "disable",
          "archive",
          "resolve",
          "associate",
          "restore",
          "note",
        ]),
        settings: interactionSettings.optional(),
        note: z.string().trim().max(4000).optional(),
      })
      .strict()
      .parse(raw);
    if (!mongo.withTransaction)
      throw new HiveConflict("Transactions unavailable");
    await mongo.withTransaction(async (db, s) => {
      await contentAccess(
        db,
        config,
        u,
        w,
        i.operation === "save" ? "approve" : "update",
        s,
      );
      await lockIcpWorkspace(db, w, s);
      const old = i.id
        ? await db.collection("events").findOne(
            {
              id: i.id,
              workspaceId: w,
              eventType: {
                $in: [settingsKind, sessionKind, "interaction_enquiry"],
              },
            },
            { session: s },
          )
        : null;
      if ((i.id && !old) || i.expectedVersion !== (old?.payload.version ?? 0))
        throw new HiveConflict("This record changed. Refresh before saving.");
      let recordId = old?.id;
      if (i.operation === "save") {
        if (old && old.eventType !== settingsKind)
          throw new HiveConflict(
            "Only website installations have chat settings.",
          );
        const v = interactionSettings.parse(i.settings),
          site = await trackingSite(db, v.siteId, s);
        if (
          !site ||
          site.workspaceId !== w ||
          site.payload.brandId !== v.brandId ||
          site.payload.revoked
        )
          throw new HiveConflict("Choose a website registered to this brand.");
        if (
          old &&
          (old.payload.brandId !== v.brandId || old.payload.siteId !== v.siteId)
        )
          throw new HiveConflict(
            "Create a separate installation for a different client brand or website. Existing conversations keep their original scope.",
          );
        const current = await kit(db, u, w, v.brandId);
        if (
          v.enabled &&
          (!site.payload.verifiedAt ||
            !current?.kit.chatPersonality?.displayName ||
            !current.kit.chatPersonality.greeting)
        )
          throw new HiveConflict(
            "Verify the website and save a chat name and greeting in Brand Kit before publishing.",
          );
        const selected = publicChatAssets(
          await assets(db, w),
          v.brandId,
          v.publicAssetIds,
        );
        if (selected.length !== v.publicAssetIds.length)
          throw new HiveConflict(
            "Each selected asset must be approved, published, owned/licensed, unrestricted and allow ‘website chat’ or ‘public chat’.",
          );
        const id = old?.id || generatePlatformId("event"),
          row = trackingRow(
            w,
            settingsKind,
            { ...v, version: i.expectedVersion + 1, publisher: u },
            id,
          );
        recordId = id;
        await db.collection("events").replaceOne({ id, workspaceId: w }, row, {
          upsert: true,
          session: s,
        });
      } else {
        if (
          !old ||
          old.payload.expired ||
          (old.payload.expiresAt &&
            Date.parse(old.payload.expiresAt) <= Date.now())
        )
          throw new HiveConflict(
            "Record unavailable or retention period ended.",
          );
        if (old.archived && !["restore", "archive"].includes(i.operation))
          throw new HiveConflict("Restore the record before changing it.");
        if (
          i.operation === "note" &&
          (old.eventType === settingsKind || i.note === undefined)
        )
          throw new HiveConflict(
            "Add a review note to a conversation or enquiry.",
          );
        if (i.operation === "resolve" && old.eventType === settingsKind)
          throw new HiveConflict(
            "Only conversations and enquiries can be resolved.",
          );
        if (i.operation === "associate")
          await associateEnquiry(db, s, config, u, w, old);
        if (i.operation === "disable" && old.eventType !== settingsKind)
          throw new HiveConflict("Only website installations can be disabled");
        await db.collection("events").updateOne(
          { id: old.id, workspaceId: w },
          {
            $set: {
              updatedAt: new Date(),
              ...(i.operation === "archive" ? { archived: true } : {}),
              ...(i.operation === "restore"
                ? {
                    archived: false,
                    ...(old.eventType === settingsKind
                      ? { "payload.enabled": false }
                      : {}),
                  }
                : {}),
              ...(i.operation === "note"
                ? { "payload.reviewNote": i.note }
                : {}),
              ...(i.operation === "disable"
                ? { "payload.enabled": false }
                : {}),
              ...(i.operation === "resolve"
                ? { "payload.status": "resolved" }
                : {}),
              "payload.version": i.expectedVersion + 1,
            },
          },
          { session: s },
        );
      }
      await db.collection("events").insertOne(
        trackingRow(w, "interaction_management_history", {
          recordId,
          operation: i.operation,
          actor: u,
        }),
        { session: s },
      );
    });
    return list(u, w);
  }
  async function installation(id: string, origin: string) {
    const db = await mongo.database(),
      r = await db.collection("events").findOne({
        id,
        eventType: settingsKind,
        archived: { $ne: true },
        "payload.enabled": true,
      });
    if (!r) throw new HiveConflict("Chat is unavailable.");
    const definition = await db.collection("agent_definitions").findOne({
      key: "website_interaction",
      version: 1,
      status: "active",
      archived: false,
    });
    if (!definition)
      throw new HiveConflict("The Interaction Agent has not been published.");
    const site = await trackingSite(db, r.payload.siteId);
    if (
      !site ||
      site.workspaceId !== r.workspaceId ||
      site.payload.brandId !== r.payload.brandId ||
      site.payload.origin !== origin ||
      !site.payload.verifiedAt ||
      site.payload.revoked
    )
      throw new HiveConflict("Website is not authorised.");
    // Recheck the publishing operator's current authority; handover/revocation stops public access.
    await contentAccess(
      db,
      config,
      r.payload.publisher,
      r.workspaceId,
      "approve",
    );
    const current = await kit(
      db,
      r.payload.publisher,
      r.workspaceId,
      r.payload.brandId,
    );
    if (!current?.kit.chatPersonality?.displayName)
      throw new HiveConflict("Chat identity is unavailable.");
    return { db, r, site, current };
  }
  async function avatar(id: string, origin: string) {
    const { r, current } = await installation(id, origin);
    const digest = current.kit.chatPersonality?.avatarAssetId;
    if (!imageStore || !digest || !/^[a-f0-9]{64}$/.test(digest)) return null;
    const asset = current.kit.assets.find(
      (a) =>
        a.status === "approved" &&
        a.object.bucket === imageStore.bucket &&
        a.object.key.startsWith(
          `brand-images/${r.workspaceId}/${r.payload.brandId}/`,
        ) &&
        a.object.key.endsWith(`/${digest}.png`) &&
        a.object.versionId,
    );
    if (!asset) return null;
    return imageStore.get(asset.object.key, asset.object.versionId!);
  }
  async function publicConfig(id: string, origin: string) {
    const { r, current } = await installation(id, origin);
    const p = current.kit.chatPersonality!;
    return {
      displayName: p.displayName,
      hasAvatar: !!p.avatarAssetId,
      greeting: p.greeting || "How can I help?",
      openingQuestions: p.openingQuestions || [],
      privacyUrl: r.payload.privacyUrl,
      aiDisclosure: "You are speaking with an AI assistant.",
      handoffEmail: r.payload.handoffEmail,
      bookingUrl: r.payload.bookingUrl,
    };
  }
  async function start(id: string, origin: string, raw: unknown = {}) {
    const input = startInput.parse(raw);
    const { db, r } = await installation(id, origin),
      token = sessionSecret(),
      sessionId = generatePlatformId("event");
    const attribution = input.trackingSession
      ? await readToken(db, input.trackingSession, "website_tracking_session")
      : null;
    const usable =
      attribution &&
      attribution.workspaceId === r.workspaceId &&
      attribution.payload.siteId === r.payload.siteId &&
      !attribution.archived &&
      !attribution.payload.revoked &&
      new Date(attribution.payload.expiresAt).getTime() > Date.now();
    await db.collection("events").insertOne(
      trackingRow(
        r.workspaceId,
        sessionKind,
        {
          installationId: id,
          ...(usable
            ? {
                trackingSessionId: attribution.id,
                attributionTestOnly: !!attribution.payload.testOnly,
              }
            : {}),
          tokenHash: secretHash(token),
          version: 1,
          status: "open",
          testOnly:
            r.payload.testOnly || !!(usable && attribution.payload.testOnly),
          brandId: r.payload.brandId,
          expiresAt: new Date(
            Date.now() + r.payload.retentionDays * 86400000,
          ).toISOString(),
        },
        sessionId,
      ),
    );
    return { sessionId, token };
  }
  async function session(
    id: string,
    origin: string,
    sessionId: string,
    token: string,
  ) {
    const x = await installation(id, origin),
      row = await x.db.collection("events").findOne({
        id: sessionId,
        workspaceId: x.r.workspaceId,
        eventType: sessionKind,
        archived: { $ne: true },
        "payload.installationId": id,
        "payload.brandId": x.r.payload.brandId,
        "payload.tokenHash": secretHash(token),
      });
    if (
      !row ||
      Date.parse(row.payload.expiresAt) < Date.now() ||
      row.payload.status !== "open"
    )
      throw new HiveConflict("Start a new conversation.");
    return { ...x, row };
  }
  async function send(
    id: string,
    origin: string,
    sessionId: string,
    token: string,
    raw: unknown,
  ) {
    const i = messageInput.parse(raw),
      x = await session(id, origin, sessionId, token),
      { db, r, current } = x;
    if (!mongo.withTransaction)
      throw new HiveConflict("Chat temporarily unavailable.");
    const key = `${sessionId}:${i.requestKey}`,
      inputHash = secretHash(i.message);
    const claim = await mongo.withTransaction(async (db, s) => {
      await lockIcpWorkspace(db, r.workspaceId, s);
      const prior = await db.collection("events").findOne(
        {
          workspaceId: r.workspaceId,
          eventType: turnKind,
          "payload.key": key,
        },
        { session: s },
      );
      if (prior) {
        if (prior.payload.inputHash !== inputHash)
          throw new HiveConflict("Request changed. Start a new message.");
        return prior;
      }
      const pending = await db.collection("events").findOne(
        {
          workspaceId: r.workspaceId,
          eventType: turnKind,
          "payload.sessionId": sessionId,
          "payload.status": "working",
          "payload.startedAt": { $gt: Date.now() - 90000 },
        },
        { session: s },
      );
      if (pending) throw new HiveConflict("An answer is still being prepared.");
      const row = trackingRow(r.workspaceId, turnKind, {
        key,
        inputHash,
        sessionId,
        message: i.message,
        status: "working",
        startedAt: Date.now(),
        kitId: current.kit.id,
        kitRevision: current.kit.updatedAt.toISOString(),
        expiresAt: x.row.payload.expiresAt,
      });
      await db.collection("events").insertOne(row, { session: s });
      return { ...row, claimed: true };
    });
    if (!claim.claimed) {
      if (
        claim.payload.status === "working" &&
        claim.payload.startedAt < Date.now() - 90000
      ) {
        await db.collection("events").updateOne(
          {
            id: claim.id,
            workspaceId: r.workspaceId,
            "payload.status": "working",
          },
          { $set: { "payload.status": "failed", updatedAt: new Date() } },
        );
        throw new HiveConflict(
          "The previous attempt failed. Your message is saved; send again to retry.",
        );
      }
      if (claim.payload.status === "complete") {
        const nowAllowed = publicChatAssets(
          await assets(db, r.workspaceId),
          r.payload.brandId,
          r.payload.publicAssetIds,
        );
        if (
          (claim.payload.sources || []).some(
            (source: Document) =>
              !nowAllowed.some(
                (a) => a.id === source.id && a.version === source.version,
              ),
          )
        )
          throw new HiveConflict(
            "The approved information changed. Send a new message for an updated answer.",
          );
        return claim.payload.reply;
      }
      throw new HiveConflict(
        claim.payload.status === "working"
          ? "The answer is still being prepared. Check again shortly."
          : "The previous attempt failed. Your message is saved; send again to retry.",
      );
    }
    let recordedUsage: unknown = null;
    try {
      const allowed = publicChatAssets(
        await assets(db, r.workspaceId),
        r.payload.brandId,
        r.payload.publicAssetIds,
      );
      const sources = await Promise.all(
        allowed
          .sort(
            (a, b) =>
              similarity(
                i.message,
                String(b.data.title) + " " + String(b.data.description),
              ) -
              similarity(
                i.message,
                String(a.data.title) + " " + String(a.data.description),
              ),
          )
          .slice(0, 8)
          .map(async (a) => {
            const full = await fullAssetText(db, r.workspaceId, a);
            return {
              id: a.id,
              version: a.version,
              title: a.data.title,
              url: String(a.data.url),
              text: String(full.data.text).slice(0, 8000),
            };
          }),
      );
      const history = (
        await db
          .collection("events")
          .find({
            workspaceId: r.workspaceId,
            eventType: turnKind,
            "payload.sessionId": sessionId,
            "payload.status": "complete",
          })
          .sort({ createdAt: -1 })
          .limit(12)
          .toArray()
      )
        .reverse()
        // Previous replies cannot reintroduce facts withdrawn from public knowledge.
        .filter((t) =>
          (t.payload.sources || []).every((source: Document) =>
            allowed.some(
              (a) => a.id === source.id && a.version === source.version,
            ),
          ),
        )
        .map((t) => ({
          visitor: t.payload.message,
          assistant: t.payload.reply.answer,
        }));
      // No private company, offer or contact records enter the public model context.
      const style = projectBrandContext(current.kit, "interaction");
      const publicStyle = {
        format: style.format,
        conventions: style.conventions,
        personality: style.personality,
        tone: style.tone,
        writingStyle: style.writingStyle,
        terminology: style.terminology,
      };
      if (sources.length && !generate)
        throw new Error("Generation unavailable");
      const generated =
        sources.length && generate
          ? await generate("interaction", {
              identity: current.kit.chatPersonality,
              brand: publicStyle,
              sources,
              history,
              message: i.message,
              bookingAvailable: !!r.payload.bookingUrl,
            })
          : null;
      recordedUsage = generated?.usage || null;
      const reply = generated
        ? safeReply(generated.result, sources, r.payload.bookingUrl)
        : {
            answer:
              current.kit.chatPersonality?.uncertaintyWording ||
              "I don’t have enough approved information to answer that. You can leave an enquiry for the team.",
            sourceIds: [],
            nextStep: "human_help",
            ctaAssetId: "",
            ctaUrl: "",
            qualificationEvidence: [],
            uncertainties: ["Public knowledge unavailable"],
          };
      const refreshed = await session(id, origin, sessionId, token); // Publication and access can be revoked during a provider request.
      if (
        refreshed.current.kit.id !== current.kit.id ||
        refreshed.current.kit.updatedAt.toISOString() !==
          current.kit.updatedAt.toISOString()
      )
        throw new Error("Brand guidance changed");
      const nowAllowed = publicChatAssets(
        await assets(db, r.workspaceId),
        r.payload.brandId,
        r.payload.publicAssetIds,
      );
      if (
        sources.some(
          (a) =>
            !nowAllowed.some((b) => b.id === a.id && b.version === a.version),
        )
      )
        throw new Error("Knowledge changed");
      const completed = await db.collection("events").updateOne(
        {
          id: claim.id,
          workspaceId: r.workspaceId,
          "payload.status": "working",
        },
        {
          $set: {
            "payload.status": "complete",
            "payload.reply": reply,
            "payload.usage": generated?.usage || null,
            "payload.sources": sources.map(({ id, version }) => ({
              id,
              version,
            })),
            updatedAt: new Date(),
          },
        },
      );
      if (completed.matchedCount !== 1)
        throw new Error("Conversation attempt expired");
      return reply;
    } catch (error) {
      await db.collection("events").updateOne(
        {
          id: claim.id,
          workspaceId: r.workspaceId,
          "payload.status": "working",
        },
        {
          $set: {
            "payload.status": "failed",
            "payload.usage":
              recordedUsage ||
              (error && typeof error === "object" && "usage" in error
                ? error.usage
                : null),
            updatedAt: new Date(),
          },
        },
      );
      throw new HiveConflict(
        "I couldn’t prepare an answer. Your message is saved; please retry or leave an enquiry.",
      );
    }
  }
  async function enquire(
    id: string,
    origin: string,
    sessionId: string,
    token: string,
    raw: unknown,
  ) {
    const input = enquiryInput.parse(raw),
      x = await session(id, origin, sessionId, token);
    if (input.website) throw new HiveConflict("Unable to submit this enquiry.");
    if (!mongo.withTransaction)
      throw new HiveConflict("Enquiries temporarily unavailable.");
    return mongo.withTransaction(async (db, s) => {
      await lockIcpWorkspace(db, x.r.workspaceId, s);
      const key = `${sessionId}:${input.requestKey}`,
        old = await db.collection("events").findOne(
          {
            workspaceId: x.r.workspaceId,
            eventType: "interaction_enquiry",
            "payload.key": key,
          },
          { session: s },
        );
      if (old) {
        if (old.payload.inputHash !== secretHash(JSON.stringify(input)))
          throw new HiveConflict(
            "This enquiry changed. Start a new submission.",
          );
        return { id: old.id, message: "Your enquiry has been received." };
      }
      const row = trackingRow(x.r.workspaceId, "interaction_enquiry", {
        key,
        inputHash: secretHash(JSON.stringify(input)),
        sessionId,
        installationId: id,
        brandId: x.r.payload.brandId,
        version: 1,
        status: "review_required",
        testOnly: x.r.payload.testOnly || !!x.row.payload.testOnly,
        ...(x.row.payload.trackingSessionId
          ? { trackingSessionId: x.row.payload.trackingSessionId }
          : {}),
        visitor: {
          name: input.name,
          email: input.email.toLowerCase(),
          organisation: input.organisation,
          message: input.message,
        },
        privacyAcknowledgedAt: new Date().toISOString(),
        identityConfidence: "visitor_supplied_unverified",
        marketingPermission: "not_granted",
        expiresAt: x.row.payload.expiresAt,
      });
      await db.collection("events").insertOne(row, { session: s });
      return {
        id: row.id,
        message:
          "Your enquiry has been received. The team can review it in HVM.",
      };
    });
  }
  async function transcript(u: AuthenticatedUser, w: string, id: string) {
    const db = await mongo.database();
    await contentAccess(db, config, u, w, "read");
    const row = await db
      .collection("events")
      .findOne({ id, workspaceId: w, eventType: sessionKind });
    if (!row) throw new HiveConflict("Conversation unavailable");
    return (
      await db
        .collection("events")
        .find({ workspaceId: w, eventType: turnKind, "payload.sessionId": id })
        .sort({ createdAt: 1 })
        .toArray()
    ).map((r) => ({
      id: r.id,
      message: r.payload.message || "Content removed under retention policy.",
      status: r.payload.status,
      reply: r.payload.reply,
      kitId: r.payload.kitId,
      sources: r.payload.sources,
    }));
  }
  return {
    list,
    mutate,
    publicConfig,
    avatar,
    start,
    send,
    enquire,
    transcript,
  };
}
