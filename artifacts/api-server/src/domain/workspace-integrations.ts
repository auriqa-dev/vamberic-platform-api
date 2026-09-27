import { z } from "zod";
import { basePersistenceSchema, platformIdSchema } from "./schemas";
import { partnerHumanSchema } from "./partners";
import { CrmWorkspaceSchema, type CrmWorkspace } from "./crm-records";

export const INTEGRATION_STATUSES = [
  "pending",
  "connected",
  "error",
  "disconnected",
] as const;
export const INTEGRATION_PROVIDER_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
export const SECRET_REFERENCE_PATTERN =
  /^arn:aws:secretsmanager:[a-z]{2}(?:-[a-z]+)+-\d:\d{12}:secret:[A-Za-z0-9/_+=.@-]{1,512}$/;
const label = z.string().trim().min(1).max(200);
/** Intentionally no free-form metadata, raw error text, token or credential fields.
 * Extend with reviewed non-sensitive provider metadata when a consumer needs it.
 */
export const WorkspaceIntegrationSchema = basePersistenceSchema
  .extend({
    id: platformIdSchema("integration"),
    workspaceId: platformIdSchema("workspace"),
    provider: z.string().regex(INTEGRATION_PROVIDER_PATTERN),
    displayName: label,
    externalAccountId: label.optional(),
    externalTenantId: label.optional(),
    status: z.enum(INTEGRATION_STATUSES),
    scopes: z
      .array(z.string().trim().min(1).max(200))
      .max(100)
      .refine((v) => new Set(v).size === v.length)
      .default([]),
    secretReference: z.string().regex(SECRET_REFERENCE_PATTERN).optional(),
    connectedAt: z.date().optional(),
    connectedBy: partnerHumanSchema.optional(),
    disconnectedAt: z.date().optional(),
    lastSyncAt: z.date().optional(),
    lastSuccessfulSyncAt: z.date().optional(),
    errorCode: z
      .string()
      .regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/)
      .optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      v.updatedAt < v.createdAt ||
      (v.status === "connected" && !v.connectedAt) ||
      (v.status === "disconnected") !== Boolean(v.disconnectedAt) ||
      (v.connectedBy && !v.connectedAt) ||
      (v.status === "pending" && Boolean(v.connectedAt)) ||
      (v.archived && v.status !== "disconnected") ||
      [
        v.connectedAt,
        v.disconnectedAt,
        v.lastSyncAt,
        v.lastSuccessfulSyncAt,
      ].some((d) => d && d > v.updatedAt) ||
      (v.disconnectedAt && v.connectedAt && v.disconnectedAt < v.connectedAt) ||
      (v.lastSuccessfulSyncAt &&
        (!v.lastSyncAt || v.lastSuccessfulSyncAt > v.lastSyncAt)) ||
      (v.lastSyncAt && (!v.connectedAt || v.lastSyncAt < v.connectedAt)) ||
      (v.lastSuccessfulSyncAt &&
        v.connectedAt &&
        v.lastSuccessfulSyncAt < v.connectedAt)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Integration lifecycle timestamps/archive state are inconsistent",
      });
  });
export type WorkspaceIntegration = z.infer<typeof WorkspaceIntegrationSchema>;

/** Pure reference validation; not a credential accessor or authorization grant. */
export function validateWorkspaceIntegrations(
  integrations: readonly WorkspaceIntegration[],
  workspaces: readonly CrmWorkspace[],
): void {
  const byId = new Map(
    workspaces.map((w) => {
      const parsed = CrmWorkspaceSchema.parse(w);
      return [parsed.id, parsed] as const;
    }),
  );
  if (byId.size !== workspaces.length)
    throw new Error("Duplicate workspace identity");
  const seen = new Set<string>();
  for (const record of integrations) {
    const integration = WorkspaceIntegrationSchema.parse(record);
    const workspace = byId.get(integration.workspaceId);
    if (
      !workspace ||
      (workspace.archived && integration.status !== "disconnected")
    )
      throw new Error(
        "Integration requires an existing active workspace; disconnected history may be retained",
      );
    if (seen.has(integration.id))
      throw new Error("Duplicate integration identity");
    seen.add(integration.id);
  }
}
