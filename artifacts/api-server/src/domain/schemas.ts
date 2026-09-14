import { z } from "zod";

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
export const dateSchema = z.date();
export const sourceSchema = z.object({
  system: z.string().trim().min(1).max(100),
  reference: z.string().trim().max(500).optional(),
  importedAt: dateSchema.optional(),
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
};

const base = z.object({
  id: applicationIdSchema,
  ...lifecycleFields,
  source: sourceSchema.optional(),
});

const nonEmpty = z.string().trim().min(1);
const optionalDate = dateSchema.optional();
const currency = z.string().trim().toUpperCase().length(3);
const amount = z.number().finite().nonnegative();

export const ProductSchema = base.extend({
  name: nonEmpty.max(200),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .regex(/^[a-z0-9][a-z0-9-]*$/),
  description: z.string().max(10_000).optional(),
  status: z.enum(["idea", "validation", "active", "paused", "retired"]),
  productType: nonEmpty.max(100),
  domains: z.array(z.string().trim().min(1).max(253)).max(50).default([]),
  commercialModel: nonEmpty.max(100),
  oneOffPurchaseAvailable: z.boolean().default(false),
  subscriptionAvailable: z.boolean().default(false),
  currency: currency.optional(),
  internalNotes: z.string().max(20_000).optional(),
});

export const PersonSchema = base.extend({
  firstName: nonEmpty.max(100),
  lastName: nonEmpty.max(100),
  displayName: nonEmpty.max(220).optional(),
  title: z.string().max(200).optional(),
  lifecycleStatus: z.enum(["active", "inactive", "archived"]).default("active"),
});

export const ContactPointSchema = base.extend({
  personId: applicationIdSchema,
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

export const OrganisationSchema = base.extend({
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

export const OrganisationRelationshipSchema = base.extend({
  personId: applicationIdSchema,
  organisationId: applicationIdSchema,
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
    personId: applicationIdSchema.optional(),
    organisationId: applicationIdSchema.optional(),
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
const ProductRelationshipRecordSchema = base.extend({
  productId: applicationIdSchema,
  personId: applicationIdSchema.optional(),
  organisationId: applicationIdSchema.optional(),
  status: z.enum([
    "prospect",
    "engaged",
    "trial",
    "customer",
    "former_customer",
    "partner",
  ]),
  acquisitionSource: z.string().max(200).optional(),
  campaignId: applicationIdSchema.optional(),
  firstEngagementAt: optionalDate,
  customerSince: optionalDate,
  endedAt: optionalDate,
});
export const ProductRelationshipSchema =
  ProductRelationshipRecordSchema.superRefine(requireProductRelationshipTarget);

const MarketingPermissionRecordSchema = base.extend({
  personId: applicationIdSchema.optional(),
  contactPointId: applicationIdSchema.optional(),
  productId: applicationIdSchema.optional(),
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
  grantedAt: dateSchema,
  withdrawnAt: optionalDate,
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

export const OpportunitySchema = base.extend({
  productId: applicationIdSchema,
  organisationId: applicationIdSchema,
  personIds: z.array(applicationIdSchema).max(100).default([]),
  name: nonEmpty.max(300),
  stage: nonEmpty.max(100),
  status: z.enum(["open", "won", "lost", "paused"]),
  estimatedValue: amount.optional(),
  currency: currency.optional(),
  probability: z.number().min(0).max(1).optional(),
  expectedCloseAt: optionalDate,
  nextAction: z.string().max(1_000).optional(),
  nextActionAt: optionalDate,
  campaignId: applicationIdSchema.optional(),
  source: sourceSchema.optional(),
  wonAt: optionalDate,
  lostAt: optionalDate,
  lostReason: z.string().max(1_000).optional(),
});

const customerReference = z.object({
  personId: applicationIdSchema.optional(),
  organisationId: applicationIdSchema.optional(),
  customerReference: applicationIdSchema.optional(),
});
export const customerReferenceIntegritySchema = customerReference.refine(
  (value) =>
    Boolean(value.personId || value.organisationId || value.customerReference),
  "a person, organisation, or customer reference is required",
);
const requireCustomerReference = (
  value: {
    personId?: string;
    organisationId?: string;
    customerReference?: string;
  },
  context: z.RefinementCtx,
) => {
  if (!value.personId && !value.organisationId && !value.customerReference) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["customerReference"],
      message: "a person, organisation, or customer reference is required",
    });
  }
};

const SubscriptionRecordSchema = base.extend({
  productId: applicationIdSchema,
  ...customerReference.shape,
  provider: nonEmpty.max(100),
  externalCustomerId: z.string().max(300).optional(),
  externalSubscriptionId: z.string().max(300).optional(),
  plan: nonEmpty.max(200),
  status: z.enum(["trialing", "active", "past_due", "cancelled", "ended"]),
  currency,
  recurringAmount: amount,
  billingInterval: z.enum(["day", "week", "month", "year"]),
  startedAt: dateSchema,
  currentPeriodStart: optionalDate,
  currentPeriodEnd: optionalDate,
  cancellationAt: optionalDate,
  endedAt: optionalDate,
});
export const SubscriptionSchema = SubscriptionRecordSchema.superRefine(
  requireCustomerReference,
);

const EntitlementRecordSchema = base.extend({
  productId: applicationIdSchema,
  ...customerReference.shape,
  entitlementType: z.enum([
    "one_off",
    "permanent",
    "subscription",
    "time_limited",
  ]),
  sourceTransactionId: applicationIdSchema.optional(),
  sourceSubscriptionId: applicationIdSchema.optional(),
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
});
export const EntitlementSchema = EntitlementRecordSchema.superRefine(
  requireCustomerReference,
);

export const CampaignSchema = base.extend({
  productId: applicationIdSchema,
  name: nonEmpty.max(300),
  type: nonEmpty.max(100),
  channel: nonEmpty.max(100),
  status: z.enum(["draft", "active", "paused", "completed", "cancelled"]),
  audienceDescription: z.string().max(5_000).optional(),
  startAt: optionalDate,
  endAt: optionalDate,
  spend: amount.optional(),
  currency: currency.optional(),
  provider: z.string().max(100).optional(),
  externalReference: z.string().max(300).optional(),
  attribution: metadataSchema.optional(),
});

export const ImportSchema = base.extend({
  provider: nonEmpty.max(100),
  productId: applicationIdSchema.optional(),
  campaignId: applicationIdSchema.optional(),
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

export const EventSchema = base.extend({
  eventType: nonEmpty.max(150),
  occurredAt: dateSchema,
  productId: applicationIdSchema.optional(),
  personId: applicationIdSchema.optional(),
  organisationId: applicationIdSchema.optional(),
  campaignId: applicationIdSchema.optional(),
  sessionReference: z.string().max(300).optional(),
  externalReference: z.string().max(300).optional(),
  payload: metadataSchema.default({}),
});

const TransactionRecordSchema = base.extend({
  productId: applicationIdSchema,
  personId: applicationIdSchema.optional(),
  organisationId: applicationIdSchema.optional(),
  customerReference: applicationIdSchema.optional(),
  provider: nonEmpty.max(100),
  externalTransactionId: z.string().max(300).optional(),
  type: z.enum(["purchase", "renewal", "refund", "adjustment", "fee"]),
  grossAmount: amount,
  taxAmount: amount.optional(),
  feeAmount: amount.optional(),
  netAmount: amount.optional(),
  currency,
  transactedAt: dateSchema,
  subscriptionId: applicationIdSchema.optional(),
  entitlementId: applicationIdSchema.optional(),
  campaignId: applicationIdSchema.optional(),
  status: z.enum(["pending", "completed", "failed", "refunded", "voided"]),
});
export const TransactionSchema = TransactionRecordSchema.superRefine(
  requireCustomerReference,
);

export type Product = z.infer<typeof ProductSchema>;
export type Person = z.infer<typeof PersonSchema>;
export type ContactPoint = z.infer<typeof ContactPointSchema>;
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
    .omit({ id: true, createdAt: true, schemaVersion: true })
    .partial()
    .extend({ updatedAt: dateSchema.optional() });

export const ProductInsertSchema = insertSchema(ProductSchema);
export const ProductUpdateSchema = updateSchema(ProductSchema);
export const PersonInsertSchema = insertSchema(PersonSchema);
export const PersonUpdateSchema = updateSchema(PersonSchema);
export const ContactPointInsertSchema = insertSchema(ContactPointSchema);
export const ContactPointUpdateSchema = updateSchema(ContactPointSchema);
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
export const MarketingPermissionUpdateSchema = updateSchema(
  MarketingPermissionRecordSchema,
);
export const OpportunityInsertSchema = insertSchema(OpportunitySchema);
export const OpportunityUpdateSchema = updateSchema(OpportunitySchema);
export const SubscriptionInsertSchema = insertSchema(
  SubscriptionRecordSchema,
).superRefine(requireCustomerReference);
export const SubscriptionUpdateSchema = updateSchema(SubscriptionRecordSchema);
export const EntitlementInsertSchema = insertSchema(
  EntitlementRecordSchema,
).superRefine(requireCustomerReference);
export const EntitlementUpdateSchema = updateSchema(EntitlementRecordSchema);
export const CampaignInsertSchema = insertSchema(CampaignSchema);
export const CampaignUpdateSchema = updateSchema(CampaignSchema);
export const ImportInsertSchema = insertSchema(ImportSchema);
export const ImportUpdateSchema = updateSchema(ImportSchema);
export const EventInsertSchema = insertSchema(EventSchema);
export const EventUpdateSchema = updateSchema(EventSchema);
export const TransactionInsertSchema = insertSchema(
  TransactionRecordSchema,
).superRefine(requireCustomerReference);
export const TransactionUpdateSchema = updateSchema(TransactionRecordSchema);
