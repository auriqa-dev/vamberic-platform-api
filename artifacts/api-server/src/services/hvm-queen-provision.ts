import { planStrategyTemplates } from "./contact-strategy/provision";
import { z } from "zod";
import { digest } from "@workspace/agent-runtime-protocol";
import type { AppConfig } from "../config";
import type { AuthenticatedUser } from "../middlewares/auth";
import type { MongoService } from "./mongo";
import { AuthorizationDenied } from "../authorization/policy";
import { lockAuthorityDocument } from "./agent-authority-serialization";
import { withoutMongoId } from "./hvm-context";
import {
  BrandSchema,
  BrandRecordSchema,
  OrganisationSchema,
  CrmWorkspaceSchema,
  HvmPartnerSchema,
  HvmPartnerMembershipSchema,
  WorkspacePartnerAssignmentSchema,
  EventSchema,
  generatePlatformId,
  platformIdSchema,
} from "../domain";
const label = z.string().trim().min(1).max(200);
export const QueenProvisionInput = z
  .object({
    requestKey: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/),
    organisationName: label,
    workspaceName: label,
    brandName: label,
    brandSlug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/),
    brandPrimaryDomain: BrandRecordSchema.shape.primaryDomain,
  })
  .strict();
export class QueenProvisionConflict extends Error {}
export const QUEEN_PROVISION_EVENT = "hvm_queen_client_provisioned";
/** Dedicated human boundary. Never delegate the operator bootstrap command. */
export async function provisionQueenClient(
  config: AppConfig,
  mongo: MongoService,
  identity: AuthenticatedUser,
  partnerValue: unknown,
  value: unknown,
) {
  const partnerId = platformIdSchema("partner").parse(partnerValue);
  const input = QueenProvisionInput.parse(value);
  if (
    !config.cognito.hvmClientId ||
    identity.clientId !== config.cognito.hvmClientId ||
    identity.issuer !== config.cognito.issuer
  )
    throw new AuthorizationDenied();
  if (!mongo.withTransaction) throw new Error("Transactions required");
  const actor = {
    type: "human" as const,
    id: identity.subject,
    issuer: identity.issuer,
  };
  const scope = digest({
    partnerId,
    actor,
    clientId: identity.clientId,
    requestKey: input.requestKey,
  });
  const requestDigest = digest(value);
  return mongo.withTransaction(async (db, session) => {
    const ledger = await db
      .collection("schema_versions")
      .findOne({ _id: "vapp-v1" } as never, { session });
    // This writer uses the existing v10+ execution serialization fields.
    if (![16, 17, 18, 19, 20].includes(ledger?.version ?? 0))
      throw new Error(
        "Queen provisioning requires qualified schema 16, 17 or 18",
      );
    const membership = await db.collection("hvm_partner_memberships").findOne(
      {
        partnerId,
        "human.type": "human",
        "human.id": actor.id,
        "human.issuer": actor.issuer,
        role: "owner",
        status: "active",
        archived: { $ne: true },
      },
      { session },
    );
    if (!membership) throw new AuthorizationDenied();
    // Real writes serialize creation and idempotency with revocation/other creates.
    const lockedPartner = await lockAuthorityDocument(
      db,
      { collection: "hvm_partners", id: partnerId },
      session,
    );
    const lockedMember = await lockAuthorityDocument(
      db,
      { collection: "hvm_partner_memberships", id: membership.id },
      session,
    );
    const partner = HvmPartnerSchema.parse(withoutMongoId(lockedPartner));
    const owner = HvmPartnerMembershipSchema.parse(
      withoutMongoId(lockedMember),
    );
    if (
      partner.status !== "active" ||
      partner.archived ||
      owner.partnerId !== partner.id ||
      owner.role !== "owner" ||
      owner.status !== "active" ||
      owner.archived ||
      owner.human.id !== actor.id ||
      owner.human.issuer !== actor.issuer
    )
      throw new AuthorizationDenied();
    const previous = await db
      .collection("events")
      .findOne(
        { eventType: QUEEN_PROVISION_EVENT, "payload.scope": scope },
        { session },
      );
    if (previous) {
      const event = EventSchema.parse(withoutMongoId(previous));
      if (event.payload?.requestDigest !== requestDigest)
        throw new QueenProvisionConflict();
      const result = z
        .object({
          workspaceId: platformIdSchema("workspace"),
          organisationId: platformIdSchema("org"),
          brandId: platformIdSchema("brand"),
          partnerId: platformIdSchema("partner"),
        })
        .strict()
        .parse(event.payload?.result);
      const assignment = await db
        .collection("workspace_partner_assignments")
        .findOne(
          {
            workspaceId: result.workspaceId,
            partnerId,
            status: "active",
            archived: { $ne: true },
          },
          { session },
        );
      const workspace = await db
        .collection("crm_workspaces")
        .findOne(
          { id: result.workspaceId, kind: "client", archived: { $ne: true } },
          { session },
        );
      if (!assignment || !workspace || result.partnerId !== partnerId)
        throw new QueenProvisionConflict();
      await lockAuthorityDocument(
        db,
        { collection: "workspace_partner_assignments", id: assignment.id },
        session,
      );
      await lockAuthorityDocument(
        db,
        { collection: "crm_workspaces", id: workspace.id },
        session,
      );
      return result;
    }
    const now = new Date();
    const {
      result,
      records: baseRecords,
      base,
    } = queenClientBase(input, partnerId, actor, now);
    const records = [
      ...baseRecords,
      [
        "events",
        EventSchema.parse({
          ...base,
          id: generatePlatformId("event"),
          workspaceId: result.workspaceId,
          eventType: QUEEN_PROVISION_EVENT,
          occurredAt: now,
          payload: { scope, requestDigest, result },
        }),
      ] as const,
    ];
    for (const [collection, record] of records)
      await db.collection(collection).insertOne(record, { session });
    return result;
  });
}

/** Shared canonical base; callers supply authority and an atomic transaction. */
export function queenClientBase(
  input: z.infer<typeof QueenProvisionInput>,
  partnerId: string,
  actor: { type: "human"; id: string; issuer: string },
  now: Date,
  billingExemption?: unknown,
) {
  const base = {
    createdAt: now,
    updatedAt: now,
    createdBy: actor,
    updatedBy: actor,
    source: { system: QUEEN_PROVISION_EVENT },
  };
  const result = {
    organisationId: generatePlatformId("org"),
    workspaceId: generatePlatformId("workspace"),
    brandId: generatePlatformId("brand"),
    partnerId,
  };
  const records = [
    [
      "organisations",
      OrganisationSchema.parse({
        ...base,
        id: result.organisationId,
        name: input.organisationName,
        type: "customer",
      }),
    ],
    [
      "crm_workspaces",
      CrmWorkspaceSchema.parse({
        ...base,
        id: result.workspaceId,
        name: input.workspaceName,
        kind: "client",
        clientOrganisationId: result.organisationId,
        ...(billingExemption ? { billingExemption } : {}),
      }),
    ],
    [
      "brands",
      BrandSchema.parse({
        ...base,
        id: result.brandId,
        workspaceId: result.workspaceId,
        organisationId: result.organisationId,
        name: input.brandName,
        slug: input.brandSlug,
        ...(input.brandPrimaryDomain !== undefined
          ? { primaryDomain: input.brandPrimaryDomain }
          : {}),
        status: "active",
      }),
    ],
    [
      "workspace_partner_assignments",
      WorkspacePartnerAssignmentSchema.parse({
        ...base,
        id: generatePlatformId("partnerassignment"),
        workspaceId: result.workspaceId,
        partnerId,
        role: "primary",
        status: "active",
        assignedAt: now,
        assignedBy: { type: "human", id: actor.id },
      }),
    ],
  ] as const;
  const templateRecords = planStrategyTemplates(result.workspaceId, [], now).created.map(record => ["contact_strategy_policies", record] as const);
  return { result, records: [...records, ...templateRecords], base };
}
