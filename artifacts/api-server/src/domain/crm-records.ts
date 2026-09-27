import { z } from "zod";
import {
  basePersistenceSchema,
  platformIdSchema,
  productIdSchema,
  personIdSchema,
  organisationIdSchema,
  opportunityIdSchema,
  campaignIdSchema,
} from "./schemas";
import {
  crmActorSchema,
  prioritySchema,
  qualificationFields,
  fieldEvidenceListSchema,
} from "./crm-fields";
export const CrmPipelineSchema = basePersistenceSchema
  .extend({
    id: platformIdSchema("pipeline"),
    productId: productIdSchema.optional(),
    name: z.string().trim().min(1).max(200),
    stages: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,99}$/),
            label: z.string().trim().min(1).max(200),
            order: z.number().int().nonnegative(),
            status: z.enum(["open", "won", "lost", "paused"]),
            probability: z.number().min(0).max(1).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .superRefine((v, ctx) => {
    if (!v.productId && !v.workspaceId)
      ctx.addIssue({
        code: "custom",
        message: "Product or workspace context required",
      });
    if (
      new Set(v.stages.map((s) => s.id)).size !== v.stages.length ||
      new Set(v.stages.map((s) => s.order)).size !== v.stages.length
    )
      ctx.addIssue({
        code: "custom",
        path: ["stages"],
        message: "Stage IDs and order must be unique",
      });
  });
export const CrmTaskSchema = basePersistenceSchema
  .extend({
    id: platformIdSchema("task"),
    title: z.string().trim().min(1).max(300),
    description: z.string().max(10000).optional(),
    type: z.enum([
      "call",
      "email",
      "meeting",
      "research",
      "follow_up",
      "other",
    ]),
    status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
    priority: prioritySchema.optional(),
    dueAt: z.date().optional(),
    completedAt: z.date().optional(),
    assignedTo: crmActorSchema.optional(),
    productId: productIdSchema.optional(),
    personId: personIdSchema.optional(),
    organisationId: organisationIdSchema.optional(),
    opportunityId: opportunityIdSchema.optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.productId && !v.personId && !v.organisationId && !v.opportunityId)
      ctx.addIssue({
        code: "custom",
        message: "At least one CRM subject is required",
      });
    if ((v.status === "completed") !== Boolean(v.completedAt))
      ctx.addIssue({
        code: "custom",
        path: ["completedAt"],
        message: "completedAt is required only for completed tasks",
      });
  });
export const EXTERNAL_ENTITY_PREFIXES = {
  products: "product",
  people: "person",
  contact_points: "contact",
  organisations: "org",
  organisation_relationships: "orgrel",
  product_relationships: "prodrel",
  opportunities: "opportunity",
  campaigns: "campaign",
  crm_pipelines: "pipeline",
  events: "event",
  crm_workspaces: "workspace",
  crm_leads: "lead",
  crm_tasks: "task",
  marketing_permissions: "permission",
  subscriptions: "subscription",
  entitlements: "entitlement",
  transactions: "transaction",
  imports: "import",
} as const;
export const externalEntityTypeSchema = z.enum(
  Object.keys(EXTERNAL_ENTITY_PREFIXES) as [
    keyof typeof EXTERNAL_ENTITY_PREFIXES,
    ...(keyof typeof EXTERNAL_ENTITY_PREFIXES)[],
  ],
);
export const ExternalReferenceSchema = basePersistenceSchema
  .extend({
    id: platformIdSchema("externalref"),
    provider: z.string().trim().min(1).max(100),
    providerAccountId: z.string().trim().min(1).max(300),
    objectType: z.string().trim().min(1).max(100),
    externalId: z.string().trim().min(1).max(500),
    entityType: externalEntityTypeSchema,
    entityId: z.string(),
    sourceCreatedAt: z.date().optional(),
    sourceUpdatedAt: z.date().optional(),
    lastSyncedAt: z.date().optional(),
  })
  .superRefine((v, ctx) => {
    if (
      !platformIdSchema(EXTERNAL_ENTITY_PREFIXES[v.entityType]).safeParse(
        v.entityId,
      ).success
    )
      ctx.addIssue({
        code: "custom",
        path: ["entityId"],
        message: "Target ID does not match entity type",
      });
    if (
      v.sourceCreatedAt &&
      v.sourceUpdatedAt &&
      v.sourceUpdatedAt < v.sourceCreatedAt
    )
      ctx.addIssue({
        code: "custom",
        path: ["sourceUpdatedAt"],
        message: "Source modification predates creation",
      });
  });
export type CrmPipeline = z.infer<typeof CrmPipelineSchema>;

export type CrmTask = z.infer<typeof CrmTaskSchema>;
export type ExternalReference = z.infer<typeof ExternalReferenceSchema>;
export const isTaskOverdue = (task: CrmTask, now = new Date()) =>
  Boolean(
    task.dueAt &&
    task.dueAt < now &&
    ["pending", "in_progress"].includes(task.status),
  );

/** Workspace ownership is distinct from products and does not confer application access. */
export const CrmWorkspaceSchema = basePersistenceSchema
  .extend({
    id: platformIdSchema("workspace"),
    name: z.string().trim().min(1).max(200),
    kind: z.enum(["portfolio", "client"]),
    clientOrganisationId: organisationIdSchema.optional(),
  })
  .superRefine((v, ctx) => {
    if (
      v.workspaceId ||
      (v.kind === "client") !== Boolean(v.clientOrganisationId)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Client workspaces require a client organisation; workspaces cannot be nested",
      });
  });
/** Prospect qualification for a workspace; commercial product relationships stay separate. */
export const CrmLeadSchema = basePersistenceSchema
  .extend({
    id: platformIdSchema("lead"),
    workspaceId: platformIdSchema("workspace"),
    productId: productIdSchema.optional(),
    personId: personIdSchema.optional(),
    organisationId: organisationIdSchema.optional(),
    campaignId: campaignIdSchema.optional(),
    ...qualificationFields,
    fieldEvidence: fieldEvidenceListSchema.optional(),
  })
  .refine(
    (v) => Boolean(v.personId || v.organisationId),
    "A lead requires a person or organisation",
  );
export type CrmWorkspace = z.infer<typeof CrmWorkspaceSchema>;
export type CrmLead = z.infer<typeof CrmLeadSchema>;
