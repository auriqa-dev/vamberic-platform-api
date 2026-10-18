import { interactionReply } from "../interaction/model";
import { emailOutput } from "../email-content/model";
import { nbaDecision } from "../nba/model";
import { researchOutput } from "../research/model";
import { workspaceHenryReply } from "./henry-model";
import { z } from "zod";
const text = (n = 2000) => z.string().trim().max(n);
const list = (n = 2000) => z.array(text(n)).max(40);
export const reference = z
  .object({ id: z.string().min(1), revision: z.number().int().positive() })
  .strict();
export const scope = z
  .object({
    brandId: z.string().min(1),
    products: z.array(reference).max(20),
    offers: z.array(reference).max(20),
    audiences: z.array(reference).max(20),
  })
  .strict();
export const contextBrief = z
  .object({
    objectives: list(),
    priorities: list(),
    constraints: list(),
    channels: list(100),
    timeHorizon: text(300),
    measurement: list(),
    questions: list(),
  })
  .strict();
export const assetAssociation = z.object({
  offerId: text(100), offerRevision: z.number().int().positive(),
  audienceIds: list(100).default([]), buyerIds: list(100).default([]),
  campaignIds: list(100).default([]), requirement: text(1000),
  relevance: z.number().min(0).max(1), reason: text(),
  decision: z.enum(["suggested", "accepted", "excluded"]).default("suggested"),
  contextHash: text(100).default(""), contentHash: text(100).default(""),
}).strict();
export const assetData = z
  .object({
    offerOutput: z.object({offerId:z.string(),offerRevision:z.number().int().positive(),offerStatus:z.string(),designId:z.string(),designUpdatedAt:z.string(),methodologyId:z.string(),methodologyVersion:z.number().int().positive(),fingerprint:z.string()}).strict().nullable().default(null),
    title: text(200).min(1),
    classification: z.enum(["core", "channel", "unclassified"]),
    assetType: text(100).min(1),
    channel: text(100),
    url: z
      .string()
      .url()
      .max(2048)
      .regex(
        /^https?:\/\/[^/@\s]+(?:[/?#]|$)/i,
        "Use an HTTP or HTTPS URL without embedded credentials",
      )
      .or(z.literal("")),
    text: text(180000),
    contentTextId: text(100).default(""),
    description: text(),
    sourceDocumentId: z.string(),
    sourceDocumentRevision: z.number().int().nonnegative().default(0),
    sourceMetadata: z
      .object({
        canonicalUrl: text(2048),
        headings: list(300),
        checkedAt: text(100),
        producer: text(200),
        briefId: text(100),
        briefVersion: z.number().int().nonnegative(),
        capabilityId: text(100),
        integrationId: text(100),
        executionId: text(100).default(""),
        publication: text(200).default(""),
        publicationDate: text(100).default(""),
      })
      .strict()
      .default({
        canonicalUrl: "",
        headings: [],
        checkedAt: "",
        producer: "",
        briefId: "",
        briefVersion: 0,
        capabilityId: "",
        integrationId: "",
      }),
    sourceAssetIds: list(100),
    scope,
    topics: list(200),
    buyerStages: list(100),
    claims: list(),
    evidence: list(),
    gaps: list(),
    reuse: list(),
    restrictions: list(),
    usageRights: z
      .enum(["unknown", "owned", "licensed", "reference_only", "restricted"])
      .default("unknown"),
    allowedUses: list(300).default([]),
    rightsNotes: text(2000).default(""),
    visibility: z.enum(["private", "published", "external_reference"]).default("private"),
    originalFilename: text(200).default(""),
    fileHash: text(100).default(""),
    uploadedAt: text(100).default(""),
    owner: text(200).default(""),
    processingNote: text(1000).default(""),
    language: text(40).default(""),
    region: text(100).default(""),
    archived: z.boolean().default(false),
    associations: z.array(assetAssociation).max(200).default([]),
    sourceType: text(100).default("manual"),
    contentHash: text(100).default(""),
    discoveredAt: text(100).default(""),
    modifiedAt: text(100).default(""),
    analysisStatus: z.enum(["not_analysed", "needs_review", "reviewed"]),
  })
  .strict();
export const recommendation = z
  .object({
    key: text(100).min(1),
    title: text(200).min(1),
    kind: z.enum([
      "create",
      "adapt",
      "update",
      "research",
      "collect_evidence",
      "human_review",
      "other",
    ]),
    rationale: text(),
    priority: z.enum(["high", "medium", "low"]),
    feasibility: z.enum([
      "READY",
      "ADAPT",
      "ALTERNATIVE",
      "BLOCKED",
      "DEFERRED",
      "REJECTED",
    ]),
    dependencies: list(),
    evidence: list(),
    sourceAssetIds: list(100),
    buyerQuestions: list(),
    buyerStages: list(100),
    effort: text(300),
    contribution: text(500),
    alternative: text(),
  })
  .strict();
export const architectureData = z
  .object({
    scope,
    title: text(200).min(1),
    markdown: text(180000).min(1),
    recommendations: z.array(recommendation).max(40),
    mappingNotes: list(),
    confirmed: z.boolean(),
  })
  .strict();
export const strategyData = z
  .object({
    title: text(200).min(1),
    scope,
    context: contextBrief,
    assessment: text(6000),
    strengths: list(),
    gaps: list(),
    priorities: list(),
    coverage: list(),
    recommendations: z.array(recommendation).max(40),
    sourceRecordIds: list(100),
    changes: list(),
    limitations: list(),
  })
  .strict();
export const actionData = z
  .object({
    ...recommendation.shape,
    strategyId: z.string().min(1),
    strategyRevision: z.number().int().positive(),
    owner: text(200),
    decisionReason: text(),
    progress: z.enum([
      "proposed",
      "approved",
      "in_progress",
      "awaiting_input",
      "awaiting_approval",
      "completed",
      "deferred",
      "cancelled",
    ]),
    actionDefinitionId: z.string(),
  })
  .strict();
export const personalisation = z
  .object({
    objective: text(),
    depth: z.enum(["LIGHT", "CONTEXTUAL", "RESEARCH_LED"]),
    allowedContext: list(),
    requiredContext: list(),
    evidenceSources: list(),
    maximumAgeDays: z.number().int().nonnegative().nullable(),
    opening: text(),
    coreMessage: text(),
    variations: list(),
    prohibitedAssumptions: list(),
    fallback: text(),
    length: text(200),
    sendingRequirements: list(),
  })
  .strict();
export const executorType = z.enum([
  "internal_hvm",
  "external_application",
  "human_specialist",
  "external_agency",
  "queen",
  "client_team",
]);
export const briefData = z
  .object({
    title: text(200).min(1),
    actionId: z.string(),
    briefType: z
      .enum([
        "content",
        "pr",
        "event",
        "research",
        "partnership",
        "customer_evidence",
        "advertising",
        "technical",
        "other",
      ])
      .default("content"),
    workDescription: text(6000).default(""),
    deliverables: list().default([]),
    strategicRationale: text().default(""),
    dependencies: list().default([]),
    budgetContext: text(1000).default(""),
    targetDate: text(100).default(""),
    brandRequirements: list().default([]),
    completionCriteria: list().default([]),
    intendedOutcomes: list().default([]),
    successMeasures: list().default([]),
    scope,
    classification: z.enum(["core", "channel", "not_applicable"]),
    format: text(200),
    channel: text(100),
    objective: text(),
    audience: text(),
    buyerQuestion: text(),
    buyerStage: text(100),
    messages: list(),
    evidence: list(),
    sourceAssetIds: list(100),
    structure: list(),
    preserve: list(),
    mayChange: list(),
    cta: text(),
    restrictions: list(),
    approvalRequirements: list(),
    personalisation,
  })
  .strict();
export const executorData = z
  .object({
    scope,
    title: text(200).min(1),
    executorType,
    capabilities: list(200),
    capabilityIds: list(100),
    integrationId: text(100),
    contactDetails: text(1000),
    constraints: list(),
    available: z.boolean(),
  })
  .strict();
export const executionData = z
  .object({
    scope,
    title: text(200).min(1),
    briefId: text(100).min(1),
    briefVersion: z.number().int().positive(),
    actionDefinitionId: text(100).default(""),
    executorId: text(100).min(1),
    progress: z.enum([
      "proposed",
      "approved",
      "assigned",
      "accepted",
      "in_progress",
      "awaiting_input",
      "completed",
      "cancelled",
    ]),
    externalReference: text(500),
    notes: text(4000),
    completedAt: z.string().datetime().or(z.literal("")),
  })
  .strict();
export const effectivenessData = z
  .object({
    scope,
    title: text(200).min(1),
    category: z.enum([
      "completeness",
      "engagement",
      "audience_response",
      "commercial",
    ]),
    assetId: z.string(),
    executionId: text(100).default(""),
    opportunities: list().default([]),
    metric: text(200).min(1),
    value: text(300).min(1),
    observedAt: z.string().datetime(),
    source: text(2000).min(1),
    limitations: text(),
    eventIds: list(100),
  })
  .strict();
export const schemas = {
  asset: assetData,
  architecture: architectureData,
  strategy: strategyData,
  action: actionData,
  brief: briefData,
  effectiveness: effectivenessData,
  executor: executorData,
  execution: executionData,
};
export const kind = z.enum([
  "asset",
  "architecture",
  "strategy",
  "action",
  "brief",
  "effectiveness",
  "executor",
  "execution",
]);
export type Kind = z.infer<typeof kind>;
export const record = z.object({
  id: z.string(),
  version: z.number().int().positive(),
  kind,
  status: z.enum(["draft", "approved", "removed"]),
  data: z.record(z.unknown()),
  updatedAt: z.string(),
  fingerprint: z.string(),
  contextHash: z.string().optional(),
  sourceVersions: z
    .array(z.object({ id: z.string(), version: z.number() }))
    .default([]),
  needsReview: z.boolean().optional(),
  actionLibraryId: z.string().optional(),
  evidenceEventId: z.string().optional(),
  reuseEligibility: z
    .object({
      eligible: z.boolean(),
      reason: z.string(),
      allowedUses: z.array(z.string()),
    })
    .optional(),
});
export type ContentRecord = z.infer<typeof record>;
export function parseData(k: Kind, data: unknown) {
  return schemas[k].parse(data);
}
export const mutation = z
  .object({
    id: z.string().optional(),
    kind,
    expectedVersion: z.number().int().nonnegative(),
    operation: z.enum(["save", "approve", "remove", "associate"]),
    data: z.unknown().optional(),
    requestKey: z.string().uuid(),
  })
  .strict();
export const henryResult = z
  .object({
    reply: text(6000).min(1),
    strategy: strategyData.nullable(),
    brief: briefData.nullable(),
    reviewRecordId: text(200),
  })
  .strict();
export const henryDraft = z
  .object({
    kind: z.enum(["strategy", "brief"]),
    data: z.unknown(),
    recordId: text(200),
    version: z.number().int().nonnegative(),
  })
  .strict();
export const generateRequest = z
  .object({
    task: z.enum([
      "context",
      "analyse",
      "architecture",
      "strategy",
      "brief",
      "write",
      "henry",
    ]),
    conversationId: z.string().uuid().optional(),
    draft: henryDraft.optional(),
    scope,
    instruction: text(6000).min(1),
    recordIds: list(100),
    requestKey: z.string().uuid(),
  })
  .strict();
export const writtenContent = z.object({title: text(200).min(1), text: text(24000).min(1), description: text(1200), evidenceGaps: list(40)}).strict();
export const resultSchemas = {
  write: writtenContent,
  interaction: interactionReply,
  email: emailOutput,
  nba: nbaDecision.omit({ policyContextHash: true }),
  research: researchOutput,
  workspace_henry: workspaceHenryReply,
  henry: henryResult,
  context: contextBrief,
  analyse: assetData,
  architecture: architectureData,
  strategy: strategyData,
  brief: briefData,
};
