import { createHash } from "node:crypto";
import { z } from "zod";
import { basePersistenceSchema, platformIdSchema } from "./schemas";
import { partnerHumanSchema } from "./partners";
import { BUYING_ROLES } from "./buying-roles";

export const HIVE_KINDS = [
  "offerings",
  "ideal_customer_profiles",
  "buyer_profiles",
] as const;
export type HiveKind = (typeof HIVE_KINDS)[number];
export const HIVE_PREFIXES = {
  offerings: "offering",
  ideal_customer_profiles: "icp",
  buyer_profiles: "buyerprofile",
} as const;
const text = (max = 2000) => z.string().trim().min(1).max(max);
const list = () =>
  z
    .array(text())
    .max(40)
    .refine((v) => new Set(v).size === v.length, "Duplicate values");
const lists = <T extends string>(keys: readonly T[]) =>
  Object.fromEntries(keys.map((k) => [k, list().optional()])) as Record<
    T,
    ReturnType<typeof list> extends infer S extends z.ZodTypeAny
      ? z.ZodOptional<S>
      : never
  >;
export const OFFERING_TYPES = [
  "software",
  "installed_technology",
  "physical_product",
  "professional_service",
  "managed_service",
  "outsourced_operation",
  "infrastructure_engineering_service",
  "legal_advisory_service",
  "insurance_financial_product",
  "subscription_media",
  "hybrid",
  "other",
  "unknown",
] as const;
export const DELIVERY_MODES = [
  "digital_self_service",
  "digitally_assisted",
  "installed_deployed",
  "physical_delivery",
  "on_site_service",
  "remote_service",
  "people_led_advisory",
  "managed_outsourced",
  "project_based",
  "ongoing_subscription",
  "hybrid",
  "other",
  "unknown",
] as const;
export const IMPLEMENTATION_MODELS = [
  "customer_implementation",
  "supplier_led_implementation",
  "supplier_mobilisation",
  "light_configuration",
  "no_implementation",
  "other",
  "unknown",
] as const;
export const OFFERING_LIST_FIELDS = [
  "capabilities",
  "deliverables",
  "problemsSolved",
  "desiredOutcomes",
  "differentiators",
  "purchaseConsiderations",
  "industriesServed",
  "regionsServed",
  "competitors",
  "boundaries",
  "explicitExclusions",
  "approvedTerminology",
  "avoidTerminology",
  "approvedClaims",
  "proofPoints",
  "regulatoryContext",
  "unknowns",
] as const;
export const ICP_LIST_FIELDS = [
  "characteristics",
  "problems",
  "desiredOutcomes",
  "buyingTriggers",
  "goodFitIndicators",
  "badFitIndicators",
  "commercialCharacteristics",
  "operationalCharacteristics",
  "technologyCharacteristics",
  "unknowns",
] as const;
export const ACCOUNT_LIST_FIELDS = [
  "organisationTypes",
  "companySizeBands",
  "industries",
  "subIndustries",
  "geographies",
] as const;
export const CONSUMER_LIST_FIELDS = [
  "demographics",
  "geographies",
  "psychographics",
  "values",
  "interests",
  "lifestyle",
  "purchasingBehaviour",
  "priceSensitivity",
  "promotionSensitivity",
  "shoppingBehaviour",
  "researchBehaviour",
  "acuteProblems",
  "aspirations",
  "retentionTendencies",
  "advocacyTendencies",
  "reviewTendencies",
  "referralTendencies",
] as const;
export const BUYER_LIST_FIELDS = [
  "jobTitles",
  "departments",
  "responsibilities",
  "accountabilities",
  "kpis",
  "buyingTriggers",
  "decisionConcerns",
  "desiredOutcomes",
  "objections",
  "risks",
  "evidenceRequired",
  "informationNeeds",
  "researchBehaviours",
  "preferredChannels",
  "constraints",
  "unknowns",
] as const;
const common = { name: text(200), description: text(10000) };
export const OfferingContentSchema = z
  .object({
    ...common,
    businessModel: text().optional(),
    primaryOfferingType: z.enum(OFFERING_TYPES).optional(),
    secondaryOfferingTypes: z.array(z.enum(OFFERING_TYPES)).max(13).optional(),
    websiteUrl: z
      .string()
      .max(2048)
      .url()
      .refine((v) => {
        const u = new URL(v);
        return (
          ["http:", "https:"].includes(u.protocol) && !u.username && !u.password
        );
      })
      .optional(),
    whatItIs: text(10000).optional(),
    whatCustomerBuys: text(10000).optional(),
    deliveryModes: z.array(z.enum(DELIVERY_MODES)).max(13).optional(),
    supplierRole: text().optional(),
    customerRole: text().optional(),
    implementationModel: z.enum(IMPLEMENTATION_MODELS).optional(),
    engagementModel: text().optional(),
    valueProposition: text(10000).optional(),
    commercialModel: text().optional(),
    ...lists(OFFERING_LIST_FIELDS),
  })
  .strict();
export const IcpContentSchema = z
  .object({
    ...common,
    profileType: z.enum(["b2b", "b2c", "d2c"]),
    ...lists(ICP_LIST_FIELDS),
    accountProfile: z.object(lists(ACCOUNT_LIST_FIELDS)).strict().optional(),
    consumerProfile: z.object(lists(CONSUMER_LIST_FIELDS)).strict().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      v.profileType === "b2b"
        ? v.consumerProfile !== undefined
        : v.accountProfile !== undefined
    )
      ctx.addIssue({
        code: "custom",
        message: "Account and consumer profiles must match profileType",
      });
  });
export const BuyerContentSchema = z
  .object({
    ...common,
    role: text().optional(),
    seniority: text(200).optional(),
    buyingRoles: z.array(z.enum(BUYING_ROLES)).max(7).optional(),
    ...lists(BUYER_LIST_FIELDS),
  })
  .strict();
export const HIVE_CONTENT_SCHEMAS = {
  offerings: OfferingContentSchema,
  ideal_customer_profiles: IcpContentSchema,
  buyer_profiles: BuyerContentSchema,
};
const evidenceValue = z.union([
  text(10000),
  z.number().finite(),
  z.boolean(),
  list(),
]);
export const HiveEvidenceInputSchema = z
  .object({
    field: z
      .string()
      .max(100)
      .regex(/^[a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)?$/),
    value: evidenceValue,
    origin: z.enum(["user_supplied", "external_evidence", "ai_inferred"]),
    provider: text(100).optional(),
    sourceReference: text(500).optional(),
    observedAt: z.string().datetime(),
    verification: z.enum(["observed", "human_confirmed", "rejected"]),
    confidence: z.number().min(0).max(1).optional(),
  })
  .strict();
export const HiveEvidenceSchema = HiveEvidenceInputSchema.extend({
  observedAt: z.date(),
  recordedAt: z.date(),
  actor: partnerHumanSchema,
}).strict();
export const HiveEvidenceListSchema = z.array(HiveEvidenceSchema).max(100);
const metadata = {
  workspaceId: platformIdSchema("workspace"),
  createdBy: partnerHumanSchema,
  updatedBy: partnerHumanSchema,
  status: z.enum(["draft", "approved", "retired"]),
  revision: z.number().int().positive(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  approvedRevision: z.number().int().positive().optional(),
  approvedAt: z.date().optional(),
  approvedBy: partnerHumanSchema.optional(),
  evidence: HiveEvidenceListSchema.default([]),
};
export const OfferingRecordSchema = basePersistenceSchema
  .extend({
    ...metadata,
    id: platformIdSchema("offering"),
    organisationId: platformIdSchema("org"),
    brandId: platformIdSchema("brand").optional(),
    definition: OfferingContentSchema,
  })
  .strict();
export const IcpRecordSchema = basePersistenceSchema
  .extend({
    ...metadata,
    id: platformIdSchema("icp"),
    offeringId: platformIdSchema("offering"),
    definition: IcpContentSchema,
  })
  .strict();
export const BuyerRecordSchema = basePersistenceSchema
  .extend({
    ...metadata,
    id: platformIdSchema("buyerprofile"),
    offeringId: platformIdSchema("offering"),
    idealCustomerProfileId: platformIdSchema("icp"),
    definition: BuyerContentSchema,
  })
  .strict();
export type HiveDefinition =
  | z.infer<typeof OfferingRecordSchema>
  | z.infer<typeof IcpRecordSchema>
  | z.infer<typeof BuyerRecordSchema>;
/** Stable object-key order. Array order remains semantic; observations and volatile metadata are excluded. */
export function semanticHash(value: unknown): string {
  const ordered = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(ordered)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .filter(([, x]) => x !== undefined)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([k, x]) => [k, ordered(x)]),
          )
        : v;
  return createHash("sha256")
    .update(JSON.stringify(ordered(value)))
    .digest("hex");
}
export function definitionHash(row: {
  definition: unknown;
  organisationId?: string;
  brandId?: string;
  offeringId?: string;
  idealCustomerProfileId?: string;
}) {
  return semanticHash({
    definition: row.definition,
    organisationId: row.organisationId,
    brandId: row.brandId,
    offeringId: row.offeringId,
    idealCustomerProfileId: row.idealCustomerProfileId,
  });
}
function integrity(v: HiveDefinition, ctx: z.RefinementCtx) {
  if (
    v.updatedAt < v.createdAt ||
    Boolean(v.archivedAt) !== v.archived ||
    (v.archivedAt &&
      (v.archivedAt < v.createdAt || v.archivedAt > v.updatedAt)) ||
    (v.status === "retired") !== v.archived ||
    (v.status === "approved" && (!v.approvedAt || !v.approvedBy)) ||
    Boolean(v.approvedAt) !== Boolean(v.approvedBy) ||
    (v.status === "draft" && v.approvedAt) ||
    (v.approvedAt && (v.approvedAt < v.createdAt || v.approvedAt > v.updatedAt))
  )
    ctx.addIssue({ code: "custom", message: "Invalid definition lifecycle" });
  if (
    (v.status === "approved" && v.approvedRevision !== v.revision) ||
    (v.approvedRevision !== undefined &&
      (v.approvedRevision > v.revision ||
        (v.status === "draft" && v.approvedRevision >= v.revision)))
  )
    ctx.addIssue({
      code: "custom",
      message: "Invalid approved revision pointer",
    });
  if (definitionHash(v) !== v.contentHash)
    ctx.addIssue({ code: "custom", message: "Invalid semantic hash" });
  if (Buffer.byteLength(JSON.stringify(v)) > 200000)
    ctx.addIssue({ code: "custom", message: "Definition exceeds 200KB" });
  for (const e of v.evidence) {
    if (e.observedAt > e.recordedAt || e.recordedAt > v.updatedAt)
      ctx.addIssue({ code: "custom", message: "Invalid evidence chronology" });
  }
}
export const OfferingSchema = OfferingRecordSchema.superRefine(integrity);
export const IdealCustomerProfileSchema =
  IcpRecordSchema.superRefine(integrity);
export const BuyerProfileSchema = BuyerRecordSchema.superRefine(integrity);
export const HIVE_RECORD_SCHEMAS = {
  offerings: OfferingSchema,
  ideal_customer_profiles: IdealCustomerProfileSchema,
  buyer_profiles: BuyerProfileSchema,
};
export type Offering = z.infer<typeof OfferingSchema>;
export type IdealCustomerProfile = z.infer<typeof IdealCustomerProfileSchema>;
export type BuyerProfile = z.infer<typeof BuyerProfileSchema>;
export const HiveRevisionSchema = z
  .object({
    id: platformIdSchema("hiverevision"),
    workspaceId: platformIdSchema("workspace"),
    entityType: z.enum(HIVE_KINDS),
    entityId: z.string(),
    revision: z.number().int().positive(),
    snapshot: z.union([
      OfferingSchema,
      IdealCustomerProfileSchema,
      BuyerProfileSchema,
    ]),
  })
  .strict()
  .superRefine((v, ctx) => {
    const parsed = HIVE_RECORD_SCHEMAS[v.entityType].safeParse(v.snapshot);
    if (
      !parsed.success ||
      v.entityId !== v.snapshot.id ||
      v.workspaceId !== v.snapshot.workspaceId ||
      v.revision !== v.snapshot.revision ||
      v.snapshot.status !== "approved"
    )
      ctx.addIssue({ code: "custom", message: "Invalid approved revision" });
  });
export type HiveRevision = z.infer<typeof HiveRevisionSchema>;
