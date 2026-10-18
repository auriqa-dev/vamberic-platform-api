import type { z } from "zod4";
import type { WebsitePageSchema } from "./page-reader";
/** Spread a bounded exact-excerpt budget across each page rather than taking
 * only its introduction. Exact slices retain verifiable source attribution. */
export function sourceExcerpts(
  pages: z.infer<typeof WebsitePageSchema>[],
  total: number,
) {
  // Large sites should not dilute core facts with dozens of equally weighted articles.
  const weights = pages.map((page) => {
    if (pages.length <= 6) return 1;
    const path = new URL(page.url).pathname;
    if (
      path === "/" ||
      /^\/(?:pricing|plans|packages|about|company|how-it-works|ai-information|llms\.txt|compare-to-other-tools)\/?$/i.test(
        path,
      )
    )
      return 8;
    if (/\/(?:product|service|platform|compar|alternative)/i.test(path))
      return 3;
    return 1;
  });
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  return pages
    .flatMap((page, index) => {
      const budget = Math.floor((total * weights[index]!) / weightTotal);
      const length = Math.min(page.text.length, budget);
      const count = Math.ceil(length / 600);
      return Array.from({ length: count }, (_, i) => {
        const size = Math.min(600, length - i * 600);
        const start =
          page.text.length <= budget
            ? i * 600
            : Math.floor(
                (i * (page.text.length - 600)) / Math.max(1, count - 1),
              );
        return {
          pageDigest: page.digest,
          quote: page.text.slice(start, start + size),
        };
      });
    })
    .map((source, id) => ({ ...source, id }));
}
