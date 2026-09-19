import { z } from "zod";
import {
  PLATFORM_ID_PREFIXES,
  platformIdPattern,
  type PlatformIdPrefix,
} from "./ids";

export * from "./ids";

/**
 * Domain persistence schemas. IDs are application-owned strings; Mongo's
 * generated _id is deliberately not part of these public/domain contracts.
 */
export const applicationIdSchema = z
  .string()
  .trim()
  .min(2)
  .max(100)
  .regex(/^[a-z0-9][a-z0-9_-]*$/, "must be a lowercase application ID");

export const platformIdSchema = (prefix: PlatformIdPrefix) =>
  z
    .string()
    .regex(platformIdPattern(prefix), `must be a ${prefix} platform ID`);
export const productIdSchema = platformIdSchema("product");
export const personIdSchema = platformIdSchema("person");
export const contactPointIdSchema = platformIdSchema("contact");
export const organisationIdSchema = platformIdSchema("org");
export const organisationRelationshipIdSchema = platformIdSchema("orgrel");
export const productRelationshipIdSchema = platformIdSchema("prodrel");
export const marketingPermissionIdSchema = platformIdSchema("permission");
export const opportunityIdSchema = platformIdSchema("opportunity");
export const subscriptionIdSchema = platformIdSchema("subscription");
export const entitlementIdSchema = platformIdSchema("entitlement");
export const campaignIdSchema = platformIdSchema("campaign");
export const importIdSchema = platformIdSchema("import");
export const eventIdSchema = platformIdSchema("event");
export const transactionIdSchema = platformIdSchema("transaction");

export const dateSchema = z.date();
export const sourceSchema = z.object({
  system: z.string().trim().min(1).max(100),
  reference: z.string().trim().max(500).optional(),
  importedAt: dateSchema.optional(),
});
export const actorSchema = z.object({
  type: z.enum(["human", "agent", "system", "integration"]),
  id: z.string().trim().min(1).max(300).optional(),
  reference: z.string().trim().max(500).optional(),
});
export const metadataSchema = z
  .record(z.string().trim().min(1).max(100), z.unknown())
  .refine((value) => Object.keys(value).length <= 50, "too many metadata keys")
  .refine(
    (value) => JSON.stringify(value).length <= 16_384,
    "metadata exceeds 16KB",
  );

const lifecycleFields = {
  createdAt: dateSchema,
  updatedAt: dateSchema,
  schemaVersion: z.number().int().positive().default(1),
  archived: z.boolean().default(false),
  archivedAt: dateSchema.optional(),
  createdBy: actorSchema.optional(),
  updatedBy: actorSchema.optional(),
};

const base = z.object({
  id: applicationIdSchema,
  ...lifecycleFields,
  source: sourceSchema.optional(),
});

const id = (prefix: PlatformIdPrefix) => platformIdSchema(prefix);
const nonEmpty = z.string().trim().min(1);
const optionalDate = dateSchema.optional();
const ISO_CURRENCY_CODES = new Set(Intl.supportedValuesOf("currency"));
const currency = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "must be a three-letter ISO currency code")
  .refine(
    (value) => ISO_CURRENCY_CODES.has(value),
    "must be a supported ISO 4217 currency code",
  );
const minorAmount = z.number().int().safe().nonnegative();
const personId = id("person");
const organisationId = id("org");
const productId = id("product");
const contactPointId = id("contact");
const permissionId = id("permission");

const withId = (prefix: PlatformIdPrefix) => base.extend({ id: id(prefix) });

export const ProductSchema = withId("product").extend({
  productModelVersion: z.literal(2).default(2),
  name: nonEmpty.max(200),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .regex(/^[a-z0-9][a-z0-9-]*$/),
  description: z.string().max(10_000).optional(),
  productType: z
    .enum([
      "software",
      "consumer_app",
      "marketplace_app",
      "service",
      "agency",
      "content",
      "website",
      "experiment",
      "other",
    ])
    .nullable(),
  lifecycleStatus: z
    .enum(["idea", "building", "pre_launch", "live", "paused", "retired"])
    .nullable(),
  operatingMode: z
    .enum(["active", "maintain", "listen"])
    .nullable()
    .default(null),
  businessModel: z
    .enum([
      "saas",
      "professional_services",
      "transactional",
      "marketplace",
      "advertising",
      "content",
      "lead_generation",
      "other",
    ])
    .nullable()
    .default(null),
  revenueModels: z
    .array(
      z.enum([
        "one_off",
        "subscription",
        "retainer",
        "usage",
        "marketplace",
        "advertising",
        "commission",
        "free",
        "other",
      ]),
    )
    .max(9)
    .refine(
      (values) => new Set(values).size === values.length,
      "Revenue models must be unique",
    )
    .default([]),
  primaryDomain: z.string().trim().min(1).max(253).nullable().default(null),
  additionalDomains: z
    .array(z.string().trim().min(1).max(253))
    .max(50)
    .default([]),
  currency: currency.nullable().optional(),
  plannedLaunchDate: z.string().date().nullable().default(null),
  actualLaunchDate: z.string().date().nullable().default(null),
  launchHypothesis: z.string().max(20000).nullable().default(null),
  successMeasures: z.string().max(20000).nullable().default(null),
  internalNotes: z.string().max(20_000).optional(),
  legacyProductData: z.record(z.unknown()).optional(),
  migrationWarnings: z.array(z.string()).optional(),
});

export const PersonSchema = withId("person").extend({
  firstName: nonEmpty.max(100),
  lastName: nonEmpty.max(100),
  displayName: nonEmpty.max(220).optional(),
  title: z.string().max(200).optional(),
  lifecycleStatus: z.enum(["active", "inactive", "archived"]).default("active"),
});

export function normalizeContactValue(
  type: "email" | "phone" | "other",
  value: string,
): string {
  const trimmed = value.trim();
  if (type === "email") return trimmed.toLowerCase();
  if (type === "phone") {
    // Formatting is removed, but a national number is not given a guessed
    // country code. A leading + is retained for genuine E.164 candidates.
    const hasPlus = trimmed.startsWith("+");
    const digits = trimmed.replace(/[^\d]/g, "");
    return hasPlus ? `+${digits}` : digits;
  }
  return trimmed;
}

export function normalizeContact(
  type: "email" | "phone" | "other",
  value: string,
): { originalValue: string; normalizedValue: string } {
  return {
    originalValue: value,
    normalizedValue: normalizeContactValue(type, value),
  };
}

export const normalizeContactPoint = normalizeContact;

const ContactPointRecordSchema = withId("contact").extend({
  personId,
  type: z.enum(["email", "phone", "other"]),
  value: nonEmpty.max(500),
  normalizedValue: nonEmpty.max(500),
  primary: z.boolean().default(false),
  validity: z.enum(["unknown", "valid", "invalid"]).default("unknown"),
  deliverability: z
    .enum(["unknown", "deliverable", "soft_bounced", "hard_bounced"])
    .default("unknown"),
  leftOrganisation: z.boolean().default(false),
  suppressed: z.boolean().default(false),
  firstSeenAt: optionalDate,
  lastValidatedAt: optionalDate,
});
export const ContactPointPersistenceSchema =
  ContactPointRecordSchema.superRefine((value, context) => {
    if (
      value.normalizedValue !== normalizeContactValue(value.type, value.value)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["normalizedValue"],
        message:
          "normalizedValue does not match the central contact normalizer",
      });
    }
  });
export const ContactPointSchema = ContactPointPersistenceSchema;

export const OrganisationSchema = withId("org").extend({
  name: nonEmpty.max(300),
  legalName: z.string().max(300).optional(),
  domain: z.string().trim().max(253).optional(),
  type: z.enum(["prospect", "customer", "partner", "vendor", "other"]),
  industry: z.string().max(200).optional(),
  size: z
    .object({
      employees: z.number().int().nonnegative().optional(),
      band: z.string().max(50).optional(),
    })
    .optional(),
  country: z.string().trim().max(2).optional(),
  region: z.string().trim().max(100).optional(),
  lifecycleStatus: z.enum(["active", "inactive", "archived"]).default("active"),
});

export const OrganisationRelationshipSchema = withId("orgrel").extend({
  personId,
  organisationId,
  jobTitle: z.string().max(200).optional(),
  department: z.string().max(200).optional(),
  seniority: z.string().max(100).optional(),
  startDate: optionalDate,
  endDate: optionalDate,
  current: z.boolean().default(false),
  confidence: z.number().min(0).max(1).optional(),
});

const productRelationshipTarget = z
  .object({
    personId: personId.optional(),
    organisationId: organisationId.optional(),
  })
  .refine((value) => Boolean(value.personId || value.organisationId), {
    message: "personId or organisationId is required",
  });
export const ProductRelationshipTargetIntegritySchema =
  productRelationshipTarget;
const requireProductRelationshipTarget = (
  value: { personId?: string; organisationId?: string },
  context: z.RefinementCtx,
) => {
  if (!value.personId && !value.organisationId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["personId"],
      message: "personId or organisationId is required",
    });
  }
};
const ProductRelationshipRecordSchema = withId("prodrel").extend({
  productId,
  personId: personId.optional(),
  organisationId: organisationId.optional(),
  status: z.enum([
    "prospect",
    "engaged",
    "trial",
    "customer",
    "former_customer",
    "partner",
  ]),
  acquisitionSource: z.string().max(200).optional(),
  campaignId: id("campaign").optional(),
  firstEngagementAt: optionalDate,
  customerSince: optionalDate,
  endedAt: optionalDate,
});
export const ProductRelationshipSchema =
  ProductRelationshipRecordSchema.superRefine(requireProductRelationshipTarget);

const MarketingPermissionRecordSchema = withId("permission").extend({
  personId: personId.optional(),
  contactPointId: contactPointId.optional(),
  productId: productId.optional(),
  portfolioWide: z.boolean().default(false),
  channel: nonEmpty.max(100),
  purpose: z.enum(["marketing", "newsletter", "product_communication"]),
  lawfulBasis: z.enum([
    "consent",
    "legitimate_interest",
    "soft_opt_in",
    "transactional",
    "other",
  ]),
  permitted: z.boolean(),
  evidence: z.string().max(2_000).optional(),
  effectiveAt: dateSchema,
  supersedesPermissionId: permissionId.optional(),
  reviewAt: optionalDate,
});
const requireMarketingPermissionScope = (
  value: {
    personId?: string;
    contactPointId?: string;
    productId?: string;
    portfolioWide?: boolean;
  },
  context: z.RefinementCtx,
) => {
  if (!value.personId && !value.contactPointId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["personId"],
      message: "personId or contactPointId is required",
    });
  }
  if (!value.productId && !value.portfolioWide) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["productId"],
      message: "productId or portfolioWide scope is required",
    });
  }
};
export const MarketingPermissionSchema =
  MarketingPermissionRecordSchema.superRefine(requireMarketingPermissionScope);

const requireMoneyCurrencyPair = (
  value: {
    estimatedValueMinor?: number;
    spendMinor?: number;
    currency?: string;
  },
  amountField: "estimatedValueMinor" | "spendMinor",
  context: z.RefinementCtx,
) => {
  const amountPresent = value[amountField] !== undefined;
  const currencyPresent = value.currency !== undefined;
  if (amountPresent !== currencyPresent) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: [amountPresent ? "currency" : amountField],
      message: `${amountField} and currency must be provided together`,
    });
  }
};

const OpportunityRecordSchema = withId("opportunity").extend({
  productId,
  organisationId,
  personIds: z.array(personId).max(100).default([]),
  name: nonEmpty.max(300),
  stage: nonEmpty.max(100),
  status: z.enum(["open", "won", "lost", "paused"]),
  estimatedValueMinor: minorAmount.optional(),
  currency: currency.optional(),
  probability: z.number().min(0).max(1).optional(),
  expectedCloseAt: optionalDate,
  nextAction: z.string().max(1_000).optional(),
  nextActionAt: optionalDate,
  campaignId: id("campaign").optional(),
  wonAt: optionalDate,
  lostAt: optionalDate,
  lostReason: z.string().max(1_000).optional(),
});
export const OpportunitySchema = OpportunityRecordSchema.superRefine(
  (value, context) =>
    requireMoneyCurrencyPair(value, "estimatedValueMinor", context),
);

const customerIdentity = {
  personId: personId.optional(),
  organisationId: organisationId.optional(),
};
const requireCustomerIdentity = (
  value: { personId?: string; organisationId?: string },
  context: z.RefinementCtx,
) => {
  if (!value.personId && !value.organisationId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["personId"],
      message: "personId or organisationId is required",
    });
  }
};

const SubscriptionRecordSchema = withId("subscription")
  .extend({
    productId,
    ...customerIdentity,
    provider: nonEmpty.max(100),
    externalCustomerId: z.string().max(300).optional(),
    externalSubscriptionId: z.string().max(300).optional(),
    plan: nonEmpty.max(200),
    status: z.enum(["trialing", "active", "past_due", "cancelled", "ended"]),
    currency,
    recurringAmountMinor: minorAmount,
    billingInterval: z.enum(["day", "week", "month", "year"]),
    startedAt: dateSchema,
    currentPeriodStart: optionalDate,
    currentPeriodEnd: optionalDate,
    cancellationAt: optionalDate,
    endedAt: optionalDate,
  })
  .strict();
export const SubscriptionSchema = SubscriptionRecordSchema.superRefine(
  requireCustomerIdentity,
);

const EntitlementRecordSchema = withId("entitlement")
  .extend({
    productId,
    ...customerIdentity,
    entitlementType: z.enum([
      "one_off",
      "permanent",
      "subscription",
      "time_limited",
    ]),
    sourceTransactionId: id("transaction").optional(),
    sourceSubscriptionId: id("subscription").optional(),
    scope: z
      .object({
        site: z.string().max(200).optional(),
        feature: z.string().max(200).optional(),
        usage: z.string().max(200).optional(),
      })
      .optional(),
    quantity: z.number().finite().nonnegative().optional(),
    activeFrom: dateSchema,
    activeUntil: optionalDate,
    status: z.enum(["active", "expired", "revoked"]),
  })
  .strict();
export const EntitlementSchema = EntitlementRecordSchema.superRefine(
  requireCustomerIdentity,
);

const CampaignRecordSchema = withId("campaign").extend({
  productId,
  name: nonEmpty.max(300),
  type: nonEmpty.max(100),
  channel: nonEmpty.max(100),
  status: z.enum(["draft", "active", "paused", "completed", "cancelled"]),
  audienceDescription: z.string().max(5_000).optional(),
  startAt: optionalDate,
  endAt: optionalDate,
  spendMinor: minorAmount.optional(),
  currency: currency.optional(),
  provider: z.string().max(100).optional(),
  externalReference: z.string().max(300).optional(),
  attribution: metadataSchema.optional(),
});
export const CampaignSchema = CampaignRecordSchema.superRefine(
  (value, context) => requireMoneyCurrencyPair(value, "spendMinor", context),
);

export const ImportSchema = withId("import").extend({
  provider: nonEmpty.max(100),
  productId: productId.optional(),
  campaignId: id("campaign").optional(),
  filename: z.string().max(500).optional(),
  reference: z.string().max(500).optional(),
  importedAt: dateSchema,
  rowCounts: z.object({
    total: z.number().int().nonnegative(),
    created: z.number().int().nonnegative(),
    updated: z.number().int().nonnegative(),
    duplicate: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
  }),
  fieldMapping: z.record(z.string().max(100), z.string().max(100)).default({}),
  lawfulBasisPolicy: metadataSchema.optional(),
  reviewAt: optionalDate,
  status: z.enum(["started", "completed", "failed", "cancelled"]),
  errorSummary: z.string().max(10_000).optional(),
});

export const EventSchema = withId("event").extend({
  eventType: nonEmpty.max(150),
  occurredAt: dateSchema,
  productId: productId.optional(),
  personId: personId.optional(),
  organisationId: organisationId.optional(),
  campaignId: id("campaign").optional(),
  sessionReference: z.string().max(300).optional(),
  externalReference: z.string().max(300).optional(),
  payload: metadataSchema.default({}),
});

const TransactionRecordSchema = withId("transaction")
  .extend({
    productId,
    personId: personId.optional(),
    organisationId: organisationId.optional(),
    provider: nonEmpty.max(100),
    externalCustomerId: z.string().max(300).optional(),
    externalTransactionId: z.string().max(300).optional(),
    type: z.enum(["purchase", "renewal", "refund", "adjustment", "fee"]),
    grossAmountMinor: minorAmount,
    taxAmountMinor: minorAmount.optional(),
    feeAmountMinor: minorAmount.optional(),
    netAmountMinor: minorAmount.optional(),
    currency,
    transactedAt: dateSchema,
    originalTransactionId: id("transaction").optional(),
    subscriptionId: id("subscription").optional(),
    entitlementId: id("entitlement").optional(),
    campaignId: id("campaign").optional(),
    status: z.enum(["pending", "completed", "failed", "refunded", "voided"]),
  })
  .strict();
export const TransactionSchema = TransactionRecordSchema.superRefine(
  requireCustomerIdentity,
);

export type Product = z.infer<typeof ProductSchema>;
export type Person = z.infer<typeof PersonSchema>;
export type ContactPoint = z.infer<typeof ContactPointPersistenceSchema>;
export type Organisation = z.infer<typeof OrganisationSchema>;
export type OrganisationRelationship = z.infer<
  typeof OrganisationRelationshipSchema
>;
export type ProductRelationship = z.infer<typeof ProductRelationshipSchema>;
export type MarketingPermission = z.infer<typeof MarketingPermissionSchema>;
export type Opportunity = z.infer<typeof OpportunitySchema>;
export type Subscription = z.infer<typeof SubscriptionSchema>;
export type Entitlement = z.infer<typeof EntitlementSchema>;
export type Campaign = z.infer<typeof CampaignSchema>;
export type ImportRecord = z.infer<typeof ImportSchema>;
export type Event = z.infer<typeof EventSchema>;
export type Transaction = z.infer<typeof TransactionSchema>;

export const TRANSACTION_STATUSES = [
  "pending",
  "completed",
  "failed",
  "refunded",
  "voided",
] as const;
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];
/**
 * Same-state writes are idempotent. Terminal states never reopen; financial
 * fields are intentionally absent from the update contract.
 */
export const TRANSACTION_STATUS_TRANSITIONS: Readonly<
  Record<TransactionStatus, readonly TransactionStatus[]>
> = {
  pending: ["pending", "completed", "failed", "voided"],
  completed: ["completed", "refunded"],
  failed: ["failed"],
  refunded: ["refunded"],
  voided: ["voided"],
};

export function canTransitionTransactionStatus(
  current: TransactionStatus,
  next: TransactionStatus,
): boolean {
  return TRANSACTION_STATUS_TRANSITIONS[current].includes(next);
}

export function assertTransactionStatusTransition(
  current: TransactionStatus,
  next: TransactionStatus,
): void {
  if (!canTransitionTransactionStatus(current, next)) {
    throw new Error(
      `Invalid transaction status transition: ${current} -> ${next}`,
    );
  }
}

export interface PermissionResolutionCriteria {
  personId?: string;
  contactPointId?: string;
  productId?: string;
  portfolioWide?: boolean;
  channel: string;
  purpose: MarketingPermission["purpose"];
}

function permissionMatches(
  permission: MarketingPermission,
  criteria: PermissionResolutionCriteria,
): boolean {
  return (
    permission.personId === criteria.personId &&
    permission.contactPointId === criteria.contactPointId &&
    permission.productId === criteria.productId &&
    permission.portfolioWide === (criteria.portfolioWide ?? false) &&
    permission.channel === criteria.channel &&
    permission.purpose === criteria.purpose
  );
}

/**
 * Resolves one deterministic decision from the historical ledger. Decisions
 * effective in the future are ignored; ties use creation time then ID.
 */
export function resolveEffectiveMarketingPermission(
  records: readonly MarketingPermission[],
  criteria: PermissionResolutionCriteria,
  at = new Date(),
): MarketingPermission | undefined {
  return records
    .filter(
      (record) =>
        record.effectiveAt <= at && permissionMatches(record, criteria),
    )
    .sort(
      (left, right) =>
        right.effectiveAt.getTime() - left.effectiveAt.getTime() ||
        right.createdAt.getTime() - left.createdAt.getTime() ||
        right.id.localeCompare(left.id),
    )[0];
}

export const resolveEffectivePermission = resolveEffectiveMarketingPermission;

export const insertSchema = <T extends z.AnyZodObject>(schema: T) =>
  schema.omit({
    createdAt: true,
    updatedAt: true,
    schemaVersion: true,
    archived: true,
    archivedAt: true,
  });

export const updateSchema = <T extends z.AnyZodObject>(schema: T) =>
  schema
    .omit({ id: true, createdAt: true, createdBy: true, schemaVersion: true })
    .partial()
    .extend({
      updatedAt: dateSchema.optional(),
      updatedBy: actorSchema.optional(),
    });

export const ProductInsertSchema = insertSchema(ProductSchema);
export const ProductUpdateSchema = updateSchema(ProductSchema);
export const PersonInsertSchema = insertSchema(PersonSchema);
export const PersonUpdateSchema = updateSchema(PersonSchema);
export const ContactPointInsertSchema = insertSchema(
  ContactPointRecordSchema,
).superRefine((value, context) => {
  if (
    value.normalizedValue !== normalizeContactValue(value.type, value.value)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["normalizedValue"],
      message: "normalizedValue does not match the central contact normalizer",
    });
  }
});
export const ContactPointUpdateSchema = updateSchema(ContactPointRecordSchema)
  .omit({ type: true, value: true, normalizedValue: true })
  .strict();
export const OrganisationInsertSchema = insertSchema(OrganisationSchema);
export const OrganisationUpdateSchema = updateSchema(OrganisationSchema);
export const OrganisationRelationshipInsertSchema = insertSchema(
  OrganisationRelationshipSchema,
);
export const OrganisationRelationshipUpdateSchema = updateSchema(
  OrganisationRelationshipSchema,
);
export const ProductRelationshipInsertSchema = insertSchema(
  ProductRelationshipRecordSchema,
).superRefine(requireProductRelationshipTarget);
export const ProductRelationshipUpdateSchema = updateSchema(
  ProductRelationshipRecordSchema,
);
export const MarketingPermissionInsertSchema = insertSchema(
  MarketingPermissionRecordSchema,
).superRefine(requireMarketingPermissionScope);
export const OpportunityInsertSchema = insertSchema(
  OpportunityRecordSchema,
).superRefine((value, context) =>
  requireMoneyCurrencyPair(value, "estimatedValueMinor", context),
);
export const OpportunityUpdateSchema = updateSchema(OpportunityRecordSchema);
export const SubscriptionInsertSchema = insertSchema(
  SubscriptionRecordSchema,
).superRefine(requireCustomerIdentity);
export const SubscriptionUpdateSchema = updateSchema(SubscriptionRecordSchema);
export const EntitlementInsertSchema = insertSchema(
  EntitlementRecordSchema,
).superRefine(requireCustomerIdentity);
export const EntitlementUpdateSchema = updateSchema(EntitlementRecordSchema);
export const CampaignInsertSchema = insertSchema(
  CampaignRecordSchema,
).superRefine((value, context) =>
  requireMoneyCurrencyPair(value, "spendMinor", context),
);
export const CampaignUpdateSchema = updateSchema(CampaignRecordSchema);
export const ImportInsertSchema = insertSchema(ImportSchema);
export const ImportUpdateSchema = updateSchema(ImportSchema);
export const EventInsertSchema = insertSchema(EventSchema);
export const TransactionInsertSchema = insertSchema(
  TransactionRecordSchema,
).superRefine(requireCustomerIdentity);
export const TransactionUpdateSchema = z
  .object({
    status: z.enum(["pending", "completed", "failed", "refunded", "voided"]),
    updatedAt: dateSchema.optional(),
    updatedBy: actorSchema.optional(),
  })
  .strict();
export const TransactionStatusUpdateSchema = TransactionUpdateSchema;

export function transactionStatusUpdateSchema(current: TransactionStatus) {
  return TransactionUpdateSchema.refine(
    (update) => canTransitionTransactionStatus(current, update.status),
    {
      path: ["status"],
      message: `status cannot transition from ${current}`,
    },
  );
}

// Keep this exported for consumers that validate supported collection prefixes.
export const platformIdPrefixes = PLATFORM_ID_PREFIXES;
