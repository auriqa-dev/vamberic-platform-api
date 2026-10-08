import { z } from "zod";
import { partnerHumanSchema } from "./partners";
import { platformIdSchema } from "./schemas";
const text = z.string().trim().max(2000);
const list = z.array(z.string().trim().min(1).max(500)).max(20);
export const PersonalitySchema = z
  .object({
    attributes: list,
    character: text,
    values: text,
    perception: text,
    boundaries: text,
  })
  .strict();
export const ToneSchema = z
  .object({
    defaultTone: text,
    attributes: list,
    boundaries: text,
    variations: z
      .array(
        z
          .object({
            context: z.enum([
              "website",
              "linkedin",
              "email",
              "article",
              "newsletter",
              "interaction",
            ]),
            guidance: text,
          })
          .strict(),
      )
      .max(6)
      .refine(
        (v) => new Set(v.map((x) => x.context)).size === v.length,
        "Choose each context once",
      ),
  })
  .strict();
export const WritingStyleSchema = z
  .object({
    characteristics: text,
    structure: text,
    narrative: text,
    evidence: text,
    conventions: text,
    exclusions: text,
    inspirations: z
      .array(
        z
          .object({
            reference: z.string().trim().min(1).max(300),
            interpretation: z.string().trim().min(1).max(1000),
          })
          .strict(),
      )
      .max(10),
  })
  .strict();
export const ExpressionContentSchema = z
  .object({
    personality: PersonalitySchema,
    tone: ToneSchema,
    writingStyle: WritingStyleSchema,
  })
  .strict();
export const ExpressionDimensionSchema = z.enum([
  "personality",
  "tone",
  "writingStyle",
]);
export const CommunicationFormatSchema = z.enum([
  "website",
  "linkedin",
  "email",
  "article",
  "newsletter",
  "interaction",
]);
export type CommunicationFormat = z.infer<typeof CommunicationFormatSchema>;
export type ExpressionContent = z.infer<typeof ExpressionContentSchema>;
export type ExpressionDimension = z.infer<typeof ExpressionDimensionSchema>;
const provenance = {
  originalDescription: z.string().max(4000),
  sourceGenerationId: platformIdSchema("event").optional(),
  savedAt: z.date(),
  savedBy: partnerHumanSchema,
};
function state<T extends z.ZodTypeAny>(content: T) {
  const entry = z
    .object({ ...provenance, content, proposedContent: content.optional() })
    .strict();
  return z
    .object({
      draft: entry.optional(),
      approved: entry
        .extend({ approvedAt: z.date(), approvedBy: partnerHumanSchema })
        .optional(),
    })
    .strict();
}
export const BrandExpressionSchema = z
  .object({
    personality: state(PersonalitySchema).optional(),
    tone: state(ToneSchema).optional(),
    writingStyle: state(WritingStyleSchema).optional(),
  })
  .strict();
export const expressionDefaults: ExpressionContent = {
  personality: {
    attributes: [],
    character: "",
    values: "",
    perception: "",
    boundaries: "",
  },
  tone: { defaultTone: "", attributes: [], boundaries: "", variations: [] },
  writingStyle: {
    characteristics: "",
    structure: "",
    narrative: "",
    evidence: "",
    conventions: "",
    exclusions: "",
    inspirations: [],
  },
};
