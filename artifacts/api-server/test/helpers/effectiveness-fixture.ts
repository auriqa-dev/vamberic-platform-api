import { readFileSync } from "node:fs";
import {
  digest,
  digestWithout,
  CriteriaSetSchema,
  ImplementationManifestSchema,
  emptyContent,
  EvaluationInputSchema,
  type ClaimedWork,
  type Outcome,
} from "@workspace/agent-runtime-protocol";
import { agentOperatorFixture } from "./agent-operator-fixture";
import { operatingFixtures } from "./operating-fixtures";
import { createAgentExecutionReadiness } from "../../src/services/agent-execution-readiness";
import { createAgentWorkloadAuthority } from "../../src/authorization/agent-workload";
import {
  createAgentEffectiveness,
  type EffectivenessProfile,
} from "../../src/services/agent-effectiveness";
import { createAgentControlPlane } from "../../src/services/agent-control-plane";
import { parseFrozenWork } from "../../src/domain/agent-control-plane";
import {
  EffectivenessPolicySchema,
  EffectivenessDefinitionSchema,
} from "../../src/domain/agent-effectiveness";
export async function effectivenessFixture() {
  const f = await agentOperatorFixture();
  f.db.rows("schema_versions")[0]!.version = 11;
  const load = (name: string) =>
    JSON.parse(
      readFileSync(
        new URL(
          `../../../../lib/agent-runtime-protocol/fixtures/${name}.json`,
          import.meta.url,
        ),
        "utf8",
      ),
    );
  const m = load("manifest");
  m.operations = ["exercise", "evaluate", "revise"];
  m.manifestDigest = digestWithout(m, "manifestDigest");
  const manifest = ImplementationManifestSchema.parse(m);
  const policyBody = {
    key: "synthetic",
    version: 1,
    maxRevisions: 2,
    manualOverride: false,
    consequences: [{ key: "normal", onFailure: "revise", onUncertain: "hold" }],
  };
  const { key, version, ...policyFields } = policyBody;
  const policy = EffectivenessPolicySchema.parse({
    ...policyFields,
    identity: { key, version, digest: digest(policyBody) },
  });
  const profileIdentity = {
    key: "synthetic",
    version: 1,
    digest: digest("profile"),
  };
  const definition = EffectivenessDefinitionSchema.parse({
    maker: "exercise",
    evaluator: "evaluate",
    revision: "revise",
    profile: profileIdentity,
    policy: policy.identity,
    required: true,
    maxRevisions: 2,
  });
  const criteriaBody = {
    schemaVersion: 1,
    profile: profileIdentity,
    objective: "Answer question",
    intendedNextAction: "Review",
    lineage: [],
    criteria: [
      {
        id: "useful",
        version: 1,
        category: "effectiveness",
        requirement: "Useful answer",
        rationale: "Meet purpose",
        importance: "mandatory",
        method: "deterministic",
        methodKey: "synthetic",
        evidence: "none",
        applicabilityRule: "always",
        consequenceKey: "normal",
        lineageIds: [],
      },
    ],
  };
  const criteria = CriteriaSetSchema.parse({
    ...criteriaBody,
    digest: digest(criteriaBody),
  });
  const def = operatingFixtures().agent_definitions;
  def.id = f.agent.data.definition.id;
  def.key = manifest.compatibleDefinitions[0]!.key;
  def.version = manifest.compatibleDefinitions[0]!.version;
  def.status = "active";
  def.data.executionImplementation = {
    ...manifest.implementation,
    manifestDigest: manifest.manifestDigest,
    protocolVersion: "1.1",
  };
  def.data.effectiveness = [definition];
  f.db.rows("agent_definitions").push(def);
  f.agent.data.configuration = [];
  f.agent.data.definition.version = def.version;
  f.agent.data.bindings = [];
  f.agent.data.dependencyInstanceIds = [];
  f.agent.data.capabilityInstanceIds = [];
  const now = new Date("2030-01-01T12:00:00.000Z");
  const deadline = "2030-01-02T12:00:00.000Z";
  const budget = {
    deadline,
    modelCalls: 0,
    toolCalls: 0,
    providerCalls: [],
    cost: { currency: "GBP", amount: "1" },
  };
  const readiness = createAgentExecutionReadiness(
    {
      async manifest() {
        return manifest;
      },
      async available() {
        return true;
      },
    },
    {
      async allowed() {
        return true;
      },
      async dependencies() {
        return [];
      },
      allowInternal: true,
    },
  );
  const workloads = createAgentWorkloadAuthority("test", ["runtime"]);
  const principal = workloads.authenticated({
    environment: "test",
    clientId: "runtime",
    workerId: "worker",
    workloadClass: "agent_runtime",
    scopes: ["claim", "heartbeat", "context", "outcome", "receipt", "usage"],
  });
  const p: EffectivenessProfile = {
    criteriaFloor: criteria.criteria,
    manifestDigest: manifest.manifestDigest,
    definition,
    policy,
    selector: { kind: "domain_output" },
    allowedNotApplicable() {
      return [];
    },
    async prepareCase() {
      return {
        criteria,
        totalBudget: { ...budget, cost: { currency: "GBP", amount: "11" } },
      };
    },
    async prepareRun({ case: c, runId, role, input }) {
      const source = load("claimedWork");
      for (const field of [
        "attemptId",
        "generation",
        "fence",
        "lease",
        "resume",
      ])
        delete source[field];
      source.runId = runId;
      source.workspaceId = c.workspaceId;
      source.clientId = c.organisationId;
      source.definition = { id: def.id, key: def.key, version: def.version };
      source.implementation = {
        ...manifest.implementation,
        manifestDigest: manifest.manifestDigest,
        buildDigest: manifest.buildDigest,
      };
      source.clientAgent = { id: f.agent.id, revision: 1, configuration: [] };
      source.operation = definition[role];
      source.context = { references: [], snapshots: [] };
      source.lineage = [];
      source.grant = {
        id: "grant:" + runId,
        version: 1,
        runId,
        workspaceId: c.workspaceId,
        expiresAt: deadline,
        resources: [],
        proposalTargets: [],
        tools: [],
        bindings: [],
        models: [],
        budgets: budget,
      };
      source.input = input;
      if (role === "evaluator") {
        const candidate = c.candidates.at(-1)!.reference;
        source.input = EvaluationInputSchema.parse({
          kind: "effectiveness_evaluation_request",
          schemaVersion: 1,
          candidate,
          criteria,
          policy: policy.identity,
          requestKey: `eval:${c.evaluations.length + 1}`,
          instruction: { key: "synthetic", ...manifest.instruction },
          importedSupport: [],
        });
        const row = f.db
          .rows("agent_results")
          .find((r) => r.id === candidate.resultId)!;
        const payload = {
          domainOutput: row.envelope.outcome.content.domainOutput,
        };
        const reference = {
          resourceType: "agent_result_projection",
          id: row.id,
          workspaceId: c.workspaceId,
          contentHash: row.envelope.payloadDigest,
        };
        const grant = { reference, fields: ["domainOutput"] };
        source.context = {
          references: [grant],
          snapshots: [
            {
              id: "candidate_snapshot",
              ...grant,
              payload,
              payloadDigest: digest(payload),
            },
          ],
        };
        source.grant.resources = [grant];
      }
      return {
        frozen: parseFrozenWork(source),
        limits: { attempts: 4, failures: 2, inputCycles: 2, continuations: 2 },
      };
    },
  };
  const effects = createAgentEffectiveness(
    f.config,
    f.db.mongo,
    workloads,
    readiness,
    [p],
    () => now,
  );
  const control = createAgentControlPlane(
    f.config,
    f.db.mongo,
    workloads,
    readiness.policy,
    () => now,
    effects.hooks,
  );
  async function claim(runId: string) {
    const run = f.db.rows("agent_runs").find((r) => r.id === runId)!;
    return control.claim(principal, {
      dispatch: {
        protocolVersion: "1.1",
        environment: "test",
        runId,
        generation: run.generation,
        dispatchId: run.dispatch.id,
        notBefore: run.notBefore.toISOString(),
        traceId: run.frozen.traceId,
      },
      claimId: "claim:" + runId,
    });
  }
  function lease(w: ClaimedWork) {
    return {
      runId: w.runId,
      attemptId: w.attemptId,
      generation: w.generation,
      fence: w.fence,
      leaseId: w.lease.id,
    };
  }
  function result(
    w: ClaimedWork,
    assessment: "pass" | "fail" | "uncertain" = "pass",
    label = "candidate",
  ): Outcome {
    const content = emptyContent();
    if (w.operation === "evaluate") {
      const i = EvaluationInputSchema.parse(w.input);
      content.domainOutput = {
        kind: "effectiveness_evaluation",
        schemaVersion: 1,
        candidate: i.candidate,
        criteriaDigest: i.criteria.digest,
        policy: i.policy,
        requestKey: i.requestKey,
        instruction: i.instruction,
        assessments: [
          {
            criterionId: "useful",
            outcome: assessment,
            method: "deterministic",
            methodKey: "synthetic",
            rationale: "Synthetic assessment",
            evidenceIds: [],
            findingIds: assessment === "fail" ? ["defect"] : [],
            lineageIds: [],
            gapIds: [],
            provenance: { kind: "deterministic", check: profileIdentity },
          },
        ],
        defects:
          assessment === "fail"
            ? [
                {
                  criterionId: "useful",
                  findingId: "defect",
                  type: "irrelevant",
                  location: "answer",
                  requirement: "Answer question",
                },
              ]
            : [],
        summary: "Synthetic evaluation",
      };
      if (assessment === "fail")
        content.findings = [
          {
            id: "defect",
            kind: "recommendation",
            statement: "Improve relevance",
            evidenceIds: [],
            lineageIds: [],
          },
        ];
    } else content.domainOutput = { label };
    const bytes = {
      protocolVersion: "1.1" as const,
      resultSchemaVersion: 2 as const,
      runId: w.runId,
      attemptId: w.attemptId,
      generation: w.generation,
      fence: w.fence,
      submissionId: "submission:" + w.attemptId,
      implementation: w.implementation,
      instruction: manifest.instruction,
      traceId: w.traceId,
      startedAt: now.toISOString(),
      endedAt: now.toISOString(),
      outcome: {
        kind: "success" as const,
        completeness: { kind: "complete" as const },
        content,
      },
      usage: [],
    };
    return { ...bytes, payloadDigest: digest(bytes) };
  }
  return {
    ...f,
    criteria,
    policy,
    definition,
    manifest,
    p,
    effects,
    control,
    principal,
    readiness,
    workloads,
    claim,
    lease,
    result,
    now,
    request: {
      clientAgentId: f.agent.id,
      revision: 1,
      operation: "exercise",
      requestKey: "case:request",
      input: { subject: "synthetic" },
    },
  };
}
