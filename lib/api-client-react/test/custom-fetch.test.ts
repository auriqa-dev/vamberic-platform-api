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
