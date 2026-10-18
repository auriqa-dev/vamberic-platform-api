import test from "node:test";
import assert from "node:assert/strict";
import {
  digest,
  EvaluationPayloadSchema,
} from "@workspace/agent-runtime-protocol";
import {
  decideEffectiveness,
  EffectivenessPolicySchema,
} from "../src/domain/agent-effectiveness";
import { effectivenessFixture } from "./helpers/effectiveness-fixture";
for (const scenario of [
  { name: "mandatory pass", outcome: "pass", expected: "pass" },
  { name: "remediable failure", outcome: "fail", expected: "revise" },
  { name: "mandatory uncertainty", outcome: "uncertain", expected: "hold" },
  { name: "gap", outcome: "pass", blockingGap: true, expected: "hold" },
  { name: "stale pass", outcome: "pass", fresh: false, expected: "hold" },
  {
    name: "revoked authority",
    outcome: "pass",
    authorized: false,
    expected: "hold",
  },
  {
    name: "no progress",
    outcome: "fail",
    oscillation: true,
    expected: "escalate",
  },
  {
    name: "two revisions exhausted",
    outcome: "fail",
    revision: 3,
    expected: "escalate",
  },
  {
    name: "budget unavailable",
    outcome: "fail",
    canRevise: false,
    expected: "escalate",
  },
  {
    name: "risk uncertainty",
    outcome: "uncertain",
    risk: true,
    expected: "escalate",
  },
  {
    name: "advisory failure",
    outcome: "fail",
    advisory: true,
    expected: "pass",
  },
] as const)
  test("deterministic decision: " + scenario.name, async () => {
    const f = await effectivenessFixture();
    const c = await f.effects.create(f.queen, f.workspaceId, f.request);
    const m = await f.claim(c.rootRunId);
    await f.control.outcome(f.principal, f.lease(m), f.result(m));
    const e = await f.claim(
      f.db.rows("agent_effectiveness_cases")[0]!.activeRunId,
    );
    const payload = EvaluationPayloadSchema.parse(
      f.result(e, scenario.outcome).outcome.content.domainOutput,
    );
    let policy = f.policy;
    const criteria = structuredClone(f.criteria);
    if ("risk" in scenario) {
      const { identity, ...body } = policy;
      body.consequences[0]!.onUncertain = "escalate";
      policy = EffectivenessPolicySchema.parse({
        ...body,
        identity: {
          ...identity,
          digest: digest({
            key: identity.key,
            version: identity.version,
            ...body,
          }),
        },
      });
      payload.policy = policy.identity;
    }
    if ("advisory" in scenario) {
      criteria.criteria[0]!.importance = "advisory";
      const { digest: unused, ...body } = criteria;
      void unused;
      criteria.digest = digest(body);
      payload.criteriaDigest = criteria.digest;
    }
    const decision = decideEffectiveness({
      criteria,
      policy,
      evaluation: payload,
      revision: 1,
      blockingGap: false,
      fresh: true,
      authorized: true,
      canRevise: true,
      oscillation: false,
      ...scenario,
    });
    assert.equal(decision.kind, scenario.expected);
  });
