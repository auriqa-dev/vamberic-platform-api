import express from "express";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { createApp } from "../src/app";
import { parseConfig } from "../src/config";
import { authenticate } from "../src/middlewares/auth";
import { authEnvironment, createTestAuth, testIssuer } from "./helpers/auth";

const environment = {
  ...authEnvironment,
  DEPLOYMENT_ENV: "test",
  MONGODB_URI: "mongodb://unused.example/test",
};

test("Cognito configuration is required in every environment", () => {
  for (const deployment of ["local", "test", "dev", "prod"]) {
    assert.throws(
      () =>
        parseConfig({
          ...environment,
          DEPLOYMENT_ENV: deployment,
          COGNITO_CLIENT_ID: undefined,
        }),
      /COGNITO_CLIENT_ID/,
    );
  }
  assert.throws(
    () => parseConfig({ ...environment, AWS_REGION: "us-east-1" }),
    /pool region/,
  );
  assert.equal(parseConfig(environment).cognito.issuer, testIssuer);
});

test("business routes require verified Cognito access tokens; public probes do not", async () => {
  const auth = await createTestAuth();
  const config = parseConfig(environment);
  let databaseCalls = 0;
  const app = createApp(
    config,
    {
      isAvailable: async () => true,
      database: async () => {
        databaseCalls++;
        throw new Error("No database in authentication tests");
      },
      close: async () => undefined,
    },
    { jwtKeyResolver: auth.keyResolver },
  );
  // Test-only protected route exposes context; no production introspection route.
  const harness = express();
  harness.get(
    "/test-context",
    authenticate(config.cognito, auth.keyResolver),
    (req, res) => res.json(req.auth),
  );
  harness.use(app);
  const server = createServer(harness);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const rejected = async (
    token?: string,
    path = "/api/v1/products",
    method = "GET",
  ) => {
    const response = await fetch(base + path, {
      method,
      headers: {
        origin: "http://localhost:3000",
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      },
    });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "Unauthorized" });
    assert.equal(response.headers.get("www-authenticate"), "Bearer");
    assert.equal(
      response.headers.get("access-control-allow-origin"),
      "http://localhost:3000",
    );
  };
  try {
    for (const [path, method] of [
      ["/api/v1/dashboard/summary", "GET"],
      ["/api/v1/products", "GET"],
      ["/api/v1/products", "POST"],
      ["/api/v1/products/example", "GET"],
      ["/api/v1/products/example", "PATCH"],
      ["/api/v1/future-route", "GET"],
    ])
      await rejected(undefined, path, method);
    await rejected("malformed");
    await rejected(await auth.sign({ exp: Math.floor(Date.now() / 1000) - 1 }));
    await rejected(await auth.sign({ iss: "https://wrong.example" }));
    await rejected(await auth.sign({ client_id: "wrong-client" }));
    // aud cannot substitute for client_id on an access token.
    await rejected(
      await auth.sign({
        client_id: undefined,
        aud: authEnvironment.COGNITO_CLIENT_ID,
      }),
    );
    for (const aud of [authEnvironment.COGNITO_CLIENT_ID, "wrong-client"]) {
      await rejected(await auth.sign({ token_use: "id", aud }));
    }
    await rejected(await auth.sign({ exp: undefined }));
    await rejected(await auth.sign({ sub: "" }));
    await rejected(
      await auth.sign({ iat: Math.floor(Date.now() / 1000) + 600 }),
    );
    await rejected(
      await auth.sign({ nbf: Math.floor(Date.now() / 1000) + 600 }),
    );
    const foreign = await createTestAuth();
    await rejected(await foreign.sign());
    assert.equal(databaseCalls, 0);
    for (const path of [
      "/health",
      "/ready",
      "/api/v1/health",
      "/api/v1/ready",
    ]) {
      const response = await fetch(base + path);
      assert.equal(response.status, 200, path);
    }
    // Known-invalid ID is now processed by the business route, proving auth passed.
    const allowed = await fetch(base + "/api/v1/products/invalid", {
      headers: { authorization: `Bearer ${await auth.sign()}` },
    });
    assert.equal(allowed.status, 400);
    const context = await fetch(base + "/test-context", {
      headers: { authorization: `Bearer ${await auth.sign()}` },
    });
    assert.equal(context.status, 200);
    assert.deepEqual(await context.json(), {
      subject: "test-user-subject",
      issuer: testIssuer,
      clientId: authEnvironment.COGNITO_CLIENT_ID,
    });
  } finally {
    server.close();
    await once(server, "close");
  }
});
