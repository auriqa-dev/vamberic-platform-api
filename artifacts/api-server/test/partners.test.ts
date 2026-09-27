import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HvmPartnerSchema,
  HvmPartnerMembershipSchema,
  WorkspaceIntegrationSchema,
  WorkspacePartnerAssignmentSchema,
  validatePartnerRelationships,
  PersonSchema,
  OrganisationSchema,
  CrmWorkspaceSchema,
  CapabilitySchema,
  CapabilityInstanceSchema,
  EntitlementSchema,
  SubscriptionSchema,
  hasCapabilityInstanceEntitlement,
  generatePlatformId,
} from "../src/domain";
import { createAuthorizationAuthority } from "../src/authorization/policy";
import { COLLECTION_DEFINITIONS } from "../src/db/collections";
import { EnquiryMemoryDb } from "./helpers/enquiry-db";

const now = new Date("2026-09-27T12:00:00Z");
const later = new Date(now.getTime() + 1000);
const dates = { createdAt: now, updatedAt: now };
const human = { type: "human", id: "verified-cognito-subject" } as const;
function fixture() {
  const person = PersonSchema.parse({
    ...dates,
    id: generatePlatformId("person"),
    firstName: "Accountable",
    displayName: "Accountable human",
  });
  const organisation = OrganisationSchema.parse({
    ...dates,
    id: generatePlatformId("org"),
    name: "Partner organisation",
    type: "partner",
  });
  const client = OrganisationSchema.parse({
    ...organisation,
    id: generatePlatformId("org"),
    type: "customer",
    name: "Client",
  });
  const workspace = (name: string) =>
    CrmWorkspaceSchema.parse({
      ...dates,
      id: generatePlatformId("workspace"),
      kind: "client",
      clientOrganisationId: client.id,
      name,
    });
  const workspaces = [
    workspace("Client A"),
    workspace("Client B"),
    workspace("Client C"),
  ];
  const partner = HvmPartnerSchema.parse({
    ...dates,
    id: generatePlatformId("partner"),
    displayName: "Partner A",
    status: "active",
    primaryPersonId: person.id,
    organisationId: organisation.id,
  });
  const supporting = HvmPartnerSchema.parse({
    ...partner,
    id: generatePlatformId("partner"),
    displayName: "Partner B",
  });
  const assignment = (
    workspaceId: string,
    partnerId = partner.id,
    role: "primary" | "supporting" = "primary",
  ) =>
    WorkspacePartnerAssignmentSchema.parse({
      ...dates,
      id: generatePlatformId("partnerassignment"),
      workspaceId,
      partnerId,
      role,
      status: "active",
      assignedAt: now,
      assignedBy: human,
    });
  const assignments = workspaces.map((w) => assignment(w.id));
  return {
    partner,
    supporting,
    person,
    organisation,
    client,
    workspaces,
    assignment,
    model: {
      partners: [partner, supporting],
      assignments,
      workspaces,
      people: [person],
      organisations: [organisation, client],
    },
  };
}

test("one business Partner can manage multiple workspaces, each with primary and supporting Partners", () => {
  const f = fixture();
  const assignments = [
    ...f.model.assignments,
    f.assignment(f.workspaces[0].id, f.supporting.id, "supporting"),
  ];
  assert.doesNotThrow(() =>
    validatePartnerRelationships({ ...f.model, assignments }),
  );
  assert.equal(
    assignments.filter(
      (a) => a.partnerId === f.partner.id && a.status === "active",
    ).length,
    3,
  );
  assert.equal(
    assignments.filter(
      (a) => a.workspaceId === f.workspaces[0].id && a.role === "primary",
    ).length,
    1,
  );
  assert.equal(
    assignments.filter(
      (a) => a.workspaceId === f.workspaces[0].id && a.role === "supporting",
    ).length,
    1,
  );
});

test("Partner lifecycle is typed and independent from retained assignment history", () => {
  const f = fixture();
  for (const status of ["invited", "active", "suspended", "ended"] as const) {
    const p = HvmPartnerSchema.parse({
      ...f.partner,
      status,
      ...(status === "ended" ? { endedAt: later, updatedAt: later } : {}),
    });
    assert.doesNotThrow(() =>
      validatePartnerRelationships({ ...f.model, partners: [p, f.supporting] }),
    );
  }
  for (const patch of [
    { status: "queen_admin" },
    { status: "ended" },
    { endedAt: now },
    { archived: true },
    { workspaceId: f.workspaces[0].id },
    { updatedAt: new Date(now.getTime() - 1) },
  ])
    assert.equal(
      HvmPartnerSchema.safeParse({ ...f.partner, ...patch }).success,
      false,
    );
});

test("assignment ending is explicit, preserves history and permits a new primary", () => {
  const f = fixture();
  const original = f.model.assignments[0];
  const ended = WorkspacePartnerAssignmentSchema.parse({
    ...original,
    status: "ended",
    endedAt: later,
    updatedAt: later,
  });
  const assignments = [
    ended,
    ...f.model.assignments.slice(1),
    f.assignment(original.workspaceId, f.supporting.id),
  ];
  assert.doesNotThrow(() =>
    validatePartnerRelationships({ ...f.model, assignments }),
  );
  assert.equal(original.status, "active");
  for (const patch of [
    { status: "ended" },
    { endedAt: now },
    { role: "admin" },
    { status: "revoked" },
    { archived: true },
    { assignedAt: later },
    { status: "ended", endedAt: new Date(now.getTime() - 1) },
  ])
    assert.equal(
      WorkspacePartnerAssignmentSchema.safeParse({ ...original, ...patch })
        .success,
      false,
    );
});

test("domain and canonical partial unique indexes enforce one active primary and one active pair", async () => {
  const f = fixture();
  const current = f.model.assignments[0];
  const competing = f.assignment(current.workspaceId, f.supporting.id);
  assert.throws(
    () =>
      validatePartnerRelationships({
        ...f.model,
        assignments: [...f.model.assignments, competing],
      }),
    /one active primary/,
  );
  const repeated = f.assignment(
    current.workspaceId,
    f.partner.id,
    "supporting",
  );
  assert.throws(
    () =>
      validatePartnerRelationships({
        ...f.model,
        assignments: [...f.model.assignments, repeated],
      }),
    /Duplicate active/,
  );
  const indexes = COLLECTION_DEFINITIONS.find(
    (c) => c.name === "workspace_partner_assignments",
  )!.indexes;
  const primary = indexes.find(
    (i) => i.name === "workspace_active_primary_unique",
  )!;
  assert.deepEqual(primary.key, { workspaceId: 1 });
  assert.equal(primary.unique, true);
  assert.deepEqual(primary.partialFilterExpression, {
    status: "active",
    role: "primary",
  });
  const pair = indexes.find(
    (i) => i.name === "workspace_partner_active_unique",
  )!;
  assert.deepEqual(pair.partialFilterExpression, { status: "active" });
  const db = new EnquiryMemoryDb();
  const collection = db.collection("workspace_partner_assignments");
  await collection.insertOne(current);
  await assert.rejects(collection.insertOne(competing));
  await assert.rejects(collection.insertOne(repeated));
  await collection.insertOne(
    f.assignment(current.workspaceId, f.supporting.id, "supporting"),
  );
  await collection.insertOne({
    ...competing,
    status: "ended",
    endedAt: later,
    updatedAt: later,
  });
  await collection.insertOne({
    ...current,
    id: generatePlatformId("partnerassignment"),
    status: "ended",
    endedAt: later,
    updatedAt: later,
  });
});

test("ending or removing an assignment leaves client capability/subscription/entitlement records and access independent", () => {
  const f = fixture();
  const workspace = f.workspaces[0];
  const capability = CapabilitySchema.parse({
    ...dates,
    id: generatePlatformId("capability"),
    name: "Mission",
    supportedScopeTypes: ["workspace"],
  });
  const instance = CapabilityInstanceSchema.parse({
    ...dates,
    id: generatePlatformId("capinstance"),
    workspaceId: workspace.id,
    capabilityId: capability.id,
    scopeType: "workspace",
    status: "enabled",
  });
  const subscription = SubscriptionSchema.parse({
    ...dates,
    id: generatePlatformId("subscription"),
    workspaceId: workspace.id,
    productId: generatePlatformId("product"),
    organisationId: f.client.id,
    provider: "example",
    plan: "example",
    status: "active",
    currency: "GBP",
    recurringAmountMinor: 0,
    billingInterval: "month",
    startedAt: now,
  });
  const entitlement = EntitlementSchema.parse({
    ...dates,
    id: generatePlatformId("entitlement"),
    workspaceId: workspace.id,
    capabilityInstanceId: instance.id,
    entitlementType: "subscription",
    sourceSubscriptionId: subscription.id,
    activeFrom: now,
    status: "active",
    billingTreatment: "internal",
  });
  const integration = WorkspaceIntegrationSchema.parse({
    ...dates,
    id: generatePlatformId("integration"),
    workspaceId: workspace.id,
    provider: "odyssiant",
    displayName: "Client account",
    status: "connected",
    connectedAt: now,
  });
  const membership = HvmPartnerMembershipSchema.parse({
    ...dates,
    id: generatePlatformId("partnermembership"),
    partnerId: f.partner.id,
    human: { ...human, issuer: "https://identity.example.test" },
    role: "owner",
    status: "active",
    joinedAt: now,
  });
  f.model.workspaces[0].clientOrganisationId = f.organisation.id;
  const clientRecords = {
    workspace,
    subscription,
    instance,
    entitlement,
    integration,
  };
  const before = structuredClone(clientRecords);
  const commercial = {
    workspaces: [workspace],
    products: [],
    capabilities: [capability],
    instances: [instance],
  };
  for (const assignments of [
    f.model.assignments,
    f.model.assignments.map((a) =>
      WorkspacePartnerAssignmentSchema.parse({
        ...a,
        status: "ended",
        endedAt: later,
        updatedAt: later,
      }),
    ),
    [],
  ]) {
    assert.doesNotThrow(() =>
      validatePartnerRelationships({
        ...f.model,
        memberships: [membership],
        assignments,
      }),
    );
    assert.equal(
      hasCapabilityInstanceEntitlement(
        commercial,
        [entitlement],
        instance.id,
        workspace.id,
        now,
      ),
      true,
    );
    assert.equal(
      hasCapabilityInstanceEntitlement(
        commercial,
        [],
        instance.id,
        workspace.id,
        now,
      ),
      false,
    );
    assert.deepEqual(clientRecords, before);
  }
});

test("Partner assignments and IDs cannot bypass central authorization or become human actors", () => {
  const f = fixture();
  const identity = {
    issuer: "trusted-issuer",
    clientId: "future-hvm",
    subject: human.id,
  };
  const authority = createAuthorizationAuthority({
    humanClients: [
      {
        issuer: identity.issuer,
        clientId: identity.clientId,
        application: "hvmapp",
      },
      { issuer: identity.issuer, clientId: "vapp", application: "vapp" },
    ],
  });
  const context = authority.authenticatedHuman(identity);
  const vapp = authority.authenticatedHuman({ ...identity, clientId: "vapp" });
  assert.notEqual(context.actor.id, f.partner.id);
  assert.equal(context.actor.type, "human");
  for (const type of [
    "workspace_partner_assignments",
    "capability_instances",
    "entitlements",
    "people",
  ] as const) {
    assert.equal(
      authority.authorize(context, "read", {
        type,
        workspaceId: f.workspaces[0].id,
      }),
      false,
    );
    assert.equal(
      authority.authorize(vapp, "read", {
        type,
        workspaceId: f.workspaces[0].id,
      }),
      false,
    );
  }
  assert.equal(
    WorkspacePartnerAssignmentSchema.safeParse({
      ...f.model.assignments[0],
      assignedBy: { type: "partner", id: f.partner.id },
    }).success,
    false,
  );
  assert.equal(
    WorkspacePartnerAssignmentSchema.safeParse({
      ...f.model.assignments[0],
      assignedBy: { type: "agent", id: "queen" },
    }).success,
    false,
  );
  assert.equal(
    HvmPartnerSchema.safeParse({ ...f.partner, id: identity.subject }).success,
    false,
  );
});

test("internal businesses and external clients use identical Partner and workspace structures", () => {
  const f = fixture();
  for (const name of ["HVM", "Built Matters", "Odyssiant", "e-c", "Agreus"]) {
    const workspaces = [{ ...f.workspaces[0], name }];
    assert.doesNotThrow(() =>
      validatePartnerRelationships({
        ...f.model,
        workspaces,
        assignments: [f.assignment(workspaces[0].id)],
      }),
    );
  }
});

test("missing or client-scoped registry references and invalid workspace links fail closed", () => {
  const f = fixture();
  const other = generatePlatformId("workspace");
  assert.throws(() =>
    validatePartnerRelationships({
      ...f.model,
      people: [{ ...f.person, workspaceId: other }],
    }),
  );
  assert.throws(() =>
    validatePartnerRelationships({
      ...f.model,
      organisations: [{ ...f.organisation, workspaceId: other }, f.client],
    }),
  );
  assert.throws(() =>
    validatePartnerRelationships({
      ...f.model,
      assignments: [
        { ...f.model.assignments[0], partnerId: generatePlatformId("partner") },
      ],
    }),
  );
  assert.throws(() =>
    validatePartnerRelationships({
      ...f.model,
      assignments: [{ ...f.model.assignments[0], workspaceId: other }],
    }),
  );
  assert.throws(() =>
    validatePartnerRelationships({
      ...f.model,
      workspaces: [
        {
          ...f.workspaces[0],
          kind: "portfolio",
          clientOrganisationId: undefined,
        },
      ],
      assignments: [f.model.assignments[0]],
    }),
  );
  assert.throws(() =>
    validatePartnerRelationships({
      ...f.model,
      workspaces: [{ ...f.workspaces[0], archived: true }],
      assignments: [f.model.assignments[0]],
    }),
  );
});

test("agency memberships support multiple humans, multiple Partners, individual accounts and ended history", async () => {
  const f = fixture();
  const member = (partnerId = f.partner.id, subject = "tom") =>
    HvmPartnerMembershipSchema.parse({
      ...dates,
      id: generatePlatformId("partnermembership"),
      partnerId,
      human: {
        type: "human",
        issuer: "https://identity.example.test",
        id: subject,
      },
      personId: f.person.id,
      role: "member",
      status: "active",
      joinedAt: now,
    });
  const tom = member();
  const staff = { ...member(f.partner.id, "staff"), role: "owner" as const };
  const secondAccount = member(f.supporting.id);
  for (const memberships of [[tom], [tom, staff, secondAccount]])
    assert.doesNotThrow(() =>
      validatePartnerRelationships({ ...f.model, memberships }),
    );
  const individual = HvmPartnerSchema.parse({
    ...f.partner,
    organisationId: undefined,
    primaryPersonId: undefined,
  });
  validatePartnerRelationships({
    ...f.model,
    partners: [individual, f.supporting],
    memberships: [tom],
  });
  const ended = HvmPartnerMembershipSchema.parse({
    ...tom,
    status: "ended",
    endedAt: later,
    updatedAt: later,
  });
  validatePartnerRelationships({ ...f.model, memberships: [ended, member()] });
  assert.equal(tom.status, "active");
  for (const patch of [
    { role: "admin" },
    { status: "invited" },
    { status: "ended" },
    { endedAt: now },
    { joinedAt: later },
    { archived: true },
    { workspaceId: f.workspaces[0].id },
    { human: { ...tom.human, id: f.partner.id } },
    { human: { ...tom.human, type: "agent" } },
    { human: { id: "tom", type: "human" } },
  ])
    assert.equal(
      HvmPartnerMembershipSchema.safeParse({ ...tom, ...patch }).success,
      false,
    );
  assert.throws(
    () =>
      validatePartnerRelationships({
        ...f.model,
        memberships: [tom, member()],
      }),
    /Duplicate active/,
  );
  assert.throws(
    () =>
      validatePartnerRelationships({
        ...f.model,
        memberships: [{ ...tom, partnerId: generatePlatformId("partner") }],
      }),
    /existing Partner/,
  );
  assert.throws(() =>
    validatePartnerRelationships({
      ...f.model,
      memberships: [tom],
      people: [{ ...f.person, workspaceId: f.workspaces[0].id }],
    }),
  );
  const db = new EnquiryMemoryDb();
  const collection = db.collection("hvm_partner_memberships");
  await collection.insertOne(tom);
  await assert.rejects(collection.insertOne(member()));
  await collection.insertOne(staff);
  await collection.insertOne(secondAccount);
  await collection.insertOne({
    ...member(),
    human: { ...tom.human, issuer: "https://other.example.test" },
  });
  await collection.insertOne({
    ...ended,
    id: generatePlatformId("partnermembership"),
  });
});
