import { publicPageUrl } from "@workspace/agent-runtime-protocol";

/** One same-origin discovery hop, ranked by information needed for profiles.
 * No recursive crawling, third-party links, credentials, queries or fragments.
 */
export function supportingPages(
  seeds: { url: string; links: string[] }[],
  submitted: string[],
  limit: number,
  extensive = false,
) {
  const candidates = new Map<string, number>();
  const categories = [
    /\/(?:ai[-/]?(?:information|info)|llms(?:-full)?\.txt)(?:[/.]|$)/i,
    /(?:pricing|plans|packages)/i,
    /(?:compar|competitor|alternative)/i,
    /(?:about|company)/i,
    /(?:how-it-works|product|service|platform|faq)/i,
  ];
  for (const seed of seeds)
    for (const href of seed.links) {
      try {
        const resolved = new URL(href, seed.url);
        if (resolved.origin !== new URL(seed.url).origin || resolved.search)
          continue;
        resolved.hash = "";
        const url = publicPageUrl(resolved.href);
        if (submitted.includes(url) || seeds.some((s) => s.url === url))
          continue;
        const rank = categories.findIndex((re) => re.test(resolved.pathname));
        if (
          /\.(?:png|jpe?g|gif|svg|webp|mp4|zip|pdf|css|js|xml)$/i.test(
            resolved.pathname,
          ) ||
          /\/(?:login|logout|sign-in|cart|checkout|admin)(?:\/|$)/i.test(
            resolved.pathname,
          )
        )
          continue;
        if (rank >= 0 || extensive) candidates.set(url, rank >= 0 ? rank : 5);
      } catch {
        /* Invalid/unsafe links are not retrieval instructions. */
      }
    }
  // Cover different information categories before taking a second page of one kind.
  const ranked = [...candidates].sort(
    (a, b) => a[1] - b[1] || a[0].localeCompare(b[0]),
  );
  const chosen: string[] = [],
    categoriesSeen = new Set<number>();
  for (const [url, rank] of ranked)
    if (!categoriesSeen.has(rank)) {
      chosen.push(url);
      categoriesSeen.add(rank);
    }
  return [
    ...chosen,
    ...ranked.map(([url]) => url).filter((url) => !chosen.includes(url)),
  ].slice(0, Math.max(0, limit));
}
