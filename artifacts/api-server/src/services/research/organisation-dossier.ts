import type { Db } from "mongodb";
import { platformIdSchema } from "../../domain";
import { readContactContext } from "../contact-context";
import { AuthorizationDenied } from "../../authorization/policy";
/** Caller must authorise people, organisations and their context in this workspace. Never an execution grant. */
export async function readOrganisationDossier(db: Db, w: string, id: string) {
  platformIdSchema("org").parse(id);
  const organisation = await db
    .collection("organisations")
    .findOne({ workspaceId: w, id, archived: { $ne: true } });
  if (!organisation) throw new AuthorizationDenied();
  const relationships = await db
    .collection("organisation_relationships")
    .find({ workspaceId: w, organisationId: id, archived: { $ne: true } })
    .sort({ id: 1 })
    .limit(101)
    .toArray();
  const people = await db
    .collection("people")
    .find({
      workspaceId: w,
      id: { $in: relationships.slice(0, 100).map((r) => r.personId) },
      archived: { $ne: true },
    })
    .sort({ id: 1 })
    .toArray();
  const contacts = [];
  // Bounded batches avoid an unbounded fan-out while preserving each contact's restrictions.
  for (let i = 0; i < people.length; i += 5)
    contacts.push(
      ...(await Promise.all(
        people.slice(i, i + 5).map(async (p) => ({
          id: p.id,
          firstName: p.firstName,
          lastName: p.lastName,
          title: p.title,
          relationships: relationships
            .filter((r) => r.personId === p.id)
            .map((r) => ({
              id: r.id,
              current: r.current,
              startDate: r.startDate ?? null,
              endDate: r.endDate ?? null,
            })),
          context: await readContactContext(db, w, p.id),
        })),
      )),
    );
  const ids = people.map((p) => p.id);
  const evidence = await db
    .collection("events")
    .find({
      workspaceId: w,
      archived: { $ne: true },
      eventType: {
        $in: [
          "research_finding",
          "research_discovery",
          "campaign_activity",
          "campaign_audience_assessment",
          "contact_strategy_assessment",
        ],
      },
      $or: [
        { organisationId: id },
        { personId: { $in: ids } },
        { personIds: { $in: ids } },
        { "payload.organisationId": id },
        { "payload.personId": { $in: ids } },
        { "payload.result.id": id },
        { "payload.destinations": { $elemMatch: { id } } },
      ],
    })
    .sort({ createdAt: -1, id: -1 })
    .limit(101)
    .toArray();
  const campaigns = [
    ...new Set(
      evidence
        .filter((e) =>
          ["campaign_activity", "campaign_audience_assessment"].includes(
            e.eventType,
          ),
        )
        .map((e) => e.campaignId ?? e.payload.campaignId)
        .filter(Boolean),
    ),
  ];
  const context = await readContactContext(db, w, id);
  return {
    organisation: {
      id: organisation.id,
      name: organisation.name,
      domain: organisation.normalizedDomain ?? organisation.domain ?? null,
      website: organisation.website ?? null,
    },
    context,
    contacts,
    evidence: evidence.slice(0, 100).map((e) => ({
      id: e.id,
      type: e.eventType,
      date: e.occurredAt,
      payload: e.payload,
    })),
    managementState: evidence.some(
      (e) =>
        e.eventType === "campaign_activity" && e.payload.kind === "managed",
    )
      ? "management_recorded_review_current_status"
      : "not_recorded",
    campaignParticipation: campaigns.length ? "recorded" : "not_recorded",
    campaignIds: campaigns,
    hasMore:
      relationships.length > 100 ||
      evidence.length > 100 ||
      context.restrictionsTruncated ||
      contacts.some((c) => c.context.restrictionsTruncated),
    historyLimitPerContact: 50,
    executionAuthorised: false,
  };
}
