import { z } from "zod";
import {
  basePersistenceSchema,
  platformIdSchema,
  PersonSchema,
  OrganisationSchema,
  type Person,
  type Organisation,
} from "./schemas";
import { crmOwnerSchema } from "./crm-fields";
import { CrmWorkspaceSchema, type CrmWorkspace } from "./crm-records";

export const PARTNER_STATUSES = [
  "invited",
  "active",
  "suspended",
  "ended",
] as const;
export const PARTNER_ASSIGNMENT_ROLES = ["primary", "supporting"] as const;
export const PARTNER_ASSIGNMENT_STATUSES = ["active", "ended"] as const;
/** Business identity, not an actor, Cognito identity, workspace or data owner. */
export const HvmPartnerSchema = basePersistenceSchema
  .omit({ workspaceId: true })
  .extend({
    id: platformIdSchema("partner"),
    displayName: z.string().trim().min(1).max(200),
    status: z.enum(PARTNER_STATUSES),
    primaryPersonId: platformIdSchema("person").optional(),
    organisationId: platformIdSchema("org").optional(),
    endedAt: z.date().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      (v.status === "ended") !== Boolean(v.endedAt) ||
      v.updatedAt < v.createdAt ||
      (v.endedAt && v.endedAt > v.updatedAt) ||
      (v.archived && v.status !== "ended")
    )
      ctx.addIssue({
        code: "custom",
        message: "Partner lifecycle timestamps/archive state are inconsistent",
      });
  });
/** Responsibility only. Permissions and client entitlements remain separate. */
export const WorkspacePartnerAssignmentSchema = basePersistenceSchema
  .extend({
    id: platformIdSchema("partnerassignment"),
    workspaceId: platformIdSchema("workspace"),
    partnerId: platformIdSchema("partner"),
    role: z.enum(PARTNER_ASSIGNMENT_ROLES),
    status: z.enum(PARTNER_ASSIGNMENT_STATUSES),
    assignedAt: z.date(),
    endedAt: z.date().optional(),
    assignedBy: crmOwnerSchema.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      (v.status === "ended") !== Boolean(v.endedAt) ||
      v.updatedAt < v.createdAt ||
      v.assignedAt > v.updatedAt ||
      (v.endedAt && (v.endedAt < v.assignedAt || v.endedAt > v.updatedAt)) ||
      (v.archived && v.status !== "ended")
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Assignment lifecycle timestamps/archive state are inconsistent",
      });
  });
export const PARTNER_MEMBER_ROLES = ["owner", "member"] as const;
export const PARTNER_MEMBER_STATUSES = ["active", "ended"] as const;
/** Issuer + subject identifies an authenticated human; never a Partner ID or email. */
export const partnerHumanSchema = z
  .object({
    type: z.literal("human"),
    issuer: z
      .string()
      .url()
      .max(500)
      .regex(/^https?:\/\/[^\s]+$/),
    id: z
      .string()
      .trim()
      .min(1)
      .max(300)
      .refine(
        (id) => !id.startsWith("partner_"),
        "Partner IDs are not human identities",
      ),
  })
  .strict();
export const HvmPartnerMembershipSchema = basePersistenceSchema
  .omit({ workspaceId: true })
  .extend({
    id: platformIdSchema("partnermembership"),
    partnerId: platformIdSchema("partner"),
    human: partnerHumanSchema,
    personId: platformIdSchema("person").optional(),
    role: z.enum(PARTNER_MEMBER_ROLES),
    status: z.enum(PARTNER_MEMBER_STATUSES),
    joinedAt: z.date(),
    endedAt: z.date().optional(),
    addedBy: partnerHumanSchema.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      (v.status === "ended") !== Boolean(v.endedAt) ||
      v.updatedAt < v.createdAt ||
      v.joinedAt > v.updatedAt ||
      (v.endedAt && (v.endedAt < v.joinedAt || v.endedAt > v.updatedAt)) ||
      (v.archived && v.status !== "ended")
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Membership lifecycle timestamps/archive state are inconsistent",
      });
  });
export type HvmPartnerMembership = z.infer<typeof HvmPartnerMembershipSchema>;

export type HvmPartner = z.infer<typeof HvmPartnerSchema>;
export type WorkspacePartnerAssignment = z.infer<
  typeof WorkspacePartnerAssignmentSchema
>;

/** Pure proposed-state validation, NOT a membership resolver or repository.
 * Future trusted writers must authorize, lock/recheck references and use the
 * unique indexes transactionally. No partnerId alone confers access.
 */
export function validatePartnerRelationships(model: {
  partners: readonly HvmPartner[];
  memberships?: readonly HvmPartnerMembership[];
  assignments: readonly WorkspacePartnerAssignment[];
  workspaces: readonly CrmWorkspace[];
  people: readonly Person[];
  organisations: readonly Organisation[];
}): void {
  function unique<T extends { id: string }>(rows: readonly T[]) {
    const byId = new Map(rows.map((row) => [row.id, row]));
    if (byId.size !== rows.length)
      throw new Error("Duplicate Partner relationship identity");
    return byId;
  }
  const partners = unique(model.partners.map((p) => HvmPartnerSchema.parse(p)));
  const assignments = unique(
    model.assignments.map((a) => WorkspacePartnerAssignmentSchema.parse(a)),
  );
  const workspaces = unique(
    model.workspaces.map((w) => CrmWorkspaceSchema.parse(w)),
  );
  const people = unique(model.people.map((p) => PersonSchema.parse(p)));
  const organisations = unique(
    model.organisations.map((o) => OrganisationSchema.parse(o)),
  );
  function registry<T extends { workspaceId?: string }>(
    rows: Map<string, T>,
    id: string,
  ) {
    const row = rows.get(id);
    if (!row || row.workspaceId !== undefined)
      throw new Error("Partner references require an internal registry record");
  }
  for (const partner of partners.values()) {
    if (partner.primaryPersonId) registry(people, partner.primaryPersonId);
    if (partner.organisationId) registry(organisations, partner.organisationId);
  }
  const memberships = unique(
    (model.memberships ?? []).map((m) => HvmPartnerMembershipSchema.parse(m)),
  );
  const activeMembers = new Set<string>();
  for (const membership of memberships.values()) {
    if (!partners.has(membership.partnerId))
      throw new Error("Membership requires an existing Partner");
    if (membership.personId) registry(people, membership.personId);
    if (membership.status !== "active") continue;
    const key = JSON.stringify([
      membership.partnerId,
      membership.human.issuer,
      membership.human.id,
    ]);
    if (activeMembers.has(key))
      throw new Error("Duplicate active Partner membership");
    activeMembers.add(key);
  }
  const primary = new Set<string>();
  const activePairs = new Set<string>();
  for (const assignment of assignments.values()) {
    const workspace = workspaces.get(assignment.workspaceId);
    if (
      !partners.has(assignment.partnerId) ||
      !workspace ||
      workspace.kind !== "client"
    )
      throw new Error(
        "Assignment requires an existing Partner and client workspace",
      );
    registry(organisations, workspace.clientOrganisationId!);
    // Ended history may reference an archived workspace; active assignments cannot.
    if (assignment.status !== "active") continue;
    if (workspace.archived)
      throw new Error("Active assignment requires an active workspace");
    const pair = `${assignment.workspaceId}:${assignment.partnerId}`;
    if (activePairs.has(pair))
      throw new Error("Duplicate active Partner assignment");
    activePairs.add(pair);
    if (assignment.role === "primary") {
      if (primary.has(assignment.workspaceId))
        throw new Error("Only one active primary Partner per workspace");
      primary.add(assignment.workspaceId);
    }
  }
}
