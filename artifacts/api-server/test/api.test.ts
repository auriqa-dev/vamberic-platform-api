import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/app";
import { parseConfig } from "../src/config";
import type { MongoService } from "../src/services/mongo";

const testConfig = parseConfig({
  NODE_ENV: "production",
  DEPLOYMENT_ENV: "dev",
  MONGODB_URI: "mongodb://user:password@private-host.example/test",
  PORT: "5001",
  SERVICE_NAME: "test-api",
  API_VERSION: "test-version",
  CORS_ORIGINS: "http://localhost:3000",
  RATE_LIMIT_MAX_REQUESTS: "10",
});

const availableMongo: MongoService = {
  isAvailable: async () => true,
  close: async () => undefined,
};

async function requestApi(
  path: string,
  mongo: MongoService = availableMongo,
): Promise<{
  statusCode: number;
  headers: Headers;
  body: Record<string, unknown>;
}> {
  const server = createServer(createApp(testConfig, mongo));
  server.listen(0);
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;

  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      headers: { "x-request-id": "health-test" },
    });

    return {
      statusCode: response.status,
      headers: response.headers,
      body: (await response.json()) as Record<string, unknown>,
    };
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("health endpoint returns safe service metadata", async () => {
  const response = await requestApi("/api/v1/health");

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    status: "ok",
    serviceName: "test-api",
    environment: "dev",
    runtimeMode: "production",
    version: "test-version",
    timestamp: response.body.timestamp,
  });
  assert.match(String(response.body.timestamp), /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(response.headers.get("x-request-id"), "health-test");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
});

test("root health endpoint is available", async () => {
  const response = await requestApi("/health");

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.status, "ok");
});

test("readiness returns 200 when MongoDB is available", async () => {
  const response = await requestApi("/api/v1/ready");

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    status: "ready",
    serviceName: "test-api",
    environment: "dev",
    dependencies: {
      mongodb: "available",
    },
    timestamp: response.body.timestamp,
  });
  assert.match(String(response.body.timestamp), /^\d{4}-\d{2}-\d{2}T/);
});

test("readiness returns a safe 503 when MongoDB is unavailable", async () => {
  const credential = "mongodb://secret-user:secret-password@private-host.example";
  const unavailableMongo: MongoService = {
    isAvailable: async () => {
      throw new Error(`Connection failed: ${credential}`);
    },
    close: async () => undefined,
  };

  const response = await requestApi("/ready", unavailableMongo);
  const serializedBody = JSON.stringify(response.body);

  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.body, {
    status: "unavailable",
    serviceName: "test-api",
    environment: "dev",
    dependencies: {
      mongodb: "unavailable",
    },
    timestamp: response.body.timestamp,
  });
  assert.doesNotMatch(serializedBody, /secret-user|secret-password|private-host/);
  assert.doesNotMatch(serializedBody, /Connection failed|mongodb:\/\//);
});

test("configuration rejects invalid values and wildcard CORS", () => {
  assert.throws(
    () => parseConfig({ NODE_ENV: "production" }),
    /Invalid application configuration: DEPLOYMENT_ENV/,
  );
  assert.throws(
    () => parseConfig({ DEPLOYMENT_ENV: "staging" }),
    /Invalid application configuration: DEPLOYMENT_ENV/,
  );
  assert.throws(
    () =>
      parseConfig({
        DEPLOYMENT_ENV: "local",
        MONGODB_URI: "mongodb://localhost:27017",
        PORT: "not-a-port",
      }),
    /Invalid application configuration: PORT/,
  );
  assert.throws(
    () =>
      parseConfig({
        DEPLOYMENT_ENV: "local",
        MONGODB_URI: "mongodb://localhost:27017",
        CORS_ORIGINS: "*",
      }),
    /CORS_ORIGINS must list explicit origins/,
  );
  assert.throws(
    () => parseConfig({ DEPLOYMENT_ENV: "local" }),
    /Invalid application configuration: MONGODB_URI/,
  );
  assert.throws(
    () =>
      parseConfig({
        DEPLOYMENT_ENV: "local",
        MONGODB_URI: "https://not-mongodb.example",
      }),
    /Invalid application configuration: MONGODB_URI/,
  );
});
