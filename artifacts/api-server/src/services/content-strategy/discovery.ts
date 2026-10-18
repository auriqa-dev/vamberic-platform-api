import { publicPageUrl } from "@workspace/agent-runtime-protocol";
import { parse, serialize, type DefaultTreeAdapterMap } from "parse5";
import { publicPageHttp, extractPublicPage } from "../psu/page-http";
import {
  requirePublicAddress,
  type WebsiteTransport,
} from "../psu/page-reader";
import { createHash } from "node:crypto";
// Uses the existing pinned-IP, TLS-checked, byte/time-bounded transport.
export const rawTransport = () =>
  publicPageHttp(
    undefined,
    (text, type) => {
      if (
        text &&
        ![
          "text/html",
          "text/plain",
          "application/xml",
          "text/xml",
          "application/xhtml+xml",
        ].includes(type)
      )
        throw new Error("Unsupported website content type");
      return { text, title: "" };
    },
    true,
  );
export async function readRaw(
  url: string,
  transport: WebsiteTransport = rawTransport(),
  permit: (url: string) => boolean = () => true,
  parentSignal?: AbortSignal,
) {
  const signal = AbortSignal.any([AbortSignal.timeout(15000), ...(parentSignal ? [parentSignal] : [])]);
  let current = publicPageUrl(url);
  for (let i = 0; i < 3; i++) {
    if (!permit(current))
      throw new Error("Website path is not permitted by its crawl policy.");
    const u = new URL(current),
      addresses = await transport.resolve(u.hostname, signal);
    if (!addresses.length) throw new Error("Website DNS unavailable");
    addresses.forEach(requirePublicAddress);
    const r = await transport.read({
      url: current,
      address: addresses[0]!,
      servername: u.hostname,
      signal,
      maximumDecodedBytes: 8388608,
      timeoutMs: 10000,
    });
    if (r.access !== "allowed") throw new Error("Website access unavailable");
    if (r.redirect) {
      current = publicPageUrl(new URL(r.redirect, current).href);
      continue;
    }
    return { url: current, text: r.text };
  }
  throw new Error("Too many redirects");
}
function crawlPattern(pattern: string, path: string) {
  const match = pattern.endsWith("$") ? pattern.slice(0, -1) : pattern + "*";
  let p = 0,
    s = 0,
    star = -1,
    retry = 0;
  while (s < path.length) {
    if (p < match.length && match[p] === path[s]) {
      p++;
      s++;
    } else if (match[p] === "*") {
      star = p++;
      retry = s;
    } else if (star >= 0) {
      p = star + 1;
      s = ++retry;
    } else return false;
  }
  while (match[p] === "*") p++;
  return p === match.length;
}
export function robotsAllowed(text: string, path: string) {
  if (text.length > 128000)
    throw new Error("Crawl policy too large to interpret safely");
  let hasDirective = false;
  const groups: {
    agents: string[];
    rules: { allow: boolean; path: string }[];
  }[] = [];
  let group = {
    agents: [] as string[],
    rules: [] as { allow: boolean; path: string }[],
  };
  for (const line of text.split(/\r?\n/)) {
    const [raw, ...rest] = line.split("#")[0]!.split(":");
    const key = raw?.trim().toLowerCase(),
      value = rest.join(":").trim();
    if (key === "user-agent") {
      if (hasDirective) {
        hasDirective = false;
        groups.push(group);
        group = { agents: [], rules: [] };
      }
      group.agents.push(value.toLowerCase());
    } else if (
      group.agents.length &&
      (key === "allow" || key === "disallow") &&
      value
    ) {
      hasDirective = true;
      group.rules.push({ allow: key === "allow", path: value });
    } else if (key === "disallow" || key === "allow") hasDirective = true;
  }
  groups.push(group);
  const specific = groups.filter((g) =>
    g.agents.some((a) => a !== "*" && "hvm-psu/1.0".startsWith(a)),
  );
  const rules = (
    specific.length ? specific : groups.filter((g) => g.agents.includes("*"))
  ).flatMap((g) => g.rules);
  const matched = rules
    .filter((r) => crawlPattern(r.path, path))
    .sort(
      (a, b) =>
        b.path.length - a.path.length || Number(b.allow) - Number(a.allow),
    );
  return matched[0]?.allow ?? true;
}
export function pageMetadata(html: string, url: string) {
  const doc = parse(html);
  const links: string[] = [],
    headings: string[] = [];
  let canonical = url,
    description = "";
  function nodeText(n: DefaultTreeAdapterMap["node"]): string {
    return "value" in n
      ? n.value
      : "childNodes" in n
        ? n.childNodes.map(nodeText).join(" ")
        : "";
  }
  function walk(n: DefaultTreeAdapterMap["node"]) {
    if ("tagName" in n) {
      const attrs = Object.fromEntries(n.attrs.map((a) => [a.name, a.value]));
      if (n.tagName === "a" && attrs.href) {
        try {
          const href = publicPageUrl(new URL(attrs.href, url).href);
          if (new URL(href).origin === new URL(url).origin) links.push(href);
        } catch {
          /* Unsafe links omitted. */
        }
      }
      if (n.tagName === "link" && attrs.rel === "canonical" && attrs.href) {
        try {
          const c = publicPageUrl(new URL(attrs.href, url).href);
          if (new URL(c).origin === new URL(url).origin) canonical = c;
        } catch {
          /* Invalid canonical ignored. */
        }
      }
      if (n.tagName === "meta" && attrs.name === "description")
        description = (attrs.content ?? "").slice(0, 2000);
      if (/^h[1-6]$/.test(n.tagName))
        headings.push(nodeText(n).trim().slice(0, 300));
    }
    if ("childNodes" in n) n.childNodes.forEach(walk);
  }
  walk(doc);
  function clean(n: DefaultTreeAdapterMap["node"]) {
    if ("childNodes" in n) {
      n.childNodes = n.childNodes.filter(
        (c) =>
          !(
            "tagName" in c &&
            (c.tagName === "header" ||
              c.attrs.some(
                (a) =>
                  ["id", "class"].includes(a.name) &&
                  /(cookie|consent)[-_ ]?(banner|notice|popup|dialog)/i.test(
                    a.value,
                  ),
              ))
          ),
      );
      n.childNodes.forEach(clean);
    }
  }
  clean(doc);
  const main = extractPublicPage(serialize(doc), "text/html");
  return {
    url,
    canonical,
    title: main.title,
    description,
    headings: headings.slice(0, 40),
    links: [...new Set(links)].slice(0, 100),
    text: main.text,
    fingerprint: createHash("sha256").update(main.text).digest("hex"),
    checkedAt: new Date().toISOString(),
  };
}
export async function discoverWebsite(raw: string, mode: "discover" | "read") {
  const url = publicPageUrl(raw),
    u = new URL(url),
    robots = await readRaw(
      u.origin + "/robots.txt",
      undefined,
      (next) => new URL(next).origin === u.origin,
    );
  if (
    new URL(robots.url).origin !== u.origin ||
    !robotsAllowed(robots.text, u.pathname + u.search)
  )
    throw new Error("This website does not permit this page to be read.");
  const permit = (next: string) =>
    new URL(next).origin === u.origin &&
    robotsAllowed(robots.text, new URL(next).pathname + new URL(next).search);
  const page = await readRaw(url, undefined, permit);
  if (new URL(page.url).origin !== u.origin)
    throw new Error(
      "Use the destination website address to review its crawl policy.",
    );
  const metadata = pageMetadata(page.text, page.url);
  if (!metadata.text.trim())
    throw new Error("This page has no readable public content.");
  if (mode === "read") return metadata;
  const urls = new Set([metadata.canonical, ...metadata.links]);
  // Sitemap discovery is best-effort; a blocked or unsupported sitemap is never a fabricated result.
  let sitemapNote = "Website links discovered.";
  try {
    const sitemapUrl = u.origin + "/sitemap.xml";
    if (robotsAllowed(robots.text, "/sitemap.xml")) {
      const map = await readRaw(sitemapUrl, undefined, permit);
      if (new URL(map.url).origin === u.origin)
        for (const m of map.text.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/g)) {
          try {
            const link = publicPageUrl(m[1]!.replaceAll("&amp;", "&"));
            if (new URL(link).origin === u.origin && !link.endsWith(".xml"))
              urls.add(link);
          } catch {
            /* Unsafe sitemap URLs omitted. */
          }
        }
      sitemapNote = "Website links and available sitemap entries discovered.";
    }
  } catch {
    sitemapNote = "Sitemap unavailable; website links discovered.";
  }
  return {
    pages: [...urls]
      .filter((link) =>
        robotsAllowed(
          robots.text,
          new URL(link).pathname + new URL(link).search,
        ),
      )
      .slice(0, 100)
      .map((link) => ({
        url: link,
        title:
          link === metadata.canonical ? metadata.title : new URL(link).pathname,
      })),
    note:
      sitemapNote +
      " Review and import selected pages. Linked pages have not yet been analysed.",
    more: urls.size > 100,
  };
}
