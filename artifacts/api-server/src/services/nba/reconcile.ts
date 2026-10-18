import { createEmailContent } from "../email-content/service";
import { acceptCapabilityResult } from "./handoff";
import { HiveConflict } from "../hive-definitions";
import type { AppConfig } from "../../config";
import type { MongoService } from "../mongo";
import { EventSchema, generatePlatformId } from "../../domain";
import { lockIcpWorkspace } from "../icp/access";
import { nbaAccess, nbaContext } from "./context";
import { nbaHash, guardDecision } from "./model";
import {
  releaseEngagement,
  recordFrontier,
  latestCoordination,
  frontierKey,
  shouldRevisit,
} from "./coordination";
import { createResearchService } from "../research/service";
import { contentGeneratorFromEnvironment } from "../content-strategy/generate";

/** Reconciles domain state with the existing native controller. It neither
 * leases work nor dispatches SQS: those remain native control-plane duties.
 * Each transition re-reads the latest version under the shared workspace lock. */
export function createNbaReconciler(
  config: AppConfig,
  mongo: MongoService,
  generator = contentGeneratorFromEnvironment(),
) {
  const research = createResearchService(config, mongo, generator);
  const email = createEmailContent(config, mongo, generator);
  let afterId: string | undefined;
  async function tick() {
    if (!mongo.withTransaction) throw new Error("Transactions required");
    const db = await mongo.database();
    const rows = await db
      .collection("events")
      .aggregate([
        { $match: { eventType: "nba_decision" } },
        { $sort: { "payload.version": -1 } },
        {
          $group: {
            _id: {
              workspaceId: "$workspaceId",
              decisionId: "$payload.decisionId",
            },
            row: { $first: "$$ROOT" },
          },
        },
        {
          $match: {
            "row.payload.state": {
              $in: ["scheduled", "waiting", "running", "generating"],
            },
          },
        },
        ...(afterId ? [{ $match: { "row.id": { $gt: afterId } } }] : []),
        { $sort: { "row.id": 1 } },
        { $limit: 100 },
      ])
      .toArray();
    afterId = rows.length === 100 ? String(rows.at(-1)!.row.id) : undefined;
    let failures = 0;
    for (const item of rows) {
      try {
        await reconcile(item.row.workspaceId, item.row.payload.decisionId);
      } catch {
        failures++;
      }
    }
    if (failures)
      throw new Error(`NBA reconciliation failed for ${failures} decisions`);
  }
  async function reconcile(w: string, id: string) {
    if (!mongo.withTransaction) throw new Error("Transactions required");
    const db = await mongo.database();
    const row = await db
      .collection("events")
      .find({
        workspaceId: w,
        eventType: "nba_decision",
        "payload.decisionId": id,
      })
      .sort({ "payload.version": -1 })
      .limit(1)
      .next();
    if (
      !row ||
      !["scheduled", "running", "waiting", "generating"].includes(
        row.payload.state,
      )
    )
      return;
    // Research creation is itself durable/idempotent. Repeating after a crash
    // with the saved request key returns the same job, never a second request.
    let researchId: string | undefined;
    if (
      row.payload.state === "running" &&
      row.payload.researchRequest &&
      !row.payload.researchId
    ) {
      try {
        researchId = (
          await research.start(
            row.payload.approvedBy,
            w,
            row.payload.researchRequest,
            "triggered",
            async (d, s) => {
              const latest = await d
                .collection("events")
                .find(
                  {
                    workspaceId: w,
                    eventType: "nba_decision",
                    "payload.decisionId": row.payload.decisionId,
                  },
                  { session: s },
                )
                .sort({ "payload.version": -1 })
                .limit(1)
                .next();
              if (
                !latest ||
                latest.payload.version !== row.payload.version ||
                latest.payload.state !== "running"
              )
                throw new HiveConflict("NBA decision changed");
              await nbaAccess(
                d,
                config,
                row.payload.approvedBy,
                w,
                "approve",
                s,
              );
              const ctx = await nbaContext(
                d,
                config,
                row.payload.approvedBy,
                w,
                row.campaignId,
                row.payload.campaignVersion,
                row.payload.subject,
                s,
                row.payload.decisionId,
              );
              if (
                nbaHash(ctx.versions) !== row.payload.contextHash ||
                guardDecision(
                  {
                    ...row.payload.decision,
                    dueAt: null,
                    awaitEvent: "policy",
                  },
                  ctx,
                  new Date(),
                ).blockers.length
              )
                throw new HiveConflict("NBA context changed");
            },
          )
        ).id;
      } catch {
        /* Saved pending state remains visible; no blind provider retry. */
      }
    }
    let emailDraft: Awaited<ReturnType<typeof email.generate>> | undefined;
    let emailFailureCode: string | undefined;
    if (row.payload.state === "running" && row.payload.emailRequest) {
      try {
        emailDraft = await email.generate(
          row.payload.approvedBy,
          w,
          row.payload.emailRequest,
          async (d, s) => {
            const current = await d
              .collection("events")
              .find(
                {
                  workspaceId: w,
                  eventType: "nba_decision",
                  "payload.decisionId": id,
                },
                { session: s },
              )
              .sort({ "payload.version": -1 })
              .limit(1)
              .next();
            if (
              !current ||
              current.payload.version !== row.payload.version ||
              current.payload.state !== "running"
            )
              throw new HiveConflict("NBA decision changed");
            await nbaAccess(d, config, row.payload.approvedBy, w, "approve", s);
            const ctx = await nbaContext(
              d,
              config,
              row.payload.approvedBy,
              w,
              row.campaignId,
              row.payload.campaignVersion,
              row.payload.subject,
              s,
              id,
            );
            if (
              nbaHash(ctx.versions) !== row.payload.contextHash ||
              guardDecision(
                { ...row.payload.decision, dueAt: null, awaitEvent: "policy" },
                ctx,
                new Date(),
              ).blockers.length
            )
              throw new HiveConflict("NBA context changed");
          },
          id,
        );
      } catch {
        const pending = await db.collection("events").findOne({
          workspaceId: w,
          eventType: "email_content_generation",
          "payload.requestKey": row.payload.emailRequest.requestKey,
        });
        if (
          pending?.payload.status === "running" &&
          Date.now() - new Date(pending.createdAt).getTime() < 90000
        )
          return;
        emailFailureCode = pending?.payload.failureCode;
        /* Failed or uncertain work returns to review, never blind provider retry. */
      }
    }
    await mongo.withTransaction(async (d, s) => {
      await lockIcpWorkspace(d, w, s);
      const current = await d
        .collection("events")
        .find(
          {
            workspaceId: w,
            eventType: "nba_decision",
            "payload.decisionId": row.payload.decisionId,
          },
          { session: s },
        )
        .sort({ "payload.version": -1 })
        .limit(1)
        .next();
      if (!current || current.payload.version !== row.payload.version) return;
      const p = current.payload;
      if (p.state === "generating") {
        if (Date.now() - current.createdAt.getTime() < 300000) return;
        const now = new Date();
        await d.collection("events").insertOne(
          EventSchema.parse({
            id: generatePlatformId("event"),
            workspaceId: w,
            campaignId: current.campaignId,
            eventType: "nba_decision",
            occurredAt: now,
            createdAt: now,
            updatedAt: now,
            createdBy: current.createdBy,
            payload: {
              ...p,
              version: p.version + 1,
              state: "failed",
              blockers: [
                "Generation was interrupted. Your instructions are saved; create a new preview when ready.",
              ],
            },
          }),
          { session: s },
        );
        return;
      }
      const actor = {
        type: "human",
        id: p.approvedBy.subject,
        issuer: p.approvedBy.issuer,
      };
      let next: Record<string, unknown> | undefined;
      try {
        await nbaAccess(d, config, p.approvedBy, w, "approve", s);
        const ctx = await nbaContext(
          d,
          config,
          p.approvedBy,
          w,
          current.campaignId,
          p.campaignVersion,
          p.subject,
          s,
          p.decisionId,
        );
        if (
          nbaHash(ctx.versions) !== p.contextHash ||
          guardDecision(
            { ...p.decision, dueAt: null, awaitEvent: "policy" },
            ctx,
            new Date(),
          ).blockers.length
        )
          next = {
            state: "review_required",
            blockers: [
              "Approved context changed. Reconsider this decision before continuing.",
            ],
          };
      } catch {
        next = {
          state: "review_required",
          blockers: [
            "Current campaign or approval authority is unavailable. Review before continuing.",
          ],
        };
      }
      if (!next && p.state === "scheduled") {
        const run = await d
          .collection("agent_runs")
          .findOne({ id: p.runId, workspaceId: w }, { session: s });
        if (!run)
          next = {
            state: "failed",
            blockers: [
              "The native run could not be found. No outreach was performed.",
            ],
          };
        else if (["failed", "cancelled"].includes(run.status))
          next = {
            state: "review_required",
            blockers: [
              "The native run stopped. Review the decision before retrying.",
            ],
            nativeStatus: run.status,
          };
        else if (run.status === "completed") {
          const result = await d
            .collection("agent_results")
            .findOne({ workspaceId: w, runId: p.runId }, { session: s });
          const output = result?.envelope?.outcome?.content?.domainOutput;
          if (
            output?.decisionId === p.decisionId &&
            output?.decisionVersion === p.version &&
            output?.status === "re_evaluation_due"
          )
            next =
              p.researchRequest || p.emailRequest
                ? { state: "running", blockers: [] }
                : {
                    state: "review_required",
                    blockers: [
                      "The approved reconsideration time has arrived. Review a fresh recommendation.",
                    ],
                    resultId: result!.id,
                  };
          else
            next = {
              state: "review_required",
              blockers: ["Native result needs review before continuing."],
            };
        }
      }
      if (!next && p.state === "running" && p.emailRequest) {
        if (emailDraft) {
          const request = {
            schemaVersion: 1,
            workspaceId: w,
            brandId: emailDraft.brandId,
            campaignId: current.campaignId,
            decisionId: p.decisionId,
            decisionVersion: p.executionVersion,
            capability: "content_creation",
            correlationId: p.emailRequest.requestKey,
            idempotencyKey: p.emailRequest.requestKey,
            authorityReference: `nba:${p.decisionId}:${p.executionVersion}`,
            contextVersions: p.contextVersions,
            deadline: new Date(
              Date.parse(p.approvedAt) + 86400000,
            ).toISOString(),
            instruction: p.emailRequest.instruction,
            subject: p.subject,
          };
          const usageRow = await d.collection("events").findOne(
            {
              workspaceId: w,
              eventType: "email_content_generation",
              "payload.requestKey": p.emailRequest.requestKey,
            },
            { session: s },
          );
          const usage = usageRow?.payload.usage;
          await acceptCapabilityResult(
            d,
            s,
            request,
            {
              schemaVersion: 1,
              workspaceId: w,
              decisionId: p.decisionId,
              decisionVersion: p.executionVersion,
              correlationId: p.emailRequest.requestKey,
              idempotencyKey: p.emailRequest.requestKey,
              status: "completed",
              evidenceIds: [emailDraft.id, emailDraft.libraryAssetId],
              summary: `Email draft saved: ${emailDraft.content.subject}. Review in Email Content Creation; nothing was sent.`,
              retry: "review",
              errorCode: null,
              usage: {
                model: usage?.model ?? null,
                inputTokens: usage?.inputTokens ?? 0,
                outputTokens: usage?.outputTokens ?? 0,
                externalUnits: null,
              },
            },
            {
              workspaceId: w,
              decisionId: p.decisionId,
              version: p.executionVersion,
              state: p.state,
              contextHash: p.contextHash,
            },
            actor,
          );
          next = {
            state: "review_required",
            emailDraftId: emailDraft.id,
            blockers: [
              "Email draft is ready in Email Content Creation. Review it before any separate delivery decision.",
            ],
          };
        } else
          next = {
            state: "review_required",
            blockers: [
              [
                "empty_output",
                "invalid_json",
                "result_contract",
                "refusal",
                "incomplete_output",
              ].includes(emailFailureCode ?? "")
                ? "The model did not return a usable email draft. Reconsider this decision to try again; existing drafts are unchanged and no email was sent."
                : "Email preparation did not complete. Check Email Content Creation before retrying; no email was sent.",
            ],
          };
      }
      if (!next && p.state === "running") {
        if (researchId) next = { state: "running", researchId, blockers: [] };
        else if (!p.researchId)
          next = {
            state: "review_required",
            blockers: [
              "The research handoff could not be confirmed. Check Research before retrying.",
            ],
          };
        else {
          const job = await d
            .collection("events")
            .findOne(
              { workspaceId: w, eventType: "research_job", id: p.researchId },
              { session: s },
            );
          if (job && !["queued", "running"].includes(job.payload.status)) {
            const findings = await d
              .collection("events")
              .find(
                {
                  workspaceId: w,
                  eventType: "research_finding",
                  "payload.jobId": p.researchId,
                },
                { session: s },
              )
              .toArray();
            await acceptCapabilityResult(
              d,
              s,
              {
                schemaVersion: 1,
                workspaceId: w,
                brandId: p.researchRequest.scope.brandId,
                campaignId: current.campaignId,
                decisionId: p.decisionId,
                decisionVersion: p.executionVersion,
                capability: "research",
                correlationId: p.researchId,
                idempotencyKey: p.researchRequest.requestKey,
                authorityReference: `nba:${p.decisionId}:${p.executionVersion}`,
                contextVersions: p.contextVersions,
                deadline: new Date(
                  Date.parse(p.approvedAt) + 86400000,
                ).toISOString(),
                instruction: p.researchRequest.objective,
                subject: p.subject,
              },
              {
                schemaVersion: 1,
                workspaceId: w,
                decisionId: p.decisionId,
                decisionVersion: p.executionVersion,
                correlationId: p.researchId,
                idempotencyKey: p.researchRequest.requestKey,
                status: ["completed", "partial", "cancelled"].includes(
                  job.payload.status,
                )
                  ? job.payload.status
                  : "failed",
                evidenceIds: findings.map((f) => f.id).slice(0, 100),
                summary: String(job.payload.summary ?? "").slice(0, 6000),
                retry: "review",
                errorCode:
                  job.payload.status === "failed" ? "RESEARCH_FAILED" : null,
                usage: {
                  model: null,
                  inputTokens: (job.payload.usage ?? []).reduce(
                    (n: number, u: { inputTokens?: number }) =>
                      n + (u.inputTokens ?? 0),
                    0,
                  ),
                  outputTokens: (job.payload.usage ?? []).reduce(
                    (n: number, u: { outputTokens?: number }) =>
                      n + (u.outputTokens ?? 0),
                    0,
                  ),
                  externalUnits: null,
                },
              },
              {
                workspaceId: w,
                decisionId: p.decisionId,
                version: p.executionVersion,
                state: p.state,
                contextHash: p.contextHash,
              },
              actor,
            );

            const discoveries = await d
              .collection("events")
              .find(
                {
                  workspaceId: w,
                  eventType: "research_discovery",
                  "payload.jobId": p.researchId,
                },
                { session: s },
              )
              .toArray();
            for (const found of discoveries) {
              const v = found.payload.result;
              if (v.type !== "organisations" || (!v.id && !v.details?.website))
                continue;
              try {
                frontierKey({
                  organisationId: v.id,
                  website: v.details?.website,
                });
              } catch {
                continue;
              }
              const memory = await latestCoordination(
                d,
                s,
                w,
                "nba_frontier",
                frontierKey({
                  organisationId: v.id,
                  website: v.details?.website,
                }),
              );
              if (
                !shouldRevisit(
                  memory as Parameters<typeof shouldRevisit>[0],
                  new Date(),
                )
              )
                continue;
              await recordFrontier(d, s, w, current.campaignId, actor, {
                organisationId: v.id,
                website: v.details?.website,
                evidenceIds: v.evidenceIds ?? [],
                state: "needs_review",
                reason: v.reason ?? "Review discovered organisation",
                nextReviewAt: null,
                requestKey: `research:${p.researchId}:${found.id}`,
              });
            }
            next = {
              state: "review_required",
              researchStatus: job.payload.status,
              researchSummary: job.payload.summary ?? "",
              blockers: [
                "Research is available. Review its evidence before selecting the next action.",
              ],
            };
          }
        }
      }
      if (!next) return;
      if (next.state === "review_required" || next.state === "failed")
        await releaseEngagement(
          d,
          s,
          w,
          current.campaignId,
          p.decisionId,
          p.claimKeys ?? [],
          actor,
          String(next.state),
        );
      const now = new Date();
      await d.collection("events").insertOne(
        EventSchema.parse({
          id: generatePlatformId("event"),
          workspaceId: w,
          campaignId: current.campaignId,
          eventType: "nba_decision",
          occurredAt: now,
          createdAt: now,
          updatedAt: now,
          createdBy: actor,
          payload: { ...p, ...next, version: p.version + 1 },
        }),
        { session: s },
      );
    });
  }
  return { tick, reconcile };
}
