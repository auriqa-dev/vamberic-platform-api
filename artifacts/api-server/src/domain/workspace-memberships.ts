import { z } from "zod";
import { basePersistenceSchema, platformIdSchema } from "./schemas";
import { partnerHumanSchema } from "./partners";
export const WorkspaceMembershipSchema = basePersistenceSchema
  .extend({
    id: platformIdSchema("workspacemembership"),
    workspaceId: platformIdSchema("workspace"),
    human: partnerHumanSchema,
    personId: platformIdSchema("person").optional(),
    role: z.enum(["admin", "member"]),
    status: z.enum(["active", "ended"]),
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
        message: "Invalid workspace membership lifecycle",
      });
  });
export type ClientWorkspaceMembership = z.infer<
  typeof WorkspaceMembershipSchema
>;
