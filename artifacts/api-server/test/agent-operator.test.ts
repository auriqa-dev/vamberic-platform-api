import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createAuthorizationAuthority,
  type Actor,
} from "../src/authorization/policy";
import { generatePlatformId } from "../src/domain/ids";
import {
  AgentOperationGrantSchema,
  AgentOperationGrantsSchema,
  type AgentTarget,
} from "../src/domain/agent-operator";
import { WorkspaceMembershipSchema } from "../src/domain/workspace-memberships";
const now = new Date("2026-10-01T12:00:00.000Z");
const issuer = "https://identity.example.test/pool";
const workspaceId = generatePlatformId("workspace");
const actor = { type: "human", id: "client-a", issuer } as const;
const target = {
  kind: "client_agent",
  id: generatePlatformId("clientagent"),
  revision: 1,
} as const;
const membershipId = generatePlatformId("workspacemembership");
function grant() {
  return AgentOperationGrantSchema.parse({
    id: generatePlatformId("agentoperatorgrant"),
    target,
    operations: ["exercise"],
    grantedAt: now,
    grantedBy: { ...actor, id: "queen" },
    expiresAt: new Date(now.getTime() + 60_000),
  });
}
function authority(
  role: "admin" | "viewer",
  granted = true,
  basis: "partner" | "client" = "client",
  subject = actor.id,
  g = grant(),
) {
  const a = createAuthorizationAuthority({
    humanClients: [{ issuer, clientId: "hvm", application: "hvmapp" }],
    memberships: [
      {
        actor: { ...actor, id: subject },
        application: "hvmapp",
        basis,
        role,
        workspaceId,
        status: "active",
      },
    ],
    operatorGrants: granted
      ? [
          {
            actor: { ...actor, id: subject },
            workspaceId,
            membershipId,
            grant: g,
          },
        ]
      : [],
  });
  return {
    a,
    c: a.authenticatedHuman({ issuer, clientId: "hvm", subject }),
    g,
  };
}
for (const role of ["admin", "viewer"] as const) {
  test(`${role}: no automatic Run authority; explicit grant permits only own Run control`, () => {
    for (const granted of [false, true]) {
      const { a, c, g } = authority(role, granted);
      for (const action of ["request", "read", "respond", "cancel"] as const) {
        const request = {
          workspaceId,
          target,
          operation: "exercise",
          action,
          requester: actor,
          membershipId,
          grantId: g.id,
        };
        assert.equal(
          Boolean(a.authorizeAgentOperation(c, request, now)),
          granted,
        );
        if (action !== "request")
          assert.equal(
            a.authorizeAgentOperation(
              c,
              { ...request, requester: { ...actor, id: "other" } },
              now,
            ),
            undefined,
          );
        assert.equal(
          a.authorizeAgentOperation(
            c,
            { ...request, workspaceId: generatePlatformId("workspace") },
            now,
          ),
          undefined,
        );
        assert.equal(
          a.authorizeAgentOperation(
            c,
            { ...request, target: { ...target, revision: 2 } },
            now,
          ),
          undefined,
        );
        assert.equal(
          a.authorizeAgentOperation(
            c,
            {
              ...request,
              target: { ...target, id: generatePlatformId("clientagent") },
            },
            now,
          ),
          undefined,
        );
        assert.equal(
          a.authorizeAgentOperation(
            c,
            { ...request, operation: "unregistered" },
            now,
          ),
          undefined,
        );
      }
      assert.equal(
        a.authorize(c, "manage", {
          type: "agent_operator_assignments",
          workspaceId,
        }),
        false,
      );
      for (const type of [
        "client_agents",
        "client_swarms",
        "swarm_agreements",
      ] as const)
        assert.equal(a.authorize(c, "update", { type, workspaceId }), false);
      assert.equal(
        a.authorize(c, "approve", { type: "agent_runs", workspaceId }),
        false,
      );
    }
  });
}
test("revocation, expiry and regrant remove original Run authority including historical reads", () => {
  const original = grant();
  for (const g of [
    original,
    { ...original, id: generatePlatformId("agentoperatorgrant") },
  ]) {
    for (const granted of [false, true]) {
      const { a, c } = authority("viewer", granted, "client", actor.id, g);
      for (const action of ["read", "respond", "cancel"] as const) {
        const req = {
          workspaceId,
          target,
          operation: "exercise",
          action,
          requester: actor,
          membershipId,
          grantId: original.id,
        };
        assert.equal(
          Boolean(a.authorizeAgentOperation(c, req, now)),
          granted && g.id === original.id,
        );
        assert.equal(
          a.authorizeAgentOperation(c, req, original.expiresAt!),
          undefined,
        );
        assert.equal(
          a.authorizeAgentOperation(
            c,
            { ...req, membershipId: generatePlatformId("workspacemembership") },
            now,
          ),
          undefined,
        );
      }
    }
  }
});
test("Swarm grants never imply direct component Agent authority", () => {
  const swarm: AgentTarget = {
    kind: "client_swarm",
    id: generatePlatformId("clientswarm"),
    revision: 3,
  };
  const { a, c } = authority("viewer", true, "client", actor.id, {
    ...grant(),
    target: swarm,
  });
  assert.equal(
    a.authorizeAgentOperation(
      c,
      { workspaceId, target, operation: "exercise", action: "request" },
      now,
    ),
    undefined,
  );
  assert.ok(
    a.authorizeAgentOperation(
      c,
      { workspaceId, target: swarm, operation: "exercise", action: "request" },
      now,
    ),
  );
});
test("Queen control is workspace scoped; forged context and Empress-only cannot operate", () => {
  const { a, c } = authority("admin", false, "partner");
  assert.ok(
    a.authorize(c, "manage", {
      type: "agent_operator_assignments",
      workspaceId,
    }),
  );
  const req = {
    workspaceId,
    target,
    operation: "exercise",
    action: "read" as const,
    requester: { ...actor, id: "other" } as Actor,
  };
  assert.ok(a.authorizeAgentOperation(c, req, now));
  assert.equal(a.authorizeAgentOperation({ ...c }, req, now), undefined);
  const empress = createAuthorizationAuthority({
    humanClients: [{ issuer, clientId: "hvm", application: "hvmapp" }],
    empressHumans: [actor],
  });
  const e = empress.authenticatedHuman({
    issuer,
    clientId: "hvm",
    subject: actor.id,
  });
  assert.equal(empress.authorizeAgentOperation(e, req, now), undefined);
});
test("grant structure rejects invalid IDs, dates, operations, duplicates, attribution and bounds", () => {
  const g = grant();
  assert.ok(AgentOperationGrantsSchema.safeParse([]).success);
  assert.ok(AgentOperationGrantsSchema.safeParse([g]).success);
  for (const update of [
    { target: { ...target, kind: "agent" } },
    { target: { ...target, id: workspaceId } },
    { target: { ...target, revision: 0 } },
    { target: { ...target, revision: 1.1 } },
    { target: { ...target, revision: Infinity } },
    { operations: [] },
    { operations: ["*"] },
    { operations: ["apply-proposal"] },
    { operations: ["exercise", "exercise"] },
    { operations: ["a".repeat(65)] },
    { operations: ["😀"] },
    { expiresAt: now },
    { grantedBy: { type: "agent", id: "worker" } },
    { grantedBy: { ...actor, token: "forbidden" } },
    { extra: true },
  ])
    assert.equal(
      AgentOperationGrantSchema.safeParse({ ...g, ...update }).success,
      false,
      JSON.stringify(update),
    );
  assert.equal(AgentOperationGrantsSchema.safeParse([g, g]).success, false);
  assert.equal(
    AgentOperationGrantsSchema.safeParse([
      g,
      {
        ...g,
        id: generatePlatformId("agentoperatorgrant"),
        target: { ...target, revision: 2 },
      },
    ]).success,
    false,
  );
  const many = Array.from({ length: 41 }, () => ({
    ...g,
    id: generatePlatformId("agentoperatorgrant"),
    target: { ...target, id: generatePlatformId("clientagent") },
  }));
  assert.equal(AgentOperationGrantsSchema.safeParse(many).success, false);
  assert.ok(AgentOperationGrantsSchema.safeParse(many.slice(0, 40)).success);
  const oversized = many.slice(0, 40).map((g) => ({
    ...g,
    operations: Array.from({ length: 20 }, (_, i) => `a${i}`.padEnd(64, "a")),
    grantedBy: { ...actor, id: "😀".repeat(150) },
  }));
  assert.equal(AgentOperationGrantsSchema.safeParse(oversized).success, false);
  const member = {
    id: membershipId,
    workspaceId,
    human: actor,
    role: "member",
    status: "active",
    createdAt: now,
    updatedAt: now,
    joinedAt: now,
  };
  assert.ok(WorkspaceMembershipSchema.safeParse(member).success);
  assert.ok(
    WorkspaceMembershipSchema.safeParse({
      ...member,
      agentOperationGrants: [g],
    }).success,
  );
  assert.equal(
    WorkspaceMembershipSchema.safeParse({
      ...member,
      agentOperationGrants: [{ ...g, grantedAt: new Date(now.getTime() - 1) }],
    }).success,
    false,
  );
});

test("answer attribution can use the existing deterministic partner-before-client authorization path", () => {
  const both = authority("admin", true, "partner");
  const request = {
    workspaceId,
    target,
    operation: "exercise",
    action: "respond" as const,
    requester: actor,
    membershipId,
    grantId: both.g.id,
  };
  assert.deepEqual(both.a.authorizeAgentOperation(both.c, request, now), {
    basis: "partner",
  });
  const client = authority("viewer", true, "client", actor.id, both.g);
  assert.deepEqual(client.a.authorizeAgentOperation(client.c, request, now), {
    basis: "client",
    membershipId,
    grantId: both.g.id,
  });
});
