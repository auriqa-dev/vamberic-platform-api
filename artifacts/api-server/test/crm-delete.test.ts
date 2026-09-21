import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test, type TestContext } from "node:test";
import { createApp } from "../src/app";
import { parseConfig } from "../src/config";
import {
  ProductSchema,
  generatePlatformId,
  MarketingPermissionSchema,
} from "../src/domain";
import {
  previewCrmDelete,
  hardDeleteCrm,
  type DeleteKind,
} from "../src/services/crm-delete";
import { EnquiryMemoryDb } from "./helpers/enquiry-db";
import { authEnvironment, createTestAuth } from "./helpers/auth";

const productId = "product_00000000000000000000000001";
async function fixture(t: TestContext, optIn = false) {
  const db = new EnquiryMemoryDb();
  const now = new Date();
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
  const server = createServer(
    createApp(
      parseConfig({
        ...authEnvironment,
        DEPLOYMENT_ENV: "test",
        MONGODB_URI: "mongodb://unused.invalid",
        PUBLIC_ENQUIRY_RATE_LIMIT_MAX_REQUESTS: "20",
      }),
      db.mongo,
      { jwtKeyResolver: auth.keyResolver },
    ),
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.close();
    await once(server, "close");
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const response = await fetch(
    `${url}/api/v1/public/products/${productId}/enquiries`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        firstName: "Private",
        lastName: "Contact",
        workEmail: "private@example.com",
        company: "Private Company",
        website: "example.com",
        message: "private enquiry body",
        ...(optIn
          ? {
              marketingOptIn: true,
              marketingConsentText: "Example consent",
              marketingConsentVersion: "1",
            }
          : {}),
      }),
    },
  );
  assert.equal(response.status, 201);
  await response.arrayBuffer();
  const token = await auth.sign();
  const request = async (
    path: string,
    method = "GET",
    body?: unknown,
    authenticated = true,
  ) => {
    const r = await fetch(`${url}/api/v1/${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(authenticated ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: r.status, body: await r.json() };
  };
  const ids = {
    people: db.rows("people")[0].id as string,
    organisations: db.rows("organisations")[0].id as string,
    opportunities: db.rows("opportunities")[0].id as string,
  };
  const preview = (kind: keyof typeof ids) =>
    request(`${kind}/${ids[kind]}/delete-preview`);
  const remove = async (kind: keyof typeof ids) => {
    const p = await preview(kind);
    return request(`${kind}/${ids[kind]}`, "DELETE", {
      confirm: "DELETE",
      previewToken: p.body.previewToken,
    });
  };
  return { db, request, ids, preview, remove };
}
const counts = (groups: { collection: string; count: number }[]) =>
  Object.fromEntries(groups.map((g) => [g.collection, g.count]));

test("all delete/preview routes require Cognito and have no public counterpart", async (t) => {
  const { db, request, ids } = await fixture(t);
  const before = db.databaseCalls;
  for (const [kind, id] of Object.entries(ids)) {
    assert.equal(
      (
        await request(
          `${kind}/${id}`,
          "DELETE",
          { confirm: "DELETE", previewToken: "a".repeat(64) },
          false,
        )
      ).status,
      401,
    );
    assert.equal(
      (await request(`${kind}/${id}/delete-preview`, "GET", undefined, false))
        .status,
      401,
    );
    assert.equal(
      (await request(`public/${kind}/${id}`, "DELETE", undefined, false))
        .status,
      404,
    );
    assert.equal(
      (
        await request(
          `public/${kind}/${id}/delete-preview`,
          "GET",
          undefined,
          false,
        )
      ).status,
      404,
    );
  }
  assert.equal(db.databaseCalls, before);
  assert.equal(db.rows("people").length, 1);
});

test("bare, wrong and incomplete confirmation fail before any transaction", async (t) => {
  const { db, request, ids } = await fixture(t);
  const before = db.attempts;
  for (const kind of Object.keys(ids) as (keyof typeof ids)[]) {
    for (const body of [
      undefined,
      {},
      { confirm: "delete", previewToken: "a".repeat(64) },
      { confirm: "DELETE" },
      { confirm: "DELETE", previewToken: "a".repeat(64), cascade: true },
    ])
      assert.equal(
        (await request(`${kind}/${ids[kind]}`, "DELETE", body)).status,
        400,
      );
  }
  assert.equal(db.attempts, before);
});

test("missing records return 404 and malformed IDs return 400 for preview and delete", async (t) => {
  const { request } = await fixture(t);
  for (const [kind, prefix] of [
    ["people", "person"],
    ["organisations", "org"],
    ["opportunities", "opportunity"],
  ] as const) {
    const id = generatePlatformId(prefix);
    assert.equal((await request(`${kind}/${id}/delete-preview`)).status, 404);
    assert.equal(
      (
        await request(`${kind}/${id}`, "DELETE", {
          confirm: "DELETE",
          previewToken: "a".repeat(64),
        })
      ).status,
      404,
    );
    assert.equal((await request(`${kind}/invalid/delete-preview`)).status, 400);
  }
});

test("preview is read-only and exposes only target/dependency IDs and counts", async (t) => {
  const { db, preview } = await fixture(t);
  const p = await preview("people");
  assert.equal(p.status, 200);
  assert.deepEqual(counts(p.body.willDelete), {
    events: 1,
    opportunities: 1,
    product_relationships: 1,
    organisation_relationships: 1,
    contact_points: 1,
    people: 1,
  });
  assert.deepEqual(p.body.blockedBy, []);
  assert.match(p.body.previewToken, /^[a-f0-9]{64}$/);
  const before = structuredClone(db.records);
  assert.deepEqual((await preview("people")).body, p.body);
  assert.deepEqual(db.records, before);
  for (const secret of [
    "Private",
    "private@example.com",
    "private enquiry body",
    "example.com",
    "_id",
  ])
    assert.equal(JSON.stringify(p.body).includes(secret), false);
});

test("opportunity delete removes only its enquiry event and preserves subjects, Product and unrelated events", async (t) => {
  const { db, preview, remove } = await fixture(t);
  const unrelated = {
    ...db.rows("events")[0],
    id: generatePlatformId("event"),
    eventType: "page_view",
    payload: {},
  };
  db.rows("events").push(unrelated);
  assert.deepEqual(counts((await preview("opportunities")).body.willDelete), {
    events: 1,
    opportunities: 1,
  });
  assert.equal((await remove("opportunities")).status, 200);
  assert.deepEqual(db.rows("events"), [unrelated]);
  assert.equal(db.rows("opportunities").length, 0);
  for (const collection of [
    "people",
    "organisations",
    "products",
    "contact_points",
    "organisation_relationships",
    "product_relationships",
  ])
    assert.equal(db.rows(collection).length, 1, collection);
});

test("person cascade removes safe dependencies including explicitly test permissions and preserves organisation", async (t) => {
  const { db, ids, preview, remove } = await fixture(t, true);
  db.rows("marketing_permissions")[0].source.system = "test";
  const p = await preview("people");
  assert.equal(counts(p.body.willDelete).marketing_permissions, 1);
  assert.equal((await remove("people")).status, 200);
  for (const collection of [
    "people",
    "contact_points",
    "organisation_relationships",
    "product_relationships",
    "marketing_permissions",
    "opportunities",
    "events",
  ])
    assert.equal(db.rows(collection).length, 0, collection);
  assert.equal(db.rows("organisations")[0].id, ids.organisations);
  assert.equal(db.rows("products").length, 1);
});

test("organisation cascade preserves People and contacts and removes its relations and enquiries", async (t) => {
  const { db, preview, remove } = await fixture(t);
  assert.deepEqual(counts((await preview("organisations")).body.willDelete), {
    events: 1,
    opportunities: 1,
    product_relationships: 1,
    organisation_relationships: 1,
    organisations: 1,
  });
  assert.equal((await remove("organisations")).status, 200);
  for (const collection of [
    "organisations",
    "opportunities",
    "events",
    "organisation_relationships",
    "product_relationships",
  ])
    assert.equal(db.rows(collection).length, 0);
  for (const collection of ["people", "contact_points", "products"])
    assert.equal(db.rows(collection).length, 1);
});

test("normal public opt-in consent blocks all cascades that would erase its subject or evidence", async (t) => {
  const { db, preview, remove } = await fixture(t, true);
  for (const kind of ["people", "organisations", "opportunities"] as const) {
    const p = await preview(kind);
    assert.ok(
      p.body.blockedBy.some(
        (b: { code: string }) => b.code === "CONSENT_HISTORY",
      ),
    );
    const before = structuredClone(db.records);
    const result = await remove(kind);
    assert.equal(result.status, 409);
    assert.equal(result.body.error.code, "DELETE_BLOCKED");
    assert.deepEqual(db.records, before);
  }
});

for (const [collection, prefix, status] of [
  ["transactions", "transaction", "completed"],
  ["transactions", "transaction", "refunded"],
  ["subscriptions", "subscription", "active"],
  ["subscriptions", "subscription", "ended"],
  ["entitlements", "entitlement", "active"],
  ["entitlements", "entitlement", "revoked"],
] as const) {
  test(`${collection} ${status} history blocks person, organisation and enquiry deletion even when archived`, async (t) => {
    const { db, ids, remove } = await fixture(t);
    db.rows(collection).push({
      id: generatePlatformId(prefix),
      personId: ids.people,
      organisationId: ids.organisations,
      status,
      archived: true,
    });
    for (const kind of ["people", "organisations", "opportunities"] as const)
      assert.equal((await remove(kind)).status, 409);
    assert.equal(db.rows("people").length, 1);
    assert.equal(db.rows("opportunities").length, 1);
  });
}

test("customer relationships, customer organisations and valued/won opportunities block deletion", async (t) => {
  const { db, remove } = await fixture(t);
  db.rows("product_relationships")[0].status = "customer";
  assert.equal((await remove("people")).status, 409);
  db.rows("product_relationships")[0].status = "engaged";
  db.rows("organisations")[0].type = "customer";
  assert.equal((await remove("organisations")).status, 409);
  db.rows("organisations")[0].type = "prospect";
  db.rows("opportunities")[0].estimatedValueMinor = 0;
  assert.equal((await remove("opportunities")).status, 409);
  delete db.rows("opportunities")[0].estimatedValueMinor;
  db.rows("opportunities")[0].status = "won";
  assert.equal((await remove("people")).status, 409);
});

test("shared opportunities and lifecycle events block destructive cascades", async (t) => {
  const { db, preview, remove } = await fixture(t);
  db.rows("opportunities")[0].personIds.push(generatePlatformId("person"));
  assert.ok(
    (await preview("people")).body.blockedBy.some(
      (b: { code: string }) => b.code === "SHARED_OPPORTUNITY",
    ),
  );
  assert.equal((await remove("people")).status, 409);
  db.rows("opportunities")[0].personIds.pop();
  db.rows("events")[0].eventType = "customer_created";
  for (const kind of ["people", "organisations", "opportunities"] as const)
    assert.equal((await remove(kind)).status, 409);
});

test("retained permission supersession references and evidence-only references block deletion", async (t) => {
  const { db, remove } = await fixture(t, true);
  const permission = db.rows("marketing_permissions")[0];
  permission.source.system = "test";
  db.rows("marketing_permissions").push(
    MarketingPermissionSchema.parse({
      ...permission,
      id: generatePlatformId("permission"),
      personId: generatePlatformId("person"),
      contactPointId: undefined,
      evidence: undefined,
      source: { system: "manual" },
      supersedesPermissionId: permission.id,
    }),
  );
  assert.equal((await remove("people")).status, 409);
  db.rows("marketing_permissions").pop();
  const restoredPermission = db.rows("marketing_permissions")[0];
  restoredPermission.source.system = "manual";
  restoredPermission.personId = generatePlatformId("person");
  delete restoredPermission.contactPointId;
  assert.equal((await remove("opportunities")).status, 409);
});

test("changed dependencies require a fresh preview and new blockers are checked inside the delete transaction", async (t) => {
  const { db, ids, request, preview } = await fixture(t);
  const p = await preview("people");
  db.rows("opportunities")[0].name = "Changed";
  const changed = await request(`people/${ids.people}`, "DELETE", {
    confirm: "DELETE",
    previewToken: p.body.previewToken,
  });
  assert.equal(changed.status, 409);
  assert.equal(changed.body.error.code, "PREVIEW_CHANGED");
  db.rows("transactions").push({
    id: generatePlatformId("transaction"),
    personId: ids.people,
    status: "completed",
  });
  const blocked = await request(`people/${ids.people}`, "DELETE", {
    confirm: "DELETE",
    previewToken: p.body.previewToken,
  });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error.code, "DELETE_BLOCKED");
  assert.equal(db.rows("people").length, 1);
});

for (const [kind, collection] of [
  ["people", "people"],
  ["organisations", "organisations"],
  ["opportunities", "opportunities"],
] as const) {
  test(`${kind} delete failure rolls back already deleted dependent records`, async (t) => {
    const { db, preview, remove } = await fixture(t);
    await preview(kind);
    const before = structuredClone(db.records);
    db.failDeleteCollection = collection;
    const result = await remove(kind);
    assert.equal(result.status, 503);
    assert.deepEqual(db.records, before);
    assert.equal(
      JSON.stringify(result.body).includes("private@example.com"),
      false,
    );
  });
}

test("no transaction support has no fallback and audit success/failure contains only safe identifiers and counts", async (t) => {
  const { db, ids, request } = await fixture(t);
  const entries: Record<string, unknown>[] = [];
  const audit = {
    info(fields: Record<string, unknown>) {
      entries.push(fields);
    },
    warn(fields: Record<string, unknown>) {
      entries.push(fields);
    },
  };
  const p = await previewCrmDelete(db.mongo, "person", ids.people);
  await hardDeleteCrm(
    db.mongo,
    "person",
    ids.people,
    p.previewToken,
    "authenticated-actor",
    audit,
  );
  assert.equal(entries[0].actorSubject, "authenticated-actor");
  assert.equal(entries[0].recordId, ids.people);
  assert.equal(entries[0].code, "DELETED");
  assert.deepEqual(entries[0].deletedCounts, counts(p.willDelete));
  assert.ok(entries[0].timestamp);
  await assert.rejects(
    hardDeleteCrm(
      db.mongo,
      "person",
      ids.people,
      p.previewToken,
      "authenticated-actor",
      audit,
    ),
  );
  assert.equal(entries[1].code, "RECORD_NOT_FOUND");
  for (const secret of [
    "Private",
    "private@example.com",
    "private enquiry body",
    "example.com",
  ])
    assert.equal(JSON.stringify(entries).includes(secret), false);
  db.mongo.withTransaction = undefined;
  assert.equal(
    (await request(`organisations/${ids.organisations}/delete-preview`)).status,
    503,
  );
  assert.equal(
    (
      await request(`organisations/${ids.organisations}`, "DELETE", {
        confirm: "DELETE",
        previewToken: "a".repeat(64),
      })
    ).status,
    503,
  );
  assert.equal(db.rows("organisations").length, 1);
});

test("commit failure rolls back deletion and produces no successful audit", async (t) => {
  const { db, ids } = await fixture(t);
  const kind: DeleteKind = "person";
  const p = await previewCrmDelete(db.mongo, kind, ids.people);
  const before = structuredClone(db.records);
  const original = db.mongo.withTransaction!;
  db.mongo.withTransaction = (work) =>
    original(async (database, session) => {
      await work(database, session);
      throw new Error("commit failed");
    });
  const entries: string[] = [];
  const audit = {
    info() {
      entries.push("success");
    },
    warn() {
      entries.push("failure");
    },
  };
  await assert.rejects(
    hardDeleteCrm(db.mongo, kind, ids.people, p.previewToken, "actor", audit),
  );
  assert.deepEqual(db.records, before);
  assert.deepEqual(entries, ["failure"]);
});
