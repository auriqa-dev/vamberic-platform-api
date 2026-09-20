import type { Filter } from "mongodb";
import type { DomainCollections } from "../db/collections";
import type { Person, Organisation, Opportunity, Event } from "../domain";

const active = { archived: { $ne: true } } as const;
const current = { ...active, current: true, endDate: { $exists: false } };
export function literalSearch(search: string) {
  return {
    $regex: search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    $options: "i",
  };
}
const identity = (p: Person) =>
  p.displayName || [p.firstName, p.lastName].filter(Boolean).join(" ");
const base = (record: Person | Organisation | Opportunity) => ({
  id: record.id,
  createdAt: record.createdAt,
  sourceSystem: record.source?.system,
});

/** Read projections only: the persistence schemas remain the source of truth. */
export function crmReader(c: DomainCollections) {
  async function reference(kind: "products" | "organisations", id: string) {
    const record = await c[kind].findOne({ ...active, id });
    // Keep dangling/archived references understandable without exposing their data.
    return { id, name: record?.name ?? id };
  }
  async function person(p: Person) {
    const [email, relationships] = await Promise.all([
      c.contact_points.findOne({
        ...active,
        personId: p.id,
        type: "email",
        primary: true,
      }),
      c.organisation_relationships
        .find({ ...current, personId: p.id })
        .sort({ id: 1 })
        .toArray(),
    ]);
    return {
      ...base(p),
      firstName: p.firstName,
      lastName: p.lastName,
      displayName: identity(p),
      primaryEmail: email?.value,
      lifecycleStatus: p.lifecycleStatus,
      currentOrganisations: await Promise.all(
        relationships.map(async (r) => ({
          organisation: await reference("organisations", r.organisationId),
          jobTitle: r.jobTitle,
        })),
      ),
    };
  }
  async function linkedPeople(organisationId: string) {
    const relationships = await c.organisation_relationships
      .find({ ...current, organisationId })
      .toArray();
    return c.people
      .find({
        ...active,
        id: { $in: [...new Set(relationships.map((r) => r.personId))] },
      })
      .sort({ createdAt: -1, id: 1 })
      .toArray();
  }
  async function organisation(o: Organisation) {
    const [people, opportunityCount] = await Promise.all([
      linkedPeople(o.id),
      c.opportunities.countDocuments({ ...active, organisationId: o.id }),
    ]);
    return {
      ...base(o),
      name: o.name,
      domain: o.domain,
      lifecycleStatus: o.lifecycleStatus,
      peopleCount: people.length,
      opportunityCount,
    };
  }
  async function opportunity(o: Opportunity) {
    const [product, organisation, people] = await Promise.all([
      reference("products", o.productId),
      reference("organisations", o.organisationId),
      c.people.find({ ...active, id: { $in: o.personIds } }).toArray(),
    ]);
    return {
      ...base(o),
      name: o.name,
      updatedAt: o.updatedAt,
      product,
      organisation,
      people: people.map((p) => ({ id: p.id, name: identity(p) })),
      stage: o.stage,
      status: o.status,
      ...(o.estimatedValueMinor !== undefined && o.currency
        ? { estimatedValueMinor: o.estimatedValueMinor, currency: o.currency }
        : {}),
    };
  }
  async function products(
    filter: { personId: string } | { organisationId: string },
  ) {
    const relationships = await c.product_relationships
      .find({ ...active, ...filter })
      .sort({ createdAt: -1, id: 1 })
      .toArray();
    return Promise.all(
      relationships.map(async (r) => ({
        id: r.id,
        product: await reference("products", r.productId),
        status: r.status,
        acquisitionSource: r.acquisitionSource,
      })),
    );
  }
  async function opportunities(filter: Filter<Opportunity>) {
    return Promise.all(
      (
        await c.opportunities
          .find({ ...active, ...filter })
          .sort({ createdAt: -1, id: 1 })
          .toArray()
      ).map(opportunity),
    );
  }
  async function events(filter: Filter<Event>) {
    const rows = await c.events
      .find({ ...active, ...filter })
      .sort({ occurredAt: -1, id: 1 })
      .limit(10)
      .toArray();
    return rows.map((e) => ({
      id: e.id,
      eventType: e.eventType,
      occurredAt: e.occurredAt,
      productId: e.productId,
      personId: e.personId,
      organisationId: e.organisationId,
      // Only the known enquiry event has a public-form payload contract.
      ...(e.eventType === "enquiry_submitted"
        ? Object.fromEntries(
            [
              "opportunityId",
              "message",
              "serviceInterest",
              "source",
              "medium",
              "campaign",
              "content",
              "term",
              "landingPage",
              "referrer",
            ]
              .filter((key) => typeof e.payload?.[key] === "string")
              .map((key) => [key, e.payload![key]]),
          )
        : {}),
    }));
  }
  return {
    person,
    organisation,
    opportunity,
    async personDetail(p: Person) {
      const [summary, contacts, productLinks, opportunityLinks, recentEvents] =
        await Promise.all([
          person(p),
          c.contact_points
            .find({ ...active, personId: p.id })
            .sort({ primary: -1, id: 1 })
            .toArray(),
          products({ personId: p.id }),
          opportunities({ personIds: p.id }),
          events({ personId: p.id }),
        ]);
      return {
        ...summary,
        contactPoints: contacts.map(
          ({
            id,
            type,
            value,
            primary,
            validity,
            deliverability,
            suppressed,
          }) => ({
            id,
            type,
            value,
            primary,
            validity,
            deliverability,
            suppressed,
          }),
        ),
        products: productLinks,
        opportunities: opportunityLinks,
        recentEvents,
      };
    },
    async organisationDetail(o: Organisation) {
      const [summary, people, productLinks, opportunityLinks] =
        await Promise.all([
          organisation(o),
          linkedPeople(o.id),
          products({ organisationId: o.id }),
          opportunities({ organisationId: o.id }),
        ]);
      return {
        ...summary,
        people: await Promise.all(people.map(person)),
        products: productLinks,
        opportunities: opportunityLinks,
      };
    },
    async opportunityDetail(o: Opportunity) {
      return {
        ...(await opportunity(o)),
        enquiryEvents: await events({
          eventType: "enquiry_submitted",
          "payload.opportunityId": o.id,
        }),
      };
    },
  };
}
