import { z } from "zod";
import type { Db, ClientSession, Document } from "mongodb";
import type { AppConfig } from "../../config";
import type { MongoService } from "../mongo";
import type { AuthenticatedUser } from "../../middlewares/auth";
import {
  EventSchema,
  generatePlatformId,
  platformIdSchema,
} from "../../domain";
import { resolveHvmContext } from "../hvm-context";
import { AuthorizationDenied } from "../../authorization/policy";
import { HiveConflict } from "../hive-definitions";
import { lockIcpWorkspace } from "../icp/access";
import { definition, mapEvidence, newToken, hash, validToken } from "./model";
const setupType = "business_outcome_setup",
  evidenceType = "business_outcome_evidence";
function row(w: string, type: string, payload: Document, actor?: Document) {
  const now = new Date();
  return EventSchema.parse({
    id: generatePlatformId("event"),
    workspaceId: w,
    eventType: type,
    occurredAt: now,
    createdAt: now,
    updatedAt: now,
    ...(actor ? { createdBy: actor } : {}),
    payload,
  });
}
async function setup(db: Db, w: string, id: string, session?: ClientSession) {
  return db
    .collection("events")
    .findOne({ workspaceId: w, id, eventType: setupType }, { session });
}
export async function readBusinessOutcomes(
  db: Db,
  w: string,
  filter: { campaignId?: string; since: string; until: string },
) {
  const rows = await db
    .collection("events")
    .find({
      workspaceId: w,
      eventType: evidenceType,
      "payload.testOnly": false,
      "payload.retracted": false,
      "payload.occurredAt": { $gte: filter.since, $lt: filter.until },
      ...(filter.campaignId ? { "payload.campaignId": filter.campaignId } : {}),
    })
    .limit(10001)
    .toArray();
  const definitions = await db
    .collection("events")
    .find({
      workspaceId: w,
      eventType: setupType,
      "payload.archived": false,
      ...(filter.campaignId
        ? { "payload.definition.campaignId": filter.campaignId }
        : {}),
    })
    .limit(10001)
    .toArray();
  const selected = rows.slice(0, 10000);
  return {
    configured: definitions.length,
    receiving: definitions.filter((r) => r.payload.enabled).length,
    confirmed: selected.length,
    attributed: selected.filter((r) => r.payload.campaignId).length,
    unattributed: selected.filter((r) => !r.payload.campaignId).length,
    truncated: rows.length > 10000,
    byOutcome: [
      ...new Set(selected.map((r) => r.payload.outcomeId as string)),
    ].map((id) => {
      const items = selected.filter((r) => r.payload.outcomeId === id);
      return {
        id,
        name: items[0].payload.outcomeName as string,
        count: items.length,
      };
    }),
  };
}
export function createBusinessOutcomes(config: AppConfig, mongo: MongoService) {
  async function access(
    db: Db,
    u: AuthenticatedUser,
    w: string,
    action: "read" | "update",
    session?: ClientSession,
  ) {
    platformIdSchema("workspace").parse(w);
    const r = await resolveHvmContext(db, config, u, session);
    if (r.context.application !== "hvmapp" || r.context.actor.type !== "human")
      throw new AuthorizationDenied();
    for (const type of ["workspace_integrations", "campaigns"] as const)
      r.authority.scopeFilter(r.context, action, { type, workspaceId: w });
    return r.context.actor;
  }
  async function references(
    db: Db,
    w: string,
    d: z.infer<typeof definition>,
    session?: ClientSession,
  ) {
    if (
      !(await db
        .collection("brands")
        .findOne({ workspaceId: w, id: d.brandId }, { session }))
    )
      throw new HiveConflict("Brand unavailable in this workspace.");
    if (d.campaignId) {
      const c = await db.collection("events").findOne(
        {
          workspaceId: w,
          eventType: "campaign_setup",
          campaignId: d.campaignId,
        },
        { session, sort: { "payload.version": -1 } },
      );
      if (
        !c ||
        c.payload.status === "archived" ||
        c.payload.setup.brandId !== d.brandId
      )
        throw new HiveConflict("Choose a current campaign for this brand.");
    }
  }
  async function state(u: AuthenticatedUser, w: string) {
    const db = await mongo.database();
    await access(db, u, w, "read");
    let canManage = true;
    try {
      await access(db, u, w, "update");
    } catch (e) {
      if (e instanceof AuthorizationDenied) canManage = false;
      else throw e;
    }
    const definitions = await db
      .collection("events")
      .find({ workspaceId: w, eventType: setupType })
      .sort({ createdAt: -1 })
      .limit(501)
      .toArray();
    const evidence = await db
      .collection("events")
      .find({ workspaceId: w, eventType: evidenceType })
      .sort({ createdAt: -1 })
      .limit(101)
      .toArray();
    const brands = await db
      .collection("brands")
      .find({ workspaceId: w })
      .project({ id: 1, name: 1 })
      .toArray();
    const rawCampaigns = await db
      .collection("events")
      .find({ workspaceId: w, eventType: "campaign_setup" })
      .sort({ "payload.version": -1 })
      .limit(2001)
      .toArray();
    const seen = new Set<string>();
    const campaigns = rawCampaigns
      .slice(0, 2000)
      .filter((c) => {
        if (seen.has(c.campaignId)) return false;
        seen.add(c.campaignId);
        return c.payload.status !== "archived";
      })
      .map((c) => ({
        id: c.campaignId,
        name: c.payload.setup.name,
        brandId: c.payload.setup.brandId,
      }));
    return {
      canManage,
      brands: brands.map((b) => ({ id: b.id, name: b.name })),
      campaigns,
      definitions: definitions
        .slice(0, 500)
        .map((r) => ({ id: r.id, ...r.payload, tokenHash: undefined })),
      evidence: evidence.slice(0, 100).map((r) => ({
        id: r.id,
        outcomeId: r.payload.outcomeId,
        outcomeName: r.payload.outcomeName,
        occurredAt: r.payload.occurredAt,
        receivedAt: r.createdAt.toISOString(),
        campaignId: r.payload.campaignId,
        attribution: r.payload.attribution,
        testOnly: r.payload.testOnly,
        retracted: r.payload.retracted,
        reviewNote: r.payload.reviewNote || "",
      })),
      campaignsTruncated: rawCampaigns.length > 2000,
      definitionsTruncated: definitions.length > 500,
      evidenceTruncated: evidence.length > 100,
    };
  }
  const inputSchema = z
    .object({
      action: z.enum([
        "save",
        "rotate",
        "test",
        "enable",
        "pause",
        "archive",
        "restore",
        "retract",
      ]),
      id: platformIdSchema("event").nullable(),
      version: z.number().int().nonnegative(),
      requestId: z.string().uuid(),
      definition: definition.optional(),
      sample: z.unknown().optional(),
      note: z.string().trim().min(1).max(1000).optional(),
    })
    .strict();
  async function change(u: AuthenticatedUser, w: string, raw: unknown) {
    const input = inputSchema.parse(raw);
    if (!mongo.withTransaction)
      throw new HiveConflict("Transactional storage unavailable.");
    let token: string | undefined;
    const targetId = input.id ?? generatePlatformId("event");
    await mongo.withTransaction(async (db, session) => {
      const actor = await access(db, u, w, "update", session);
      await lockIcpWorkspace(db, w, session);
      if (
        await db.collection("events").findOne(
          {
            workspaceId: w,
            eventType: "business_outcome_change",
            "payload.requestId": input.requestId,
          },
          { session },
        )
      )
        return;
      const old = input.id ? await setup(db, w, input.id, session) : null;
      if (input.action === "retract") {
        if (!input.note || !input.id)
          throw new HiveConflict("Give a reason for retracting this evidence.");
        const result = await db.collection("events").updateOne(
          {
            workspaceId: w,
            id: input.id,
            eventType: evidenceType,
            "payload.retracted": false,
          },
          {
            $set: {
              "payload.retracted": true,
              "payload.reviewNote": input.note,
              updatedAt: new Date(),
            },
          },
          { session },
        );
        if (!result.matchedCount)
          throw new HiveConflict(
            "Evidence changed or is unavailable. Refresh.",
          );
      } else {
        if (input.id && !old) throw new HiveConflict("Outcome unavailable.");
        if ((old?.payload.version ?? 0) !== input.version)
          throw new HiveConflict("Outcome changed. Refresh before saving.");
        if (!old && input.action !== "save")
          throw new HiveConflict("Save the outcome first.");
        if (old?.payload.archived && input.action !== "restore")
          throw new HiveConflict("Restore this archived outcome first.");
        let payload = { ...old?.payload };
        if (input.action === "save") {
          const d = definition.parse(input.definition);
          await references(db, w, d, session);
          if (old && d.brandId !== old.payload.definition.brandId)
            throw new HiveConflict("Create a new outcome to change its brand.");
          payload = {
            ...payload,
            definition: d,
            enabled: false,
            archived: false,
            testedAt: null,
            connectionTestedAt: null,
          };
        }
        if (input.action === "rotate") {
          token = newToken();
          payload.tokenHash = hash(token);
          payload.enabled = false;
          payload.testedAt = null;
          payload.connectionTestedAt = null;
        }
        if (input.action === "test") {
          const d = definition.parse(payload.definition);
          try {
            mapEvidence(d, input.sample);
          } catch {
            throw new HiveConflict(
              "Sample must contain the expected event type, unique event/account references and an ISO date with timezone using the saved mapping.",
            );
          }
          // Mapping validation alone does not establish external delivery or enable receiving.
          payload.testedAt = new Date().toISOString();
        }
        if (input.action === "enable") {
          if (
            !payload.testedAt ||
            !payload.connectionTestedAt ||
            !payload.tokenHash
          )
            throw new HiveConflict(
              "Create a connection key, validate a sample and receive a test from the source first.",
            );
          await references(
            db,
            w,
            definition.parse(payload.definition),
            session,
          );
          payload.enabled = true;
        }
        if (["pause", "archive", "restore"].includes(input.action))
          payload.enabled = false;
        if (input.action === "archive") {
          payload.archived = true;
          payload.tokenHash = null;
        }
        if (input.action === "restore") {
          payload.archived = false;
          payload.testedAt = null;
          payload.connectionTestedAt = null;
        }
        payload.version = input.version + 1;
        if (old)
          await db
            .collection("events")
            .updateOne(
              { id: old.id, workspaceId: w },
              { $set: { payload, updatedAt: new Date() } },
              { session },
            );
        else {
          payload.tokenHash = null;
          const created = {
            ...row(w, setupType, payload, actor),
            id: targetId,
          };
          await db.collection("events").insertOne(created, { session });
        }
      }
      await db.collection("events").insertOne(
        row(
          w,
          "business_outcome_change",
          {
            requestId: input.requestId,
            outcomeId: targetId,
            action: input.action,
            previous: old ? { ...old.payload, tokenHash: undefined } : null,
            note: input.note ?? null,
          },
          actor,
        ),
        { session },
      );
    });
    return { state: await state(u, w), ...(token ? { token } : {}) };
  }
  async function receive(
    w: string,
    id: string,
    token: string,
    raw: unknown,
    testOnly: boolean,
  ) {
    platformIdSchema("workspace").parse(w);
    platformIdSchema("event").parse(id);
    if (!mongo.withTransaction)
      throw new HiveConflict("Transactional storage unavailable.");
    const initial = await setup(await mongo.database(), w, id);
    if (
      !initial?.payload.tokenHash ||
      !validToken(token, initial.payload.tokenHash) ||
      initial.payload.archived
    )
      throw new AuthorizationDenied();
    let duplicate = false;
    await mongo.withTransaction(async (db, session) => {
      await lockIcpWorkspace(db, w, session);
      const r = await setup(db, w, id, session),
        p = r?.payload;
      if (
        !p ||
        p.archived ||
        !p.tokenHash ||
        !validToken(token, p.tokenHash) ||
        (!testOnly && !p.enabled)
      )
        throw new AuthorizationDenied();
      const d = definition.parse(p.definition);
      await references(db, w, d, session);
      let mapped;
      try {
        mapped = mapEvidence(d, raw);
      } catch {
        throw new HiveConflict(
          "Payload does not match the saved outcome mapping.",
        );
      }
      const existing = await db.collection("events").findOne(
        {
          workspaceId: w,
          eventType: evidenceType,
          "payload.outcomeId": id,
          "payload.testOnly": testOnly,
          ...(testOnly ? { "payload.definitionVersion": p.version } : {}),
          $or: [
            { "payload.eventHash": mapped.eventHash },
            { "payload.subjectHash": mapped.subjectHash },
          ],
        },
        { session },
      );
      if (existing) {
        duplicate = true;
        return;
      }
      await db.collection("events").insertOne(
        row(w, evidenceType, {
          ...mapped,
          outcomeId: id,
          outcomeName: d.name,
          brandId: d.brandId,
          sourceName: d.sourceName,
          definitionVersion: p.version,
          testOnly,
          retracted: false,
        }),
        { session },
      );
      await db.collection("events").updateOne(
        { workspaceId: w, id },
        {
          $set: {
            "payload.lastReceivedAt": new Date().toISOString(),
            ...(testOnly
              ? { "payload.connectionTestedAt": new Date().toISOString() }
              : {}),
          },
        },
        { session },
      );
    });
    return { accepted: true, duplicate, testOnly };
  }
  return { state, change, receive };
}
