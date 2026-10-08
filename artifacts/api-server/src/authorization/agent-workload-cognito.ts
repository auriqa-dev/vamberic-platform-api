import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { z } from "zod";
import { AuthorizationDenied } from "./policy";
import {
  createAgentWorkloadAuthority,
  type AgentWorkloadAction,
} from "./agent-workload";
import type { WorkloadAuthenticator } from "../routes/agent-control-plane";

export const WorkerSessionId = z
  .string()
  .regex(
    /^worker:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
const actions: readonly AgentWorkloadAction[] = [
  "claim",
  "heartbeat",
  "context",
  "outcome",
  "receipt",
  "usage",
  "capacity",
  "execution_evidence",
];
export interface WorkloadCognitoConfig {
  environment: "dev" | "prod";
  issuer: string;
  clientId: string;
  resourceServer: string;
  audience?: string;
}
/** Class authentication only. Session ID is correlation, not task attestation.
 * Keep this resolver replaceable by reviewed attestation in a future composition. */
export type WorkerSessionResolver = (id: unknown) => string;
export function createCognitoWorkloadAuthentication(
  config: WorkloadCognitoConfig,
  keys: JWTVerifyGetKey = createRemoteJWKSet(
    new URL(`${config.issuer}/.well-known/jwks.json`),
    { timeoutDuration: 5_000, cooldownDuration: 30_000 },
  ),
  resolveSession: WorkerSessionResolver = (value) =>
    WorkerSessionId.parse(value),
) {
  if (
    !/^https:\/\/cognito-idp\.[a-z0-9-]+\.amazonaws\.com\/[A-Za-z0-9_-]+$/.test(
      config.issuer,
    ) ||
    !/^[a-z0-9]+$/.test(config.clientId) ||
    config.resourceServer !== `vamberic-${config.environment}-agent-runtime`
  )
    throw new Error("Invalid workload authentication configuration");
  const authority = createAgentWorkloadAuthority(config.environment, [
    config.clientId,
  ]);
  const authenticate: WorkloadAuthenticator = async (request) => {
    try {
      const header = request.headers.authorization;
      const bearer = header?.match(
        /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/,
      );
      if (!bearer || header!.length > 16_384) throw new Error();
      const { payload, protectedHeader } = await jwtVerify(bearer[1], keys, {
        algorithms: ["RS256"],
        issuer: config.issuer,
        ...(config.audience ? { audience: config.audience } : {}),
        requiredClaims: ["exp", "iat", "token_use", "client_id", "scope"],
      });
      if (
        payload.token_use !== "access" ||
        payload.client_id !== config.clientId ||
        typeof payload.iat !== "number" ||
        payload.iat > Date.now() / 1000 ||
        typeof payload.exp !== "number" ||
        payload.exp <= payload.iat ||
        typeof protectedHeader.kid !== "string" ||
        !protectedHeader.kid ||
        typeof payload.scope !== "string"
      )
        throw new Error();
      const scopes = payload.scope.split(" ").map((scope) => {
        const action = actions.find(
          (a) => scope === `${config.resourceServer}/${a}`,
        );
        if (!action) throw new Error();
        return action;
      });
      return authority.authenticated({
        environment: config.environment,
        clientId: config.clientId,
        workerId: resolveSession(request.headers["x-agent-worker-id"]),
        workloadClass: "agent_runtime",
        scopes,
      });
    } catch {
      throw new AuthorizationDenied();
    }
  };
  return { authority, authenticate };
}
