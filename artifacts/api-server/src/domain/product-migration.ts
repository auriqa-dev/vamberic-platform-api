import { ProductSchema } from "./schemas";

const types = [
  "software",
  "consumer_app",
  "marketplace_app",
  "service",
  "agency",
  "content",
  "website",
  "experiment",
  "other",
];
const statuses = ["idea", "paused", "retired"];
const businesses = [
  "saas",
  "professional_services",
  "transactional",
  "marketplace",
  "advertising",
  "content",
  "lead_generation",
  "other",
];

/** Pure, idempotent migration. Never infers lifecycle from investment/activity. */
export function normalizeProduct(
  record: Record<string, unknown>,
): Record<string, unknown> {
  if (record.productModelVersion === 2) return record;
  const warnings: string[] = [];
  const known = (value: unknown, allowed: string[], field: string) => {
    if (typeof value === "string" && allowed.includes(value)) return value;
    warnings.push(`Review legacy ${field}: ${String(value ?? "not set")}`);
    return null;
  };
  const domains = Array.isArray(record.domains) ? record.domains : [];
  if (domains.length > 1)
    warnings.push(
      "Choose a primary domain; all legacy domains are preserved as additional domains.",
    );
  // Explicitly reviewed by the owner: this diagnostic application sells a
  // one-off purchase. "paid" alone does not identify a business model.
  // Bind the exception to the inspected ID and legacy state; if either changes,
  // fall back to the normal review warning rather than extrapolating intent.
  const reviewedEnergyPurchase =
    record.id === "product_01m2t4kk2ac6687tb5fxd3q3tb" &&
    record.name === "Energy Health Check" &&
    record.slug === "energy" &&
    record.status === "idea" &&
    record.productType === "software" &&
    record.commercialModel === "paid" &&
    record.oneOffPurchaseAvailable === true &&
    record.subscriptionAvailable === false;
  return {
    ...record,
    productModelVersion: 2,
    legacyProductData: Object.fromEntries(
      Object.entries(record).filter(([key]) => key !== "_id"),
    ),
    productType: known(record.productType, types, "product type"),
    lifecycleStatus: known(record.status, statuses, "status"),
    operatingMode: null,
    businessModel: reviewedEnergyPurchase
      ? "transactional"
      : known(record.commercialModel, businesses, "commercial model"),
    revenueModels: [
      ...(record.oneOffPurchaseAvailable === true ? ["one_off"] : []),
      ...(record.subscriptionAvailable === true ? ["subscription"] : []),
    ],
    primaryDomain: domains.length === 1 ? domains[0] : null,
    additionalDomains: domains.length > 1 ? domains : [],
    plannedLaunchDate: null,
    actualLaunchDate: null,
    launchHypothesis: null,
    successMeasures: null,
    migrationWarnings: warnings,
  };
}

export function readProduct(record: Record<string, unknown>) {
  return ProductSchema.parse(normalizeProduct(record));
}
