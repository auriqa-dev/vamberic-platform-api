import { z } from "zod";
import { AuthorizationDenied } from "./policy";

const Identity = z
  .object({
    environment: z.enum(["local", "test", "dev", "prod"]),
    clientId: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[A-Za-z0-9_.:-]+$/),
    workerId: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[A-Za-z0-9_.:-]+$/),
    workloadClass: z.literal("agent_runtime"),
    scopes: z
      .array(
        z.enum([
          "claim",
          "heartbeat",
          "context",
          "outcome",
          "receipt",
          "usage",
          "capacity",
          "execution_evidence",
        ]),
      )
      .min(1)
      .max(8),
  })
  .strict();
export type AgentWorkloadPrincipal = Readonly<z.infer<typeof Identity>>;
export type AgentWorkloadAction = AgentWorkloadPrincipal["scopes"][number];

/** Only a trusted authentication composition root may issue these principals.
 * No production HTTP adapter is supplied by 4A.2. A token scope alone never
 * grants tenant access: every operation also requires the persisted Run lease.
 */
export function createAgentWorkloadAuthority(
  environment: AgentWorkloadPrincipal["environment"],
  permittedClients: readonly string[],
) {
  const clients = new Set(permittedClients);
  const issued = new WeakSet<AgentWorkloadPrincipal>();
  return {
    authenticated(identity: unknown): AgentWorkloadPrincipal {
      const parsed = Identity.parse(identity);
      if (
        parsed.environment !== environment ||
        !clients.has(parsed.clientId) ||
        new Set(parsed.scopes).size !== parsed.scopes.length
      )
        throw new AuthorizationDenied();
      const principal = Object.freeze({
        ...parsed,
        scopes: Object.freeze([...parsed.scopes]),
      }) as AgentWorkloadPrincipal;
      issued.add(principal);
      return principal;
    },
    require(principal: AgentWorkloadPrincipal, action: AgentWorkloadAction) {
      if (
        !issued.has(principal) ||
        principal.environment !== environment ||
        !principal.scopes.includes(action)
      )
        throw new AuthorizationDenied();
    },
  };
}
