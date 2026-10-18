import { z } from "zod";
import type { Db, ClientSession } from "mongodb";
import type { AppConfig } from "../../config";
import type { AuthenticatedUser } from "../../middlewares/auth";
import type { MongoService } from "../mongo";
import {
  EventSchema,
  WorkspaceIntegrationSchema,
  generatePlatformId,
} from "../../domain";
import { lushaAccess as integrationAccess } from "../lusha/connection";
import { AuthorizationDenied } from "../../authorization/policy";
import { lockIcpWorkspace } from "../icp/access";
import { HiveConflict } from "../hive-definitions";
import { logger } from "../../lib/logger";
import {
  createOAuthAttempt,
  oauthHash,
  validOAuthAttempt,
} from "../mailbox/oauth-state";
import { ga4Secrets, type Ga4Secrets } from "./secrets";
import {
  googleAnalytics,
  ga4Tokens,
  propertyId,
  GA4_SCOPE,
  Ga4Error,
} from "./google";
const bindingInput = z.object({
  state: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  browserSecret: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
const versionInput = z
  .object({ expectedUpdatedAt: z.string().datetime().nullable() })
  .strict();
function event(w: string, eventType: string, payload: Record<string, unknown>) {
  const now = new Date();
  return EventSchema.parse({
    id: generatePlatformId("event"),
    workspaceId: w,
    eventType,
    occurredAt: now,
    createdAt: now,
    updatedAt: now,
    payload,
  });
}
export function createGa4Application(
  config: AppConfig,
  mongo: MongoService,
  secrets: Ga4Secrets | undefined = ga4Secrets(),
  makeProvider = googleAnalytics,
) {
  async function row(db: Db, w: string, session?: ClientSession) {
    const rows = await db
      .collection("workspace_integrations")
      .find(
        { workspaceId: w, provider: "ga4", archived: { $ne: true } },
        { session },
      )
      .limit(2)
      .toArray();
    if (rows.length > 1)
      throw new HiveConflict(
        "Multiple GA4 records need administrator reconciliation before connecting a property.",
      );
    return rows[0] ?? null;
  }
  async function access(
    identity: AuthenticatedUser,
    w: string,
    action: "read" | "update",
  ) {
    const db = await mongo.database();
    await integrationAccess(db, config, identity, w, action);
    return db;
  }
  function enabled() {
    if (!secrets || !mongo.withTransaction)
      throw new Ga4Error(
        "SETUP_REQUIRED",
        "HVM’s Google Analytics connection is not enabled in this environment yet.",
      );
    return secrets;
  }
  async function cleanup(w: string, reference: string) {
    try {
      await enabled().remove(w, reference);
    } catch {
      logger.warn({ workspaceId: w }, "GA4 credential cleanup requires retry");
      await (
        await mongo.database()
      )
        .collection("events")
        .insertOne(event(w, "ga4_cleanup", { reference, completed: false }));
    }
  }
  async function read(identity: AuthenticatedUser, w: string) {
    const db = await access(identity, w, "read"),
      r = await row(db, w);
    let canManage = true;
    try {
      await integrationAccess(db, config, identity, w, "update");
    } catch (e) {
      if (e instanceof AuthorizationDenied) canManage = false;
      else throw e;
    }
    const check =
      r?.status === "connected"
        ? await db.collection("events").findOne(
            {
              workspaceId: w,
              eventType: "ga4_verified",
              "payload.integrationId": r.id,
              "payload.connectionVersion": r.connectedAt.toISOString(),
            },
            { sort: { createdAt: -1 } },
          )
        : null;
    return {
      available: Boolean(secrets && mongo.withTransaction),
      canManage,
      status:
        r?.status === "connected" && r.errorCode
          ? "needs_attention"
          : (r?.status ?? "not_connected"),
      updatedAt: r?.updatedAt.toISOString() ?? null,
      property:
        r?.status === "connected"
          ? {
              name: r.externalAccountId,
              displayName: r.displayName,
              timeZone: check?.payload.timeZone ?? null,
              currencyCode: check?.payload.currencyCode ?? null,
            }
          : null,
      lastCheckedAt: r?.lastSuccessfulSyncAt?.toISOString() ?? null,
      hasReportRows: check?.payload.hasReportRows ?? null,
    };
  }
  async function attempt(
    db: Db,
    identity: AuthenticatedUser,
    w: string,
    input: z.infer<typeof bindingInput>,
    phase: string,
  ) {
    const a = await db.collection("events").findOne({
      workspaceId: w,
      eventType: "ga4_oauth",
      "payload.stateHash": oauthHash(input.state),
      "payload.phase": phase,
    });
    if (
      !a ||
      !validOAuthAttempt(
        {
          ...a.payload,
          expiresAt: new Date(a.payload.expiresAt),
        } as Parameters<typeof validOAuthAttempt>[0],
        { ...identity, workspaceId: w, provider: "ga4" },
        input.state,
        input.browserSecret,
      )
    )
      throw new Ga4Error(
        "OAUTH_EXPIRED",
        "This connection request expired or was already used. Connect GA4 again.",
      );
    return a;
  }
  async function tokens(w: string, reference: string) {
    const storage = enabled(),
      client = makeProvider(await storage.config());
    let value = ga4Tokens.parse(await storage.read(w, reference));
    if (!value.scopes.includes(GA4_SCOPE))
      throw new Ga4Error(
        "CONSENT_REQUIRED",
        "Connect GA4 again with read-only Analytics access.",
      );
    if (value.expiresAt < Date.now() + 60000)
      value = await client.refresh(value);
    return { client, value };
  }
  async function begin(identity: AuthenticatedUser, w: string, raw: unknown) {
    const input = versionInput.parse(raw),
      db = await access(identity, w, "update"),
      storage = enabled();
    const previous = await row(db, w);
    if ((previous?.updatedAt.toISOString() ?? null) !== input.expectedUpdatedAt)
      throw new HiveConflict(
        "Connection changed. Refresh before reconnecting.",
      );
    // Retry abandoned temporary credentials and recorded cleanup on the next authorised connection attempt.
    const expired = await db
      .collection("events")
      .find({
        workspaceId: w,
        eventType: "ga4_oauth",
        "payload.expiresAt": { $lt: new Date().toISOString() },
        "payload.cleaned": false,
      })
      .limit(20)
      .toArray();
    for (const old of expired) {
      await cleanup(w, old.payload.reference);
      await db
        .collection("events")
        .updateOne(
          { id: old.id, workspaceId: w },
          { $set: { "payload.cleaned": true } },
        );
    }
    const pending = await db
      .collection("events")
      .find({
        workspaceId: w,
        eventType: "ga4_cleanup",
        "payload.completed": false,
      })
      .limit(20)
      .toArray();
    for (const old of pending) {
      try {
        await storage.remove(w, old.payload.reference);
        await db
          .collection("events")
          .updateOne(
            { id: old.id, workspaceId: w },
            { $set: { "payload.completed": true } },
          );
      } catch {
        /* Retain retry evidence. */
      }
    }
    const client = makeProvider(await storage.config()),
      a = createOAuthAttempt({ ...identity, workspaceId: w, provider: "ga4" });
    const reference = await storage.create(w, { verifier: a.verifier });
    try {
      await db.collection("events").insertOne(
        event(w, "ga4_oauth", {
          ...a.record,
          expiresAt: a.record.expiresAt.toISOString(),
          reference,
          phase: "authorising",
          cleaned: false,
          expectedUpdatedAt: input.expectedUpdatedAt,
        }),
      );
    } catch (e) {
      await cleanup(w, reference);
      throw e;
    }
    return {
      url: client.authorise(a.state, a.challenge),
      state: a.state,
      browserSecret: a.browserSecret,
    };
  }
  async function finish(identity: AuthenticatedUser, w: string, raw: unknown) {
    const input = bindingInput
        .extend({ code: z.string().min(1).max(4096) })
        .strict()
        .parse(raw),
      db = await access(identity, w, "update"),
      storage = enabled();
    const a = await attempt(db, identity, w, input, "authorising");
    const consumed = await db
      .collection("events")
      .updateOne(
        { id: a.id, workspaceId: w, "payload.phase": "authorising" },
        { $set: { "payload.phase": "exchanging" } },
      );
    if (consumed.matchedCount !== 1)
      throw new HiveConflict(
        "Google sign-in has already been used. Connect again.",
      );
    try {
      const { verifier } = z
        .object({ verifier: z.string() })
        .parse(await storage.read(w, a.payload.reference));
      const client = makeProvider(await storage.config()),
        value = await client.exchange(input.code, verifier);
      await storage.write(w, a.payload.reference, value);
      await db
        .collection("events")
        .updateOne(
          { id: a.id, workspaceId: w },
          { $set: { "payload.phase": "selecting" } },
        );
      return await client.properties(value.accessToken);
    } catch (e) {
      await cleanup(w, a.payload.reference);
      throw e;
    }
  }
  async function properties(
    identity: AuthenticatedUser,
    w: string,
    raw: unknown,
  ) {
    const input = bindingInput
        .extend({ pageToken: z.string().max(4096).default("") })
        .strict()
        .parse(raw),
      db = await access(identity, w, "update");
    const a = await attempt(db, identity, w, input, "selecting"),
      { client, value } = await tokens(w, a.payload.reference);
    return client.properties(value.accessToken, input.pageToken);
  }
  async function select(identity: AuthenticatedUser, w: string, raw: unknown) {
    const input = bindingInput
        .extend({ property: propertyId })
        .strict()
        .parse(raw),
      db = await access(identity, w, "update"),
      storage = enabled();
    const a = await attempt(db, identity, w, input, "selecting"),
      { client, value } = await tokens(w, a.payload.reference);
    const verified = await client.verify(value.accessToken, input.property);
    const reference = await storage.create(w, value);
    let previousReference: string | undefined;
    try {
      await mongo.withTransaction!(async (tx, session) => {
        const actor = await integrationAccess(
            tx,
            config,
            identity,
            w,
            "update",
            session,
          ),
          now = await lockIcpWorkspace(tx, w, session),
          previous = await row(tx, w, session);
        if (
          (previous?.updatedAt.toISOString() ?? null) !==
          a.payload.expectedUpdatedAt
        )
          throw new HiveConflict(
            "Connection changed during sign-in. Refresh and connect again.",
          );
        const used = await tx.collection("events").updateOne(
          {
            id: a.id,
            workspaceId: w,
            "payload.phase": "selecting",
            "payload.expiresAt": { $gt: now.toISOString() },
          },
          { $set: { "payload.phase": "saved", updatedAt: now } },
          { session },
        );
        if (used.matchedCount !== 1)
          throw new HiveConflict(
            "Connection request expired or was already saved. Refresh its status.",
          );
        const record = WorkspaceIntegrationSchema.parse({
          id: previous?.id ?? generatePlatformId("integration"),
          workspaceId: w,
          provider: "ga4",
          displayName: verified.displayName,
          externalAccountId: verified.name,
          createdAt: previous?.createdAt ?? now,
          createdBy: previous?.createdBy ?? actor,
          updatedAt: now,
          updatedBy: actor,
          status: "connected",
          connectedAt: now,
          connectedBy: actor,
          secretReference: reference,
          scopes: [GA4_SCOPE],
          lastSyncAt: now,
          lastSuccessfulSyncAt: now,
        });
        if (previous)
          await tx
            .collection("workspace_integrations")
            .replaceOne({ id: previous.id, workspaceId: w }, record, {
              session,
            });
        else
          await tx
            .collection("workspace_integrations")
            .insertOne(record, { session });
        await tx.collection("events").insertOne(
          event(w, "ga4_verified", {
            ...verified,
            integrationId: record.id,
            connectionVersion: now.toISOString(),
          }),
          { session },
        );
        previousReference = previous?.secretReference;
      });
    } catch (e) {
      // If the commit outcome is uncertain, retain any credential actually referenced by the saved connection.
      const saved = await row(db, w);
      if (saved?.secretReference !== reference) await cleanup(w, reference);
      throw e;
    }
    await cleanup(w, a.payload.reference);
    if (previousReference) await cleanup(w, previousReference);
    return read(identity, w);
  }
  async function test(identity: AuthenticatedUser, w: string, raw: unknown) {
    const input = versionInput.parse(raw),
      db = await access(identity, w, "update"),
      r = await row(db, w);
    if (r?.status !== "connected" || !r.secretReference)
      throw new Ga4Error("NOT_CONNECTED", "Connect a GA4 property first.");
    if (r.updatedAt.toISOString() !== input.expectedUpdatedAt)
      throw new HiveConflict("Connection changed. Refresh and retry.");
    let verified: Awaited<
      ReturnType<ReturnType<typeof googleAnalytics>["verify"]>
    >;
    try {
      const { client, value } = await tokens(w, r.secretReference);
      verified = await client.verify(value.accessToken, r.externalAccountId);
    } catch (e) {
      if (
        e instanceof Ga4Error &&
        ["RECONNECT_REQUIRED", "ACCESS_DENIED", "CONSENT_REQUIRED"].includes(
          e.code,
        )
      ) {
        await mongo.withTransaction!(async (tx, session) => {
          await integrationAccess(tx, config, identity, w, "update", session);
          const now = await lockIcpWorkspace(tx, w, session);
          await tx
            .collection("workspace_integrations")
            .updateOne(
              {
                workspaceId: w,
                id: r.id,
                updatedAt: r.updatedAt,
                status: "connected",
              },
              { $set: { errorCode: e.code, updatedAt: now, lastSyncAt: now } },
              { session },
            );
        });
      }
      throw e;
    }
    await mongo.withTransaction!(async (tx, session) => {
      await integrationAccess(tx, config, identity, w, "update", session);
      const now = await lockIcpWorkspace(tx, w, session);
      const updated = await tx.collection("workspace_integrations").updateOne(
        {
          workspaceId: w,
          id: r.id,
          updatedAt: r.updatedAt,
          status: "connected",
        },
        {
          $set: {
            updatedAt: now,
            lastSyncAt: now,
            lastSuccessfulSyncAt: now,
          },
          $unset: { errorCode: "" },
        },
        { session },
      );
      if (updated.matchedCount !== 1)
        throw new HiveConflict(
          "Connection changed during the test. Refresh its status.",
        );
      await tx.collection("events").insertOne(
        event(w, "ga4_verified", {
          ...verified,
          integrationId: r.id,
          connectionVersion: r.connectedAt.toISOString(),
        }),
        { session },
      );
    });
    return read(identity, w);
  }
  async function disconnect(
    identity: AuthenticatedUser,
    w: string,
    raw: unknown,
  ) {
    const input = versionInput.parse(raw);
    await access(identity, w, "update");
    enabled();
    let reference: string | undefined;
    await mongo.withTransaction!(async (db, session) => {
      const actor = await integrationAccess(
          db,
          config,
          identity,
          w,
          "update",
          session,
        ),
        now = await lockIcpWorkspace(db, w, session),
        r = await row(db, w, session);
      if (!r || r.updatedAt.toISOString() !== input.expectedUpdatedAt)
        throw new HiveConflict("Connection changed. Refresh and try again.");
      reference = r.secretReference;
      await db.collection("workspace_integrations").updateOne(
        { id: r.id, workspaceId: w },
        {
          $set: {
            status: "disconnected",
            disconnectedAt: now,
            updatedAt: now,
            updatedBy: actor,
            scopes: [],
          },
          $unset: { secretReference: "" },
        },
        { session },
      );
    });
    if (reference) await cleanup(w, reference);
    return read(identity, w);
  }
  async function report(identity: AuthenticatedUser, w: string, window: unknown, filter?: Parameters<ReturnType<typeof googleAnalytics>["report"]>[4]) {
    const db = await access(identity,w,"read"), r = await row(db,w);
    if(r?.status!=="connected" || !r.secretReference || r.errorCode)throw new Ga4Error("NOT_CONNECTED","Connect and test a GA4 property in Integrations first.");
    const state=await read(identity,w);
    if(!state.property?.timeZone)throw new Ga4Error("PROPERTY_CHANGED","Test the GA4 connection to confirm its timezone.");
    const {client,value}=await tokens(w,r.secretReference);
    const traffic=await client.report(value.accessToken,r.externalAccountId,window,state.property.timeZone,filter);
    await integrationAccess(db,config,identity,w,"read");
    const current=await row(db,w);
    if(current?.updatedAt.toISOString()!==r.updatedAt.toISOString())throw new HiveConflict("GA4 connection changed during reporting. Refresh the dashboard.");
    return {property:state.property,connectionVersion:r.connectedAt.toISOString(),traffic};
  }
  return { read, begin, finish, properties, select, test, disconnect, report };
}
