import { publicPageUrl } from "@workspace/agent-runtime-protocol";
import {
  createWebsiteReader,
  requirePublicAddress,
  WEBSITE_LIMITS,
  type WebsiteTransport,
} from "./page-reader";
import { supportingPages } from "./page-discovery";
import {
  readRaw,
  rawTransport,
  robotsAllowed,
} from "../content-strategy/discovery";

export type ResearchProgress = {
  phase: "reading" | "drafting" | "searching" | "refining";
  pagesRead: number;
  pagesAttempted: number;
  maximumPages: number;
};
export type ResearchPage = Awaited<
  ReturnType<ReturnType<typeof createWebsiteReader>>
>[number];
/** App-owned public research, with the same DNS/TLS/redirect fencing as PSU.
 * Limits bound network work/memory, not a customer's AI allowance. */
export async function crawlProfile(
  submitted: string[],
  signal: AbortSignal,
  transport: WebsiteTransport,
  callbacks: {
    progress?: (p: ResearchProgress) => Promise<void>;
    early?: (pages: ResearchPage[]) => Promise<void>;
  } = {},
  metadataTransport: WebsiteTransport = rawTransport(),
) {
  const pages: ResearchPage[] = [],
    unavailable: string[] = [];
  const attempted = new Set<string>(),
    discovered: { url: string; links: string[] }[] = [];
  const rules = new Map<string, string | null>();
  const allowed = new Set(submitted.map(publicPageUrl));
  const started = Date.now();
  const maximumPages = 100;
  async function policy(origin: string) {
    if (rules.has(origin)) return;
    rules.set(origin, null);
    try {
      const robots = await readRaw(
        origin + "/robots.txt",
        metadataTransport,
        (next) =>
          new URL(next).hostname.replace(/^www\./, "") ===
          new URL(origin).hostname.replace(/^www\./, ""),
        signal,
      );
      robotsAllowed(robots.text, "/");
      rules.set(origin, robots.text);
      rules.set(new URL(robots.url).origin, robots.text);
      const maps = [
        origin + "/sitemap.xml",
        ...[...robots.text.matchAll(/^sitemap:\s*(\S+)/gim)].map((m) => m[1]!),
      ];
      const seenMaps = new Set<string>();
      // Handle small sitemap indexes without letting them become another crawl.
      while (maps.length && seenMaps.size < 4) {
        const url = publicPageUrl(maps.shift()!);
        if (
          seenMaps.has(url) ||
          new URL(url).origin !== origin ||
          !permitted(url)
        )
          continue;
        seenMaps.add(url);
        try {
          const map = await readRaw(url, metadataTransport, permitted, signal);
          const links: string[] = [];
          for (const match of map.text.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/g)) {
            if (links.length >= 1000) break;
            try {
              const link = publicPageUrl(match[1]!.replaceAll("&amp;", "&"));
              if (new URL(link).origin !== origin) continue;
              if (link.endsWith(".xml")) maps.push(link);
              else links.push(link);
            } catch {
              /* Untrusted sitemap entries are never authority. */
            }
          }
          discovered.push({ url: origin + "/", links });
        } catch {
          signal.throwIfAborted();
        }
      }
    } catch {
      signal.throwIfAborted(); /* Unknown robots policy: do not crawl this origin. */
    }
  }
  function permitted(value: string) {
    const u = new URL(publicPageUrl(value)),
      text = rules.get(u.origin);
    return (
      typeof text === "string" && robotsAllowed(text, u.pathname + u.search)
    );
  }
  const read = createWebsiteReader(
    {
      requireInitialUrl(value) {
        const url = publicPageUrl(value);
        if (!allowed.has(url) || !permitted(url))
          throw new Error("Page outside crawl policy");
        return url;
      },
      requireRedirectUrl(value) {
        const url = publicPageUrl(value);
        if (!permitted(url)) throw new Error("Redirect outside crawl policy");
        return url;
      },
      requireAddresses(addresses) {
        if (!addresses.length) throw new Error("DNS unavailable");
        return addresses.map(requirePublicAddress);
      },
    },
    {
      resolve: (host, s) => transport.resolve(host, s),
      async read(request) {
        const response = await transport.read(request);
        if (response.redirect) {
          const next = publicPageUrl(
            new URL(response.redirect, request.url).href,
          );
          // Check destination robots before following a canonical-domain redirect.
          await policy(new URL(next).origin);
        } else if (response.access === "allowed" && response.links) {
          discovered.push({ url: request.url, links: response.links });
        }
        return response;
      },
    },
    Date.now,
    {
      ...WEBSITE_LIMITS,
      pages: maximumPages,
      totalMs: 240000,
      totalTextBytes: 8_388_608,
    },
  );
  const progress = () =>
    callbacks.progress?.({
      phase: "reading",
      pagesRead: pages.length,
      pagesAttempted: attempted.size,
      maximumPages,
    }) ?? Promise.resolve();
  async function batch(urls: string[]) {
    for (const url of urls) {
      allowed.add(url);
      attempted.add(url);
    }
    const results = await Promise.allSettled(
      urls.map((url) => read({ urls: [url] }, signal)),
    );
    signal.throwIfAborted();
    results.forEach((result, i) => {
      if (result.status === "fulfilled") {
        for (const page of result.value) {
          if (
            !pages.some((p) => p.url === page.url || p.digest === page.digest)
          )
            pages.push(page);
          attempted.add(page.url);
        }
      } else unavailable.push(urls[i]!);
    });
    await progress();
  }
  await progress();
  for (const url of submitted) await policy(new URL(url).origin);
  for (let i = 0; i < submitted.length; i += 2)
    await batch(submitted.slice(i, i + 2));
  let early = false;
  while (attempted.size < maximumPages && Date.now() - started < 210000) {
    const candidates = supportingPages(
      discovered,
      [...attempted],
      maximumPages - attempted.size,
      true,
    ).filter(permitted);
    if (!candidates.length) break;
    if (!early && pages.length >= 6 && callbacks.early) {
      early = true;
      await callbacks.early([...pages]);
    }
    await batch(candidates.slice(0, 2));
  }
  return {
    pages,
    unavailable,
    pagesAttempted: attempted.size,
    limited: attempted.size >= maximumPages || Date.now() - started >= 210000,
  };
}
