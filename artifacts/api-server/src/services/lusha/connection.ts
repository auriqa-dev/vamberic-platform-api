import { z } from "zod";
import { logger } from "../../lib/logger";
import type { Db, ClientSession } from "mongodb";
import type { AppConfig } from "../../config";
import type { AuthenticatedUser } from "../../middlewares/auth";
import type { MongoService } from "../mongo";
import { resolveHvmContext } from "../hvm-context";
import { AuthorizationDenied } from "../../authorization/policy";
import {
  EventSchema,
  WorkspaceIntegrationSchema,
  generatePlatformId,
  platformIdSchema,
} from "../../domain";
import { lockIcpWorkspace } from "../icp/access";
import { HiveConflict } from "../hive-definitions";
import { createLushaProvider, type LushaProvider } from "./provider";
import { createLushaSecrets, type LushaSecrets } from "./secrets";
export const lushaPermissions = z
  .object({
    research: z.boolean(),
    discovery: z.boolean(),
    enrichment: z.boolean(),
  })
  .strict();
export async function lushaAccess(
  db: Db,
  config: AppConfig,
  identity: AuthenticatedUser,
  w: string,
  action: "read" | "update",
  session?: ClientSession,
) {
  platformIdSchema("workspace").parse(w);
  const r = await resolveHvmContext(db, config, identity, session);
  if (r.context.application !== "hvmapp" || r.context.actor.type !== "human")
    throw new AuthorizationDenied();
  r.authority.scopeFilter(r.context, action, {
    type: "workspace_integrations",
    workspaceId: w,
  });
  return r.context.actor;
}
export async function lushaCatalogue(db: Db, session?: ClientSession) {
  const providers = await db
    .collection("integration_providers")
    .find({ key: "lusha", archived: { $ne: true } }, { session })
    .sort({ version: -1 })
    .limit(1)
    .toArray();
  if (
    providers.length !== 1 ||
    providers[0]!.status !== "active" ||
    providers[0]!.availability !== "queens"
  )
    throw new HiveConflict(
      "Publish the current Lusha provider in Empress first.",
    );
  return providers[0]!;
}
export function createLushaConnection(
  config: AppConfig,
  mongo: MongoService,
  provider: LushaProvider = createLushaProvider(),
  secrets: LushaSecrets | undefined = createLushaSecrets(),
) {
  async function read(identity: AuthenticatedUser, w: string) {
    const db = await mongo.database();
    await lushaAccess(db, config, identity, w, "read");
    const rows = await db
      .collection("workspace_integrations")
      .find({ workspaceId: w, provider: "lusha", archived: { $ne: true } })
      .sort({ updatedAt: -1 })
      .limit(20)
      .toArray();
    const row = rows.find((r) => r.status === "connected") ?? rows[0];
    const usage = await db
      .collection("events")
      .findOne(
        { workspaceId: w, eventType: "lusha_connection_test" },
        { sort: { createdAt: -1 } },
      );
    let canManage = true;
    try {
      await lushaAccess(db, config, identity, w, "update");
    } catch (e) {
      if (e instanceof AuthorizationDenied) canManage = false;
      else throw e;
    }
    const lookups = await db
      .collection("events")
      .find({ workspaceId: w, eventType: "lusha_lookup" })
      .sort({ createdAt: -1 })
      .limit(1001)
      .toArray();
    return {
      canManage,
      usage: {
        recordedCredits: lookups
          .slice(0, 1000)
          .reduce(
            (sum, e) =>
              sum +
              (typeof e.payload.creditsCharged === "number"
                ? e.payload.creditsCharged
                : 0),
            0,
          ),
        uncertainLookups: lookups
          .slice(0, 1000)
          .filter(
            (e) =>
              e.payload.creditsCharged === null ||
              e.payload.chargeUnknown ||
              e.payload.status !== "completed",
          ).length,
        limited: lookups.length > 1000,
      },
      available: Boolean(secrets),
      id: row?.id ?? null,
      updatedAt: row?.updatedAt?.toISOString() ?? null,
      status: row?.status ?? "not_connected",
      permissions: {
        research: row?.scopes?.includes("research") ?? false,
        discovery: row?.scopes?.includes("discovery") ?? false,
        enrichment: row?.scopes?.includes("enrichment") ?? false,
      },
      credits:
        usage?.payload?.integrationId === row?.id
          ? (usage?.payload?.credits ?? null)
          : null,
      lastTestedAt:
        usage?.payload?.integrationId === row?.id
          ? (usage?.createdAt?.toISOString() ?? null)
          : null,
      capabilitiesVerified: false,
    };
  }
  async function active(
    identity: AuthenticatedUser,
    w: string,
    capability: "discovery" | "enrichment",
  ) {
    const db = await mongo.database();
    await lushaAccess(db, config, identity, w, "update");
    const catalogue = await lushaCatalogue(db);
    const required =
      capability === "enrichment"
        ? ["lusha_person_search", "lusha_email_enrichment"]
        : ["lusha_supplementary_discovery"];
    if (
      !required.every((c) =>
        catalogue.data?.operationalCapabilities?.includes(c),
      )
    )
      throw new HiveConflict(
        "Publish the required Lusha capabilities in Empress first.",
      );
    const rows = await db
      .collection("workspace_integrations")
      .find({
        workspaceId: w,
        provider: "lusha",
        status: "connected",
        archived: { $ne: true },
      })
      .limit(2)
      .toArray();
    const row = rows[0];
    if (
      !secrets ||
      rows.length !== 1 ||
      !row?.secretReference ||
      !row.scopes.includes("research") ||
      !row.scopes.includes(capability)
    )
      throw new HiveConflict(
        "Connect Lusha and allow this Research operation first.",
      );
    return { row, key: await secrets.read(w, row.secretReference) };
  }
  return {
    read,
    active,
    async connect(identity: AuthenticatedUser, w: string, raw: unknown) {
      const input = z
        .object({
          apiKey: z.string().trim().min(8).max(2048),
          expectedUpdatedAt: z.string().datetime().nullable(),
          permissions: lushaPermissions,
        })
        .strict()
        .parse(raw);
      const db = await mongo.database();
      await lushaAccess(db, config, identity, w, "update");
      await lushaCatalogue(db);
      if (!secrets || !mongo.withTransaction)
        throw new HiveConflict("Secure connection storage is not enabled.");
      const usage = await provider.usage(input.apiKey); // Test is explicit in the connect action; no person lookup.
      const reference = await secrets.create(w, input.apiKey);
      let previousReference: string | undefined;
      try {
        await mongo.withTransaction(async (db, session) => {
          const actor = await lushaAccess(
            db,
            config,
            identity,
            w,
            "update",
            session,
          );
          await lushaCatalogue(db, session);
          const now = await lockIcpWorkspace(db, w, session);
          const rows = await db
            .collection("workspace_integrations")
            .find(
              { workspaceId: w, provider: "lusha", archived: { $ne: true } },
              { session },
            )
            .sort({ updatedAt: -1 })
            .limit(20)
            .toArray();
          const row = rows.find((r) => r.status === "connected") ?? rows[0];
          if (
            (row?.updatedAt?.toISOString() ?? null) !== input.expectedUpdatedAt
          )
            throw new HiveConflict(
              "Connection changed. Refresh before replacing it.",
            );
          previousReference = row?.secretReference;
          const record = WorkspaceIntegrationSchema.parse({
            ...Object.fromEntries(Object.entries(row ?? {}).filter(([key]) => !["_id", "disconnectedAt", "lastSyncAt", "lastSuccessfulSyncAt", "errorCode"].includes(key))),
            id: row?.id ?? generatePlatformId("integration"),
            workspaceId: w,
            provider: "lusha",
            displayName: "Lusha",
            createdAt: row?.createdAt ?? now,
            createdBy: row?.createdBy ?? actor,
            updatedAt: now,
            updatedBy: actor,
            status: "connected",
            connectedAt: now,
            connectedBy: actor,
            secretReference: reference,
            scopes: Object.entries(input.permissions)
              .filter(([, v]) => v)
              .map(([k]) => k),
          });
          if (row)
            await db
              .collection("workspace_integrations")
              .replaceOne({ id: row.id, workspaceId: w }, record, { session });
          else
            await db
              .collection("workspace_integrations")
              .insertOne(record, { session });
          await db.collection("events").insertOne(
            EventSchema.parse({
              id: generatePlatformId("event"),
              workspaceId: w,
              eventType: "lusha_connection_test",
              occurredAt: now,
              createdAt: now,
              updatedAt: now,
              createdBy: actor,
              updatedBy: actor,
              payload: {
                integrationId: record.id,
                credits: usage.credits ?? null,
                previousSecretReference: row?.secretReference ?? null,
              },
            }),
            { session },
          );
        });
      } catch (e) {
        await secrets
          .remove(w, reference)
          .catch(() =>
            logger.warn(
              { workspaceId: w, secretReference: reference },
              "Unused Lusha credential requires recovery cleanup",
            ),
          );
        throw e;
      }
      if (previousReference && previousReference !== reference)
        await secrets
          .remove(w, previousReference)
          .catch(() =>
            logger.warn(
              { workspaceId: w, secretReference: previousReference },
              "Replaced Lusha credential requires recovery cleanup",
            ),
          );
      return read(identity, w);
    },
    async update(identity: AuthenticatedUser, w: string, raw: unknown) {
      const input = z
        .object({
          expectedUpdatedAt: z.string().datetime(),
          permissions: lushaPermissions,
          disconnect: z.boolean().default(false),
        })
        .strict()
        .parse(raw);
      if (!mongo.withTransaction) throw new Error("Transactions required");
      await mongo.withTransaction(async (db, session) => {
        const actor = await lushaAccess(
            db,
            config,
            identity,
            w,
            "update",
            session,
          ),
          now = await lockIcpWorkspace(db, w, session);
        const row = await db.collection("workspace_integrations").findOne(
          {
            workspaceId: w,
            provider: "lusha",
            archived: { $ne: true },
            updatedAt: new Date(input.expectedUpdatedAt),
          },
          { session },
        );
        if (!row)
          throw new HiveConflict("Connection changed. Refresh and try again.");
        await db.collection("workspace_integrations").updateOne(
          { id: row.id, workspaceId: w },
          {
            $set: {
              scopes: input.disconnect
                ? []
                : Object.entries(input.permissions)
                    .filter(([, v]) => v)
                    .map(([k]) => k),
              updatedAt: now,
              updatedBy: actor,
              ...(input.disconnect
                ? { status: "disconnected", disconnectedAt: now }
                : {}),
            },
          },
          { session },
        );
      });
      return read(identity, w);
    },
    async test(identity: AuthenticatedUser, w: string) {
      const db = await mongo.database();
      await lushaAccess(db, config, identity, w, "update");
      const row = await db.collection("workspace_integrations").findOne({
        workspaceId: w,
        provider: "lusha",
        status: "connected",
        archived: { $ne: true },
      });
      if (!secrets || !row?.secretReference)
        throw new HiveConflict("Connect Lusha first.");
      const usage = await provider.usage(
        await secrets.read(w, row.secretReference),
      );
      const now = new Date();
      await db.collection("events").insertOne(
        EventSchema.parse({
          id: generatePlatformId("event"),
          workspaceId: w,
          eventType: "lusha_connection_test",
          createdAt: now,
          updatedAt: now,
          occurredAt: now,
          payload: { integrationId: row.id, credits: usage.credits ?? null },
        }),
      );
      return read(identity, w);
    },
  };
}
