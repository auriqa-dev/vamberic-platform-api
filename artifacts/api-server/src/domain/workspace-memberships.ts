import { executionSerializationFields } from "./execution-serialization";
import { AgentOperationGrantsSchema } from "./agent-operator";
import { z } from "zod";
import { basePersistenceSchema, platformIdSchema } from "./schemas";
import { partnerHumanSchema } from "./partners";
export const WorkspaceMembershipSchema = basePersistenceSchema
  .extend({
    ...executionSerializationFields,
    id: platformIdSchema("workspacemembership"),
    workspaceId: platformIdSchema("workspace"),
    human: partnerHumanSchema,
    personId: platformIdSchema("person").optional(),
    role: z.enum(["admin", "member"]),
    status: z.enum(["active", "ended"]),
    joinedAt: z.date(),
    endedAt: z.date().optional(),
    addedBy: partnerHumanSchema.optional(),
    agentOperationGrants: AgentOperationGrantsSchema.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      v.agentOperationGrants?.some(
        (g) =>
          g.grantedAt < v.joinedAt ||
          g.grantedAt > v.updatedAt ||
          (g.target.kind === "workspace_agent" &&
            g.target.workspaceId !== v.workspaceId),
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Grant outside membership chronology",
      });
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
