import test from "node:test";
import assert from "node:assert/strict";
import { digest } from "@workspace/agent-runtime-protocol";
import type { Document } from "mongodb";
import {
  ACTION_LIBRARY_SCHEMAS,
  ActionDefinitionSchema,
  ActionTypeSchema,
  assertImmutableActionRevision,
  assertActionTypeTransition,
  actionDefinitionHash,
  actionTypeHash,
  ReasoningDecisionV17Schema,
  parseActionTask,
} from "../src/domain/action-library";
import { actionReferenceChecks } from "../src/domain/action-library-references";
import { actionFixture, actionId } from "./helpers/action-library-fixture";
const f = actionFixture();
for (const [collection, value] of Object.entries({
  action_types: f.type,
  action_definitions: f.row,
  action_definition_revisions: f.snapshot,
})) {
  const schema =
    ACTION_LIBRARY_SCHEMAS[collection as keyof typeof ACTION_LIBRARY_SCHEMAS];
  test(`${collection}: valid strict record`, () =>
    assert.ok(schema.safeParse(value).success));
  for (const field of [
    "nextActionId",
    "workflow",
    "sequence",
    "funnelStage",
    "permissions",
    "executionGrant",
  ])
    test(`${collection}: rejects ${field}`, () =>
      assert.equal(
        schema.safeParse({ ...value, [field]: "forbidden" }).success,
        false,
      ));
}
test("global catalogue rejects workspace business ownership", () =>
  assert.equal(
    ActionTypeSchema.safeParse({ ...f.type, workspaceId: f.row.workspaceId })
      .success,
    false,
  ));
test("independent wait/stop/research possibilities need no executor or resource", () => {
  for (const name of [
    "Wait",
    "No action",
    "Stop activity",
    "Research",
    "Escalate to human",
  ]) {
    const row = structuredClone(f.row);
    row.definition.name = name;
    row.contentHash = actionDefinitionHash(row);
    assert.ok(ActionDefinitionSchema.safeParse(row).success);
  }
});
test("semantic time and approval boundaries fail closed", () => {
  for (const mutate of [
    (r: typeof f.row) => {
      r.definition.availability.startsAt = new Date("2030-02-01");
      r.definition.availability.endsAt = new Date("2030-01-01");
    },
    (r: typeof f.row) => {
      r.approvedRevision = 2;
    },
    (r: typeof f.row) => {
      delete r.approvedBy;
    },
    (r: typeof f.row) => {
      r.updatedAt = new Date("2020-01-01");
    },
  ]) {
    const r = structuredClone(f.row);
    mutate(r);
    r.contentHash = actionDefinitionHash(r);
    assert.equal(ActionDefinitionSchema.safeParse(r).success, false);
  }
});
test("published types and approved snapshots retain immutable content", () => {
  assertImmutableActionRevision(f.snapshot, structuredClone(f.snapshot));
  const changed = structuredClone(f.snapshot);
  changed.snapshot.definition.purpose = "Changed";
  changed.snapshot.contentHash = actionDefinitionHash(changed.snapshot);
  assert.throws(() => assertImmutableActionRevision(f.snapshot, changed));
  const next = structuredClone(f.type);
  next.data.description = "Changed";
  next.contentHash = actionTypeHash(next);
  assert.throws(() => assertActionTypeTransition(f.type, next));
  const retired = {
    ...f.type,
    status: "retired",
    archived: true,
    archivedAt: f.type.updatedAt,
  };
  assert.doesNotThrow(() => assertActionTypeTransition(f.type, retired));
});
test("exact references are scoped, digest pinned and never fetch external resources", async () => {
  const rows: Record<string, Document> = {
    action_types: f.type,
    action_definitions: f.row,
    action_definition_revisions: f.snapshot,
  };
  const checks = actionReferenceChecks(f.row.workspaceId, async (c, id) => {
    const row = rows[c];
    return row?.id === id ? row : null;
  });
  await checks.definition(f.row);
  await checks.revision(f.reference);
  await assert.rejects(
    checks.revision({ ...f.reference, contentHash: digest("wrong") }),
  );
  await assert.rejects(
    actionReferenceChecks(
      "workspace_00000000000000000000000001",
      async (c) => rows[c] ?? null,
    ).definition(f.row),
  );
  rows.action_types = { ...f.type, workspaceId: f.row.workspaceId };
  await assert.rejects(checks.definition(f.row));
  rows.action_types = f.type;
  rows.action_definition_revisions = {
    ...f.snapshot,
    workspaceId: "workspace_00000000000000000000000001",
  };
  await assert.rejects(checks.revision(f.reference));
  const external = structuredClone(f.row);
  external.definition.resources = [
    {
      kind: "external_descriptor",
      label: "A future experience",
      resourceType: "webinar",
      locator: "https://example.test/event",
    },
  ];
  external.contentHash = actionDefinitionHash(external);
  await checks.definition(external);
  external.definition.resources[0] = {
    kind: "external_descriptor",
    label: "Unsafe",
    resourceType: "video",
    locator: "https://user:password@example.test/",
  };
  external.contentHash = actionDefinitionHash(external);
  assert.equal(ActionDefinitionSchema.safeParse(external).success, false);
});
const decision = {
  id: actionId("reasoningdecision"),
  workspaceId: f.row.workspaceId,
  createdAt: f.row.createdAt,
  updatedAt: f.row.createdAt,
  source: { kind: "human", reference: "synthetic" },
  contextId: actionId("reasoningcontext"),
  candidates: [{ key: "wait", description: "Wait" }],
  explanation: "Synthetic",
  evidence: [],
  confidence: 0.5,
  priority: "normal",
  authorityLevel: "recommendation",
  authorityEvidence: [],
  constraints: [],
  policies: [],
  status: "recorded",
  decidedAt: f.row.createdAt,
};
test("historical decisions and tasks remain valid without library references", () => {
  assert.ok(ReasoningDecisionV17Schema.safeParse(decision).success);
  const linked = {
    ...decision,
    candidates: [{ ...decision.candidates[0], action: f.reference }],
  };
  assert.ok(ReasoningDecisionV17Schema.safeParse(linked).success);
  const record = {
    id: actionId("task"),
    workspaceId: f.row.workspaceId,
    title: "Synthetic",
    type: "other",
    status: "pending",
    createdAt: f.row.createdAt,
    updatedAt: f.row.updatedAt,
    personId: actionId("person"),
  };
  const reasoning = {
    contextId: decision.contextId,
    decisionId: decision.id,
    offerings: [],
  };
  assert.ok(parseActionTask({ record, reasoning }));
  assert.ok(
    parseActionTask({
      record,
      reasoning: { ...reasoning, action: f.reference },
    }),
  );
  assert.throws(() =>
    parseActionTask({ record: { ...record, workflow: [] }, reasoning }),
  );
});

test("approved Action opens an exact successor before draft edits", async () => {
  const { assertActionDefinitionTransition } =
    await import("../src/domain/action-library");
  const next = {
    ...f.row,
    status: "draft",
    revision: 2,
    approvedRevision: 1,
    approvedAt: undefined,
    approvedBy: undefined,
    updatedAt: new Date(f.row.updatedAt.getTime() + 1),
  };
  assert.doesNotThrow(() => assertActionDefinitionTransition(f.row, next));
  const changed = structuredClone(next);
  changed.definition.name = "Changed at reopen";
  changed.contentHash = actionDefinitionHash(changed);
  assert.throws(() => assertActionDefinitionTransition(f.row, changed));
  assert.throws(() =>
    assertActionDefinitionTransition(f.row, { ...next, revision: 3 }),
  );
  assert.throws(() =>
    assertActionDefinitionTransition(f.row, {
      ...next,
      workspaceId: "workspace_00000000000000000000000001",
    }),
  );
});
test("Decision and task links resolve an exact same-workspace selected revision", async () => {
  const linked = {
    ...decision,
    selectedCandidateKey: "wait",
    candidates: [{ ...decision.candidates[0], action: f.reference }],
  };
  const rows: Record<string, Document> = {
    action_types: f.type,
    action_definitions: f.row,
    action_definition_revisions: f.snapshot,
    reasoning_contexts: {
      id: decision.contextId,
      workspaceId: f.row.workspaceId,
    },
    reasoning_decisions: linked,
  };
  const check = actionReferenceChecks(f.row.workspaceId, async (c, id) =>
    rows[c]?.id === id ? rows[c]! : null,
  );
  await check.decision(linked);
  const record = {
    id: actionId("task"),
    workspaceId: f.row.workspaceId,
    title: "Synthetic",
    type: "other",
    status: "pending",
    createdAt: f.row.createdAt,
    updatedAt: f.row.updatedAt,
    personId: actionId("person"),
  };
  const reasoning = {
    contextId: decision.contextId,
    decisionId: decision.id,
    offerings: [],
    action: f.reference,
  };
  await check.task({ record, reasoning });
  rows.reasoning_decisions = { ...linked, selectedCandidateKey: undefined };
  await assert.rejects(check.task({ record, reasoning }));
  rows.reasoning_contexts = {
    id: decision.contextId,
    workspaceId: "workspace_00000000000000000000000001",
  };
  await assert.rejects(check.decision(linked));
});

test("approval pins draft content and retirement preserves approval provenance", async () => {
  const { assertActionDefinitionTransition } =
    await import("../src/domain/action-library");
  const at = new Date(f.row.updatedAt.getTime() + 1);
  const draft = {
    ...f.row,
    status: "draft",
    approvedAt: undefined,
    approvedBy: undefined,
    approvedRevision: undefined,
  };
  assert.doesNotThrow(() =>
    assertActionDefinitionTransition(draft, { ...f.row, updatedAt: at }),
  );
  const changed = {
    ...f.row,
    updatedAt: at,
    definition: { ...f.row.definition, name: "Changed during approval" },
  };
  assert.throws(() =>
    assertActionDefinitionTransition(draft, {
      ...changed,
      contentHash: actionDefinitionHash(changed),
    }),
  );
  const retired = {
    ...f.row,
    status: "retired",
    archived: true,
    archivedAt: at,
    updatedAt: at,
  };
  assert.doesNotThrow(() => assertActionDefinitionTransition(f.row, retired));
  assert.throws(() =>
    assertActionDefinitionTransition(f.row, {
      ...retired,
      approvedBy: { ...f.row.approvedBy!, id: "another" },
    }),
  );
});
for (const kind of ["offer", "offering"] as const) {
  test(`${kind} resources pin approved exact revision and workspace`, async () => {
    const ref = {
      kind,
      entityId: actionId(kind),
      snapshotId: actionId(kind === "offer" ? "offerrevision" : "hiverevision"),
      revision: 1,
      contentHash: "a".repeat(64),
    };
    const row = {
      ...f.row,
      definition: {
        ...f.row.definition,
        resources: [{ kind: "knowledge", reference: ref }],
      },
    };
    const input = { ...row, contentHash: actionDefinitionHash(row as never) };
    const snapshot: Document = {
      id: ref.snapshotId,
      workspaceId: f.row.workspaceId,
      ...(kind === "offer"
        ? { offerId: ref.entityId }
        : { entityId: ref.entityId, entityType: "offerings" }),
      revision: 1,
      snapshot: {
        workspaceId: f.row.workspaceId,
        contentHash: ref.contentHash,
        status: "approved",
      },
    };
    const check = actionReferenceChecks(
      f.row.workspaceId,
      async (collection) => (collection === "action_types" ? f.type : snapshot),
    );
    await check.definition(input);
    snapshot.revision = 2;
    await assert.rejects(check.definition(input));
    snapshot.revision = 1;
    snapshot.snapshot.contentHash = "b".repeat(64);
    await assert.rejects(check.definition(input));
    snapshot.snapshot.contentHash = ref.contentHash;
    snapshot.workspaceId = actionId("other");
    await assert.rejects(check.definition(input));
  });
}
