import { isIP } from "node:net";
import { z } from "zod";
import { SubmitPublicEnquiryBody } from "@workspace/api-zod";

export function websiteDomain(value: string): string {
  const url = new URL(value.includes("://") ? value : `https://${value}`);
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    isIP(host) ||
    host.length > 253 ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/.test(
      host,
    )
  )
    throw new Error("Invalid website");
  return host;
}

// Queries/fragments can contain tokens or personal data. Attribution has its
// own bounded fields; persist only origin and path for page/referrer context.
export function safePage(value: string): string {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("Invalid page");
  return url.origin + url.pathname;
}

export const PublicEnquirySchema = z
  .preprocess((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        typeof item === "string" ? item.trim() : item,
      ]),
    );
  }, SubmitPublicEnquiryBody.strict())
  .superRefine((value, ctx) => {
    for (const field of ["website", "landingPage", "referrer"] as const) {
      if (!value[field]) continue;
      try {
        if (field === "website") websiteDomain(value[field]);
        else safePage(value[field]);
      } catch {
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: "Invalid website or HTTP(S) URL",
        });
      }
    }
    if (
      JSON.stringify({
        text: value.marketingConsentText,
        version: value.marketingConsentVersion,
      }).length > 1700
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["marketingConsentText"],
        message: "Encoded consent evidence is too long",
      });
    }
    if (
      value.marketingOptIn === true &&
      (!value.marketingConsentText || !value.marketingConsentVersion)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["marketingOptIn"],
        message: "Consent text and version are required for opt-in",
      });
    }
  });
export type PublicEnquiry = z.infer<typeof PublicEnquirySchema>;
