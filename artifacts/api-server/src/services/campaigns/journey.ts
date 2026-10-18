import { EventSchema, generatePlatformId } from "../../domain";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Db, ClientSession, Document } from "mongodb";
import { HiveConflict } from "../hive-definitions";
import {
  readContactContext,
  contactActionRestriction,
} from "../contact-context";
import { readApprovedContactStrategies } from "../contact-strategy/current";
import { campaignReadiness, campaignSetup } from "./model";

export const journeyRecipient = z
  .object({
    personId: z.string().min(1),
    contactPointId: z.string().default(""),
    decision: z.enum(["review", "include", "exclude"]),
    reason: z.string().trim().min(1).max(2000),
    contextRevision: z.string(),
  })
  .strict();
export const journeyMutation = z
  .object({
    requestKey: z.string().uuid(),
    expectedVersion: z.number().int().nonnegative(),
    campaignVersion: z.number().int().positive(),
    action: z.enum(["save", "approve_launch", "stop"]),
    excludedOrganisations: z
      .array(z.string().trim().min(1).max(200))
      .max(200)
      .optional(),
    recipients: z.array(journeyRecipient).max(500).optional(),
    reviewFingerprint: z.string().optional(),
    reason: z.string().trim().min(1).max(2000),
    confirmed: z.boolean().optional(),
  })
  .strict();
export const journeyHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export async function latestJourney(
  db: Db,
  w: string,
  id: string,
  session?: ClientSession,
) {
  const row = await db
    .collection("events")
    .find(
      { workspaceId: w, campaignId: id, eventType: "campaign_journey" },
      { session },
    )
    .sort({ "payload.version": -1 })
    .limit(1)
    .next();
  if (!row?.payload.parts) return row;
  const parts = await db
    .collection("events")
    .find(
      {
        workspaceId: w,
        campaignId: id,
        eventType: "campaign_journey_part",
        "payload.parentId": row.id,
      },
      { session },
    )
    .sort({ "payload.index": 1 })
    .toArray();
  if (
    parts.length !== row.payload.parts ||
    parts.some((p, i) => p.payload.index !== i)
  )
    throw new HiveConflict(
      "Campaign review evidence is incomplete. Contact support; approval is blocked.",
    );
  const serial = parts.map((p) => p.payload.text).join("");
  if (journeyHash(serial) !== row.payload.partsHash)
    throw new HiveConflict(
      "Campaign review evidence could not be verified. Approval is blocked.",
    );
  const detail = z
    .object({
      recipients: z.array(journeyRecipient).max(500),
      excludedOrganisations: z.array(z.string()).max(200),
    })
    .strict()
    .parse(JSON.parse(serial));
  return { ...row, payload: { ...row.payload, ...detail } };
}
/** Keep bounded immutable Events; recipient batches must not weaken the shared 16KB limit. */
export async function appendJourney(
  db: Db,
  row: Document,
  session: ClientSession,
) {
  const payload = { ...row.payload };
  const serial = JSON.stringify({
    recipients: payload.recipients,
    excludedOrganisations: payload.excludedOrganisations,
  });
  if (JSON.stringify(payload).length > 12000) {
    delete payload.recipients;
    delete payload.excludedOrganisations;
    const parts = serial.match(/[\s\S]{1,4000}/g) ?? [];
    payload.parts = parts.length;
    payload.partsHash = journeyHash(serial);
    for (let index = 0; index < parts.length; index++)
      await db.collection("events").insertOne(
        EventSchema.parse({
          ...row,
          id: generatePlatformId("event"),
          eventType: "campaign_journey_part",
          payload: { parentId: row.id, index, text: parts[index] },
        }),
        { session },
      );
  }
  await db
    .collection("events")
    .insertOne(EventSchema.parse({ ...row, payload }), { session });
}

export async function recipientEvidence(
  db: Db,
  w: string,
  personId: string,
  pointId: string,
  exclusions: string[],
  purpose: string,
  session?: ClientSession,
) {
  const ctx = await readContactContext(db, w, personId, session);
  const person = await db
    .collection("people")
    .findOne(
      { workspaceId: w, id: personId, archived: { $ne: true } },
      { session },
    );
  const current = ctx.relationships.filter((r) => r.current);
  const blocked = contactActionRestriction(
    ctx,
    purpose === "acquisition" ? "acquisition" : "marketing",
    pointId,
  ).reasons;
  const keys = exclusions.map((x) => x.trim().toLowerCase());
  if (
    current.some((r) => keys.includes(r.organisationName.trim().toLowerCase()))
  )
    blocked.push("Organisation excluded from this campaign");
  if (
    !pointId ||
    !ctx.points.some((p) => p.id === pointId && p.type === "email")
  )
    blocked.push("Choose a current email address");
  return {
    personId,
    name:
      person?.name ||
      [person?.firstName, person?.lastName].filter(Boolean).join(" ") ||
      "Contact",
    organisations: current.map((r) => r.organisationName),
    contextRevision: journeyHash({
      person: {
        name: person?.name,
        firstName: person?.firstName,
        lastName: person?.lastName,
        title: person?.title,
      },
      points: ctx.points,
      relationships: ctx.relationships,
      controls: ctx.controls,
      lifecycle: ctx.lifecycle,
      sourceFields: ctx.sourceFields,
      sourceCurrentCustomer: ctx.sourceCurrentCustomer,
      sourceRestrictions: ctx.sourceRestrictions,
      inheritedRestrictions: ctx.inheritedRestrictions,
      productRelationships: ctx.productRelationships,
      responseEvidence: ctx.responseEvidence,
      restrictionsTruncated: ctx.restrictionsTruncated,
    }),
    points: ctx.points
      .filter((p) => p.type === "email")
      .map((p) => ({ id: p.id, value: p.value })),
    blockers: blocked,
    lifecycle: ctx.lifecycle,
  };
}
export async function readCampaignJourney(
  db: Db,
  w: string,
  id: string,
  session?: ClientSession,
) {
  const campaign = await db
    .collection("events")
    .find(
      { workspaceId: w, campaignId: id, eventType: "campaign_setup" },
      { session },
    )
    .sort({ "payload.version": -1 })
    .limit(1)
    .next();
  if (!campaign) throw new HiveConflict("Campaign unavailable.");
  const setup = campaignSetup.parse(campaign.payload.setup);
  const saved = await latestJourney(db, w, id, session);
  const p = saved?.payload;
  const recipients = [];
  for (const r of (p?.recipients ?? []) as z.infer<typeof journeyRecipient>[]) {
    try {
      const evidence = await recipientEvidence(
        db,
        w,
        r.personId,
        r.contactPointId,
        p?.excludedOrganisations ?? [],
        setup.purpose,
        session,
      );
      recipients.push({
        ...r,
        ...evidence,
        stale:
          r.contextRevision !== evidence.contextRevision ||
          p?.campaignVersion !== campaign.payload.version,
      });
    } catch {
      recipients.push({
        ...r,
        name: "Unavailable contact",
        organisations: [],
        points: [],
        lifecycle: "unknown",
        blockers: ["Contact is unavailable; remove or exclude it"],
        stale: true,
      });
    }
  }
  const policies = await readApprovedContactStrategies(db, w, session);
  const connection = await db.collection("workspace_integrations").findOne(
    {
      workspaceId: w,
      provider: "google_workspace",
      status: "connected",
      archived: { $ne: true },
    },
    { session },
  );
  const ga4 = await db.collection("workspace_integrations").findOne(
    {
      workspaceId: w,
      provider: "ga4",
      status: "connected",
      archived: { $ne: true },
    },
    { session },
  );
  const emails = await db
    .collection("events")
    .find(
      {
        workspaceId: w,
        eventType: "email_content_record",
        "payload.record.campaignId": id,
      },
      { session },
    )
    .sort({ "payload.record.version": -1 })
    .toArray();
  const seen = new Set<string>();
  const drafts = emails
    .filter((r) => {
      const id = r.payload.record.id;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .map((r) => r.payload.record);
  const included = recipients.filter((r) => r.decision === "include");
  const blockers = [...campaignReadiness(setup)];
  for (const ref of setup.offers) {
    const offer = await db
      .collection("offers")
      .findOne({ workspaceId: w, id: ref.id }, { session });
    if (
      !offer ||
      offer.archived ||
      offer.status !== "approved" ||
      offer.revision !== ref.revision ||
      offer.approvedRevision !== ref.revision
    )
      blockers.push(
        "Review the current approved offer and update campaign setup.",
      );
  }
  if (campaign.payload.status !== "ready")
    blockers.push("Review and approve campaign setup.");
  if (!included.length)
    blockers.push("Review and include at least one recipient.");
  if (included.some((r) => r.stale || r.blockers.length))
    blockers.push("Resolve recipient restrictions or stale reviews.");
  if (!connection) blockers.push("Connect the sender mailbox in Integrations.");
  if (policies.missingApproval.length || !policies.approved.length)
    blockers.push("Review and approve Contact Strategy.");
  if (
    included.some(
      (r) =>
        !drafts.some(
          (d) =>
            d.contactId === r.personId &&
            d.campaignVersion === campaign.payload.version &&
            d.status === "approved",
        ),
    )
  )
    blockers.push(
      "Prepare and approve a current campaign email for each included recipient.",
    );
  const fingerprint = journeyHash({
    campaignVersion: campaign.payload.version,
    status: campaign.payload.status,
    recipients,
    exclusions: p?.excludedOrganisations ?? [],
    policies: policies.approved,
    drafts,
    sender: connection
      ? [connection.id, connection.connectedAt, connection.externalAccountId]
      : null,
  });
  const launchCurrent =
    p?.status === "approved" &&
    p?.reviewFingerprint === fingerprint &&
    !blockers.length;
  return {
    version: p?.version ?? 0,
    campaignVersion: campaign.payload.version,
    status: launchCurrent
      ? "approved"
      : p?.status === "approved"
        ? "review_required"
        : (p?.status ?? "draft"),
    excludedOrganisations: p?.excludedOrganisations ?? [],
    recipients,
    blockers,
    reviewFingerprint: fingerprint,
    sender: connection?.externalAccountId ?? null,
    tracking: {
      automatic: true,
      property: p?.ga4Property ?? null,
      connectedProperty: ga4?.externalAccountId ?? null,
      ready: !!p?.ga4Property && p.ga4Property === ga4?.externalAccountId,
    },
    emails: drafts
      .filter((d) => d.status !== "removed")
      .map((d) => ({
        id: d.id,
        contactId: d.contactId,
        subject: d.content.subject,
        status: d.status,
        version: d.version,
      })),
    notice:
      "Launch approval covers this reviewed audience and campaign version. Each exact email still requires delivery approval in Communications. Saving preparation never queues email.",
  };
}
/** Called at delivery approval AND dispatch; edits, pauses and exclusions invalidate authority. */
export async function assertCampaignLaunch(
  db: Db,
  w: string,
  campaignId: string,
  personId: string,
  pointId: string,
  session?: ClientSession,
) {
  const journey = await readCampaignJourney(db, w, campaignId, session);
  if (journey.status !== "approved")
    throw new HiveConflict(
      "Review and approve campaign launch before authorising delivery.",
    );
  if (
    !journey.recipients.some(
      (r) =>
        r.personId === personId &&
        r.contactPointId === pointId &&
        r.decision === "include" &&
        !r.stale &&
        !r.blockers.length,
    )
  )
    throw new HiveConflict(
      "This recipient is not in the current approved campaign audience.",
    );
}
