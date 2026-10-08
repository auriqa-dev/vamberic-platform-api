import type { BrandKit } from "../domain/brands";
import {
  CommunicationFormatSchema,
  type CommunicationFormat,
} from "../domain/brand-expression";
import { readCurrentBrandKit } from "./brand-kits";

export const formatConventions: Record<CommunicationFormat, string> = {
  website:
    "A clear, benefit-led introduction. Short paragraphs and a useful next step.",
  linkedin:
    "A focused social post with an engaging opening and short paragraphs. No invented hashtags or engagement claims.",
  email:
    "A short relevant email with a subject, brief paragraphs and one low-pressure next step. No invented familiarity or customer claims.",
  article:
    "A structured argument, useful headings, explicit reasoning and evidence. Do not invent research or citations.",
  newsletter:
    "An engaging opening, a coherent editorial narrative, practical implications and a concise close.",
  interaction:
    "A concise conversational response addressing the question directly. Do not impose long-form editorial structures.",
};
/** Pure projection; raw inspiration names and unapproved drafts never enter production context. */
export function projectBrandContext(
  kit: BrandKit,
  formatValue: CommunicationFormat,
  previewDrafts = false,
) {
  const format = CommunicationFormatSchema.parse(formatValue);
  const selected = <K extends "personality" | "tone" | "writingStyle">(
    key: K,
  ) =>
    (previewDrafts
      ? (kit.expression?.[key]?.draft ?? kit.expression?.[key]?.approved)
      : kit.expression?.[key]?.approved
    )?.content;
  const personality = selected("personality") as
    | import("../domain/brand-expression").ExpressionContent["personality"]
    | undefined;
  const tone = selected("tone") as
    import("../domain/brand-expression").ExpressionContent["tone"] | undefined;
  const style = selected("writingStyle") as
    | import("../domain/brand-expression").ExpressionContent["writingStyle"]
    | undefined;
  const legacy = kit.voice;
  return {
    kitId: kit.id,
    revision: kit.updatedAt.toISOString(),
    brandId: kit.brandId,
    workspaceId: kit.workspaceId,
    format,
    conventions: formatConventions[format],
    personality: personality ?? null,
    tone: tone
      ? {
          defaultTone: tone.defaultTone,
          attributes: tone.attributes,
          boundaries: tone.boundaries,
          guidance:
            tone.variations.find((v) => v.context === format)?.guidance ||
            tone.defaultTone,
        }
      : legacy
        ? {
            defaultTone: legacy.descriptors?.join(", ") ?? "",
            boundaries: legacy.avoidLanguage?.join("; ") ?? "",
            guidance: legacy.descriptors?.join(", ") ?? "",
          }
        : null,
    writingStyle: style
      ? {
          characteristics: style.characteristics,
          ...(format === "interaction"
            ? {}
            : { structure: style.structure, narrative: style.narrative }),
          evidence: style.evidence,
          conventions: style.conventions,
          exclusions: style.exclusions,
          inspirationCharacteristics: style.inspirations.map(
            (i) => i.interpretation,
          ),
        }
      : legacy
        ? {
            characteristics: legacy.writingStyle ?? "",
            principles: legacy.principles ?? [],
          }
        : null,
    terminology: kit.terminology ?? null,
    mode: previewDrafts ? "preview" : "approved",
  };
}
/** Retrieve fresh approved client/brand context for each generation; never Queen-level configuration. */
export async function readApprovedBrandContext(
  ...args: [...Parameters<typeof readCurrentBrandKit>, CommunicationFormat]
) {
  const [db, authority, context, w, b, format] = args;
  const current = await readCurrentBrandKit(db, authority, context, w, b);
  return current ? projectBrandContext(current.kit, format) : null;
}
