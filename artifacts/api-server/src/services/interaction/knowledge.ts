import type { ContentRecord } from "../content-strategy/model";
import { assetReuseEligibility } from "../content-strategy/execution";
/** Permission is explicit and current. A published URL alone grants nothing. */
export function publicChatAssets(
  all: ContentRecord[],
  brandId: string,
  selected: string[],
) {
  return all.filter((r) => {
    const d = r.data,
      scope = d.scope as { brandId?: string } | undefined;
    return (
      selected.includes(r.id) &&
      r.kind === "asset" &&
      r.status === "approved" &&
      scope?.brandId === brandId &&
      d.visibility === "published" &&
      !d.archived &&
      ["owned", "licensed"].includes(String(d.usageRights)) &&
      Array.isArray(d.allowedUses) &&
      d.allowedUses.some((v) =>
        ["website chat", "public chat"].includes(
          String(v).trim().toLowerCase(),
        ),
      ) &&
      Array.isArray(d.restrictions) &&
      d.restrictions.length === 0 &&
      assetReuseEligibility(r, all).eligible
    );
  });
}
