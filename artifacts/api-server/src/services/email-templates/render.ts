import { campaignTrackedUrl } from "../campaigns/tracking";
import { z } from "zod";
import type { EmailRecord } from "../email-content/model";
import type { BrandKit } from "../../domain/brands";
export const templateSettings = z
  .object({
    name: z.string().trim().min(1).max(100),
    layout: z.enum(["personal", "branded"]),
    accentRole: z.enum(["primary", "secondary", "accent"]).default("primary"),
    includeLogo: z.boolean().default(false),
    logoAlignment: z.enum(["left", "centre", "right"]).default("left"),
    logoWidth: z.number().int().min(48).max(320).default(160),
    logoSpacing: z.number().int().min(8).max(64).default(24),
    includeSignature: z.boolean().default(true),
    includeFooter: z.boolean().default(true),
  })
  .strict();
export type TemplateSettings = z.infer<typeof templateSettings>;
export const personal = templateSettings.parse({
  name: "Personal email",
  layout: "personal",
});
export const branded = templateSettings.parse({
  name: "Branded email",
  layout: "branded",
});
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function renderTemplate(
  draft: EmailRecord,
  settings: TemplateSettings = personal,
  kit: BrandKit | null = null,
  testOnly = false,
  deliveryUrl?: string,
) {
  const body = draft.content.body;
  const cta = draft.content.ctaText.trim();
  const url =
    deliveryUrl ||
    campaignTrackedUrl(draft.ctaUrl, draft.campaignId, draft.id, testOnly);
  if (url) {
    const parsed = new URL(url);
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password
    )
      throw new Error("Unsafe CTA");
  }
  const signature = settings.includeSignature
    ? kit?.emailDefaults?.signature?.trim() || ""
    : "";
  const footer = settings.includeFooter
    ? [
        kit?.emailDefaults?.footer || kit?.descriptions?.footer,
        kit?.emailDefaults?.legalFooter,
      ]
        .filter(Boolean)
        .join("\n")
    : "";
  const extras = [signature, footer].filter(
    (s, i, a): s is string => !!s && !body.includes(s) && a.indexOf(s) === i,
  );
  const ctaInBody = !!cta && body.includes(cta);
  const urlInBody = !!draft.ctaUrl && body.includes(draft.ctaUrl);
  let bodyHtml = escape(body);
  if (url && urlInBody)
    bodyHtml = bodyHtml
      .split(escape(draft.ctaUrl))
      .join(`<a href="${escape(url)}">${escape(draft.ctaUrl)}</a>`);
  else if (url && ctaInBody)
    bodyHtml = bodyHtml.replace(
      escape(cta),
      `<a href="${escape(url)}">${escape(cta)}</a>`,
    );
  const colour = kit?.colours.find((c) => c.role === settings.accentRole)?.hex;
  const accent = colour && /^#[0-9a-f]{6}$/i.test(colour) ? colour : "#333333";
  const family =
    kit?.typography.find((t) => t.role === "body")?.family ||
    kit?.typography.find((t) => t.role === "primary")?.family;
  const font =
    family && /^[a-zA-Z0-9 -]{1,100}$/.test(family)
      ? `'${family}',Arial,Helvetica,sans-serif`
      : "Arial,Helvetica,sans-serif";
  const appendCta = !ctaInBody && !urlInBody;
  const link = url
    ? `<a style="color:#222222;text-decoration:underline" href="${escape(url)}">${escape(cta || "Read more")}</a>`
    : escape(cta);
  const content = `<div style="white-space:pre-wrap;overflow-wrap:anywhere">${bodyHtml}</div>${appendCta && (url || cta) ? `<p>${link}</p>` : ""}${extras.map((s) => `<p style="white-space:pre-wrap">${escape(s)}</p>`).join("")}`;
  return {
    subject: (testOnly ? "[HVM TEST] " : "") + draft.content.subject,
    text: [
      url && draft.ctaUrl ? body.split(draft.ctaUrl).join(url) : body,
      appendCta ? cta : "",
      url && !urlInBody ? url : "",
      ...extras,
    ]
      .filter(Boolean)
      .join("\n\n"),
    html: `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#ffffff;color:#222222;font-family:${escape(font)};font-size:16px;line-height:1.6"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="padding:24px"><div style="max-width:600px;margin:auto;${settings.layout === "branded" ? `border-top:4px solid ${accent};padding-top:24px;` : ""}">${content}</div></td></tr></table></body></html>`,
    notice: kit
      ? "Uses the approved Brand Kit. Email-safe font fallbacks are included."
      : "No approved Brand Kit: neutral styling is used.",
  };
}
