import { latestJourney } from "../campaigns/journey";
import { readBusinessOutcomes } from "../business-outcomes/service";
import { z } from "zod";
import type { Db, ClientSession } from "mongodb";
import type { AppConfig } from "../../config";
import type { AuthenticatedUser } from "../../middlewares/auth";
import type { MongoService } from "../mongo";
import {
  EventSchema,
  generatePlatformId,
  platformIdSchema,
} from "../../domain";
import { resolveHvmContext } from "../hvm-context";
import { AuthorizationDenied } from "../../authorization/policy";
import { HiveConflict } from "../hive-definitions";
import { lockIcpWorkspace } from "../icp/access";
import { createGa4Application } from "../ga4/application";
import { Ga4Error } from "../ga4/google";
import { attribution, defaultWindow, reportWindow } from "../ga4/reporting";
import { readMeasurement } from "../measurement/read";
export const baselineNotes = z
  .object({
    label: z.string().trim().min(1).max(120),
    customerCount: z.number().int().min(0).max(100000000).nullable(),
    customerNote: z.string().trim().max(2000),
  })
  .strict()
  .refine(
    (v) => v.customerCount === null || v.customerNote.length > 0,
    "Explain the source and as-of date of the customer total.",
  );
const baselineInput = z
  .object({
    action: z.enum(["capture", "correct", "archive"]),
    expectedVersion: z.string().nullable(),
    requestId: z.string().uuid(),
    window: reportWindow.optional(),
    notes: baselineNotes.optional(),
  })
  .strict();
const reportInput = z
  .object({
    window: reportWindow,
    campaignId: platformIdSchema("campaign").optional(),
  })
  .strict();
export function createPerformanceService(
  config: AppConfig,
  mongo: MongoService,
  ga4: Pick<
    ReturnType<typeof createGa4Application>,
    "read" | "report"
  > = createGa4Application(config, mongo),
) {
  async function access(
    db: Db,
    user: AuthenticatedUser,
    w: string,
    action: "read" | "update",
    session?: ClientSession,
  ) {
    platformIdSchema("workspace").parse(w);
    const r = await resolveHvmContext(db, config, user, session);
    if (r.context.application !== "hvmapp" || r.context.actor.type !== "human")
      throw new AuthorizationDenied();
    for (const type of ["campaigns", "workspace_integrations"] as const)
      r.authority.scopeFilter(r.context, action, { type, workspaceId: w });
    // Native outcome details contain contacts; preserve their read authority too.
    r.authority.scopeFilter(r.context, "read", {
      type: "people",
      workspaceId: w,
    });
    return r.context.actor;
  }
  async function latest(
    db: Db,
    w: string,
    eventType: string,
    extra: Record<string, unknown> = {},
    session?: ClientSession,
  ) {
    return db
      .collection("events")
      .findOne(
        { workspaceId: w, eventType, ...extra },
        { session, sort: { createdAt: -1, id: -1 } },
      );
  }
  async function campaign(
    db: Db,
    w: string,
    id: string,
    session?: ClientSession,
  ) {
    const row = await latest(
      db,
      w,
      "campaign_setup",
      { campaignId: id },
      session,
    );
    if (!row) throw new HiveConflict("Campaign unavailable in this workspace.");
    return row;
  }
  async function state(user: AuthenticatedUser, w: string) {
    const db = await mongo.database();
    await access(db, user, w, "read");
    let canManage = true;
    try {
      await access(db, user, w, "update");
    } catch (e) {
      if (e instanceof AuthorizationDenied) canManage = false;
      else throw e;
    }
    const connection = await ga4.read(user, w),
      baseline = await latest(db, w, "performance_baseline");
    const raw = await db
      .collection("events")
      .find({ workspaceId: w, eventType: "campaign_setup" })
      .sort({ "payload.version": -1 })
      .limit(2001)
      .toArray();
    const seen = new Set<string>();
    const campaigns = raw
      .slice(0, 2000)
      .filter((r) => {
        if (seen.has(r.campaignId)) return false;
        seen.add(r.campaignId);
        return r.payload.status !== "archived";
      })
      .map((r) => ({
        id: r.campaignId,
        name: r.payload.setup.name,
        status: r.payload.status,
      }));
    return {
      canManage,
      connection,
      defaultWindow: defaultWindow(connection.property?.timeZone || "UTC"),
      campaigns,
      campaignsTruncated: raw.length > 2000,
      baselineVersion: baseline?.id ?? null,
      baseline: baseline?.payload.archived
        ? null
        : baseline
          ? { id: baseline.id, ...baseline.payload }
          : null,
    };
  }
  async function report(user: AuthenticatedUser, w: string, raw: unknown) {
    const input = reportInput.parse(raw),
      db = await mongo.database();
    await access(db, user, w, "read");
    let mapping = null,
      selected = null;
    if (input.campaignId) {
      selected = await campaign(db, w, input.campaignId);
      const m = await latest(db, w, "performance_attribution", {
        campaignId: input.campaignId,
      });
      const guided = await latestJourney(db,w,input.campaignId);
      mapping = guided?.payload.ga4Property ? {
        id: null, automatic: true, removed: false, property: guided.payload.ga4Property,
        filter: { field: "sessionCampaignId", value: input.campaignId },
      } : m ? {id:m.id,...m.payload} : null;
    }
    const connection = await ga4.read(user, w);
    let campaignTags: {
      field: "sessionCampaignId" | "sessionCampaignName";
      value: string;
      label: string;
    }[] = [];
    let analytics = null,
      analyticsError: string | null = null;
    const usableMapping =
      mapping &&
      !mapping.removed &&
      mapping.property === connection.property?.name;
    if (input.campaignId && !usableMapping)
      analyticsError =
        "Link this campaign to its exact GA4 campaign tag to view attributed traffic.";
    else if (connection.status !== "connected")
      analyticsError =
        "Connect and test Google Analytics in Integrations to load website traffic.";
    else {
      try {
        analytics = await ga4.report(
          user,
          w,
          input.window,
          usableMapping ? attribution.parse(mapping!.filter) : undefined,
        );
      } catch (e) {
        if (e instanceof Ga4Error) analyticsError = e.message;
        else throw e;
      }
    }
    if (
      input.campaignId &&
      !usableMapping &&
      connection.status === "connected"
    ) {
      try {
        const available = await ga4.report(user, w, input.window);
        campaignTags = available.traffic.campaigns.rows.flatMap((row) => {
          const [id, name] = row.dimensions;
          const field =
            id && !id.startsWith("(")
              ? ("sessionCampaignId" as const)
              : ("sessionCampaignName" as const);
          const value = field === "sessionCampaignId" ? id : name;
          const parsed = attribution.safeParse({ field, value });
          return parsed.success
            ? [
                {
                  ...parsed.data,
                  label: name && !name.startsWith("(") ? name : value!,
                },
              ]
            : [];
        });
      } catch (e) {
        if (e instanceof Ga4Error) analyticsError += ` ${e.message}`;
        else throw e;
      }
    }
    // HVM outcome timestamps are instants. Explicit UTC day bounds are separate from GA4 property-day aggregation.
    const until = new Date(
      +new Date(input.window.endDate) + 86400000,
    ).toISOString();
    const measurement = await readMeasurement(db, w, {
      campaignId: input.campaignId,
      since: `${input.window.startDate}T00:00:00.000Z`,
      until,
    });
    await access(db, user, w, "read");
    return {
      window: input.window,
      campaign: selected
        ? { id: input.campaignId, name: selected.payload.setup.name }
        : null,
      mapping,
      campaignTags,
      analytics,
      analyticsError,
      measurement,
      businessOutcomes: await readBusinessOutcomes(db, w, { campaignId: input.campaignId, since: `${input.window.startDate}T00:00:00.000Z`, until }),
      fetchedAt: new Date().toISOString(),
    };
  }
  async function saveBaseline(
    user: AuthenticatedUser,
    w: string,
    raw: unknown,
  ) {
    const input = baselineInput.parse(raw),
      db = await mongo.database();
    await access(db, user, w, "update");
    const prior = await latest(db, w, "performance_baseline");
    const duplicate = await latest(db, w, "performance_baseline", {
      "payload.requestId": input.requestId,
    });
    if (duplicate) return state(user, w);
    if ((prior?.id ?? null) !== input.expectedVersion)
      throw new HiveConflict("Baseline changed. Refresh before saving.");
    if (input.action !== "archive" && !input.notes)
      throw new HiveConflict("Enter baseline details.");
    if (input.action === "capture" && !input.window)
      throw new HiveConflict("Choose a baseline date range.");
    if (input.action !== "capture" && (!prior || prior.payload.archived))
      throw new HiveConflict("No active baseline to change.");
    const loaded =
      input.action === "capture"
        ? await report(user, w, { window: input.window })
        : null;
    // Freeze aggregate evidence only; do not retain contact timelines or expiring visitor records in a baseline.
    const snapshot = loaded
      ? {
          window: loaded.window,
          analytics: loaded.analytics,
          measurement: {
            metrics: loaded.measurement.metrics,
            eventCount: loaded.measurement.eventCount,
            truncated: loaded.measurement.truncated,
            updatedAt: loaded.measurement.updatedAt,
          },
        }
      : prior!.payload.snapshot;
    if (input.action === "capture" && !snapshot.analytics)
      throw new HiveConflict(
        "Connect GA4 and load traffic before capturing a baseline.",
      );
    if (input.action === "capture" && !snapshot.analytics.traffic.totals)
      throw new HiveConflict(
        "Google returned no report rows. Confirm tracking and data availability before capturing a baseline.",
      );
    if (!mongo.withTransaction)
      throw new HiveConflict("Transactional baseline storage is unavailable.");
    await mongo.withTransaction(async (tx, session) => {
      const actor = await access(tx, user, w, "update", session),
        now = await lockIcpWorkspace(tx, w, session);
      if (
        await latest(
          tx,
          w,
          "performance_baseline",
          { "payload.requestId": input.requestId },
          session,
        )
      )
        return;
      const current = await latest(tx, w, "performance_baseline", {}, session);
      if ((current?.id ?? null) !== input.expectedVersion)
        throw new HiveConflict("Baseline changed. Refresh before saving.");
      if (input.action === "capture") {
        const linked = await tx.collection("workspace_integrations").findOne(
          {
            workspaceId: w,
            provider: "ga4",
            status: "connected",
            archived: { $ne: true },
          },
          { session },
        );
        if (
          linked?.externalAccountId !== snapshot.analytics.property.name ||
          linked?.connectedAt.toISOString() !==
            snapshot.analytics.connectionVersion
        )
          throw new HiveConflict(
            "GA4 connection changed. Refresh before capturing the baseline.",
          );
      }
      const payload = {
        requestId: input.requestId,
        archived: input.action === "archive",
        notes: input.notes ?? prior!.payload.notes,
        snapshot,
        capturedAt:
          input.action === "capture"
            ? now.toISOString()
            : prior!.payload.capturedAt,
        changedAt: now.toISOString(),
        supersedes: prior?.id ?? null,
        action: input.action,
      };
      await tx.collection("events").insertOne(
        EventSchema.parse({
          id: generatePlatformId("event"),
          workspaceId: w,
          eventType: "performance_baseline",
          occurredAt: now,
          createdAt: now,
          updatedAt: now,
          createdBy: actor,
          payload,
        }),
        { session },
      );
    });
    return state(user, w);
  }
  async function saveAttribution(
    user: AuthenticatedUser,
    w: string,
    raw: unknown,
  ) {
    const input = z
      .object({
        campaignId: platformIdSchema("campaign"),
        expectedVersion: z.string().nullable(),
        filter: attribution.nullable(),
      })
      .strict()
      .parse(raw);
    if (!mongo.withTransaction)
      throw new HiveConflict("Transactional storage unavailable.");
    await mongo.withTransaction(async (db, session) => {
      const actor = await access(db, user, w, "update", session),
        now = await lockIcpWorkspace(db, w, session);
      await campaign(db, w, input.campaignId, session);
      const previous = await latest(
        db,
        w,
        "performance_attribution",
        { campaignId: input.campaignId },
        session,
      );
      if ((previous?.id ?? null) !== input.expectedVersion)
        throw new HiveConflict(
          "Campaign attribution changed. Refresh and retry.",
        );
      const links = await db
        .collection("workspace_integrations")
        .find(
          {
            workspaceId: w,
            provider: "ga4",
            status: "connected",
            archived: { $ne: true },
          },
          { session },
        )
        .limit(2)
        .toArray();
      if (input.filter && links.length !== 1)
        throw new HiveConflict("Connect one GA4 property first.");
      await db.collection("events").insertOne(
        EventSchema.parse({
          id: generatePlatformId("event"),
          workspaceId: w,
          campaignId: input.campaignId,
          eventType: "performance_attribution",
          occurredAt: now,
          createdAt: now,
          updatedAt: now,
          createdBy: actor,
          payload: {
            filter: input.filter,
            property: links[0]?.externalAccountId ?? null,
            removed: input.filter === null,
          },
        }),
        { session },
      );
    });
    return { saved: true };
  }
  return { state, report, saveBaseline, saveAttribution };
}
