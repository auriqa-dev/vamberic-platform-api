import { z } from "zod";
import {
  basePersistenceSchema,
  platformIdSchema,
  OrganisationSchema,
} from "./schemas";
import { partnerHumanSchema } from "./partners";
import { semanticHash } from "./hive-definitions";
import {
  methodologyKeySchema,
  getOfferMethodology,
} from "./offer-methodologies";

const text = (max = 2000) => z.string().trim().min(1).max(max);
const texts = () => z.array(text()).max(40);
export const OfferQualificationShape = {
  conversionOutcome: text().optional(),
  intermediateOutcomes: texts().optional(),
  qualificationCriteria: texts().optional(),
  desirableQualification: texts().optional(),
  acceptableUnknowns: texts().optional(),
  qualificationDisqualifiers: texts().optional(),
  humanReviewTriggers: texts().optional(),
  salesReadiness: text().optional(),
  handoverRecipient: text().optional(),
  handoverRequirements: texts().optional(),
  afterHandover: text().optional(),
  bookingUrl: text(2048).url().refine(v => /^https:\/\//i.test(v), "Use an HTTPS booking URL").optional(),
  meetingPurpose: text().optional(),
};
const key = methodologyKeySchema;
const refIds = (prefix: "icp" | "buyerprofile", minimum = 0) =>
  z
    .array(platformIdSchema(prefix))
    .min(minimum)
    .max(40)
    .refine((v) => new Set(v).size === v.length, "Duplicate targets");
export const OfferMoneySchema = OrganisationSchema.shape.annualRevenue
  .unwrap()
  .omit({ observedAt: true });
export const DesignReferenceSchema = z
  .object({
    key,
    kind: z.enum(["hive_revision", "external_evidence", "user_supplied"]),
    reference: text(1000),
    description: text().optional(),
    provider: text(100).optional(),
    observedAt: z.string().datetime(),
  })
  .strict();
export const DesignAssumptionSchema = z
  .object({
    key,
    statement: text(),
    rationale: text().optional(),
    evidenceReferenceKeys: z.array(key).max(40).default([]),
    validationQuestion: text().optional(),
    status: z.enum(["untested", "supported", "rejected"]).default("untested"),
  })
  .strict();
export const DesignFactSchema = z
  .object({
    statement: text(),
    evidenceReferenceKeys: z.array(key).min(1).max(40),
  })
  .strict();
export const DesignOptionSchema = z
  .object({
    key,
    name: text(200),
    description: text(),
    status: z.enum(["considered", "selected", "rejected"]),
    rationale: text().optional(),
    requiresOfferingChange: z.boolean().default(false),
    requiredOfferingChange: text().optional(),
  })
  .strict();
export const StageWorkSchema = z
  .object({
    stageKey: key,
    status: z.enum(["not_started", "in_progress", "completed"]),
    research: z
      .array(
        z
          .object({
            finding: text(),
            evidenceReferenceKeys: z.array(key).min(1).max(40),
          })
          .strict(),
      )
      .max(40)
      .default([]),
    agentFindings: z
      .array(
        z
          .object({
            summary: text(),
            evidenceReferenceKeys: z.array(key).max(40),
            unverified: z.literal(true),
          })
          .strict(),
      )
      .max(40)
      .default([]),
    userInputs: z
      .array(z.object({ question: text(), answer: text(4000) }).strict())
      .max(40)
      .default([]),
    facts: z.array(DesignFactSchema).max(40).default([]),
    optionsConsidered: z.array(DesignOptionSchema).max(40).default([]),
    selectedOptionKeys: z.array(key).max(40).default([]),
    decisionRationale: text(4000).optional(),
    assumptions: z.array(DesignAssumptionSchema).max(40).default([]),
    evidence: z.array(DesignReferenceSchema).max(100).default([]),
    unknowns: texts().default([]),
    notes: texts().default([]),
    groups: z
      .array(z.object({ key, name: text(200), items: texts() }).strict())
      .max(20)
      .default([]),
  })
  .strict()
  .superRefine((v, ctx) => {
    const options = new Map(v.optionsConsidered.map((o) => [o.key, o]));
    const references = new Set(v.evidence.map((e) => e.key));
    if (
      options.size !== v.optionsConsidered.length ||
      references.size !== v.evidence.length ||
      new Set(v.selectedOptionKeys).size !== v.selectedOptionKeys.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Duplicate stage artifact identities",
      });
    if (
      v.selectedOptionKeys.some((k) => options.get(k)?.status !== "selected") ||
      v.optionsConsidered.some(
        (o) => o.status === "selected" && !v.selectedOptionKeys.includes(o.key),
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Selected options must match selected artifacts",
      });
    if (
      [...v.research, ...v.facts, ...v.agentFindings, ...v.assumptions].some(
        (x) => x.evidenceReferenceKeys.some((k) => !references.has(k)),
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Unknown stage evidence reference",
      });
    if (
      v.optionsConsidered.some(
        (o) =>
          (o.status !== "considered" && !o.rationale) ||
          (o.requiresOfferingChange && !o.requiredOfferingChange),
      )
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Decisions and Offering change proposals require explicit rationale",
      });
    if (v.status === "completed" && !v.decisionRationale)
      ctx.addIssue({
        code: "custom",
        message: "Completed stage requires decision rationale",
      });
  });
export const CompetitiveFindingSchema = z
  .object({
    key,
    identity: text(300),
    kind: z.enum(["competitor", "substitute", "alternative"]),
    sources: z.array(DesignReferenceSchema).min(1).max(20),
    pricingPackaging: text().optional(),
    capabilities: texts().optional(),
    positioning: text().optional(),
    targetBuyer: text().optional(),
    deliveryModel: text().optional(),
    contractCommitmentFriction: text().optional(),
    strengths: texts().default([]),
    weaknessesGaps: texts().default([]),
    relevance: text(),
    comparisonNotes: texts().default([]),
  })
  .strict();
export const CompetitiveAnalysisSchema = z
  .object({
    researchedAt: z.string().datetime(),
    scope: text(),
    findings: z.array(CompetitiveFindingSchema).min(1).max(30),
    selectedPositioning: text(),
    materialGaps: texts().default([]),
    limitations: texts().default([]),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      v.findings.some(
        (f) => !f.sources.some((s) => s.kind === "external_evidence"),
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Competitive findings require externally sourced evidence",
      });
  });
export const OfferDesignWorkSchema = z
  .object({
    name: text(200),
    targetIcpIds: refIds("icp").default([]),
    targetBuyerProfileIds: refIds("buyerprofile").default([]),
    currentStageKey: key.optional(),
    completedStageKeys: z.array(key).max(30).default([]),
    stages: z.array(StageWorkSchema).max(30).default([]),
    competitiveAnalysis: CompetitiveAnalysisSchema.optional(),
  })
  .strict();
export const MethodologyReferenceSchema = z
  .object({
    methodologyId: platformIdSchema("offermethodology"),
    methodologyKey: key,
    methodologyVersion: z.number().int().positive(),
  })
  .strict();
const revisionReference = (prefix: "offering" | "icp" | "buyerprofile") =>
  z
    .object({
      id: platformIdSchema(prefix),
      revision: z.number().int().positive(),
      contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict();
export const OfferSourceRevisionsSchema = z
  .object({
    offering: revisionReference("offering"),
    icps: z.array(revisionReference("icp")).max(40),
    buyers: z.array(revisionReference("buyerprofile")).max(40),
  })
  .strict();
export const OfferLineageSchema = OfferSourceRevisionsSchema.extend({
  offerDesignId: platformIdSchema("offerdesign").optional(),
  offerDesignUpdatedAt: z.date().optional(),
  methodology: MethodologyReferenceSchema.optional(),
}).strict();
const base = basePersistenceSchema
  .extend({
    workspaceId: platformIdSchema("workspace"),
    createdBy: partnerHumanSchema,
    updatedBy: partnerHumanSchema,
  })
  .strict();
export const OfferDesignRecordSchema = base
  .extend({
    id: platformIdSchema("offerdesign"),
    offeringId: platformIdSchema("offering"),
    ...MethodologyReferenceSchema.shape,
    status: z.enum([
      "draft",
      "in_progress",
      "ready_for_review",
      "completed",
      "abandoned",
    ]),
    work: OfferDesignWorkSchema,
    sourceRevisions: OfferSourceRevisionsSchema.optional(),
  })
  .strict();
function chronology(
  v: { createdAt: Date; updatedAt: Date; archived: boolean; archivedAt?: Date },
  ctx: z.RefinementCtx,
) {
  if (
    v.updatedAt < v.createdAt ||
    v.archived !== Boolean(v.archivedAt) ||
    (v.archivedAt && (v.archivedAt < v.createdAt || v.archivedAt > v.updatedAt))
  )
    ctx.addIssue({ code: "custom", message: "Invalid lifecycle chronology" });
}
export const OfferDesignSchema = OfferDesignRecordSchema.superRefine(
  (v, ctx) => {
    chronology(v, ctx);
    if (v.status === "completed" && !v.sourceRevisions)
      ctx.addIssue({
        code: "custom",
        message: "Completed design requires approved source revisions",
      });
    if ((v.status === "abandoned") !== v.archived)
      ctx.addIssue({ code: "custom", message: "Invalid design archive state" });
    const method = getOfferMethodology(v.methodologyId, v.methodologyVersion);
    if (!method || method.key !== v.methodologyKey) {
      ctx.addIssue({ code: "custom", message: "Unknown methodology version" });
      return;
    }
    const keys = new Set(method.stages.map((s) => s.key));
    if (
      (v.work.currentStageKey && !keys.has(v.work.currentStageKey)) ||
      v.work.stages.some((s) => !keys.has(s.stageKey)) ||
      v.work.completedStageKeys.some((k) => !keys.has(k))
    )
      ctx.addIssue({ code: "custom", message: "Unknown methodology stage" });
    if (
      new Set(v.work.stages.map((s) => s.stageKey)).size !==
        v.work.stages.length ||
      new Set(v.work.completedStageKeys).size !==
        v.work.completedStageKeys.length
    )
      ctx.addIssue({ code: "custom", message: "Duplicate stage progress" });
    const completed = v.work.stages
      .filter((s) => s.status === "completed")
      .map((s) => s.stageKey)
      .sort();
    if (
      JSON.stringify(completed) !==
      JSON.stringify([...v.work.completedStageKeys].sort())
    )
      ctx.addIssue({
        code: "custom",
        message: "Stage completion and progress differ",
      });
    if (
      ["ready_for_review", "completed"].includes(v.status) &&
      (completed.length !== method.stages.length || !v.work.competitiveAnalysis)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Review/completion requires all stages and competitive analysis",
      });
    if (Buffer.byteLength(JSON.stringify(v)) > 200000)
      ctx.addIssue({ code: "custom", message: "Offer Design exceeds 200KB" });
  },
);
const PriceOptionSchema = z
  .object({
    name: text(200),
    pricingModel: z.enum([
      "one_off",
      "recurring",
      "per_site",
      "per_user",
      "usage_based",
      "commission",
      "free",
      "bundled",
      "custom_quote",
    ]),
    price: OfferMoneySchema.optional(),
    basis: text(300).optional(),
    billingFrequency: z
      .enum(["one_off", "monthly", "quarterly", "annual", "usage", "custom"])
      .optional(),
    minimumCommitment: text().optional(),
    contractTerm: text().optional(),
    setupFee: OfferMoneySchema.optional(),
    paymentStructure: text().optional(),
    commissionRate: z.number().min(0).max(1).optional(),
    commercialNotes: texts().default([]),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.pricingModel === "free" && v.price && v.price.amountMinor !== 0)
      ctx.addIssue({ code: "custom", message: "Free price must be zero" });
  });
export const OfferContentSchema = z
  .object({
    name: text(200),
    targetIcpIds: refIds("icp").default([]),
    targetBuyerProfileIds: refIds("buyerprofile").default([]),
    headlineProposition: text(),
    valueProposition: text(4000),
    promise: text().optional(),
    components: z
      .array(
        z
          .object({
            name: text(200),
            description: text(),
            order: z.number().int().nonnegative(),
            included: z.boolean(),
            deliverables: texts().default([]),
            customerCommitment: text().optional(),
            commercialEffect: PriceOptionSchema.optional(),
          })
          .strict(),
      )
      .max(40)
      .default([]),
    commercialTerms: z
      .object({
        options: z.array(PriceOptionSchema).min(1).max(20),
        commercialNotes: texts().default([]),
      })
      .strict(),
    incentives: z
      .array(
        z
          .object({ description: text(), conditions: text().optional() })
          .strict(),
      )
      .max(20)
      .default([]),
    riskReduction: z
      .object({
        guarantee: text().optional(),
        conditions: texts().default([]),
        exclusions: texts().default([]),
        limitations: texts().default([]),
        otherMechanisms: texts().default([]),
      })
      .strict()
      .optional(),
    customerCommitments: texts().default([]),
    differentiators: texts().default([]),
    whyChooseThisOffer: text().optional(),
    competitivePositioning: text().optional(),
    objections: z
      .array(
        z
          .object({
            objection: text(),
            response: text(),
            evidenceReferences: z
              .array(DesignReferenceSchema)
              .max(20)
              .default([]),
          })
          .strict(),
      )
      .max(30)
      .default([]),
    proofPoints: texts().default([]),
    evidenceRequirements: texts().default([]),
    supportableClaims: texts().default([]),
    ...OfferQualificationShape,
    primaryCallToAction: text(),
    secondaryCallToAction: text().optional(),
    afterResponse: text().optional(),
    afterPurchase: text().optional(),
    onboardingExpectations: texts().default([]),
    eligibilityCriteria: texts().default([]),
    exclusions: texts().default([]),
    capacityConstraints: texts().default([]),
    geographicConstraints: texts().default([]),
    rationale: text(4000).optional(),
    assumptions: z.array(DesignAssumptionSchema).max(40).default([]),
    unknowns: texts().default([]),
  })
  .strict();
export const OfferRecordSchema = base
  .extend({
    id: platformIdSchema("offer"),
    offeringId: platformIdSchema("offering"),
    offerDesignId: platformIdSchema("offerdesign").optional(),
    definition: OfferContentSchema,
    competitiveAnalysis: CompetitiveAnalysisSchema.optional(),
    status: z.enum(["draft", "approved", "retired"]),
    revision: z.number().int().positive(),
    approvedRevision: z.number().int().positive().optional(),
    approvedAt: z.date().optional(),
    approvedBy: partnerHumanSchema.optional(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    lineage: OfferLineageSchema.optional(),
  })
  .strict();
export function offerHash(
  v: Pick<
    z.infer<typeof OfferRecordSchema>,
    "offeringId" | "offerDesignId" | "definition" | "competitiveAnalysis"
  >,
) {
  return semanticHash({
    offeringId: v.offeringId,
    offerDesignId: v.offerDesignId,
    definition: v.definition,
    competitiveAnalysis: v.competitiveAnalysis,
  });
}
export const OfferSchema = OfferRecordSchema.superRefine((v, ctx) => {
  chronology(v, ctx);
  if (
    (v.status === "retired") !== v.archived ||
    Boolean(v.approvedAt) !== Boolean(v.approvedBy) ||
    (v.status === "draft" && v.approvedAt) ||
    (v.approvedAt && (v.approvedAt < v.createdAt || v.approvedAt > v.updatedAt))
  )
    ctx.addIssue({ code: "custom", message: "Invalid Offer lifecycle" });
  if (
    (v.status === "approved" &&
      (!v.approvedAt ||
        !v.approvedBy ||
        !v.lineage ||
        !v.competitiveAnalysis ||
        v.approvedRevision !== v.revision)) ||
    (v.approvedRevision !== undefined &&
      (v.approvedRevision > v.revision ||
        (v.status === "draft" && v.approvedRevision >= v.revision)))
  )
    ctx.addIssue({
      code: "custom",
      message: "Invalid Offer approval/revision",
    });
  if (offerHash(v) !== v.contentHash)
    ctx.addIssue({ code: "custom", message: "Invalid Offer hash" });
  if (Buffer.byteLength(JSON.stringify(v)) > 200000)
    ctx.addIssue({ code: "custom", message: "Offer exceeds 200KB" });
});
export const OfferRevisionSchema = z
  .object({
    id: platformIdSchema("offerrevision"),
    workspaceId: platformIdSchema("workspace"),
    offerId: platformIdSchema("offer"),
    revision: z.number().int().positive(),
    snapshot: OfferSchema,
    designSnapshot: OfferDesignSchema.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      v.designSnapshot &&
      (v.designSnapshot.id !== v.snapshot.offerDesignId ||
        v.designSnapshot.workspaceId !== v.workspaceId ||
        v.designSnapshot.status !== "completed")
    )
      ctx.addIssue({
        code: "custom",
        message: "Invalid design lineage snapshot",
      });
    if (
      v.offerId !== v.snapshot.id ||
      v.workspaceId !== v.snapshot.workspaceId ||
      v.revision !== v.snapshot.revision ||
      v.snapshot.status !== "approved"
    )
      ctx.addIssue({
        code: "custom",
        message: "Invalid approved Offer snapshot",
      });
  });
export type OfferDesign = z.infer<typeof OfferDesignSchema>;
export type Offer = z.infer<typeof OfferSchema>;
export type OfferRevision = z.infer<typeof OfferRevisionSchema>;
