import { readMeasurement } from "./measurement/read";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Db, ClientSession } from "mongodb";
import type { AppConfig } from "../config";
import type { AuthenticatedUser } from "../middlewares/auth";
import type { MongoService } from "./mongo";
import { resolveHvmContext } from "./hvm-context";
import { AuthorizationDenied } from "../authorization/policy";
import { EventSchema, generatePlatformId, platformIdSchema } from "../domain";
import { lockIcpWorkspace } from "./icp/access";
import { HiveConflict } from "./hive-definitions";
import { lifecycleStages } from "./hubspot-import";
export async function contactContextAccess(
  db: Db,
  config: AppConfig,
  identity: AuthenticatedUser,
  w: string,
  action: "read" | "create" | "update",
  session?: ClientSession,
) {
  platformIdSchema("workspace").parse(w);
  const r = await resolveHvmContext(db, config, identity, session);
  if (r.context.application !== "hvmapp" || r.context.actor.type !== "human")
    throw new AuthorizationDenied();
  for (const type of [
    "people",
    "organisations",
    "contact_points",
    "events",
  ] as const)
    // Like contact management, authorise the parent records; only this reviewed
    // operation may append evidence or alter associated addresses. Generic event writes stay denied.
    r.authority.scopeFilter(
      r.context,
      type === "events" || type === "contact_points" ? "read" : action,
      { type, workspaceId: w },
    );
  return { type: "human" as const, id: r.context.actor.id };
}
export async function readContactContext(
  db: Db,
  w: string,
  id: string,
  session?: ClientSession,
  includeMeasurement = false,
) {
  const subject = await db
    .collection(id.startsWith("person_") ? "people" : "organisations")
    .findOne({ workspaceId: w, id, archived: { $ne: true } }, { session });
  if (!subject) throw new AuthorizationDenied();
  const source = await db
    .collection("events")
    .find(
      {
        workspaceId: w,
        eventType: {
          $in: ["hubspot_import_record", "hive_import_contact_context"],
        },
        $or: [{ "payload.personId": id }, { "payload.companyId": id }],
      },
      { session },
    )
    .sort({ createdAt: -1, id: -1 })
    .limit(1)
    .next();
  const responseEvidenceRows = await db
    .collection("events")
    .find(
      {
        workspaceId: w,
        archived: { $ne: true },
        $or: [{ personId: id }, { personIds: id }],
        "payload.hubspotEmail.direction": "Incoming",
      },
      { session },
    )
    .sort({ occurredAt: -1, id: -1 })
    .limit(1001)
    .toArray();
  const controls = await db
    .collection("events")
    .find(
      {
        workspaceId: w,
        eventType: "contact_context_changed",
        "payload.subjectId": id,
      },
      { session },
    )
    .sort({ createdAt: -1, id: -1 })
    .limit(1)
    .next();
  const responseReviews = await db
    .collection("events")
    .find(
      {
        workspaceId: w,
        eventType: "contact_context_changed",
        "payload.subjectId": id,
        "payload.responseReview": { $exists: true },
      },
      { session },
    )
    .sort({ createdAt: -1, id: -1 })
    .limit(1001)
    .toArray();
  const reviewedResponses = new Map<
    string,
    { category: string; status: string; reason: string }
  >();
  for (const e of responseReviews)
    if (!reviewedResponses.has(e.payload.responseReview.eventId))
      reviewedResponses.set(e.payload.responseReview.eventId, {
        category: e.payload.responseReview.category,
        status: "reviewed",
        reason: e.payload.controls.reason,
      });
  const points = await db
    .collection("contact_points")
    .find(
      { workspaceId: w, personId: id, archived: { $ne: true } },
      { session },
    )
    .limit(1001)
    .toArray();
  const relationships = await db
    .collection("organisation_relationships")
    .find(
      { workspaceId: w, personId: id, archived: { $ne: true } },
      { session },
    )
    .limit(1001)
    .toArray();
  const interactions = await db
    .collection("events")
    .find(
      {
        workspaceId: w,
        archived: { $ne: true },
        $or: [{ personId: id }, { personIds: id }, { organisationId: id }],
        eventType: {
          $in: ["email", "call", "meeting", "note", "hubspot_email_history"],
        },
      },
      { session },
    )
    .sort({ occurredAt: -1, id: -1 })
    .limit(50)
    .toArray();
  // All source restrictions remain in force until explicitly reviewed, even after a later export clears a flag.
  const restrictions = await db
    .collection("events")
    .find(
      {
        workspaceId: w,
        eventType: "hubspot_import_record",
        $or: [{ "payload.personId": id }, { "payload.companyId": id }],
      },
      { session },
    )
    .sort({ createdAt: -1, id: -1 })
    .limit(1001)
    .toArray();
  const sourceRestrictions = [
    ...new Set(
      restrictions.flatMap((e) => e.payload.values.restrictions ?? []),
    ),
  ];
  const organisations = await db
    .collection("organisations")
    .find(
      {
        workspaceId: w,
        id: { $in: relationships.map((r) => r.organisationId) },
      },
      { session },
    )
    .toArray();
  const currentOrganisationIds = relationships
    .filter((r) => r.current)
    .map((r) => r.organisationId);
  const organisationControls = await db
    .collection("events")
    .find(
      {
        workspaceId: w,
        eventType: "contact_context_changed",
        "payload.subjectId": { $in: currentOrganisationIds },
      },
      { session },
    )
    .sort({ createdAt: -1, id: -1 })
    .limit(1001)
    .toArray();
  const latestOrgControls = new Map<string, Record<string, unknown>>();
  for (const e of organisationControls)
    if (!latestOrgControls.has(e.payload.subjectId))
      latestOrgControls.set(e.payload.subjectId, e.payload.controls);
  const inheritedRestrictions = [...latestOrgControls.values()].flatMap((c) => [
    ...(c.doNotContact ? ["Organisation do not contact"] : []),
    ...(c.marketingSuppressed ? ["Organisation marketing suppressed"] : []),
    ...(c.oneToOneSuppressed ? ["Organisation one-to-one suppressed"] : []),
    ...(c.commercialExclusion ? ["Organisation commercial exclusion"] : []),
  ]);
  const productRelationships = await db
    .collection("product_relationships")
    .find(
      {
        workspaceId: w,
        archived: { $ne: true },
        $or: [
          { personId: id },
          { organisationId: id },
          { organisationId: { $in: currentOrganisationIds } },
        ],
      },
      { session },
    )
    .limit(1001)
    .toArray();
  const sourceChunks = source
    ? await db
        .collection("events")
        .find(
          {
            workspaceId: w,
            eventType: "hubspot_source_field",
            "payload.sourceReference": source.payload.sourceReference,
            "payload.importId": source.payload.importId,
          },
          { session },
        )
        .sort({ "payload.part": 1 })
        .limit(101)
        .toArray()
    : [];
  const sourceFields: Record<string, string> = {};
  for (const chunk of sourceChunks)
    for (const field of chunk.payload.fields ?? [])
      sourceFields[field.key] = (sourceFields[field.key] ?? "") + field.value;
  const v = source?.payload.values ?? {};
  const c = controls?.payload.controls ?? {};
  const revision = createHash("sha256")
    .update(
      JSON.stringify([
        subject.updatedAt,
        source?.id,
        controls?.id,
        organisationControls.map((e) => e.id),
        productRelationships.map((r) => [r.id, r.updatedAt]),
        points.map((p) => [p.id, p.updatedAt]),
        relationships.map((r) => [r.id, r.updatedAt]),
        interactions.map((e) => [e.id, e.updatedAt]),
      ]),
    )
    .digest("hex");
  return {
    measurement: includeMeasurement
      ? await readMeasurement(
          db,
          w,
          id.startsWith("person_") ? { contactId: id } : { organisationId: id },
          session,
        )
      : undefined,
    revision,
    sourceId: v.sourceId ?? null,
    sourceLifecycle: v.originalLifecycle ?? "",
    sourceCurrentCustomer: v.currentCustomer === true,
    lifecycle: c.lifecycle ?? v.lifecycle ?? "unknown",
    leadStatus: v.leadStatus ?? "",
    subscriptionStatus: v.subscriptionStatus ?? "",
    marketingContactStatus: v.marketingContactStatus ?? "",
    responseEvidence: responseEvidenceRows.map((e) => ({
      id: e.id,
      assessment:
        reviewedResponses.get(e.id) ?? e.payload.hubspotEmail.assessment,
      participants: e.payload.hubspotEmail.addresses ?? [],
    })),
    sourceFields,
    sourceRestrictions,
    inheritedRestrictions,
    restrictionsTruncated:
      responseEvidenceRows.length > 1000 ||
      responseReviews.length > 1000 ||
      organisationControls.length > 1000 ||
      restrictions.length > 1000 ||
      points.length > 1000 ||
      relationships.length > 1000 ||
      productRelationships.length > 1000,
    productRelationships: productRelationships.map((r) => ({
      productId: r.productId,
      status: r.status,
      customerSince: r.customerSince ?? null,
    })),
    controls: {
      lifecycle: c.lifecycle ?? v.lifecycle ?? "unknown",
      doNotContact: c.doNotContact ?? false,
      marketingSuppressed: c.marketingSuppressed ?? false,
      oneToOneSuppressed: c.oneToOneSuppressed ?? false,
      commercialExclusion: c.commercialExclusion ?? false,
      reason: c.reason ?? "",
    },
    points: points.map((p) => ({
      id: p.id,
      value: p.value,
      type: p.type,
      suppressed: p.suppressed,
      leftOrganisation: p.leftOrganisation,
      deliverability: p.deliverability,
      organisationRelationshipId: p.organisationRelationshipId ?? null,
    })),
    relationships: relationships.map((r) => ({
      id: r.id,
      organisationId: r.organisationId,
      organisationName:
        organisations.find((o) => o.id === r.organisationId)?.name ??
        "Organisation",
      current: r.current,
      endDate: r.endDate ?? null,
    })),
    interactions: interactions.map((e) => ({
      id: e.id,
      date: e.occurredAt,
      subject:
        e.interaction?.subject ??
        e.payload?.hubspotEmail?.subject ??
        e.eventType,
      body: e.interaction?.body ?? e.payload?.hubspotEmail?.body ?? "",
      direction:
        e.interaction?.details?.direction ??
        e.payload?.hubspotEmail?.direction ??
        "",
      assessment:
        reviewedResponses.get(e.id) ??
        e.payload?.hubspotEmail?.assessment ??
        null,
      participants: e.payload?.hubspotEmail?.addresses ?? [],
    })),
    contextOnly: true,
    executionAuthorised: false,
  };
}
/** Called by future NBA/execution adapters for the exact proposed action. Never grants permission. */
export function contactActionRestriction(
  context: Awaited<ReturnType<typeof readContactContext>>,
  purpose: "acquisition" | "marketing" | "service",
  pointId?: string,
  productId?: string,
) {
  const reasons: string[] = [];
  const c = context.controls;
  const p = context.points.find((p) => p.id === pointId);
  if (context.inheritedRestrictions.includes("Organisation do not contact"))
    reasons.push("Organisation do not contact restriction");
  if (
    purpose !== "service" &&
    context.inheritedRestrictions.some(
      (s) => s.includes("marketing") || s.includes("one-to-one"),
    )
  )
    reasons.push("Organisation outreach restriction");
  if (
    purpose === "acquisition" &&
    context.inheritedRestrictions.includes("Organisation commercial exclusion")
  )
    reasons.push("Organisation commercial exclusion");
  if (
    context.responseEvidence.some(
      (e) =>
        e.assessment?.status === "needs_review" &&
        ["objection", "departure", "delivery_failure", "needs_review"].includes(
          e.assessment.category,
        ),
    )
  )
    reasons.push("An incoming response needs review before further contact");
  if (
    context.responseEvidence.some((e) => e.assessment?.category === "objection")
  )
    reasons.push("An objection is recorded in response history");
  if (
    context.responseEvidence.some(
      (e) =>
        ["departure", "delivery_failure"].includes(
          e.assessment?.category ?? "",
        ) &&
        (!p || e.participants.includes(p.value.toLowerCase())),
    )
  )
    reasons.push("Response history indicates an unavailable address");
  if (c.doNotContact) reasons.push("Do not contact restriction");
  if (pointId && !p) reasons.push("Contact address unavailable");
  if (p?.suppressed || p?.leftOrganisation)
    reasons.push("Contact address is suppressed or no longer current");
  if (context.restrictionsTruncated)
    reasons.push("Restriction history requires review");
  if (
    purpose !== "service" &&
    (c.marketingSuppressed ||
      context.sourceRestrictions.some(
        (s) =>
          s === "Unsubscribed from all email" ||
          s === "Opted out of email: Marketing Information",
      ))
  )
    reasons.push("Marketing is suppressed");
  if (
    c.oneToOneSuppressed ||
    context.sourceRestrictions.includes("Opted out of email: One to One")
  )
    reasons.push("One-to-one outreach is suppressed");
  if (purpose === "acquisition") {
    const relationship = context.productRelationships.find(
      (r) => r.productId === productId,
    );
    if (c.commercialExclusion) reasons.push("Commercial exclusion applies");
    if (
      relationship &&
      ["customer", "former_customer", "trial", "partner"].includes(
        relationship.status,
      )
    )
      reasons.push(
        "Existing product relationship requires its approved contact strategy",
      );
    if (
      !relationship &&
      (context.sourceCurrentCustomer ||
        ["customer", "unknown"].includes(context.lifecycle))
    )
      reasons.push(
        "Resolve product-specific customer status before acquisition",
      );
  }
  return {
    decision: reasons.length ? "deferred" : "requires_permission_check",
    reasons,
    executionAuthorised: false,
  };
}
export function createContactContext(config: AppConfig, mongo: MongoService) {
  return {
    async unlinked(identity: AuthenticatedUser, w: string, raw: unknown) {
      const { offset } = z
        .object({ offset: z.coerce.number().int().min(0).default(0) })
        .parse(raw);
      const db = await mongo.database();
      await contactContextAccess(db, config, identity, w, "read");
      const rows = await db
        .collection("events")
        .find({
          workspaceId: w,
          eventType: "hubspot_email_history",
          "payload.unlinked": true,
          archived: { $ne: true },
        })
        .sort({ occurredAt: -1, id: 1 })
        .skip(offset)
        .limit(51)
        .toArray();
      return {
        hasMore: rows.length > 50,
        items: rows.slice(0, 50).map((e) => ({
          id: e.id,
          updatedAt: e.updatedAt.toISOString(),
          subject: e.payload.hubspotEmail.subject,
          body: e.payload.hubspotEmail.body,
          date: e.occurredAt.toISOString(),
          participants: e.payload.hubspotEmail.participants,
        })),
      };
    },
    async link(
      identity: AuthenticatedUser,
      w: string,
      eventId: string,
      raw: unknown,
    ) {
      platformIdSchema("event").parse(eventId);
      const input = z
        .object({
          updatedAt: z.string().datetime(),
          personId: platformIdSchema("person"),
          reason: z.string().trim().min(1).max(2000),
        })
        .strict()
        .parse(raw);
      if (!mongo.withTransaction) throw new Error("Transactions required");
      return mongo.withTransaction(async (db, session) => {
        const actor = await contactContextAccess(
            db,
            config,
            identity,
            w,
            "update",
            session,
          ),
          now = await lockIcpWorkspace(db, w, session);
        const person = await db
          .collection("people")
          .findOne(
            { workspaceId: w, id: input.personId, archived: { $ne: true } },
            { session },
          );
        const event = await db.collection("events").findOne(
          {
            workspaceId: w,
            id: eventId,
            eventType: "hubspot_email_history",
            "payload.unlinked": true,
            updatedAt: new Date(input.updatedAt),
          },
          { session },
        );
        if (!person || !event)
          throw new HiveConflict(
            "Contact or email changed. Refresh before linking.",
          );
        const e = event.payload.hubspotEmail;
        await db.collection("events").updateOne(
          { workspaceId: w, id: eventId, updatedAt: event.updatedAt },
          {
            $set: {
              personIds: [person.id],
              updatedAt: now,
              updatedBy: actor,
              "payload.unlinked": false,
              ...(e.direction !== "Forwarded"
                ? {
                    eventType: "email",
                    interaction: {
                      subject: e.subject,
                      body: e.body,
                      actor,
                      details: {
                        type: "email",
                        direction:
                          e.direction === "Incoming" ? "inbound" : "outbound",
                        outcome:
                          e.direction === "Incoming"
                            ? "received"
                            : e.sendStatus === "Sent"
                              ? "sent"
                              : "unknown",
                        references: { messageId: event.source.reference },
                      },
                    },
                  }
                : {}),
            },
          },
          { session },
        );
        await db.collection("events").insertOne(
          EventSchema.parse({
            id: generatePlatformId("event"),
            workspaceId: w,
            createdAt: now,
            updatedAt: now,
            createdBy: actor,
            updatedBy: actor,
            eventType: "hubspot_email_link_reviewed",
            occurredAt: now,
            source: { system: "hvm_contact_context" },
            payload: {
              eventId,
              personId: person.id,
              reason: input.reason,
              previousUpdatedAt: input.updatedAt,
            },
          }),
          { session },
        );
        return { linked: true, personId: person.id };
      });
    },
    async read(identity: AuthenticatedUser, w: string, id: string) {
      const db = await mongo.database();
      await contactContextAccess(db, config, identity, w, "read");
      return readContactContext(db, w, id, undefined, true);
    },
    async save(
      identity: AuthenticatedUser,
      w: string,
      id: string,
      raw: unknown,
    ) {
      const input = z
        .object({
          revision: z.string(),
          controls: z
            .object({
              lifecycle: z.enum(lifecycleStages),
              doNotContact: z.boolean(),
              marketingSuppressed: z.boolean(),
              oneToOneSuppressed: z.boolean(),
              commercialExclusion: z.boolean(),
              reason: z.string().trim().min(1).max(2000),
            })
            .strict(),
          responseReview: z
            .object({
              eventId: platformIdSchema("event"),
              category: z.enum([
                "ordinary_reply",
                "temporary_absence",
                "objection",
                "departure",
                "delivery_failure",
                "needs_review",
              ]),
            })
            .strict()
            .optional(),
          departure: z
            .object({
              eventId: platformIdSchema("event"),
              contactPointId: platformIdSchema("contact"),
              relationshipId: platformIdSchema("orgrel").optional(),
            })
            .optional(),
        })
        .strict()
        .parse(raw);
      if (!mongo.withTransaction) throw new Error("Transactions required");
      return mongo.withTransaction(async (db, session) => {
        const actor = await contactContextAccess(
          db,
          config,
          identity,
          w,
          "update",
          session,
        );
        const now = await lockIcpWorkspace(db, w, session);
        const current = await readContactContext(db, w, id, session);
        if (current.revision !== input.revision)
          throw new HiveConflict(
            "Contact context changed. Reload and review before saving.",
          );
        if (
          input.responseReview &&
          !current.interactions.some(
            (e) =>
              e.id === input.responseReview!.eventId &&
              ["inbound", "Incoming"].includes(e.direction),
          )
        )
          throw new HiveConflict(
            "Choose an incoming email in this person's history.",
          );
        if (input.departure) {
          const d = input.departure;
          const e = current.interactions.find((e) => e.id === d.eventId);
          const point = current.points.find((p) => p.id === d.contactPointId);
          if (
            !e ||
            !point ||
            point.type !== "email" ||
            !["inbound", "Incoming"].includes(e.direction) ||
            !e.participants.includes(point.value.toLowerCase())
          )
            throw new HiveConflict(
              "Choose an email in this person's history and their former address.",
            );
          await db.collection("contact_points").updateOne(
            { workspaceId: w, id: point.id, personId: id },
            {
              $set: {
                suppressed: true,
                leftOrganisation: true,
                updatedAt: now,
                updatedBy: actor,
              },
            },
            { session },
          );
          if (d.relationshipId) {
            if (
              (point.organisationRelationshipId &&
                point.organisationRelationshipId !== d.relationshipId) ||
              !current.relationships.some((r) => r.id === d.relationshipId)
            )
              throw new HiveConflict("Employment relationship unavailable");
            await db.collection("organisation_relationships").updateOne(
              { workspaceId: w, id: d.relationshipId, personId: id },
              {
                $set: {
                  current: false,
                  endDate: new Date(e.date),
                  updatedAt: now,
                  updatedBy: actor,
                },
              },
              { session },
            );
          }
        }
        await db.collection("events").insertOne(
          EventSchema.parse({
            id: generatePlatformId("event"),
            workspaceId: w,
            createdAt: now,
            updatedAt: now,
            createdBy: actor,
            updatedBy: actor,
            eventType: "contact_context_changed",
            occurredAt: now,
            source: { system: "hvm_contact_context" },
            payload: {
              subjectId: id,
              controls: input.controls,
              previousRevision: current.revision,
              ...(input.departure ? { departure: input.departure } : {}),
              ...(input.responseReview
                ? { responseReview: input.responseReview }
                : {}),
            },
          }),
          { session },
        );
        return readContactContext(db, w, id, session, true);
      });
    },
  };
}
