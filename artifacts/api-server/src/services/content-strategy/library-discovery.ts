import { publicPageUrl } from "@workspace/agent-runtime-protocol";
import { pageMetadata, readRaw, robotsAllowed } from "./discovery";
import type { WebsiteTransport } from "../psu/page-reader";

export interface IndexedPage {
  url: string;
  canonical: string;
  title: string;
  description: string;
  language: string;
  region: string;
  alternates: { language: string; url: string }[];
  source: string;
  modifiedAt: string;
  discoveredAt: string;
  status: "discovered" | "inspected" | "unavailable";
  ingestion: "not_imported" | "imported" | "failed";
  assetId?: string;
  fingerprint?: string;
  error?: string;
}
export interface DiscoveryState {
  origin: string;
  root: string;
  brandId: string;
  pages: IndexedPage[];
  pending: { url: string; kind: "sitemap" | "page" }[];
  visited: string[];
  status: "running" | "complete" | "paused";
  warnings: string[];
  startedAt: string;
  updatedAt: string;
  smallSiteThreshold: number;
}
export const MAX_INDEX_PAGES = 5000;
export function eligibleUrl(raw: string, origin: string): string | undefined {
  try {
    const u = new URL(publicPageUrl(raw));
    if (
      u.origin !== origin ||
      /\.(?:jpg|jpeg|png|gif|svg|webp|ico|css|js|zip|woff2?|mp4|mp3|pdf)$/i.test(
        u.pathname,
      )
    )
      return;
    if (
      /(?:^|\/)(?:wp-admin|wp-json|login|logout|cart|checkout|search)(?:\/|$)/i.test(
        u.pathname,
      )
    )
      return;
    u.hash = "";
    for (const key of [...u.searchParams.keys()])
      if (/^(utm_|fbclid|gclid)/i.test(key)) u.searchParams.delete(key);
    if (u.searchParams.size) return; // faceted/search calendars are not crawl targets
    return u.href;
  } catch {
    return;
  }
}
export function localeFromUrl(url: string) {
  const part = new URL(url).pathname.split("/")[1] ?? "";
  const match = /^(en|de|fr|es|it|pt|nl|ja|zh|ko|ar)(?:[-_]([a-z]{2}))?$/i.exec(
    part,
  );
  return {
    language: match?.[1]?.toLowerCase() ?? "",
    region: match?.[2]?.toUpperCase() ?? "",
  };
}
export function pageLocale(html: string, url: string) {
  const locale = localeFromUrl(url);
  const lang = /<html\b[^>]*\blang\s*=\s*["']([^"']+)["']/i.exec(html)?.[1];
  if (lang) {
    locale.language = lang.split(/[-_]/)[0]!.toLowerCase();
    locale.region = lang.split(/[-_]/)[1]?.toUpperCase() ?? locale.region;
  }
  const alternates: IndexedPage["alternates"] = [];
  for (const tag of html.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = Object.fromEntries(
      [...tag[0].matchAll(/([\w-]+)\s*=\s*["']([^"']*)["']/g)].map((m) => [
        m[1]!.toLowerCase(),
        m[2]!,
      ]),
    );
    if (
      attrs.rel?.toLowerCase() !== "alternate" ||
      !attrs.hreflang ||
      !attrs.href
    )
      continue;
    try {
      alternates.push({
        language: attrs.hreflang.slice(0, 40),
        url: publicPageUrl(new URL(attrs.href, url).href),
      });
    } catch {
      /* unsafe alternate omitted */
    }
  }
  return { ...locale, alternates: alternates.slice(0, 40) };
}
const xmlText = (s: string) =>
  s
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .trim();
export function sitemapEntries(xml: string) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error("Unsupported sitemap entities");
  const index = /<sitemapindex\b/i.test(xml);
  return [
    ...xml.matchAll(
      index
        ? /<sitemap\b[^>]*>([\s\S]*?)<\/sitemap>/gi
        : /<url\b[^>]*>([\s\S]*?)<\/url>/gi,
    ),
  ]
    .slice(0, MAX_INDEX_PAGES + 1)
    .flatMap((m) => {
      const url = /<loc\b[^>]*>([\s\S]*?)<\/loc>/i.exec(m[1]!)?.[1];
      if (!url) return [];
      return [
        {
          url: xmlText(url),
          modifiedAt: xmlText(
            /<lastmod\b[^>]*>([^<]*)<\/lastmod>/i.exec(m[1]!)?.[1] ?? "",
          ).slice(0, 100),
          kind: index ? ("sitemap" as const) : ("page" as const),
        },
      ];
    });
}
export function startDiscovery(
  raw: string,
  brandId: string,
  smallSiteThreshold = 200,
  mode: "website" | "page" = "website",
): DiscoveryState {
  const root = publicPageUrl(raw),
    origin = new URL(root).origin,
    now = new Date().toISOString();
  return {
    origin,
    root,
    brandId,
    pages:
      mode === "page"
        ? [
            {
              url: root,
              canonical: root,
              title: new URL(root).pathname,
              description: "",
              ...localeFromUrl(root),
              alternates: [],
              source: "User-selected URL",
              modifiedAt: "",
              discoveredAt: now,
              status: "discovered",
              ingestion: "not_imported",
            },
          ]
        : [],
    pending:
      mode === "page"
        ? []
        : [
            { url: root, kind: "page" },
            { url: origin + "/sitemap.xml", kind: "sitemap" },
          ],
    visited: [],
    status: mode === "page" ? "complete" : "running",
    warnings: [],
    startedAt: now,
    updatedAt: now,
    smallSiteThreshold,
  };
}
/** One bounded checkpoint. Sitemap URLs are metadata, never automatic ingestion. */
export async function discoveryStep(
  previous: DiscoveryState,
  transport?: WebsiteTransport,
): Promise<DiscoveryState> {
  const state = structuredClone(previous);
  if (state.status === "complete") return state;
  const robots = await readRaw(
    state.origin + "/robots.txt",
    transport,
    (u) => new URL(u).origin === state.origin,
  );
  const permit = (u: string) =>
    new URL(u).origin === state.origin &&
    robotsAllowed(robots.text, new URL(u).pathname + new URL(u).search);
  for (const m of robots.text.matchAll(/^sitemap:\s*(\S+)/gim)) {
    try {
      const url = publicPageUrl(m[1]!);
      if (
        permit(url) &&
        !state.visited.includes(url) &&
        !state.pending.some((p) => p.url === url)
      )
        state.pending.push({ url, kind: "sitemap" });
    } catch {
      /* unsafe sitemap omitted */
    }
  }
  let estimatedBytes = Buffer.byteLength(JSON.stringify(state));
  const add = (raw: string, source: string, modifiedAt = "") => {
    const url = eligibleUrl(raw, state.origin);
    if (!url || !permit(url) || state.pages.some((p) => p.url === url)) return;
    if (state.pages.length >= MAX_INDEX_PAGES) {
      state.status = "paused";
      return;
    }
    const page: IndexedPage = {
      url,
      canonical: url,
      title: new URL(url).pathname.slice(0, 200),
      description: "",
      ...localeFromUrl(url),
      alternates: [],
      source,
      modifiedAt,
      discoveredAt: state.startedAt,
      status: "discovered",
      ingestion: "not_imported",
    };
    const bytes = Buffer.byteLength(JSON.stringify(page));
    if (estimatedBytes + bytes > 6000000) {
      if (
        !state.warnings.includes(
          "Discovery reached its storage bound. The saved index is partial; narrow the website scope to continue.",
        )
      )
        state.warnings.push(
          "Discovery reached its storage bound. The saved index is partial; narrow the website scope to continue.",
        );
      state.status = "paused";
      return;
    }
    estimatedBytes += bytes;
    state.pages.push(page);
  };
  // One network resource per checkpoint keeps gateway requests bounded and resumable.
  const next = state.pending.shift();
  if (next && !state.visited.includes(next.url)) {
    state.visited.push(next.url);
    try {
      const response = await readRaw(next.url, transport, permit);
      if (next.kind === "sitemap") {
        for (const entry of sitemapEntries(response.text)) {
          if (entry.kind === "page") add(entry.url, next.url, entry.modifiedAt);
          else if (
            eligibleUrl(entry.url, state.origin) &&
            permit(entry.url) &&
            !state.visited.includes(entry.url) &&
            !state.pending.some((p) => p.url === entry.url) &&
            state.pending.length < 500
          )
            state.pending.push({ url: entry.url, kind: "sitemap" });
        }
      } else {
        const meta = pageMetadata(response.text, response.url);
        add(response.url, next.url);
        const page = state.pages.find((p) => p.url === response.url);
        if (page)
          Object.assign(page, {
            canonical: meta.canonical,
            title: meta.title.slice(0, 200),
            description: meta.description.slice(0, 500),
            ...pageLocale(response.text, response.url),
            status: "inspected",
          });
        for (const link of meta.links) add(link, next.url);
        // Small navigation fallback; never read thousands of sitemap pages just to index them.
        if (state.visited.filter((u) => !u.endsWith(".xml")).length < 5)
          for (const link of meta.links.slice(0, 4)) {
            const url = eligibleUrl(link, state.origin);
            if (
              url &&
              !state.visited.includes(url) &&
              !state.pending.some((p) => p.url === url)
            )
              state.pending.push({ url, kind: "page" });
          }
      }
    } catch {
      state.warnings.push(
        `Could not inspect ${next.url}. Existing Library content is unchanged.`,
      );
    }
  }
  if (state.status !== "paused")
    state.status = state.pending.length ? "running" : "complete";
  if (
    state.pages.length >= MAX_INDEX_PAGES ||
    Buffer.byteLength(JSON.stringify(state)) > 7000000
  ) {
    state.status = "paused";
    state.warnings.push(
      "Discovery reached its safety bound. This is a partial index; narrow the website scope before further discovery.",
    );
  }
  state.warnings = [...new Set(state.warnings)].slice(-30);
  state.updatedAt = new Date().toISOString();
  return state;
}
export function ingestionRecommendation(state: DiscoveryState) {
  const languages = [
    ...new Set(state.pages.map((p) => p.language).filter(Boolean)),
  ];
  const comprehensive =
    state.status === "complete" &&
    state.pages.length <= state.smallSiteThreshold &&
    languages.length <= 2;
  return {
    mode: comprehensive ? "comprehensive" : "selective",
    eligiblePages: state.pages.length,
    partial: state.status !== "complete",
    languages,
    reason: comprehensive
      ? "Small discovered site. Review language, region and page selection before importing."
      : "Large, multilingual or incomplete index. Select content relevant to the managed offers; other pages remain in discovery.",
    volumeNote:
      "Page sizes are unknown until retrieved. Imports process one bounded page at a time; oversized or unsupported content is reported separately.",
  };
}
