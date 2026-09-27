import { z } from "zod";
import {
  basePersistenceSchema,
  platformIdSchema,
  metadataSchema,
} from "./schemas";
import { billingTreatmentSchema } from "./commercial-fields";
import { crmOwnerSchema } from "./crm-fields";
import type { PlatformIdPrefix } from "./ids";
const ids = (prefix: PlatformIdPrefix) =>
  z
    .array(platformIdSchema(prefix))
    .max(100)
    .refine(
      (values) => new Set(values).size === values.length,
      "Duplicate references",
    );
export const CAPABILITY_SCOPE_TYPES = ["workspace", "product"] as const;
const scopeFields = {
  workspaceId: platformIdSchema("workspace"),
  scopeType: z.enum(CAPABILITY_SCOPE_TYPES),
  scopeProductId: platformIdSchema("product").optional(),
};
function scopeIntegrity(
  value: { scopeType: string; scopeProductId?: string },
  ctx: z.RefinementCtx,
) {
  if ((value.scopeType === "product") !== Boolean(value.scopeProductId))
    ctx.addIssue({
      code: "custom",
      path: ["scopeProductId"],
      message: "Only product scope requires a Product reference",
    });
}
/** Reusable catalogue definition; a capability is not a portfolio Product or a running agent. */
export const CapabilitySchema = basePersistenceSchema
  .omit({ workspaceId: true })
  .extend({
    id: platformIdSchema("capability"),
    name: z.string().trim().min(1).max(200),
    supportedScopeTypes: z
      .array(z.enum(CAPABILITY_SCOPE_TYPES))
      .min(1)
      .max(2)
      .refine(
        (values) => new Set(values).size === values.length,
        "Duplicate scopes",
      ),
    dependencies: z
      .array(
        z
          .object({
            capabilityId: platformIdSchema("capability"),
            scope: z.enum(["same_scope", "workspace"]),
          })
          .strict(),
      )
      .max(100)
      .default([]),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      v.dependencies.some((d) => d.capabilityId === v.id) ||
      new Set(v.dependencies.map((d) => d.capabilityId)).size !==
        v.dependencies.length
    )
      ctx.addIssue({
        code: "custom",
        path: ["dependencies"],
        message: "Self/duplicate dependencies are invalid",
      });
  });
/** Offer scope is intentionally not accepted before a formal Offer identity exists. */
export const CapabilityInstanceSchema = basePersistenceSchema
  .extend({
    id: platformIdSchema("capinstance"),
    ...scopeFields,
    capabilityId: platformIdSchema("capability"),
    status: z.enum(["draft", "enabled", "disabled"]),
    dependencyInstanceIds: ids("capinstance").default([]),
    configuration: metadataSchema.optional(),
    output: metadataSchema.optional(),
  })
  .strict()
  .superRefine(scopeIntegrity);
/** Workspace commercial grouping; composition never substitutes for technical prerequisites. */
export const CommercialPackageSchema = basePersistenceSchema
  .extend({
    id: platformIdSchema("package"),
    ...scopeFields,
    name: z.string().trim().min(1).max(200),
    capabilityIds: ids("capability").refine(
      (values) => values.length > 0,
      "Empty package",
    ),
    capabilityInstanceIds: ids("capinstance").default([]),
    status: z.enum(["draft", "active", "retired"]),
    billingTreatment: billingTreatmentSchema.optional(),
  })
  .strict()
  .superRefine(scopeIntegrity);
export const CommercialChargeSchema = basePersistenceSchema
  .extend({
    id: platformIdSchema("charge"),
    workspaceId: platformIdSchema("workspace"),
    capabilityInstanceId: platformIdSchema("capinstance").optional(),
    commercialPackageId: platformIdSchema("package").optional(),
    name: z.string().trim().min(1).max(200),
    chargeType: z.enum(["one_off", "recurring", "usage"]),
    billingInterval: z.enum(["month", "year"]).optional(),
    usageUnit: z.string().trim().min(1).max(100).optional(),
    billingTreatment: billingTreatmentSchema,
    billingReason: z.string().trim().min(1).max(1000).optional(),
    approvedBy: crmOwnerSchema.optional(),
    // No inferred prices. A component may be modelled before its price is decided.
    amountMinor: z.number().int().safe().nonnegative().optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    status: z.enum(["draft", "active", "retired"]),
    sourceSubscriptionId: platformIdSchema("subscription").optional(),
    sourceTransactionId: platformIdSchema("transaction").optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (!v.capabilityInstanceId && !v.commercialPackageId)
      ctx.addIssue({
        code: "custom",
        message: "A charge needs an instance or package target",
      });
    if ((v.chargeType === "recurring") !== Boolean(v.billingInterval))
      ctx.addIssue({
        code: "custom",
        path: ["billingInterval"],
        message: "Only recurring charges require an interval",
      });
    if ((v.chargeType === "usage") !== Boolean(v.usageUnit))
      ctx.addIssue({
        code: "custom",
        path: ["usageUnit"],
        message: "Only usage charges require a usage unit",
      });
    if ((v.amountMinor !== undefined) !== Boolean(v.currency))
      ctx.addIssue({
        code: "custom",
        message: "Amount and currency must be supplied together",
      });
  });
export type Capability = z.infer<typeof CapabilitySchema>;
export type CapabilityInstance = z.infer<typeof CapabilityInstanceSchema>;
export type CommercialPackage = z.infer<typeof CommercialPackageSchema>;
export type CommercialCharge = z.infer<typeof CommercialChargeSchema>;
