import test from "node:test";
import assert from "node:assert/strict";
import { generatePlatformId as id } from "../src/domain/ids";
import {
  ReasoningContextSchema,
  ReasoningDecisionSchema,
  ScopedLearningSchema,
  ContactStrategyPolicySchema,
  validateReasoningSemantics,
} from "../src/domain/reasoning-foundation";
import { checkReasoningReferences } from "../src/domain/reasoning-reference-check";
import {
  parseReasoningTask,
  parseReasoningEvent,
} from "../src/domain/reasoning-crm-links";
import { contactStrategyRegistration } from "../src/domain/contact-strategy-registration";
import { crmPatchSchema } from "../src/services/crm-foundation";
import { REASONING_VALIDATORS } from "../src/db/reasoning-foundation";
const at = new Date("2026-10-03T00:00:00Z");
const workspaceId = id("workspace");
const base = {
  workspaceId,
  createdAt: at,
  updatedAt: at,
  source: { kind: "human", reference: "fictional-reviewer" },
};
const subjects = {
  organisationIds: [],
  personIds: [],
  contactPointIds: [],
  campaignIds: [],
  knowledge: [],
};
const context = {
  ...base,
  ...subjects,
  id: id("reasoningcontext"),
  objective: "Review contact priorities across propositions",
  observationIds: [],
  evidence: [],
  methodologies: [],
  policies: [],
  learningIds: [],
  currentStateEvidence: [],
};
const decision = {
  ...base,
  id: id("reasoningdecision"),
  contextId: context.id,
  candidates: [{ key: "wait", description: "Await human review" }],
  selectedCandidateKey: "wait",
  explanation: "Insufficient evidence",
  evidence: [],
  confidence: 0.5,
  priority: "normal",
  authorityLevel: "recommendation",
  authorityEvidence: [],
  constraints: [],
  policies: [],
  status: "proposed",
  decidedAt: at,
};
test("contexts support workspace-only and multiple independent propositions/campaigns", () => {
  assert.ok(ReasoningContextSchema.safeParse(context).success);
  assert.ok(
    ReasoningContextSchema.safeParse({
      ...context,
      campaignIds: [id("campaign"), id("campaign")],
    }).success,
  );
});
for (const change of [
  { workspaceId: undefined },
  { workspaceId: "global" },
  { model: "provider-specific" },
  { grant: {} },
  { objective: "x".repeat(2001) },
])
  test(`context rejects invalid scope/extra state: ${Object.keys(change)[0]}`, () => {
    assert.equal(
      ReasoningContextSchema.safeParse({ ...context, ...change }).success,
      false,
    );
  });
test("exact source revisions cannot request latest or omit hash", () => {
  const ref = {
    kind: "offering",
    entityId: id("offering"),
    snapshotId: id("hiverevision"),
    revision: 1,
    contentHash: "a".repeat(64),
  };
  assert.ok(
    ReasoningContextSchema.safeParse({ ...context, knowledge: [ref] }).success,
  );
  for (const revision of ["latest", 0, 1.5])
    assert.equal(
      ReasoningContextSchema.safeParse({
        ...context,
        knowledge: [{ ...ref, revision }],
      }).success,
      false,
    );
});
test("recommendations are descriptive records, not execution authority", () => {
  assert.ok(ReasoningDecisionSchema.safeParse(decision).success);
  assert.throws(
    () =>
      validateReasoningSemantics("reasoning_decisions", {
        ...decision,
        authorityLevel: "delegated_decision",
      }),
    /evidence/,
  );
  assert.equal(
    ReasoningDecisionSchema.safeParse({ ...decision, executionGrant: {} })
      .success,
    false,
  );
});
for (const change of [
  { selectedCandidateKey: "missing" },
  { candidates: [decision.candidates[0], decision.candidates[0]] },
  { updatedAt: new Date(at.getTime() + 1) },
  { supersedesId: decision.id },
])
  test(`decision integrity: ${Object.keys(change)[0]}`, () => {
    assert.throws(() =>
      validateReasoningSemantics("reasoning_decisions", {
        ...decision,
        ...change,
      }),
    );
  });
test("workspace reference admission rejects foreign context and missing provenance", async () => {
  await assert.rejects(
    checkReasoningReferences(
      "reasoning_contexts",
      context,
      id("workspace"),
      async () => null,
    ),
    /Workspace/,
  );
  await assert.rejects(
    checkReasoningReferences(
      "reasoning_decisions",
      decision,
      workspaceId,
      async () => ({ workspaceId: id("workspace") }),
    ),
    /workspace reference/,
  );
  await assert.rejects(
    checkReasoningReferences(
      "reasoning_decisions",
      decision,
      workspaceId,
      async () => null,
    ),
    /workspace reference/,
  );
  await checkReasoningReferences(
    "reasoning_decisions",
    decision,
    workspaceId,
    async () => context,
  );
});
test("learning remains workspace-owned and bounded with evidence and validity", () => {
  const learning = {
    ...base,
    id: id("learning"),
    claim: "A bounded observation",
    scope: {
      kind: "workspace",
      knowledge: [],
      policies: [],
      capabilityIds: [],
      methodologies: [],
    },
    evidence: [
      { collection: "events", id: id("event"), contentHash: "a".repeat(64) },
    ],
    confidence: 0.5,
    validFrom: at,
    contextIds: [],
    decisionIds: [],
    outcomeEventIds: [],
    limitations: [],
  };
  assert.ok(ScopedLearningSchema.safeParse(learning).success);
  assert.equal(
    ScopedLearningSchema.safeParse({
      ...learning,
      scope: { ...learning.scope, kind: "global" },
    }).success,
    false,
  );
  assert.equal(
    ScopedLearningSchema.safeParse({ ...learning, evidence: [] }).success,
    false,
  );
  assert.throws(() =>
    validateReasoningSemantics("scoped_learning", {
      ...learning,
      validUntil: at,
    }),
  );
});
test("versioned policy is declarative, bounded and not executable code", () => {
  const policy = {
    ...base,
    ...subjects,
    id: id("contactstrategy"),
    key: "contact_rules",
    version: 1,
    status: "draft",
    clauses: [
      {
        key: "human_review",
        category: "contact",
        statement: "Human review required",
        evidence: [],
      },
    ],
  };
  assert.ok(ContactStrategyPolicySchema.safeParse(policy).success);
  assert.equal(
    ContactStrategyPolicySchema.safeParse({ ...policy, algorithm: "execute()" })
      .success,
    false,
  );
  assert.equal(
    ContactStrategyPolicySchema.safeParse({ ...policy, version: 0 }).success,
    false,
  );
});
test("Actions reuse CRM task lifecycle without requiring Campaign; public write path remains closed", () => {
  const record = {
    ...base,
    id: id("task"),
    title: "Human follow-up",
    type: "follow_up",
    status: "pending",
    personId: id("person"),
    source: undefined,
  };
  const reasoning = {
    contextId: context.id,
    decisionId: decision.id,
    offerings: [],
  };
  assert.ok(parseReasoningTask({ record, reasoning }));
  assert.throws(() =>
    parseReasoningTask({
      record: { ...record, status: "completed" },
      reasoning,
    }),
  );
  assert.equal(
    crmPatchSchema("crm_tasks").safeParse({ reasoning }).success,
    false,
  );
  assert.equal(
    crmPatchSchema("events").safeParse({ reasoning }).success,
    false,
  );
});
test("Outcomes use append-only events, bounded measurements and ordered periods", () => {
  const record = {
    ...base,
    id: id("event"),
    eventType: "measured_outcome",
    occurredAt: at,
    source: undefined,
  };
  const reasoning = {
    kind: "outcome",
    contextId: context.id,
    decisionId: decision.id,
    taskId: id("task"),
    evidence: [],
    periodStart: at,
    periodEnd: at,
    measurements: [{ name: "replies", value: 1, unit: "count" }],
  };
  assert.ok(parseReasoningEvent({ record, reasoning }));
  assert.throws(() =>
    parseReasoningEvent({
      record,
      reasoning: { ...reasoning, periodEnd: new Date(at.getTime() - 1) },
    }),
  );
});
test("Contact Strategy registration validates existing catalogues, stays draft with no execution or access", () => {
  const plan = contactStrategyRegistration(
    {
      type: "human",
      issuer: "https://identity.example.test/pool",
      id: "fictional",
    },
    at,
  );
  assert.equal(plan.agentDefinition.status, "draft");
  assert.deepEqual(plan.agentDefinition.data.providesCapabilityIds, [
    plan.capability.id,
  ]);
  assert.equal(plan.agentDefinition.data.executionImplementation, undefined);
  assert.deepEqual(plan.agentDefinition.data.hiveAccess.readResources, []);
});
test("v13 validator set is bounded to four records and two additive CRM extensions", () => {
  assert.deepEqual(
    Object.keys(REASONING_VALIDATORS).sort(),
    [
      "reasoning_contexts",
      "reasoning_decisions",
      "scoped_learning",
      "contact_strategy_policies",
      "crm_tasks",
      "events",
    ].sort(),
  );
  assert.equal(
    REASONING_VALIDATORS.reasoning_contexts.$and[0].$jsonSchema
      .additionalProperties,
    false,
  );
});

test("exact immutable knowledge identity, revision, type, hash and workspace are checked without latest substitution", async () => {
  const reference = {
    kind: "offering",
    entityId: id("offering"),
    snapshotId: id("hiverevision"),
    revision: 3,
    contentHash: "a".repeat(64),
  };
  const row = {
    id: reference.snapshotId,
    workspaceId,
    entityType: "offerings",
    entityId: reference.entityId,
    revision: 3,
    snapshot: { contentHash: reference.contentHash },
  };
  const input = { ...context, knowledge: [reference] };
  await checkReasoningReferences(
    "reasoning_contexts",
    input,
    workspaceId,
    async () => row,
  );
  for (const mutation of [
    { revision: 4 },
    { entityId: id("offering") },
    { entityType: "buyer_profiles" },
    { snapshot: { contentHash: "b".repeat(64) } },
    { workspaceId: id("workspace") },
  ]) {
    await assert.rejects(
      checkReasoningReferences(
        "reasoning_contexts",
        input,
        workspaceId,
        async () => ({ ...row, ...mutation }),
      ),
    );
  }
});
test("evidence pins exact persisted content and rejects missing embedded evidence", async () => {
  const { reasoningEvidenceDigest } =
    await import("../src/domain/reasoning-reference-check");
  const row = {
    id: id("event"),
    workspaceId,
    createdAt: at,
    eventType: "observation",
    payload: { reply: false },
  };
  const reference = {
    collection: "events",
    id: row.id,
    contentHash: reasoningEvidenceDigest(row),
  };
  const input = { ...context, evidence: [reference] };
  await checkReasoningReferences(
    "reasoning_contexts",
    input,
    workspaceId,
    async () => row,
  );
  await assert.rejects(
    checkReasoningReferences(
      "reasoning_contexts",
      input,
      workspaceId,
      async () => ({ ...row, payload: { reply: true } }),
    ),
    /evidence/,
  );
  await assert.rejects(
    checkReasoningReferences(
      "reasoning_contexts",
      { ...input, evidence: [{ ...reference, evidenceId: "missing" }] },
      workspaceId,
      async () => row,
    ),
    /evidence/,
  );
});
test("policies require exact workspace/version; unknown methodology cannot substitute latest", async () => {
  const policy = { id: id("contactstrategy"), version: 1 };
  await assert.rejects(
    checkReasoningReferences(
      "reasoning_contexts",
      { ...context, policies: [policy] },
      workspaceId,
      async () => ({ ...policy, workspaceId, version: 2 }),
    ),
    /version/,
  );
  await assert.rejects(
    checkReasoningReferences(
      "reasoning_contexts",
      {
        ...context,
        methodologies: [{ id: id("offermethodology"), version: 1 }],
      },
      workspaceId,
      async () => null,
    ),
    /methodology/,
  );
});

test("Action Offering references cannot substitute an ICP or another knowledge kind", () => {
  const record = {
    workspaceId,
    createdAt: at,
    updatedAt: at,
    id: id("task"),
    title: "Review",
    type: "research",
    status: "pending",
    personId: id("person"),
  };
  assert.throws(() =>
    parseReasoningTask({
      record,
      reasoning: {
        contextId: context.id,
        decisionId: decision.id,
        offerings: [
          {
            kind: "icp",
            entityId: id("icp"),
            snapshotId: id("hiverevision"),
            revision: 1,
            contentHash: "a".repeat(64),
          },
        ],
      },
    }),
  );
});
