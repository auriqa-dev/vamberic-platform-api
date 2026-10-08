import { parseProviderJson } from "./strict-json";
import { z } from "zod4";
import {
  submittedPagePolicy,
  publicPageUrl,
  type Json,
} from "@workspace/agent-runtime-protocol";
import {
  createWebsiteReader,
  requirePublicAddress,
  type WebsiteTransport,
} from "./page-reader";
import { publicPageHttp } from "./page-http";
import {
  WebsiteDraftDto,
  WEBSITE_DRAFT_INSTRUCTION,
  validateWebsiteDraft,
} from "./website-draft";
import {
  CompanyOutputDto,
  COMPANY_INSTRUCTION,
  validateCompanyDraft,
} from "./company";
import { structuredOutput } from "./structured-output";

export type PsuGenerationInput = {
  kind?: "company" | "product";
  websiteUrls: string[];
  workingLabel: string;
  orientation: string;
  context: Record<string, unknown>;
};
export type PsuGeneration = {
  draft?: ReturnType<typeof validateWebsiteDraft>;
  companyDraft?: ReturnType<typeof validateCompanyDraft>;
  offeringCount?: "single" | "multiple" | "uncertain";
  offeringCountReason?: string;
  productUnavailable?: boolean;
  competitorSuggestions?: string[];
  unavailable: string[];
  usage: {
    model: string;
    inputTokens?: number;
    outputTokens?: number;
    requestId?: string;
    status: "recorded" | "unknown";
  };
};
export type PsuGenerator = (
  input: PsuGenerationInput,
  signal: AbortSignal,
) => Promise<PsuGeneration>;
export function generationFailureCode(error: unknown) {
  if (error instanceof PsuGenerationFailure) return error.code;
  const message = error instanceof Error ? error.message : "";
  if (message === "sources_unavailable") return "sources_unavailable";
  if (["configuration_error", "AI request rejected"].includes(message))
    return "service_configuration";
  if (message === "AI service unavailable") return "service_unavailable";
  if (
    error instanceof Error &&
    ["TimeoutError", "AbortError"].includes(error.name)
  )
    return "timed_out";
  return "generation_failed";
}
export type GenerationValidationStage =
  | "envelope"
  | "json"
  | "provider_schema"
  | "company_validation"
  | "product_validation";
export class PsuGenerationFailure extends Error {
  constructor(
    readonly usage: PsuGeneration["usage"],
    readonly code:
      | "output_invalid"
      | "output_model_mismatch"
      | "output_format_invalid"
      | "output_evidence_invalid" = "output_invalid",
    readonly validationStage?: GenerationValidationStage,
  ) {
    super("AI output could not be validated");
  }
}
/** One app-owned AI request. No Agent registry, commercial policy, quota or worker. */
export function createPsuGenerator(
  config: { apiKey: string; project: string; model: string },
  send: typeof fetch = fetch,
  pageTransport: WebsiteTransport = publicPageHttp(),
): PsuGenerator {
  if (
    !config.apiKey ||
    config.apiKey.length > 1024 ||
    /\s/.test(config.apiKey) ||
    !/^proj_[A-Za-z0-9_-]+$/.test(config.project) ||
    !/^[a-zA-Z0-9._-]+$/.test(config.model)
  )
    throw new Error("Incomplete PSU AI configuration");
  return async (input, signal) => {
    const policy = submittedPagePolicy(input.websiteUrls);
    const urls = new Set(policy.urls);
    const read = createWebsiteReader(
      {
        requireInitialUrl(value) {
          const url = publicPageUrl(value);
          if (!urls.has(url)) throw new Error("Page not submitted");
          return url;
        },
        requireRedirectUrl: publicPageUrl,
        requireAddresses(addresses) {
          if (!addresses.length) throw new Error("DNS unavailable");
          return addresses.map(requirePublicAddress);
        },
      },
      pageTransport,
    );
    const pages: Awaited<ReturnType<typeof read>> = [],
      unavailable: string[] = [];
    for (const url of policy.urls) {
      try {
        pages.push(...(await read({ urls: [url] }, signal)));
      } catch {
        signal.throwIfAborted();
        unavailable.push(url);
      }
    }
    if (!pages.length) throw new Error("sources_unavailable");
    const output = structuredOutput(
      (input.kind === "company"
        ? CompanyOutputDto
        : WebsiteDraftDto) as z.ZodType<Json>,
    );
    const body = JSON.stringify({
      model: config.model,
      store: false,
      background: false,
      stream: false,
      service_tier: "default",
      reasoning: { effort: "medium" },
      max_output_tokens: 16000,
      tools: [],
      input: [
        {
          role: "developer",
          content:
            input.kind === "company"
              ? WEBSITE_DRAFT_INSTRUCTION + " " + COMPANY_INSTRUCTION
              : WEBSITE_DRAFT_INSTRUCTION,
        },
        {
          role: "user",
          content: JSON.stringify({
            pages,
            existingContext: input.context,
            workingLabel: input.workingLabel,
            orientation: input.orientation,
          }),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "product_service_output",
          strict: true,
          schema: output.schema,
        },
      },
    });
    if (Buffer.byteLength(body) > 131072)
      throw new Error("Source context too large");
    const response = await send("https://api.openai.com/v1/responses", {
      method: "POST",
      redirect: "error",
      credentials: "omit",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
        "OpenAI-Project": config.project,
      },
      body,
      signal: AbortSignal.any([signal, AbortSignal.timeout(120000)]),
    });
    if (!response.ok || !response.body) {
      // Do not retain provider bodies: they can echo source content or credentials.
      await response.body?.cancel();
      throw new Error(
        [400, 401, 403, 404, 422].includes(response.status)
          ? "AI request rejected"
          : "AI service unavailable",
      );
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.length;
        if (bytes > 262144) throw new Error("AI response too large");
        chunks.push(part.value);
      }
    } finally {
      await reader.cancel();
    }
    const parsed = z
      .object({
        model: z.string(),
        status: z.literal("completed"),
        usage: z.object({
          input_tokens: z.number().int().nonnegative(),
          output_tokens: z.number().int().nonnegative(),
        }),
        output: z
          .array(
            z.object({
              type: z.string(),
              role: z.string().optional(),
              status: z.string().optional(),
              content: z
                .array(
                  z.object({ type: z.string(), text: z.string().optional() }),
                )
                .optional(),
            }),
          )
          .max(30),
      })
      .parse(parseProviderJson(Buffer.concat(chunks).toString("utf8")));
    let failureCode: PsuGenerationFailure["code"] = "output_format_invalid";
    let validationStage: GenerationValidationStage = "envelope";
    try {
      if (parsed.model !== config.model) {
        failureCode = "output_model_mismatch";
        throw new Error("Unexpected response model");
      }
      const messages = parsed.output.filter((p) => p.type === "message");
      if (
        parsed.output.some((p) => !["message", "reasoning"].includes(p.type)) ||
        messages.length !== 1 ||
        messages[0]!.role !== "assistant" ||
        messages[0]!.status !== "completed" ||
        messages[0]!.content?.length !== 1 ||
        messages[0]!.content[0]!.type !== "output_text"
      )
        throw new Error("Invalid AI output");
      validationStage = "json";
      const raw = parseProviderJson(messages[0]!.content![0]!.text!);
      let generated: Omit<PsuGeneration, "unavailable" | "usage">;
      if (input.kind === "company") {
        // Validate company independently: a malformed product must not discard it.
        validationStage = "company_validation";
        const company = CompanyOutputDto.extend({ product: z.unknown() }).parse(
          raw,
        );
        generated = {
          companyDraft: validateCompanyDraft(company.company, pages),
          competitorSuggestions: [
            ...new Set(company.competitorSuggestions ?? []),
          ],
          offeringCount: company.offeringCount,
          offeringCountReason: company.offeringCountReason,
        };
        if (company.offeringCount === "single") {
          try {
            generated.draft = validateWebsiteDraft(company.product, pages);
          } catch {
            generated.productUnavailable = true;
          }
        }
      } else {
        validationStage = "provider_schema";
        const product = output.parse(raw);
        validationStage = "product_validation";
        generated = { draft: validateWebsiteDraft(product, pages) };
      }
      return {
        ...generated,
        unavailable,
        usage: {
          model: parsed.model,
          inputTokens: parsed.usage.input_tokens,
          outputTokens: parsed.usage.output_tokens,
          status: "recorded",
          ...(response.headers.get("x-request-id")
            ? { requestId: response.headers.get("x-request-id")! }
            : {}),
        },
      };
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "Unsupported source quotation"
      )
        failureCode = "output_evidence_invalid";
      throw new PsuGenerationFailure(
        {
          model: parsed.model,
          inputTokens: parsed.usage.input_tokens,
          outputTokens: parsed.usage.output_tokens,
          status: "recorded",
        },
        failureCode,
        validationStage,
      );
    }
  };
}
/** ECS injects the existing provider key. No discovery or secret reads in application code. */
export function psuGeneratorFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): PsuGenerator | undefined {
  const values = [
    env.HVM_PSU_API_KEY,
    env.HVM_PSU_OPENAI_PROJECT,
    env.HVM_PSU_MODEL,
  ];
  if (values.every((v) => !v)) return undefined;
  if (values.some((v) => !v))
    throw new Error("Incomplete HVM PSU configuration");
  return createPsuGenerator({
    apiKey: values[0]!,
    project: values[1]!,
    model: values[2]!,
  });
}
