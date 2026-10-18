import { digest } from "@workspace/agent-runtime-protocol";
import { z } from "zod";
import { platformIdSchema } from "./schemas";
import { partnerHumanSchema } from "./partners";

export const MAX_AGENT_OPERATION_GRANTS = 40;
export const MAX_AGENT_OPERATION_GRANT_BYTES = 65_536;
export const AgentOperationKey = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/);
const v = z.number().int().positive().safe();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const WorkspaceAgentTarget = z
  .object({
    kind: z.literal("workspace_agent"),
    id: hash,
    revision: v,
    workspaceId: platformIdSchema("workspace"),
    definition: z
      .object({
        id: platformIdSchema("agentdefinition"),
        key: AgentOperationKey,
        version: v,
      })
      .strict(),
    implementation: z
      .object({
        key: AgentOperationKey,
        version: v,
        manifestDigest: hash,
        buildDigest: hash,
      })
      .strict(),
  })
  .strict();
export const AgentOperationTarget = z.discriminatedUnion("kind", [
  WorkspaceAgentTarget,
  z
    .object({
      kind: z.literal("client_agent"),
      id: platformIdSchema("clientagent"),
      revision: z.number().int().positive().safe(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("client_swarm"),
      id: platformIdSchema("clientswarm"),
      revision: z.number().int().positive().safe(),
    })
    .strict(),
]);
export const AgentOperationGrantSchema = z
  .object({
    id: platformIdSchema("agentoperatorgrant"),
    target: AgentOperationTarget,
    operations: z.array(AgentOperationKey).min(1).max(20),
    grantedAt: z.date(),
    grantedBy: partnerHumanSchema,
    expiresAt: z.date().optional(),
  })
  .strict()
  .superRefine((g, ctx) => {
    if (g.target.kind === "workspace_agent") {
      const { id, revision, ...tuple } = g.target;
      if (id !== digest(tuple) || revision !== tuple.definition.version)
        ctx.addIssue({ code: "custom", message: "Invalid target identity" });
    }
    if (new Set(g.operations).size !== g.operations.length)
      ctx.addIssue({ code: "custom", message: "Duplicate operation" });
    if (g.expiresAt && g.expiresAt <= g.grantedAt)
      ctx.addIssue({
        code: "custom",
        message: "Grant must expire after creation",
      });
  });
export const AgentOperationGrantsSchema = z
  .array(AgentOperationGrantSchema)
  .max(MAX_AGENT_OPERATION_GRANTS)
  .superRefine((grants, ctx) => {
    if (
      new Set(grants.map((g) => g.id)).size !== grants.length ||
      new Set(grants.map((g) => `${g.target.kind}:${g.target.id}`)).size !==
        grants.length
    )
      ctx.addIssue({ code: "custom", message: "Duplicate grant or target" });
    if (
      Buffer.byteLength(JSON.stringify(grants), "utf8") >
      MAX_AGENT_OPERATION_GRANT_BYTES
    )
      ctx.addIssue({
        code: "custom",
        message: "Operator grants exceed 64 KiB",
      });
  });
export type AgentOperationGrant = z.infer<typeof AgentOperationGrantSchema>;
export type AgentTarget = z.infer<typeof AgentOperationTarget>;

export function grantPermits(
  grant: AgentOperationGrant,
  target: AgentTarget,
  operation: string,
  now: Date,
): boolean {
  return (
    Number.isFinite(now.getTime()) &&
    grant.grantedAt <= now &&
    (!grant.expiresAt || grant.expiresAt > now) &&
    grant.target.kind === target.kind &&
    grant.target.id === target.id &&
    grant.target.revision === target.revision &&
    digest(grant.target) === digest(target) &&
    grant.operations.includes(operation)
  );
}

export function workspaceTarget(
  tuple: Omit<z.infer<typeof WorkspaceAgentTarget>, "id" | "revision">,
) {
  return WorkspaceAgentTarget.parse({
    ...tuple,
    id: digest(tuple),
    revision: tuple.definition.version,
  });
}
