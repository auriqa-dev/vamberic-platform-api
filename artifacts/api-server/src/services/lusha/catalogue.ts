import { HiveConflict } from "../hive-definitions";
import type { AppConfig } from "../../config";
import type { AuthenticatedUser } from "../../middlewares/auth";
import type { MongoService } from "../mongo";
import { mutateOperating } from "../operating";
import { resolveHvmContext } from "../hvm-context";
export const LUSHA_DEFINITION = {
  name: "Lusha",
  description:
    "Client-owned B2B contact research and A+ business email enrichment.",
  category: "contact_intelligence",
  authentication: "api_key_reference",
  operationalCapabilities: [
    "lusha_person_search",
    "lusha_email_enrichment",
    "lusha_supplementary_discovery",
  ],
  customerOwnedAccount: "required",
  documentationUrl: "https://docs.lusha.com/api-reference/overview",
  guidance:
    "V3, server-side api_key authentication. Web-first current-employment review; explicit A+ work email required for new managed contacts. Third-party waterfall disabled. Account access does not prove paid endpoint entitlement. No outreach authority.",
  costDrivers: [
    {
      key: "provider_credits",
      name: "Lusha credits",
      unit: "credit",
      description:
        "Actual billing.creditsCharged when returned. Missing billing is unknown, not zero. Rejected results may incur charges.",
    },
  ],
};
export async function registerLusha(
  mongo: MongoService,
  config: AppConfig,
  identity: AuthenticatedUser,
) {
  const db = await mongo.database(),
    r = await resolveHvmContext(db, config, identity);
  r.authority.scopeFilter(r.context, "create", {
    type: "integration_providers",
  });
  const other = await db.collection("integration_providers").findOne({
    "data.name": { $regex: "^lusha$", $options: "i" },
    key: { $ne: "lusha" },
    archived: { $ne: true },
  });
  if (other)
    throw new HiveConflict(
      "A Lusha definition already exists under another key. Reconcile it in Empress before registering another.",
    );
  const existing = await db
    .collection("integration_providers")
    .find({ key: "lusha" })
    .sort({ version: -1 })
    .limit(1)
    .next();
  if (existing && existing.data?.guidance === LUSHA_DEFINITION.guidance)
    return { id: existing.id, status: existing.status };
  // A draft is reviewable through the existing Empress editor; publishing remains explicit there.
  return mutateOperating(
    mongo,
    config,
    identity,
    "integration_providers",
    "create",
    {
      key: "lusha",
      version: (existing?.version ?? 0) + 1,
      availability: "queens",
      data: LUSHA_DEFINITION,
    },
  );
}
