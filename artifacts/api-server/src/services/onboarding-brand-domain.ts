import type { Db } from "mongodb";
import { BrandRecordSchema } from "../domain/brands";

export function onboardingWebsiteDomain(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return undefined;
    const parsed = BrandRecordSchema.shape.primaryDomain.safeParse(
      url.hostname.toLowerCase(),
    );
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** Call only after brand/workspace read authorization. Preserve explicit brand edits. */
export async function readOnboardingBrandDomain(
  db: Db,
  workspaceId: string,
  brandId: string,
): Promise<string | undefined> {
  const records = await db
    .collection("client_onboardings")
    .find({
      "result.workspaceId": workspaceId,
      "result.brandId": brandId,
    })
    .limit(2)
    .toArray();
  if (records.length !== 1) return undefined;
  return onboardingWebsiteDomain(records[0]?.details?.intake?.websiteUrl);
}
