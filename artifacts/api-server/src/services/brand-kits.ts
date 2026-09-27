import type { Db } from "mongodb";
import {
  BrandSchema,
  BrandKitSchema,
  platformIdSchema,
  brandKitReadiness,
} from "../domain";
import type {
  AuthorizationAuthority,
  AuthorizationContext,
} from "../authorization/policy";
/** Read-only consumer seam. No routes, asset downloads, grants or credential resolution. */
export async function readCurrentBrandKit(
  db: Db,
  authority: AuthorizationAuthority,
  context: AuthorizationContext,
  workspaceId: string,
  brandId: string,
) {
  platformIdSchema("workspace").parse(workspaceId);
  platformIdSchema("brand").parse(brandId);
  const scope = authority.scopeFilter(context, "read", {
    type: "brand_kits",
    workspaceId,
  });
  authority.scopeFilter(context, "read", { type: "brands", workspaceId });
  const workspace = await db
    .collection("crm_workspaces")
    .findOne({ id: workspaceId, archived: { $ne: true } });
  if (!workspace) return null;
  const brandRecord = await db
    .collection("brands")
    .findOne(
      { ...scope, id: brandId, status: "active", archived: { $ne: true } },
      { projection: { _id: 0 } },
    );
  if (!brandRecord) return null;
  const brand = BrandSchema.parse(brandRecord);
  const records = await db
    .collection("brand_kits")
    .find(
      {
        ...scope,
        brandId: brand.id,
        status: "approved",
        archived: { $ne: true },
      },
      { projection: { _id: 0 } },
    )
    .limit(2)
    .toArray();
  if (records.length > 1) throw new Error("Ambiguous current Brand Kit");
  const record = records[0];
  if (!record) return null;
  const kit = BrandKitSchema.parse(record);
  // Retired assets are historical metadata, not approved consumer instructions.
  const current = {
    ...kit,
    assets: kit.assets.filter((a) => a.status === "approved"),
  };
  return { brand, kit: current, readiness: brandKitReadiness(current) };
}
