import test from "node:test";
import assert from "node:assert/strict";
import {
  ObservationEvidenceSliceV1Schema,
  ObservationEvaluationLinkV1Schema,
  ObservationActionLinkV1Schema,
  appendObservationEvidence,
  observationSliceDigest,
  matchObservationEvaluation,
} from "../src/domain/observation-evidence";
const id = (prefix: string, n = 0) =>
  `${prefix}_${String(n).padStart(26, "0")}`;
const hash = "a".repeat(64);
const reference = (n = 0) => ({
  collection: "events",
  id: id("event", n),
  contentHash: hash,
});
const slice = () => ({
  schemaVersion: 1,
  scope: {
    workspaceId: id("workspace"),
    correlationKey: "synthetic-window",
    identity: {
      collection: "interaction_identities",
      id: id("interactionidentity"),
      digest: hash,
    },
    context: { id: id("reasoningcontext"), digest: hash },
  },
  events: [reference()],
});
const link = (input = slice()) => ({
  schemaVersion: 1,
  scope: input.scope,
  sliceDigest: observationSliceDigest(input),
  decision: { id: id("reasoningdecision"), digest: hash },
});
test("anonymous identity reference needs no Person or copied knowledge", () => {
  assert.deepEqual(ObservationEvidenceSliceV1Schema.parse(slice()), slice());
  assert(!("personId" in slice().scope));
});
test("bounded accumulation keeps exact order without mutating prior snapshot", () => {
  const a = slice(),
    before = structuredClone(a),
    b = slice();
  b.events = [reference(1), reference(2)];
  const result = appendObservationEvidence(a, b);
  assert.deepEqual(result.events, [reference(), reference(1), reference(2)]);
  assert.deepEqual(a, before);
  assert.notEqual(observationSliceDigest(a), observationSliceDigest(result));
});
test("exact replay is idempotent", () => {
  assert.deepEqual(appendObservationEvidence(slice(), slice()), slice());
});
test("duplicate ID in a supplied slice is rejected, not double-counted", () => {
  const x = slice();
  x.events.push(reference());
  assert.throws(() => ObservationEvidenceSliceV1Schema.parse(x));
});
test("changed payload hash on replay cannot replace admitted evidence", () => {
  const x = slice();
  x.events[0]!.contentHash = "b".repeat(64);
  assert.throws(() => appendObservationEvidence(slice(), x));
});
test("changed embedded evidence selector cannot replace reference", () => {
  const x = slice();
  Object.assign(x.events[0]!, { evidenceId: "different" });
  assert.throws(() => appendObservationEvidence(slice(), x));
});
for (const key of [
  "workspace",
  "window",
  "identity",
  "identity-digest",
  "context",
  "context-digest",
])
  test(`accumulation rejects changed ${key} scope`, () => {
    const x = slice();
    if (key === "workspace") x.scope.workspaceId = id("workspace", 1);
    if (key === "window") x.scope.correlationKey = "other-window";
    if (key === "identity") x.scope.identity.id = id("interactionidentity", 1);
    if (key === "identity-digest") x.scope.identity.digest = "b".repeat(64);
    if (key === "context") x.scope.context.id = id("reasoningcontext", 1);
    if (key === "context-digest") x.scope.context.digest = "b".repeat(64);
    assert.throws(() => appendObservationEvidence(slice(), x));
  });
test("100-reference bound accepted; overflow rejects without truncation", () => {
  const x = slice();
  x.events = Array.from({ length: 100 }, (_, i) => reference(i));
  assert(ObservationEvidenceSliceV1Schema.safeParse(x).success);
  const incoming = slice();
  incoming.events = [reference(100)];
  assert.throws(() => appendObservationEvidence(x, incoming));
  assert.equal(x.events.length, 100);
});
test("empty evidence is representable but does not declare readiness", () => {
  const x = slice();
  x.events = [];
  const parsed = ObservationEvidenceSliceV1Schema.parse(x);
  assert.deepEqual(Object.keys(parsed).sort(), [
    "events",
    "schemaVersion",
    "scope",
  ]);
});
for (const key of [
  "executionGrant",
  "ready",
  "interrupt",
  "consent",
  "personId",
  "rawPayload",
  "cooldownUntil",
])
  test(`slice rejects asserted ${key}`, () => {
    assert(
      !ObservationEvidenceSliceV1Schema.safeParse({ ...slice(), [key]: true })
        .success,
    );
  });
for (const [name, mutate] of [
  [
    "wrong evidence collection",
    (x: ReturnType<typeof slice>) => {
      x.events[0].collection = "people";
    },
  ],
  [
    "wrong event identity",
    (x: ReturnType<typeof slice>) => {
      x.events[0].id = id("person");
    },
  ],
  [
    "malformed hash",
    (x: ReturnType<typeof slice>) => {
      x.events[0].contentHash = "approximately-the-same";
    },
  ],
  [
    "unknown scope authority",
    (x: ReturnType<typeof slice>) => {
      Object.assign(x.scope, { authorized: true });
    },
  ],
  [
    "unsupported contract version",
    (x: ReturnType<typeof slice>) => {
      x.schemaVersion = 2;
    },
  ],
] as const)
  test(name, () => {
    const x = slice();
    mutate(x);
    assert(!ObservationEvidenceSliceV1Schema.safeParse(x).success);
  });
test("evaluation link matches exact recorded slice", () =>
  assert.deepEqual(matchObservationEvaluation(slice(), link()), link()));
test("new evidence never silently updates an earlier evaluation", () => {
  const x = slice();
  x.events.push(reference(1));
  assert.throws(() => matchObservationEvaluation(x, link()));
});
test("same evidence in another scope does not match evaluation", () => {
  const x = link();
  x.scope.correlationKey = "other-window";
  assert.throws(() => matchObservationEvaluation(slice(), x));
});
test("input ordering is exact but never inferred as event-time chronology", () => {
  const x = slice();
  x.events = [reference(1), reference(0)];
  const y = structuredClone(x);
  y.events.reverse();
  assert.notEqual(observationSliceDigest(x), observationSliceDigest(y));
});
test("decision link cannot assert execution or canonical approval", () => {
  for (const key of ["executed", "approved", "effectivenessPass", "grant"])
    assert(
      !ObservationEvaluationLinkV1Schema.safeParse({ ...link(), [key]: true })
        .success,
    );
});
test("cooldown extension seam references task and event, not invented execution", () => {
  const x = {
    schemaVersion: 1,
    evaluation: link(),
    action: { collection: "crm_tasks", id: id("task"), digest: hash },
    actionEvidence: reference(1),
  };
  assert(ObservationActionLinkV1Schema.safeParse(x).success);
  for (const key of ["active", "startsAt", "endsAt", "interruptBypass"])
    assert(
      !ObservationActionLinkV1Schema.safeParse({ ...x, [key]: true }).success,
    );
  assert(
    !ObservationActionLinkV1Schema.safeParse({
      ...x,
      action: { ...x.action, collection: "campaigns" },
    }).success,
  );
});
