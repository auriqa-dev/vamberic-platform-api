import test from "node:test";
import assert from "node:assert/strict";
import type { Document } from "mongodb";
import { digestWithout } from "@workspace/agent-runtime-protocol";
import { operatingFixtures } from "./helpers/operating-fixtures";
import { effectivenessFixture } from "./helpers/effectiveness-fixture";
import { OperatingSchemas } from "../src/domain/operating";
import { EffectivenessCaseSchema } from "../src/domain/agent-effectiveness";
import {
  AgentRunSchema,
  AgentResultSchema,
} from "../src/domain/agent-control-plane";
import { EFFECTIVENESS_VALIDATORS } from "../src/db/agent-effectiveness-validators";
import { agentMongoParity } from "./helpers/agent-mongo-parity";
async function cases() {
  const f = await effectivenessFixture();
  const c = await f.effects.create(f.queen, f.workspaceId, f.request);
  const m = await f.claim(c.rootRunId);
  await f.control.outcome(f.principal, f.lease(m), f.result(m));
  const e = await f.claim(
    f.db.rows("agent_effectiveness_cases")[0]!.activeRunId,
  );
  await f.control.outcome(f.principal, f.lease(e), f.result(e));
  const schemas: Record<
    string,
    { safeParse(v: unknown): { success: boolean } }
  > = {
    agent_effectiveness_cases: EffectivenessCaseSchema,
    agent_definitions: OperatingSchemas.agent_definitions,
    pricing_recommendations: OperatingSchemas.pricing_recommendations,
    swarm_agreements: OperatingSchemas.swarm_agreements,
    agent_runs: AgentRunSchema,
    agent_results: AgentResultSchema,
  };
  const out: {
    collection: string;
    name: string;
    document: Document;
    valid: boolean;
  }[] = [];
  function add(
    collection: string,
    name: string,
    document: Document,
    valid: boolean,
  ) {
    assert.equal(schemas[collection]!.safeParse(document).success, valid, name);
    out.push({ collection, name, document, valid });
  }
  const state = structuredClone(f.db.rows("agent_effectiveness_cases")[0]!);
  delete state._id;
  add("agent_effectiveness_cases", "valid passed", state, true);
  const mutations: Record<string, (d: Document) => void> = {
    "extra field": (d) => {
      d.unknown = true;
    },
    "wrong workspace type": (d) => {
      d.workspaceId = "bad";
    },
    "wrong target": (d) => {
      d.target.kind = "swarm";
    },
    "manual override": (d) => {
      d.policy.manualOverride = true;
    },
    "candidate case": (d) => {
      d.candidates[0].reference.caseId = "another";
    },
    "candidate ordinal": (d) => {
      d.candidates[0].reference.revision = 2;
    },
    "duplicate allocation": (d) => {
      d.allocations.push(d.allocations[0]);
    },
    "duplicate request": (d) => {
      d.evaluations.push(d.evaluations[0]);
    },
    "late creation": (d) => {
      d.createdAt = new Date("2040-01-01");
    },
    "bad date": (d) => {
      d.createdAt = "invalid";
    },
    "profile mismatch": (d) => {
      d.definition.profile.version += 1;
    },
    "role collision": (d) => {
      d.definition.evaluator = d.definition.maker;
    },
    "revision bound": (d) => {
      d.definition.maxRevisions = 3;
    },
    "candidate bound": (d) => {
      d.candidates = Array(4).fill(d.candidates[0]);
    },
    "evaluation bound": (d) => {
      d.evaluations = Array(9).fill(d.evaluations[0]);
    },
    "allocation bound": (d) => {
      d.allocations = Array(12).fill(d.allocations[0]);
    },
    "utf16 bounds": (d) => {
      d.requesterClientId = "😀".repeat(60);
    },
  };
  for (const [name, change] of Object.entries(mutations)) {
    const d = structuredClone(state);
    change(d);
    add("agent_effectiveness_cases", name, d, false);
  }
  const boundaries: [string, boolean, (d: Document) => void][] = [
    [
      "request key maximum",
      true,
      (d) => {
        d.requestKey = "x".repeat(100);
      },
    ],
    [
      "request key over maximum",
      false,
      (d) => {
        d.requestKey = "x".repeat(101);
      },
    ],
    [
      "request key empty",
      false,
      (d) => {
        d.requestKey = "";
      },
    ],
    [
      "state revision maximum",
      true,
      (d) => {
        d.stateRevision = 1_000_000;
      },
    ],
    [
      "state revision over maximum",
      false,
      (d) => {
        d.stateRevision = 1_000_001;
      },
    ],
    [
      "state revision fractional",
      false,
      (d) => {
        d.stateRevision = 1.5;
      },
    ],
    [
      "missing authority",
      false,
      (d) => {
        delete d.authority;
      },
    ],
    [
      "unknown authority field",
      false,
      (d) => {
        d.authority.scope = "all";
      },
    ],
    [
      "missing active allocation",
      false,
      (d) => {
        d.activeRunId = f.db
          .rows("agent_runs")[0]
          .id.replace(/.$/, (last: string) => (last === "0" ? "1" : "0"));
      },
    ],
    [
      "allocation deadline at ceiling",
      true,
      (d) => {
        d.allocations[0].budget.deadline = d.totalBudget.deadline;
      },
    ],
    [
      "allocation deadline beyond ceiling",
      false,
      (d) => {
        d.allocations[0].budget.deadline = "2099-01-01T00:00:00.000Z";
      },
    ],
    [
      "pass without decision",
      false,
      (d) => {
        d.decisions = [];
      },
    ],
    [
      "pass without accepted evaluation",
      false,
      (d) => {
        delete d.evaluations[0].resultId;
      },
    ],
    [
      "evaluation unknown candidate",
      false,
      (d) => {
        d.evaluations[0].candidateRevision = 3;
      },
    ],
    [
      "evaluation maker role",
      false,
      (d) => {
        d.evaluations[0].runId = d.rootRunId;
      },
    ],
    [
      "candidate evaluator role",
      false,
      (d) => {
        d.candidates[0].reference.runId = d.evaluations[0].runId;
      },
    ],
    [
      "policy identity mismatch",
      false,
      (d) => {
        d.definition.policy.version++;
      },
    ],
    [
      "decisions maximum",
      true,
      (d) => {
        d.decisions = Array(16).fill(d.decisions[0]);
      },
    ],
    [
      "decisions over maximum",
      false,
      (d) => {
        d.decisions = Array(17).fill(d.decisions[0]);
      },
    ],
    [
      "candidate addressed defect maximum",
      true,
      (d) => {
        d.candidates[0].addressedDefects = ["x".repeat(200)];
      },
    ],
    [
      "candidate addressed defect over maximum",
      false,
      (d) => {
        d.candidates[0].addressedDefects = ["x".repeat(201)];
      },
    ],
    [
      "candidate addressed defect utf16 maximum",
      true,
      (d) => {
        d.candidates[0].addressedDefects = ["😀".repeat(100)];
      },
    ],
    [
      "candidate addressed defect utf16 over maximum",
      false,
      (d) => {
        d.candidates[0].addressedDefects = ["😀".repeat(101)];
      },
    ],
    [
      "null candidates",
      false,
      (d) => {
        d.candidates = null;
      },
    ],
  ];
  for (const [name, valid, mutate] of boundaries) {
    const d = structuredClone(state);
    mutate(d);
    add("agent_effectiveness_cases", name, d, valid);
  }
  for (const row of f.db.rows("agent_runs")) {
    const d = structuredClone(row);
    delete d._id;
    add("agent_runs", "linked " + row.operation, d, true);
    const bad = structuredClone(d);
    bad.effectiveness.ordinal = 12;
    add("agent_runs", "bad link ordinal", bad, false);
  }
  for (const row of f.db.rows("agent_results")) {
    const d = structuredClone(row);
    delete d._id;
    add("agent_results", "accepted " + row.id, d, true);
    if (
      d.envelope.outcome.content.domainOutput.kind ===
      "effectiveness_evaluation"
    )
      for (const [name, change] of Object.entries<
        Record<string, (d: Document) => void>
      >({
        duplicate: (d) => d.assessments.push(d.assessments[0]),
        extra: (d) => {
          d.overall = "pass";
        },
        badOutcome: (d) => {
          d.assessments[0].outcome = "approved";
        },
        badDefect: (d) => {
          d.defects = [
            {
              criterionId: "useful",
              findingId: "missing",
              type: "failure",
              location: "answer",
              requirement: "Fix",
            },
          ];
        },
      })) {
        const bad = structuredClone(d);
        change(bad.envelope.outcome.content.domainOutput);
        bad.envelope.payloadDigest = digestWithout(
          bad.envelope,
          "payloadDigest",
        );
        add("agent_results", name, bad, false);
      }
  }
  const definition = structuredClone(f.db.rows("agent_definitions")[0]!);
  delete definition._id;
  add("agent_definitions", "reviewed Effectiveness metadata", definition, true);
  for (const [name, mutate] of Object.entries<
    Record<string, (d: Document) => void>
  >({
    roleCollision: (d) => {
      d.data.effectiveness[0].maker = d.data.effectiveness[0].evaluator;
    },
    manualDisable: (d) => {
      d.data.effectiveness[0].required = false;
    },
    revisionCeiling: (d) => {
      d.data.effectiveness[0].maxRevisions = 3;
    },
  })) {
    const changed = structuredClone(definition);
    mutate(changed);
    add("agent_definitions", name, changed, false);
  }
  const operating = operatingFixtures();
  for (const collection of [
    "agent_definitions",
    "pricing_recommendations",
    "swarm_agreements",
  ] as const) {
    const baseline = structuredClone(operating[collection]);
    const data = (d: Document) =>
      collection === "agent_definitions"
        ? d.data
        : collection === "pricing_recommendations"
          ? d.data.configurationSnapshot.agents[0].definition
          : d.data.recommendationSnapshot.configurationSnapshot.agents[0]
              .definition;
    const metadata = definition.data.effectiveness[0];
    for (const [name, count, valid] of [
      ["one reviewed bundle", 1, true],
      ["six reviewed bundles", 6, true],
      ["seven bundles rejected", 7, false],
    ] as const) {
      const d = structuredClone(baseline);
      data(d).effectiveness = Array(count).fill(metadata);
      add(collection, name, d, valid);
    }
    for (const [name, mutate] of Object.entries<
      Record<string, (d: Document) => void>
    >({
      "nested role collision": (d) => {
        d.maker = d.evaluator;
      },
      "nested third revision": (d) => {
        d.maxRevisions = 3;
      },
      "nested disabled requirement": (d) => {
        d.required = false;
      },
    })) {
      const d = structuredClone(baseline);
      data(d).effectiveness = [structuredClone(metadata)];
      mutate(data(d).effectiveness[0]);
      add(collection, name, d, false);
    }
  }
  for (const collection of [
    "agent_definitions",
    "pricing_recommendations",
    "swarm_agreements",
  ] as const) {
    const d = structuredClone(operating[collection]);
    const data =
      collection === "agent_definitions"
        ? d.data
        : collection === "pricing_recommendations"
          ? d.data.configurationSnapshot.agents[0].definition
          : d.data.recommendationSnapshot.configurationSnapshot.agents[0]
              .definition;
    data.executionImplementation = {
      ...definition.data.executionImplementation,
      protocolVersion: "1.2",
    };
    add(collection, "Protocol 1.2 definition snapshot", d, true);
  }
  return out;
}
test("v11 Effectiveness persistence fixtures and local invalid boundaries", async () => {
  assert.equal((await cases()).length, 77);
});
test(
  "read-only v11 Effectiveness Mongo validator parity",
  { skip: process.env.AGENT_MONGO_PARITY !== "1" },
  async () => {
    await agentMongoParity(await cases(), EFFECTIVENESS_VALIDATORS);
  },
);
