import { readMeasurement } from "../measurement/read";
import { randomUUID } from "node:crypto";
import type { ClientSession, Db, Document } from "mongodb";
import type { AppConfig } from "../../config";
import type { AuthenticatedUser } from "../../middlewares/auth";
import type { MongoService } from "../mongo";
import { EventSchema, generatePlatformId } from "../../domain";
import { lockIcpWorkspace } from "../icp/access";
import { HiveConflict } from "../hive-definitions";
import type { ContentGenerator } from "../content-strategy/generate";
import type { NbaExecution } from "./native";
import { claimKeys, claimEngagement, releaseEngagement } from "./coordination";
import { nbaAccess, nbaContext } from "./context";
import {
  guardDecision,
  nbaDecision,
  policyDecisionHash,
  nbaHash,
  nbaRequest,
  nbaMutation,
} from "./model";

/** Append-only decision history. Preview never enrols a contact, acquires an
 * engagement claim or dispatches a capability. Review is not campaign activation. */
export function createNbaService(
  config: AppConfig,
  mongo: MongoService,
  generator?: ContentGenerator,
  execution?: NbaExecution,
) {
  const present = (row: Document) => ({
    id: row.payload.decisionId,
    campaignId: row.campaignId,
    ...row.payload,
    updatedAt: row.createdAt.toISOString(),
  });
  const transaction = <T>(
    fn: (db: Db, session: ClientSession) => Promise<T>,
  ) => {
    if (!mongo.withTransaction) throw new Error("Transactions required");
    return mongo.withTransaction(fn);
  };
  async function latest(
    db: Db,
    w: string,
    id: string,
    session?: ClientSession,
  ) {
    const row = await db
      .collection("events")
      .find(
        { workspaceId: w, eventType: "nba_decision", "payload.decisionId": id },
        { session },
      )
      .sort({ "payload.version": -1 })
      .limit(1)
      .next();
    if (!row) throw new HiveConflict("Decision unavailable.");
    return row;
  }
  async function append(
    db: Db,
    session: ClientSession,
    w: string,
    campaignId: string,
    actor: unknown,
    payload: Document,
  ) {
    const now = new Date();
    const row = EventSchema.parse({
      id: generatePlatformId("event"),
      workspaceId: w,
      campaignId,
      eventType: "nba_decision",
      occurredAt: now,
      createdAt: now,
      updatedAt: now,
      createdBy: actor,
      payload,
    });
    await db.collection("events").insertOne(row, { session });
    return present(row);
  }
  async function list(user: AuthenticatedUser, w: string) {
    const db = await mongo.database();
    await nbaAccess(db, config, user, w, "read");
    const rows = await db
      .collection("events")
      .aggregate([
        { $match: { workspaceId: w, eventType: "nba_decision" } },
        { $sort: { "payload.version": -1 } },
        { $group: { _id: "$payload.decisionId", row: { $first: "$$ROOT" } } },
        { $sort: { "row.createdAt": -1 } },
        { $limit: 100 },
      ])
      .toArray();
    const available = !!execution && (await execution.available());
    return {
      measurement: await readMeasurement(db, w),
      decisions: rows.map((r) => present(r.row)),
      executionAvailable: available,
      executionMessage: available
        ? "Approved waits use the durable NBA worker. Outreach remains unavailable in this foundation."
        : "NBA decision previews are available. The durable worker is not ready; no outreach will run.",
    };
  }
  async function preview(user: AuthenticatedUser, w: string, raw: unknown) {
    const input = nbaRequest.parse(raw),
      inputHash = nbaHash(input);
    if (!generator)
      throw new HiveConflict(
        "NBA generation is not configured. Your existing decisions are unchanged.",
      );
    const prepared = await transaction(async (db, session) => {
      const actor = await nbaAccess(db, config, user, w, "create", session);
      await lockIcpWorkspace(db, w, session);
      const prior = await db.collection("events").findOne(
        {
          workspaceId: w,
          eventType: "nba_decision",
          "payload.requestKey": input.requestKey,
        },
        { session },
      );
      if (prior) {
        if (prior.payload.inputHash !== inputHash)
          throw new HiveConflict(
            "This request was already used for different details.",
          );
        return {
          prior: present(
            await latest(db, w, prior.payload.decisionId, session),
          ),
        };
      }
      const context = await nbaContext(
        db,
        config,
        user,
        w,
        input.campaignId,
        input.campaignVersion,
        input.subject,
        session,
      );
      const decisionId = generatePlatformId("event");
      await append(db, session, w, input.campaignId, actor, {
        decisionId,
        version: 1,
        state: "generating",
        requestKey: input.requestKey,
        inputHash,
        subject: input.subject,
        organisationId: context.organisationId ?? null,
        campaignVersion: input.campaignVersion,
        instruction: input.instruction,
        contextVersions: context.versions,
        contextHash: nbaHash(context.versions),
        decision: null,
        blockers: [],
        preview: true,
      });
      return { context, decisionId };
    });
    if (prepared.prior) return prepared.prior;
    const { context, decisionId } = prepared;
    if (!context || !decisionId) throw new Error("Missing prepared decision");
    let generated: Awaited<ReturnType<ContentGenerator>> | undefined;
    let failure = false;
    try {
      generated = await generator("nba", {
        ...(context.data as object),
        evidenceIds: context.evidenceIds,
        eligibleOfferIds: context.offerIds,
        availableActions: context.availableActions,
        subject: context.subject,
        instruction: input.instruction,
      });
      const decision = nbaDecision.parse(generated.result);
      generated.result = {
        ...decision,
        policyContextHash: policyDecisionHash(decision, context),
      };
      guardDecision(generated.result, context, new Date());
    } catch {
      failure = true;
    }
    return transaction(async (db, session) => {
      const actor = await nbaAccess(db, config, user, w, "update", session);
      await lockIcpWorkspace(db, w, session);
      const old = await latest(db, w, decisionId, session);
      if (old.payload.state !== "generating") return present(old);
      let checked =
        generated && !failure
          ? guardDecision(generated.result, context, new Date())
          : null;
      try {
        const current = await nbaContext(
          db,
          config,
          user,
          w,
          input.campaignId,
          input.campaignVersion,
          input.subject,
          session,
        );
        if (nbaHash(current.versions) !== nbaHash(context.versions) && checked)
          checked = {
            ...checked,
            state: "review_required",
            blockers: [
              ...checked.blockers,
              "Approved context changed during generation. Generate a fresh decision before approval.",
            ],
          };
      } catch {
        if (checked)
          checked = {
            ...checked,
            state: "review_required",
            blockers: [
              ...checked.blockers,
              "Campaign context is no longer available. Review the campaign before continuing.",
            ],
          };
      }
      if (
        checked &&
        !checked.blockers.length &&
        input.subject.type === "person"
      )
        await db.collection("events").updateMany(
          {
            workspaceId: w,
            eventType: "nba_measurement_feedback",
            "payload.campaignId": input.campaignId,
            "payload.contactId": input.subject.id,
            "payload.state": "review_required",
            "payload.evidenceId": { $in: context.evidenceIds },
          },
          {
            $set: {
              "payload.state": "recommendation_prepared",
              "payload.decisionId": decisionId,
              updatedAt: new Date(),
            },
          },
          { session },
        );
      return append(db, session, w, input.campaignId, actor, {
        ...old.payload,
        version: 2,
        state: checked?.state ?? "failed",
        decision: checked?.decision ?? null,
        blockers: checked?.blockers ?? [
          "The decision could not be generated. The campaign and your instructions are saved; retry with a new preview.",
        ],
        usage: generated?.usage ?? null,
      });
    });
  }
  async function cancelResearch(
    db: Db,
    session: ClientSession,
    w: string,
    p: Document,
  ) {
    if (!p.researchRequest) return;
    await db.collection("events").updateOne(
      {
        workspaceId: w,
        eventType: "research_job",
        "payload.request.requestKey": p.researchRequest.requestKey,
        "payload.status": { $in: ["queued", "running"] },
      },
      {
        $set: {
          updatedAt: new Date(),
          "payload.status": "cancelled",
          "payload.leaseToken": null,
          "payload.phase": "NBA decision paused or cancelled",
        },
      },
      { session },
    );
  }
  async function change(
    user: AuthenticatedUser,
    w: string,
    id: string,
    raw: unknown,
  ) {
    const input = nbaMutation.parse(raw),
      inputHash = nbaHash({ id, input });
    return transaction(async (db, session) => {
      const actor = await nbaAccess(
        db,
        config,
        user,
        w,
        input.action === "approve" ? "approve" : "update",
        session,
      );
      await lockIcpWorkspace(db, w, session);
      const prior = await db.collection("events").findOne(
        {
          workspaceId: w,
          eventType: "nba_decision",
          "payload.mutationKey": input.requestKey,
        },
        { session },
      );
      if (prior) {
        if (prior.payload.mutationHash !== inputHash)
          throw new HiveConflict("Request already used.");
        return present(await latest(db, w, id, session));
      }
      const old = await latest(db, w, id, session),
        p = old.payload;
      if (p.version !== input.expectedVersion)
        throw new HiveConflict(
          "This decision changed. Refresh before continuing.",
        );
      if (
        ["cancelled", "rejected", "completed", "superseded"].includes(p.state)
      )
        throw new HiveConflict(
          "This decision is closed. Create a new preview to reconsider it.",
        );
      const managed = ["scheduled", "running", "waiting", "paused"].includes(
        p.state,
      );
      if (input.action === "revise" && managed)
        throw new HiveConflict(
          "Cancel this scheduled decision before revising it. Its history is retained.",
        );
      if (["approve", "resume", "pause"].includes(input.action)) {
        if (!execution)
          throw new HiveConflict(
            "Durable NBA execution is not connected yet. Your preview remains saved.",
          );
        if (input.action === "pause") {
          if (!["scheduled", "waiting", "running"].includes(p.state))
            throw new HiveConflict("Only active decisions can be paused.");
          if (p.runId) await execution.cancel(db, session, user, w, p.runId);
          await cancelResearch(db, session, w, p);
          return append(db, session, w, old.campaignId, actor, {
            ...p,
            version: p.version + 1,
            state: "paused",
            mutationKey: input.requestKey,
            mutationHash: inputHash,
            reviewReason: input.reason,
          });
        }
        if (
          input.action === "resume"
            ? p.state !== "paused"
            : !["proposed", "review_required"].includes(p.state)
        )
          throw new HiveConflict(
            "Refresh and review the decision before approval.",
          );
        const context = await nbaContext(
          db,
          config,
          user,
          w,
          old.campaignId,
          p.campaignVersion,
          p.subject,
          session,
          p.decisionId,
        );
        if (nbaHash(context.versions) !== p.contextHash)
          throw new HiveConflict(
            "Campaign, evidence or policy changed. Cancel this decision and create a fresh preview.",
          );
        const approvalTime = new Date();
        // Explicit resume preserves the original history but schedules an elapsed
        // timer now; a paused decision must not become impossible to resume.
        const candidate =
          input.action === "resume" &&
          p.decision?.dueAt &&
          Date.parse(p.decision.dueAt) < approvalTime.getTime()
            ? { ...p.decision, dueAt: approvalTime.toISOString() }
            : p.decision;
        const checked = guardDecision(candidate, context, approvalTime);
        if (checked.blockers.length)
          throw new HiveConflict(checked.blockers.join(" "));
        if (
          ![
            "wait",
            "no_action",
            "human_review",
            "request_evidence",
            "discover_organisations",
            "prepare_content",
          ].includes(checked.decision.action)
        )
          throw new HiveConflict(
            "This capability is not available for NBA execution yet.",
          );
        if (!(await execution.available(db, session)))
          throw new HiveConflict(
            "The NBA worker is not ready. Retry when it is available.",
          );
        const keys = claimKeys(p.subject, p.organisationId);
        const terminal = ["no_action", "human_review"].includes(
          checked.decision.action,
        );
        if (!terminal)
          await claimEngagement(
            db,
            session,
            w,
            old.campaignId,
            p.decisionId,
            keys,
            actor,
          );
        const setup = (context.data as Document).setup;
        const consumer = (context.data as Document).approved.snapshots.some(
          (r: Document) =>
            r.entityType === "ideal_customer_profiles" &&
            ["b2c", "d2c"].includes(
              r.snapshot.definition?.profileType ?? r.snapshot.profileType,
            ),
        );
        const research = [
          "request_evidence",
          "discover_organisations",
        ].includes(checked.decision.action);
        const email = checked.decision.action === "prepare_content";
        const emailBriefs = (
          (context.data as Document).emailBriefs ?? []
        ).filter(
          (b: Document) =>
            !checked.decision.offerId ||
            b.scope.offers.some(
              (o: Document) => o.id === checked.decision.offerId,
            ),
        );
        if (email && (p.subject.type !== "person" || emailBriefs.length !== 1))
          throw new HiveConflict(
            "Select one approved email brief for this offer in Content Strategy before asking NBA to prepare content. You can also preview a specific brief in Email Content Creation.",
          );
        const nextPayload: Document = {
          ...p,
          version: p.version + 1,
          executionVersion: p.version + 1,
          state: terminal ? "completed" : "scheduled",
          decision: checked.decision,
          approvedBy: user,
          approvedAt: approvalTime.toISOString(),
          claimKeys: keys,
          runId: null,
          researchId: null,
          emailRequest: null,
          ...(research
            ? {
                researchRequest: {
                  requestKey: randomUUID(),
                  campaignVersion: p.campaignVersion,
                  objective: (
                    checked.decision.instruction || checked.decision.outcome
                  ).slice(0, 2000),
                  type: consumer
                    ? "market_buyer"
                    : checked.decision.action === "discover_organisations"
                      ? "account_discovery"
                      : "knowledge_gap",
                  scope: {
                    brandId: setup.brandId,
                    products: setup.products,
                    offers: setup.offers,
                    audiences: setup.audiences,
                  },
                  sourceMode: "existing",
                  destinations: [
                    { type: "campaign", id: old.campaignId },
                    ...(p.organisationId
                      ? [{ type: "organisations", id: p.organisationId }]
                      : []),
                  ],
                },
              }
            : {}),
          ...(email
            ? {
                emailRequest: {
                  requestKey: randomUUID(),
                  briefId: emailBriefs[0].id,
                  briefVersion: emailBriefs[0].version,
                  contactId: p.subject.id,
                  campaignId: old.campaignId,
                  campaignVersion: p.campaignVersion,
                  instruction:
                    checked.decision.instruction || checked.decision.outcome,
                },
              }
            : {}),
          mutationKey: input.requestKey,
          mutationHash: inputHash,
          reviewReason: input.reason,
        };
        // Event-only waits stay durable in Hive; a matching authorised event is
        // required. They must not be converted into an immediate timer loop.
        if (!terminal && !research && !email && !p.decision.dueAt)
          nextPayload.state = "waiting";
        const saved = await append(
          db,
          session,
          w,
          old.campaignId,
          actor,
          nextPayload,
        );
        if (nextPayload.state === "scheduled") {
          const runId = await execution.enqueue(
            db,
            session,
            user,
            w,
            old.campaignId,
            nextPayload,
          );
          await db.collection("events").updateOne(
            {
              workspaceId: w,
              eventType: "nba_decision",
              "payload.decisionId": id,
              "payload.version": nextPayload.version,
            },
            { $set: { "payload.runId": runId } },
            { session },
          );
          saved.runId = runId;
        }
        if (terminal)
          await releaseEngagement(
            db,
            session,
            w,
            old.campaignId,
            id,
            keys,
            actor,
            "completed",
          );
        return saved;
      }
      if (["cancel", "reject"].includes(input.action)) {
        if (p.runId && execution)
          await execution.cancel(db, session, user, w, p.runId);
        await cancelResearch(db, session, w, p);
        if (p.claimKeys?.length)
          await releaseEngagement(
            db,
            session,
            w,
            old.campaignId,
            id,
            p.claimKeys,
            actor,
            input.action,
          );
      }
      let refreshed:
        { contextVersions: unknown; contextHash: string } | undefined;
      let next = {
        state: input.action === "cancel" ? "cancelled" : "rejected",
        decision: p.decision,
        blockers: p.blockers,
      };
      if (input.action === "revise") {
        if (!input.decision)
          throw new HiveConflict("Provide the revised decision.");
        const context = await nbaContext(
          db,
          config,
          user,
          w,
          p.campaignId ?? old.campaignId,
          p.campaignVersion,
          p.subject,
          session,
        );
        next = guardDecision(input.decision, context, new Date());
        refreshed = {
          contextVersions: context.versions,
          contextHash: nbaHash(context.versions),
        };
      }
      return append(db, session, w, old.campaignId, actor, {
        ...p,
        ...next,
        ...refreshed,
        version: p.version + 1,
        mutationKey: input.requestKey,
        mutationHash: inputHash,
        reviewReason: input.reason,
      });
    });
  }
  async function history(user: AuthenticatedUser, w: string, id: string) {
    const db = await mongo.database();
    await nbaAccess(db, config, user, w, "read");
    await latest(db, w, id);
    return {
      history: (
        await db
          .collection("events")
          .find({
            workspaceId: w,
            eventType: "nba_decision",
            "payload.decisionId": id,
          })
          .sort({ "payload.version": -1 })
          .limit(100)
          .toArray()
      ).map(present),
    };
  }
  return { list, preview, change, history };
}
