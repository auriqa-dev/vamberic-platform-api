import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createAuthorizationAuthority,
  RESOURCES,
  type WorkspaceMembership,
} from "../src/authorization/policy";
import { generatePlatformId } from "../src/domain/ids";

const workspaceId = generatePlatformId("workspace");
const otherWorkspaceId = generatePlatformId("workspace");
const issuer = "https://identity.example.test/pool";
const clientId = "hvm-test-client";
const actor = { type: "human", issuer, id: "queen-test-human" } as const;

function fixture(basis: "partner" | "client", empress = false) {
  const membership: WorkspaceMembership = {
    actor,
    application: "hvmapp",
    workspaceId,
    role: "admin",
    status: "active",
    basis,
  };
  const authority = createAuthorizationAuthority({
    humanClients: [{ issuer, clientId, application: "hvmapp" }],
    memberships: [membership],
    empressHumans: empress ? [{ issuer, id: actor.id }] : [],
  });
  const context = authority.authenticatedHuman({
    issuer,
    clientId,
    subject: actor.id,
  });
  return { authority, context };
}

test("Queen may update configuration in the assigned workspace", () => {
  const { authority, context } = fixture("partner");
  assert.equal(
    authority.authorize(context, "update", {
      type: "client_swarms",
      workspaceId,
    }),
    true,
  );
});

test("client admin can operate as Queen of its own workspace", () => {
  const { authority, context } = fixture("client");
  assert.equal(
    authority.authorize(context, "update", {
      type: "client_swarms",
      workspaceId,
    }),
    true,
  );
});

test("Queen cannot update another workspace", () => {
  const { authority, context } = fixture("partner");
  assert.equal(
    authority.authorize(context, "update", {
      type: "client_swarms",
      workspaceId: otherWorkspaceId,
    }),
    false,
  );
});

test("global Agent Definition mutation requires Empress", () => {
  for (const empress of [false, true]) {
    const { authority, context } = fixture("partner", empress);
    assert.equal(
      authority.authorize(context, "update", { type: "agent_definitions" }),
      empress,
    );
  }
});

test("adding a workspace scope cannot grant Queen mutation of global definitions", () => {
  const { authority, context } = fixture("partner");
  for (const type of [
    "agent_definitions",
    "integration_providers",
    "swarm_templates",
    "commercial_policies",
    "methodology_availability",
  ] as const) {
    assert.equal(
      authority.authorize(context, "update", { type, workspaceId }),
      false,
      `${type} must remain a global Empress resource`,
    );
  }
});

test("Empress cannot authorize a workspace resource without a workspace", () => {
  const { authority, context } = fixture("partner", true);
  assert.equal(
    authority.authorize(context, "update", { type: "client_swarms" }),
    false,
  );
});

const globalResources = [
  "agent_definitions",
  "integration_providers",
  "swarm_templates",
  "commercial_policies",
  "methodology_availability",
] as const;
const workspaceResources = [
  "client_agents",
  "client_swarms",
  "pricing_recommendations",
  "swarm_agreements",
] as const;
// Publish/configure/retire use update; commercial approval uses approve.
const actions = ["read", "create", "update", "approve"] as const;
test("direct client administrator matches Queen owner across every workspace resource and action", () => {
  const client = fixture("client");
  const queen = fixture("partner");
  for (const type of RESOURCES) {
    for (const action of ["read", "create", "update", "delete", "delete-preview", "approve", "manage"] as const) {
      assert.equal(client.authority.authorize(client.context, action, { type, workspaceId }), queen.authority.authorize(queen.context, action, { type, workspaceId }), `${type}:${action}`);
      assert.equal(client.authority.authorize(client.context, action, { type, workspaceId: otherWorkspaceId }), false, `foreign ${type}:${action}`);
      assert.equal(client.authority.authorize(client.context, action, { type }), false, `global ${type}:${action}`);
    }
  }
});
for (const scenario of [
  { name: "Empress only", empress: true },
  { name: "Queen owner", basis: "partner", role: "admin" },
  { name: "Partner onboarder", basis: "partner", role: "onboarder" },
  { name: "client admin", basis: "client", role: "admin" },
  { name: "client viewer", basis: "client", role: "viewer" },
  { name: "Empress and Queen", empress: true, basis: "partner", role: "admin" },
  { name: "unauthorized human" },
] as const) {
  test(`operating scope/action matrix: ${scenario.name}`, () => {
    const empress = "empress" in scenario && scenario.empress;
    const queen = "basis" in scenario && (scenario.basis === "partner" || scenario.role === "admin");
    const authority = createAuthorizationAuthority({
      humanClients: [{ issuer, clientId, application: "hvmapp" }],
      empressHumans: empress ? [{ issuer, id: actor.id }] : [],
      memberships:
        "basis" in scenario
          ? [
              {
                actor,
                application: "hvmapp",
                workspaceId,
                status: "active",
                basis: scenario.basis,
                role: scenario.role,
              },
            ]
          : [],
    });
    const context = authority.authenticatedHuman({
      issuer,
      clientId,
      subject: actor.id,
    });
    for (const type of globalResources)
      for (const action of actions) {
        assert.equal(authority.authorize(context, action, { type }), empress);
        for (const scope of [
          workspaceId,
          otherWorkspaceId,
          "",
          "invalid",
          null,
        ]) {
          assert.equal(
            authority.authorize(context, action, {
              type,
              workspaceId: scope as string,
            }),
            false,
          );
        }
      }
    for (const type of workspaceResources)
      for (const action of actions) {
        assert.equal(
          authority.authorize(context, action, { type, workspaceId }),
          queen,
        );
        for (const scope of [
          undefined,
          otherWorkspaceId,
          "",
          "invalid",
          null,
        ]) {
          assert.equal(
            authority.authorize(context, action, {
              type,
              workspaceId: scope as string,
            }),
            false,
          );
        }
      }
  });
}

for (const actorType of ["agent", "system"] as const) {
  test(`${actorType} grants cannot repair an invalid operating resource scope`, () => {
    const workload = { type: actorType, id: "test-workload" };
    const authority = createAuthorizationAuthority({
      humanClients: [],
      serviceGrants: [...globalResources, ...workspaceResources].flatMap(
        (resource) => [
          {
            actor: workload,
            application: "system" as const,
            resource,
            action: "update" as const,
            scope: { kind: "internal" as const },
          },
          {
            actor: workload,
            application: "system" as const,
            resource,
            action: "update" as const,
            scope: { kind: "workspace" as const, workspaceId },
          },
        ],
      ),
    });
    const context = authority.service(workload, "system");
    for (const type of globalResources) {
      assert.equal(authority.authorize(context, "update", { type }), true);
      assert.equal(
        authority.authorize(context, "update", { type, workspaceId }),
        false,
      );
    }
    for (const type of workspaceResources) {
      assert.equal(authority.authorize(context, "update", { type }), false);
      assert.equal(
        authority.authorize(context, "update", { type, workspaceId }),
        true,
      );
      assert.equal(
        authority.authorize(context, "update", {
          type,
          workspaceId: otherWorkspaceId,
        }),
        false,
      );
    }
  });
}

test("agreement approval review is strictly global, human Empress-only, read/approve only", () => {
  for (const empress of [true, false]) {
    const { authority, context } = fixture("partner", empress);
    for (const action of ["read", "approve"] as const) {
      assert.equal(
        authority.authorize(context, action, { type: "agreement_approvals" }),
        empress,
      );
      assert.equal(
        authority.authorize(context, action, {
          type: "agreement_approvals",
          workspaceId,
        }),
        false,
      );
    }
    for (const action of ["create", "update", "delete", "manage"] as const)
      assert.equal(
        authority.authorize(context, action, { type: "agreement_approvals" }),
        false,
      );
  }
});
