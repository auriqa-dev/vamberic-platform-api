import {
  submitPublicEnquiry,
  getPersonDeletePreview,
  getOrganisationDeletePreview,
  getOpportunityDeletePreview,
  deletePerson,
  deleteOrganisation,
  deleteOpportunity,
} from "../src/generated/api";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  customFetch,
  setBaseUrl,
  setAuthTokenGetter,
  setUnauthorizedHandler,
  AuthenticationRequiredError,
} from "../src/custom-fetch";

test("shared fetch attaches tokens only to the configured API, and safely handles 401", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Headers[] = [];
  let invalidations = 0;
  let status = 200;
  setBaseUrl("https://api.example");
  setAuthTokenGetter(async () => "test-access-token");
  setUnauthorizedHandler(() => {
    invalidations++;
  });
  globalThis.fetch = async (_input, init) => {
    requests.push(new Headers(init?.headers));
    return new Response(JSON.stringify({ error: "private verifier detail" }), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    await customFetch("/api/v1/products");
    assert.equal(requests[0].get("authorization"), "Bearer test-access-token");
    await customFetch("https://other.example/api/v1/products");
    assert.equal(requests[1].get("authorization"), null);
    status = 401;
    await assert.rejects(customFetch("/api/v1/products"), (error) => {
      assert.ok(error instanceof AuthenticationRequiredError);
      assert.equal(error.message, "Please sign in to continue.");
      return true;
    });
    assert.equal(invalidations, 1);
    setAuthTokenGetter(() => null);
    await assert.rejects(
      customFetch("/api/v1/products"),
      AuthenticationRequiredError,
    );
    assert.equal(
      requests.length,
      3,
      "no unauthenticated request should be sent",
    );
  } finally {
    globalThis.fetch = originalFetch;
    setBaseUrl(null);
    setAuthTokenGetter(null);
    setUnauthorizedHandler(null);
  }
});

test("generated public enquiry client sends no token or cookies even when Vapp auth is configured", async () => {
  const originalFetch = globalThis.fetch;
  let authCalls = 0;
  let captured: RequestInit | undefined;
  setBaseUrl("https://api.example");
  setAuthTokenGetter(() => {
    authCalls++;
    return null;
  });
  globalThis.fetch = async (_input, init) => {
    captured = init;
    return new Response(
      JSON.stringify({
        status: "received",
        enquiryId: "event_00000000000000000000000001",
      }),
      { status: 201, headers: { "content-type": "application/json" } },
    );
  };
  try {
    await submitPublicEnquiry(
      "product_00000000000000000000000001",
      {
        firstName: "Ada",
        lastName: "Lovelace",
        workEmail: "ada@example.com",
        company: "Example",
        message: "Hello",
      },
      {
        headers: { authorization: "Bearer should-not-be-sent" },
        credentials: "include",
      },
    );
    assert.equal(authCalls, 0);
    assert.equal(new Headers(captured?.headers).get("authorization"), null);
    assert.equal(captured?.credentials, "omit");
    await assert.rejects(
      customFetch("/api/v1/products"),
      AuthenticationRequiredError,
    );
    assert.equal(authCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    setBaseUrl(null);
    setAuthTokenGetter(null);
  }
});

test("generated CRM preview and DELETE operations retain private auth and send explicit confirmation JSON", async () => {
  const originalFetch = globalThis.fetch;
  const requests: { url: string; init?: RequestInit }[] = [];
  setBaseUrl("https://api.example");
  setAuthTokenGetter(() => "test-access-token");
  const previewToken = "a".repeat(64);
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify({ previewToken }), {
      headers: { "content-type": "application/json" },
    });
  };
  try {
    for (const [plural, prefix, preview, remove] of [
      ["people", "person", getPersonDeletePreview, deletePerson],
      [
        "organisations",
        "org",
        getOrganisationDeletePreview,
        deleteOrganisation,
      ],
      [
        "opportunities",
        "opportunity",
        getOpportunityDeletePreview,
        deleteOpportunity,
      ],
    ] as const) {
      const id = prefix + "_00000000000000000000000001";
      const result = await preview(id);
      await remove(id, {
        confirm: "DELETE",
        previewToken: result.previewToken,
      });
      const [read, deleted] = requests.slice(-2);
      assert.equal(
        read.url,
        `https://api.example/api/v1/${plural}/${id}/delete-preview`,
      );
      assert.equal(read.init?.method, "GET");
      assert.equal(deleted.url, `https://api.example/api/v1/${plural}/${id}`);
      assert.equal(deleted.init?.method, "DELETE");
      assert.deepEqual(JSON.parse(String(deleted.init?.body)), {
        confirm: "DELETE",
        previewToken,
      });
      for (const request of [read, deleted])
        assert.equal(
          new Headers(request.init?.headers).get("authorization"),
          "Bearer test-access-token",
        );
    }
    setAuthTokenGetter(() => null);
    await assert.rejects(
      deletePerson("person_00000000000000000000000001", {
        confirm: "DELETE",
        previewToken,
      }),
      AuthenticationRequiredError,
    );
    assert.equal(requests.length, 6);
  } finally {
    globalThis.fetch = originalFetch;
    setBaseUrl(null);
    setAuthTokenGetter(null);
  }
});
