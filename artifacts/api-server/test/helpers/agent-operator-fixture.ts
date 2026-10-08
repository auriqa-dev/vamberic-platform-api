import { EnquiryMemoryDb } from "./enquiry-db";
import { operatingFixtures } from "./operating-fixtures";
import { parseConfig } from "../../src/config";
import { authEnvironment, testIssuer } from "./auth";
import { generatePlatformId, OrganisationSchema } from "../../src/domain";
import { provisionHvmClient } from "../../src/services/hvm-provision";
import { createAgentOperatorService } from "../../src/services/agent-operators";
import { WorkspaceMembershipSchema } from "../../src/domain/workspace-memberships";

export async function agentOperatorFixture() {
  const db = new EnquiryMemoryDb();
  db.rows("schema_versions").push({ _id: "vapp-v1", version: 10 });
  const now = new Date("2030-01-01T12:00:00.000Z");
  const old = new Date("2026-01-01T00:00:00.000Z");
  const organisationId = generatePlatformId("org");
  db.rows("organisations").push(
    OrganisationSchema.parse({
      id: organisationId,
      name: "Synthetic",
      type: "customer",
      createdAt: old,
      updatedAt: old,
    }),
  );
  const input = {
    organisationId,
    workspaceId: generatePlatformId("workspace"),
    partnerId: generatePlatformId("partner"),
    partnerMembershipId: generatePlatformId("partnermembership"),
    assignmentId: generatePlatformId("partnerassignment"),
    brandId: generatePlatformId("brand"),
    clientMembershipId: generatePlatformId("workspacemembership"),
    workspaceName: "Synthetic",
    partnerName: "Synthetic",
    brandName: "Synthetic",
    brandSlug: "synthetic",
    human: { type: "human" as const, issuer: testIssuer, id: "queen" },
  };
  await provisionHvmClient(db.mongo, input, testIssuer);
  const membership = WorkspaceMembershipSchema.parse({
    id: generatePlatformId("workspacemembership"),
    workspaceId: input.workspaceId,
    human: { ...input.human, id: "client" },
    role: "member",
    status: "active",
    createdAt: old,
    updatedAt: old,
    joinedAt: old,
  });
  db.rows("workspace_memberships").push(membership);
  const agent = operatingFixtures().client_agents;
  Object.assign(agent, {
    workspaceId: input.workspaceId,
    status: "configured",
    revision: 1,
  });
  db.rows("client_agents").push(agent);
  const config = parseConfig({
    ...authEnvironment,
    HVM_COGNITO_CLIENT_ID: "hvmclient",
    DEPLOYMENT_ENV: "test",
    MONGODB_URI: "mongodb://unused.invalid",
  });
  const queen = { issuer: testIssuer, clientId: "hvmclient", subject: "queen" };
  const client = { ...queen, subject: "client" };
  let time = now;
  const service = createAgentOperatorService(
    config,
    db.mongo,
    {
      async operations() {
        return ["exercise"];
      },
    },
    () => time,
  );
  const request = {
    membershipId: membership.id,
    expectedUpdatedAt: old.toISOString(),
    target: { kind: "client_agent", id: agent.id, revision: 1 },
    operations: ["exercise"],
  };
  return {
    db,
    config,
    queen,
    client,
    service,
    request,
    membership,
    agent,
    workspaceId: input.workspaceId,
    tick() {
      time = new Date(time.getTime() + 10);
    },
  };
}
