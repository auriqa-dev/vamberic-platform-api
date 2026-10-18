import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import type { Document } from "mongodb";
import { agentMongoParity } from "./helpers/agent-mongo-parity";
import { digest, digestWithout } from "@workspace/agent-runtime-protocol";
import { generatePlatformId } from "../src/domain/ids";
import {
  AgentRunSchema,
  AgentAttemptSchema,
  AgentResultSchema,
  AgentUsageSchema,
  parseFrozenWork,
} from "../src/domain/agent-control-plane";
import { AGENT_CONTROL_PLANE_VALIDATORS } from "../src/db/agent-control-plane-validators";
const wire = (name: string): Document =>
  JSON.parse(
    readFileSync(
      new URL(
        `../../../lib/agent-runtime-protocol/fixtures/${name}.json`,
        import.meta.url,
      ),
      "utf8",
    ),
  );
const work = wire("claimedWork");
const runId = generatePlatformId("agentrun");
const attemptId = generatePlatformId("agentattempt");
function replace(value: Document): Document {
  return JSON.parse(
    JSON.stringify(value, (_key, v) =>
      v === work.runId ? runId : v === work.attemptId ? attemptId : v,
    ),
  );
}
const raw = replace(work);
for (const key of ["attemptId", "generation", "fence", "lease", "resume"])
  delete raw[key];
const frozen = parseFrozenWork(raw);
const at = new Date("2030-01-01T00:00:00.000Z");
const common = { createdAt: at, updatedAt: at, workspaceId: work.workspaceId };
const envelope = replace(wire("success"));
envelope.payloadDigest = digestWithout(envelope, "payloadDigest");
const schemas = {
  agent_runs: AgentRunSchema,
  agent_attempts: AgentAttemptSchema,
  agent_results: AgentResultSchema,
  agent_usage_observations: AgentUsageSchema,
};
const fixtures: Record<string, Document> = {
  agent_runs: AgentRunSchema.parse({
    ...common,
    id: runId,
    organisationId: work.clientId,
    requester: {
      type: "human",
      issuer: "https://identity.example.test/pool",
      id: "synthetic",
    },
    requesterClientId: "synthetic-client",
    authority: { basis: "partner" },
    target: {
      kind: "client_agent",
      id: work.clientAgent.id,
      revision: work.clientAgent.revision,
    },
    operation: work.operation,
    requestKey: "fixture",
    requestDigest: digest("fixture"),
    frozen,
    manifest: wire("manifest"),
    frozenDigest: digest(frozen),
    status: "queued",
    generation: 1,
    fence: 0,
    attemptCount: 0,
    failures: 0,
    inputCycles: 0,
    continuations: 0,
    limits: { attempts: 2, failures: 1, inputCycles: 1, continuations: 1 },
    deadline: new Date("2030-01-02"),
    notBefore: at,
    dispatch: { id: "fixture", generation: 1, fence: 0 },
  }),
  agent_attempts: AgentAttemptSchema.parse({
    ...common,
    id: attemptId,
    runId,
    ordinal: 1,
    generation: 1,
    fence: 1,
    reason: "initial",
    status: "running",
    claimId: "fixture",
    workerId: "fixture",
    workloadClientId: "fixture",
    leaseId: "fixture",
    leaseUntil: new Date("2030-01-01T00:01:00Z"),
    startedAt: at,
    reservedCost: "0",
  }),
  agent_results: AgentResultSchema.parse({
    ...common,
    id: generatePlatformId("agentresult"),
    runId,
    attemptId,
    envelope,
    dispositions: envelope.outcome.content.proposals.map((p: Document) => ({
      proposalId: p.id,
      status: "pending",
    })),
  }),
};
const observation = envelope.usage[0];
fixtures.agent_usage_observations = AgentUsageSchema.parse({
  ...common,
  id: generatePlatformId("agentusage"),
  runId,
  attemptId,
  observation,
  contentDigest: digest(observation),
});
const cases: {
  name: string;
  collection: keyof typeof schemas;
  document: Document;
  valid: boolean;
}[] = [];
function add(
  collection: keyof typeof schemas,
  name: string,
  mutate: (row: Document) => void,
  valid = false,
) {
  const document = structuredClone(fixtures[collection]!);
  mutate(document);
  try {
    if (collection === "agent_results")
      document.envelope.payloadDigest = digestWithout(
        document.envelope,
        "payloadDigest",
      );
    if (collection === "agent_usage_observations")
      document.contentDigest = digest(document.observation);
    if (collection === "agent_runs")
      document.frozenDigest = digest(document.frozen);
  } catch {
    /* Invalid JSON fixtures must reach both validators unchanged. */
  }
  cases.push({ collection, name, document, valid });
}
for (const collection of Object.keys(schemas) as (keyof typeof schemas)[]) {
  add(collection, "valid", () => {}, true);
  add(collection, "invalid ID", (r) => {
    r.id = "bad";
  });
  add(collection, "unknown field", (r) => {
    r.hidden = "not stored";
  });
  add(collection, "missing workspace", (r) => {
    delete r.workspaceId;
  });
  add(collection, "null workspace", (r) => {
    r.workspaceId = null;
  });
  add(collection, "chronology", (r) => {
    r.updatedAt = new Date(r.createdAt.getTime() - 1);
  });
}
add("agent_runs", "running without Attempt", (r) => {
  r.status = "running";
});
add("agent_runs", "terminal without reason", (r) => {
  r.status = "failed";
});
add("agent_runs", "dispatch generation differs", (r) => {
  r.dispatch.generation++;
});
add("agent_runs", "wrong frozen workspace", (r) => {
  r.workspaceId = generatePlatformId("workspace");
});
add("agent_attempts", "ended missing", (r) => {
  r.status = "succeeded";
});
add("agent_attempts", "zero lease", (r) => {
  r.leaseUntil = r.startedAt;
});
add("agent_results", "missing disposition", (r) => {
  r.dispositions.pop();
});
add("agent_results", "pending actor forbidden", (r) => {
  r.dispositions[0].actor = fixtures.agent_runs!.requester;
});
add("agent_results", "unresolved evidence reference", (r) => {
  r.envelope.outcome.content.proposals[0].evidenceIds = ["absent"];
});
add("agent_results", "blocking gap forbids complete", (r) => {
  r.envelope.outcome.content.knowledgeGaps = wire(
    "gapBlocking",
  ).outcome.content.knowledgeGaps.map((g: Document) => ({
    ...g,
    evidenceIds: [],
    findingIds: [],
    lineageIds: [],
  }));
  r.envelope.outcome.completeness = { kind: "complete" };
});
add("agent_usage_observations", "duration differs", (r) => {
  r.observation.durationMs++;
});
add("agent_usage_observations", "mutable usage timestamp", (r) => {
  r.updatedAt = new Date(r.createdAt.getTime() + 1);
});
function payloadBoundary(bytes: number, value: number) {
  const payload = { number: value, text: ["", "", ""] };
  let remaining = bytes - Buffer.byteLength(JSON.stringify(payload));
  for (let i = 0; i < payload.text.length; i++) {
    const count = Math.min(12000, remaining);
    payload.text[i] = "x".repeat(count);
    remaining -= count;
  }
  assert.equal(remaining, 0);
  assert.equal(Buffer.byteLength(JSON.stringify(payload)), bytes);
  return payload;
}
for (const value of [
  0,
  1e-7,
  0.000001,
  0.30000000000000004,
  1.2345678901234567,
  Number.MIN_VALUE,
])
  for (const bytes of [32768, 32769])
    add(
      "agent_runs",
      `input JSON numeric bytes ${value}/${bytes}`,
      (r) => {
        r.frozen.input = payloadBoundary(bytes, value);
      },
      bytes === 32768,
    );
add("agent_runs", "nested date is not JSON", (r) => {
  r.frozen.input = { date: at };
});
add("agent_runs", "UTF16 JSON string bound", (r) => {
  r.frozen.input = "😀".repeat(7000) + "x".repeat(2001);
});
add("agent_runs", "JSON array bound", (r) => {
  r.frozen.input = Array(257).fill(null);
});
add("agent_runs", "JSON key bound", (r) => {
  r.frozen.input = Object.fromEntries(
    Array.from({ length: 101 }, (_, i) => ["k" + i, i]),
  );
});
add("agent_runs", "unsafe JSON property", (r) => {
  r.frozen.input = { nested: { constructor: "unsafe" } };
});
add("agent_runs", "JSON depth bound", (r) => {
  let v: unknown = "leaf";
  for (let i = 0; i < 13; i++) v = { nested: v };
  r.frozen.input = v;
});
add("agent_runs", "grant workspace mismatch", (r) => {
  r.frozen.grant.workspaceId = generatePlatformId("workspace");
});
add("agent_runs", "duplicate projection", (r) => {
  r.frozen.grant.resources[0].fields.push(
    r.frozen.grant.resources[0].fields[0],
  );
});
add("agent_runs", "ungranted projection", (r) => {
  r.frozen.context.references[0].fields = ["ungranted"];
});
add("agent_runs", "prototype projection", (r) => {
  r.frozen.grant.resources[0].fields = ["label.constructor"];
});
add("agent_runs", "duplicate provider budget", (r) => {
  r.frozen.grant.budgets.providerCalls = [
    { provider: "synthetic", calls: 1 },
    { provider: "synthetic", calls: 1 },
  ];
});
function withGap(r: Document) {
  const gap = structuredClone(
    wire("gapBlocking").outcome.content.knowledgeGaps[0],
  );
  gap.evidenceIds = [];
  gap.findingIds = [];
  gap.lineageIds = [];
  r.envelope.outcome.content.knowledgeGaps = [gap];
  r.envelope.outcome.completeness = {
    kind: "partial",
    omissions: ["Missing evidence"],
    reason: "Requires review",
  };
  return gap;
}
add(
  "agent_results",
  "blocking gap retained as partial",
  (r) => {
    withGap(r);
  },
  true,
);
add(
  "agent_results",
  "non-blocking gap permits complete",
  (r) => {
    withGap(r).severity = "non_blocking";
    r.envelope.outcome.completeness = { kind: "complete" };
  },
  true,
);
for (const kind of ["human_input", "research", "unresolved", "capability"])
  add(
    "agent_results",
    `gap resolution ${kind}`,
    (r) => {
      withGap(r).resolution = {
        kind,
        ...(kind === "capability" ? { requiredCapability: "research" } : {}),
      };
    },
    true,
  );
add("agent_results", "missing required capability", (r) => {
  withGap(r).resolution = { kind: "capability" };
});
add("agent_results", "dangling gap support", (r) => {
  withGap(r).findingIds = ["absent"];
});
add("agent_results", "duplicate gap support", (r) => {
  withGap(r).evidenceIds = [
    r.envelope.outcome.content.evidence[0].id,
    r.envelope.outcome.content.evidence[0].id,
  ];
});
add("agent_results", "unknown gap field", (r) => {
  withGap(r).resolved = true;
});
add(
  "agent_results",
  "Runtime code-point text accepts 1001 emoji",
  (r) => {
    withGap(r).question = "😀".repeat(1001);
  },
  true,
);
add("agent_results", "Runtime question code-point limit", (r) => {
  withGap(r).question = "x".repeat(2001);
});
function useOutcome(row: Document, name: string) {
  const e = replace(wire(name));
  const checkpoint = e.outcome.checkpoint;
  if (checkpoint) {
    checkpoint.digest = digestWithout(checkpoint, "digest");
    if (e.outcome.inputRequest)
      e.outcome.inputRequest.checkpoint.digest = checkpoint.digest;
  }
  row.envelope = e;
  row.dispositions = e.outcome.content.proposals.map((p: Document) => ({
    proposalId: p.id,
    status: "pending",
  }));
  return e;
}
for (const name of [
  "needsInput",
  "yield",
  "failure",
  "cancelled",
  "gapHuman",
  "gapResearch",
  "gapCapability",
  "gapUnresolved",
])
  add(
    "agent_results",
    `valid ${name} envelope`,
    (r) => {
      useOutcome(r, name);
    },
    true,
  );
add("agent_results", "checkpoint wrong Run", (r) => {
  const e = useOutcome(r, "yield");
  e.outcome.checkpoint.runId = "other";
  e.outcome.checkpoint.digest = digestWithout(e.outcome.checkpoint, "digest");
});
add("agent_results", "input checkpoint mismatch", (r) => {
  useOutcome(r, "needsInput").outcome.inputRequest.checkpoint.id = "other";
});
add("agent_results", "input expired when Outcome ended", (r) => {
  const e = useOutcome(r, "needsInput");
  e.outcome.inputRequest.expiresAt = e.endedAt;
});
add("agent_results", "duplicate input choices", (r) => {
  const e = useOutcome(r, "needsInput");
  e.outcome.inputRequest.fields = [
    {
      key: "answer",
      label: "Answer",
      required: true,
      type: "choice",
      options: [
        { value: "same", label: "A" },
        { value: "same", label: "B" },
      ],
    },
  ];
});
add("agent_results", "input reversed number bounds", (r) => {
  const e = useOutcome(r, "needsInput");
  e.outcome.inputRequest.fields = [
    {
      key: "answer",
      label: "Answer",
      required: true,
      type: "number",
      minimum: 2,
      maximum: 1,
    },
  ];
});
add("agent_results", "failure cannot claim complete", (r) => {
  useOutcome(r, "failure").outcome.completeness = { kind: "complete" };
});
add(
  "agent_runs",
  "valid running",
  (r) => {
    r.status = "running";
    r.activeAttemptId = attemptId;
  },
  true,
);
add(
  "agent_runs",
  "valid terminal",
  (r) => {
    r.status = "completed";
    r.terminalReason = "success";
  },
  true,
);
add(
  "agent_runs",
  "valid input pause",
  (r) => {
    const holder: Document = {};
    const e = useOutcome(holder, "needsInput");
    r.status = "awaiting_input";
    r.checkpoint = e.outcome.checkpoint;
    r.inputRequest = e.outcome.inputRequest;
  },
  true,
);
for (const status of [
  "succeeded",
  "paused",
  "yielded",
  "failed",
  "cancelled",
  "expired",
])
  add(
    "agent_attempts",
    `valid finalized ${status}`,
    (r) => {
      r.status = status;
      r.endedAt = r.startedAt;
    },
    true,
  );
add("agent_usage_observations", "self correction forbidden", (r) => {
  r.observation.supersedes = r.observation.id;
});
for (const [name, value] of [
  ["negative zero", -0],
  ["NaN", NaN],
  ["infinity", Infinity],
  ["unsafe integer", Number.MAX_SAFE_INTEGER + 1],
] as const)
  add("agent_runs", `unsafe JSON number ${name}`, (r) => {
    r.frozen.input = { value };
  });
for (const collection of ["agent_runs", "agent_results"] as const) {
  add(
    collection,
    "Protocol 1.2 retains Result 2",
    (r) => {
      if (collection === "agent_runs") {
        r.frozen.protocolVersion = "1.2";
        r.frozenDigest = digest(r.frozen);
        r.manifest.protocolVersions = ["1.1", "1.2"];
        r.manifest.manifestDigest = digestWithout(r.manifest, "manifestDigest");
      } else {
        r.envelope.protocolVersion = "1.2";
        r.envelope.payloadDigest = digestWithout(r.envelope, "payloadDigest");
      }
    },
    true,
  );
}
for (const c of cases)
  test(`agent document contract: ${c.collection}: ${c.name}`, () => {
    assert.equal(schemas[c.collection].safeParse(c.document).success, c.valid);
  });
test(
  "proposed Agent Mongo validators: read-only synthetic parity",
  { skip: process.env.AGENT_MONGO_PARITY !== "1" },
  async () => {
    await agentMongoParity(cases, AGENT_CONTROL_PLANE_VALIDATORS);
  },
);
