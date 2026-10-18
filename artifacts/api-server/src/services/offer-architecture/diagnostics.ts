import { z } from "zod";

export type OfferStage =
  | "starting"
  | "research"
  | "pages"
  | "provider"
  | "response"
  | "validation"
  | "design"
  | "persistence";
export type OfferDiagnostic = {
  stage: OfferStage;
  outcome: "started" | "complete" | "warning" | "failed";
  elapsedMs: number;
  code?: string;
  httpStatus?: number;
  issues?: { field: string; code: string }[];
  count?: number;
};
export type OfferObserver = (entry: OfferDiagnostic) => Promise<void>;
export class OfferProviderError extends Error {
  constructor(readonly httpStatus: number) {
    super("Offer provider request failed");
  }
}
export class OfferIncompleteError extends Error {
  constructor(readonly reason: "output_limit" | "content_filter" | "incomplete", readonly usage?: {model:string;inputTokens:number;outputTokens:number;searchCalls?:number}) {
    super("Offer response incomplete");
  }
}
const known = new Map([
  ["Brand or company changed during generation", "context_changed"],
  ["Source changed during generation", "source_changed"],
  ["Generation expired", "generation_expired"],
  [
    "Offer changed during refinement; your saved content is unchanged",
    "offer_changed",
  ],
  ["Context too large", "context_too_large"],
  ["Response too large", "response_too_large"],
  ["Research context too large", "context_too_large"],
  ["Research response too large", "response_too_large"],
  ["Research did not execute", "search_not_executed"],
  ["Invalid provider JSON", "invalid_json"],
  ["Invalid output", "missing_output"],
  ["Invalid targets", "target_mismatch"],
  ["Invalid source or stage", "methodology_stage_mismatch"],
]);
const safeFields = new Set([
  "id",
  "version",
  "rationale",
  "methodologyRecommendation",
  "offers",
  "brief",
  "existingOfferId",
  "explanation",
  "definition",
  "stages",
  "researchBrief",
  "competitors",
  "status",
  "usage",
  "output",
  "work",
  "sources",
  "name",
  "targetIcpIds",
  "targetBuyerProfileIds",
  "headlineProposition",
  "valueProposition",
  "commercialTerms",
  "options",
  "pricingModel",
  "price",
  "amount",
  "currency",
  "primaryCallToAction",
  "stageKey",
  "summary",
  "questions",
  "identity",
  "kind",
  "sourceIndexes",
  "relevance",
  "positioning",
  "strengths",
  "weaknessesGaps",
  "buying_situations",
  "signals",
  "research_questions",
  "inclusions",
  "exclusions",
  "priorities",
  "personalisation_evidence",
  "value_messages",
  "proof",
  "next_steps",
  "content",
  "text",
  "type",
  "model",
  "input_tokens",
  "output_tokens",
  "notes",
  "unknowns",
  "evidence",
  "groups",
  "items",
  "key",
  "reference",
  "observedAt",
  "competitiveAnalysis",
]);
// Never persist exception messages, provider bodies, values, URLs or stacks.
export function safeOfferFailure(
  error: unknown,
): Pick<OfferDiagnostic, "code" | "httpStatus" | "issues"> {
  if (error instanceof OfferIncompleteError) return {code: `provider_${error.reason}`};
  if (error instanceof OfferProviderError)
    return { code: "provider_http_error", httpStatus: error.httpStatus };
  if (error instanceof z.ZodError)
    return {
      code: "schema_validation",
      issues: error.issues.slice(0, 12).map((i) => ({
        field:
          i.path
            .slice(0, 8)
            .map((part) =>
              typeof part === "number"
                ? part
                : safeFields.has(part)
                  ? part
                  : "other",
            )
            .join(".") || "root",
        code: i.code,
      })),
    };
  if (error instanceof Error) {
    if (["TimeoutError", "AbortError"].includes(error.name))
      return { code: "timeout_or_cancelled" };
    if (error instanceof SyntaxError) return { code: "invalid_json" };
    if (known.has(error.message)) return { code: known.get(error.message)! };
    if (error.name === "MongoServerError")
      return {
        code:
          "database_error" +
          ("code" in error && typeof error.code === "number"
            ? `_${error.code}`
            : ""),
      };
    if (error.name === "OfferConflict") return { code: "state_conflict" };
  }
  return { code: "unexpected_error" };
}
