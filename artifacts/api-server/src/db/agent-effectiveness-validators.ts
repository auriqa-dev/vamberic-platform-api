import type { Document, IndexDescription } from "mongodb";
import {
  EffectivenessCaseSchema,
  EffectivenessRunLinkSchema,
} from "../domain/agent-effectiveness";
import {
  agentValidatorRoot,
  AGENT_CONTROL_PLANE_VALIDATORS,
} from "./agent-control-plane-validators";
import { EFFECTIVENESS_OPERATING_MONGO_VALIDATORS } from "./operating-validators";
import { offerMongoStructure } from "./offer-validators";
import {
  protocolArtifacts,
  protocolMongoStructure,
  protocolTextBounds,
} from "./agent-protocol-validators";
import { agentJsonIntegrity } from "./agent-json-integrity";
import Criteria from "@workspace/agent-runtime-protocol/json-schema/CriteriaSet" with { type: "json" };
import Candidate from "@workspace/agent-runtime-protocol/json-schema/CandidateRef" with { type: "json" };
import Evaluation from "@workspace/agent-runtime-protocol/json-schema/EvaluationPayload" with { type: "json" };
const arr = (p: string) => ({ $cond: [{ $isArray: p }, p, []] });
const unique = (p: string, field: string) => ({
  $eq: [
    { $size: arr(p) },
    {
      $size: {
        $setUnion: [
          { $map: { input: arr(p), as: "item", in: `$$item.${field}` } },
          [],
        ],
      },
    },
  ],
});
const run = structuredClone(AGENT_CONTROL_PLANE_VALIDATORS.agent_runs!);
run.$and[0].$jsonSchema.properties.effectiveness = offerMongoStructure(
  EffectivenessRunLinkSchema,
);
// Existing Outcome refinements remain intact. Only tagged Evaluation payloads
// receive the new structural restriction; cross-record authorization is service-owned.
const result = structuredClone(AGENT_CONTROL_PLANE_VALIDATORS.agent_results!);
result.$and.push({
  $or: [
    {
      "envelope.outcome.content.domainOutput.kind": {
        $ne: "effectiveness_evaluation",
      },
    },
    {
      $jsonSchema: {
        properties: {
          envelope: {
            properties: {
              outcome: {
                properties: {
                  content: {
                    properties: {
                      domainOutput: protocolMongoStructure(Evaluation),
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  ],
});
result.$and.push({
  $expr: {
    $cond: [
      {
        $eq: [
          "$envelope.outcome.content.domainOutput.kind",
          "effectiveness_evaluation",
        ],
      },
      protocolTextBounds(Evaluation, "$envelope.outcome.content.domainOutput"),
      true,
    ],
  },
});
const output = "$envelope.outcome.content.domainOutput";
result.$and.push({
  $expr: {
    $cond: [
      { $eq: [output + ".kind", "effectiveness_evaluation"] },
      {
        $and: [
          agentJsonIntegrity(output, 32768),
          unique(output + ".assessments", "criterionId"),
          {
            $allElementsTrue: [
              {
                $map: {
                  input: arr(output + ".assessments"),
                  as: "a",
                  in: {
                    $and: [
                      ...[
                        "evidenceIds",
                        "findingIds",
                        "lineageIds",
                        "gapIds",
                      ].map((k) => ({
                        $eq: [
                          { $size: arr("$$a." + k) },
                          { $size: { $setUnion: [arr("$$a." + k), []] } },
                        ],
                      })),
                    ],
                  },
                },
              },
            ],
          },
          {
            $allElementsTrue: [
              {
                $map: {
                  input: arr(output + ".defects"),
                  as: "d",
                  in: {
                    $anyElementTrue: [
                      {
                        $map: {
                          input: arr(output + ".assessments"),
                          as: "a",
                          in: {
                            $and: [
                              { $eq: ["$$a.criterionId", "$$d.criterionId"] },
                              { $eq: ["$$a.outcome", "fail"] },
                              { $in: ["$$d.findingId", arr("$$a.findingIds")] },
                            ],
                          },
                        },
                      },
                    ],
                  },
                },
              },
            ],
          },
        ],
      },
      true,
    ],
  },
});
const fields = {
  criteria: Criteria,
  totalBudget:
    protocolArtifacts.ClaimedWork!.properties.grant.properties.budgets,
  "allocations[].budget":
    protocolArtifacts.ClaimedWork!.properties.grant.properties.budgets,
  "candidates[].reference": Candidate,
};
const cleanRoot = {
  $arrayToObject: {
    $filter: {
      input: { $objectToArray: "$$ROOT" },
      as: "field",
      cond: { $ne: ["$$field.k", "_id"] },
    },
  },
};
const jsonRoot = {
  $mergeObjects: [
    cleanRoot,
    {
      createdAt: {
        $dateToString: {
          date: {
            $convert: {
              input: "$createdAt",
              to: "date",
              onError: null,
              onNull: null,
            },
          },
          format: "%Y-%m-%dT%H:%M:%S.%LZ",
          onNull: "",
        },
      },
      updatedAt: {
        $dateToString: {
          date: {
            $convert: {
              input: "$updatedAt",
              to: "date",
              onError: null,
              onNull: null,
            },
          },
          format: "%Y-%m-%dT%H:%M:%S.%LZ",
          onNull: "",
        },
      },
      dispositions: {
        $map: {
          input: arr("$dispositions"),
          as: "d",
          in: {
            $mergeObjects: [
              "$$d",
              {
                at: {
                  $dateToString: {
                    date: {
                      $convert: {
                        input: "$$d.at",
                        to: "date",
                        onError: null,
                        onNull: null,
                      },
                    },
                    format: "%Y-%m-%dT%H:%M:%S.%LZ",
                    onNull: "",
                  },
                },
              },
            ],
          },
        },
      },
    },
  ],
};
export const EFFECTIVENESS_VALIDATORS: Record<string, Document> = {
  ...EFFECTIVENESS_OPERATING_MONGO_VALIDATORS,
  agent_runs: run,
  agent_results: result,
  agent_effectiveness_cases: agentValidatorRoot(
    EffectivenessCaseSchema,
    {
      $and: [
        { $eq: ["$target.kind", "client_agent"] },
        {
          $gt: [
            {
              $convert: {
                input: "$totalBudget.deadline",
                to: "date",
                onError: null,
                onNull: null,
              },
            },
            "$createdAt",
          ],
        },
        {
          $eq: [
            {
              $size: {
                $setUnion: [
                  [
                    "$definition.maker",
                    "$definition.evaluator",
                    "$definition.revision",
                  ],
                  [],
                ],
              },
            },
            3,
          ],
        },
        unique("$policy.consequences", "key"),
        unique("$criteria.criteria", "id"),
        unique("$criteria.lineage", "id"),
        {
          $allElementsTrue: [
            {
              $map: {
                input: arr("$criteria.criteria"),
                as: "criterion",
                in: {
                  $and: [
                    {
                      $in: [
                        "$$criterion.consequenceKey",
                        {
                          $map: {
                            input: arr("$policy.consequences"),
                            as: "rule",
                            in: "$$rule.key",
                          },
                        },
                      ],
                    },
                    {
                      $setIsSubset: [
                        arr("$$criterion.lineageIds"),
                        {
                          $map: {
                            input: arr("$criteria.lineage"),
                            as: "source",
                            in: "$$source.id",
                          },
                        },
                      ],
                    },
                    {
                      $eq: [
                        { $size: arr("$$criterion.lineageIds") },
                        {
                          $size: {
                            $setUnion: [arr("$$criterion.lineageIds"), []],
                          },
                        },
                      ],
                    },
                  ],
                },
              },
            },
          ],
        },
        {
          $allElementsTrue: [
            {
              $map: {
                input: { $range: [0, { $size: arr("$candidates") }] },
                as: "i",
                in: {
                  $let: {
                    vars: {
                      item: { $arrayElemAt: [arr("$candidates"), "$$i"] },
                      previous: {
                        $arrayElemAt: [
                          arr("$candidates"),
                          { $subtract: ["$$i", 1] },
                        ],
                      },
                    },
                    in: {
                      $and: [
                        { $eq: ["$$item.reference.caseId", "$id"] },
                        {
                          $eq: [
                            "$$item.reference.revision",
                            { $add: ["$$i", 1] },
                          ],
                        },
                        {
                          $or: [
                            { $eq: ["$$i", 0] },
                            {
                              $eq: [
                                "$$item.predecessorDigest",
                                "$$previous.reference.contentDigest",
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  },
                },
              },
            },
          ],
        },
        {
          $or: [
            { $eq: [{ $type: "$activeRunId" }, "missing"] },
            {
              $in: [
                "$activeRunId",
                {
                  $map: {
                    input: arr("$allocations"),
                    as: "a",
                    in: "$$a.runId",
                  },
                },
              ],
            },
          ],
        },
        {
          $lte: [
            {
              $size: {
                $filter: {
                  input: arr("$allocations"),
                  as: "a",
                  cond: { $eq: ["$$a.role", "revision"] },
                },
              },
            },
            "$policy.maxRevisions",
          ],
        },
        {
          $lte: [
            { $size: arr("$candidates") },
            {
              $add: [
                1,
                {
                  $cond: [
                    { $isNumber: "$policy.maxRevisions" },
                    "$policy.maxRevisions",
                    -1,
                  ],
                },
              ],
            },
          ],
        },
        {
          $allElementsTrue: [
            {
              $map: {
                input: arr("$allocations"),
                as: "a",
                in: {
                  $lte: [
                    {
                      $convert: {
                        input: "$$a.budget.deadline",
                        to: "date",
                        onError: null,
                        onNull: null,
                      },
                    },
                    {
                      $convert: {
                        input: "$totalBudget.deadline",
                        to: "date",
                        onError: null,
                        onNull: null,
                      },
                    },
                  ],
                },
              },
            },
          ],
        },
        {
          $allElementsTrue: [
            {
              $map: {
                input: arr("$evaluations"),
                as: "e",
                in: {
                  $and: [
                    {
                      $in: [
                        "$$e.candidateRevision",
                        {
                          $map: {
                            input: arr("$candidates"),
                            as: "c",
                            in: "$$c.reference.revision",
                          },
                        },
                      ],
                    },
                    {
                      $anyElementTrue: [
                        {
                          $map: {
                            input: arr("$allocations"),
                            as: "a",
                            in: {
                              $and: [
                                { $eq: ["$$a.runId", "$$e.runId"] },
                                { $eq: ["$$a.role", "evaluator"] },
                              ],
                            },
                          },
                        },
                      ],
                    },
                  ],
                },
              },
            },
          ],
        },
        {
          $allElementsTrue: [
            {
              $map: {
                input: arr("$candidates"),
                as: "c",
                in: {
                  $anyElementTrue: [
                    {
                      $map: {
                        input: arr("$allocations"),
                        as: "a",
                        in: {
                          $and: [
                            { $eq: ["$$a.runId", "$$c.reference.runId"] },
                            { $ne: ["$$a.role", "evaluator"] },
                          ],
                        },
                      },
                    },
                  ],
                },
              },
            },
          ],
        },
        {
          $or: [
            { $ne: ["$status", "passed"] },
            {
              $let: {
                vars: {
                  decision: { $arrayElemAt: [arr("$decisions"), -1] },
                  candidate: { $arrayElemAt: [arr("$candidates"), -1] },
                },
                in: {
                  $and: [
                    { $eq: ["$$decision.kind", "pass"] },
                    {
                      $anyElementTrue: [
                        {
                          $map: {
                            input: arr("$evaluations"),
                            as: "e",
                            in: {
                              $and: [
                                { $ne: [{ $type: "$$e.resultId" }, "missing"] },
                                {
                                  $eq: [
                                    "$$e.resultId",
                                    "$$decision.evaluationResultId",
                                  ],
                                },
                                {
                                  $eq: [
                                    "$$e.candidateRevision",
                                    "$$candidate.reference.revision",
                                  ],
                                },
                              ],
                            },
                          },
                        },
                      ],
                    },
                  ],
                },
              },
            },
          ],
        },
        unique("$allocations", "runId"),
        unique("$evaluations", "requestKey"),
        unique("$dispositions", "requestKey"),
        { $lte: ["$policy.maxRevisions", "$definition.maxRevisions"] },
        ...["key", "version", "digest"].map((k) => ({
          $eq: ["$criteria.profile." + k, "$definition.profile." + k],
        })),
        ...["key", "version", "digest"].map((k) => ({
          $eq: ["$policy.identity." + k, "$definition.policy." + k],
        })),
        agentJsonIntegrity("$criteria", 24576),
        agentJsonIntegrity(jsonRoot, 196608),
      ],
    },
    Object.fromEntries(
      Object.entries(fields)
        .filter(([p]) => !p.includes("[]"))
        .map(([p, v]) => ["$" + p, v]),
    ),
    fields,
  ),
};
export const EFFECTIVENESS_COLLECTION_DEFINITIONS: {
  name: "agent_effectiveness_cases";
  indexes: IndexDescription[];
  reason: string;
}[] = [
  {
    name: "agent_effectiveness_cases",
    reason: "Bounded effectiveness coordination and Queen exception state",
    indexes: [
      { key: { id: 1 }, name: "id_unique", unique: true },
      {
        key: {
          workspaceId: 1,
          "requester.issuer": 1,
          "requester.id": 1,
          requestKey: 1,
        },
        name: "workspace_requester_request_unique",
        unique: true,
      },
      {
        key: { workspaceId: 1, status: 1, updatedAt: 1, id: 1 },
        name: "workspace_exceptions",
      },
      {
        key: {
          workspaceId: 1,
          "requester.issuer": 1,
          "requester.id": 1,
          createdAt: -1,
          id: 1,
        },
        name: "workspace_requester_created",
      },
      { key: { workspaceId: 1, rootRunId: 1 }, name: "workspace_root" },
    ],
  },
];
