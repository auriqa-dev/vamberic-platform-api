import assert from "node:assert/strict";
import { test } from "node:test";
import type { Document } from "mongodb";
import { agentMongoParity } from "./helpers/agent-mongo-parity";
import { z } from "zod";
import { agentOperatorFixture } from "./helpers/agent-operator-fixture";
import { CrmWorkspaceSchema } from "../src/domain/crm-records";
import {
  HvmPartnerSchema,
  HvmPartnerMembershipSchema,
  WorkspacePartnerAssignmentSchema,
} from "../src/domain/partners";
import { WorkspaceMembershipSchema } from "../src/domain/workspace-memberships";
import { WorkspaceIntegrationSchema } from "../src/domain/workspace-integrations";
import { CapabilityInstanceSchema } from "../src/domain/commercial-records";
import { generatePlatformId } from "../src/domain/ids";
import { MONGO_VALIDATORS } from "../src/db/setup";
const f = await agentOperatorFixture();
await f.service.grant(f.queen, f.workspaceId, f.request);
const at = new Date("2030-01-01T12:00:00.000Z");
f.db.rows("workspace_integrations").push(
  WorkspaceIntegrationSchema.parse({
    id: generatePlatformId("integration"),
    workspaceId: f.workspaceId,
    createdAt: at,
    updatedAt: at,
    provider: "synthetic",
    displayName: "Synthetic",
    status: "pending",
  }),
);
f.db.rows("capability_instances").push(
  CapabilityInstanceSchema.parse({
    id: generatePlatformId("capinstance"),
    workspaceId: f.workspaceId,
    createdAt: at,
    updatedAt: at,
    scopeType: "workspace",
    capabilityId: generatePlatformId("capability"),
    status: "enabled",
  }),
);
const schemas: Record<string, z.ZodTypeAny> = {
  crm_workspaces: CrmWorkspaceSchema,
  hvm_partners: HvmPartnerSchema,
  hvm_partner_memberships: HvmPartnerMembershipSchema,
  workspace_partner_assignments: WorkspacePartnerAssignmentSchema,
  workspace_memberships: WorkspaceMembershipSchema,
  workspace_integrations: WorkspaceIntegrationSchema,
  capability_instances: CapabilityInstanceSchema,
};
const cases: {
  collection: string;
  name: string;
  document: Document;
  valid: boolean;
}[] = [];
function add(
  collection: string,
  name: string,
  mutate: (r: Document) => void,
  valid = false,
) {
  const document = structuredClone(
    collection === "workspace_memberships"
      ? f.db.rows(collection).find((r) => r.id === f.membership.id)!
      : f.db.rows(collection)[0]!,
  );
  mutate(document);
  cases.push({ collection, name, document, valid });
}
for (const collection of Object.keys(schemas)) {
  add(
    collection,
    "absent counter",
    (r) => {
      delete r.executionSerial;
    },
    true,
  );
  for (const counter of [
    0,
    1,
    Number.MAX_SAFE_INTEGER,
    -1,
    0.5,
    null,
    Number.MAX_SAFE_INTEGER + 1,
    "1",
  ])
    add(
      collection,
      `counter ${String(counter)}`,
      (r) => {
        r.executionSerial = counter;
      },
      typeof counter === "number" &&
        Number.isSafeInteger(counter) &&
        counter >= 0,
    );
}
const grant = (name: string, mutation: (r: Document) => void, valid = false) =>
  add("workspace_memberships", name, mutation, valid);
grant(
  "legacy membership has no automatic grant",
  (r) => {
    delete r.agentOperationGrants;
  },
  true,
);
grant(
  "explicit no grants",
  (r) => {
    r.agentOperationGrants = [];
  },
  true,
);
grant("duplicate grant", (r) => {
  r.agentOperationGrants.push(structuredClone(r.agentOperationGrants[0]));
});
grant("expiry precedes grant", (r) => {
  r.agentOperationGrants[0].expiresAt = new Date(
    r.agentOperationGrants[0].grantedAt.getTime() - 1,
  );
});
grant("grant before joining", (r) => {
  r.agentOperationGrants[0].grantedAt = new Date(r.joinedAt.getTime() - 1);
});
grant("wrong revision", (r) => {
  r.agentOperationGrants[0].target.revision = 0;
});
grant("wrong target prefix", (r) => {
  r.agentOperationGrants[0].target.id = generatePlatformId("clientswarm");
});
grant("empty operations", (r) => {
  r.agentOperationGrants[0].operations = [];
});
grant("duplicate operations", (r) => {
  r.agentOperationGrants[0].operations = ["exercise", "exercise"];
});
grant("unknown authority flag", (r) => {
  r.agentOperationGrants[0].admin = true;
});
grant("Partner not human", (r) => {
  r.agentOperationGrants[0].grantedBy.id = "partner_synthetic";
});
grant("UTF16 human bound", (r) => {
  r.agentOperationGrants[0].grantedBy.id = "😀".repeat(151);
});
for (const c of cases)
  test(`authority document contract: ${c.collection}: ${c.name}`, () =>
    assert.equal(
      schemas[c.collection]!.safeParse(c.document).success,
      c.valid,
    ));
test(
  "authority proposed validators: read-only Mongo parity",
  { skip: process.env.AGENT_MONGO_PARITY !== "1" },
  async () => {
    await agentMongoParity(cases, MONGO_VALIDATORS);
  },
);
