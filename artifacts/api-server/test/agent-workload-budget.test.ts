import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { UsageObservationSchema } from "@workspace/agent-runtime-protocol";
import { createAgentWorkloadAuthority } from "../src/authorization/agent-workload";
import {
  decimalAmount,
  decimalUnits,
  remainingCost,
} from "../src/domain/agent-budget";
test("workload principals cannot be forged or shared across authority roots", () => {
  const a = createAgentWorkloadAuthority("dev", ["runtime"]);
  const identity = {
    environment: "dev",
    clientId: "runtime",
    workerId: "worker",
    workloadClass: "agent_runtime",
    scopes: ["claim"],
  };
  const principal = a.authenticated(identity);
  a.require(principal, "claim");
  assert.throws(() => a.require(principal, "outcome"));
  assert.throws(() => a.require({ ...principal }, "claim"));
  assert.throws(() =>
    createAgentWorkloadAuthority("dev", ["runtime"]).require(
      principal,
      "claim",
    ),
  );
  for (const override of [
    { environment: "prod" },
    { clientId: "human" },
    { workloadClass: "human" },
    { scopes: ["*"] },
    { scopes: ["claim", "claim"] },
    { workspaceId: "arbitrary" },
  ])
    assert.throws(() => a.authenticated({ ...identity, ...override }));
  assert.throws(() => principal.scopes.push("outcome"));
});
test("cost arithmetic preserves exact decimals, currencies and unknown reservations", () => {
  assert.equal(decimalAmount(decimalUnits("0.1") + decimalUnits("0.2")), "0.3");
  assert.equal(
    decimalAmount(decimalUnits("999999999999999999.999999999999")),
    "999999999999999999.999999999999",
  );
  for (const invalid of ["-1", "NaN", "1e3", "0.0000000000001"])
    assert.throws(() => decimalUnits(invalid));
  const observation = UsageObservationSchema.parse(
    JSON.parse(
      readFileSync(
        new URL(
          "../../../lib/agent-runtime-protocol/fixtures/usage.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
  );
  const limit = { currency: "GBP", amount: "1" };
  assert.equal(
    remainingCost(limit, [{ amount: "0.4", observations: [], settled: false }]),
    "0.6",
  );
  const unknown = { ...observation, cost: { status: "unknown" as const } };
  assert.equal(
    remainingCost(limit, [
      { amount: "0.4", observations: [unknown], settled: true },
    ]),
    "0.6",
  );
  const known = {
    ...observation,
    cost: {
      status: "provider_confirmed" as const,
      amount: "0.1",
      currency: "GBP",
      source: "provider",
    },
  };
  assert.equal(
    remainingCost(limit, [
      { amount: "0.4", observations: [known], settled: false },
    ]),
    "0.6",
  );
  assert.equal(
    remainingCost(limit, [
      { amount: "0.4", observations: [known], settled: true },
    ]),
    "0.9",
  );
  assert.throws(() =>
    remainingCost({ ...limit, currency: "USD" }, [
      { amount: "0.4", observations: [known], settled: true },
    ]),
  );
  const correction = {
    ...known,
    id: "corrected",
    supersedes: known.id,
    cost: { ...known.cost, amount: "0.2" },
  };
  assert.equal(
    remainingCost(limit, [
      { amount: "0.4", observations: [known, correction], settled: true },
    ]),
    "0.8",
  );
});
