import { onboardingWebsiteDomain } from "./onboarding-brand-domain";
import type { Db, ClientSession, Document } from "mongodb";
import { digest } from "@workspace/agent-runtime-protocol";
import type { AppConfig } from "../config";
import type { AuthenticatedUser } from "../middlewares/auth";
import type { MongoService } from "./mongo";
import { AuthorizationDenied } from "../authorization/policy";
import { lockAuthorityDocument } from "./agent-authority-serialization";
import { withoutMongoId } from "./hvm-context";
import {
  HvmPartnerSchema,
  HvmPartnerMembershipSchema,
  EventSchema,
  generatePlatformId,
  platformIdSchema,
} from "../domain";
import {
  ClientOnboardingSchema,
  OnboardingRequestSchema,
  onboardingBinding,
  preclientWorkspaceExemption,
  type ClientOnboarding,
} from "../domain/client-onboarding";
import { queenClientBase } from "./hvm-queen-provision";
export class OnboardingConflict extends Error {}
export const ONBOARDING_EVENT = "client_onboarding_changed";
const collection = "client_onboardings";
type Actor = { type: "human"; id: string; issuer: string };
function human(config: AppConfig, user: AuthenticatedUser): Actor {
  if (
    !config.cognito.hvmClientId ||
    user.clientId !== config.cognito.hvmClientId ||
    user.issuer !== config.cognito.issuer
  )
    throw new AuthorizationDenied();
  return { type: "human", id: user.subject, issuer: user.issuer };
}
async function schema(db: Db, session?: ClientSession) {
  const ledger = await db
    .collection("schema_versions")
    .findOne({ _id: "vapp-v1" } as Document, { session });
  if (![21, 22, 23, 24, 25].includes(ledger?.version ?? 0))
    throw new OnboardingConflict("Onboarding requires schema 21");
}
async function owner(
  db: Db,
  partnerId: string,
  actor: Actor,
  session?: ClientSession,
) {
  platformIdSchema("partner").parse(partnerId);
  const membership = await db.collection("hvm_partner_memberships").findOne(
    {
      partnerId,
      "human.id": actor.id,
      "human.issuer": actor.issuer,
      "human.type": "human",
      role: "owner",
      status: "active",
      archived: { $ne: true },
    },
    { session },
  );
  if (!membership) throw new AuthorizationDenied();
  const p = session
    ? await lockAuthorityDocument(
        db,
        { collection: "hvm_partners", id: partnerId },
        session,
      )
    : await db.collection("hvm_partners").findOne({ id: partnerId });
  const m = session
    ? await lockAuthorityDocument(
        db,
        { collection: "hvm_partner_memberships", id: membership.id },
        session,
      )
    : membership;
  const partner = HvmPartnerSchema.parse(withoutMongoId(p!)),
    member = HvmPartnerMembershipSchema.parse(withoutMongoId(m));
  if (
    partner.status !== "active" ||
    partner.archived ||
    member.status !== "active" ||
    member.archived ||
    member.role !== "owner" ||
    member.partnerId !== partnerId ||
    member.human.id !== actor.id ||
    member.human.issuer !== actor.issuer
  )
    throw new AuthorizationDenied();
}
function empress(config: AppConfig, actor: Actor) {
  if (
    actor.issuer !== config.cognito.issuer ||
    !config.empressSubjects?.includes(actor.id)
  )
    throw new AuthorizationDenied();
}
function parse(raw: Document) {
  return ClientOnboardingSchema.parse(
    Object.fromEntries(Object.entries(raw).filter(([k]) => k !== "_id")),
  );
}
// Query is scoped before data retrieval. Empress gets governance data, never a workspace grant.
export async function listClientOnboardings(
  mongo: MongoService,
  config: AppConfig,
  user: AuthenticatedUser,
  partnerId?: string,
  after?: string,
) {
  const actor = human(config, user),
    db = await mongo.database();
  await schema(db);
  if (partnerId) await owner(db, partnerId, actor);
  else empress(config, actor);
  if (after) platformIdSchema("clientonboarding").parse(after);
  const rows = await db
    .collection(collection)
    .find({
      ...(partnerId ? { partnerId } : {}),
      ...(after ? { id: { $gt: after } } : {}),
    })
    .sort({ id: 1 })
    .limit(51)
    .toArray();
  return {
    items: rows.slice(0, 50).map(parse),
    next: rows.length > 50 ? rows[49]!.id : null,
  };
}
export async function mutateClientOnboarding(
  mongo: MongoService,
  config: AppConfig,
  user: AuthenticatedUser,
  partnerId: string | undefined,
  id: string | undefined,
  raw: unknown,
) {
  const body = OnboardingRequestSchema.parse(raw),
    actor = human(config, user);
  if (id) platformIdSchema("clientonboarding").parse(id);
  if (!mongo.withTransaction)
    throw new OnboardingConflict("Transaction required");
  return mongo.withTransaction(async (db, session) => {
    await schema(db, session);
    if (partnerId) {
      await owner(db, partnerId, actor, session);
      if (!["save", "provision"].includes(body.action))
        throw new AuthorizationDenied();
    } else {
      empress(config, actor);
      if (!["approve", "revoke"].includes(body.action))
        throw new AuthorizationDenied();
    }
    const createScope = digest({
      actor,
      partnerId: partnerId ?? null,
      requestKey: body.requestKey,
    });
    const row = await db
      .collection(collection)
      .findOne(
        id ? { id, ...(partnerId ? { partnerId } : {}) } : { createScope },
        { session },
      );
    const requestDigest = digest(body);
    if (!id && row && row.createDigest !== requestDigest)
      throw new OnboardingConflict("Request key reused");
    if (
      !row &&
      (id ||
        !partnerId ||
        body.action !== "save" ||
        body.expectedRevision !== 0)
    )
      throw new AuthorizationDenied();
    let record: ClientOnboarding;
    const now = new Date();
    if (!row) {
      const newId = generatePlatformId("clientonboarding");
      record = ClientOnboardingSchema.parse({
        id: newId,
        partnerId,
        createScope,
        createDigest: requestDigest,
        revision: 1,
        executionSerial: 0,
        details: body.details,
        ...onboardingBinding(newId, partnerId!, 1, body.details!),
        createdBy: actor,
        createdAt: now,
        updatedAt: now,
      });
      // Mongo adds _id to its input. Keep storage metadata out of the API record.
      await db.collection(collection).insertOne({ ...record }, { session });
    } else {
      record = parse(row);
      // Every mutation and replay serializes against revocation and competing decisions.
      const locked = await db.collection(collection).updateOne(
        {
          id: record.id,
          revision: record.revision,
          executionSerial: record.executionSerial,
        },
        { $inc: { executionSerial: 1 } },
        { session },
      );
      if (locked.matchedCount !== 1)
        throw new OnboardingConflict("Onboarding changed");
      record.executionSerial++;
    }
    const scope = digest({
      actor,
      onboardingId: record.id,
      requestKey: body.requestKey,
    });
    const previous = await db
      .collection("events")
      .findOne(
        { eventType: ONBOARDING_EVENT, "payload.scope": scope },
        { session },
      );
    if (previous) {
      if (previous.payload?.requestDigest !== requestDigest)
        throw new OnboardingConflict("Request key reused");
      if (record.result && partnerId)
        await verifyProvisioned(db, record, session);
      return record;
    }
    if (row) {
      if (record.revision !== body.expectedRevision)
        throw new OnboardingConflict("Onboarding revision changed");
      if (record.result)
        throw new OnboardingConflict(
          "Use workspace billing governance after provisioning",
        );
      const prior = record;
      record = { ...record, revision: record.revision + 1, updatedAt: now };
      if (body.action === "save") {
        const { approval: _approval, ...rest } = record;
        void _approval;
        record = {
          ...rest,
          details: body.details!,
          ...onboardingBinding(
            record.id,
            record.partnerId,
            record.revision,
            body.details!,
          ),
        };
      } else if (body.action === "approve") {
        record.approval = {
          version: 1,
          revision: record.revision,
          status: "active",
          binding: record.binding,
          treatment: "internal",
          scope: record.proposal.scope,
          reason: body.reason!,
          approvedBy: actor,
          approvedAt: now,
        };
      } else if (body.action === "revoke") {
        if (record.approval?.status !== "active")
          throw new OnboardingConflict("Active approval required");
        record.approval = {
          ...record.approval,
          revision: record.revision,
          status: "revoked",
        };
      } else {
        const expected = onboardingBinding(
          record.id,
          record.partnerId,
          record.binding.intakeRevision,
          record.details,
        );
        if (
          digest(expected.binding) !== digest(record.binding) ||
          digest(expected.proposal) !== digest(record.proposal)
        )
          throw new OnboardingConflict("Binding mismatch");
        if (!record.approval)
          throw new OnboardingConflict("Exemption approval required");
        empress(config, record.approval.approvedBy);
        let exemption;
        try {
          exemption = preclientWorkspaceExemption(
            record.approval,
            record.binding,
            now,
          );
        } catch {
          throw new OnboardingConflict("Approval revoked or changed");
        }
        const { result, records } = queenClientBase(
          {
            requestKey: body.requestKey,
            organisationName: record.details.intake.organisationName,
            workspaceName: record.details.workspaceName,
            brandName: record.details.brandName,
            brandSlug: record.details.brandSlug,
            brandPrimaryDomain: onboardingWebsiteDomain(
              record.details.intake.websiteUrl,
            ),
          },
          record.partnerId,
          actor,
          now,
          exemption,
        );
        for (const [name, document] of records)
          await db.collection(name).insertOne(document, { session });
        record.result = result;
      }
      record = ClientOnboardingSchema.parse(record);
      const update = await db.collection(collection).updateOne(
        {
          id: record.id,
          revision: prior.revision,
          executionSerial: record.executionSerial,
        },
        {
          $set: record,
          ...(body.action === "save" ? { $unset: { approval: "" } } : {}),
        },
        { session },
      );
      if (update.matchedCount !== 1)
        throw new OnboardingConflict("Onboarding changed");
    }
    // Full immutable snapshots tie declarations, exact approval and canonical identities together.
    await db.collection("events").insertOne(
      EventSchema.parse({
        id: generatePlatformId("event"),
        createdAt: now,
        updatedAt: now,
        createdBy: actor,
        updatedBy: actor,
        source: { system: ONBOARDING_EVENT },
        eventType: ONBOARDING_EVENT,
        occurredAt: now,
        ...(record.result ? { workspaceId: record.result.workspaceId } : {}),
        payload: {
          scope,
          requestDigest,
          action: body.action,
          reason: body.reason ?? null,
          snapshot: record,
        },
      }),
      { session },
    );
    return record;
  });
}
async function verifyProvisioned(
  db: Db,
  record: ClientOnboarding,
  session: ClientSession,
) {
  const assignment = await db
    .collection("workspace_partner_assignments")
    .findOne(
      {
        workspaceId: record.result!.workspaceId,
        partnerId: record.partnerId,
        status: "active",
        archived: { $ne: true },
      },
      { session },
    );
  const workspace = await db.collection("crm_workspaces").findOne(
    {
      id: record.result!.workspaceId,
      kind: "client",
      archived: { $ne: true },
    },
    { session },
  );
  if (!assignment || !workspace) throw new AuthorizationDenied();
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
}
