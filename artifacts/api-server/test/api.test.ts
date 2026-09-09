import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/app";
import { parseConfig } from "../src/config";

const testConfig = parseConfig({
  NODE_ENV: "test",
  PORT: "5001",
  SERVICE_NAME: "test-api",
  API_VERSION: "test-version",
  CORS_ORIGINS: "http://localhost:3000",
  RATE_LIMIT_MAX_REQUESTS: "10",
});

async function requestHealth(path: string): Promise<{
  statusCode: number;
  headers: Headers;
  body: Record<string, string>;
}> {
  const server = createServer(createApp(testConfig));
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
      body: (await response.json()) as Record<string, string>,
    };
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("health endpoint returns safe service metadata", async () => {
  const response = await requestHealth("/api/v1/health");

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    status: "ok",
    serviceName: "test-api",
    environment: "test",
    version: "test-version",
    timestamp: response.body.timestamp,
  });
  assert.match(response.body.timestamp, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(response.headers.get("x-request-id"), "health-test");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
});

test("root health endpoint is available", async () => {
  const response = await requestHealth("/health");

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.status, "ok");
});

test("configuration rejects invalid values and wildcard CORS", () => {
  assert.throws(
    () => parseConfig({ PORT: "not-a-port" }),
    /PORT must be a number/,
  );
  assert.throws(
    () => parseConfig({ CORS_ORIGINS: "*" }),
    /CORS_ORIGINS must list explicit origins/,
  );
});