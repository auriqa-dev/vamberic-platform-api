import { digest } from "@workspace/agent-runtime-protocol";
import { serializeAgentAuthority } from "./agent-authority-serialization";
import { z } from "zod";
import type { Db, ClientSession } from "mongodb";
import { AuthorizationDenied } from "../authorization/policy";
import type { AppConfig } from "../config";
import type { AuthenticatedUser } from "../middlewares/auth";
import {
  AgentOperationTarget,
  AgentOperationKey,
  type AgentTarget,
} from "../domain/agent-operator";
import { WorkspaceMembershipSchema } from "../domain/workspace-memberships";
import {
  EventSchema,
  generatePlatformId,
  platformIdSchema,
} from "../domain/schemas";
import { OperatingSchemas } from "../domain/operating";
import type { MongoService } from "./mongo";
import { resolveHvmContext, withoutMongoId } from "./hvm-context";

export class AgentOperatorConflict extends Error {}
export class AgentControlPlaneUnavailable extends Error {}
export const GrantRequest = z
  .object({
    membershipId: platformIdSchema("workspacemembership"),
    expectedUpdatedAt: z.string().datetime({ precision: 3 }),
    target: AgentOperationTarget,
    operations: z.array(AgentOperationKey).min(1).max(20),
    expiresAt: z.string().datetime({ precision: 3 }).optional(),
  })
  .strict();
export const RevokeRequest = z
  .object({
    membershipId: platformIdSchema("workspacemembership"),
    grantId: platformIdSchema("agentoperatorgrant"),
    expectedUpdatedAt: z.string().datetime({ precision: 3 }),
  })
  .strict();

/** Trusted implementation/job registration, never supplied by an HTTP caller.
 * A Swarm job can be registered for discovery without enabling child execution.
 */
export interface AgentOperationCatalogue {
  operations(
    db: Db,
    workspaceId: string,
    target: AgentTarget,
    session?: ClientSession,
  ): Promise<readonly string[]>;
}
export const unavailableAgentOperations: AgentOperationCatalogue = {
  async operations() {
    return [];
  },
};

export async function requireAgentControlPlane(
  db: Db,
  session?: ClientSession,
) {
  const ledger = await db
    .collection<{ _id: string; version: number }>("schema_versions")
    .findOne({ _id: "vapp-v1" }, { session });
  if (
    ![
      10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27,
      28, 29, 30,
    ].includes(ledger?.version ?? 0)
  )
    throw new AgentControlPlaneUnavailable(
      "Agent control plane requires reviewed schema v10",
    );
}

export async function readOperatingTarget(
  db: Db,
  workspaceId: string,
  target: AgentTarget,
  session?: ClientSession,
) {
  if (target.kind === "workspace_agent") {
    const { id, revision, ...tuple } = target;
    const ledger = await db
      .collection("schema_versions")
      .findOne({ _id: "vapp-v1" } as never, { session });
    if (
      ![16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30].includes(
        ledger?.version ?? 0,
      ) ||
      target.workspaceId !== workspaceId ||
      id !== digest(tuple) ||
      revision !== target.definition.version
    )
      throw new AgentOperatorConflict("Workspace target mismatch");
    const raw = await db
      .collection("agent_definitions")
      .findOne(
        { id: target.definition.id, version: target.definition.version },
        { session },
      );
    const parsed =
      raw && OperatingSchemas.agent_definitions.safeParse(withoutMongoId(raw));
    if (
      !parsed?.success ||
      parsed.data.archived ||
      parsed.data.status !== "active" ||
      parsed.data.key !== target.definition.key ||
      parsed.data.availability !== "queens" ||
      parsed.data.data.executionImplementation?.manifestDigest !==
        target.implementation.manifestDigest
    )
      throw new AgentOperatorConflict("Definition unavailable");
    return parsed.data;
  }
  const resource =
    target.kind === "client_agent" ? "client_agents" : "client_swarms";
  const row = await db
    .collection(resource)
    .findOne({ id: target.id, workspaceId }, { session });
  const parsed =
    row && OperatingSchemas[resource].safeParse(withoutMongoId(row));
  if (
    !parsed ||
    !parsed.success ||
    parsed.data.archived ||
    parsed.data.status !== "configured" ||
    parsed.data.revision !== target.revision
  )
    throw new AgentOperatorConflict(
      "Operating target is not configured at the requested revision",
    );
  return parsed.data;
}

export function createAgentOperatorService(
  config: AppConfig,
  mongo: MongoService,
  catalogue: AgentOperationCatalogue = unavailableAgentOperations,
  clock: () => Date = () => new Date(),
) {
  async function manage(
    identity: AuthenticatedUser,
    workspaceId: string,
    input: unknown,
    revoke: boolean,
  ) {
    platformIdSchema("workspace").parse(workspaceId);
    const body = revoke
      ? RevokeRequest.parse(input)
      : GrantRequest.parse(input);
    if (!mongo.withTransaction)
      throw new AgentControlPlaneUnavailable("Transactions required");
    return mongo.withTransaction(async (db, session) => {
      await requireAgentControlPlane(db, session);
      const resolved = await resolveHvmContext(db, config, identity, session);
      resolved.authority.scopeFilter(resolved.context, "manage", {
        type: "agent_operator_assignments",
        workspaceId,
      });
      // Serialize with existing Queen/member/configuration changes in this workspace.
      const workspace = await db
        .collection("crm_workspaces")
        .findOne({ id: workspaceId, archived: { $ne: true } }, { session });
      if (!workspace) throw new AuthorizationDenied();
      const lock = await db.collection("crm_workspaces").updateOne(
        { id: workspaceId, updatedAt: workspace.updatedAt },
        {
          $set: {
            updatedAt: new Date(
              Math.max(clock().getTime(), workspace.updatedAt.getTime() + 1),
            ),
          },
        },
        { session },
      );
      if (!lock.matchedCount)
        throw new AgentOperatorConflict("Workspace changed");
      const row = await db
        .collection("workspace_memberships")
        .findOne({ id: body.membershipId, workspaceId }, { session });
      if (!row) throw new AuthorizationDenied();
      const membership = WorkspaceMembershipSchema.parse(withoutMongoId(row));
      if (membership.status !== "active" || membership.archived)
        throw new AgentOperatorConflict("Membership is not active");
      if (membership.updatedAt.toISOString() !== body.expectedUpdatedAt)
        throw new AgentOperatorConflict("Membership changed");
      const now = clock();
      if (now < membership.updatedAt)
        throw new AgentOperatorConflict("Platform clock precedes membership");
      // Strictly increasing CAS token, even for two updates in one millisecond.
      const updatedAt = new Date(
        Math.max(now.getTime(), membership.updatedAt.getTime() + 1),
      );
      const previous = membership.agentOperationGrants ?? [];
      let grant;
      let supersededGrantId: string | undefined;
      if ("grantId" in body) {
        grant = previous.find((g) => g.id === body.grantId);
        if (!grant)
          throw new AgentOperatorConflict("Grant is no longer present");
        membership.agentOperationGrants = previous.filter(
          (g) => g.id !== body.grantId,
        );
      } else {
        await readOperatingTarget(db, workspaceId, body.target, session);
        const registered = await catalogue.operations(
          db,
          workspaceId,
          body.target,
          session,
        );
        if (!body.operations.every((op) => registered.includes(op)))
          throw new AgentOperatorConflict(
            "Operation is not registered for this target",
          );
        supersededGrantId = previous.find(
          (g) =>
            g.target.kind === body.target.kind &&
            g.target.id === body.target.id,
        )?.id;
        grant = {
          id: generatePlatformId("agentoperatorgrant"),
          target: body.target,
          operations: body.operations,
          grantedAt: now,
          grantedBy: resolved.response.human,
          ...(body.expiresAt ? { expiresAt: new Date(body.expiresAt) } : {}),
        };
        membership.agentOperationGrants = [
          ...previous.filter(
            (g) =>
              g.target.kind !== body.target.kind ||
              g.target.id !== body.target.id,
          ),
          grant,
        ];
      }
      await serializeAgentAuthority(
        db,
        {
          workspaceId,
          requester: resolved.response.human,
          authority: { basis: "partner" },
          target: grant.target,
        },
        session,
        [],
        !revoke,
      );
      const next = WorkspaceMembershipSchema.parse({
        ...membership,
        updatedAt,
      });
      const result = await db.collection("workspace_memberships").updateOne(
        {
          id: membership.id,
          workspaceId,
          updatedAt: membership.updatedAt,
          status: "active",
        },
        {
          $set: {
            agentOperationGrants: next.agentOperationGrants,
            updatedAt,
          },
        },
        { session },
      );
      if (!result.matchedCount)
        throw new AgentOperatorConflict("Membership changed");
      await db.collection("events").insertOne(
        EventSchema.parse({
          id: generatePlatformId("event"),
          workspaceId,
          createdAt: now,
          updatedAt: now,
          occurredAt: now,
          eventType: revoke
            ? "agent_operation_grant_revoked"
            : supersededGrantId
              ? "agent_operation_grant_reaffirmed"
              : "agent_operation_grant_created",
          payload: {
            application: "hvmapp",
            actor: resolved.response.human,
            membershipId: membership.id,
            grantId: grant.id,
            target: grant.target,
            operations: grant.operations,
            grantedAt: grant.grantedAt.toISOString(),
            ...(grant.expiresAt
              ? { expiresAt: grant.expiresAt.toISOString() }
              : {}),
            ...(supersededGrantId ? { supersededGrantId } : {}),
          },
        }),
        { session },
      );
      return {
        membershipId: membership.id,
        grantId: grant.id,
        updatedAt: updatedAt.toISOString(),
      };
    });
  }
  return {
    grant: (identity: AuthenticatedUser, workspaceId: string, input: unknown) =>
      manage(identity, workspaceId, input, false),
    revoke: (
      identity: AuthenticatedUser,
      workspaceId: string,
      input: unknown,
    ) => manage(identity, workspaceId, input, true),
    async readGrants(
      identity: AuthenticatedUser,
      workspaceId: string,
      membershipId: string,
    ) {
      platformIdSchema("workspace").parse(workspaceId);
      platformIdSchema("workspacemembership").parse(membershipId);
      const db = await mongo.database();
      await requireAgentControlPlane(db);
      const resolved = await resolveHvmContext(db, config, identity);
      resolved.authority.scopeFilter(resolved.context, "read", {
        type: "agent_operator_assignments",
        workspaceId,
      });
      const row = await db
        .collection("workspace_memberships")
        .findOne({ id: membershipId, workspaceId });
      if (!row) throw new AuthorizationDenied();
      const member = WorkspaceMembershipSchema.parse(withoutMongoId(row));
      return {
        membershipId,
        updatedAt: member.updatedAt.toISOString(),
        grants: member.agentOperationGrants ?? [],
      };
    },
    async discover(
      identity: AuthenticatedUser,
      workspaceId: string,
      input: unknown,
    ) {
      platformIdSchema("workspace").parse(workspaceId);
      const query = z
        .object({
          limit: z.coerce.number().int().min(1).max(100).default(20),
          offset: z.coerce.number().int().min(0).max(10000).default(0),
        })
        .strict()
        .parse(input);
      const db = await mongo.database();
      await requireAgentControlPlane(db);
      const resolved = await resolveHvmContext(db, config, identity);
      const row = await db.collection("workspace_memberships").findOne({
        workspaceId,
        "human.issuer": identity.issuer,
        "human.id": identity.subject,
        status: "active",
        archived: { $ne: true },
      });
      if (
        !row ||
        !resolved.response.clients.some((c) => c.workspaceId === workspaceId)
      )
        throw new AuthorizationDenied();
      const member = WorkspaceMembershipSchema.parse(withoutMongoId(row));
      const items = [];
      const now = clock();
      for (const grant of member.agentOperationGrants ?? []) {
        if (
          grant.grantedAt > now ||
          (grant.expiresAt && grant.expiresAt <= now)
        )
          continue;
        try {
          const target = await readOperatingTarget(
            db,
            workspaceId,
            grant.target,
          );
          const registered = await catalogue.operations(
            db,
            workspaceId,
            grant.target,
          );
          items.push({
            target: grant.target,
            name: target.data.name,
            operations: grant.operations,
            basis: "client",
            executionAvailable:
              grant.target.kind === "client_agent" &&
              grant.operations.every((op) => registered.includes(op)),
          });
        } catch (error) {
          if (!(error instanceof AgentOperatorConflict)) throw error;
        }
      }
      return {
        items: items.slice(query.offset, query.offset + query.limit),
        hasMore: items.length > query.offset + query.limit,
        ...query,
      };
    },
  };
}
