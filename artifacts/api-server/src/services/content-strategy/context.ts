import { reviewedResearchContext } from "../research/evidence-context";
import type { Db, ClientSession, Document } from "mongodb";
import type { AppConfig } from "../../config";
import type { AuthenticatedUser } from "../../middlewares/auth";
import { digest } from "@workspace/agent-runtime-protocol";
import { HiveConflict } from "../hive-definitions";
import { readGenerationBrandBrief } from "../generation-guidance";
import { scope } from "./model";
export async function contentContext(
  db: Db,
  config: AppConfig,
  identity: AuthenticatedUser,
  w: string,
  raw: unknown,
  session?: ClientSession,
  format: import("../../domain/brand-expression").CommunicationFormat = "interaction",
) {
  const selected = scope.parse(raw);
  const brand = await db.collection("brands").findOne(
    {
      id: selected.brandId,
      workspaceId: w,
      archived: { $ne: true },
      status: { $ne: "retired" },
    },
    { session },
  );
  if (!brand)
    throw new HiveConflict("Select a current brand in this workspace.");
  const snapshots = [];
  for (const [entityType, refs] of [
    ["offerings", selected.products],
    ["offers", selected.offers],
    ["ideal_customer_profiles", selected.audiences],
  ] as const) {
    for (const ref of refs) {
      const current = await db.collection(entityType).findOne(
        {
          id: ref.id,
          workspaceId: w,
          archived: { $ne: true },
          status: { $ne: "retired" },
        },
        { session },
      );
      if (
        !current ||
        current.approvedRevision !== ref.revision ||
        (current.brandId && current.brandId !== selected.brandId)
      )
        throw new HiveConflict(
          "A selected product, offer or audience has changed. Select its current approved version.",
        );
      if (current.offeringId) {
        const parent = await db.collection("offerings").findOne(
          {
            id: current.offeringId,
            workspaceId: w,
            archived: { $ne: true },
            status: { $ne: "retired" },
          },
          { session },
        );
        if (!parent || parent.brandId !== selected.brandId)
          throw new HiveConflict(
            "Selected context belongs to a different brand.",
          );
      }
      const snapshot = await db
        .collection(
          entityType === "offers"
            ? "offer_revisions"
            : "hive_definition_revisions",
        )
        .findOne(
          {
            workspaceId: w,
            [entityType === "offers" ? "offerId" : "entityId"]: ref.id,
            revision: ref.revision,
            ...(entityType === "offers" ? {} : { entityType }),
          },
          { session },
        );
      if (!snapshot?.snapshot)
        throw new HiveConflict("Approved context is unavailable.");
      snapshots.push({
        entityType,
        id: ref.id,
        revision: ref.revision,
        snapshot: snapshot.snapshot,
        ...(entityType === "offers"
          ? {
              decisionContext:
                snapshot.designSnapshot?.work?.stages?.map(
                  (stage: Document) => ({
                    stageKey: stage.stageKey,
                    assumptions: stage.assumptions,
                    unknowns: stage.unknowns,
                    evidence: stage.evidence,
                    userInputs: stage.userInputs,
                    decisionRationale: stage.decisionRationale,
                    proposedAnswers: stage.groups?.filter((g: Document) =>
                      g.key.startsWith("henry_proposal_"),
                    ),
                  }),
                ) ?? [],
            }
          : {}),
      });
    }
  }
  const buyers = [];
  for (const audience of selected.audiences) {
    const rows = await db
      .collection("buyer_profiles")
      .find(
        {
          workspaceId: w,
          idealCustomerProfileId: audience.id,
          archived: { $ne: true },
          approvedRevision: { $gt: 0 },
          status: { $ne: "retired" },
        },
        { session },
      )
      .toArray();
    for (const row of rows) {
      const snap = await db.collection("hive_definition_revisions").findOne(
        {
          workspaceId: w,
          entityType: "buyer_profiles",
          entityId: row.id,
          revision: row.approvedRevision,
        },
        { session },
      );
      if (snap?.snapshot)
        buyers.push({
          id: row.id,
          revision: row.approvedRevision,
          snapshot: snap.snapshot,
        });
    }
  }
  const channels = await db
    .collection("workspace_integrations")
    .find(
      { workspaceId: w, archived: { $ne: true }, status: "connected" },
      {
        session,
        projection: { id: 1, provider: 1, displayName: 1, status: 1 },
      },
    )
    .toArray();
  const approvedBrandBrief = await readGenerationBrandBrief(
    db,
    config,
    identity,
    w,
    selected.brandId,
    format,
  );
  const research = await reviewedResearchContext(
    db,
    w,
    selected.brandId,
    [...selected.products, ...selected.offers, ...selected.audiences].map(
      (r) => r.id,
    ),
  );
  const context = {
    research,
    scope: selected,
    snapshots,
    buyers,
    channels: channels.map((c) => ({
      id: c.id,
      provider: c.provider,
      name: c.displayName,
      status: c.status,
    })),
    approvedBrandBrief,
  };
  return { ...context, hash: digest(JSON.parse(JSON.stringify(context))) };
}
