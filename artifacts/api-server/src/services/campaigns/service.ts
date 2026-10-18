import { contactContextAccess, readContactContext } from "../contact-context";
import {
  readCampaignJourney,
  appendJourney,
  latestJourney,
  recipientEvidence,
  journeyMutation,
  journeyHash,
} from "./journey";
import { readMeasurement } from "../measurement/read";
import { currentRecords } from "../content-strategy/application";
import { campaignMeasurement } from "./measurement";
import { createContactStrategies } from "../contact-strategy/application";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Document, ClientSession, Db } from "mongodb";
import type { AppConfig } from "../../config";
import type { AuthenticatedUser } from "../../middlewares/auth";
import type { MongoService } from "../mongo";
import {
  CampaignSchema,
  EventSchema,
  generatePlatformId,
  platformIdSchema,
} from "../../domain";
import { resolveHvmContext } from "../hvm-context";
import { AuthorizationDenied } from "../../authorization/policy";
import { lockIcpWorkspace } from "../icp/access";
import { HiveConflict } from "../hive-definitions";
import { contentContext } from "../content-strategy/context";
import { createResearchService } from "../research/service";
import type { ContentGenerator } from "../content-strategy/generate";
import {
  campaignMutation,
  meetingMutation,
  campaignReadiness,
  campaignSetup,
  overlapStatement,
} from "./model";
const hash = (x: unknown) =>
  createHash("sha256").update(JSON.stringify(x)).digest("hex");
export function createCampaignService(
  config: AppConfig,
  mongo: MongoService,
  generator?: ContentGenerator,
) {
  const research = createResearchService(config, mongo, generator);
  async function access(
    db: Db,
    user: AuthenticatedUser,
    w: string,
    action: "read" | "create" | "update" | "approve" | "delete",
    session?: ClientSession,
  ) {
    platformIdSchema("workspace").parse(w);
    const r = await resolveHvmContext(db, config, user, session);
    if (r.context.application !== "hvmapp" || r.context.actor.type !== "human")
      throw new AuthorizationDenied();
    r.authority.scopeFilter(r.context, action, {
      type: "campaigns",
      workspaceId: w,
    });
    return r.context.actor;
  }
  async function latest(
    db: Db,
    w: string,
    id: string,
    session?: ClientSession,
  ) {
    platformIdSchema("campaign").parse(id);
    const [row] = await db
      .collection("events")
      .find(
        { workspaceId: w, campaignId: id, eventType: "campaign_setup" },
        { session },
      )
      .sort({ "payload.version": -1 })
      .limit(1)
      .toArray();
    if (!row) throw new HiveConflict("Campaign unavailable.");
    return row;
  }
  const present = (r: Document) => ({
    id: r.campaignId,
    version: r.payload.version,
    status: r.payload.status,
    setup: r.payload.setup,
    updatedAt: r.updatedAt.toISOString(),
  });
  async function validate(
    db: Db,
    user: AuthenticatedUser,
    w: string,
    s: ReturnType<typeof campaignSetup.parse>,
    session?: ClientSession,
    requireCoverage = false,
  ) {
    const context = await contentContext(
      db,
      config,
      user,
      w,
      {
        brandId: s.brandId,
        products: s.products,
        offers: s.offers,
        audiences: s.audiences,
      },
      session,
    );
    const consumer = context.snapshots.some(
      (r) =>
        r.entityType === "ideal_customer_profiles" &&
        ["b2c", "d2c"].includes(
          r.snapshot.definition?.profileType ?? r.snapshot.profileType,
        ),
    );
    if (requireCoverage && consumer && s.source !== "existing")
      throw new HiveConflict(
        "Consumer audiences currently support existing contacts only. Choose Existing records before approval; private-person web discovery is unavailable.",
      );
    for (const o of s.offers) {
      const offer = await db
        .collection("offers")
        .findOne({ workspaceId: w, id: o.id }, { session });
      if (!s.products.some((p) => p.id === offer?.offeringId))
        throw new HiveConflict("Select the product belonging to each offer.");
    }
    const content = currentRecords(
      await db
        .collection("events")
        .find(
          { workspaceId: w, eventType: "content_strategy_record" },
          { session },
        )
        .toArray(),
    );
    for (const id of [...s.assetIds, ...s.contentRecordIds]) {
      const item = content.find((r) => r.id === id),
        parent = content.find((r) => r.id === item?.data.strategyId);
      const scope = (item?.data.scope ?? parent?.data.scope) as
        { brandId?: string } | undefined;
      if (
        !item ||
        ["archived", "removed"].includes(item.status) ||
        scope?.brandId !== s.brandId ||
        (s.assetIds.includes(id)
          ? item.kind !== "asset"
          : !["strategy", "brief"].includes(item.kind))
      )
        throw new HiveConflict("Select current content from this brand.");
    }
    const linkedOffers = new Set<string>();
    for (const a of s.audiences) {
      const profile = await db
        .collection("ideal_customer_profiles")
        .findOne({ workspaceId: w, id: a.id }, { session });
      const offerId = profile?.offer?.id ?? profile?.offerId;
      if (offerId) linkedOffers.add(offerId);
      if (
        requireCoverage &&
        (!offerId ||
          !s.offers.some(
            (o) => o.id === offerId && o.revision === profile?.offer?.revision,
          ))
      )
        throw new HiveConflict(
          "Select ICPs linked to the current approved offer versions.",
        );
      if (offerId && !s.offers.some((o) => o.id === offerId))
        throw new HiveConflict("Select the offer associated with each ICP.");
    }
    if (requireCoverage && s.offers.some((o) => !linkedOffers.has(o.id)))
      throw new HiveConflict("Select an approved ICP for every offer.");
  }
  async function preparation(
    db: Db,
    w: string,
    setup: ReturnType<typeof campaignSetup.parse>,
    session?: ClientSession,
  ) {
    const results = [];
    for (const ref of setup.offers) {
      const offer = await db
        .collection("offers")
        .findOne({ workspaceId: w, id: ref.id }, { session });
      const current =
        offer?.status === "approved" &&
        offer?.revision === ref.revision &&
        offer?.approvedRevision === ref.revision &&
        !offer?.archived;
      const d = current ? (offer?.definition ?? {}) : {};
      const bookingUrl = setup.bookingUrl || d.bookingUrl || "";
      const gaps: string[] = [];
      if (!current)
        gaps.push(
          "Select the current approved offer before NBA can use its qualification settings.",
        );
      if (!d.conversionOutcome)
        gaps.push("Define and approve the offer’s conversion outcome.");
      if (!d.qualificationCriteria?.length)
        gaps.push(
          "Define and approve the offer’s qualification criteria and evidence requirements.",
        );
      if ((setup.meetingPurpose || d.meetingPurpose) && !bookingUrl)
        gaps.push(
          "Add an approved booking destination for this meeting outcome.",
        );
      results.push({
        offerId: ref.id,
        name: offer?.definition?.name ?? "Unavailable offer",
        conversionOutcome: d.conversionOutcome ?? "",
        bookingUrl,
        meetingPurpose: setup.meetingPurpose || d.meetingPurpose || "",
        handoverRecipient: setup.handoverRecipient || d.handoverRecipient || "",
        gaps,
      });
    }
    return results;
  }
  async function meetings(
    db: Db,
    w: string,
    id: string,
    session?: ClientSession,
  ) {
    const rows = await db
      .collection("events")
      .find(
        { workspaceId: w, campaignId: id, eventType: "campaign_meeting" },
        { session },
      )
      .sort({ "payload.version": -1 })
      .toArray();
    const seen = new Set<string>();
    return rows
      .filter((r) => {
        if (seen.has(r.payload.id)) return false;
        seen.add(r.payload.id);
        return true;
      })
      .map((r) => r.payload);
  }
  async function recordMeeting(
    user: AuthenticatedUser,
    w: string,
    id: string,
    raw: unknown,
  ) {
    const input = meetingMutation.parse(raw);
    platformIdSchema("person").parse(input.personId);
    platformIdSchema("offer").parse(input.offerId);
    if (input.id) platformIdSchema("event").parse(input.id);
    if (!mongo.withTransaction) throw new Error("Transactions required");
    return mongo.withTransaction(async (db, session) => {
      const actor = await access(db, user, w, "update", session);
      await lockIcpWorkspace(db, w, session);
      const row = await latest(db, w, id, session);
      if (["archived", "deleted"].includes(row.payload.status))
        throw new HiveConflict(
          "Reopen an active campaign to update a meeting.",
        );
      const duplicate = await db.collection("events").findOne(
        {
          workspaceId: w,
          campaignId: id,
          eventType: "campaign_meeting",
          "payload.requestKey": input.requestKey,
        },
        { session },
      );
      if (duplicate) {
        if (duplicate.payload.inputHash !== hash(input))
          throw new HiveConflict("Request changed.");
        return duplicate.payload;
      }
      if (
        !row.payload.setup.offers.some((o: Document) => o.id === input.offerId)
      )
        throw new HiveConflict("Select an offer belonging to this campaign.");
      const person = await db
        .collection("people")
        .findOne(
          { workspaceId: w, id: input.personId, archived: { $ne: true } },
          { session },
        );
      if (!person)
        throw new HiveConflict("Select a current contact from this workspace.");
      const previous = input.id
        ? (await meetings(db, w, id, session)).find((r) => r.id === input.id)
        : undefined;
      if (input.id && !previous) throw new HiveConflict("Meeting unavailable.");
      if ((previous?.version ?? 0) !== input.expectedVersion)
        throw new HiveConflict("Meeting changed. Reload before saving.");
      if (
        previous &&
        (previous.personId !== input.personId ||
          previous.offerId !== input.offerId)
      )
        throw new HiveConflict(
          "Void the incorrect meeting and create a corrected record to change its contact or offer.",
        );
      const now = new Date();
      const payload = {
        ...input,
        id: input.id ?? generatePlatformId("event"),
        version: (previous?.version ?? 0) + 1,
        personName:
          person.name ??
          [person.firstName, person.lastName].filter(Boolean).join(" "),
        provenance: "user_reported",
        updatedAt: now.toISOString(),
        inputHash: hash(input),
      };
      await db.collection("events").insertOne(
        EventSchema.parse({
          id: generatePlatformId("event"),
          workspaceId: w,
          campaignId: id,
          eventType: "campaign_meeting",
          occurredAt: now,
          createdAt: now,
          updatedAt: now,
          createdBy: actor,
          updatedBy: actor,
          source: { system: "hvm_campaign" },
          payload,
        }),
        { session },
      );
      return payload;
    });
  }
  async function list(user: AuthenticatedUser, w: string) {
    const db = await mongo.database();
    await access(db, user, w, "read");
    const rows = await db
      .collection("events")
      .find({ workspaceId: w, eventType: "campaign_setup" })
      .sort({ "payload.version": -1 })
      .toArray();
    const seen = new Set<string>();
    const campaigns = rows
      .filter((r) => {
        if (seen.has(r.campaignId)) return false;
        seen.add(r.campaignId);
        return r.payload.status !== "deleted";
      })
      .map(present);
    const choices = await research.list(user, w);
    const policies = await createContactStrategies(config, mongo).list(user, w);
    const content = currentRecords(
      await db
        .collection("events")
        .find({ workspaceId: w, eventType: "content_strategy_record" })
        .toArray(),
    );
    const contentChoices = content
      .filter(
        (r) =>
          ["strategy", "brief"].includes(r.kind) &&
          !["archived", "removed"].includes(r.status),
      )
      .map((r) => ({
        id: r.id,
        name: String(r.data.title ?? r.data.name ?? r.kind),
        status: r.status,
        brandId:
          (
            (r.data.scope ??
              content.find((p) => p.id === r.data.strategyId)?.data.scope) as {
              brandId?: string;
            }
          )?.brandId ?? null,
      }));
    const connections = await db
      .collection("workspace_integrations")
      .find(
        { workspaceId: w, archived: { $ne: true } },
        { projection: { id: 1, displayName: 1, provider: 1, status: 1 } },
      )
      .toArray();
    return {
      contentChoices,
      integrations: connections.map((c) => ({
        name: c.displayName ?? c.provider,
        status: c.status,
      })),
      campaigns,
      choices,
      overlapStatement,
      policies: policies.policies,
    };
  }
  async function change(
    user: AuthenticatedUser,
    w: string,
    id: string | undefined,
    raw: unknown,
  ) {
    const input = campaignMutation.parse(raw);
    if (!mongo.withTransaction) throw new Error("Transactions required");
    return mongo.withTransaction(async (db, session) => {
      const actor = await access(
        db,
        user,
        w,
        input.action === "approve"
          ? "approve"
          : input.action === "delete"
            ? "delete"
            : id
              ? "update"
              : "create",
        session,
      );
      await lockIcpWorkspace(db, w, session);
      const duplicate = await db.collection("events").findOne(
        {
          workspaceId: w,
          eventType: "campaign_setup",
          "payload.requestKey": input.requestKey,
        },
        { session },
      );
      if (duplicate) {
        if (duplicate.payload.inputHash !== hash({ id, input }))
          throw new HiveConflict("Request changed.");
        return present(duplicate);
      }
      const old = id ? await latest(db, w, id, session) : undefined;
      if ((old?.payload.version ?? 0) !== input.expectedVersion)
        throw new HiveConflict(
          "This campaign changed. Reopen it before saving.",
        );
      if (old?.payload.status === "deleted")
        throw new HiveConflict("Campaign deleted.");
      if (!old && input.action !== "save")
        throw new HiveConflict("Save the campaign first.");
      const setup = campaignSetup.parse(
        input.action === "save" ? input.setup : old?.payload.setup,
      );
      if (input.action === "save") await validate(db, user, w, setup, session);
      if (input.action === "approve") {
        const gaps = [
          ...campaignReadiness(setup),
          ...(await preparation(db, w, setup, session)).flatMap((o) =>
            o.gaps.map((g) => `${o.name}: ${g}`),
          ),
        ];
        if (gaps.length) throw new HiveConflict(gaps.join(" "));
        await validate(db, user, w, setup, session, true);
      }
      const running = id
        ? await db.collection("events").findOne(
            {
              workspaceId: w,
              eventType: "research_job",
              "payload.request.destinations": {
                $elemMatch: { type: "campaign", id },
              },
              "payload.status": {
                $nin: ["completed", "partial", "failed", "cancelled"],
              },
            },
            { session },
          )
        : null;
      if (running)
        throw new HiveConflict(
          "Wait for the current research request to finish or cancel it in Research before changing this campaign.",
        );
      if (input.action === "delete") {
        if ((await meetings(db, w, id!, session)).length)
          throw new HiveConflict(
            "Meeting history exists. Archive this campaign instead.",
          );
        const history = await db.collection("events").findOne(
          {
            workspaceId: w,
            eventType: "research_job",
            "payload.request.destinations": {
              $elemMatch: { type: "campaign", id },
            },
          },
          { session },
        );
        if (history || old?.payload.status !== "draft")
          throw new HiveConflict(
            "Only unused drafts can be deleted. Archive this campaign to preserve its history.",
          );
      }
      const campaignId = id ?? generatePlatformId("campaign"),
        now = new Date();
      const status = (
        {
          save: "draft",
          approve: "ready",
          pause: "paused",
          archive: "archived",
          delete: "deleted",
        } as const
      )[input.action];
      const row = EventSchema.parse({
        id: generatePlatformId("event"),
        workspaceId: w,
        campaignId,
        eventType: "campaign_setup",
        occurredAt: now,
        createdAt: now,
        updatedAt: now,
        createdBy: actor,
        payload: {
          version: input.expectedVersion + 1,
          status,
          setup,
          createdAt:
            old?.payload.createdAt ??
            old?.createdAt?.toISOString() ??
            now.toISOString(),
          requestKey: input.requestKey,
          inputHash: hash({ id, input }),
        },
      });
      await db.collection("events").insertOne(row, { session });
      const base = CampaignSchema.parse({
        id: campaignId,
        workspaceId: w,
        name: setup.name,
        type: setup.purpose,
        channel: setup.channels.join(", ") || "unconfigured",
        status:
          status === "paused"
            ? "paused"
            : status === "archived" || status === "deleted"
              ? "cancelled"
              : "draft",
        createdAt: old?.payload.createdAt
          ? new Date(old.payload.createdAt)
          : (old?.createdAt ?? now),
        updatedAt: now,
        archived: status === "archived" || status === "deleted",
      });
      if (old)
        await db
          .collection("campaigns")
          .updateOne(
            { workspaceId: w, id: campaignId },
            { $set: base },
            { session },
          );
      else await db.collection("campaigns").insertOne(base, { session });
      return present(row);
    });
  }
  async function read(user: AuthenticatedUser, w: string, id: string) {
    const db = await mongo.database();
    await access(db, user, w, "read");
    const row = await latest(db, w, id);
    const jobs = await db
      .collection("events")
      .find({
        workspaceId: w,
        eventType: "research_job",
        "payload.request.destinations": {
          $elemMatch: { type: "campaign", id },
        },
      })
      .sort({ createdAt: -1 })
      .toArray();
    const details = await Promise.all(
      jobs.map((j) => research.read(user, w, j.id)),
    );
    const discoveries = details.flatMap((d) => d.job.discovery);
    const count = (type: string) =>
      new Set(
        discoveries.filter((d) => d.type === type && d.id).map((d) => d.id),
      ).size;
    const assessmentEvents = await db
      .collection("events")
      .find({
        workspaceId: w,
        eventType: "campaign_audience_assessment",
        "payload.campaignId": id,
      })
      .sort({ createdAt: -1 })
      .toArray();
    const assessmentKeys = new Set<string>();
    const assessments = assessmentEvents
      .filter((e) => {
        const key =
          (e.payload.personId
            ? "person:" + e.payload.personId
            : "organisation:" + e.payload.organisationId) +
          ":" +
          e.payload.offerId +
          ":" +
          e.payload.icpId;
        if (assessmentKeys.has(key)) return false;
        assessmentKeys.add(key);
        return true;
      })
      .map((e) => ({
        id: e.id,
        ...e.payload,
        createdAt: e.createdAt.toISOString(),
        stale: e.payload.campaignVersion !== row.payload.version,
      }));
    const activity = await db
      .collection("events")
      .find({ workspaceId: w, campaignId: id, eventType: "campaign_activity" })
      .toArray();
    return {
      measurement: await readMeasurement(db, w, { campaignId: id }),
      metrics: campaignMeasurement(
        activity.map((e) => e.payload),
        new Date(0),
      ),
      assessments,
      ...present(row),
      readiness: campaignReadiness(campaignSetup.parse(row.payload.setup)),
      preparation: await preparation(
        db,
        w,
        campaignSetup.parse(row.payload.setup),
      ),
      meetings: await meetings(db, w, id),
      execution:
        "NBA recommendations and individually authorised Communications are available. Campaign setup is not sending permission.",
      updatedAt: new Date().toISOString(),
      jobs: details.map((d) => d.job),
      organisations: count("organisations"),
      contacts: count("people"),
      findings: details.flatMap((d) => d.findings),
      evidenceCount: new Set(
        details.flatMap((d) => d.evidence.map((e) => e.id)),
      ).size,
    };
  }
  async function start(
    user: AuthenticatedUser,
    w: string,
    id: string,
    raw: unknown,
  ) {
    const { expectedVersion, organisationIds, personIds } = z
      .object({
        expectedVersion: z.number().int().positive(),
        organisationIds: z.array(platformIdSchema("org")).max(20).default([]),
        personIds: z.array(platformIdSchema("person")).max(20).default([]),
      })
      .strict()
      .parse(raw);
    const db = await mongo.database();
    await access(db, user, w, "update");
    const row = await latest(db, w, id);
    if (
      row.payload.version !== expectedVersion ||
      row.payload.status !== "ready"
    )
      throw new HiveConflict(
        "Approve the current campaign setup before researching.",
      );
    if (!generator)
      throw new HiveConflict("Research generation is unavailable.");
    const s = campaignSetup.parse(row.payload.setup);
    await validate(db, user, w, s, undefined, true);
    if (s.source === "existing" && !organisationIds.length && !personIds.length)
      throw new HiveConflict(
        "Select existing organisations or consumer contacts to assess.",
      );
    // Stable request identity makes repeated clicks/retries recover the same research operation.
    const h = hash({
      w,
      id,
      expectedVersion,
      organisationIds: [...new Set(organisationIds)].sort(),
      personIds: [...new Set(personIds)].sort(),
    });
    const requestKey = `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
    const job = await research.start(user, w, {
      requestKey,
      campaignVersion: expectedVersion,
      objective: s.objective,
      type: s.source === "existing" ? "market_buyer" : "account_discovery",
      scope: {
        brandId: s.brandId,
        products: s.products,
        offers: s.offers,
        audiences: s.audiences,
      },
      urls: s.urls,
      libraryAssetIds: s.assetIds,
      sourceMode: s.source === "existing" ? "existing" : "web",
      destinations: [
        { type: "campaign", id },
        ...organisationIds.map((id) => ({ type: "organisations", id })),
        ...personIds.map((id) => ({ type: "people", id })),
      ],
      freshnessDays: 30,
    });
    // Research service owns leases, safe retries, evidence and authorised record creation.
    void research.run(user, w, job.id).catch(() => {});
    return job;
  }
  async function savePolicy(
    user: AuthenticatedUser,
    w: string,
    id: string,
    raw: unknown,
  ) {
    const input = z
      .object({
        expectedVersion: z.number().int().nonnegative(),
        campaignVersion: z.number().int().positive(),
      })
      .strict()
      .parse(raw);
    const db = await mongo.database();
    await access(db, user, w, "update");
    const row = await latest(db, w, id);
    if (
      row.payload.version !== input.campaignVersion ||
      ["archived", "deleted"].includes(row.payload.status)
    )
      throw new HiveConflict(
        "Campaign changed. Reopen it before preparing the policy.",
      );
    return createContactStrategies(config, mongo).mutate(user, w, {
      key: "cs_022",
      expectedVersion: input.expectedVersion,
      operation: "save",
      statement: row.payload.setup.overlapPolicy,
    });
  }
  async function audience(
    user: AuthenticatedUser,
    w: string,
    id: string,
    raw: unknown,
  ) {
    const { offset, entity } = z
      .object({
        offset: z.coerce.number().int().min(0).default(0),
        entity: z.enum(["organisations", "people"]).default("organisations"),
      })
      .parse(raw);
    const db = await mongo.database();
    await access(db, user, w, "read");
    await latest(db, w, id);
    const authority = await resolveHvmContext(db, config, user);
    authority.authority.scopeFilter(authority.context, "read", {
      type: entity,
      workspaceId: w,
    });
    if (entity === "people") {
      const rows = await db
        .collection("people")
        .find({ workspaceId: w, archived: { $ne: true } })
        .sort({ lastName: 1, id: 1 })
        .skip(offset)
        .limit(51)
        .toArray();
      const items = await Promise.all(
        rows.slice(0, 50).map(async (row) => {
          const evidence = await db
            .collection("events")
            .find({
              workspaceId: w,
              eventType: "research_finding",
              "payload.destinations": {
                $elemMatch: { type: "people", id: row.id },
              },
            })
            .sort({ updatedAt: -1 })
            .limit(1)
            .toArray();
          return {
            id: row.id,
            name: [row.firstName, row.lastName].filter(Boolean).join(" "),
            domain: "",
            contacts: 0,
            management:
              "Existing contact — lifecycle, suppression and engagement policies still apply; selection is not permission to contact",
            lastEvidenceAt: evidence[0]?.updatedAt?.toISOString() ?? null,
          };
        }),
      );
      return { items, offset, more: rows.length > 50 };
    }
    const rows = await db
      .collection("organisations")
      .find({ workspaceId: w, archived: { $ne: true } })
      .sort({ name: 1, id: 1 })
      .skip(offset)
      .limit(51)
      .toArray();
    const items = [];
    for (const row of rows.slice(0, 50)) {
      const relationships = await db
        .collection("organisation_relationships")
        .find({
          workspaceId: w,
          organisationId: row.id,
          current: true,
          archived: { $ne: true },
        })
        .toArray();
      const opportunities = await db
        .collection("opportunities")
        .find({
          workspaceId: w,
          organisationId: row.id,
          status: "open",
          archived: { $ne: true },
        })
        .toArray();
      const evidence = await db
        .collection("events")
        .find({
          workspaceId: w,
          eventType: "research_finding",
          "payload.destinations": {
            $elemMatch: { type: "organisations", id: row.id },
          },
        })
        .sort({ updatedAt: -1 })
        .limit(1)
        .toArray();
      items.push({
        id: row.id,
        name: row.name,
        domain: row.domain ?? row.normalizedDomain ?? "",
        contacts: relationships.length,
        management: opportunities.length
          ? "Active opportunity — coordinate before engagement"
          : "No active opportunity recorded; management not otherwise established",
        opportunities: opportunities.map((o) => ({
          id: o.id,
          name: o.name,
          owner: o.owner ?? null,
        })),
        lastEvidenceAt: evidence[0]?.updatedAt?.toISOString() ?? null,
      });
    }
    return { items, offset, more: rows.length > 50 };
  }
  async function journey(user: AuthenticatedUser, w: string, id: string) {
    const db = await mongo.database();
    await access(db, user, w, "read");
    await contactContextAccess(db, config, user, w, "read");
    return readCampaignJourney(db, w, id);
  }
  async function recipientCandidates(
    user: AuthenticatedUser,
    w: string,
    id: string,
    raw: unknown,
  ) {
    const input = z
      .object({
        search: z.string().trim().max(200).default(""),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .parse(raw);
    const db = await mongo.database();
    await access(db, user, w, "read");
    await contactContextAccess(db, config, user, w, "read");
    const c = await latest(db, w, id);
    const j = await latestJourney(db, w, id);
    const literal = input.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rows = await db
      .collection("people")
      .find({
        workspaceId: w,
        archived: { $ne: true },
        ...(literal
          ? {
              $or: ["name", "firstName", "lastName"].map((k) => ({
                [k]: { $regex: literal, $options: "i" },
              })),
            }
          : {}),
      })
      .sort({ name: 1, id: 1 })
      .skip(input.offset)
      .limit(26)
      .toArray();
    const items = [];
    for (const person of rows.slice(0, 25)) {
      const ctx = await readContactContext(db, w, person.id);
      const point = ctx.points.find((p) => p.type === "email");
      items.push(
        await recipientEvidence(
          db,
          w,
          person.id,
          point?.id ?? "",
          j?.payload.excludedOrganisations ?? [],
          c.payload.setup.purpose ?? "acquisition",
        ),
      );
    }
    return { items, offset: input.offset, more: rows.length > 25 };
  }
  async function saveJourney(
    user: AuthenticatedUser,
    w: string,
    id: string,
    raw: unknown,
  ) {
    const input = journeyMutation.parse(raw);
    if (!mongo.withTransaction)
      throw new HiveConflict("Transactions required.");
    await mongo.withTransaction(async (db, session) => {
      const actor = await access(
        db,
        user,
        w,
        input.action === "approve_launch" ? "approve" : "update",
        session,
      );
      await contactContextAccess(db, config, user, w, "update", session);
      await lockIcpWorkspace(db, w, session);
      const duplicate = await db.collection("events").findOne(
        {
          workspaceId: w,
          campaignId: id,
          eventType: "campaign_journey",
          "payload.requestKey": input.requestKey,
        },
        { session },
      );
      if (duplicate) {
        if (duplicate.payload.inputHash !== journeyHash(input))
          throw new HiveConflict("Request changed.");
        return;
      }
      const campaign = await latest(db, w, id, session);
      const prior = await latestJourney(db, w, id, session);
      if (
        campaign.payload.version !== input.campaignVersion ||
        (prior?.payload.version ?? 0) !== input.expectedVersion
      )
        throw new HiveConflict(
          "Campaign preparation changed. Reload before saving.",
        );
      if (["deleted", "archived"].includes(campaign.payload.status))
        throw new HiveConflict("Reopen the campaign before preparing it.");
      const before = await readCampaignJourney(db, w, id, session);
      if (input.action === "approve_launch") {
        if (
          input.confirmed !== true ||
          input.reviewFingerprint !== before.reviewFingerprint
        )
          throw new HiveConflict(
            "Review the current launch summary and explicitly confirm approval.",
          );
        const gaps = [
          ...before.blockers,
          ...(
            await preparation(db, w, campaign.payload.setup, session)
          ).flatMap((o) => o.gaps),
        ];
        if (gaps.length) throw new HiveConflict(gaps.join(" "));
        await validate(db, user, w, campaign.payload.setup, session, true);
      }
      const recipients =
        input.action === "save"
          ? (input.recipients ?? prior?.payload.recipients ?? [])
          : (prior?.payload.recipients ?? []);
      const exclusions =
        input.action === "save"
          ? (input.excludedOrganisations ??
            prior?.payload.excludedOrganisations ??
            [])
          : (prior?.payload.excludedOrganisations ?? []);
      if (
        new Set(recipients.map((r: Document) => r.personId)).size !==
        recipients.length
      )
        throw new HiveConflict("Review each recipient once.");
      if (input.action === "save")
        for (const r of recipients) {
          platformIdSchema("person").parse(r.personId);
          const e = await recipientEvidence(
            db,
            w,
            r.personId,
            r.contactPointId,
            exclusions,
            campaign.payload.setup.purpose ?? "acquisition",
            session,
          );
          if (
            r.decision === "include" &&
            (e.contextRevision !== r.contextRevision || e.blockers.length)
          )
            throw new HiveConflict(
              `${e.name}: ${e.blockers.join(". ") || "Contact changed; review again."}`,
            );
        }
      const ga = await db.collection("workspace_integrations").findOne(
        {
          workspaceId: w,
          provider: "ga4",
          status: "connected",
          archived: { $ne: true },
        },
        { session },
      );
      const now = new Date();
      await appendJourney(
        db,
        {
          id: generatePlatformId("event"),
          workspaceId: w,
          campaignId: id,
          eventType: "campaign_journey",
          occurredAt: now,
          createdAt: now,
          updatedAt: now,
          createdBy: actor,
          payload: {
            version: input.expectedVersion + 1,
            campaignVersion: input.campaignVersion,
            status:
              input.action === "approve_launch"
                ? "approved"
                : input.action === "stop"
                  ? "stopped"
                  : "draft",
            recipients,
            recipientCount: recipients.length,
            excludedOrganisations: exclusions,
            ga4Property:
              input.action === "save"
                ? (ga?.externalAccountId ?? null)
                : (prior?.payload.ga4Property ?? null),
            reviewFingerprint:
              input.action === "approve_launch"
                ? before.reviewFingerprint
                : null,
            reason: input.reason,
            requestKey: input.requestKey,
            inputHash: journeyHash(input),
          },
        },
        session,
      );
    });
    return journey(user, w, id);
  }

  return {
    list,
    change,
    read,
    start,
    savePolicy,
    audience,
    recordMeeting,
    journey,
    recipientCandidates,
    saveJourney,
  };
}
