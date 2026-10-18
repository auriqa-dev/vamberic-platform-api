import type { Document } from "mongodb";
import { digestWithout, emptyContent } from "@workspace/agent-runtime-protocol";
import { workspaceAgentFixture } from "./workspace-agent-v16";
import { operatingFixtures } from "./operating-fixtures";
import { WorkspaceMembershipSchema } from "../../src/domain/workspace-memberships";
import {
  AgentRunSchema,
  AgentResultSchema,
} from "../../src/domain/agent-control-plane";
import { EffectivenessCaseSchema } from "../../src/domain/agent-effectiveness";
import { OperatingSchemas } from "../../src/domain/operating";
import { generatePlatformId } from "../../src/domain/ids";
export async function v16IdentityParityCases() {
  const f = await workspaceAgentFixture();
  const c = await f.effects.create(f.queen, f.workspaceId, f.request);
  const run = structuredClone(f.db.rows("agent_runs")[0]!);
  delete run._id;
  const op = operatingFixtures();
  const implementation = structuredClone(
    f.db.rows("agent_definitions")[0]!.data.executionImplementation,
  );
  op.agent_definitions.data.executionImplementation = implementation;
  op.pricing_recommendations.data.configurationSnapshot.agents[0].definition.executionImplementation =
    implementation;
  op.swarm_agreements.data.recommendationSnapshot.configurationSnapshot.agents[0].definition.executionImplementation =
    implementation;
  const membership = structuredClone(f.membership) as Document;
  membership.updatedAt = f.now;
  membership.agentOperationGrants = [
    {
      id: generatePlatformId("agentoperatorgrant"),
      target: f.target,
      operations: ["understand"],
      grantedAt: f.now,
      grantedBy: { type: "human", issuer: f.queen.issuer, id: f.queen.subject },
    },
  ];
  const envelope = {
    protocolVersion: "2.0",
    resultSchemaVersion: 2,
    runId: run.id,
    attemptId: generatePlatformId("agentattempt"),
    generation: 1,
    fence: 1,
    submissionId: "synthetic_parity",
    implementation: run.frozen.implementation,
    instruction: f.manifest.instruction,
    traceId: run.frozen.traceId,
    startedAt: f.now.toISOString(),
    endedAt: f.now.toISOString(),
    outcome: {
      kind: "success",
      completeness: {
        kind: "partial",
        reason: "Synthetic structural fixture",
        omissions: ["Product knowledge"],
      },
      content: emptyContent(),
    },
    usage: [],
    payloadDigest: "",
  };
  envelope.payloadDigest = digestWithout(envelope, "payloadDigest");
  const fixtures: Record<string, Document> = {
    workspace_memberships: membership,
    agent_definitions: op.agent_definitions,
    pricing_recommendations: op.pricing_recommendations,
    swarm_agreements: op.swarm_agreements,
    agent_runs: run,
    agent_results: AgentResultSchema.parse({
      id: generatePlatformId("agentresult"),
      workspaceId: f.workspaceId,
      runId: run.id,
      attemptId: envelope.attemptId,
      createdAt: f.now,
      updatedAt: f.now,
      envelope,
      dispositions: [],
    }),
    agent_effectiveness_cases: structuredClone(
      f.db.rows("agent_effectiveness_cases").find((r) => r.id === c.id)!,
    ),
  };
  for (const row of Object.values(fixtures)) delete row._id;
  const schemas: Record<
    string,
    { safeParse(v: unknown): { success: boolean } }
  > = {
    workspace_memberships: WorkspaceMembershipSchema,
    agent_runs: AgentRunSchema,
    agent_results: AgentResultSchema,
    agent_effectiveness_cases: EffectivenessCaseSchema,
    agent_definitions: OperatingSchemas.agent_definitions,
    pricing_recommendations: OperatingSchemas.pricing_recommendations,
    swarm_agreements: OperatingSchemas.swarm_agreements,
  };
  const cases: {
    collection: string;
    name: string;
    document: Document;
    valid: boolean;
    applicationValid: boolean;
  }[] = [];
  const add = (
    collection: string,
    name: string,
    mutate: (r: Document) => void = () => {},
    valid = false,
    applicationValid = valid,
  ) => {
    const document = structuredClone(fixtures[collection]!);
    mutate(document);
    cases.push({ collection, name, document, valid, applicationValid });
  };
  for (const collection of Object.keys(fixtures)) {
    add(collection, "valid new protocol/target", undefined, true);
    add(collection, "invalid id", (r) => {
      r.id = "invalid";
    });
    add(collection, "unknown authority", (r) => {
      r.permissions = ["execute"];
    });
    add(collection, "missing identity", (r) => {
      delete r.id;
    });
    add(collection, "invalid timestamp", (r) => {
      r.createdAt = "invalid";
    });
  }
  for (const collection of [
    "agent_definitions",
    "pricing_recommendations",
    "swarm_agreements",
  ]) {
    const get = (r: Document) =>
      collection === "agent_definitions"
        ? r.data
        : collection === "pricing_recommendations"
          ? r.data.configurationSnapshot.agents[0].definition
          : r.data.recommendationSnapshot.configurationSnapshot.agents[0]
              .definition;
    add(collection, "unknown protocol", (r) => {
      get(r).executionImplementation.protocolVersion = "9.0";
    });
    add(
      collection,
      "legacy protocol remains valid",
      (r) => {
        get(r).executionImplementation.protocolVersion = "1.1";
      },
      true,
    );
  }
  add(
    "workspace_memberships",
    "target digest is application-only",
    (r) => {
      r.agentOperationGrants[0].target.id = "c".repeat(64);
    },
    true,
    false,
  );
  add(
    "workspace_memberships",
    "target workspace is application-only",
    (r) => {
      r.agentOperationGrants[0].target.workspaceId =
        generatePlatformId("workspace");
    },
    true,
    false,
  );
  add("workspace_memberships", "invalid target kind", (r) => {
    r.agentOperationGrants[0].target.kind = "global_agent";
  });
  add("workspace_memberships", "empty operations", (r) => {
    r.agentOperationGrants[0].operations = [];
  });
  add("agent_runs", "frozen target mismatch", (r) => {
    r.frozen.executionTarget.definition.version++;
  });
  add("agent_runs", "workspace target mismatch", (r) => {
    r.target.workspaceId = generatePlatformId("workspace");
  });
  add("agent_runs", "legacy identity cannot masquerade as Protocol 2", (r) => {
    r.frozen.clientAgent = {
      id: generatePlatformId("clientagent"),
      revision: 1,
      configuration: [],
    };
  });
  add("agent_runs", "missing configuration", (r) => {
    delete r.frozen.configuration;
  });
  add("agent_results", "unknown envelope protocol", (r) => {
    r.envelope.protocolVersion = "9.0";
    r.envelope.payloadDigest = digestWithout(r.envelope, "payloadDigest");
  });
  add("agent_results", "Result schema unchanged", (r) => {
    r.envelope.resultSchemaVersion = 3;
    r.envelope.payloadDigest = digestWithout(r.envelope, "payloadDigest");
  });
  add("agent_effectiveness_cases", "workspace target mismatch", (r) => {
    r.target.workspaceId = generatePlatformId("workspace");
  });
  add("agent_effectiveness_cases", "manual override disabled", (r) => {
    r.policy.manualOverride = true;
  });
  return { cases, schemas };
}
