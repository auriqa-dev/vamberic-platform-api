import { fullAssetText, requireLibrarySchema } from "./library-text";
import {
  validateExecutor,
  validateExecution,
  assetReuseEligibility,
} from "./execution";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Db, ClientSession, Document } from "mongodb";
import type { AppConfig } from "../../config";
import type { AuthenticatedUser } from "../../middlewares/auth";
import type { MongoService } from "../mongo";
import { resolveHvmContext, withoutMongoId } from "../hvm-context";
import { AuthorizationDenied } from "../../authorization/policy";
import { HiveConflict } from "../hive-definitions";
import { lockIcpWorkspace } from "../icp/access";
import {
  EventSchema,
  generatePlatformId,
  platformIdSchema,
} from "../../domain";
import {
  record,
  mutation,
  parseData,
  generateRequest,
  resultSchemas,
  henryResult,
  type ContentRecord,
} from "./model";
import { contentContext } from "./context";
import { outputSchema, type ContentGenerator } from "./generate";
import { assetData, effectivenessData } from "./model";
import {
  ActionTypeSchema,
  ActionDefinitionSchema,
  actionDefinitionHash,
  assertActionDefinitionTransition,
} from "../../domain/action-library";
export const fingerprint = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
// A strategy recommendation key is not a saved Action record identity. Keep an
// otherwise useful generated brief editable without inventing that relationship.
export function normaliseBriefRecommendation(
  brief: { actionId: string; dependencies: string[] },
  supplied: Pick<ContentRecord, "id" | "kind" | "status">[],
) {
  if (
    brief.actionId &&
    !supplied.some(
      (r) =>
        r.id === brief.actionId &&
        r.kind === "action" &&
        r.status !== "removed",
    )
  ) {
    brief.actionId = "";
    if (brief.dependencies.length < 40)
      brief.dependencies = [
        ...new Set([
          ...brief.dependencies,
          "No saved recommendation was linked. Select a recommendation if this brief should fulfil an existing action.",
        ]),
      ];
  }
}
export function currentRecords(events: Document[]): ContentRecord[] {
  const latest = new Map<string, ContentRecord>();
  for (const e of events) {
    const r = record.parse(e.payload.record);
    if ((latest.get(r.id)?.version ?? 0) < r.version) latest.set(r.id, r);
  }
  return [...latest.values()];
}
export async function contentAccess(
  db: Db,
  config: AppConfig,
  identity: AuthenticatedUser,
  w: string,
  action: "read" | "create" | "update" | "approve",
  session?: ClientSession,
) {
  platformIdSchema("workspace").parse(w);
  const r = await resolveHvmContext(db, config, identity, session);
  if (r.context.application !== "hvmapp" || r.context.actor.type !== "human")
    throw new AuthorizationDenied();
  r.authority.scopeFilter(r.context, action, {
    type: "content_strategy",
    workspaceId: w,
  });
  return r.context.actor;
}
async function records(db: Db, w: string, session?: ClientSession) {
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
function recordBrand(
  row: ContentRecord,
  all: ContentRecord[],
): string | undefined {
  const scope =
    row.data.scope ?? all.find((r) => r.id === row.data.strategyId)?.data.scope;
  return (scope as { brandId: string } | undefined)?.brandId;
}
function assertReferences(
  data: ReturnType<typeof parseData>,
  all: ContentRecord[],
) {
  if ("sourceAssetIds" in data)
    for (const id of data.sourceAssetIds)
      if (
        !all.some(
          (r) => r.id === id && r.kind === "asset" && r.status !== "removed",
        )
      )
        throw new HiveConflict("A source asset is unavailable.");
  if (
    "actionId" in data &&
    data.actionId &&
    !all.some(
      (r) =>
        r.id === data.actionId && r.kind === "action" && r.status !== "removed",
    )
  )
    throw new HiveConflict("Select a current recommendation.");
  if (
    "strategyId" in data &&
    !all.some(
      (r) =>
        r.id === data.strategyId &&
        r.kind === "strategy" &&
        r.status !== "removed",
    )
  )
    throw new HiveConflict("Strategy changed; review this recommendation.");
}
export function createContentStrategy(
  config: AppConfig,
  mongo: MongoService,
  generate?: ContentGenerator,
) {
  return {
    async list(identity: AuthenticatedUser, w: string) {
      const db = await mongo.database();
      await contentAccess(db, config, identity, w, "read");
      const all = await records(db, w);
      const authority = await resolveHvmContext(db, config, identity);
      let catalogueManageable = false;
      try {
        authority.authority.scopeFilter(authority.context, "create", {
          type: "action_types",
        });
        catalogueManageable = true;
      } catch {
        /* Empress catalogue management is independent of workspace authority. */
      }
      const brands = await db
        .collection("brands")
        .find({
          workspaceId: w,
          archived: { $ne: true },
          status: { $ne: "retired" },
        })
        .toArray();
      const choices: Record<string, unknown[]> = {};
      for (const name of ["offerings", "offers", "ideal_customer_profiles"])
        choices[name] = (
          await db
            .collection(name)
            .find({
              workspaceId: w,
              archived: { $ne: true },
              approvedRevision: { $gt: 0 },
              status: { $ne: "retired" },
            })
            .toArray()
        ).map((r) => ({
          id: r.id,
          revision: r.approvedRevision,
          name: r.definition?.name ?? r.name ?? r.id,
          brandId: r.brandId,
        }));
      const proposals = await db
        .collection("events")
        .find({
          workspaceId: w,
          eventType: "content_strategy_generation",
          "payload.status": "completed",
          "payload.task": { $nin: ["henry", "workspace_henry"] },
        })
        .sort({ createdAt: -1 })
        .limit(10)
        .toArray();
      const conversations = await db
        .collection("events")
        .find({
          workspaceId: w,
          eventType: "content_strategy_generation",
          "payload.task": "henry",
          "payload.status": "completed",
          "createdBy.id": authority.context.actor.id,
          "payload.actorIssuer": identity.issuer,
        })
        .sort({ createdAt: -1 })
        .limit(50)
        .toArray();
      const types = await db
        .collection("action_types")
        .find({ status: "active", availability: "queens", archived: false })
        .toArray();
      const handoffs = await db
        .collection("events")
        .find({ workspaceId: w, eventType: "content_strategy_handoff" })
        .sort({ createdAt: -1 })
        .toArray();
      return {
        records: all
          .filter((r) => r.status !== "removed")
          .map((r) => ({
            ...r,
            ...(r.kind === "asset"
              ? { reuseEligibility: assetReuseEligibility(r, all) }
              : {}),
            actionLibraryId: handoffs.find((e) => e.payload.recordId === r.id)
              ?.payload.definitionId,
            needsReview: r.sourceVersions.some(
              (ref) =>
                !all.some(
                  (n) =>
                    n.id === ref.id &&
                    (n.version === ref.version ||
                      ["executor", "execution"].includes(n.kind)) &&
                    n.status !== "removed",
                ),
            ),
          })),
        brands: brands.map((b) => ({
          id: b.id,
          name: b.name,
          website: b.primaryDomain ?? "",
        })),
        choices,
        proposals: proposals.map((e) => ({
          id: e.id,
          task: e.payload.task,
          result: e.payload.result,
          contextHash: e.payload.contextHash,
          scope: e.payload.scope,
          sourceRefs: e.payload.sourceRefs,
          createdAt: e.createdAt,
        })),
        conversations: conversations.map((e) => ({
          id: e.id,
          conversationId: e.payload.conversationId,
          scope: e.payload.scope,
          instruction: e.payload.instruction,
          target: e.payload.target,
          result: e.payload.result,
          createdAt: e.createdAt,
        })),
        actionTypes: types.map((t) => ({ id: t.id, name: t.data.name })),
        capabilities: (
          await db
            .collection("capabilities")
            .find({ archived: { $ne: true } })
            .toArray()
        ).map((r) => ({ id: r.id, name: r.name || r.id })),
        integrations: (
          await db
            .collection("workspace_integrations")
            .find({
              workspaceId: w,
              status: "connected",
              archived: { $ne: true },
            })
            .toArray()
        ).map((r) => ({ id: r.id, name: r.displayName || r.provider || r.id })),
        generationAvailable: Boolean(generate),
        catalogueManageable,
      };
    },
    async history(identity: AuthenticatedUser, w: string, id: string) {
      const db = await mongo.database();
      await contentAccess(db, config, identity, w, "read");
      return (
        await db
          .collection("events")
          .find({
            workspaceId: w,
            eventType: "content_strategy_record",
            "payload.record.id": id,
          })
          .sort({ createdAt: -1 })
          .toArray()
      ).map((e) => e.payload.record);
    },
    async mutate(identity: AuthenticatedUser, w: string, raw: unknown) {
      const input = mutation.parse(raw);
      if (!mongo.withTransaction) throw new Error("Transactions unavailable");
      return mongo.withTransaction(async (db, session) => {
        const actor = await contentAccess(
            db,
            config,
            identity,
            w,
            input.operation === "approve" ? "approve" : "update",
            session,
          ),
          now = await lockIcpWorkspace(db, w, session);
        const retry = await db.collection("events").findOne(
          {
            workspaceId: w,
            eventType: "content_strategy_record",
            "payload.requestKey": input.requestKey,
          },
          { session },
        );
        const requestHash = fingerprint(input);
        if (retry) {
          if (retry.payload.requestHash !== requestHash)
            throw new HiveConflict(
              "Request identity was reused with different content.",
            );
          return retry.payload.record;
        }
        const all = await records(db, w, session),
          previous = all.find((r) => r.id === input.id);
        if (
          (input.id && !previous) ||
          (previous?.kind !== input.kind && previous) ||
          (previous?.version ?? 0) !== input.expectedVersion ||
          previous?.status === "removed"
        )
          throw new HiveConflict("This record changed. Reload before saving.");
        if (
          previous?.data.sourceType === "email_content" ||
          (input.data &&
            typeof input.data === "object" &&
            "sourceType" in input.data &&
            input.data.sourceType === "email_content")
        )
          throw new HiveConflict(
            "View, edit, approve or remove this recipient-specific draft in Email Content Creation. Library registration does not grant reuse or sending authority.",
          );
        if (
          previous?.data.sourceType === "offer_output" &&
          !["remove", "associate"].includes(input.operation)
        )
          throw new HiveConflict(
            "Edit and approve the source offer in Offer Architecture. This Library output is a versioned internal reference.",
          );
        if (!previous && input.operation !== "save")
          throw new HiveConflict("Save this record first.");
        if (
          input.operation === "save" &&
          input.data &&
          typeof input.data === "object" &&
          (("offerOutput" in input.data && input.data.offerOutput != null) ||
            ("sourceType" in input.data &&
              input.data.sourceType === "offer_output"))
        )
          throw new HiveConflict(
            "Offer outputs are registered through Offer Architecture.",
          );
        if (
          input.operation === "associate" &&
          (input.kind !== "asset" || !previous)
        )
          throw new HiveConflict("Select an existing Library asset.");
        const associationChange =
          input.operation === "associate"
            ? z
                .object({ associations: assetData.shape.associations })
                .strict()
                .parse(input.data)
            : undefined;
        const data = parseData(
          input.kind,
          associationChange
            ? {
                ...previous!.data,
                associations: associationChange.associations,
              }
            : input.operation === "save"
              ? input.data
              : previous!.data,
        );
        if (
          !previous &&
          input.kind === "strategy" &&
          "scope" in data &&
          all.some(
            (r) =>
              r.kind === "strategy" &&
              r.status !== "removed" &&
              (r.data.scope as { brandId: string }).brandId ===
                data.scope.brandId,
          )
        )
          throw new HiveConflict(
            "Revise the existing Content Strategy for this brand. New offers extend its current decisions.",
          );
        if (
          input.kind === "asset" &&
          "contentTextId" in data &&
          data.contentTextId
        ) {
          if (!previous || data.contentTextId !== previous.data.contentTextId)
            throw new HiveConflict(
              "Use this asset's own original source reference.",
            );
          if (data.text === String(previous.data.text).trim())
            data.text = String(
              (await fullAssetText(db, w, previous, session)).data.text,
            );
        }
        if (
          input.kind === "asset" &&
          "associations" in data &&
          input.operation === "save"
        ) {
          const substance = (value: Record<string, unknown>) => [
            value.title,
            value.text,
            value.description,
            value.url,
            value.sourceDocumentId,
            value.sourceDocumentRevision,
          ];
          const previousFull = previous
            ? await fullAssetText(db, w, previous, session)
            : undefined;
          const changed =
            previousFull &&
            fingerprint(substance(previousFull.data)) !==
              fingerprint(substance(data));
          if (
            !data.contentHash ||
            (changed && data.contentHash === previous!.data.contentHash)
          )
            data.contentHash = fingerprint(substance(data));
          if (changed)
            data.associations = data.associations.map((a) => ({
              ...a,
              decision: "suggested" as const,
            }));
        }
        if (
          input.kind === "asset" &&
          "associations" in data &&
          input.operation !== "remove"
        ) {
          for (const association of data.associations) {
            const offer = await db
              .collection("offers")
              .findOne(
                { id: association.offerId, workspaceId: w },
                { session },
              );
            if (!offer)
              throw new HiveConflict(
                "An asset association belongs to another workspace or is unavailable.",
              );
            const parent = await db
              .collection("offerings")
              .findOne({ id: offer.offeringId, workspaceId: w }, { session });
            if (!parent || parent.brandId !== data.scope.brandId)
              throw new HiveConflict(
                "Asset associations must belong to the selected brand.",
              );
            for (const [collection, ids] of [
              ["ideal_customer_profiles", association.audienceIds],
              ["buyer_profiles", association.buyerIds],
              ["campaigns", association.campaignIds],
            ] as const) {
              for (const id of ids)
                if (
                  !(await db
                    .collection(collection)
                    .findOne({ id, workspaceId: w }, { session }))
                )
                  throw new HiveConflict(
                    "A selected audience or campaign is unavailable in this workspace.",
                  );
            }
            if (association.decision === "accepted") {
              await contentAccess(db, config, identity, w, "approve", session);
              if (
                offer.archived ||
                offer.status === "retired" ||
                offer.approvedRevision !== association.offerRevision
              )
                throw new HiveConflict(
                  "Review the current approved offer before accepting this association.",
                );
            }
          }
        }
        if ("briefType" in data && data.briefType !== "content")
          data.classification = "not_applicable";
        if (input.operation !== "remove") assertReferences(data, all);
        if (
          previous &&
          "scope" in data &&
          previous.data.scope &&
          data.scope.brandId !==
            (previous.data.scope as { brandId: string }).brandId
        )
          throw new HiveConflict(
            "Move content between brands only through an explicit new record.",
          );
        const referenceIds =
          input.operation === "remove"
            ? []
            : [
                ...new Set([
                  ...("sourceAssetIds" in data ? data.sourceAssetIds : []),
                  ...("sourceRecordIds" in data ? data.sourceRecordIds : []),
                  ...("strategyId" in data ? [data.strategyId] : []),
                  ...("actionId" in data && data.actionId
                    ? [data.actionId]
                    : []),
                  ...("assetId" in data && data.assetId ? [data.assetId] : []),
                  ...("briefId" in data ? [data.briefId, data.executorId] : []),
                  ...("executionId" in data && data.executionId
                    ? [data.executionId]
                    : []),
                  ...("sourceMetadata" in data &&
                  data.sourceMetadata.executionId
                    ? [data.sourceMetadata.executionId]
                    : []),
                  ...("recommendations" in data
                    ? data.recommendations.flatMap((r) => r.sourceAssetIds)
                    : []),
                ]),
              ];
        const sourceVersions = referenceIds.map((id) => {
          const row = all.find((r) => r.id === id && r.status !== "removed");
          if (!row || id === input.id)
            throw new HiveConflict(
              "A source is unavailable or refers to itself.",
            );
          if (
            "scope" in data &&
            recordBrand(row, all) &&
            data.scope.brandId !== recordBrand(row, all)
          )
            throw new HiveConflict("Source belongs to a different brand.");
          const reaches = (
            item: ContentRecord,
            seen = new Set<string>(),
          ): boolean => {
            if (seen.has(item.id)) return false;
            seen.add(item.id);
            return item.sourceVersions.some(
              (ref) =>
                ref.id === input.id ||
                Boolean(
                  all.find((n) => n.id === ref.id) &&
                  reaches(
                    all.find((n) => n.id === ref.id)!,
                    seen,
                  ),
                ),
            );
          };
          if (input.id && reaches(row))
            throw new HiveConflict("Source relationships cannot form a cycle.");
          return { id, version: row.version };
        });
        if (
          input.operation === "approve" &&
          previous?.sourceVersions.some(
            (ref) =>
              !all.some(
                (n) =>
                  n.id === ref.id &&
                  (n.version === ref.version ||
                    ["executor", "execution"].includes(n.kind)) &&
                  n.status !== "removed",
              ),
          )
        )
          throw new HiveConflict(
            "Source material changed. Review and save a fresh version before approval.",
          );
        if (input.operation !== "remove" && "strategyId" in data) {
          const snapshot = await db.collection("events").findOne(
            {
              workspaceId: w,
              eventType: "content_strategy_record",
              "payload.record.id": data.strategyId,
              "payload.record.kind": "strategy",
              "payload.record.version": data.strategyRevision,
            },
            { session },
          );
          if (!snapshot)
            throw new HiveConflict(
              "The referenced strategy version is unavailable.",
            );
          const ref = sourceVersions.find((r) => r.id === data.strategyId);
          if (ref) ref.version = data.strategyRevision;
        }
        if (input.kind === "action" && !previous && "strategyId" in data) {
          const prior = all.find(
            (r) =>
              r.kind === "action" &&
              r.data.strategyId === data.strategyId &&
              (r.data.key === data.key || r.data.title === data.title),
          );
          if (prior) return prior;
        }

        if (input.operation !== "remove" && input.kind === "executor")
          await validateExecutor(db, session, w, data);
        if (input.operation !== "remove" && input.kind === "execution") {
          await contentAccess(db, config, identity, w, "approve", session);
          const brief = await validateExecution(
            db,
            session,
            w,
            data,
            all,
            previous,
          );
          if (!previous) {
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
                "Review the changed brief sources before assignment.",
              );
            const current = await contentContext(
              db,
              config,
              identity,
              w,
              brief.data.scope,
              session,
            );
            if (brief.contextHash !== current.hash)
              throw new HiveConflict(
                "Review the changed business context before assignment.",
              );
            const action = all.find((r) => r.id === brief.data.actionId);
            if (
              !action ||
              action.status !== "approved" ||
              ["BLOCKED", "DEFERRED", "REJECTED"].includes(
                String(action.data.feasibility),
              )
            )
              throw new HiveConflict(
                "Approve the originating recommendation before commissioning work.",
              );
          }
          if ("briefId" in data) {
            const handoff = await db.collection("events").findOne(
              {
                workspaceId: w,
                eventType: "content_strategy_handoff",
                "payload.recordId": brief.data.actionId,
              },
              { session, sort: { createdAt: -1 } },
            );
            if (!handoff)
              throw new HiveConflict(
                "Add the originating action to the Library before assigning its brief.",
              );
            const definition = await db
              .collection("action_definitions")
              .findOne(
                {
                  workspaceId: w,
                  id: handoff.payload.definitionId,
                  archived: false,
                },
                { session },
              );
            if (!definition)
              throw new HiveConflict(
                "The originating Library item is unavailable.",
              );
            if (previous && previous.data.actionDefinitionId !== definition.id)
              throw new HiveConflict("The linked Library item changed.");
            data.actionDefinitionId = definition.id;
          }
          const ref = sourceVersions.find((r) => r.id === brief.id);
          if (ref) ref.version = brief.version;
        }
        const executionId =
          "executionId" in data
            ? data.executionId
            : "sourceMetadata" in data
              ? data.sourceMetadata.executionId
              : "";
        if (input.operation !== "remove" && executionId) {
          const execution = all.find(
            (r) =>
              r.id === executionId &&
              r.kind === "execution" &&
              r.status !== "removed",
          );
          if (!execution)
            throw new HiveConflict("Select an execution in this workspace.");
          if (
            "sourceMetadata" in data &&
            (data.sourceMetadata.briefId !== execution.data.briefId ||
              data.sourceMetadata.briefVersion !== execution.data.briefVersion)
          )
            throw new HiveConflict(
              "The delivered asset must use the assignment's exact brief revision.",
            );
        }
        if (input.operation !== "remove" && "eventIds" in data) {
          for (const id of data.eventIds) {
            if (
              !(await db
                .collection("events")
                .findOne({ id, workspaceId: w }, { session }))
            )
              throw new HiveConflict(
                "Select evidence events from this workspace.",
              );
          }
        }
        if (input.operation !== "remove" && "sourceMetadata" in data) {
          if (
            data.sourceMetadata.capabilityId &&
            !(await db.collection("capabilities").findOne(
              {
                id: data.sourceMetadata.capabilityId,
                archived: { $ne: true },
              },
              { session },
            ))
          )
            throw new HiveConflict(
              "Production capability is no longer available.",
            );
          if (
            data.sourceMetadata.integrationId &&
            !(await db.collection("workspace_integrations").findOne(
              {
                id: data.sourceMetadata.integrationId,
                workspaceId: w,
                archived: { $ne: true },
                status: "connected",
              },
              { session },
            ))
          )
            throw new HiveConflict(
              "Production integration is not connected in this workspace.",
            );
        }
        if (
          input.operation !== "remove" &&
          "sourceMetadata" in data &&
          data.sourceMetadata.briefId
        ) {
          const history = await db.collection("events").findOne(
            {
              workspaceId: w,
              eventType: "content_strategy_record",
              "payload.record.id": data.sourceMetadata.briefId,
              "payload.record.version": data.sourceMetadata.briefVersion,
              "payload.record.kind": "brief",
              "payload.record.status": "approved",
            },
            { session },
          );
          if (!data.text && !data.url && !data.sourceDocumentId)
            throw new HiveConflict(
              "Attach the returned file, content or durable URL.",
            );
          if (!data.sourceMetadata.producer.trim())
            throw new HiveConflict("Record who produced this asset.");
          if (
            history &&
            history.payload.record.data.scope.brandId !== data.scope.brandId
          )
            throw new HiveConflict(
              "The production brief belongs to a different brand.",
            );
          if (!history)
            throw new HiveConflict(
              "Returned assets must reference an approved brief revision in this workspace.",
            );
        }
        if (
          input.operation === "remove" &&
          all.some(
            (r) =>
              r.status !== "removed" &&
              r.id !== input.id &&
              ((Array.isArray(r.data.sourceAssetIds) &&
                r.data.sourceAssetIds.includes(input.id)) ||
                r.data.actionId === input.id ||
                r.data.strategyId === input.id ||
                r.sourceVersions.some((ref) => ref.id === input.id) ||
                (r.data.sourceMetadata as { briefId?: string } | undefined)
                  ?.briefId === input.id),
          )
        )
          throw new HiveConflict(
            "This item is referenced by another record. Remove or revise its dependants first.",
          );
        if (input.kind === "action" && input.operation === "remove") {
          const link = await db.collection("events").findOne(
            {
              workspaceId: w,
              eventType: "content_strategy_handoff",
              "payload.recordId": input.id,
            },
            { session, sort: { createdAt: -1 } },
          );
          if (link) {
            const linked = await db
              .collection("action_definitions")
              .findOne(
                { id: link.payload.definitionId, workspaceId: w },
                { session },
              );
            if (linked && linked.status !== "retired") {
              if (linked.status === "approved")
                await contentAccess(
                  db,
                  config,
                  identity,
                  w,
                  "approve",
                  session,
                );
              const retired = ActionDefinitionSchema.parse({
                ...withoutMongoId(linked),
                status: "retired",
                archived: true,
                archivedAt: now,
                updatedAt: now,
                updatedBy: actor,
              });
              assertActionDefinitionTransition(withoutMongoId(linked), retired);
              await db.collection("action_definitions").updateOne(
                { id: linked.id, workspaceId: w },
                { $set: retired },
                {
                  session,
                },
              );
            }
          }
        }
        let contextHash = previous?.contextHash;
        if (input.operation !== "remove" && "scope" in data)
          contextHash = (
            await contentContext(db, config, identity, w, data.scope, session)
          ).hash;
        if (
          input.operation === "approve" &&
          previous?.contextHash &&
          contextHash !== previous.contextHash
        )
          throw new HiveConflict(
            "Approved business context changed. Review and save before approval.",
          );
        if (
          input.operation !== "remove" &&
          input.kind === "asset" &&
          "sourceDocumentId" in data &&
          data.sourceDocumentId
        ) {
          const doc = await db.collection("events").findOne(
            {
              id: data.sourceDocumentId,
              workspaceId: w,
              eventType: "research_document",
              "payload.status": "ready",
            },
            { session },
          );
          if (doc && "fileHash" in data) {
            data.fileHash = doc.payload.sha256 ?? "";
            data.originalFilename = doc.payload.filename;
            data.uploadedAt = new Date(doc.createdAt).toISOString();
            data.owner = doc.createdBy?.id ?? actor.id;
            if (!data.sourceDocumentRevision)
              data.sourceDocumentRevision = doc.payload.revision;
          }
          if (
            doc &&
            "sourceDocumentRevision" in data &&
            data.sourceDocumentRevision &&
            doc.payload.revision !== data.sourceDocumentRevision &&
            input.operation === "approve"
          )
            throw new HiveConflict(
              "The original document changed. Review and relink its current version before approval.",
            );
          if (!doc)
            throw new HiveConflict(
              "Upload and finish saving the source document first.",
            );
        }
        if (
          !previous &&
          input.kind === "asset" &&
          "sourceDocumentId" in data &&
          data.sourceDocumentId
        ) {
          const sameSource = all.find(
            (r) =>
              r.kind === "asset" &&
              r.status !== "removed" &&
              (r.data.sourceDocumentId === data.sourceDocumentId ||
                (data.fileHash && r.data.fileHash === data.fileHash)) &&
              (r.data.scope as { brandId: string }).brandId ===
                data.scope.brandId,
          );
          if (sameSource) return sameSource;
        }
        if (!previous && input.kind === "asset") {
          const duplicate = all.find(
            (r) =>
              r.kind === "asset" &&
              r.status !== "removed" &&
              (r.data.sourceMetadata as { briefId: string }).briefId ===
                (data as z.infer<typeof assetData>).sourceMetadata.briefId &&
              (r.data.sourceMetadata as { briefVersion: number })
                .briefVersion ===
                (data as z.infer<typeof assetData>).sourceMetadata
                  .briefVersion &&
              (((data as { url: string }).url &&
                r.data.url === (data as { url: string }).url &&
                (r.data.scope as { brandId: string }).brandId ===
                  (data as { scope: { brandId: string } }).scope.brandId) ||
                ("text" in data &&
                  data.text.length > 0 &&
                  r.data.text === data.text &&
                  r.data.channel === data.channel &&
                  r.data.assetType === data.assetType &&
                  fingerprint(r.data.sourceAssetIds) ===
                    fingerprint(data.sourceAssetIds) &&
                  (r.data.scope as { brandId: string }).brandId ===
                    data.scope.brandId) ||
                fingerprint(r.data) === fingerprint(data)),
          );
          if (duplicate) return duplicate;
        }
        const assetId = previous?.id ?? generatePlatformId("event");
        if (
          input.kind === "asset" &&
          "contentTextId" in data &&
          data.text.length > 5000
        ) {
          await requireLibrarySchema(db, session);
          const textId = fingerprint([w, assetId, data.text]);
          const stored = await db
            .collection("library_text")
            .findOne({ id: textId, workspaceId: w, assetId }, { session });
          if (!stored)
            await db.collection("library_text").insertOne(
              {
                id: textId,
                workspaceId: w,
                assetId,
                text: data.text,
                createdAt: now,
              },
              { session },
            );
          data.contentTextId = textId;
          data.text = data.text.slice(0, 5000).trim();
        } else if (input.kind === "asset" && "contentTextId" in data)
          data.contentTextId = "";
        const evidenceEventId = generatePlatformId("event");
        const next = record.parse({
          evidenceEventId,
          id: assetId,
          version: (previous?.version ?? 0) + 1,
          kind: input.kind,
          status:
            input.operation === "associate"
              ? previous!.status
              : input.operation === "approve"
                ? "approved"
                : input.operation === "remove"
                  ? "removed"
                  : "draft",
          data,
          updatedAt: now.toISOString(),
          fingerprint: fingerprint(data),
          sourceVersions,
          ...(contextHash ? { contextHash } : {}),
        });
        if (Buffer.byteLength(JSON.stringify(next)) > 250000)
          throw new HiveConflict(
            "This record is too large. Split it into smaller assets.",
          );
        const event = EventSchema.parse({
          id: evidenceEventId,
          workspaceId: w,
          eventType: "content_strategy_record",
          occurredAt: now,
          createdAt: now,
          updatedAt: now,
          createdBy: actor,
          updatedBy: actor,
          source: { system: "content_strategy" },
          payload: {
            requestKey: input.requestKey,
            requestHash,
            record: next,
            relationships: {
              executionId:
                executionId ||
                (input.kind === "execution" ? next.id : undefined),
              briefId:
                "briefId" in data
                  ? data.briefId
                  : "sourceMetadata" in data
                    ? data.sourceMetadata.briefId
                    : undefined,
              actionId: "actionId" in data ? data.actionId : undefined,
            },
            observationOnly: input.kind === "effectiveness",
          },
        });
        await db.collection("events").insertOne(event, { session });
        return next;
      });
    },
    async propose(identity: AuthenticatedUser, w: string, raw: unknown) {
      const input = generateRequest.parse(raw);
      if (input.task === "henry" && !input.conversationId)
        throw new HiveConflict("Start a conversation before asking Henry.");
      if (input.draft) {
        input.draft.data = parseData(input.draft.kind, input.draft.data);
        const draftScope = (input.draft.data as { scope: unknown }).scope;
        if (fingerprint(draftScope) !== fingerprint(input.scope))
          throw new HiveConflict("The draft belongs to a different scope.");
      }
      if (!generate || !mongo.withTransaction)
        throw new HiveConflict("Generation is unavailable.");
      const reserved = await mongo.withTransaction(async (db, session) => {
        const actor = await contentAccess(
            db,
            config,
            identity,
            w,
            "update",
            session,
          ),
          now = await lockIcpWorkspace(db, w, session);
        const hash = fingerprint(input),
          old = await db.collection("events").findOne(
            {
              workspaceId: w,
              eventType: "content_strategy_generation",
              "payload.requestKey": input.requestKey,
              ...(input.task === "henry"
                ? {
                    "createdBy.id": actor.id,
                    "payload.actorIssuer": actor.issuer,
                  }
                : {}),
            },
            { session },
          );
        if (old) {
          if (old.payload.requestHash !== hash)
            throw new HiveConflict("Request identity changed.");
          if (old.payload.status === "completed") return { old };
          throw new HiveConflict(
            "This request is running or interrupted. Refresh, or start a new request after it stops.",
          );
        }
        const running = await db.collection("events").findOne(
          {
            workspaceId: w,
            eventType: "content_strategy_generation",
            "payload.status": "running",
            createdAt: { $gt: new Date(Date.now() - 120000) },
          },
          { session },
        );
        if (running)
          throw new HiveConflict(
            "Another content request is running. Please wait.",
          );
        const context = await contentContext(
            db,
            config,
            identity,
            w,
            input.scope,
            session,
          ),
          all = await records(db, w, session),
          selected = input.recordIds.map((id) => {
            const r = all.find((r) => r.id === id && r.status !== "removed");
            if (!r) throw new HiveConflict("A selected source is unavailable.");
            return r;
          });
        if (input.task === "write") {
          const briefs = selected.filter((r) => r.kind === "brief");
          if (
            briefs.length !== 1 ||
            briefs[0]!.status !== "approved" ||
            briefs[0]!.data.briefType !== "content"
          )
            throw new HiveConflict("Choose one approved content brief.");
          const brief = briefs[0]!;
          if (JSON.stringify(brief.data.scope) !== JSON.stringify(input.scope))
            throw new HiveConflict(
              "Use the approved brief's product, offer and audience scope.",
            );
          if (recordBrand(brief, all) !== input.scope.brandId)
            throw new HiveConflict("The brief belongs to another brand.");
          for (const id of (brief.data.sourceAssetIds ?? []) as string[]) {
            const asset = all.find(
              (r) =>
                r.id === id && r.kind === "asset" && r.status !== "removed",
            );
            if (!asset || recordBrand(asset, all) !== input.scope.brandId)
              throw new HiveConflict(
                "A brief source is unavailable for this brand.",
              );
            if (!selected.some((r) => r.id === id)) selected.push(asset);
          }
        }
        for (let i = 0; i < selected.length; i++)
          selected[i] = await fullAssetText(db, w, selected[i]!, session);
        if (
          input.task === "analyse" &&
          selected.filter((r) => r.kind === "asset").length !== 1
        )
          throw new HiveConflict("Select one asset to analyse.");
        if (
          input.task === "architecture" &&
          selected.filter((r) => r.kind === "architecture").length !== 1
        )
          throw new HiveConflict(
            "Select one imported architecture to interpret.",
          );
        if (
          input.task === "strategy" &&
          selected.some((r) => r.kind === "architecture" && !r.data.confirmed)
        )
          throw new HiveConflict(
            "Confirm your imported architecture interpretation before generating a strategy.",
          );
        if (
          input.draft?.recordId &&
          !selected.some(
            (r) =>
              r.id === input.draft!.recordId &&
              r.version === input.draft!.version &&
              r.kind === input.draft!.kind,
          )
        )
          throw new HiveConflict(
            "The draft record changed. Reload before refining it.",
          );
        const conversation =
          input.task === "henry"
            ? await db
                .collection("events")
                .find(
                  {
                    workspaceId: w,
                    eventType: "content_strategy_generation",
                    "payload.task": "henry",
                    "payload.status": "completed",
                    "payload.conversationId": input.conversationId,
                    "payload.scope.brandId": input.scope.brandId,
                    "createdBy.id": actor.id,
                    "payload.actorIssuer": actor.issuer,
                  },
                  { session },
                )
                .sort({ createdAt: -1 })
                .limit(12)
                .toArray()
            : [];
        const selectedBrand = input.scope.brandId;
        if (
          selected.some(
            (r) =>
              Boolean(recordBrand(r, all)) &&
              recordBrand(r, all) !== selectedBrand,
          )
        )
          throw new HiveConflict("Select sources for the chosen brand only.");
        if (Buffer.byteLength(JSON.stringify({ context, selected })) > 600000)
          throw new HiveConflict(
            "Select fewer source documents for this operation.",
          );
        const brandStrategies = all.filter(
          (r) =>
            r.kind === "strategy" &&
            r.status !== "removed" &&
            (r.data.scope as { brandId: string }).brandId === selectedBrand,
        );
        const decisions = all.filter(
          (r) =>
            r.status !== "removed" &&
            (brandStrategies.some((s) => s.id === r.id) ||
              (r.kind === "action" &&
                brandStrategies.some((s) => s.id === r.data.strategyId))),
        );
        if (
          Buffer.byteLength(JSON.stringify({ context, selected, decisions })) >
          600000
        )
          throw new HiveConflict(
            "This context is too large for one request. Narrow the strategy scope and selected evidence.",
          );
        if (
          Buffer.byteLength(
            JSON.stringify({
              context,
              selected,
              decisions,
              conversation,
              draft: input.draft,
            }),
          ) > 700000
        )
          throw new HiveConflict(
            "This conversation and evidence are too large. Start a new conversation or select fewer sources.",
          );
        const analysisHash = fingerprint({
          task: input.task,
          instruction: input.instruction,
          contextHash: context.hash,
          selected: selected.map((r) => ({
            id: r.id,
            version: r.version,
            fingerprint: r.fingerprint,
          })),
        });
        if (["analyse", "architecture"].includes(input.task)) {
          const cached = await db.collection("events").findOne(
            {
              workspaceId: w,
              eventType: "content_strategy_generation",
              "payload.status": "completed",
              "payload.analysisHash": analysisHash,
            },
            { session },
          );
          if (cached) return { old: cached };
        }
        const payload = {
          analysisHash,
          scope: input.scope,
          requestKey: input.requestKey,
          requestHash: hash,
          status: "running",
          ...(input.task === "henry"
            ? {
                conversationId: input.conversationId,
                scope: input.scope,
                actorIssuer: actor.issuer,
                target: input.draft?.recordId
                  ? {
                      id: input.draft.recordId,
                      version: input.draft.version,
                      kind: input.draft.kind,
                    }
                  : undefined,
                instruction: input.instruction,
              }
            : {}),
          task: input.task,
          contextHash: context.hash,
          sourceRefs: selected.map((r) => ({ id: r.id, version: r.version })),
        };
        const event = EventSchema.parse({
          id: generatePlatformId("event"),
          workspaceId: w,
          eventType: "content_strategy_generation",
          occurredAt: now,
          createdAt: now,
          updatedAt: now,
          createdBy: actor,
          updatedBy: actor,
          source: { system: "content_strategy" },
          payload,
        });
        await db.collection("events").insertOne(event, { session });
        return {
          event,
          context,
          selected,
          decisions,
          conversation: conversation.reverse().map((e) => ({
            user: e.payload.instruction,
            reply: e.payload.result.reply,
            originalScope: e.payload.scope,
          })),
          availableRecords: all
            .filter(
              (r) =>
                r.status !== "removed" && recordBrand(r, all) === selectedBrand,
            )
            .map((r) => ({
              id: r.id,
              version: r.version,
              kind: r.kind,
              title: r.data.title,
              status: r.status,
            })),
        };
      });
      if (reserved.old) return reserved.old.payload.result;
      const { event, context, selected } = reserved;
      let completedUsage:
        Awaited<ReturnType<ContentGenerator>>["usage"] | undefined;
      try {
        const generated = await generate(input.task, {
          instruction: input.instruction,
          context,
          records: selected,
          existingDecisions: reserved.decisions,
          ...(input.task === "henry"
            ? {
                conversation: reserved.conversation,
                currentDraft: input.draft ?? null,
                availableRecords: reserved.availableRecords,
              }
            : {}),
        });
        completedUsage = generated.usage;
        return await mongo.withTransaction(async (db, session) => {
          await contentAccess(db, config, identity, w, "update", session);
          await lockIcpWorkspace(db, w, session);
          const fresh = await contentContext(
              db,
              config,
              identity,
              w,
              input.scope,
              session,
            ),
            all = await records(db, w, session);
          if (
            fresh.hash !== context.hash ||
            selected.some(
              (r) =>
                !all.some(
                  (n) =>
                    n.id === r.id &&
                    n.version === r.version &&
                    n.status !== "removed",
                ),
            )
          )
            throw new HiveConflict(
              "Context changed during generation. Saved records are unchanged; start again with current sources.",
            );
          const response = resultSchemas[input.task].parse(generated.result);
          const henry =
            input.task === "henry" ? henryResult.parse(response) : undefined;
          if (henry?.strategy && henry.brief)
            throw new HiveConflict(
              "Henry proposed two different tasks. Ask for one at a time.",
            );
          if (
            henry?.reviewRecordId &&
            !all.some(
              (r) =>
                r.id === henry.reviewRecordId &&
                r.status !== "removed" &&
                recordBrand(r, all) === input.scope.brandId &&
                reserved.availableRecords.some(
                  (n) => n.id === r.id && n.version === r.version,
                ),
            )
          )
            throw new HiveConflict(
              "That record changed or is unavailable. Ask Henry again with the current records.",
            );
          const result = henry?.strategy ?? henry?.brief ?? response;
          if (
            (input.task === "brief" || henry?.brief) &&
            "actionId" in result &&
            "dependencies" in result
          )
            normaliseBriefRecommendation(
              result,
              input.task === "henry" ? reserved.availableRecords : selected,
            );
          if (
            (input.task === "strategy" || input.task === "henry") &&
            "recommendations" in result
          ) {
            result.recommendations = result.recommendations.map((item) => {
              const prior = reserved.decisions.find(
                (r) =>
                  r.kind === "action" &&
                  (r.data.key === item.key || r.data.title === item.title),
              );
              if (!prior) return item;
              const protectedDecision =
                Boolean(prior.data.decisionReason) ||
                ["approved", "completed", "deferred", "cancelled"].includes(
                  String(prior.data.progress),
                );
              return {
                ...item,
                key: String(prior.data.key),
                priority: prior.data.priority as typeof item.priority,
                ...(protectedDecision
                  ? {
                      feasibility: prior.data
                        .feasibility as typeof item.feasibility,
                    }
                  : {}),
              };
            });
          }
          if (
            (input.task === "strategy" || henry?.strategy) &&
            "recommendations" in result
          ) {
            const prior = reserved.decisions
              .filter((r) => r.kind === "strategy")
              .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
            if (prior) {
              const recommendations = (prior.data.recommendations ??
                []) as z.infer<typeof import("./model").recommendation>[];
              const retained = recommendations.filter(
                (old) =>
                  !result.recommendations.some((next) => next.key === old.key),
              );
              if (result.recommendations.length + retained.length > 40)
                throw new HiveConflict(
                  "This update exceeds the current strategy's recommendation capacity. Consolidate existing recommendations before adding more; saved decisions are unchanged.",
                );
              result.recommendations = [...retained, ...result.recommendations];
            }
          }
          if ("scope" in result) result.scope = input.scope;
          if ("sourceRecordIds" in result)
            result.sourceRecordIds = selected
              .filter((r) => r.kind !== "strategy" && r.kind !== "action")
              .map((r) => r.id);
          if (input.task === "architecture" && "markdown" in result) {
            result.markdown = String(
              selected.find((r) => r.kind === "architecture")!.data.markdown,
            );
            result.confirmed = false;
          }
          if (input.task === "analyse" && "text" in result) {
            const original = selected.find((r) => r.kind === "asset")!;
            Object.assign(result, {
              text: original.data.text,
              url: original.data.url,
              sourceDocumentId: original.data.sourceDocumentId,
              sourceDocumentRevision: original.data.sourceDocumentRevision ?? 0,
              contentTextId: original.data.contentTextId ?? "",
              contentHash: original.data.contentHash ?? "",
              visibility: original.data.visibility ?? "private",
              originalFilename: original.data.originalFilename ?? "",
              fileHash: original.data.fileHash ?? "",
              uploadedAt: original.data.uploadedAt ?? "",
              owner: original.data.owner ?? "",
              sourceType: original.data.sourceType ?? "manual",
              processingNote: original.data.processingNote ?? "",
              archived: original.data.archived ?? false,
              associations: original.data.associations ?? [],
              sourceMetadata: original.data.sourceMetadata,
              usageRights: original.data.usageRights ?? "unknown",
              allowedUses: original.data.allowedUses ?? [],
              rightsNotes: original.data.rightsNotes ?? "",
              analysisStatus: "needs_review",
            });
          }

          await db.collection("events").updateOne(
            { id: event.id, workspaceId: w },
            {
              $set: {
                "payload.status": "completed",
                "payload.result": henry ?? result,
                "payload.usage": generated.usage,
              },
            },
            { session },
          );
          return henry ?? result;
        });
      } catch (error) {
        const db = await mongo.database();
        await db.collection("events").updateOne(
          { id: event.id, workspaceId: w },
          {
            $set: {
              "payload.status": "failed",
              ...(completedUsage ? { "payload.usage": completedUsage } : {}),
              ...(error && typeof error === "object" && "usage" in error
                ? { "payload.usage": error.usage }
                : {}),
            },
          },
        );
        throw error;
      }
    },
    async exportBrief(identity: AuthenticatedUser, w: string, id: string) {
      const db = await mongo.database();
      await contentAccess(db, config, identity, w, "read");
      const all = await records(db, w),
        brief = all.find(
          (r) => r.id === id && r.kind === "brief" && r.status === "approved",
        );
      if (!brief)
        throw new HiveConflict(
          "Approve the brief before exporting it for production.",
        );
      const context = await contentContext(
        db,
        config,
        identity,
        w,
        brief.data.scope,
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
        ) ||
        context.hash !== brief.contextHash
      )
        throw new HiveConflict(
          "Business context changed. Review and approve a fresh brief before production.",
        );
      return {
        contract: "hvm.execution-brief.v1",
        contentContract: "hvm.content-production.v1",
        actionLibraryItem:
          (
            await db.collection("events").findOne(
              {
                workspaceId: w,
                eventType: "content_strategy_handoff",
                "payload.recordId": brief.data.actionId,
              },
              { sort: { createdAt: -1 } },
            )
          )?.payload.definitionId ?? null,
        productionCandidates: {
          capabilities: (
            await db
              .collection("capabilities")
              .find(
                { archived: { $ne: true } },
                { projection: { id: 1, name: 1, supportedScopeTypes: 1 } },
              )
              .toArray()
          ).map((c) => ({
            id: c.id,
            name: c.name,
            scopeTypes: c.supportedScopeTypes,
          })),
          connectedIntegrations: context.channels,
          operationalResources: all.filter(
            (r) =>
              r.kind === "executor" &&
              r.status !== "removed" &&
              r.data.available &&
              recordBrand(r, all) === recordBrand(brief, all),
          ),
          assignments: all.filter(
            (r) =>
              r.kind === "execution" &&
              r.status !== "removed" &&
              r.data.briefId === brief.id,
          ),
          selectedMode: "manual_external_production",
          requiresCapabilitySuitabilityAndExecutionPermissionReview: true,
        },
        workspaceId: w,
        brief: {
          id: brief.id,
          version: brief.version,
          fingerprint: brief.fingerprint,
          data: brief.data,
        },
        approvedBrandBrief: context.approvedBrandBrief,
        sourceVersions: brief.sourceVersions,
        sourceAssets: all
          .filter(
            (r) =>
              Array.isArray(brief.data.sourceAssetIds) &&
              brief.data.sourceAssetIds.includes(r.id) &&
              r.status !== "removed",
          )
          .map((r) => ({
            id: r.id,
            version: r.version,
            fingerprint: r.fingerprint,
            status: r.status,
            title: r.data.title,
            url: r.data.url,
            text: r.data.text,
          })),
        returnContract: {
          schema: outputSchema(assetData),
          outcomeSchema: outputSchema(effectivenessData),
          outcomeRegistration: {
            kind: "effectiveness",
            operation: "save",
            expectedVersion: 0,
            requestKey: "unique UUID",
            executionId: "assignment identity",
            evidence:
              "workspace Events references; observations are not causal attribution",
          },
          registration: {
            method: "POST",
            path: `/api/v1/hvm/workspaces/${w}/content-strategy`,
            operation: "save",
            kind: "asset",
            expectedVersion: 0,
            requestKey: "unique UUID for this delivery",
            data: "asset matching the schema; sourceMetadata carries the pinned brief identity",
          },
          briefId: brief.id,
          briefVersion: brief.version,
          required: [
            "title",
            "assetType",
            "classification",
            "non-empty text, sourceDocumentId or durable URL",
            "producer",
            "source lineage",
          ],
          status: "draft",
          publicationAuthorised: false,
          communicationAuthorised: false,
          authoritativeCore: false,
        },
        execution: {
          mode: "manual_external_production",
          automaticExecution: false,
        },
      };
    },
    async handoff(identity: AuthenticatedUser, w: string, raw: unknown) {
      const input = z
        .object({
          id: z.string(),
          expectedVersion: z.number(),
          actionTypeId: platformIdSchema("actiontype"),
        })
        .strict()
        .parse(raw);
      if (!mongo.withTransaction) throw new Error("Transactions unavailable");
      return mongo.withTransaction(async (db, session) => {
        const actor = await contentAccess(
            db,
            config,
            identity,
            w,
            "update",
            session,
          ),
          now = await lockIcpWorkspace(db, w, session),
          all = await records(db, w, session),
          recommendation = all.find(
            (r) =>
              r.id === input.id &&
              r.kind === "action" &&
              r.status !== "removed",
          );
        if (!recommendation || recommendation.version !== input.expectedVersion)
          throw new HiveConflict("Recommendation changed.");
        const prior = await db.collection("events").findOne(
          {
            workspaceId: w,
            eventType: "content_strategy_handoff",
            "payload.recordId": input.id,
          },
          { session, sort: { createdAt: -1 } },
        );
        const previousDefinition = prior
          ? await db
              .collection("action_definitions")
              .findOne(
                { id: prior.payload.definitionId, workspaceId: w },
                { session },
              )
          : null;
        if (prior?.payload.version === input.expectedVersion)
          return { id: prior.payload.definitionId };
        if (previousDefinition && previousDefinition.status !== "draft")
          throw new HiveConflict(
            "This Library record is no longer a draft. Its approved version cannot be replaced through handoff.",
          );
        const rawType = await db.collection("action_types").findOne(
          {
            id: input.actionTypeId,
            status: "active",
            availability: "queens",
            archived: false,
          },
          { session },
        );
        if (!rawType)
          throw new HiveConflict("Select an available Library type.");
        const type = ActionTypeSchema.parse(withoutMongoId(rawType));
        const d = recommendation.data;
        const definition = {
          name: d.title,
          description: d.rationale || d.title,
          purpose: d.contribution || d.title,
          actionType: {
            id: type.id,
            key: type.key,
            version: type.version,
            contentHash: type.contentHash,
          },
          resources: (d.sourceAssetIds as string[]).map((id) => ({
            kind: "external_descriptor",
            resourceType: "content_asset",
            label: `${id} version ${all.find((r) => r.id === id)?.version ?? "unknown"}`,
          })),
          prerequisites: d.dependencies,
          eligibilityConstraints: [
            "Subject to current Contact Strategy and NBA eligibility.",
          ],
          approvalRequirements: [
            "Human approval of content and separate execution authority required.",
          ],
          availability: { constraints: [] },
          evidence: [],
        };
        const row = ActionDefinitionSchema.parse({
          id: previousDefinition?.id ?? generatePlatformId("actiondefinition"),
          workspaceId: w,
          definition,
          status: "draft",
          revision: previousDefinition?.revision ?? 1,
          contentHash: actionDefinitionHash({
            definition: definition as z.infer<
              typeof ActionDefinitionSchema
            >["definition"],
          }),
          createdAt: previousDefinition?.createdAt ?? now,
          updatedAt: now,
          createdBy: previousDefinition?.createdBy ?? actor,
          updatedBy: actor,
          archived: false,
          schemaVersion: 1,
        });
        if (previousDefinition) {
          assertActionDefinitionTransition(
            withoutMongoId(previousDefinition),
            row,
          );
          await db
            .collection("action_definitions")
            .updateOne(
              { id: row.id, workspaceId: w },
              { $set: row },
              { session },
            );
        } else
          await db.collection("action_definitions").insertOne(row, { session });
        await db.collection("events").insertOne(
          EventSchema.parse({
            id: generatePlatformId("event"),
            workspaceId: w,
            eventType: "content_strategy_handoff",
            occurredAt: now,
            createdAt: now,
            updatedAt: now,
            createdBy: actor,
            updatedBy: actor,
            source: { system: "content_strategy" },
            payload: {
              recordId: input.id,
              version: input.expectedVersion,
              definitionId: row.id,
            },
          }),
          { session },
        );
        return { id: row.id };
      });
    },
  };
}
