import type { ClientSession, Db } from "mongodb";
import { EventSchema, generatePlatformId } from "../../domain";
import { HiveConflict } from "../hive-definitions";
import { capabilityRequest, capabilityResult, nbaHash } from "./model";

/** Internal result acceptance only. The caller holds the workspace lock and
 * obtains request/current decision from Hive, never from a public payload.
 * Exact request binding prevents a valid result from another tenant, version or
 * operation being mistaken for permission to continue. No downstream action is
 * dispatched by receiving a result. */
export async function acceptCapabilityResult(
  db: Db,
  session: ClientSession,
  rawRequest: unknown,
  rawResult: unknown,
  current: {
    workspaceId: string;
    decisionId: string;
    version: number;
    state: string;
    contextHash: string;
  },
  actor: unknown,
  now = new Date(),
) {
  const request = capabilityRequest.parse(rawRequest),
    result = capabilityResult.parse(rawResult);
  if (
    result.workspaceId !== request.workspaceId ||
    current.workspaceId !== request.workspaceId ||
    result.decisionId !== request.decisionId ||
    current.decisionId !== request.decisionId ||
    result.decisionVersion !== request.decisionVersion ||
    result.correlationId !== request.correlationId ||
    result.idempotencyKey !== request.idempotencyKey
  )
    throw new HiveConflict("The result does not belong to this decision.");
  const receiptHash = nbaHash(result);
  const prior = await db.collection("events").findOne(
    {
      workspaceId: request.workspaceId,
      eventType: "nba_capability_result",
      "payload.idempotencyKey": request.idempotencyKey,
    },
    { session },
  );
  if (prior) {
    if (prior.payload.receiptHash !== receiptHash)
      throw new HiveConflict(
        "Conflicting capability result; reconcile before continuing.",
      );
    return prior;
  }
  const stale =
    current.version !== request.decisionVersion ||
    !["running", "waiting", "scheduled"].includes(current.state) ||
    current.contextHash !== nbaHash(request.contextVersions) ||
    Date.parse(request.deadline) < now.getTime();
  // Keep late results as evidence without reviving cancelled work or reusing
  // an expired approval. Uncertainty requires reconciliation, never blind retry.
  const disposition = stale
    ? "stale"
    : result.status === "uncertain"
      ? "reconcile"
      : ["completed", "partial"].includes(result.status)
        ? "review_required"
        : result.status;
  const event = EventSchema.parse({
    id: generatePlatformId("event"),
    workspaceId: request.workspaceId,
    campaignId: request.campaignId,
    eventType: "nba_capability_result",
    occurredAt: now,
    createdAt: now,
    updatedAt: now,
    createdBy: actor,
    payload: {
      ...result,
      receiptHash,
      disposition,
      capability: request.capability,
    },
  });
  await db.collection("events").insertOne(event, { session });
  return event;
}
