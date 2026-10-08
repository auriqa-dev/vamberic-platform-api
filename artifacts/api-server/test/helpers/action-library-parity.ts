import type { Document } from "mongodb";
import {
  ACTION_LIBRARY_SCHEMAS,
  ReasoningDecisionV17Schema,
  parseActionTask,
} from "../../src/domain/action-library";
import { actionFixture, actionId } from "./action-library-fixture";
const f = actionFixture();
const decision = {
  id: actionId("reasoningdecision"),
  workspaceId: f.row.workspaceId,
  createdAt: f.row.createdAt,
  updatedAt: f.row.createdAt,
  source: { kind: "human", reference: "synthetic" },
  contextId: actionId("reasoningcontext"),
  candidates: [{ key: "wait", description: "Wait", action: f.reference }],
  explanation: "Synthetic",
  evidence: [],
  confidence: 0.5,
  priority: "normal",
  authorityLevel: "recommendation",
  authorityEvidence: [],
  constraints: [],
  policies: [],
  status: "recorded",
  decidedAt: f.row.createdAt,
};
const task = {
  id: actionId("task"),
  workspaceId: f.row.workspaceId,
  title: "Synthetic",
  type: "other",
  status: "pending",
  createdAt: f.row.createdAt,
  updatedAt: f.row.updatedAt,
  personId: actionId("person"),
  schemaVersion: 1,
  archived: false,
  reasoning: {
    contextId: decision.contextId,
    decisionId: decision.id,
    offerings: [],
    action: f.reference,
  },
};
export const actionParityFixtures: Record<string, Document> = {
  action_types: f.type,
  action_definitions: f.row,
  action_definition_revisions: f.snapshot,
  reasoning_decisions: decision,
  crm_tasks: task,
};
export const actionParityCases: {
  collection: string;
  name: string;
  document: Document;
  valid: boolean;
  applicationValid: boolean;
}[] = [];
function add(
  collection: string,
  name: string,
  mutate: (r: Document) => void = () => {},
  valid = false,
  applicationValid = valid,
) {
  const document = structuredClone(actionParityFixtures[collection]!);
  mutate(document);
  actionParityCases.push({
    collection,
    name,
    document,
    valid,
    applicationValid,
  });
}
for (const collection of Object.keys(actionParityFixtures)) {
  add(collection, "valid", undefined, true);
  add(collection, "bad identity", (r) => {
    r.id = "bad";
  });
  add(collection, "missing identity", (r) => {
    delete r.id;
  });
  if (collection !== "crm_tasks")
    add(collection, "unknown workflow field", (r) => {
      r.nextActionId = "sequence";
    });
}
for (const collection of Object.keys(ACTION_LIBRARY_SCHEMAS)) {
  add(collection, "unknown authority", (r) => {
    r.executionGrant = {};
  });
  add(collection, "wrong scope", (r) => {
    if (collection === "action_types") r.workspaceId = f.row.workspaceId;
    else delete r.workspaceId;
  });
}
add(
  "action_types",
  "hash is application check",
  (r) => {
    r.contentHash = "b".repeat(64);
  },
  true,
  false,
);
add(
  "action_definitions",
  "hash is application check",
  (r) => {
    r.contentHash = "b".repeat(64);
  },
  true,
  false,
);
add(
  "action_definitions",
  "approval consistency is application check",
  (r) => {
    delete r.approvedBy;
  },
  true,
  false,
);
add(
  "action_definition_revisions",
  "workspace equality is application check",
  (r) => {
    r.workspaceId = "workspace_00000000000000000000000001";
  },
  true,
  false,
);
add("action_definitions", "resource workflow rejected", (r) => {
  r.definition.resources = [
    {
      kind: "external_descriptor",
      label: "Video",
      resourceType: "video",
      nextActionId: "send",
    },
  ];
});
add(
  "reasoning_decisions",
  "historical candidate",
  (r) => {
    delete r.candidates[0].action;
  },
  true,
);
add("reasoning_decisions", "bad Action revision", (r) => {
  r.candidates[0].action.revision = 0;
});
add(
  "crm_tasks",
  "historical reasoning link",
  (r) => {
    delete r.reasoning.action;
  },
  true,
);
add("crm_tasks", "workflow link rejected", (r) => {
  r.reasoning.nextActionId = "send";
});
add("crm_tasks", "bad Action hash", (r) => {
  r.reasoning.action.contentHash = "bad";
});
export function actionApplicationAccepts(collection: string, value: Document) {
  try {
    if (collection === "crm_tasks") {
      const { reasoning, ...record } = value;
      parseActionTask({ record, reasoning });
    } else if (collection === "reasoning_decisions")
      ReasoningDecisionV17Schema.parse(value);
    else
      ACTION_LIBRARY_SCHEMAS[
        collection as keyof typeof ACTION_LIBRARY_SCHEMAS
      ].parse(value);
    return true;
  } catch {
    return false;
  }
}
