import { valuePropositionDevelopment } from "./value-proposition-development";
import { z } from "zod";
import { platformIdSchema } from "./schemas";

export const methodologyKeySchema = z
  .string()
  .max(80)
  .regex(/^[a-z][a-z0-9_]*$/);
const text = (max = 2000) => z.string().trim().min(1).max(max);
// Ordered plain-text learning blocks; references reuse the method's model and stages.
const LearningSectionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("concept"),
      key: methodologyKeySchema,
      title: text(200),
      explanation: text(4000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("example"),
      key: methodologyKeySchema,
      title: text(200),
      explanation: text(),
      productService: z.object({ name: text(200), summary: text() }).strict(),
      offer: text(2000),
      clientExample: z
        .object({
          source: z.literal("current_offering"),
          fields: z.tuple([z.literal("name"), z.literal("factual_summary")]),
          title: text(200),
          nextPrompt: text(),
        })
        .strict()
        .optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("conceptual_model"),
      key: methodologyKeySchema,
      title: text(200),
      explanation: text(4000),
      source: z.literal("conceptualModel"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("next_steps"),
      key: methodologyKeySchema,
      title: text(200),
      explanation: text(4000),
      source: z.literal("stages"),
    })
    .strict(),
]);
export const MethodologyLearningSchema = z
  .object({
    title: text(200),
    explanation: text(4000),
    sections: z.array(LearningSectionSchema).min(1).max(20),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (new Set(v.sections.map((s) => s.key)).size !== v.sections.length)
      ctx.addIssue({
        code: "custom",
        message: "Duplicate learning section key",
      });
  });
export const OfferMethodologySchema = z
  .object({
    id: platformIdSchema("offermethodology"),
    key: methodologyKeySchema,
    name: text(200),
    description: text(),
    version: z.number().int().positive(),
    status: z.enum(["active", "retired"]),
    introduction: text(4000),
    learning: MethodologyLearningSchema.optional(),
    conceptualModel: z
      .object({
        expression: text(500),
        dimensions: z
          .array(
            z
              .object({
                key: methodologyKeySchema,
                name: text(200),
                explanation: text(),
              })
              .strict(),
          )
          .min(1)
          .max(20),
      })
      .strict(),
    stages: z
      .array(
        z
          .object({
            key: methodologyKeySchema,
            name: text(200),
            description: text(),
            purpose: text(),
            order: z.number().int().nonnegative(),
            guidance: z.array(text()).max(30),
            requiredContext: z.array(text()).max(20).optional(),
            analysisRequirements: z.array(text()).max(20).optional(),
            expectedOutputs: z
              .array(
                z
                  .object({ key: methodologyKeySchema, description: text() })
                  .strict(),
              )
              .max(20)
              .optional(),
            validationDecisions: z.array(text()).max(20).optional(),
            completionCriteria: z.array(text()).max(20).optional(),
            workingDataSchema: z.literal("offer_stage_v1"),
            completionRequirements: z
              .array(z.enum(["decision_rationale", "competitive_analysis"]))
              .max(2),
          })
          .strict(),
      )
      .min(1)
      .max(30),
    createdAt: z.date(),
    updatedAt: z.date(),
    source: z.object({ system: z.literal("hvm") }).strict(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      new Set(v.stages.map((s) => s.key)).size !== v.stages.length ||
      new Set(v.stages.map((s) => s.order)).size !== v.stages.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Duplicate methodology stage identity/order",
      });
  });
export type OfferMethodology = z.infer<typeof OfferMethodologySchema>;

// Global, immutable catalogue versions. Add a version; never edit a published version.
// The UI consumes this data through the authenticated methodology read endpoint.
const stages = [
  [
    "market_context",
    "Market & Customer Context",
    "Establish the Offering, target ICPs and Buyer Profiles, and market context.",
    "Use Hive references and sourced competitive context; keep factual Offering knowledge distinct from design choices.",
  ],
  [
    "desired_outcome",
    "Desired Outcome",
    "Define the valuable change the customer wants.",
    "Record customer objectives, functional/business and relevant personal outcomes, value and supporting evidence.",
  ],
  [
    "confidence",
    "Confidence of Success",
    "Understand what builds or reduces belief in the result.",
    "Review credibility, mechanism, proof, track record, uncertainty and missing evidence.",
  ],
  [
    "time_to_value",
    "Time to Value",
    "Understand when meaningful benefit arrives.",
    "Compare delays, dependencies, acceleration opportunities and early wins; record the selected approach.",
  ],
  [
    "customer_effort",
    "Customer Effort & Friction",
    "Understand customer work, disruption and sacrifice.",
    "Consider implementation, internal resources, learning/change, purchase/adoption friction and ways to reduce effort.",
  ],
  [
    "obstacles",
    "Obstacles",
    "Identify barriers before, during and after purchase.",
    "Group obstacles by journey phase or category; distinguish evidence from assumptions.",
  ],
  [
    "solution_design",
    "Solution Design",
    "Evaluate ways to remove or reduce obstacles.",
    "Retain alternatives and explicit rationale. Flag required Offering changes separately; never rewrite factual Offering content here.",
  ],
  [
    "delivery_packaging",
    "Delivery & Packaging",
    "Structure the proposed delivery.",
    "Define core and optional components, sequence, mechanisms, inclusions/exclusions, customer commitments and deliverables.",
  ],
  [
    "value_stack",
    "Value Stack",
    "Select the combination of value in the proposition.",
    "Compare core/additional value, optional extras and perceived contribution; trim weak items. Bonuses are optional, never artificial requirements.",
  ],
  [
    "pricing_terms",
    "Pricing & Terms",
    "Define descriptive commercial terms.",
    "Compare pricing model, amount/unit, recurring or one-off charges, setup, tiers, term, commitment, payment structure and rationale. Do not execute billing.",
  ],
  [
    "risk_reduction",
    "Risk Reduction",
    "Reduce perceived risk appropriately.",
    "Consider proof, eligibility, conditions, exclusions and limitations. A guarantee is optional and must be supportable.",
  ],
  [
    "positioning",
    "Positioning & Differentiation",
    "Compare the proposition with current alternatives.",
    "Record externally sourced competitors/substitutes, pricing, capabilities, positioning, buyer, delivery and contract/friction comparisons, material gaps and chosen differentiation.",
  ],
  [
    "proposition_cta",
    "Proposition & CTA",
    "Define the strategic market-facing proposition.",
    "Specify headline, value, promise, why choose, primary/secondary CTA, eligibility and next step; not campaign copy.",
  ],
  [
    "review",
    "Review",
    "Review the proposal and remaining uncertainty.",
    "Review outcome, confidence, time, effort, risks, assumptions, unknowns, evidence gaps, competitive position and Offer summary. Completion does not approve an Offer.",
  ],
] as const;
const valueEquation = OfferMethodologySchema.parse({
  id: "offermethodology_00000000000000000000000001",
  key: "value_equation",
  name: "Value Equation",
  version: 1,
  status: "active",
  description:
    "A structured method for designing a supportable market-facing commercial proposition.",
  introduction:
    "A strong offer increases the value a customer expects to receive while reducing the time, effort and perceived risk involved in achieving it.",
  learning: {
    title: "From what you sell to how you sell it",
    explanation:
      "Your product or service is what you sell. Your offer is how you market and sell it.",
    sections: [
      {
        kind: "concept",
        key: "product_service",
        title: "Product / Service — what you sell",
        explanation:
          "Your product or service is what you sell. It describes what the customer gets, what it does, how it works and what it can legitimately deliver. Product/Service Understanding establishes this factual starting point.",
      },
      {
        kind: "concept",
        key: "customer",
        title: "Customer — who you sell it to",
        explanation:
          "Your customer is who you are designing the offer for. Different customers can value different outcomes, have different problems, respond to different proof and accept different commercial terms. We use our understanding of your customer segments and the people involved in buying.",
      },
      {
        kind: "concept",
        key: "offer",
        title: "Offer — how you market and sell it",
        explanation:
          "Your offer is how you market and sell your product or service to a particular customer. It combines what you sell with the customer's desired outcome, packaging, price and terms, proof, risk reduction and the next action you want them to take. The same product or service can have more than one offer: different customers, markets, buyer groups or commercial situations may call for different packages, pricing, terms, entry points, risk reduction or calls to action without changing the underlying product or service.",
      },
      {
        kind: "example",
        key: "example",
        title: "One service, a way to take it to market",
        explanation:
          "These illustrative terms show the distinction; they are not required pricing or promises for your business.",
        productService: {
          name: "Energy optimisation service",
          summary: "Helps identify opportunities to improve energy use.",
        },
        offer:
          "Free initial assessment → prioritised recommendations → fixed-price site assessment → optional ongoing measurement service.",
        clientExample: {
          source: "current_offering",
          fields: ["name", "factual_summary"],
          title: "What you're selling",
          nextPrompt: "Now we'll design how you take it to market.",
        },
      },
      {
        kind: "conceptual_model",
        key: "value_equation",
        title: "The Value Equation",
        explanation:
          "A strong offer increases the value a customer expects to receive while reducing the time, effort and perceived risk involved in achieving it. This is a conceptual guide, not a numerical score.",
        source: "conceptualModel",
      },
      {
        kind: "next_steps",
        key: "what_happens_next",
        title: "Designing your offer",
        explanation:
          "Now that we understand what you're selling and who you're selling it to, we'll design how to make it compelling to buy. The Offer Architect will guide you through the following stages for your review and decisions.",
        source: "stages",
      },
    ],
  },
  conceptualModel: {
    expression:
      "Offer Value = (Desired Outcome × Confidence of Success) / (Time to Value × Customer Effort)",
    dimensions: [
      {
        key: "desired_outcome",
        name: "Desired Outcome",
        explanation: "The valuable change the customer wants to achieve.",
      },
      {
        key: "confidence",
        name: "Confidence of Success",
        explanation:
          "The customer's supported belief that the result is achievable.",
      },
      {
        key: "time_to_value",
        name: "Time to Value",
        explanation: "The time until meaningful customer benefit.",
      },
      {
        key: "customer_effort",
        name: "Customer Effort",
        explanation:
          "The work, disruption and commitment required from the customer.",
      },
    ],
  },
  stages: stages.map(([key, name, purpose, guidance], order) => ({
    key,
    name,
    description: purpose,
    purpose,
    order,
    guidance: [guidance],
    workingDataSchema: "offer_stage_v1",
    completionRequirements:
      key === "positioning"
        ? ["decision_rationale", "competitive_analysis"]
        : ["decision_rationale"],
  })),
  createdAt: new Date("2026-09-30T00:00:00Z"),
  updatedAt: new Date("2026-09-30T00:00:00Z"),
  source: { system: "hvm" },
});
export function listOfferMethodologies(): OfferMethodology[] {
  return [
    structuredClone(valueEquation),
    OfferMethodologySchema.parse(structuredClone(valuePropositionDevelopment)),
  ];
}
export function getOfferMethodology(
  id: string,
  version: number,
): OfferMethodology | undefined {
  return listOfferMethodologies().find(
    (m) => m.id === id && m.version === version,
  );
}
