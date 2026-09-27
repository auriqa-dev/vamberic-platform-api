import assert from "node:assert/strict";
import { test } from "node:test";
import {
  WorkspaceIntegrationSchema,
  validateWorkspaceIntegrations,
  CrmWorkspaceSchema,
  generatePlatformId,
} from "../src/domain";
import { createAuthorizationAuthority } from "../src/authorization/policy";
import { ONBOARDING_MONGO_VALIDATORS } from "../src/db/onboarding-validators";
import { EnquiryMemoryDb } from "./helpers/enquiry-db";
const now = new Date("2026-09-27T12:00:00Z");
const later = new Date(now.getTime() + 1000);
const dates = { createdAt: now, updatedAt: now };
const workspace = CrmWorkspaceSchema.parse({
  ...dates,
  id: generatePlatformId("workspace"),
  name: "Client",
  kind: "client",
  clientOrganisationId: generatePlatformId("org"),
});
const connection = (provider = "odyssiant") =>
  WorkspaceIntegrationSchema.parse({
    ...dates,
    id: generatePlatformId("integration"),
    workspaceId: workspace.id,
    provider,
    displayName: "Account",
    externalAccountId: "account-one",
    status: "connected",
    connectedAt: now,
    secretReference:
      "arn:aws:secretsmanager:eu-west-2:755905325223:secret:hvm/example-ABC123",
  });
test("workspace integrations support generic Odyssiant and multiple accounts/connections per provider", async () => {
  const connections = [
    "odyssiant",
    "lusha",
    "postmark",
    "hubspot",
    "ga4",
    "google_ads",
    "linkedin",
    "future_provider",
    "google_ads",
  ].map(connection);
  validateWorkspaceIntegrations(connections, [workspace]);
  const db = new EnquiryMemoryDb();
  for (const record of connections)
    await db.collection("workspace_integrations").insertOne(record);
  await assert.rejects(
    db.collection("workspace_integrations").insertOne(connections[0]),
  );
  assert.equal(
    connections.filter((c) => c.provider === "google_ads").length,
    2,
  );
});
test("strict integration schema accepts secret references and excludes credentials, raw errors and arbitrary metadata", () => {
  const record = connection();
  assert.ok(record.secretReference?.startsWith("arn:aws:secretsmanager:"));
  for (const field of [
    "apiKey",
    "accessToken",
    "refreshToken",
    "clientSecret",
    "password",
    "credentials",
    "metadata",
    "error",
    "errorMessage",
    "requestHeaders",
  ])
    assert.equal(
      WorkspaceIntegrationSchema.safeParse({
        ...record,
        [field]: "sensitive-value",
      }).success,
      false,
    );
  for (const secretReference of [
    "raw-api-key",
    "https://user:password@example.test",
    "arn:aws:ssm:eu-west-2:755905325223:parameter/key",
    "arn:aws:secretsmanager:eu-west-2:755905325223:secret:key?token=secret",
  ])
    assert.equal(
      WorkspaceIntegrationSchema.safeParse({ ...record, secretReference })
        .success,
      false,
    );
  for (const patch of [
    { workspaceId: undefined },
    { provider: "Odyssiant" },
    { provider: "../../key" },
    { status: "syncing" },
    { errorCode: "raw failure containing secrets" },
    { scopes: ["read", "read"] },
  ])
    assert.equal(
      WorkspaceIntegrationSchema.safeParse({ ...record, ...patch }).success,
      false,
    );
  const schema =
    ONBOARDING_MONGO_VALIDATORS.workspace_integrations.$and[0].$jsonSchema;
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.metadata, undefined);
  assert.equal(schema.properties.apiKey, undefined);
});
test("disconnection is retained history, timestamp checks are enforced, and workspace references cannot drift", () => {
  const record = connection();
  const disconnected = WorkspaceIntegrationSchema.parse({
    ...record,
    status: "disconnected",
    disconnectedAt: later,
    updatedAt: later,
  });
  assert.equal(disconnected.workspaceId, workspace.id);
  assert.equal(disconnected.secretReference, record.secretReference);
  assert.notEqual(disconnected.status, "connected");
  validateWorkspaceIntegrations(
    [disconnected],
    [{ ...workspace, archived: true }],
  );
  assert.throws(() =>
    validateWorkspaceIntegrations([record], [{ ...workspace, archived: true }]),
  );
  assert.throws(() =>
    validateWorkspaceIntegrations(
      [record],
      [{ ...workspace, id: generatePlatformId("workspace") }],
    ),
  );
  for (const patch of [
    { status: "disconnected" },
    { disconnectedAt: now },
    { status: "pending" },
    { connectedAt: undefined },
    { lastSyncAt: later },
    { lastSuccessfulSyncAt: now },
    { updatedAt: new Date(0) },
    { archived: true },
    { lastSyncAt: new Date(0) },
    { lastSyncAt: now, lastSuccessfulSyncAt: later },
  ])
    assert.equal(
      WorkspaceIntegrationSchema.safeParse({ ...record, ...patch }).success,
      false,
    );
});
test("Vapp, wrong workspace, external account IDs and Partner memberships never bypass central authorization; workloads require grants", () => {
  const identity = {
    issuer: "https://identity.example.test",
    clientId: "hvm",
    subject: "tom",
  };
  const actor = {
    type: "human",
    issuer: identity.issuer,
    id: identity.subject,
  } as const;
  const humanClients = [
    {
      issuer: identity.issuer,
      clientId: "hvm",
      application: "hvmapp" as const,
    },
    { issuer: identity.issuer, clientId: "vapp", application: "vapp" as const },
  ];
  const resource = {
    type: "workspace_integrations",
    id: connection().id,
    workspaceId: workspace.id,
  } as const;
  const closed = createAuthorizationAuthority({ humanClients });
  const member = closed.authenticatedHuman(identity);
  assert.equal(closed.authorize(member, "read", resource), false);
  assert.equal(
    closed.authorize(
      closed.authenticatedHuman({ ...identity, clientId: "vapp" }),
      "read",
      resource,
    ),
    false,
  );
  assert.equal(
    closed.authorize(member, "read", { ...resource, id: "account-one" }),
    false,
  );
  const authority = createAuthorizationAuthority({
    humanClients,
    memberships: [
      {
        actor,
        application: "hvmapp",
        workspaceId: workspace.id,
        status: "active",
        role: "operator",
      },
    ],
  });
  const human = authority.authenticatedHuman(identity);
  assert.equal(authority.authorize(human, "read", resource), true);
  assert.equal(
    authority.authorize(human, "read", {
      ...resource,
      workspaceId: generatePlatformId("workspace"),
    }),
    false,
  );
  const service = { type: "system", id: "sync-worker" } as const;
  assert.throws(() => closed.service(service, "system"));
  const granted = createAuthorizationAuthority({
    humanClients,
    serviceGrants: [
      {
        actor: service,
        application: "system",
        resource: "workspace_integrations",
        action: "read",
        scope: { kind: "workspace", workspaceId: workspace.id },
      },
    ],
  });
  const context = granted.service(service, "system");
  assert.equal(granted.authorize(context, "read", resource), true);
  assert.equal(granted.authorize(context, "update", resource), false);
  assert.equal(
    granted.authorize(context, "read", {
      ...resource,
      workspaceId: generatePlatformId("workspace"),
    }),
    false,
  );
});
