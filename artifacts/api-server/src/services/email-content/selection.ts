import { safeDestination } from "../public-destination";
export { safeDestination } from "../public-destination";
import type { ContentRecord } from "../content-strategy/model";
import { assetReuseEligibility } from "../content-strategy/execution";
/** Explicit permission for email use is required; publication alone is not permission. */
export function emailAssets(
  all: ContentRecord[],
  brief: ContentRecord,
  now = Date.now(),
) {
  const scope = brief.data.scope as {
    brandId: string;
    offers: { id: string }[];
    products: { id: string }[];
    audiences?: { id: string }[];
  };
  return all.filter((asset) => {
    const d = asset.data,
      s = d.scope as typeof scope | undefined;
    if (
      !s ||
      s.brandId !== scope.brandId ||
      !assetReuseEligibility(asset, all).eligible
    )
      return false;
    if (
      !Array.isArray(d.allowedUses) ||
      !d.allowedUses.some((v) =>
        /\b(email|communications|outreach)\b/i.test(String(v)),
      )
    )
      return false;
    if (
      s.offers.length &&
      !s.offers.some((o) => scope.offers.some((b) => b.id === o.id))
    )
      return false;
    if (
      s.products.length &&
      !s.products.some((o) => scope.products.some((b) => b.id === o.id))
    )
      return false;
    if (
      s.audiences?.length &&
      !s.audiences.some((a) => scope.audiences?.some((b) => a.id === b.id))
    )
      return false;
    if (d.visibility !== "published" && d.visibility !== "external_reference")
      return false;
    if (!safeDestination(String(d.url ?? ""))) return false;
    const checked = Date.parse(
      String((d.sourceMetadata as { checkedAt?: string })?.checkedAt ?? ""),
    );
    return (
      Number.isFinite(checked) &&
      checked <= now &&
      now - checked <= 30 * 86400000
    );
  });
}
export function validateEmailBody(body: string) {
  // Destinations are rendered from the selected Library asset, not model prose.
  return (
    !/(?:https?:\/\/|www\.)\S+/i.test(body) && !/<\/?[a-z][^>]*>/i.test(body)
  );
}

/** Private files may support expressly approved email claims without exposing an original file or URL. */
export function emailEvidenceAssets(
  all: ContentRecord[],
  brief: ContentRecord,
) {
  const scope = brief.data.scope as {
    brandId: string;
    offers: { id: string }[];
    products: { id: string }[];
    audiences: { id: string }[];
  };
  const ids = Array.isArray(brief.data.sourceAssetIds)
    ? brief.data.sourceAssetIds
    : [];
  return all
    .filter((r) => {
      const s = r.data.scope as typeof scope | undefined;
      return (
        ids.includes(r.id) &&
        s?.brandId === scope.brandId &&
        assetReuseEligibility(r, all).eligible &&
        (r.data.allowedUses as string[]).some((v) =>
          /\b(email|communications|outreach)\b/i.test(v),
        ) &&
        (!s.offers.length ||
          s.offers.some((o) => scope.offers.some((v) => v.id === o.id))) &&
        (!s.products.length ||
          s.products.some((o) => scope.products.some((v) => v.id === o.id))) &&
        (!s.audiences.length ||
          s.audiences.some((o) => scope.audiences.some((v) => v.id === o.id)))
      );
    })
    .slice(0, 12);
}
