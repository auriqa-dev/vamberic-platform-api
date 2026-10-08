import assert from "node:assert/strict";
import { test } from "node:test";
import { generateKeyPair, SignJWT } from "jose";
import { randomUUID } from "node:crypto";
import type { Request } from "express";
import { createCognitoWorkloadAuthentication } from "../src/authorization/agent-workload-cognito";
const keys = await generateKeyPair("RS256");
const config = {
  environment: "dev" as const,
  issuer: "https://cognito-idp.eu-west-2.amazonaws.com/eu-west-2_test",
  clientId: "machine",
  resourceServer: "vamberic-dev-agent-runtime",
};
async function token(overrides: Record<string, unknown> = {}) {
  return new SignJWT({
    token_use: "access",
    client_id: "machine",
    scope:
      "vamberic-dev-agent-runtime/claim vamberic-dev-agent-runtime/heartbeat",
    ...overrides,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setIssuer(config.issuer)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(keys.privateKey);
}
const request = (bearer: string, worker: unknown = `worker:${randomUUID()}`) =>
  ({
    headers: { authorization: `Bearer ${bearer}`, "x-agent-worker-id": worker },
  }) as unknown as Request;
test("verified class token and session issue a principal with only verified scopes", async () => {
  const auth = createCognitoWorkloadAuthentication(
    config,
    async () => keys.publicKey,
  );
  const principal = await auth.authenticate(request(await token()));
  auth.authority.require(principal, "claim");
  assert.throws(() => auth.authority.require(principal, "outcome"));
  assert.throws(() => auth.authority.require({ ...principal }, "claim"));
});
for (const [name, overrides] of [
  ["human client", { client_id: "browser" }],
  ["ID token", { token_use: "id" }],
  ["other environment", { scope: "vamberic-prod-agent-runtime/claim" }],
  ["human scope", { scope: "openid" }],
  [
    "duplicate scope",
    {
      scope:
        "vamberic-dev-agent-runtime/claim vamberic-dev-agent-runtime/claim",
    },
  ],
] as const)
  test(`rejects ${name}`, async () => {
    const auth = createCognitoWorkloadAuthentication(
      config,
      async () => keys.publicKey,
    );
    await assert.rejects(auth.authenticate(request(await token(overrides))));
  });
test("session header never authenticates; malformed session and wrong signer fail closed", async () => {
  const auth = createCognitoWorkloadAuthentication(
    config,
    async () => keys.publicKey,
  );
  for (const value of [
    undefined,
    "worker",
    ["worker:a", "worker:b"],
    "worker:" + "a".repeat(100),
  ])
    await assert.rejects(
      auth.authenticate(
        request(await token(), value === undefined ? null : value),
      ),
    );
  await assert.rejects(auth.authenticate(request("invalid")));
  const other = await generateKeyPair("RS256");
  const wrong = createCognitoWorkloadAuthentication(
    config,
    async () => other.publicKey,
  );
  await assert.rejects(wrong.authenticate(request(await token())));
});
test("wrong issuer and expired or future-issued tokens fail closed", async () => {
  const auth = createCognitoWorkloadAuthentication(
    config,
    async () => keys.publicKey,
  );
  for (const claims of [
    { iss: "https://other.example", iat: 1, exp: 9999999999 },
    { iss: config.issuer, iat: 1, exp: 2 },
    { iss: config.issuer, iat: 9999999998, exp: 9999999999 },
  ]) {
    const bearer = await new SignJWT({
      ...claims,
      token_use: "access",
      client_id: "machine",
      scope: "vamberic-dev-agent-runtime/claim",
    })
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .sign(keys.privateKey);
    await assert.rejects(auth.authenticate(request(bearer)));
  }
});
