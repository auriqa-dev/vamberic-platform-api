import assert from "node:assert/strict";
import { test } from "node:test";
import {
  guardDecision,
  nbaHash,
  nbaRequest,
  capabilityResult,
  type DecisionContext,
  type NbaDecision,
} from "../src/services/nba/model";
import { outputSchema } from "../src/services/content-strategy/generate";
import { resultSchemas } from "../src/services/content-strategy/model";
const now = new Date("2026-10-16T12:00:00.000Z");
const context: DecisionContext = {
  workspaceId: "w",
  campaignId: "c",
  campaignVersion: 1,
  brandId: "b",
  subject: { type: "campaign" },
  mode: "both",
  versions: [],
  evidenceIds: ["known"],
  offerIds: ["offer"],
  blockers: [],
  suppressed: false,
  existingRelationship: false,
  competingClaims: [],
  availableActions: ["wait", "no_action", "human_review"],
  data: {},
};
const decision: NbaDecision = {
  action: "no_action",
  outcome: "No action is currently appropriate",
  offerId: "offer",
  reason: "Current evidence is insufficient",
  alternatives: ["Request research"],
  evidenceIds: ["known"],
  missingInformation: [],
  dueAt: null,
  awaitEvent: null,
  instruction: "",
};
test("NBA preserves useful recommendations but blocks unavailable capabilities and acquisition without a person", () => {
  const r = guardDecision({ ...decision, action: "communicate" }, context, now);
  assert.equal(r.state, "blocked");
  assert.equal(r.decision.action, "communicate");
  assert.equal(r.blockers.length, 2);
});
test("NBA denies invented offer and evidence references", () => {
  assert.throws(() =>
    guardDecision({ ...decision, offerId: "foreign" }, context, now),
  );
  assert.throws(() =>
    guardDecision({ ...decision, evidenceIds: ["foreign"] }, context, now),
  );
});
test("NBA suppression and management conflict cannot be overruled by the model", () => {
  const r = guardDecision(
    { ...decision, action: "request_evidence" },
    {
      ...context,
      subject: { type: "person", id: "p" },
      suppressed: true,
      competingClaims: ["other"],
      availableActions: ["request_evidence"],
    },
    now,
  );
  assert.equal(r.state, "blocked");
  assert.equal(r.blockers.length, 2);
});
test("waiting requires a future time or named event", () => {
  assert.equal(
    guardDecision({ ...decision, action: "wait" }, context, now).state,
    "blocked",
  );
  assert.equal(
    guardDecision(
      { ...decision, action: "wait", awaitEvent: "interaction" },
      context,
      now,
    ).state,
    "proposed",
  );
  assert.equal(
    guardDecision(
      { ...decision, action: "wait", dueAt: "2026-10-15T12:00:00.000Z" },
      context,
      now,
    ).state,
    "blocked",
  );
});
test("relationship-only mode cannot start acquisition discovery", () => {
  assert.match(
    guardDecision(
      { ...decision, action: "discover_organisations" },
      { ...context, mode: "engagement_management" },
      now,
    ).blockers.join(" "),
    /existing relationships/,
  );
});
test("preview contract cannot carry execution authority", () => {
  assert.equal(
    nbaRequest.safeParse({
      requestKey: "9b33a6f8-b859-4fc4-9137-7fa82600471e",
      campaignId: "campaign",
      campaignVersion: 1,
      subject: { type: "campaign" },
      instruction: "Preview",
      send: true,
    }).success,
    false,
  );
});
test("context fingerprints are stable across object key ordering", () => {
  assert.equal(
    nbaHash({ a: 1, b: { d: 4, c: 3 } }),
    nbaHash({ b: { c: 3, d: 4 }, a: 1 }),
  );
  assert.notEqual(nbaHash({ version: 1 }), nbaHash({ version: 2 }));
});
test("NBA uses the existing closed structured output path", () => {
  const schema = outputSchema(resultSchemas.nba);
  assert.equal(schema.additionalProperties, false);
  assert.ok(Array.isArray(schema.required));
});
test("uncertain capability outcome retains reconciliation requirement", () => {
  assert.equal(
    capabilityResult.parse({ workspaceId: "workspace", decisionId: "decision", decisionVersion: 1,
      schemaVersion: 1,
      correlationId: "d",
      idempotencyKey: "k",
      status: "uncertain",
      evidenceIds: [],
      summary: "Provider result unknown",
      retry: "reconcile",
      errorCode: "timeout",
      usage: {
        model: null,
        inputTokens: 0,
        outputTokens: 0,
        externalUnits: null,
      },
    }).retry,
    "reconcile",
  );
});

test("policy timestamp changes invalidate context fingerprints",()=>{assert.notEqual(nbaHash({updatedAt:new Date("2026-10-16T12:00:00.000Z")}),nbaHash({updatedAt:new Date("2026-10-16T12:01:00.000Z")}));});

test("public event insertion cannot forge NBA decisions, claims, frontier or receipts",async()=>{
  const {EventInsertSchema}=await import("../src/domain/schemas");
  for(const eventType of ["nba_decision","nba_claim","nba_frontier","nba_capability_result"])
    assert.equal(EventInsertSchema.safeParse({eventType,occurredAt:new Date(),payload:{}}).success,false);
});

test("internal evidence exception cannot enable discovery or outreach or override another engagement", () => {
  const internal = {...context,subject:{type:"organisation" as const,id:"org"},suppressed:true,internalResearchAllowed:true,availableActions:["request_evidence","discover_organisations","communicate"] as const};
  assert.equal(guardDecision({...decision,action:"request_evidence"},internal,now).state,"proposed");
  for(const action of ["discover_organisations","communicate"] as const)
    assert.equal(guardDecision({...decision,action},internal,now).state,"blocked");
  assert.equal(guardDecision({...decision,action:"request_evidence"},{...internal,competingClaims:["other"]},now).state,"blocked");
});


test("policy enforcement rejects restrictive, unsupported, stale and mismatched custom assessments", async () => {
  const { planStrategyTemplates, templateSource } = await import("../src/services/contact-strategy/provision");
  const { generatePlatformId } = await import("../src/domain");
  const { policyDecisionHash } = await import("../src/services/nba/model");
  const w = generatePlatformId("workspace");
  const policy = planStrategyTemplates(w, [], now).created[0];
  policy.status = "recorded";
  policy.key = "custom_" + "a".repeat(32);
  policy.source.reference = templateSource(policy.key, 1);
  const ctx = { ...context, workspaceId: w, contactStrategies: [policy], availableActions: ["request_evidence" as const] };
  const base = { ...decision, action: "request_evidence" as const };
  const assessment = { policyId: policy.id, version: policy.version, action: base.action, offerId: base.offerId,
    applies: true, effect: "permitted", reason: "Known evidence supports internal review", evidenceIds: ["known"] };
  const evaluated = (patch: any = {}, change: any = {}) => guardDecision({ ...base,
    policyContextHash: policyDecisionHash(base, ctx), policyAssessments: [{ ...assessment, ...patch }], ...change }, ctx, now);
  assert.equal(evaluated().state, "proposed");
  for (const effect of ["prohibited", "deferred", "escalated"]) assert.equal(evaluated({effect}).state, "blocked");
  for (const patch of [{version: 999}, {evidenceIds: []}, {evidenceIds: ["foreign"]}, {action: "communicate"}, {offerId: null}])
    assert.equal(evaluated(patch).state, "blocked");
  assert.equal(evaluated({}, { instruction: "Different action instructions" }).state, "blocked");
  assert.equal(evaluated({}, { policyAssessments: [assessment, assessment] }).state, "blocked");
  assert.equal(evaluated({ applies: false, evidenceIds: [] }).state, "blocked");
  assert.equal(evaluated({ applies: false }).state, "proposed");
  assert.equal(guardDecision({ ...decision, action: "human_review" }, { ...ctx, availableActions: ["human_review"] }, now).state, "review_required");
});
