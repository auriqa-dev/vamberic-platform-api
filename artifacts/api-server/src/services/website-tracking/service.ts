import { campaignTrackedUrl } from "../campaigns/tracking";
import { resolveTxt } from "node:dns/promises";
import type { Db, ClientSession, Document } from "mongodb";
import { z } from "zod";
import { EventSchema, generatePlatformId } from "../../domain";
import type { AppConfig } from "../../config";
import type { MongoService } from "../mongo";
import type { AuthenticatedUser } from "../../middlewares/auth";
import { resolveHvmContext } from "../hvm-context";
import { AuthorizationDenied } from "../../authorization/policy";
import { platformIdSchema } from "../../domain";
import { lockIcpWorkspace } from "../icp/access";
import { HiveConflict } from "../hive-definitions";
import {
  settings,
  secret,
  digest,
  trackingBase,
  browserEvent,
  safePath,
} from "./model";
import { outcome } from "../measurement/model";
import { queueFeedback } from "../measurement/store";
const siteKind = "website_tracking_site";
async function contentAccess(
  db: Db,
  config: AppConfig,
  u: AuthenticatedUser,
  w: string,
  action: "read" | "update",
  s?: ClientSession,
) {
  platformIdSchema("workspace").parse(w);
  const r = await resolveHvmContext(db, config, u, s);
  if (r.context.application !== "hvmapp" || r.context.actor.type !== "human")
    throw new AuthorizationDenied();
  r.authority.scopeFilter(r.context, action, {
    type: "workspace_integrations",
    workspaceId: w,
  });
}

export function trackingRow(
  w: string,
  type: string,
  payload: Document,
  id = generatePlatformId("event"),
) {
  const now = new Date();
  return EventSchema.parse({
    id,
    workspaceId: w,
    eventType: type,
    occurredAt: now,
    createdAt: now,
    updatedAt: now,
    payload,
  });
}
export async function trackingSite(db: Db, id: string, s?: ClientSession) {
  return db
    .collection("events")
    .findOne({ id, eventType: siteKind }, { session: s });
}
function active(r: Document | null) {
  return !!r?.payload.enabled && !!r.payload.verifiedAt && !r.payload.revoked;
}
export async function prepareTracking(
  db: Db,
  w: string,
  draft: Document,
  communicationId: string,
  testOnly: boolean,
  s: ClientSession,
) {
  const base = trackingBase();
  if (!base || !draft.ctaUrl) return null;
  const url = new URL(campaignTrackedUrl(draft.ctaUrl, draft.campaignId, draft.id, testOnly));
  const site = await db.collection("events").findOne(
    {
      workspaceId: w,
      eventType: siteKind,
      "payload.brandId": draft.brandId,
      "payload.origin": url.origin,
      "payload.enabled": true,
      "payload.revoked": false,
    },
    { session: s },
  );
  if (!active(site) || (!testOnly && site!.payload.testOnly)) return null;
  const id = generatePlatformId("event"),
    token = secret();
  const row = trackingRow(
    w,
    "website_tracking_link",
    {
      siteId: site!.id,
      tokenHash: digest(token),
      communicationId,
      destination: url.href,
      testOnly,
      expiresAt: new Date(Date.now() + site!.payload.retentionDays * 86400000),
      revoked: false,
    },
    id,
  );
  await db.collection("events").insertOne(row, { session: s });
  return {
    linkId: id,
    siteId: site!.id,
    originalUrl: url.href,
    url: `${base}/r/${id}.${token}`,
    testOnly,
  };
}
export async function readToken(
  db: Db,
  token: string,
  type: string,
  s?: ClientSession,
) {
  if (token.length > 160) return null;
  const [id, value, extra] = token.split(".");
  if (
    extra ||
    !/^event_[a-z0-9]{26}$/.test(id || "") ||
    !/^[a-zA-Z0-9_-]{43}$/.test(value || "")
  )
    return null;
  return db
    .collection("events")
    .findOne(
      { id, eventType: type, "payload.tokenHash": digest(value) },
      { session: s },
    );
}
export function createWebsiteTracking(
  config: AppConfig,
  mongo: MongoService,
  dependencies: {
    dns?: (host: string) => Promise<string[][]>;
    recordingError?: () => void;
  } = {},
) {
  async function transaction<T>(
    w: string,
    fn: (db: Db, s: ClientSession) => Promise<T>,
  ) {
    if (!mongo.withTransaction) throw new Error("Transactions required");
    return mongo.withTransaction(async (db, s) => {
      await lockIcpWorkspace(db, w, s);
      return fn(db, s);
    });
  }
  async function list(u: AuthenticatedUser, w: string) {
    const db = await mongo.database();
    await contentAccess(db, config, u, w, "read");
    let canManage = true;
    try {
      await contentAccess(db, config, u, w, "update");
    } catch {
      canManage = false;
    }
    const sites = await db
      .collection("events")
      .find({ workspaceId: w, eventType: siteKind })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();
    const brands = await db
      .collection("brands")
      .find({ workspaceId: w })
      .toArray();
    return {
      available: !!trackingBase(),
      canManage,
      brands: brands.map((b) => ({ id: b.id, name: b.name || "Brand" })),
      sites: sites.map((r) => ({
        id: r.id,
        ...r.payload,
        expiresAt: undefined,
      })),
      base: trackingBase() || "",
    };
  }
  async function mutate(u: AuthenticatedUser, w: string, raw: unknown) {
    const i = z
      .object({
        id: z.string().default(""),
        expectedVersion: z.number().int().nonnegative(),
        operation: z.enum(["save", "verify", "revoke", "delete"]),
        settings: settings.optional(),
      })
      .strict()
      .parse(raw);
    const db = await mongo.database();
    await contentAccess(db, config, u, w, "update");
    const before = i.id
      ? await db
          .collection("events")
          .findOne({ workspaceId: w, id: i.id, eventType: siteKind })
      : null;
    let verified = false;
    if (i.operation === "verify") {
      if (!before) throw new HiveConflict("Website not found.");
      const host = new URL(before.payload.origin).hostname;
      const records = await Promise.race([
        (dependencies.dns || resolveTxt)(`_hvm-tracking.${host}`).catch(() => {
          throw new HiveConflict(
            "DNS record could not be read. Check the TXT value and try again.",
          );
        }),
        new Promise<never>((_, reject) => {
          const t = setTimeout(
            () => reject(new HiveConflict("DNS check timed out. Try again.")),
            5000,
          );
          t.unref();
        }),
      ]);
      verified = records.some(
        (row) => row.join("") === before.payload.verification,
      );
      if (!verified)
        throw new HiveConflict(
          "DNS record not found yet. Check the TXT value and try again.",
        );
    }
    await transaction(w, async (db, s) => {
      await contentAccess(db, config, u, w, "update", s);
      const old = i.id
        ? await db
            .collection("events")
            .findOne(
              { workspaceId: w, id: i.id, eventType: siteKind },
              { session: s },
            )
        : null;
      if ((old?.payload.version || 0) !== i.expectedVersion || (i.id && !old))
        throw new HiveConflict("Refresh the website before editing.");
      if (i.operation === "delete") {
        if (
          await db.collection("events").findOne(
            {
              workspaceId: w,
              eventType: "website_tracking_link",
              "payload.siteId": i.id,
            },
            { session: s },
          )
        )
          throw new HiveConflict(
            "This website has email links. Revoke it to preserve destinations and history.",
          );
        await db.collection("events").insertOne(
          trackingRow(w, "website_tracking_history", {
            siteId: i.id,
            operation: "delete",
            version: old!.payload.version + 1,
            actor: u.subject,
            issuer: u.issuer,
          }),
          { session: s },
        );
        await db
          .collection("events")
          .deleteOne(
            { workspaceId: w, id: i.id, eventType: siteKind },
            { session: s },
          );
        return;
      }
      const value =
        i.operation === "save" ? settings.parse(i.settings) : old!.payload;
      if (
        old &&
        (value.origin !== old.payload.origin ||
          value.brandId !== old.payload.brandId)
      )
        throw new HiveConflict(
          "Add a separate website when changing domain or brand.",
        );
      if (old?.payload.revoked)
        throw new HiveConflict(
          "Revoked installations cannot be reused. Add a new website.",
        );
      if (
        !(await db
          .collection("brands")
          .findOne({ workspaceId: w, id: value.brandId }, { session: s }))
      )
        throw new HiveConflict("Choose a brand in this workspace.");
      if (value.enabled && (!old?.payload.verifiedAt || !value.policyConfirmed))
        throw new HiveConflict(
          "Verify ownership and confirm your tracking policy before enabling.",
        );
      if (
        !old &&
        (await db.collection("events").findOne(
          {
            workspaceId: w,
            eventType: siteKind,
            "payload.origin": value.origin,
            "payload.brandId": value.brandId,
            "payload.revoked": false,
          },
          { session: s },
        ))
      )
        throw new HiveConflict(
          "This website is already configured for the brand.",
        );
      const payload = {
        ...value,
        version: (old?.payload.version || 0) + 1,
        verification: old?.payload.verification || `hvm=${secret()}`,
        verifiedAt: verified
          ? new Date().toISOString()
          : old?.payload.verifiedAt || null,
        revoked: i.operation === "revoke",
        enabled: i.operation === "revoke" ? false : value.enabled,
        lastReceivedAt: old?.payload.lastReceivedAt || null,
      };
      const row = trackingRow(w, siteKind, payload, old?.id);
      if (old)
        await db
          .collection("events")
          .replaceOne(
            { workspaceId: w, id: old.id, eventType: siteKind },
            row,
            { session: s },
          );
      else await db.collection("events").insertOne(row, { session: s });
      await db.collection("events").insertOne(
        trackingRow(w, "website_tracking_history", {
          siteId: row.id,
          operation: i.operation,
          version: payload.version,
          actor: u.subject,
          issuer: u.issuer,
          settings: {
            origin: payload.origin,
            brandId: payload.brandId,
            enabled: payload.enabled,
            testOnly: payload.testOnly,
            retentionDays: payload.retentionDays,
            policyConfirmed: payload.policyConfirmed,
            paths: payload.paths || [],
            events: payload.events || [],
          },
        }),
        { session: s },
      );
    });
    return list(u, w);
  }
  async function redirect(token: string, bot: boolean, record = true) {
    const db = await mongo.database(),
      link = await readToken(db, token, "website_tracking_link");
    if (!link) return null;
    // Destination is immutable and created only from an approved email CTA.
    let destination = link.payload.destination;
    if (!record) return destination;
    const site = await trackingSite(db, link.payload.siteId);
    if (
      !active(site) ||
      link.payload.revoked ||
      new Date(link.payload.expiresAt).getTime() <= Date.now()
    )
      return destination;
    let recorded = false;
    try {
      await transaction(link.workspaceId, async (db, s) => {
        const current = await trackingSite(db, site!.id, s);
        if (!active(current)) return;
        const comm = await db.collection("events").findOne(
          {
            workspaceId: link.workspaceId,
            id: link.payload.communicationId,
            eventType: "communication",
            "payload.status": "accepted",
          },
          { session: s },
        );
        if (!comm) return;
        recorded = true;
        await project(
          db,
          s,
          comm,
          current!,
          "cta_requested",
          bot ? "suspected_bot" : "unknown",
          "",
          generatePlatformId("event"),
        );
      });
      if (!bot && recorded) {
        const url = new URL(destination);
        url.hash =
          (url.hash ? url.hash.slice(1) + "&" : "") + "hvm_tracking=" + token;
        destination = url.href;
      }
    } catch {
      /* A recording failure must never break an otherwise valid CTA. */
      dependencies.recordingError?.();
    }
    return destination;
  }
  async function collect(
    id: string,
    origin: string,
    raw: unknown,
    bot: boolean,
  ) {
    const i = browserEvent.parse(raw),
      db = await mongo.database(),
      site = await trackingSite(db, id);
    if (!active(site) || site!.payload.origin !== origin)
      throw new HiveConflict("Tracking unavailable.");
    return transaction(site!.workspaceId, async (db, s) => {
      const current = await trackingSite(db, id, s);
      if (!active(current) || current!.payload.origin !== origin)
        throw new HiveConflict("Tracking unavailable.");
      let session: Document | null = i.session
        ? await readToken(db, i.session, "website_tracking_session", s)
        : null;
      if (
        session &&
        (session.payload.siteId !== id ||
          new Date(session.payload.expiresAt).getTime() <= Date.now())
      )
        session = null;
      let sessionToken = session ? i.session! : "";
      if (!session) {
        const link = i.link
          ? await readToken(db, i.link, "website_tracking_link", s)
          : null;
        const usable =
          link &&
          link.workspaceId === site!.workspaceId &&
          link.payload.siteId === id &&
          !link.payload.revoked &&
          new Date(link.payload.expiresAt).getTime() > Date.now();
        const sid = generatePlatformId("event"),
          token = secret();
        sessionToken = sid + "." + token;
        session = trackingRow(
          site!.workspaceId,
          "website_tracking_session",
          {
            siteId: id,
            testOnly:
              current!.payload.testOnly ||
              (usable && link.payload.testOnly) ||
              false,
            tokenHash: digest(token),
            communicationId: usable ? link.payload.communicationId : null,
            expiresAt: new Date(
              Math.min(
                Date.now() + 30 * 60000,
                usable ? new Date(link.payload.expiresAt).getTime() : Infinity,
              ),
            ),
            startedAt: Date.now(),
          },
          sid,
        );
        await db.collection("events").insertOne(session, { session: s });
      }
      const eventKey = `website:${id}:${i.eventId}`;
      if (
        await db.collection("events").findOne(
          {
            workspaceId: site!.workspaceId,
            eventType: "measurement_outcome",
            "payload.eventKey": eventKey,
          },
          { session: s },
        )
      )
        return { session: sessionToken };
      if (
        i.kind === "custom" &&
        (!i.name || !current!.payload.events.includes(i.name))
      )
        throw new HiveConflict("This event is not configured.");
      const comm = session.payload.communicationId
        ? await db.collection("events").findOne(
            {
              workspaceId: site!.workspaceId,
              id: session.payload.communicationId,
              eventType: "communication",
              "payload.status": "accepted",
            },
            { session: s },
          )
        : null;
      const path = safePath(i.path);
      // Store only known CTA paths; arbitrary URL paths can carry personal data.
      const page =
        (current!.payload.paths || []).includes(path) ||
        (comm?.payload.draft.ctaUrl &&
          new URL(comm.payload.draft.ctaUrl).pathname === path)
          ? path
          : "[other page]";
      const human =
        !bot &&
        i.kind === "engaged" &&
        Date.now() - session.payload.startedAt >= 2000;
      await project(
        db,
        s,
        comm,
        {
          ...current!,
          payload: {
            ...current!.payload,
            testOnly: current!.payload.testOnly || session.payload.testOnly,
          },
        },
        human
          ? "website_engaged"
          : i.kind === "custom"
            ? "website_event"
            : "website_view",
        bot ? "suspected_bot" : human ? "likely_human" : "unknown",
        page,
        i.eventId,
        i.name,
      );
      await db
        .collection("events")
        .updateOne(
          { id, workspaceId: site!.workspaceId, eventType: siteKind },
          { $set: { "payload.lastReceivedAt": new Date().toISOString() } },
          { session: s },
        );
      return { session: sessionToken };
    });
  }
  return { list, mutate, redirect, collect };
}
async function project(
  db: Db,
  s: ClientSession,
  comm: Document | null,
  site: Document,
  kind: string,
  automation: string,
  path: string,
  eventId: string,
  name?: string,
) {
  const p = comm?.payload,
    d = p?.draft,
    now = new Date();
  const value = outcome.parse({
    schemaVersion: 1,
    eventKey: `website:${site.id}:${eventId}`,
    kind,
    communicationId: comm?.id || "",
    contactId: d?.contactId || "",
    organisationId: p?.organisationId || undefined,
    brandId: site.payload.brandId,
    campaignId: d?.campaignId || undefined,
    offerId: d?.offerId || undefined,
    offerIds: p?.offerIds || [],
    draftId: d?.id || "",
    draftVersion: d?.version || 0,
    sourceId: site.id,
    sourceVersion: site.payload.version,
    occurredAt: now.toISOString(),
    provider: "website",
    fact: "observed",
    testOnly: site.payload.testOnly || !!p?.testOnly,
    cta: d ? { url: d.ctaUrl, assetId: d.content?.ctaAssetId } : undefined,
    website: {
      siteId: site.id,
      identity: comm ? "intended_recipient" : "anonymous",
      automation,
      path,
      ...(name ? { name } : {}),
      expiresAt: new Date(
        Date.now() + site.payload.retentionDays * 86400000,
      ).toISOString(),
    },
  });
  const row = trackingRow(site.workspaceId, "measurement_outcome", value);
  await db.collection("events").insertOne(row, { session: s });
  if (
    kind === "website_engaged" &&
    comm &&
    !value.testOnly &&
    (await db.collection("people").findOne(
      {
        workspaceId: site.workspaceId,
        id: value.contactId,
        archived: { $ne: true },
      },
      { session: s },
    ))
  )
    await queueFeedback(db, s, site.workspaceId, value, row.id);
}
