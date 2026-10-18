/** Stable, non-personal campaign tags shared by previews, delivery and reporting. */
export function campaignTrackedUrl(
  url: string,
  campaignId: string,
  creativeId: string,
  testOnly = false,
) {
  if (!url || !campaignId) return url;
  const result = new URL(url);
  if (
    !["https:", "http:"].includes(result.protocol) ||
    result.username ||
    result.password
  )
    throw new Error("Use a public HTTP or HTTPS campaign destination.");
  // Replace rather than append: old tags must not attribute this email to another campaign.
  for (const key of [...result.searchParams.keys()])
    if (key.toLowerCase().startsWith("utm_")) result.searchParams.delete(key);
  result.searchParams.set("utm_source", testOnly ? "hvm_test" : "hvm");
  result.searchParams.set("utm_medium", "email");
  result.searchParams.set(
    "utm_campaign",
    testOnly ? `test_${campaignId}` : campaignId,
  );
  result.searchParams.set(
    "utm_id",
    testOnly ? `test_${campaignId}` : campaignId,
  );
  result.searchParams.set("utm_source_platform", "hvm");
  result.searchParams.set("utm_content", creativeId);
  return result.href;
}
