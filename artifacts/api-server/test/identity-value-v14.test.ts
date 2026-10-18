import test from "node:test";
import assert from "node:assert/strict";
import type { Document } from "mongodb";
import { generatePlatformId as id } from "../src/domain/ids";
import {
  parseV14,
  parseIdentityEventV14,
  ReasoningContextV14Schema,
  ContactStrategyPolicyV14Schema,
} from "../src/domain/identity-value-v14";
import {
  checkV14References,
  checkIdentityEventV14,
} from "../src/domain/identity-value-v14-references";
import { reasoningEvidenceDigest } from "../src/domain/reasoning-reference-check";
import {
  ReasoningContextSchema,
  ContactStrategyPolicySchema,
} from "../src/domain/reasoning-foundation";
import { crmPatchSchema } from "../src/services/crm-foundation";
import {
  V14_VALIDATORS,
  V14_NEW_COLLECTIONS,
} from "../src/db/identity-value-v14";
import { REASONING_VALIDATORS } from "../src/db/reasoning-foundation";
const at = new Date("2026-10-04T10:00:00Z"),
  later = new Date("2026-10-04T11:00:00Z");
const workspaceId = id("workspace"),
  personId = id("person"),
  organisationId = id("org");
const base = {
  workspaceId,
  createdAt: at,
  updatedAt: at,
  source: { kind: "human", reference: "synthetic-reviewer" },
};
const privacy = {
  purpose: "journey_analysis",
  historyUse: "not_assessed",
  permissionReferences: [],
  evidence: [],
};
const observation = {
  id: id("event"),
  workspaceId,
  createdAt: at,
  updatedAt: at,
  eventType: "synthetic_evidence",
  occurredAt: at,
  payload: { basis: "fictional observation" },
};
const evidence = {
  collection: "events",
  id: observation.id,
  contentHash: reasoningEvidenceDigest(observation),
};
const identity = {
  ...base,
  id: id("interactionidentity"),
  kind: "anonymous",
  namespace: "synthetic_channel",
  evidence: [],
  privacy,
};
const resolution = {
  ...base,
  id: id("identityresolution"),
  identityId: identity.id,
  personId,
  status: "resolved",
  method: "explicit_identification",
  basis: "deterministic",
  relationship: "observed_person",
  evidence: [evidence],
  confidence: 1,
  validFrom: at,
  privacy,
};
const value = {
  ...base,
  id: id("relationshipvalue"),
  key: "account_assessment",
  version: 1,
  subject: { kind: "organisation", organisationId },
  influencingPersonIds: [personId],
  offerings: [],
  dimensions: [
    {
      key: "energy_opportunity",
      basis: "estimated_potential",
      statement: "Fictional opportunity for efficiency services",
      evidence: [evidence],
      assumptions: [],
      confidence: 0.6,
    },
  ],
  methodologies: [],
  validFrom: at,
};
const context = {
  ...base,
  id: id("reasoningcontext"),
  objective: "Review the long-term account relationship",
  organisationIds: [organisationId],
  personIds: [personId],
  contactPointIds: [],
  campaignIds: [],
  knowledge: [],
  observationIds: [],
  evidence: [],
  methodologies: [],
  policies: [],
  learningIds: [],
  currentStateEvidence: [],
};
const policy = {
  ...base,
  id: id("contactstrategy"),
  key: "relationship_strategy",
  version: 1,
  organisationIds: [],
  personIds: [],
  contactPointIds: [],
  campaignIds: [],
  knowledge: [],
  status: "draft",
  clauses: [
    {
      key: "human_sales",
      category: "contact",
      statement: "Protect active human sales conversations",
      evidence: [],
    },
  ],
  strategy: {
    effectiveFrom: at,
    objectives: [
      {
        key: "acquisition",
        description: "Acquire suitable accounts",
        evidence: [],
      },
      {
        key: "relationship_protection",
        description: "Protect strategic relationships",
        evidence: [],
      },
    ],
    precedence: [
      {
        higher: { kind: "clause", key: "human_sales" },
        lower: { kind: "objective", key: "acquisition" },
        rationale: "Human conversation takes precedence",
        effectiveFrom: at,
      },
    ],
    propositions: [],
  },
};
const ref = (collection: string, row: Document) => ({
  collection,
  id: row.id,
  digest: reasoningEvidenceDigest(row),
});
const resolver =
  (rows: Document[]) => async (_collection: string, target: string) =>
    rows.find((r) => r.id === target) ?? null;
const entities = [
  identity,
  resolution,
  observation,
  { id: personId, workspaceId },
  { id: organisationId, workspaceId },
];

test("identity can remain anonymous indefinitely without Person or expiry", () => {
  assert.ok(parseV14("interaction_identities", identity));
  assert.throws(() =>
    parseV14("interaction_identities", { ...identity, personId }),
  );
});
for (const kind of [
  "browser_session",
  "communication_recipient",
  "contact_point_derived",
  "authenticated",
  "advertising_channel",
  "future_channel",
])
  test(`identity supports extensible ${kind}`, () =>
    assert.ok(parseV14("interaction_identities", { ...identity, kind })));
for (const extra of [
  { workspaceId: undefined },
  { workspaceId: "global" },
  { token: "secret" },
  { publicUrl: "https://example.test/person" },
  { executionGrant: {} },
  { kind: "x".repeat(65) },
])
  test(`identity rejects ${Object.keys(extra)[0]}`, () =>
    assert.throws(() =>
      parseV14("interaction_identities", { ...identity, ...extra }),
    ));
test("unresolved resolution carries no invented Person or certainty", () => {
  assert.ok(
    parseV14("identity_resolutions", {
      ...resolution,
      status: "unresolved",
      personId: undefined,
      basis: "unknown",
      evidence: [],
      confidence: 0,
    }),
  );
  assert.throws(() =>
    parseV14("identity_resolutions", { ...resolution, status: "unresolved" }),
  );
});
for (const mutation of [
  { personId: undefined },
  { evidence: [] },
  { basis: "unknown" },
  { confidence: 2 },
  { status: "revoked" },
  { validUntil: at },
  { supersedesId: resolution.id },
])
  test(`resolution rejects missing/invalid ${Object.keys(mutation)[0]}`, () =>
    assert.throws(() =>
      parseV14("identity_resolutions", { ...resolution, ...mutation }),
    ));
test("append-only correction and revocation retain prior assertion", async () => {
  const prior = structuredClone(resolution);
  const correction = {
    ...resolution,
    id: id("identityresolution"),
    createdAt: later,
    updatedAt: later,
    status: "revoked",
    supersedesId: resolution.id,
  };
  await checkV14References(
    "identity_resolutions",
    correction,
    workspaceId,
    resolver(entities),
  );
  assert.deepEqual(resolution, prior);
  await assert.rejects(
    checkV14References(
      "identity_resolutions",
      { ...correction, identityId: id("interactionidentity") },
      workspaceId,
      resolver(entities),
    ),
  );
});
test("anonymous event stays anonymous after later resolution; no retroactive Person backfill", async () => {
  const input = {
    record: observation,
    identityObservation: {
      identityId: identity.id,
      knowledgeAtEvent: "unresolved",
    },
  };
  const before = structuredClone(input);
  await checkIdentityEventV14(input, workspaceId, resolver(entities));
  assert.ok(
    parseV14("identity_resolutions", {
      ...resolution,
      createdAt: later,
      updatedAt: later,
      validFrom: later,
    }),
  );
  assert.deepEqual(input, before);
  assert.equal(parseIdentityEventV14(input).personId, undefined);
  assert.throws(() =>
    parseIdentityEventV14({ ...input, record: { ...observation, personId } }),
  );
});
test("event-time resolution cannot use future knowledge or a different identity", async () => {
  const input = {
    record: observation,
    identityObservation: {
      identityId: identity.id,
      knowledgeAtEvent: "resolution_recorded",
      resolutionId: resolution.id,
    },
  };
  await checkIdentityEventV14(input, workspaceId, resolver(entities));
  await checkIdentityEventV14(
    input,
    workspaceId,
    resolver(
      entities.map((row) => ({ ...row, _id: "synthetic-mongo-transport-id" })),
    ),
  );
  for (const change of [
    { createdAt: later },
    { identityId: id("interactionidentity") },
    { workspaceId: id("workspace") },
    { status: "revoked" },
    { validUntil: at },
  ])
    await assert.rejects(
      checkIdentityEventV14(
        input,
        workspaceId,
        resolver([identity, { ...resolution, ...change }]),
      ),
    );
});
test("opaque communication identity records intended recipient but cannot prove actual clicker", async () => {
  const recipient = {
    ...identity,
    kind: "communication_recipient",
    communication: { eventId: observation.id, intendedPersonId: personId },
  };
  await checkV14References(
    "interaction_identities",
    recipient,
    workspaceId,
    resolver(entities),
  );
  const intended = { ...resolution, relationship: "intended_recipient" };
  await assert.rejects(
    checkIdentityEventV14(
      {
        record: { ...observation, personId },
        identityObservation: {
          identityId: identity.id,
          knowledgeAtEvent: "resolution_recorded",
          resolutionId: intended.id,
        },
      },
      workspaceId,
      resolver([identity, intended]),
    ),
    /recipient/,
  );
});
test("workspace isolation and exact evidence fail closed", async () => {
  await assert.rejects(
    checkV14References(
      "identity_resolutions",
      resolution,
      id("workspace"),
      resolver(entities),
    ),
    /Workspace/,
  );
  await assert.rejects(
    checkV14References(
      "identity_resolutions",
      resolution,
      workspaceId,
      resolver(
        entities.map((r) =>
          r.id === personId ? { ...r, workspaceId: id("workspace") } : r,
        ),
      ),
    ),
    /workspace/,
  );
  await assert.rejects(
    checkV14References(
      "identity_resolutions",
      resolution,
      workspaceId,
      resolver(
        entities.map((r) =>
          r.id === observation.id ? { ...r, payload: { changed: true } } : r,
        ),
      ),
    ),
    /digest/,
  );
});
test("organisation is one economic subject despite fourteen influencing People", () => {
  assert.ok(
    parseV14("relationship_value_assessments", {
      ...value,
      influencingPersonIds: Array.from({ length: 14 }, () => id("person")),
    }),
  );
  assert.throws(() =>
    parseV14("relationship_value_assessments", {
      ...value,
      subject: { ...value.subject, personId },
    }),
  );
  assert.ok(
    parseV14("relationship_value_assessments", {
      ...value,
      subject: { kind: "person", personId },
    }),
  );
  assert.ok(
    parseV14("relationship_value_assessments", {
      ...value,
      subject: { kind: "workspace" },
    }),
  );
});
for (const basis of [
  "known",
  "estimated_potential",
  "strategic_priority",
  "assumption",
])
  test(`value distinguishes ${basis} with explicit supporting basis`, () =>
    assert.ok(
      parseV14("relationship_value_assessments", {
        ...value,
        dimensions: [{ ...value.dimensions[0], basis }],
      }),
    ));
test("value requires evidence or explicit assumptions, never a mutable magic score", () => {
  assert.throws(() =>
    parseV14("relationship_value_assessments", { ...value, score: 100 }),
  );
  assert.throws(() =>
    parseV14("relationship_value_assessments", {
      ...value,
      dimensions: [{ ...value.dimensions[0], evidence: [] }],
    }),
  );
  assert.ok(
    parseV14("relationship_value_assessments", {
      ...value,
      dimensions: [
        {
          ...value.dimensions[0],
          basis: "assumption",
          evidence: [],
          assumptions: ["Explicit fictional hypothesis"],
        },
      ],
    }),
  );
  assert.throws(() =>
    parseV14("relationship_value_assessments", { ...value, updatedAt: later }),
  );
});
test("value supersession must preserve economic subject/key and advance version", async () => {
  const next = {
    ...value,
    id: id("relationshipvalue"),
    version: 2,
    createdAt: later,
    updatedAt: later,
    supersedesId: value.id,
  };
  await checkV14References(
    "relationship_value_assessments",
    next,
    workspaceId,
    resolver([...entities, value]),
  );
  await assert.rejects(
    checkV14References(
      "relationship_value_assessments",
      { ...next, version: 1 },
      workspaceId,
      resolver([...entities, value]),
    ),
  );
});
test("v14 Context and policy extend existing collections and accept unmodified v13 records", () => {
  assert.deepEqual(
    ReasoningContextV14Schema.parse(context),
    ReasoningContextSchema.parse(context),
  );
  const oldPolicy = ContactStrategyPolicyV14Schema.parse(policy);
  delete oldPolicy.strategy;
  assert.deepEqual(
    ContactStrategyPolicyV14Schema.parse(oldPolicy),
    ContactStrategyPolicySchema.parse(oldPolicy),
  );
  assert.deepEqual(V14_NEW_COLLECTIONS, [
    "interaction_identities",
    "identity_resolutions",
    "relationship_value_assessments",
  ]);
  for (const [name, extension] of [
    ["reasoning_contexts", "inputs"],
    ["contact_strategy_policies", "strategy"],
  ]) {
    const inherited = structuredClone(
      V14_VALIDATORS[name!].$and[0].$jsonSchema,
    );
    delete inherited.properties[extension!];
    assert.deepEqual(
      inherited,
      REASONING_VALIDATORS[name!].$and[0].$jsonSchema,
    );
  }
  assert.deepEqual(V14_VALIDATORS.events.$and[0], REASONING_VALIDATORS.events);
  assert.deepEqual(
    V14_VALIDATORS.reasoning_contexts.$and.slice(1),
    REASONING_VALIDATORS.reasoning_contexts.$and.slice(1),
  );
});
test("objectives are extensible; precedence can cross objectives and existing clauses", () => {
  assert.ok(parseV14("contact_strategy_policies", policy));
  assert.ok(
    parseV14("contact_strategy_policies", {
      ...policy,
      strategy: {
        ...policy.strategy,
        objectives: [
          ...policy.strategy.objectives,
          {
            key: "client_defined_goal",
            description: "A future client objective",
            evidence: [],
          },
        ],
      },
    }),
  );
});
test("unknown, cyclic and self precedence references are invalid contract data", () => {
  const edge = policy.strategy.precedence[0];
  for (const precedence of [
    [{ ...edge, lower: edge.higher }],
    [{ ...edge, lower: { kind: "objective", key: "missing" } }],
    [edge, { ...edge, higher: edge.lower, lower: edge.higher }],
  ])
    assert.throws(() =>
      parseV14("contact_strategy_policies", {
        ...policy,
        strategy: { ...policy.strategy, precedence },
      }),
    );
});
test("proposition priority/compatibility pins exact Offering revisions and periods", () => {
  const offering = {
    kind: "offering",
    entityId: id("offering"),
    snapshotId: id("hiverevision"),
    revision: 1,
    contentHash: "a".repeat(64),
  };
  const proposition = {
    offering,
    priority: 1,
    relationships: [
      {
        kind: "cross_sell",
        offering: {
          ...offering,
          entityId: id("offering"),
          snapshotId: id("hiverevision"),
        },
        rationale: "Fictional relationship",
      },
    ],
    effectiveFrom: at,
    effectiveUntil: later,
  };
  assert.ok(
    parseV14("contact_strategy_policies", {
      ...policy,
      strategy: { ...policy.strategy, propositions: [proposition] },
    }),
  );
  assert.throws(() =>
    parseV14("contact_strategy_policies", {
      ...policy,
      strategy: {
        ...policy.strategy,
        propositions: [
          { ...proposition, offering: { ...offering, revision: "latest" } },
        ],
      },
    }),
  );
  assert.throws(() =>
    parseV14("contact_strategy_policies", {
      ...policy,
      strategy: {
        ...policy.strategy,
        propositions: [{ ...proposition, effectiveUntil: at }],
      },
    }),
  );
});
test("synthetic manufacturing journey integrates canonical identities/value/activity/objectives into v13 Context without Campaign", async () => {
  const task = {
    ...base,
    id: id("task"),
    title: "Fictional human review",
    type: "research",
    status: "pending",
    organisationId,
  };
  const input = {
    ...context,
    policies: [{ id: policy.id, version: 1 }],
    inputs: {
      identities: [ref("interaction_identities", identity)],
      resolutions: [ref("identity_resolutions", resolution)],
      relationshipValues: [ref("relationship_value_assessments", value)],
      relationships: [ref("organisations", entities[4])],
      activities: [ref("crm_tasks", task)],
      objectiveReferences: [
        { policyId: policy.id, version: 1, objectiveKey: "acquisition" },
      ],
    },
  };
  const rows = [...entities, value, policy, task];
  const before = structuredClone(rows);
  await checkV14References(
    "reasoning_contexts",
    input,
    workspaceId,
    resolver(rows),
  );
  await checkV14References(
    "reasoning_contexts",
    input,
    workspaceId,
    resolver(
      rows.map((row) => ({ ...row, _id: "synthetic-mongo-transport-id" })),
    ),
  );
  assert.deepEqual(rows, before);
  assert.deepEqual(input.campaignIds, []);
  await assert.rejects(
    checkV14References(
      "reasoning_contexts",
      input,
      workspaceId,
      resolver(
        rows.map((r) => (r.id === task.id ? { ...r, status: "completed" } : r)),
      ),
    ),
    /digest/,
  );
  await assert.rejects(
    checkV14References(
      "reasoning_contexts",
      {
        ...input,
        inputs: {
          ...input.inputs,
          objectiveReferences: [
            { policyId: policy.id, version: 2, objectiveKey: "acquisition" },
          ],
        },
      },
      workspaceId,
      resolver(rows),
    ),
    /objective/,
  );
});
test("new data confers no execution authority and generic CRM writes stay closed", () => {
  assert.equal(
    crmPatchSchema("events").safeParse({
      identityObservation: {
        identityId: identity.id,
        knowledgeAtEvent: "unresolved",
      },
    }).success,
    false,
  );
  assert.throws(() =>
    parseV14("contact_strategy_policies", { ...policy, executionGrant: {} }),
  );
  assert.throws(() =>
    parseV14("interaction_identities", {
      ...identity,
      privacy: { ...privacy, historyUse: "allowed" },
    }),
  );
});

test("v14 indexes scope value versions by economic subject and support identity Event history", async () => {
  const { V14_COLLECTION_DEFINITIONS, V14_EVENT_IDENTITY_INDEX } =
    await import("../src/db/identity-value-v14");
  const index = V14_COLLECTION_DEFINITIONS.find(
    (c) => c.name === "relationship_value_assessments",
  )!.indexes.find((i) => i.name === "workspace_subject_key_version_unique")!;
  assert.deepEqual(index.key, {
    workspaceId: 1,
    "subject.kind": 1,
    "subject.organisationId": 1,
    "subject.personId": 1,
    key: 1,
    version: 1,
  });
  assert.equal(index.unique, true);
  assert.deepEqual(V14_EVENT_IDENTITY_INDEX.key, {
    workspaceId: 1,
    "identityObservation.identityId": 1,
    occurredAt: -1,
    id: 1,
  });
});
test("T3 Context can pin a T2 resolution while retaining the unresolved T1 Event", async () => {
  const t2 = {
    ...resolution,
    createdAt: later,
    updatedAt: later,
    validFrom: later,
  };
  const t3 = new Date("2026-10-04T12:00:00Z");
  const event = parseIdentityEventV14({
    record: observation,
    identityObservation: {
      identityId: identity.id,
      knowledgeAtEvent: "unresolved",
    },
  });
  const input = {
    ...context,
    createdAt: t3,
    updatedAt: t3,
    observationIds: [event.id],
    inputs: {
      identities: [ref("interaction_identities", identity)],
      resolutions: [ref("identity_resolutions", t2)],
      relationshipValues: [],
      relationships: [],
      activities: [],
      objectiveReferences: [],
    },
  };
  const before = structuredClone(event);
  await checkV14References(
    "reasoning_contexts",
    input,
    workspaceId,
    resolver([
      identity,
      t2,
      event,
      { id: personId, workspaceId },
      { id: organisationId, workspaceId },
    ]),
  );
  assert.deepEqual(event, before);
  assert.equal(event.personId, undefined);
  assert.equal(event.identityObservation.knowledgeAtEvent, "unresolved");
});
