import assert from "node:assert/strict";
import { EnquiryMemoryDb } from "./enquiry-db";
import { parseConfig } from "../../src/config";
import { authEnvironment, testIssuer } from "./auth";
import { provisionHvmClient } from "../../src/services/hvm-provision";
import { generatePlatformId } from "../../src/domain";
import { createLushaConnection } from "../../src/services/lusha/connection";
import { createLushaProvider } from "../../src/services/lusha/provider";
import { LUSHA_DEFINITION } from "../../src/services/lusha/catalogue";
export const config = parseConfig({
  ...authEnvironment,
  HVM_COGNITO_CLIENT_ID: "hvmclient",
  DEPLOYMENT_ENV: "test",
  MONGODB_URI: "mongodb://unused.invalid",
});
export async function lushaFixture() {
  const db = new EnquiryMemoryDb(),
    w = generatePlatformId("workspace"),
    brand = generatePlatformId("brand"),
    identity = {
      subject: "lusha-owner",
      issuer: testIssuer,
      clientId: "hvmclient",
    };
  db.rows("schema_versions").push({ _id: "vapp-v1", version: 28 });
  await provisionHvmClient(
    db.mongo,
    {
      organisationId: generatePlatformId("org"),
      organisationName: "Fixture",
      workspaceId: w,
      management: "client",
      brandId: brand,
      clientMembershipId: generatePlatformId("workspacemembership"),
      workspaceName: "Fixture",
      brandName: "Fixture",
      brandSlug: "fixture",
      human: { type: "human", id: identity.subject, issuer: identity.issuer },
    },
    testIssuer,
  );
  db.rows("integration_providers").push({
    id: generatePlatformId("integrationprovider"),
    key: "lusha",
    version: 1,
    status: "active",
    availability: "queens",
    data: LUSHA_DEFINITION,
  });
  const keys = new Map<string, string>();
  const secrets = {
    create: async (workspace: string, key: string) => {
      const arn = `arn:aws:secretsmanager:eu-west-2:123456789012:secret:hvm/dev/lusha/${workspace}/fixture-${keys.size}`;
      keys.set(arn, key);
      return arn;
    },
    read: async (workspace: string, ref: string) => {
      assert.ok(ref.includes(workspace));
      return keys.get(ref)!;
    },
    remove: async (_w: string, ref: string) => {
      keys.delete(ref);
    },
  };
  let requests = 0;
  const provider = createLushaProvider(async () => {
    requests++;
    return new Response(
      JSON.stringify({ credits: { total: 100, used: 10, remaining: 90 } }),
    );
  });
  const service = createLushaConnection(config, db.mongo, provider, secrets);
  return { db, w, brand, identity, service, secrets, requests: () => requests };
}
