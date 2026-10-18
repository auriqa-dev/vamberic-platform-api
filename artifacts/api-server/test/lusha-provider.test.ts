import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createLushaProvider,
  acceptedLushaEmail,
  LushaFailure,
} from "../src/services/lusha/provider";
import { verifyLushaMatch } from "../src/services/research/candidate-policy";
const candidate = {
  firstName: "Alex",
  lastName: "Smith",
  domain: "example.org",
};
const contact = {
  id: "p1",
  firstName: "Alex",
  lastName: "Smith",
  company: { domain: "www.example.org" },
  emails: [{ email: "alex@example.org", type: "work", confidence: "A+" }],
};
test("only an exact A+ business email on a matching identity can be promoted", () => {
  assert.equal(
    verifyLushaMatch(candidate, contact).email?.email,
    "alex@example.org",
  );
  for (const confidence of ["A", null, undefined, "verified"])
    assert.equal(
      acceptedLushaEmail({
        ...contact,
        emails: [{ ...contact.emails[0]!, confidence }],
      }),
      null,
    );
  assert.equal(
    acceptedLushaEmail({
      ...contact,
      emails: [{ ...contact.emails[0]!, type: "private" }],
    }),
    null,
  );
  assert.equal(
    acceptedLushaEmail({
      ...contact,
      emails: [{ ...contact.emails[0]!, dataSource: "other" }],
    }),
    null,
  );
  assert.equal(
    verifyLushaMatch(candidate, {
      ...contact,
      company: { domain: "other.org" },
    }).email,
    null,
  );
  assert.equal(
    verifyLushaMatch(candidate, { ...contact, firstName: "Someone" }).email,
    null,
  );
});
test("reveal requests only email and disables external waterfall; usage is actual or unknown", async () => {
  let body: Record<string, unknown> = {};
  const api = createLushaProvider(async (url, init) => {
    assert.equal(url, "https://api.lusha.com/v3/contacts/enrich");
    assert.equal((init?.headers as Record<string, string>).api_key, "test-key");
    body = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({ results: [contact], billing: { creditsCharged: 2 } }),
    );
  });
  assert.equal((await api.enrich("test-key", "p1")).creditsCharged, 2);
  assert.deepEqual(body, {
    ids: ["p1"],
    reveal: ["emails"],
    waterfallEnabled: false,
  });
  const unknown = createLushaProvider(
    async () => new Response(JSON.stringify({ results: [] })),
  );
  assert.equal(
    (
      await unknown.search("test-key", {
        firstName: candidate.firstName,
        lastName: candidate.lastName,
        companyDomain: candidate.domain,
      })
    ).creditsCharged,
    null,
  );
});
test("network uncertainty does not retry and raw provider errors never escape", async () => {
  let calls = 0;
  const api = createLushaProvider(async () => {
    calls++;
    throw new Error("sensitive-provider-text");
  });
  await assert.rejects(
    api.enrich("test-key", "p1"),
    (e: unknown) =>
      e instanceof LushaFailure &&
      e.chargeUnknown &&
      !e.message.includes("sensitive"),
  );
  assert.equal(calls, 1);
  const denied = createLushaProvider(
    async () => new Response("sensitive-provider-text", { status: 401 }),
  );
  await assert.rejects(
    denied.usage("test-key"),
    (e: unknown) =>
      e instanceof LushaFailure && e.code === "invalid_credentials",
  );
});
