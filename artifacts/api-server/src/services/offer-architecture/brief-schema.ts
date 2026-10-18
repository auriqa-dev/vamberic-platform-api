import { z } from "zod";
import { platformIdSchema } from "../../domain";

export const OFFER_BRIEF_FIELDS = [
  "commercialObjective",
  "marketHypothesis",
  "problemAndOutcome",
  "differentiation",
  "pricingAndPackaging",
  "purchasingProcess",
  "conversionGoal",
  "existingCommitments",
  "questionsAndResearch",
] as const;
const statement = z
  .object({
    text: z.string().trim().min(1).max(2000),
    origin: z.enum(["product_fact", "queen_supplied", "hypothesis", "unknown"]),
  })
  .strict();
export const OfferBriefSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    ...(Object.fromEntries(
      OFFER_BRIEF_FIELDS.map((k) => [k, z.array(statement).max(10)]),
    ) as Record<
      (typeof OFFER_BRIEF_FIELDS)[number],
      z.ZodArray<typeof statement>
    >),
  })
  .strict();
export const MethodologyRecommendationSchema = z
  .object({
    id: platformIdSchema("offermethodology"),
    version: z.number().int().positive(),
    rationale: z.string().trim().min(1).max(2000),
  })
  .strict();
export const OfferBriefInterpretationSchema = z
  .object({
    explanation: z.string().trim().min(1).max(2000),
    offers: z
      .array(
        z
          .object({
            existingOfferId: z.union([
              platformIdSchema("offer"),
              z.literal(null),
            ]),
            brief: OfferBriefSchema,
            methodologyRecommendation:
              MethodologyRecommendationSchema.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(5),
  })
  .strict();
export type OfferBriefInterpretation = z.infer<
  typeof OfferBriefInterpretationSchema
>;
export type OfferBriefInterpreter = (
  input: {
    intent: string;
    product: unknown;
    existingOffers: unknown[];
    methodologies?: unknown[];
    recommendationOnly?: {
      existingOfferId: string | null;
      brief: z.infer<typeof OfferBriefSchema>;
    };
  },
  signal: AbortSignal,
) => Promise<{
  interpretation: OfferBriefInterpretation;
  usage: { model: string; inputTokens: number; outputTokens: number };
}>;
