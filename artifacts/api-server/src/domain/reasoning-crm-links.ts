import { z } from "zod";
import { platformIdSchema, EventSchema } from "./schemas";
import { CrmTaskSchema } from "./crm-records";
import {
  EvidenceReference,
  KnowledgeRevisionReference,
} from "./reasoning-foundation";
export const ReasoningActionLinkSchema = z
  .object({
    contextId: platformIdSchema("reasoningcontext"),
    decisionId: platformIdSchema("reasoningdecision"),
    offerings: z
      .array(
        KnowledgeRevisionReference.extend({
          kind: z.literal("offering"),
          entityId: platformIdSchema("offering"),
          snapshotId: platformIdSchema("hiverevision"),
        }),
      )
      .max(100),
    campaignId: platformIdSchema("campaign").optional(),
    capabilityId: platformIdSchema("capability").optional(),
    agentDefinitionId: platformIdSchema("agentdefinition").optional(),
    runId: platformIdSchema("agentrun").optional(),
  })
  .strict();
export const ReasoningEventLinkSchema = z
  .object({
    kind: z.enum(["observation", "outcome"]),
    contextId: platformIdSchema("reasoningcontext"),
    decisionId: platformIdSchema("reasoningdecision").optional(),
    taskId: platformIdSchema("task").optional(),
    evidence: z.array(EvidenceReference).max(100),
    periodStart: z.date(),
    periodEnd: z.date(),
    measurements: z
      .array(
        z
          .object({
            name: z.string().min(1).max(100),
            value: z.number().finite(),
            unit: z.string().min(1).max(100),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
/** Future admitted records reuse existing canonical collections and their original validation. */
export function parseReasoningTask(input: unknown) {
  const envelope = z
    .object({ record: z.unknown(), reasoning: ReasoningActionLinkSchema })
    .strict()
    .parse(input);
  const record = CrmTaskSchema.parse(envelope.record);
  if (!record.workspaceId) throw new Error("Workspace required");
  return { ...record, reasoning: envelope.reasoning };
}
export function parseReasoningEvent(input: unknown) {
  const envelope = z
    .object({ record: z.unknown(), reasoning: ReasoningEventLinkSchema })
    .strict()
    .parse(input);
  const record = EventSchema.parse(envelope.record);
  if (
    !record.workspaceId ||
    envelope.reasoning.periodEnd < envelope.reasoning.periodStart
  )
    throw new Error("Invalid outcome scope or interval");
  return { ...record, reasoning: envelope.reasoning };
}
