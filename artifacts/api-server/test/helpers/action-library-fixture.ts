import {
  ActionTypeSchema,
  ActionDefinitionSchema,
  ActionDefinitionRevisionSchema,
  actionTypeHash,
  actionDefinitionHash,
} from "../../src/domain/action-library";
export const actionId = (prefix: string) =>
  `${prefix}_00000000000000000000000000`;
export function actionFixture() {
  const at = new Date("2030-01-01T00:00:00Z"),
    human = {
      type: "human" as const,
      issuer: "https://identity.example.test/pool",
      id: "synthetic",
    };
  const common = {
    createdAt: at,
    updatedAt: at,
    createdBy: human,
    updatedBy: human,
    archived: false,
    schemaVersion: 1 as const,
  };
  const typeBody = {
    ...common,
    id: actionId("actiontype"),
    key: "synthetic_possibility",
    version: 1,
    status: "active" as const,
    availability: "queens" as const,
    data: {
      name: "Synthetic action",
      description: "No execution semantics",
      capabilityIds: [],
    },
  };
  const type = ActionTypeSchema.parse({
    ...typeBody,
    contentHash: actionTypeHash(typeBody),
  });
  const definition = {
    name: "Independent possibility",
    description: "Synthetic foundation record",
    purpose: "Support a future decision",
    actionType: {
      id: type.id,
      key: type.key,
      version: type.version,
      contentHash: type.contentHash,
    },
    resources: [],
    prerequisites: [],
    eligibilityConstraints: [],
    approvalRequirements: [],
    availability: { constraints: [] },
    evidence: [],
  };
  const row = ActionDefinitionSchema.parse({
    ...common,
    id: actionId("actiondefinition"),
    workspaceId: actionId("workspace"),
    definition,
    status: "approved",
    revision: 1,
    approvedRevision: 1,
    approvedAt: at,
    approvedBy: human,
    contentHash: actionDefinitionHash({ definition }),
  });
  const snapshot = ActionDefinitionRevisionSchema.parse({
    id: actionId("actionrevision"),
    workspaceId: row.workspaceId,
    definitionId: row.id,
    revision: 1,
    snapshot: row,
  });
  return {
    type,
    row,
    snapshot,
    reference: {
      definitionId: row.id,
      snapshotId: snapshot.id,
      revision: 1,
      contentHash: row.contentHash,
    },
  };
}
