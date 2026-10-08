import { z } from "zod";
import type { Document } from "mongodb";
import type { MongoService } from "./mongo";
import {
  BrandSchema,
  BrandRecordSchema,
  OrganisationSchema,
  CrmWorkspaceSchema,
  HvmPartnerSchema,
  HvmPartnerMembershipSchema,
  WorkspacePartnerAssignmentSchema,
  WorkspaceMembershipSchema,
  EventSchema,
  generatePlatformId,
  partnerHumanSchema,
  platformIdSchema,
} from "../domain";
export const HvmProvisionInput = z
  .object({
    organisationId: platformIdSchema("org"),
    organisationName: z.string().trim().min(1).max(200).optional(),
    workspaceId: platformIdSchema("workspace"),
    management: z.enum(["queen", "client"]).default("queen"),
    partnerId: platformIdSchema("partner").optional(),
    partnerMembershipId: platformIdSchema("partnermembership").optional(),
    assignmentId: platformIdSchema("partnerassignment").optional(),
    brandId: platformIdSchema("brand"),
    clientMembershipId: platformIdSchema("workspacemembership").optional(),
    workspaceName: z.string().trim().min(1).max(200),
    partnerName: z.string().trim().min(1).max(200).optional(),
    brandName: z.string().trim().min(1).max(200),
    brandSlug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/),
    brandPrimaryDomain: BrandRecordSchema.shape.primaryDomain,
    human: partnerHumanSchema,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      v.management === "client"
        ? !v.clientMembershipId ||
          v.partnerId ||
          v.partnerMembershipId ||
          v.assignmentId ||
          v.partnerName
        : !v.partnerId ||
          !v.partnerMembershipId ||
          !v.assignmentId ||
          !v.partnerName
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Client-managed provisioning requires a client administrator and no Partner records; Queen-managed provisioning requires explicit Partner identities.",
      });
  });
/** Operator-only command/service. Explicit stable IDs are the idempotency keys. No HTTP route. */
export async function provisionHvmClient(
  mongo: MongoService,
  raw: unknown,
  trustedIssuer: string,
) {
  const input = HvmProvisionInput.parse(raw);
  if (input.human.issuer !== trustedIssuer)
    throw new Error(
      "Provisioned human issuer must match configured Cognito pool",
    );
  if (!mongo.withTransaction) throw new Error("Transactions required");
  return mongo.withTransaction(async (db, session) => {
    const options = { session };
    const ledger = await db
      .collection("schema_versions")
      .findOne({ _id: "vapp-v1" } as Document, options);
    if (
      ![
        5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
        24, 25,
      ].includes(ledger?.version ?? 0)
    )
      throw new Error(
        "Provisioning requires reviewed/applied schema v5, v6, v7, v8 or v9",
      );
    if (
      input.management === "client" &&
      (await db
        .collection("workspace_partner_assignments")
        .findOne(
          {
            workspaceId: input.workspaceId,
            status: "active",
            archived: { $ne: true },
          },
          options,
        ))
    )
      throw new Error(
        "Use an authorized management transition for an assigned workspace",
      );
    const organisation = await db.collection("organisations").findOne(
      {
        id: input.organisationId,
        workspaceId: { $exists: false },
        archived: { $ne: true },
      },
      options,
    );
    if (!organisation && !input.organisationName)
      throw new Error(
        "Existing Organisation or explicit legal Organisation name required",
      );
    if (
      organisation &&
      input.organisationName &&
      organisation.name !== input.organisationName
    )
      throw new Error("Organisation name differs from reviewed input");
    if (
      !organisation &&
      (await db
        .collection("organisations")
        .findOne({ id: input.organisationId }, options))
    )
      throw new Error("Organisation is unavailable for provisioning");
    const now = new Date();
    const base = {
      createdAt: now,
      updatedAt: now,
      createdBy: input.human,
      updatedBy: input.human,
      source: { system: "hvm_client_provision" },
    };
    const created: string[] = [];
    async function ensure(
      collection: string,
      record: Document,
      identity: string[],
    ) {
      const existing = await db
        .collection(collection)
        .findOne({ id: record.id }, options);
      if (existing) {
        if (
          existing.archived ||
          identity.some(
            (key) =>
              JSON.stringify(existing[key]) !== JSON.stringify(record[key]),
          )
        )
          throw new Error(
            "Provisioning identity/state conflict; no records changed",
          );
        return;
      }
      await db.collection(collection).insertOne(record, options);
      created.push(record.id);
    }
    if (!organisation)
      await ensure(
        "organisations",
        OrganisationSchema.parse({
          ...base,
          id: input.organisationId,
          name: input.organisationName,
          type: "customer",
        }),
        ["name"],
      );
    if (input.management === "queen") {
      await ensure(
        "hvm_partners",
        HvmPartnerSchema.parse({
          ...base,
          id: input.partnerId,
          organisationId: input.organisationId,
          displayName: input.partnerName,
          status: "active",
        }),
        ["organisationId", "displayName", "status"],
      );
      await ensure(
        "hvm_partner_memberships",
        HvmPartnerMembershipSchema.parse({
          ...base,
          id: input.partnerMembershipId,
          partnerId: input.partnerId,
          human: input.human,
          role: "owner",
          status: "active",
          joinedAt: now,
          addedBy: input.human,
        }),
        ["partnerId", "human", "role", "status"],
      );
    }
    await ensure(
      "crm_workspaces",
      CrmWorkspaceSchema.parse({
        ...base,
        id: input.workspaceId,
        name: input.workspaceName,
        kind: "client",
        clientOrganisationId: input.organisationId,
      }),
      ["kind", "clientOrganisationId", "name"],
    );
    if (input.management === "queen") {
      await ensure(
        "workspace_partner_assignments",
        WorkspacePartnerAssignmentSchema.parse({
          ...base,
          id: input.assignmentId,
          workspaceId: input.workspaceId,
          partnerId: input.partnerId,
          role: "primary",
          status: "active",
          assignedAt: now,
          assignedBy: { type: "human", id: input.human.id },
        }),
        ["workspaceId", "partnerId", "role", "status"],
      );
    }
    await ensure(
      "brands",
      BrandSchema.parse({
        ...base,
        id: input.brandId,
        workspaceId: input.workspaceId,
        organisationId: input.organisationId,
        name: input.brandName,
        slug: input.brandSlug,
        primaryDomain: input.brandPrimaryDomain,
        status: "active",
      }),
      [
        "workspaceId",
        "organisationId",
        "name",
        "slug",
        "status",
        ...(input.brandPrimaryDomain === undefined ? [] : ["primaryDomain"]),
      ],
    );
    if (input.clientMembershipId)
      await ensure(
        "workspace_memberships",
        WorkspaceMembershipSchema.parse({
          ...base,
          id: input.clientMembershipId,
          workspaceId: input.workspaceId,
          human: input.human,
          role: "admin",
          status: "active",
          joinedAt: now,
          addedBy: input.human,
        }),
        ["workspaceId", "human", "role", "status"],
      );
    if (created.length)
      await db.collection("events").insertOne(
        EventSchema.parse({
          ...base,
          id: generatePlatformId("event"),
          workspaceId: input.workspaceId,
          eventType: "hvm_client_provisioned",
          occurredAt: now,
          payload: {
            application: "system",
            human: input.human,
            createdIds: created,
          },
        }),
        options,
      );
    return {
      workspaceId: input.workspaceId,
      partnerId: input.partnerId,
      brandId: input.brandId,
      createdIds: created,
    };
  });
}
