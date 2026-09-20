import type { ClientSession, Db } from "mongodb";
import {
  PersonSchema,
  ContactPointSchema,
  OrganisationSchema,
  OrganisationRelationshipSchema,
  ProductRelationshipSchema,
  OpportunitySchema,
  EventSchema,
  MarketingPermissionSchema,
  generatePlatformId,
  normalizeContactValue,
  type Organisation,
  type ContactPoint,
} from "../domain";
import {
  safePage,
  websiteDomain,
  type PublicEnquiry,
} from "../domain/public-enquiry";
import { getDomainCollections } from "../db";
import { assertEnquiryIndexes } from "../db/enquiry-indexes";
import type { MongoService } from "./mongo";

export class EnquiryError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
const ambiguous = () =>
  new EnquiryError(
    409,
    "ENQUIRY_UNRESOLVED",
    "Unable to accept this enquiry; please contact the product team",
  );

async function persistEnquiry(
  db: Db,
  session: ClientSession,
  productId: string,
  input: PublicEnquiry,
): Promise<string> {
  const c = getDomainCollections(db);
  const options = { session };
  const product = await c.products.findOne(
    { id: productId, archived: { $ne: true } },
    options,
  );
  if (
    !product ||
    product.archivedAt ||
    (product.productModelVersion === 2
      ? product.lifecycleStatus === "retired"
      : (product as unknown as { status?: string }).status === "retired")
  ) {
    throw new EnquiryError(404, "PRODUCT_UNAVAILABLE", "Product unavailable");
  }
  const now = new Date();
  const base = {
    createdAt: now,
    updatedAt: now,
    source: { system: "public_enquiry" },
  };
  const normalizedEmail = normalizeContactValue("email", input.workEmail);
  const contacts = await c.contact_points
    .find({ type: "email", normalizedValue: normalizedEmail }, options)
    .limit(2)
    .toArray();
  if (contacts.length > 1) throw ambiguous();
  let contact: ContactPoint | undefined = contacts[0];
  let person;
  if (contact) {
    person = await c.people.findOne({ id: contact.personId }, options);
    if (
      !person ||
      person.archived ||
      person.archivedAt ||
      person.lifecycleStatus !== "active" ||
      contact.leftOrganisation ||
      contact.archived ||
      contact.archivedAt
    )
      throw ambiguous();
    // Serialize repeat submissions for this identity across API replicas. Do
    // not change names, ownership, suppression, validity or deliverability.
    await c.contact_points.updateOne(
      { id: contact.id },
      {
        $set: {
          updatedAt: new Date(
            Math.max(now.getTime(), contact.updatedAt.getTime() + 1),
          ),
        },
      },
      options,
    );
  } else {
    person = PersonSchema.parse({
      ...base,
      id: generatePlatformId("person"),
      firstName: input.firstName,
      lastName: input.lastName,
      displayName: `${input.firstName} ${input.lastName}`,
    });
    contact = ContactPointSchema.parse({
      ...base,
      id: generatePlatformId("contact"),
      personId: person.id,
      type: "email",
      value: input.workEmail,
      normalizedValue: normalizedEmail,
      primary: true,
      firstSeenAt: now,
    });
    await c.people.insertOne(person, options);
    await c.contact_points.insertOne(contact, options);
  }

  const company = input.company.replace(/\s+/g, " ");
  const domain = input.website ? websiteDomain(input.website) : undefined;
  let organisation: Organisation | undefined;
  if (domain) {
    // Both facts must agree exactly. Never merge by fuzzy name or email domain.
    const matches = await c.organisations
      .find({ name: company, domain }, options)
      .limit(2)
      .toArray();
    if (matches.length > 1) throw ambiguous();
    organisation = matches[0];
  } else {
    // Without a domain, only an existing current relationship for THIS person
    // gives enough evidence to reuse a same-name organisation.
    const relationships = await c.organisation_relationships
      .find(
        {
          personId: person.id,
          current: true,
          archived: { $ne: true },
          endDate: { $exists: false },
        },
        options,
      )
      .toArray();
    const matches = await c.organisations
      .find(
        {
          id: { $in: relationships.map((item) => item.organisationId) },
          name: company,
          archived: { $ne: true },
          lifecycleStatus: "active",
        },
        options,
      )
      .limit(2)
      .toArray();
    if (matches.length === 1) organisation = matches[0];
  }
  if (organisation) {
    if (
      organisation.archived ||
      organisation.archivedAt ||
      organisation.lifecycleStatus !== "active"
    )
      throw ambiguous();
    await c.organisations.updateOne(
      { id: organisation.id },
      { $set: { updatedAt: now } },
      options,
    );
  } else {
    organisation = OrganisationSchema.parse({
      ...base,
      id: generatePlatformId("org"),
      name: company,
      domain,
      type: "prospect",
    });
    await c.organisations.insertOne(organisation, options);
  }

  const employment = {
    personId: person.id,
    organisationId: organisation.id,
    current: true,
    archived: { $ne: true },
    endDate: { $exists: false },
  };
  if (!(await c.organisation_relationships.findOne(employment, options))) {
    await c.organisation_relationships.insertOne(
      OrganisationRelationshipSchema.parse({
        ...base,
        id: generatePlatformId("orgrel"),
        personId: person.id,
        organisationId: organisation.id,
        current: true,
        jobTitle: input.jobTitle,
      }),
      options,
    );
  }
  if (
    !(await c.product_relationships.findOne(
      {
        productId,
        personId: person.id,
        organisationId: organisation.id,
        archived: { $ne: true },
        endedAt: { $exists: false },
      },
      options,
    ))
  ) {
    await c.product_relationships.insertOne(
      ProductRelationshipSchema.parse({
        ...base,
        id: generatePlatformId("prodrel"),
        productId,
        personId: person.id,
        organisationId: organisation.id,
        status: "engaged",
        acquisitionSource: input.source,
        firstEngagementAt: now,
      }),
      options,
    );
  }

  const opportunity = OpportunitySchema.parse({
    ...base,
    id: generatePlatformId("opportunity"),
    productId,
    organisationId: organisation.id,
    personIds: [person.id],
    name: `Enquiry: ${company}`.slice(0, 300),
    stage: "enquiry",
    status: "open",
  });
  const event = EventSchema.parse({
    ...base,
    id: generatePlatformId("event"),
    eventType: "enquiry_submitted",
    occurredAt: now,
    productId,
    personId: person.id,
    organisationId: organisation.id,
    payload: {
      opportunityId: opportunity.id,
      form: "public_product_enquiry",
      formVersion: "2",
      firstName: input.firstName,
      lastName: input.lastName,
      workEmail: input.workEmail,
      company: input.company,
      message: input.message,
      ...(input.website ? { website: websiteDomain(input.website) } : {}),
      ...Object.fromEntries(
        (
          [
            "jobTitle",
            "serviceInterest",
            "source",
            "medium",
            "campaign",
            "content",
            "term",
          ] as const
        )
          .filter((key) => input[key] !== undefined)
          .map((key) => [key, input[key]]),
      ),
      ...(input.landingPage
        ? { landingPage: safePage(input.landingPage) }
        : {}),
      ...(input.referrer ? { referrer: safePage(input.referrer) } : {}),
      marketingOptIn: input.marketingOptIn === true,
    },
  });
  await c.opportunities.insertOne(opportunity, options);
  await c.events.insertOne(event, options);
  if (input.marketingOptIn === true) {
    await c.marketing_permissions.insertOne(
      MarketingPermissionSchema.parse({
        ...base,
        id: generatePlatformId("permission"),
        personId: person.id,
        contactPointId: contact.id,
        productId,
        portfolioWide: false,
        channel: "email",
        purpose: "marketing",
        lawfulBasis: "consent",
        permitted: true,
        effectiveAt: now,
        evidence: JSON.stringify({
          source: "public_product_enquiry",
          enquiryId: event.id,
          text: input.marketingConsentText,
          version: input.marketingConsentVersion,
        }),
      }),
      options,
    );
  }
  return event.id;
}

export async function submitEnquiry(
  mongo: MongoService,
  productId: string,
  input: PublicEnquiry,
): Promise<string> {
  if (!mongo.withTransaction) throw new Error("Transactions unavailable");
  await assertEnquiryIndexes(await mongo.database());
  // The driver retries transient write conflicts. A first-insert unique-index
  // race must restart the whole transaction so it can reuse the winning record.
  for (let attempt = 0; ; attempt++) {
    try {
      return await mongo.withTransaction((db, session) =>
        persistEnquiry(db, session, productId, input),
      );
    } catch (error) {
      if (
        attempt < 2 &&
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === 11000
      )
        continue;
      throw error;
    }
  }
}
