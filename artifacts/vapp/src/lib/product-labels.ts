export function productLabel(value: string | null | undefined): string {
  if (!value) return "Not specified";
  if (value === "saas") return "SaaS";
  if (value === "pre_launch") return "Pre-launch";
  if (value === "one_off") return "One-off";
  return value
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
