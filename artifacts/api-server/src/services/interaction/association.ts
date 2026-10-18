import type { Db, ClientSession, Document } from "mongodb";
import type { AppConfig } from "../../config";
import type { AuthenticatedUser } from "../../middlewares/auth";
import { resolveHvmContext } from "../hvm-context";
import {
  PersonSchema,
  ContactPointSchema,
  generatePlatformId,
  normalizeContactValue,
} from "../../domain";
import { HiveConflict } from "../hive-definitions";
import { outcome } from "../measurement/model";
import { queueFeedback } from "../measurement/store";
import { trackingRow } from "../website-tracking/service";
/** Human-reviewed association only; public callers never receive match results. */
export async function associateEnquiry(
  db: Db,
  s: ClientSession,
  config: AppConfig,
  user: AuthenticatedUser,
  w: string,
  row: Document,
) {
  if (row.eventType !== "interaction_enquiry")
    throw new HiveConflict("Select an enquiry to review its contact details.");
  if (row.payload.contactId) return;
  const auth = await resolveHvmContext(db, config, user, s);
  for (const type of ["people"] as const)
    for (const action of ["read", "create"] as const)
      auth.authority.scopeFilter(auth.context, action, {
        type,
        workspaceId: w,
      });
  const visitor = row.payload.visitor,
    email = normalizeContactValue("email", visitor.email);
  const matches = await db
    .collection("contact_points")
    .find(
      { workspaceId: w, type: "email", normalizedValue: email },
      { session: s },
    )
    .limit(2)
    .toArray();
  if (matches.length > 1)
    throw new HiveConflict(
      "Multiple contacts have this email. Resolve the duplicate in Contact management first.",
    );
  let person: Document | null = null;
  if (matches[0]) {
    const c = matches[0];
    person = await db
      .collection("people")
      .findOne(
        { workspaceId: w, id: c.personId, archived: { $ne: true } },
        { session: s },
      );
    if (!person || c.archived || c.leftOrganisation)
      throw new HiveConflict(
        "This address or contact needs review in Contact management. No existing restrictions were changed.",
      );
  } else {
    const now = new Date(),
      base = {
        workspaceId: w,
        createdAt: now,
        updatedAt: now,
        source: { system: "reviewed_website_enquiry", reference: row.id },
      };
    person = PersonSchema.parse({
      ...base,
      id: generatePlatformId("person"),
      firstName: visitor.name.trim().split(/\s+/)[0],
      lastName:
        visitor.name.trim().split(/\s+/).slice(1).join(" ") || undefined,
      displayName: visitor.name,
    });
    const contact = ContactPointSchema.parse({
      ...base,
      id: generatePlatformId("contact"),
      personId: person.id,
      type: "email",
      value: visitor.email,
      normalizedValue: email,
      primary: true,
      firstSeenAt: now,
    });
    await db.collection("people").insertOne(person, { session: s });
    await db.collection("contact_points").insertOne(contact, { session: s });
  }
  await db.collection("events").updateOne(
    { workspaceId: w, id: row.id },
    {
      $set: {
        personIds: [person.id],
        "payload.contactId": person.id,
        "payload.identityConfidence": "human_reviewed_association",
        "payload.associatedBy": auth.context.actor,
      },
    },
    { session: s },
  );
  // Attribution is evidence of an intended recipient, never proof of visitor identity.
  // It is used only when the human-reviewed contact matches the original email.
  const tracking = row.payload.trackingSessionId
    ? await db.collection("events").findOne(
        {
          workspaceId: w,
          id: row.payload.trackingSessionId,
          eventType: "website_tracking_session",
          archived: { $ne: true },
        },
        { session: s },
      )
    : null;
  const comm =
    tracking &&
    !tracking.payload.revoked &&
    new Date(tracking.payload.expiresAt).getTime() > Date.now() &&
    tracking.payload.communicationId
      ? await db.collection("events").findOne(
          {
            workspaceId: w,
            id: tracking.payload.communicationId,
            eventType: "communication",
            "payload.status": "accepted",
          },
          { session: s },
        )
      : null;
  const attribution =
    comm?.payload.draft?.contactId === person.id &&
    comm?.payload.draft?.brandId === row.payload.brandId
      ? comm
      : null;
  const value = outcome.parse({
    schemaVersion: 1,
    eventKey: `interaction:${row.id}:associated`,
    kind: "interaction_enquiry",
    communicationId: attribution?.id || "",
    campaignId: attribution?.payload.draft.campaignId || undefined,
    offerId: attribution?.payload.draft.offerId || undefined,
    contactId: person.id,
    brandId: row.payload.brandId,
    draftId: "",
    draftVersion: 0,
    sourceId: row.id,
    sourceVersion: row.payload.version,
    occurredAt: new Date().toISOString(),
    provider: "website",
    conversationId: row.payload.sessionId,
    fact: "observed",
    testOnly:
      !!row.payload.testOnly ||
      !!tracking?.payload.testOnly ||
      !!comm?.payload.testOnly,
    associated: true,
    reviewed: true,
    category: "enquiry_received",
  });
  const evidence = trackingRow(w, "measurement_outcome", value);
  await db.collection("events").insertOne(evidence, { session: s });
  if (!value.testOnly) await queueFeedback(db, s, w, value, evidence.id);
}
