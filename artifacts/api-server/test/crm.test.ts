import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test, type TestContext } from "node:test";
import { createApp } from "../src/app";
import { parseConfig } from "../src/config";
import { ProductSchema, generatePlatformId } from "../src/domain";
import { EnquiryMemoryDb } from "./helpers/enquiry-db";
import { authEnvironment, createTestAuth } from "./helpers/auth";

const productId = "product_00000000000000000000000001";
async function fixture(t: TestContext, seed = true) {
  const db = new EnquiryMemoryDb();
  const now = new Date("2026-01-01T00:00:00Z");
  db.rows("products").push(
    ProductSchema.parse({
      id: productId,
      name: "Agency",
      slug: "agency",
      productType: "agency",
      lifecycleStatus: "live",
      createdAt: now,
      updatedAt: now,
    }),
  );
  const auth = await createTestAuth();
  const config = parseConfig({
    ...authEnvironment,
    DEPLOYMENT_ENV: "test",
    MONGODB_URI: "mongodb://unused.invalid",
    PUBLIC_ENQUIRY_RATE_LIMIT_MAX_REQUESTS: "20",
  });
  const server = createServer(
    createApp(config, db.mongo, { jwtKeyResolver: auth.keyResolver }),
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.close();
    await once(server, "close");
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  if (seed) {
    const submitted = await fetch(
      `${url}/api/v1/public/products/${productId}/enquiries`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          firstName: "Mary Ann",
          lastName: "van Buren",
          workEmail: "mary@example.com",
          company: "Example Ltd",
          website: "example.com",
          jobTitle: "Director",
          message: "Please discuss a review.",
          source: "search",
          medium: "organic",
          campaign: "launch",
          serviceInterest: "Review",
          landingPage: "https://example.com/enquire?secret=private",
        }),
      },
    );
    assert.equal(submitted.status, 201);
    await submitted.arrayBuffer();
  }
  const token = await auth.sign();
  async function get(path: string, authenticated = true) {
    const response = await fetch(url + "/api/v1/" + path, {
      headers: authenticated ? { authorization: `Bearer ${token}` } : {},
    });
    return {
      status: response.status,
      headers: response.headers,
      body: await response.json(),
    };
  }
  return { db, get };
}

test("all six CRM routes require Cognito before accessing Mongo and have no public counterpart", async (t) => {
  const { db, get } = await fixture(t, false);
  const routes = [
    "people",
    `people/${generatePlatformId("person")}`,
    "organisations",
    `organisations/${generatePlatformId("org")}`,
    "opportunities",
    `opportunities/${generatePlatformId("opportunity")}`,
  ];
  for (const route of routes) {
    assert.equal((await get(route, false)).status, 401);
    assert.equal((await get("public/" + route, false)).status, 404);
  }
  assert.equal(db.databaseCalls, 0);
});

test("people list/detail projects primary email, current organisation, products, opportunities and recent events", async (t) => {
  const { db, get } = await fixture(t);
  const p = db.rows("people")[0];
  const org = db.rows("organisations")[0];
  p.source.reference = "private-import-reference";
  p.legacyProductData = { secret: true };
  const snapshot = structuredClone(db.records);
  const result = await get("people");
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("cache-control"), "no-store");
  assert.equal(result.body.total, 1);
  const person = result.body.items[0];
  assert.equal(person.firstName, "Mary Ann");
  assert.equal(person.lastName, "van Buren");
  assert.equal(person.displayName, "Mary Ann van Buren");
  assert.equal(person.primaryEmail, "mary@example.com");
  assert.equal(person.sourceSystem, "public_enquiry");
  assert.deepEqual(person.currentOrganisations, [
    { organisation: { id: org.id, name: "Example Ltd" }, jobTitle: "Director" },
  ]);
  for (const field of [
    "_id",
    "source",
    "legacyProductData",
    "createdBy",
    "contactPoints",
    "recentEvents",
  ])
    assert.equal(field in person, false);
  const detail = await get(`people/${p.id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.contactPoints[0].value, "mary@example.com");
  assert.equal(detail.body.products[0].product.name, "Agency");
  assert.equal(detail.body.opportunities[0].id, db.rows("opportunities")[0].id);
  assert.equal(detail.body.recentEvents[0].message, "Please discuss a review.");
  assert.equal(
    detail.body.recentEvents[0].landingPage,
    "https://example.com/enquire",
  );
  assert.equal("workEmail" in detail.body.recentEvents[0], false);
  assert.deepEqual(db.records, snapshot, "GETs must not mutate persistence");
});

test("people searches literal names and email, paginates, excludes archived records and preserves historical names", async (t) => {
  const { db, get } = await fixture(t);
  const p = db.rows("people")[0];
  assert.equal((await get("people?search=VAN%20BUREN")).body.total, 1);
  assert.equal((await get("people?search=MARY%40example.com")).body.total, 1);
  assert.equal(
    (await get("people?search=%2E%2A")).body.total,
    0,
    "search is not an executable regex",
  );
  assert.equal((await get("people?limit=1&offset=1")).body.items.length, 0);
  delete p.lastName;
  delete p.displayName;
  p.firstName = "Prince";
  assert.equal((await get(`people/${p.id}`)).body.displayName, "Prince");
  assert.equal((await get(`people/${p.id}`)).body.lastName, undefined);
  p.archived = true;
  assert.equal((await get("people")).body.total, 0);
  assert.equal((await get(`people/${p.id}`)).status, 404);
});

test("organisations list/detail counts distinct current people and links opportunities and products", async (t) => {
  const { db, get } = await fixture(t);
  const org = db.rows("organisations")[0];
  const rel = db.rows("organisation_relationships")[0];
  db.rows("organisation_relationships").push({
    ...rel,
    id: generatePlatformId("orgrel"),
  });
  db.rows("organisation_relationships").push({
    ...rel,
    id: generatePlatformId("orgrel"),
    personId: generatePlatformId("person"),
    current: false,
  });
  const result = await get("organisations?search=EXAMPLE.COM");
  assert.equal(result.status, 200);
  assert.equal(result.body.total, 1);
  assert.equal(result.body.items[0].peopleCount, 1);
  assert.equal(result.body.items[0].opportunityCount, 1);
  const detail = await get(`organisations/${org.id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.people.length, 1);
  assert.equal(detail.body.people[0].id, db.rows("people")[0].id);
  assert.equal(detail.body.opportunities[0].product.id, productId);
  assert.equal(detail.body.products[0].product.id, productId);
  assert.equal((await get("organisations?search=nonexistent")).body.total, 0);
  db.rows("opportunities")[0].archived = true;
  assert.equal((await get("organisations")).body.items[0].opportunityCount, 0);
});

test("opportunities list/detail has commercial links and attribution without invented value or raw event data", async (t) => {
  const { db, get } = await fixture(t);
  const opportunity = db.rows("opportunities")[0];
  const event = db.rows("events")[0];
  event.payload.secret = "private";
  event.payload.name = "Historical submitted name";
  const result = await get(
    `opportunities?status=open&stage=enquiry&productId=${productId}`,
  );
  assert.equal(result.status, 200);
  assert.equal(result.body.total, 1);
  const o = result.body.items[0];
  assert.equal(o.product.name, "Agency");
  assert.equal(o.organisation.id, db.rows("organisations")[0].id);
  assert.equal(o.people[0].id, db.rows("people")[0].id);
  assert.equal(o.stage, "enquiry");
  assert.equal(o.status, "open");
  assert.equal(o.sourceSystem, "public_enquiry");
  assert.equal("estimatedValueMinor" in o, false);
  assert.equal("currency" in o, false);
  assert.ok(o.createdAt);
  assert.ok(o.updatedAt);
  const detail = await get(`opportunities/${opportunity.id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.enquiryEvents.length, 1);
  assert.equal(detail.body.enquiryEvents[0].source, "search");
  assert.equal(detail.body.enquiryEvents[0].campaign, "launch");
  assert.equal(detail.body.enquiryEvents[0].opportunityId, opportunity.id);
  for (const key of [
    "payload",
    "secret",
    "name",
    "workEmail",
    "marketingOptIn",
  ])
    assert.equal(key in detail.body.enquiryEvents[0], false);
  for (const filters of [
    "status=won",
    "stage=unknown",
    `productId=${generatePlatformId("product")}`,
  ])
    assert.equal((await get(`opportunities?${filters}`)).body.total, 0);
  opportunity.estimatedValueMinor = 0;
  opportunity.currency = "GBP";
  assert.equal(
    (await get(`opportunities/${opportunity.id}`)).body.estimatedValueMinor,
    0,
  );
  opportunity.estimatedValueMinor = 12500;
  assert.equal(
    (await get("opportunities")).body.items[0].estimatedValueMinor,
    12500,
  );
});

test("detail events are ordered and bounded; unrelated payloads and events are excluded", async (t) => {
  const { db, get } = await fixture(t);
  const event = db.rows("events")[0];
  for (let i = 0; i < 12; i++)
    db.rows("events").push({
      ...event,
      id: generatePlatformId("event"),
      occurredAt: new Date(
        `2027-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
      ),
    });
  db.rows("events").push({
    ...event,
    id: generatePlatformId("event"),
    eventType: "private_note",
    occurredAt: new Date("2028-01-01"),
    payload: { message: "private unrelated payload" },
  });
  const p = await get(`people/${db.rows("people")[0].id}`);
  assert.equal(p.body.recentEvents.length, 10);
  assert.equal(p.body.recentEvents[0].eventType, "private_note");
  assert.equal(p.body.recentEvents[0].message, undefined);
  const o = await get(`opportunities/${db.rows("opportunities")[0].id}`);
  assert.equal(o.body.enquiryEvents.length, 10);
  assert.equal(o.body.enquiryEvents[0].occurredAt, "2027-01-12T00:00:00.000Z");
});

test("missing CRM records return 404, invalid IDs/filters return 400, empty lists are usable", async (t) => {
  const { db, get } = await fixture(t, false);
  for (const [kind, prefix] of [
    ["people", "person"],
    ["organisations", "org"],
    ["opportunities", "opportunity"],
  ] as const) {
    assert.deepEqual((await get(kind)).body, {
      items: [],
      total: 0,
      limit: 50,
      offset: 0,
    });
    assert.equal(
      (await get(`${kind}/${generatePlatformId(prefix)}`)).status,
      404,
    );
    const calls = db.databaseCalls;
    assert.equal((await get(`${kind}/invalid`)).status, 400);
    assert.equal((await get(`${kind}?limit=101`)).status, 400);
    assert.equal((await get(`${kind}?offset=-1`)).status, 400);
    assert.equal((await get(`${kind}?search=${"x".repeat(201)}`)).status, 400);
    assert.equal(db.databaseCalls, calls);
  }
  for (const query of [
    "status=invented",
    "productId=bad",
    "stage=",
    "limit=1.5",
    "unknown=1",
  ])
    assert.equal((await get(`opportunities?${query}`)).status, 400);
});
