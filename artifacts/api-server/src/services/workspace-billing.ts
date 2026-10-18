import { z } from "zod";
import type { Document, ClientSession, Db } from "mongodb";
import type { MongoService } from "./mongo";
import type { AppConfig } from "../config";
import type { AuthenticatedUser } from "../middlewares/auth";
import { resolveHvmContext } from "./hvm-context";
import { AuthorizationDenied } from "../authorization/policy";
import { OperatingConflict } from "./operating";
import {
  WorkspaceBillingExemptionSchema,
  effectiveWorkspaceBilling,
} from "../domain/workspace-billing";
import {
  EventSchema,
  generatePlatformId,
  platformIdSchema,
} from "../domain/schemas";
import { partnerHumanSchema } from "../domain/partners";
import { digest } from "@workspace/agent-runtime-protocol";
export const BILLING_EVENT = "workspace_billing_exemption_changed";
const mutation = z
  .object({
    action: z.enum(["approve", "revoke"]),
    requestKey: z.string().min(1).max(200),
    expectedRevision: z.number().int().nonnegative().safe(),
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();
async function access(
  db: Db,
  config: AppConfig,
  user: AuthenticatedUser,
  id: string,
  governance: boolean,
  session?: ClientSession,
) {
  platformIdSchema("workspace").parse(id);
  const a = await resolveHvmContext(db, config, user, session);
  if (governance) {
    if (
      !a.authority.authorize(a.context, "manage", { type: "agent_definitions" })
    )
      throw new AuthorizationDenied();
  } else
    a.authority.scopeFilter(a.context, "read", {
      type: "client_swarms",
      workspaceId: id,
    });
  const ledger = await db
    .collection("schema_versions")
    .findOne({ _id: "vapp-v1" } as Document, { session });
  if (
    ![19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30].includes(
      ledger?.version ?? 0,
    )
  )
    throw new OperatingConflict("Workspace billing requires schema v19");
  const workspace = await db
    .collection("crm_workspaces")
    .findOne({ id, kind: "client", archived: { $ne: true } }, { session });
  if (!workspace) throw new OperatingConflict("Client workspace unavailable");
  return { workspace, actor: partnerHumanSchema.parse(a.context.actor) };
}
function projection(workspace: Document) {
  const exemption =
    workspace.billingExemption === undefined
      ? null
      : WorkspaceBillingExemptionSchema.parse(workspace.billingExemption);
  return {
    workspaceId: workspace.id,
    revision: exemption?.revision ?? 0,
    exemption,
    effective: effectiveWorkspaceBilling(exemption ?? undefined, 0),
  };
}
export async function readWorkspaceBilling(
  mongo: MongoService,
  config: AppConfig,
  user: AuthenticatedUser,
  id: string,
  governance = false,
) {
  const { workspace } = await access(
    await mongo.database(),
    config,
    user,
    id,
    governance,
  );
  return projection(workspace);
}
export async function mutateWorkspaceBilling(
  mongo: MongoService,
  config: AppConfig,
  user: AuthenticatedUser,
  id: string,
  raw: unknown,
) {
  const body = mutation.parse(raw);
  if (!mongo.withTransaction)
    throw new OperatingConflict("Transaction required");
  return mongo.withTransaction(async (db, session) => {
    const { workspace, actor } = await access(
      db,
      config,
      user,
      id,
      true,
      session,
    );
    // A real workspace write serializes all billing decisions and request replays.
    const lock = await db
      .collection("crm_workspaces")
      .updateOne(
        { id, updatedAt: workspace.updatedAt },
        { $inc: { executionSerial: 1 } },
        { session },
      );
    if (lock.matchedCount !== 1)
      throw new OperatingConflict("Workspace changed");
    const scope = digest({
        workspaceId: id,
        actor,
        requestKey: body.requestKey,
      }),
      requestDigest = digest(body);
    const previous = await db
      .collection("events")
      .findOne(
        { eventType: BILLING_EVENT, "payload.scope": scope },
        { session },
      );
    if (previous) {
      if (previous.payload.requestDigest !== requestDigest)
        throw new OperatingConflict("Request key reused");
      return previous.payload.result;
    }
    const before =
      workspace.billingExemption === undefined
        ? undefined
        : WorkspaceBillingExemptionSchema.parse(workspace.billingExemption);
    if ((before?.revision ?? 0) !== body.expectedRevision)
      throw new OperatingConflict("Billing revision changed");
    const now = new Date();
    if (body.action === "revoke" && before?.status !== "active")
      throw new OperatingConflict("Active exemption required");
    const next = WorkspaceBillingExemptionSchema.parse(
      body.action === "approve"
        ? {
            version: 1,
            revision: body.expectedRevision + 1,
            treatment: "internal",
            scope: "hvm_platform_and_agent_services",
            status: "active",
            reason: body.reason,
            approvedBy: actor,
            approvedAt: now,
          }
        : {
            ...before,
            revision: body.expectedRevision + 1,
            status: "revoked",
            revokedBy: actor,
            revokedAt: now,
            revocationReason: body.reason,
          },
    );
    await db
      .collection("crm_workspaces")
      .updateOne(
        { id },
        { $set: { billingExemption: next, updatedAt: now } },
        { session },
      );
    const result = projection({ ...workspace, billingExemption: next });
    const event = EventSchema.parse({
      id: generatePlatformId("event"),
      workspaceId: id,
      createdAt: now,
      updatedAt: now,
      archived: false,
      source: { system: BILLING_EVENT },
      eventType: BILLING_EVENT,
      occurredAt: now,
      payload: { scope, requestDigest, result, actor },
    });
    await db.collection("events").insertOne(event, { session });
    return result;
  });
}
