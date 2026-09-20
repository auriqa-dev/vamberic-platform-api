import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test, type TestContext } from "node:test";
import { createApp } from "../src/app";
import { parseConfig } from "../src/config";
import {
  generatePlatformId,
  ProductSchema,
  OrganisationSchema,
  PersonSchema,
  ContactPointSchema,
  EventSchema,
  OpportunitySchema,
  MarketingPermissionSchema,
} from "../src/domain";
import { EnquiryMemoryDb } from "./helpers/enquiry-db";
import { authEnvironment, createTestAuth } from "./helpers/auth";
import type { EnquirySpamCheck } from "../src/routes/public-enquiries";

const productId = "product_00000000000000000000000001";
const origin = "https://product.example";
const input = {
  firstName: "Ada",
  lastName: "Lovelace",
  workEmail: "Ada@Example.com",
  company: "Example Ltd",
  message: "Please discuss our requirements.",
  website: "https://www.example.com/about",
  jobTitle: "Director",
};
const dates = {
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
};
async function fixture(
  t: TestContext,
  limit = 20,
  spamCheck?: EnquirySpamCheck,
) {
  const db = new EnquiryMemoryDb();
  db.rows("products").push(
    ProductSchema.parse({
      ...dates,
      id: productId,
      name: "Service product",
      slug: "service-product",
      productType: "agency",
      lifecycleStatus: "live",
    }),
  );
  const auth = await createTestAuth();
  const config = parseConfig({
    ...authEnvironment,
    DEPLOYMENT_ENV: "test",
    MONGODB_URI: "mongodb://unused.invalid",
    CORS_ORIGINS: "https://vapp.example",
    PUBLIC_ENQUIRY_CORS_ORIGINS: origin + ",http://localhost:3000",
    PUBLIC_ENQUIRY_RATE_LIMIT_MAX_REQUESTS: String(limit),
  });
  const server = createServer(
    createApp(config, db.mongo, {
      jwtKeyResolver: auth.keyResolver,
      enquirySpamCheck: spamCheck,
    }),
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.close();
    await once(server, "close");
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const path = `/api/v1/public/products/${productId}/enquiries`;
  const request = async (
    body: unknown = input,
    init: RequestInit = {},
    target = path,
  ) => {
    const response = await fetch(url + target, {
      method: "POST",
      body: JSON.stringify(body),
      ...init,
      headers: { "content-type": "application/json", origin, ...init.headers },
    });
    const text = await response.text();
    return {
      status: response.status,
      headers: response.headers,
      body: text ? JSON.parse(text) : null,
    };
  };
  return { db, request, path, auth, url };
}

test("public enquiry creates a complete shared CRM graph without a Cognito token", async (t) => {
  const { db, request } = await fixture(t);
  const result = await request({
    ...input,
    source: "search",
    medium: "organic",
    campaign: "launch",
    content: "hero",
    term: "support",
    serviceInterest: "Visibility review",
    landingPage: "https://product.example/enquire?token=secret#fragment",
    referrer: "https://search.example/results?q=personal",
  });
  assert.equal(result.status, 201);
  assert.deepEqual(Object.keys(result.body).sort(), ["enquiryId", "status"]);
  assert.equal(result.body.status, "received");
  assert.match(result.body.enquiryId, /^event_/);
  assert.equal(result.headers.get("cache-control"), "no-store");
  assert.equal(result.headers.get("x-content-type-options"), "nosniff");
  for (const name of [
    "people",
    "contact_points",
    "organisations",
    "organisation_relationships",
    "product_relationships",
    "opportunities",
    "events",
  ])
    assert.equal(db.rows(name).length, 1, name);
  const [person] = db.rows("people"),
    [contact] = db.rows("contact_points"),
    [organisation] = db.rows("organisations"),
    [opportunity] = db.rows("opportunities"),
    [event] = db.rows("events");
  PersonSchema.parse(person);
  ContactPointSchema.parse(contact);
  OrganisationSchema.parse(organisation);
  OpportunitySchema.parse(opportunity);
  EventSchema.parse(event);
  assert.equal(contact.personId, person.id);
  assert.equal(contact.normalizedValue, "ada@example.com");
  assert.equal(contact.primary, true);
  assert.equal(contact.validity, "unknown");
  assert.equal(contact.deliverability, "unknown");
  assert.equal(organisation.domain, "example.com");
  assert.equal(organisation.type, "prospect");
  assert.equal(opportunity.organisationId, organisation.id);
  assert.deepEqual(opportunity.personIds, [person.id]);
  assert.equal(opportunity.productId, productId);
  assert.equal(opportunity.status, "open");
  assert.equal(opportunity.stage, "enquiry");
  assert.equal(opportunity.estimatedValueMinor, undefined);
  assert.equal(opportunity.currency, undefined);
  assert.equal(opportunity.campaignId, undefined);
  assert.equal(event.productId, productId);
  assert.equal(event.personId, person.id);
  assert.equal(event.organisationId, organisation.id);
  assert.equal(event.eventType, "enquiry_submitted");
  assert.equal(event.payload.opportunityId, opportunity.id);
  for (const [key, value] of Object.entries({
    source: "search",
    medium: "organic",
    campaign: "launch",
    content: "hero",
    term: "support",
    serviceInterest: "Visibility review",
    message: input.message,
  }))
    assert.equal(event.payload[key], value);
  assert.equal(event.payload.landingPage, "https://product.example/enquire");
  assert.equal(event.payload.referrer, "https://search.example/results");
  assert.equal(db.rows("marketing_permissions").length, 0);
  assert.equal(
    db.rows("products")[0].updatedAt.getTime(),
    dates.updatedAt.getTime(),
  );
});

test("repeat and simultaneous normalized emails reuse identities and relationships, but create distinct enquiries", async (t) => {
  const { db, request } = await fixture(t);
  const first = await request();
  const repeated = await Promise.all([
    request({ ...input, workEmail: " ada@example.com " }),
    request(input),
  ]);
  assert.equal(first.status, 201);
  for (const result of repeated) assert.equal(result.status, 201);
  assert.equal(
    new Set([first.body.enquiryId, ...repeated.map((r) => r.body.enquiryId)])
      .size,
    3,
  );
  for (const name of [
    "people",
    "contact_points",
    "organisations",
    "organisation_relationships",
    "product_relationships",
  ])
    assert.equal(db.rows(name).length, 1, name);
  assert.equal(db.rows("opportunities").length, 3);
  assert.equal(db.rows("events").length, 3);
});

test("existing CRM email is reused without overwriting identity or verification/suppression", async (t) => {
  const { db, request } = await fixture(t);
  const person = PersonSchema.parse({
    ...dates,
    id: generatePlatformId("person"),
    firstName: "Existing",
    lastName: "Identity",
  });
  const contact = ContactPointSchema.parse({
    ...dates,
    id: generatePlatformId("contact"),
    personId: person.id,
    type: "email",
    value: "ada@example.com",
    normalizedValue: "ada@example.com",
    primary: false,
    suppressed: true,
    validity: "valid",
  });
  db.rows("people").push(person);
  db.rows("contact_points").push(contact);
  assert.equal((await request()).status, 201);
  assert.equal(db.rows("people").length, 1);
  assert.equal(db.rows("people")[0].firstName, "Existing");
  assert.equal(db.rows("contact_points").length, 1);
  assert.equal(contact.suppressed, true);
  assert.equal(contact.primary, false);
  assert.equal(contact.validity, "valid");
});

test("organisation reuse requires exact company and domain; similar names or domains alone are not enough", async (t) => {
  const { db, request } = await fixture(t);
  const org = OrganisationSchema.parse({
    ...dates,
    id: generatePlatformId("org"),
    name: input.company,
    domain: "example.com",
    type: "customer",
  });
  db.rows("organisations").push(org);
  assert.equal((await request()).status, 201);
  assert.equal(db.rows("organisations").length, 1);
  assert.equal(db.rows("opportunities")[0].organisationId, org.id);
  assert.equal(
    (await request({ ...input, company: "Example Ltd Similar" })).status,
    201,
  );
  assert.equal(
    (await request({ ...input, website: "other.example" })).status,
    201,
  );
  assert.equal(db.rows("organisations").length, 3);
  assert.equal(org.type, "customer");
});

test("without a website only this person's existing current same-name organisation is reused", async (t) => {
  const { db, request } = await fixture(t);
  const body = {
    firstName: "Mary Ann",
    lastName: "van Buren",
    workEmail: input.workEmail,
    company: input.company,
    message: input.message,
  };
  assert.equal((await request(body)).status, 201);
  assert.equal((await request(body)).status, 201);
  assert.equal(db.rows("people")[0].firstName, "Mary Ann");
  assert.equal(db.rows("people")[0].lastName, "van Buren");
  assert.equal(db.rows("people")[0].displayName, "Mary Ann van Buren");
  assert.equal(db.rows("organisations").length, 1);
  assert.equal(
    (await request({ ...body, workEmail: "other@example.com" })).status,
    201,
  );
  assert.equal(db.rows("organisations").length, 2);
});

for (const [name, change] of Object.entries({
  "malformed email": { workEmail: "not-an-email" },
  "empty first name": { firstName: "   " },
  "empty last name": { lastName: "   " },
  "missing first name": { firstName: undefined },
  "missing last name": { lastName: undefined },
  "long first name": { firstName: "a".repeat(101) },
  "long last name": { lastName: "a".repeat(101) },
  "legacy name only": {
    firstName: undefined,
    lastName: undefined,
    name: "Ada Lovelace",
  },
  "legacy name alongside explicit fields": { name: "Ada Lovelace" },
  "long message": { message: "x".repeat(4001) },
  "long company": { company: "x".repeat(301) },
  "long attribution": { source: "x".repeat(201) },
  "invalid website": { website: "not a domain" },
  "script URL": { website: "javascript:alert(1)" },
  "website credentials": { website: "https://user:pass@example.com" },
  "invalid landing page": { landingPage: "file:///etc/passwd" },
  "string boolean": { marketingOptIn: "true" },
  "unknown fields": { payload: { arbitrary: true } },
  "opt-in without evidence": { marketingOptIn: true },
  "opt-in without version": {
    marketingOptIn: true,
    marketingConsentText: "Yes",
  },
  "oversized encoded evidence": {
    marketingOptIn: true,
    marketingConsentText: "a\n".repeat(499),
    marketingConsentVersion: '"'.repeat(100),
  },
}))
  test(`public enquiry rejects ${name} before any database access`, async (t) => {
    const { db, request } = await fixture(t);
    assert.equal((await request({ ...input, ...change })).status, 400);
    assert.equal(db.databaseCalls, 0);
  });

for (const marketingOptIn of [undefined, false])
  test(`marketing opt-in ${String(marketingOptIn)} adds no permission`, async (t) => {
    const { db, request } = await fixture(t);
    assert.equal((await request({ ...input, marketingOptIn })).status, 201);
    assert.equal(db.rows("marketing_permissions").length, 0);
  });

test("explicit opt-in appends correctly scoped consent with evidence and does not mutate prior decisions", async (t) => {
  const { db, request } = await fixture(t);
  const body = {
    ...input,
    marketingOptIn: true,
    marketingConsentText: "Email me product updates.",
    marketingConsentVersion: "v1",
  };
  const first = await request(body);
  assert.equal(first.status, 201);
  const original = structuredClone(db.rows("marketing_permissions")[0]);
  const permission = MarketingPermissionSchema.parse(original);
  assert.equal(permission.personId, db.rows("people")[0].id);
  assert.equal(permission.contactPointId, db.rows("contact_points")[0].id);
  assert.equal(permission.productId, productId);
  assert.equal(permission.portfolioWide, false);
  assert.equal(permission.channel, "email");
  assert.equal(permission.purpose, "marketing");
  assert.equal(permission.lawfulBasis, "consent");
  assert.equal(permission.permitted, true);
  assert.deepEqual(JSON.parse(permission.evidence!), {
    source: "public_product_enquiry",
    enquiryId: first.body.enquiryId,
    text: body.marketingConsentText,
    version: "v1",
  });
  assert.equal(
    (await request({ ...input, marketingOptIn: false })).status,
    201,
  );
  assert.equal(db.rows("marketing_permissions").length, 1);
  assert.equal((await request(body)).status, 201);
  assert.equal(db.rows("marketing_permissions").length, 2);
  assert.deepEqual(db.rows("marketing_permissions")[0], original);
});

test("invalid and nonexistent product IDs and archived/retired products are rejected", async (t) => {
  const { db, request } = await fixture(t);
  assert.equal(
    (await request(input, {}, "/api/v1/public/products/bad-id/enquiries"))
      .status,
    400,
  );
  assert.equal(
    (
      await request(
        input,
        {},
        `/api/v1/public/products/${generatePlatformId("product")}/enquiries`,
      )
    ).status,
    404,
  );
  db.rows("products")[0].archived = true;
  assert.equal((await request()).status, 404);
  db.rows("products")[0].archived = false;
  db.rows("products")[0].lifecycleStatus = "retired";
  assert.equal((await request()).status, 404);
  assert.equal(db.rows("people").length, 0);
});

test("private routes remain authenticated and public origins do not gain private CORS access", async (t) => {
  const { request, auth } = await fixture(t);
  for (const [path, method] of [
    ["/api/v1/products", "GET"],
    ["/api/v1/products", "POST"],
    ["/api/v1/dashboard/summary", "GET"],
    ["/api/v1/future", "POST"],
  ]) {
    const result = await request(
      input,
      { method, ...(method === "GET" ? { body: undefined } : {}) },
      path,
    );
    assert.equal(result.status, 401);
    assert.equal(result.headers.get("access-control-allow-origin"), null);
  }
  const allowed = await request(
    undefined,
    {
      method: "GET",
      body: undefined,
      headers: {
        origin: "https://vapp.example",
        authorization: `Bearer ${await auth.sign()}`,
      },
    },
    "/api/v1/products",
  );
  assert.equal(allowed.status, 200);
  assert.equal(
    allowed.headers.get("access-control-allow-origin"),
    "https://vapp.example",
  );
});

test("public CORS permits configured product and local origins, rejects others and never uses wildcard", async (t) => {
  const { db, request } = await fixture(t);
  for (const allowed of [origin, "http://localhost:3000"]) {
    const result = await request(input, { headers: { origin: allowed } });
    assert.equal(result.status, 201);
    assert.equal(result.headers.get("access-control-allow-origin"), allowed);
    const preflight = await request(undefined, {
      method: "OPTIONS",
      body: undefined,
      headers: {
        origin: allowed,
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
      },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), allowed);
  }
  for (const denied of [
    "https://evil.example",
    "https://vapp.example",
    "null",
  ]) {
    const result = await request(input, { headers: { origin: denied } });
    assert.equal(result.status, 403);
    assert.equal(result.headers.get("access-control-allow-origin"), null);
  }
  assert.equal(db.rows("events").length, 2);
});

test("public limit is independent and tighter; denied request does not persist", async (t) => {
  const { db, request } = await fixture(t, 2);
  assert.equal((await request()).status, 201);
  assert.equal((await request()).status, 201);
  const rejected = await request();
  assert.equal(rejected.status, 429);
  assert.ok(Number(rejected.headers.get("retry-after")) > 0);
  assert.equal(rejected.headers.get("access-control-allow-origin"), origin);
  assert.equal(db.rows("events").length, 2);
});

test("public parser returns safe errors for invalid JSON, content type and oversized bodies", async (t) => {
  const { db, request } = await fixture(t);
  const invalid = await request(input, {
    body: '{"secret":"private@example.com",',
  });
  assert.equal(invalid.status, 400);
  assert.ok(!JSON.stringify(invalid.body).includes("private@example.com"));
  assert.equal(
    (await request(input, { headers: { "content-type": "text/plain" } }))
      .status,
    415,
  );
  assert.equal(
    (
      await request(input, {
        body: JSON.stringify({ message: "x".repeat(17000) }),
      })
    ).status,
    413,
  );
  assert.equal(db.databaseCalls, 0);
});

test("partial write failure rolls back all CRM changes and hides raw Mongo errors", async (t) => {
  const { db, request } = await fixture(t);
  db.failCollection = "events";
  const result = await request();
  assert.equal(result.status, 503);
  assert.deepEqual(result.body, {
    error: {
      code: "ENQUIRY_UNAVAILABLE",
      message: "Enquiry capture temporarily unavailable",
    },
  });
  for (const [name, records] of Object.entries(db.records))
    if (name !== "products") assert.equal(records.length, 0, name);
});

test("unique-key race retries the complete transaction without orphaning records", async (t) => {
  const { db, request } = await fixture(t);
  db.duplicateOnce = true;
  assert.equal((await request()).status, 201);
  assert.equal(db.attempts, 2);
  assert.equal(db.rows("people").length, 1);
  assert.equal(db.rows("contact_points").length, 1);
});

test("missing concurrency indexes fail closed before writing", async (t) => {
  const { db, request } = await fixture(t);
  db.missingIndexes = true;
  assert.equal((await request()).status, 503);
  assert.equal(db.attempts, 0);
  assert.equal(db.rows("people").length, 0);
});

test("multiple email owners are not merged or disclosed", async (t) => {
  const { db, request } = await fixture(t);
  for (let i = 0; i < 2; i++) {
    const person = PersonSchema.parse({
      ...dates,
      id: generatePlatformId("person"),
      firstName: "Existing",
    });
    db.rows("people").push(person);
    db.rows("contact_points").push(
      ContactPointSchema.parse({
        ...dates,
        id: generatePlatformId("contact"),
        personId: person.id,
        type: "email",
        value: "ada@example.com",
        normalizedValue: "ada@example.com",
      }),
    );
  }
  const result = await request();
  assert.equal(result.status, 409);
  assert.ok(!JSON.stringify(result.body).includes(db.rows("people")[0].id));
  assert.equal(db.rows("opportunities").length, 0);
});

test("future anti-spam hook rejects before CRM lookup", async (t) => {
  const { db, request } = await fixture(t, 20, async () => false);
  assert.equal((await request()).status, 400);
  assert.equal(db.databaseCalls, 0);
});

test("public origin configuration rejects wildcard, paths and credentials", () => {
  for (const origins of [
    "*",
    "https://*.example.com",
    "https://example.*",
    "https://example.com/path",
    "https://user:pass@example.com",
    "null",
  ])
    assert.throws(
      () =>
        parseConfig({
          ...authEnvironment,
          DEPLOYMENT_ENV: "test",
          MONGODB_URI: "mongodb://unused.invalid",
          PUBLIC_ENQUIRY_CORS_ORIGINS: origins,
        }),
      /PUBLIC_ENQUIRY_CORS_ORIGINS/,
    );
});

test("a second product shares identity but has its own opportunity, relationship, event and consent scope", async (t) => {
  const { db, request } = await fixture(t);
  const secondId = generatePlatformId("product");
  db.rows("products").push({
    ...db.rows("products")[0],
    id: secondId,
    slug: "another-product",
  });
  assert.equal((await request()).status, 201);
  assert.equal(
    (
      await request(
        {
          ...input,
          marketingOptIn: true,
          marketingConsentText: "Send updates",
          marketingConsentVersion: "v1",
        },
        {},
        `/api/v1/public/products/${secondId}/enquiries`,
      )
    ).status,
    201,
  );
  assert.equal(db.rows("people").length, 1);
  assert.equal(db.rows("contact_points").length, 1);
  assert.equal(db.rows("organisations").length, 1);
  assert.equal(db.rows("organisation_relationships").length, 1);
  assert.equal(db.rows("product_relationships").length, 2);
  for (const name of ["opportunities", "events"])
    assert.deepEqual(
      db.rows(name).map((row) => row.productId),
      [productId, secondId],
    );
  assert.equal(db.rows("marketing_permissions")[0].productId, secondId);
});

test("repeated enquiries preserve a current customer relationship without downgrading it", async (t) => {
  const { db, request } = await fixture(t);
  assert.equal((await request()).status, 201);
  db.rows("product_relationships")[0].status = "customer";
  assert.equal((await request()).status, 201);
  assert.equal(db.rows("product_relationships").length, 1);
  assert.equal(db.rows("product_relationships")[0].status, "customer");
});

test("marketing permission failure rolls back the enquiry event and opportunity too", async (t) => {
  const { db, request } = await fixture(t);
  db.failCollection = "marketing_permissions";
  assert.equal(
    (
      await request({
        ...input,
        marketingOptIn: true,
        marketingConsentText: "Yes",
        marketingConsentVersion: "v1",
      })
    ).status,
    503,
  );
  for (const [name, rows] of Object.entries(db.records))
    if (name !== "products") assert.equal(rows.length, 0, name);
});

test("missing transaction support never falls back to partial writes", async (t) => {
  const { db, request } = await fixture(t);
  db.mongo.withTransaction = undefined;
  assert.equal((await request()).status, 503);
  assert.equal(db.databaseCalls, 0);
});

test("stale retired legacy status does not override the current Product v2 lifecycle", async (t) => {
  const { db, request } = await fixture(t);
  db.rows("products")[0].status = "retired";
  assert.equal((await request()).status, 201);
});

test("explicit names are trimmed without splitting and repeat enquiries preserve a historical mononym", async (t) => {
  const { db, request } = await fixture(t);
  assert.equal(
    (
      await request({
        ...input,
        firstName: "  Mary Ann  ",
        lastName: "  van Buren  ",
      })
    ).status,
    201,
  );
  const person = db.rows("people")[0];
  assert.equal(person.firstName, "Mary Ann");
  assert.equal(person.lastName, "van Buren");
  assert.equal(person.displayName, "Mary Ann van Buren");
  assert.equal(db.rows("events")[0].payload.formVersion, "2");
  assert.equal(db.rows("events")[0].payload.firstName, "Mary Ann");
  assert.equal(db.rows("events")[0].payload.lastName, "van Buren");
  assert.equal("name" in db.rows("events")[0].payload, false);
  person.firstName = "Prince";
  person.displayName = "Prince";
  delete person.lastName;
  const before = structuredClone(person);
  assert.equal((await request(input)).status, 201);
  assert.equal(db.rows("people").length, 1);
  assert.deepEqual(db.rows("people")[0], before);
});
