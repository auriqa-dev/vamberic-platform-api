import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createAuthorizationAuthority,
  RESOURCES,
  AuthorizationDenied,
  type AuthorizationContext,
  type WorkspaceMembership,
  type ServiceGrant,
} from "../src/authorization/policy";
import { generatePlatformId } from "../src/domain/ids";

const identity = {
  issuer: "trusted-issuer",
  clientId: "vapp-client",
  subject: "human-1",
};
const actor = {
  type: "human",
  id: identity.subject,
  issuer: identity.issuer,
} as const;
const clients = [
  { issuer: identity.issuer, clientId: identity.clientId, application: "vapp" },
  { issuer: identity.issuer, clientId: "hvm-client", application: "hvmapp" },
  {
    issuer: identity.issuer,
    clientId: "product-client",
    application: "product:example",
  },
] as const;
const workspaceId = generatePlatformId("workspace");
const otherWorkspace = generatePlatformId("workspace");
const member: WorkspaceMembership = {
  actor,
  application: "hvmapp",
  workspaceId,
  status: "active",
  role: "operator",
};

test("Vapp explicitly authorizes internal resources and denies every workspace operation", () => {
  const authority = createAuthorizationAuthority({
    humanClients: clients,
    memberships: [member],
  });
  const vapp = authority.authenticatedHuman(identity);
  for (const type of RESOURCES)
    for (const action of [
      "read",
      "create",
      "update",
      "delete",
      "delete-preview",
    ] as const) {
      assert.equal(authority.authorize(vapp, action, { type }), true);
      assert.equal(
        authority.authorize(vapp, action, { type, workspaceId }),
        false,
      );
      assert.throws(
        () => authority.scopeFilter(vapp, action, { type, workspaceId }),
        AuthorizationDenied,
      );
    }
  assert.deepEqual(authority.scopeFilter(vapp, "read", { type: "people" }), {
    workspaceId: { $exists: false },
  });
  for (const invalid of [null, "", "arbitrary"])
    assert.equal(
      authority.authorize(vapp, "read", {
        type: "people",
        workspaceId: invalid as unknown as string,
      }),
      false,
    );
});

test("HVM membership requires exact active actor, issuer, workspace and application; absence is not global", () => {
  for (const membership of [
    member,
    { ...member, status: "inactive" },
    { ...member, workspaceId: otherWorkspace },
    { ...member, application: "vapp" },
    { ...member, actor: { ...actor, issuer: "other-issuer" } },
    { ...member, actor: { ...actor, id: "another-human" } },
  ] as WorkspaceMembership[]) {
    const authority = createAuthorizationAuthority({
      humanClients: clients,
      memberships: [membership],
    });
    const hvm = authority.authenticatedHuman({
      ...identity,
      clientId: "hvm-client",
    });
    assert.equal(
      authority.authorize(hvm, "update", { type: "people", workspaceId }),
      membership === member,
    );
    assert.equal(authority.authorize(hvm, "read", { type: "people" }), false);
    assert.equal(
      authority.authorize(hvm, "read", {
        type: "people",
        workspaceId: generatePlatformId("workspace"),
      }),
      false,
    );
    assert.equal(
      authority.authorize(hvm, "delete", { type: "people", workspaceId }),
      false,
    );
  }
  const authority = createAuthorizationAuthority({
    humanClients: clients,
    memberships: [{ ...member, role: "viewer" }],
  });
  const hvm = authority.authenticatedHuman({
    ...identity,
    clientId: "hvm-client",
  });
  assert.deepEqual(
    authority.scopeFilter(hvm, "read", { type: "people", workspaceId }),
    { workspaceId },
  );
  assert.equal(
    authority.authorize(hvm, "update", { type: "people", workspaceId }),
    false,
  );
  const product = authority.authenticatedHuman({
    ...identity,
    clientId: "product-client",
  });
  assert.equal(
    authority.authorize(product, "read", { type: "products" }),
    false,
  );
});

test("overlapping product and external provider identifiers confer no authorization", () => {
  const authority = createAuthorizationAuthority({
    humanClients: clients,
    memberships: [member],
  });
  const hvm = authority.authenticatedHuman({
    ...identity,
    clientId: "hvm-client",
  });
  for (const type of [
    "product_relationships",
    "external_references",
  ] as const) {
    const record = {
      type,
      id: "known-provider-id",
      productId: "shared-product",
      externalId: "known-provider-id",
      workspaceId: otherWorkspace,
    };
    assert.equal(authority.authorize(hvm, "read", record), false);
  }
});

test("service identities require explicit exact grants; JSON contexts and other authorities cannot impersonate actors", () => {
  const service = { type: "agent", id: "queen-1" } as const;
  const grant: ServiceGrant = {
    actor: service,
    application: "hvmapp",
    resource: "crm_tasks",
    action: "update",
    scope: { kind: "workspace", workspaceId },
  };
  const authority = createAuthorizationAuthority({
    humanClients: clients,
    serviceGrants: [grant],
  });
  const context = authority.service(service, "hvmapp");
  assert.equal(
    authority.authorize(context, "update", { type: "crm_tasks", workspaceId }),
    true,
  );
  for (const resource of [
    { type: "crm_tasks" as const },
    { type: "crm_tasks" as const, workspaceId: otherWorkspace },
    { type: "people" as const, workspaceId },
  ]) {
    assert.equal(authority.authorize(context, "update", resource), false);
  }
  assert.equal(
    authority.authorize(context, "delete", { type: "crm_tasks", workspaceId }),
    false,
  );
  assert.throws(
    () => authority.service(service, "system"),
    AuthorizationDenied,
  );
  assert.throws(
    () => authority.service({ type: "system", id: "root" }, "system"),
    AuthorizationDenied,
  );
  assert.equal(
    authority.authorize(
      JSON.parse(JSON.stringify(context)) as AuthorizationContext,
      "update",
      { type: "crm_tasks", workspaceId },
    ),
    false,
  );
  const other = createAuthorizationAuthority({ humanClients: clients });
  assert.equal(
    authority.authorize(other.authenticatedHuman(identity), "read", {
      type: "people",
    }),
    false,
  );
  assert.equal(Object.isFrozen(context.actor), true);
  grant.scope = { kind: "internal" };
  assert.equal(
    authority.authorize(context, "update", { type: "crm_tasks" }),
    false,
  );
});

test("system internal grants do not include workspace scope; unknown clients and resources fail closed", () => {
  const service = { type: "system", id: "import-worker" } as const;
  const authority = createAuthorizationAuthority({
    humanClients: clients,
    serviceGrants: [
      {
        actor: service,
        application: "system",
        action: "create",
        resource: "people",
        scope: { kind: "internal" },
      },
    ],
  });
  const context = authority.service(service, "system");
  assert.equal(
    authority.authorize(context, "create", { type: "people" }),
    true,
  );
  assert.equal(
    authority.authorize(context, "create", { type: "people", workspaceId }),
    false,
  );
  assert.throws(
    () =>
      authority.authenticatedHuman({ ...identity, clientId: "unregistered" }),
    AuthorizationDenied,
  );
  assert.equal(
    authority.authorize(undefined, "read", { type: "people" }),
    false,
  );
});

test("significant operations expose bounded audit context without bodies, headers or read-event noise", async (t) => {
  const { EventEmitter } = await import("node:events");
  const { authorizeOperationalRequest } =
    await import("../src/middlewares/authorization");
  const { logger } = await import("../src/lib/logger");
  const logs: unknown[] = [];
  t.mock.method(logger, "info", (data: unknown) => logs.push(data));
  const authority = createAuthorizationAuthority({ humanClients: clients });
  const context = authority.authenticatedHuman(identity);
  const middleware = authorizeOperationalRequest(authority);
  const id = generatePlatformId("product");
  const response = Object.assign(new EventEmitter(), {
    locals: { authorizationResourceId: id },
    statusCode: 201,
  });
  let calls = 0;
  const request = {
    path: "/products",
    method: "POST",
    authorization: context,
    body: { email: "private@example.com", message: "secret-content" },
    headers: { authorization: "secret-token" },
  };
  // Exercise middleware directly without adding a production introspection route.
  middleware(
    request as unknown as Parameters<typeof middleware>[0],
    response as unknown as Parameters<typeof middleware>[1],
    () => {
      calls++;
    },
  );
  assert.equal(calls, 1);
  response.emit("finish");
  assert.equal(logs.length, 1);
  const audit = logs[0] as Record<string, unknown>;
  assert.deepEqual(audit.actor, actor);
  assert.equal(audit.application, "vapp");
  assert.equal(audit.workspace, "internal");
  assert.equal(audit.resourceId, id);
  assert.equal(audit.action, "create");
  assert.equal(audit.outcome, "succeeded");
  assert.equal(Number.isFinite(Date.parse(String(audit.timestamp))), true);
  assert.doesNotMatch(
    JSON.stringify(logs),
    /private@example|secret-content|secret-token/,
  );
  const readResponse = Object.assign(new EventEmitter(), {
    locals: {},
    statusCode: 200,
  });
  middleware(
    { ...request, method: "GET" } as unknown as Parameters<
      typeof middleware
    >[0],
    readResponse as unknown as Parameters<typeof middleware>[1],
    () => {},
  );
  readResponse.emit("finish");
  assert.equal(logs.length, 1);
});
