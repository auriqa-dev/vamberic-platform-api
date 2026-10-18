import type { ClientSession, Db } from "mongodb";
import {
  EventSchema,
  generatePlatformId,
  platformIdSchema,
} from "../../domain";
import { HiveConflict } from "../hive-definitions";
import { nbaHash, type NbaSubject } from "./model";

/** These operations require the caller's authorised workspace transaction and
 * workspace lock. Keeping state in reserved events reuses existing recovery and
 * audit storage; no TTL can silently surrender an active engagement. */
export async function latestCoordination(
  db: Db,
  session: ClientSession | undefined,
  workspaceId: string,
  kind: "nba_claim" | "nba_frontier",
  key: string,
) {
  return db
    .collection("events")
    .find({ workspaceId, eventType: kind, "payload.key": key }, { session })
    .sort({ "payload.version": -1 })
    .limit(1)
    .next();
}
async function append(
  db: Db,
  session: ClientSession,
  workspaceId: string,
  campaignId: string,
  actor: unknown,
  eventType: "nba_claim" | "nba_frontier",
  payload: Record<string, unknown>,
  now: Date,
) {
  const event = EventSchema.parse({
    id: generatePlatformId("event"),
    workspaceId,
    campaignId,
    eventType,
    occurredAt: now,
    createdAt: now,
    updatedAt: now,
    createdBy: actor,
    payload,
  });
  await db.collection("events").insertOne(event, { session });
  return event;
}
export function claimKeys(
  subject: NbaSubject,
  organisationId?: string,
): string[] {
  if (subject.type === "campaign") return [];
  if (subject.type === "organisation") {
    platformIdSchema("org").parse(subject.id);
    return [`organisation:${subject.id}`];
  }
  platformIdSchema("person").parse(subject.id);
  if (!organisationId)
    throw new HiveConflict("Confirm the contact’s current organisation first.");
  platformIdSchema("org").parse(organisationId);
  return [`organisation:${organisationId}`, `person:${subject.id}`];
}
export async function claimEngagement(
  db: Db,
  session: ClientSession,
  workspaceId: string,
  campaignId: string,
  decisionId: string,
  keys: string[],
  actor: unknown,
  now = new Date(),
) {
  // Read every key before writing: an organisation conflict cannot leave a
  // person partially claimed, even in callers that inspect the conflict.
  const current = await Promise.all(
    keys.map((key) =>
      latestCoordination(db, session, workspaceId, "nba_claim", key),
    ),
  );
  for (const row of current) {
    if (row?.payload.state === "held" && row.payload.decisionId !== decisionId)
      throw new HiveConflict(
        "This organisation or contact is already under management. Resolve the existing engagement before proceeding.",
      );
  }
  for (let i = 0; i < keys.length; i++) {
    const row = current[i];
    if (row?.payload.state === "held") continue;
    await append(
      db,
      session,
      workspaceId,
      campaignId,
      actor,
      "nba_claim",
      {
        key: keys[i],
        version: (row?.payload.version ?? 0) + 1,
        state: "held",
        decisionId,
      },
      now,
    );
  }
}
export async function releaseEngagement(
  db: Db,
  session: ClientSession,
  workspaceId: string,
  campaignId: string,
  decisionId: string,
  keys: string[],
  actor: unknown,
  reason: string,
  now = new Date(),
) {
  for (const key of keys) {
    const row = await latestCoordination(
      db,
      session,
      workspaceId,
      "nba_claim",
      key,
    );
    // A delayed completion must never release a successor's claim.
    if (row?.payload.state !== "held" || row.payload.decisionId !== decisionId)
      continue;
    await append(
      db,
      session,
      workspaceId,
      campaignId,
      actor,
      "nba_claim",
      {
        key,
        version: row.payload.version + 1,
        state: "released",
        decisionId,
        reason,
      },
      now,
    );
  }
}
export async function engagementConflicts(
  db: Db,
  session: ClientSession | undefined,
  workspaceId: string,
  keys: string[],
  ownDecisionId?: string,
) {
  const rows = await Promise.all(
    keys.map((key) =>
      latestCoordination(db, session, workspaceId, "nba_claim", key),
    ),
  );
  return [
    ...new Set(
      rows
        .filter(
          (row) =>
            row?.payload.state === "held" &&
            row.payload.decisionId !== ownDecisionId,
        )
        .map((row) => String(row!.payload.decisionId)),
    ),
  ];
}

/** A domain is a discovery key, not proof that two legal entities are identical.
 * Do not strip subdomains or merge by fuzzy names. Canonical Hive IDs take
 * precedence; identity resolution remains the existing import/research path. */
export function frontierKey(identity: {
  organisationId?: string;
  website?: string;
}) {
  if (identity.organisationId)
    return `organisation:${platformIdSchema("org").parse(identity.organisationId)}`;
  const url = new URL(identity.website ?? "");
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new HiveConflict("Provide a public organisation website.");
  return `domain:${url.hostname.toLowerCase().replace(/\.$/, "")}`;
}
export async function recordFrontier(
  db: Db,
  session: ClientSession,
  workspaceId: string,
  campaignId: string,
  actor: unknown,
  input: {
    organisationId?: string;
    website?: string;
    evidenceIds: string[];
    state:
      | "discovered"
      | "researching"
      | "needs_review"
      | "eligible"
      | "excluded"
      | "managed";
    reason: string;
    nextReviewAt: string | null;
    requestKey: string;
  },
  now = new Date(),
) {
  const key = frontierKey(input);
  if (
    input.nextReviewAt &&
    (!Number.isFinite(Date.parse(input.nextReviewAt)) ||
      Date.parse(input.nextReviewAt) <= now.getTime())
  )
    throw new HiveConflict("The next research review must be in the future.");
  const hash = nbaHash(input);
  const duplicate = await db
    .collection("events")
    .findOne(
      {
        workspaceId,
        eventType: "nba_frontier",
        "payload.requestKey": input.requestKey,
      },
      { session },
    );
  if (duplicate) {
    if (
      duplicate.payload.inputHash !== hash ||
      duplicate.campaignId !== campaignId
    )
      throw new HiveConflict(
        "Research result key already used for different data.",
      );
    return duplicate;
  }
  const old = await latestCoordination(
    db,
    session,
    workspaceId,
    "nba_frontier",
    key,
  );
  return append(
    db,
    session,
    workspaceId,
    campaignId,
    actor,
    "nba_frontier",
    {
      ...input,
      key,
      inputHash: hash,
      version: (old?.payload.version ?? 0) + 1,
      firstSeenAt: old?.payload.firstSeenAt ?? now.toISOString(),
      lastSeenAt: now.toISOString(),
      evidenceIds: [...new Set(input.evidenceIds)],
    },
    now,
  );
}
export function shouldRevisit(
  row: { payload: { state: string; nextReviewAt?: string | null } } | null,
  now: Date,
) {
  if (!row) return true;
  if (["managed", "researching"].includes(row.payload.state)) return false;
  return (
    !!row.payload.nextReviewAt &&
    Date.parse(row.payload.nextReviewAt) <= now.getTime()
  );
}
