import { z } from "zod";
import { platformIdSchema } from "../domain/schemas";

/** Trusted Platform projection input. Never populated from a browser/model or
 * used as an invocation permit. Provider adapters remain unavailable. */
const observed = z
  .object({
    workspaceId: platformIdSchema("workspace"),
    configurationId: platformIdSchema("clientagent"),
    configurationRevision: z.number().int().safe().positive(),
    definition: z
      .object({
        id: platformIdSchema("agentdefinition"),
        version: z.number().int().safe().positive(),
      })
      .strict(),
    implementation: z
      .object({
        key: z.string().min(1).max(64),
        version: z.number().int().safe().positive(),
        manifestDigest: z.string().regex(/^[a-f0-9]{64}$/),
        buildDigest: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
    integrationReference: z
      .object({
        id: platformIdSchema("integration"),
        executionSerial: z.number().int().safe().nonnegative(),
      })
      .strict(),
    providerReference: z
      .object({
        id: platformIdSchema("integrationprovider"),
        version: z.number().int().safe().positive(),
        key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
      })
      .strict(),
    channel: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    policyIds: z.array(platformIdSchema("budgetpolicy")).max(20),
    windowIds: z.array(platformIdSchema("budgetwindow")).max(20),
    binding: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    operation: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    configuration: z.enum(["current", "stale", "unavailable"]),
    integration: z.enum(["connected", "disconnected", "unavailable"]),
    permission: z.enum(["allowed", "denied", "unknown"]),
    budget: z.enum(["sufficient", "insufficient", "unknown"]),
    observedAt: z.date(),
  })
  .strict();
export type ChannelReadinessObservation = z.infer<typeof observed>;
/** Authorization is performed by the existing workspace policy before projection.
 * No account totals, secret references, provider errors or execution tokens leave
 * this projection. Even all-current observations cannot activate a channel. */
export function projectChannelReadiness(
  workspaceId: string,
  observations: readonly ChannelReadinessObservation[],
  authorizedConfigurationIds: ReadonlySet<string>,
) {
  platformIdSchema("workspace").parse(workspaceId);
  if (observations.length > 50) throw new Error("Channel readiness page bound");
  return observations.map((value) => {
    const row = observed.parse(value);
    if (
      row.workspaceId !== workspaceId ||
      !authorizedConfigurationIds.has(row.configurationId)
    )
      throw new Error("Channel readiness denied");
    return {
      ...row,
      executable: false as const,
      reason: "channel_execution_disabled" as const,
    };
  });
}
