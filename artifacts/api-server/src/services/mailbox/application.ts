import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { Db } from "mongodb";
import type { AppConfig } from "../../config";
import type { AuthenticatedUser } from "../../middlewares/auth";
import type { MongoService } from "../mongo";
import {
  EventSchema,
  WorkspaceIntegrationSchema,
  generatePlatformId,
  platformIdSchema,
} from "../../domain";
import { resolveHvmContext } from "../hvm-context";
import { AuthorizationDenied } from "../../authorization/policy";
import { lockIcpWorkspace } from "../icp/access";
import { HiveConflict } from "../hive-definitions";
import { logger } from "../../lib/logger";
import { mailboxSecrets, type MailboxSecrets } from "./secrets";
import {
  googleMailbox,
  emailMime,
  MailboxError,
  GOOGLE_SCOPES,
} from "./google";
import {
  mailboxReadiness,
  matchesOutboundReply,
  outboundMail,
} from "./contracts";
import {
  createOAuthAttempt,
  oauthHash,
  validOAuthAttempt,
} from "./oauth-state";
const provider = "google_workspace";
const credentials = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: z.number(),
  scopes: z.array(z.string()),
});
const activeFilter = (w: string) => ({
  workspaceId: w,
  provider,
  archived: { $ne: true },
});
export async function mailboxAccess(
  db: Db,
  config: AppConfig,
  identity: AuthenticatedUser,
  w: string,
  action: "read" | "update",
) {
  platformIdSchema("workspace").parse(w);
  const r = await resolveHvmContext(db, config, identity);
  if (r.context.application !== "hvmapp" || r.context.actor.type !== "human")
    throw new AuthorizationDenied();
  r.authority.scopeFilter(r.context, action, {
    type: "workspace_integrations",
    workspaceId: w,
  });
  return r.context.actor;
}
function event(w: string, eventType: string, payload: Record<string, unknown>) {
  const now = new Date();
  return EventSchema.parse({
    id: generatePlatformId("event"),
    workspaceId: w,
    eventType,
    createdAt: now,
    updatedAt: now,
    occurredAt: now,
    payload,
  });
}
export function createMailboxApplication(
  config: AppConfig,
  mongo: MongoService,
  secrets: MailboxSecrets | undefined = mailboxSecrets(),
  makeProvider = googleMailbox,
) {
  async function row(db: Db, w: string) {
    return db.collection("workspace_integrations").findOne(activeFilter(w));
  }
  async function access(
    identity: AuthenticatedUser,
    w: string,
    action: "read" | "update",
  ) {
    const db = await mongo.database();
    await mailboxAccess(db, config, identity, w, action);
    return db;
  }
  async function cleanup(w: string, reference: string, queue = true) {
    try {
      await secrets!.remove(w, reference);
      return true;
    } catch {
      logger.warn({ workspaceId: w }, "Mailbox secret cleanup needs retry");
      if (queue) {
        const db = await mongo.database();
        await db
          .collection("events")
          .insertOne(
            event(w, "mailbox_secret_cleanup", { reference, completed: false }),
          );
      }
      return false;
    }
  }
  async function locked<T>(w: string, run: (db: Db) => Promise<T>): Promise<T> {
    if (!mongo.withTransaction)
      throw new HiveConflict("Mailbox transactions are unavailable.");
    const owner = randomUUID();
    await mongo.withTransaction(async (db, session) => {
      await lockIcpWorkspace(db, w, session);
      const existing = await db
        .collection("events")
        .findOne({ workspaceId: w, eventType: "mailbox_lock" }, { session });
      if (existing && existing.payload.expiresAt > Date.now())
        throw new HiveConflict(
          "A mailbox operation is already in progress. Please wait.",
        );
      const payload = { owner, expiresAt: Date.now() + 180000 };
      if (existing)
        await db
          .collection("events")
          .updateOne(
            { id: existing.id, workspaceId: w },
            { $set: { payload, updatedAt: new Date() } },
            { session },
          );
      else
        await db
          .collection("events")
          .insertOne(event(w, "mailbox_lock", payload), { session });
    });
    const db = await mongo.database();
    try {
      return await run(db);
    } finally {
      await db
        .collection("events")
        .updateOne(
          { workspaceId: w, eventType: "mailbox_lock", "payload.owner": owner },
          { $set: { "payload.expiresAt": 0, updatedAt: new Date() } },
        );
    }
  }
  async function connected(db: Db, w: string) {
    const r = await row(db, w);
    if (
      !secrets ||
      r?.status !== "connected" ||
      !r.secretReference ||
      !GOOGLE_SCOPES.every((s) => r.scopes.includes(s))
    )
      throw new MailboxError(
        "NOT_CONNECTED",
        "Connect Gmail before testing it.",
      );
    const client = makeProvider(await secrets.config());
    let tokens = credentials.parse(await secrets.read(w, r.secretReference));
    if (tokens.expiresAt < Date.now() + 60000) {
      tokens = await client.refresh(tokens);
      await secrets.write(w, r.secretReference, tokens);
    }
    return { r, client, tokens };
  }
  async function read(identity: AuthenticatedUser, w: string) {
    const db = await access(identity, w, "read"),
      r = await row(db, w);
    let canManage = true;
    try {
      await mailboxAccess(db, config, identity, w, "update");
    } catch (e) {
      if (e instanceof AuthorizationDenied) canManage = false;
      else throw e;
    }
    const tests = r
      ? await db
          .collection("events")
          .find({
            workspaceId: w,
            eventType: "mailbox_test",
            "payload.integrationId": r.id,
            "payload.connectionVersion": r.connectedAt.toISOString(),
          })
          .sort({ createdAt: -1 })
          .limit(10)
          .toArray()
      : [];
    const replies = r
      ? await db
          .collection("events")
          .find({
            workspaceId: w,
            eventType: "mailbox_test_reply",
            "payload.integrationId": r.id,
            "payload.connectionVersion": r.connectedAt.toISOString(),
          })
          .sort({ createdAt: -1 })
          .limit(20)
          .toArray()
      : [];
    const status =
      r?.status === "connected" && !r.errorCode
        ? "connected"
        : r?.status === "disconnected"
          ? "disconnected"
          : r
            ? "needs_attention"
            : "not_connected";
    return {
      available: Boolean(secrets),
      canManage,
      email: r?.externalAccountId ?? null,
      status,
      updatedAt: r?.updatedAt.toISOString() ?? null,
      lastCheckedAt: r?.lastSuccessfulSyncAt?.toISOString() ?? null,
      notice:
        r?.status === "disconnected"
          ? "HVM has removed this workspace’s mailbox access. You can also remove HVM in Google Account security settings; that revokes the Google grant for any other HVM connections using this same account."
          : null,
      readiness: mailboxReadiness({
        connection: status,
        sendingVerified: tests.some((t) => t.payload.status === "accepted"),
        repliesVerified: replies.some((t) => t.payload.matched),
      }),
      testRecipients: [
        ...new Set([
          ...(r?.externalAccountId ? [r.externalAccountId] : []),
          ...(process.env.HVM_MAILBOX_TEST_RECIPIENTS ?? "")
            .split(",")
            .map((s) => s.trim().toLowerCase())
            .filter((s) => z.string().email().safeParse(s).success),
        ]),
      ],
      tests: tests.map((t) => ({
        id: t.id,
        recipient: t.payload.recipient,
        status: t.payload.status,
        createdAt: t.createdAt.toISOString(),
      })),
      replies: replies.map((t) => ({
        id: t.id,
        from: t.payload.message.from,
        subject: t.payload.message.subject,
        text: t.payload.message.text,
        receivedAt: t.payload.message.occurredAt,
        matched: t.payload.matched,
      })),
    };
  }
  async function begin(identity: AuthenticatedUser, w: string) {
    const db = await access(identity, w, "update");
    if (!secrets)
      throw new MailboxError(
        "SETUP_REQUIRED",
        "Google mailbox setup is not yet enabled for this environment.",
      );
    const client = makeProvider(await secrets.config()),
      existing = await row(db, w);
    const a = createOAuthAttempt({ ...identity, workspaceId: w, provider });
    const reference = await secrets.create(w, { verifier: a.verifier });
    try {
      await db.collection("events").insertOne(
        event(w, "mailbox_oauth", {
          ...a.record,
          expiresAt: a.record.expiresAt.toISOString(),
          reference,
          consumed: false,
          expectedConnection: existing
            ? `${existing.id}:${existing.connectedAt.toISOString()}:${existing.status}`
            : null,
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
    const input = z
      .object({
        state: z.string().max(100),
        browserSecret: z.string().max(100),
        code: z.string().min(1).max(4096),
      })
      .strict()
      .parse(raw);
    const db = await access(identity, w, "update");
    if (!secrets)
      throw new MailboxError(
        "SETUP_REQUIRED",
        "Google mailbox setup is unavailable.",
      );
    const attempt = await db.collection("events").findOne({
      workspaceId: w,
      eventType: "mailbox_oauth",
      "payload.stateHash": oauthHash(input.state),
      "payload.consumed": false,
    });
    if (
      !attempt ||
      !validOAuthAttempt(
        {
          ...attempt.payload,
          expiresAt: new Date(attempt.payload.expiresAt),
        } as Parameters<typeof validOAuthAttempt>[0],
        { ...identity, workspaceId: w, provider },
        input.state,
        input.browserSecret,
      )
    )
      throw new MailboxError(
        "OAUTH_EXPIRED",
        "The connection request has expired or changed. Connect Gmail again.",
      );
    const consumed = await db
      .collection("events")
      .updateOne(
        { id: attempt.id, workspaceId: w, "payload.consumed": false },
        { $set: { "payload.consumed": true, updatedAt: new Date() } },
      );
    if (consumed.matchedCount !== 1)
      throw new MailboxError(
        "OAUTH_REPLAY",
        "This connection request was already used. Start again.",
      );
    let newReference: string | undefined;
    try {
      const verifier = z
        .object({ verifier: z.string() })
        .parse(await secrets.read(w, attempt.payload.reference));
      const client = makeProvider(await secrets.config()),
        tokens = await client.exchange(input.code, verifier.verifier),
        profile = await client.profile(tokens.accessToken);
      newReference = await secrets.create(w, tokens);
      await locked(w, async (db) => {
        const actor = await mailboxAccess(db, config, identity, w, "update"),
          previous = await row(db, w),
          now = new Date();
        if (
          (previous
            ? `${previous.id}:${previous.connectedAt.toISOString()}:${previous.status}`
            : null) !== attempt.payload.expectedConnection
        )
          throw new HiveConflict(
            "Mailbox changed during sign-in. Start the connection again.",
          );
        const record = WorkspaceIntegrationSchema.parse({
          id: previous?.id ?? generatePlatformId("integration"),
          workspaceId: w,
          provider,
          displayName: "Google Workspace / Gmail",
          externalAccountId: profile.emailAddress.toLowerCase(),
          createdAt: previous?.createdAt ?? now,
          createdBy: previous?.createdBy ?? actor,
          updatedAt: now,
          updatedBy: actor,
          status: "connected",
          connectedAt: now,
          connectedBy: actor,
          secretReference: newReference,
          scopes: tokens.scopes,
        });
        if (previous)
          await db
            .collection("workspace_integrations")
            .replaceOne({ id: previous.id, workspaceId: w }, record);
        else await db.collection("workspace_integrations").insertOne(record);
        newReference = undefined;
        if (previous?.secretReference)
          await cleanup(w, previous.secretReference);
      });
    } finally {
      const cleaned = await cleanup(w, attempt.payload.reference);
      if (cleaned)
        await db
          .collection("events")
          .updateOne(
            { id: attempt.id, workspaceId: w },
            { $set: { "payload.cleaned": true, updatedAt: new Date() } },
          );
      if (newReference) await cleanup(w, newReference);
    }
    return read(identity, w);
  }
  async function testConnection(identity: AuthenticatedUser, w: string) {
    await access(identity, w, "update");
    await locked(w, async (db) => {
      await mailboxAccess(db, config, identity, w, "update");
      const { r, client, tokens } = await connected(db, w);
      const profile = await client.profile(tokens.accessToken);
      if (profile.emailAddress.toLowerCase() !== r.externalAccountId)
        throw new MailboxError(
          "ACCOUNT_CHANGED",
          "The mailbox identity has changed. Reconnect Gmail.",
        );
      const now = new Date();
      await db.collection("workspace_integrations").updateOne(
        { id: r.id, workspaceId: w },
        {
          $set: {
            lastSyncAt: now,
            lastSuccessfulSyncAt: now,
            updatedAt: now,
          },
          $unset: { errorCode: "" },
        },
      );
    });
    return read(identity, w);
  }
  async function sendTest(
    identity: AuthenticatedUser,
    w: string,
    raw: unknown,
  ) {
    const input = z
      .object({
        operationId: z.string().uuid(),
        recipient: z.string().email(),
        controlledInboxConfirmed: z.literal(true),
      })
      .strict()
      .parse(raw);
    await access(identity, w, "update");
    await locked(w, async (db) => {
      const actor = await mailboxAccess(db, config, identity, w, "update");
      const existing = await db.collection("events").findOne({
        workspaceId: w,
        eventType: "mailbox_test",
        "payload.operationId": input.operationId,
      });
      if (existing) return; // Never resend an operation, including an uncertain/failed one.
      const { r, client, tokens } = await connected(db, w);
      const allowed = [
        r.externalAccountId,
        ...(process.env.HVM_MAILBOX_TEST_RECIPIENTS ?? "")
          .split(",")
          .map((v) => v.trim().toLowerCase()),
      ];
      if (!allowed.includes(input.recipient.toLowerCase()))
        throw new MailboxError(
          "TEST_RECIPIENT",
          "Select the connected mailbox or an explicitly configured test inbox.",
        );
      const messageId = `<hvm-${input.operationId}@${r.externalAccountId.split("@")[1]}>`;
      const doc = event(w, "mailbox_test", {
        integrationId: r.id,
        connectionVersion: r.connectedAt.toISOString(),
        operationId: input.operationId,
        recipient: input.recipient.toLowerCase(),
        messageId,
        status: "sending",
        checkedAt: "",
        testOnly: true,
        controlledInboxConfirmed: true,
        approvedBy: actor,
      });
      doc.createdBy = actor;
      doc.updatedBy = actor;
      await db.collection("events").insertOne(doc);
      const text =
        "This is your HVM mailbox connection test. Reply to this message, then check replies in HVM. This test does not enrol or contact a prospect and is excluded from campaign engagement.";
      const mail = outboundMail.parse({
        operationId: input.operationId,
        to: input.recipient,
        subject: "HVM mailbox connection test",
        text,
        html: `<p>${text}</p>`,
      });
      try {
        const sent = await client.send(
          tokens.accessToken,
          emailMime(r.externalAccountId, mail, messageId),
        );
        await db.collection("events").updateOne(
          { id: doc.id, workspaceId: w },
          {
            $set: {
              "payload.status": "accepted",
              "payload.providerId": sent.id,
              "payload.threadId": sent.threadId,
              updatedAt: new Date(),
            },
          },
        );
      } catch (e) {
        // Includes response parsing and DB-save failures after a successful network send.
        const status =
          e instanceof MailboxError && !e.ambiguous ? "failed" : "unknown";
        await db
          .collection("events")
          .updateOne(
            { id: doc.id, workspaceId: w },
            { $set: { "payload.status": status, updatedAt: new Date() } },
          );
        throw e;
      }
    });
    return read(identity, w);
  }
  async function syncWorkspace(w: string) {
    await locked(w, async (db) => {
      const { r, client, tokens } = await connected(db, w);
      const tests = await db
        .collection("events")
        .find({
          workspaceId: w,
          eventType: "mailbox_test",
          "payload.integrationId": r.id,
          "payload.connectionVersion": r.connectedAt.toISOString(),
          "payload.status": { $in: ["sending", "unknown", "accepted"] },
        })
        .sort({ "payload.checkedAt": 1 })
        .limit(2)
        .toArray();
      for (const test of tests) {
        let threadId = test.payload.threadId;
        if (!threadId) {
          const found = await client.findSent(
            tokens.accessToken,
            test.payload.messageId,
          );
          if (!found) {
            await db.collection("events").updateOne(
              { id: test.id, workspaceId: w },
              {
                $set: {
                  "payload.status": "unknown",
                  "payload.checkedAt": new Date().toISOString(),
                  updatedAt: new Date(),
                },
              },
            );
            continue;
          }
          threadId = found.threadId;
          await db.collection("events").updateOne(
            { id: test.id, workspaceId: w },
            {
              $set: {
                "payload.status": "accepted",
                "payload.providerId": found.id,
                "payload.threadId": threadId,
                updatedAt: new Date(),
              },
            },
          );
        }
        const messages = await client.thread(tokens.accessToken, threadId);
        for (const message of messages) {
          if (
            message.internetMessageId === test.payload.messageId ||
            message.providerId === test.payload.providerId
          )
            continue;
          const matched = matchesOutboundReply(message, test.payload.messageId);
          const existing = await db.collection("events").findOne({
            workspaceId: w,
            eventType: "mailbox_test_reply",
            "payload.integrationId": r.id,
            "payload.providerId": message.providerId,
          });
          if (!existing)
            await db.collection("events").insertOne(
              event(w, "mailbox_test_reply", {
                integrationId: r.id,
                connectionVersion: r.connectedAt.toISOString(),
                providerId: message.providerId,
                testId: test.id,
                matched,
                message,
                testOnly: true,
              }),
            );
        }
        await db.collection("events").updateOne(
          { id: test.id, workspaceId: w },
          {
            $set: {
              "payload.checkedAt": new Date().toISOString(),
              updatedAt: new Date(),
            },
          },
        );
      }
      const now = new Date();
      await db.collection("workspace_integrations").updateOne(
        { id: r.id, workspaceId: w },
        {
          $set: {
            lastSyncAt: now,
            lastSuccessfulSyncAt: now,
            updatedAt: now,
          },
          $unset: { errorCode: "" },
        },
      );
    });
  }
  async function disconnect(
    identity: AuthenticatedUser,
    w: string,
    raw: unknown,
  ) {
    const input = z
      .object({ expectedUpdatedAt: z.string().datetime() })
      .strict()
      .parse(raw);
    await access(identity, w, "update");
    await locked(w, async (db) => {
      const actor = await mailboxAccess(db, config, identity, w, "update"),
        r = await row(db, w);
      if (!r || r.connectedAt > new Date(input.expectedUpdatedAt))
        throw new HiveConflict(
          "Mailbox changed. Refresh before disconnecting.",
        );
      const now = new Date();
      await db.collection("workspace_integrations").updateOne(
        { id: r.id, workspaceId: w },
        {
          $set: {
            status: "disconnected",
            disconnectedAt: now,
            updatedAt: now,
            // Match the persisted base actor contract, as connection creation does.
            // The authenticated actor also carries issuer, which Mongo rejects here.
            updatedBy: { type: actor.type, id: actor.id },
            scopes: [],
          },
          $unset: { secretReference: "" },
        },
      );
      // Google revocation is account/application-wide and can break this owner's
      // other workspace connections. Remove this workspace's usable credential,
      // and let the mailbox owner revoke the shared Google grant explicitly.
      if (secrets && r.secretReference) await cleanup(w, r.secretReference);
    });
    return read(identity, w);
  }
  return {
    // Internal transport adapter: same lock as disconnect and token refresh.
    locked,
    connected,
    read,
    begin,
    finish,
    testConnection,
    sendTest,
    disconnect,
    syncWorkspace,
    async sync(identity: AuthenticatedUser, w: string) {
      await access(identity, w, "update");
      await syncWorkspace(w);
      return read(identity, w);
    },
    async tick() {
      if (!secrets) return;
      const db = await mongo.database();
      const rows = await db
        .collection("workspace_integrations")
        .find({ provider, status: "connected", archived: { $ne: true } })
        .sort({ lastSyncAt: 1 })
        .limit(10)
        .toArray();
      for (const r of rows) {
        try {
          await syncWorkspace(r.workspaceId);
        } catch (e) {
          if (e instanceof HiveConflict) continue;
          const now = new Date();
          await db.collection("workspace_integrations").updateOne(
            { id: r.id, status: "connected", connectedAt: r.connectedAt },
            {
              $set: {
                lastSyncAt: now,
                updatedAt: now,
                errorCode:
                  e instanceof MailboxError ? e.code : "SYNC_UNAVAILABLE",
                ...(e instanceof MailboxError && e.code === "RECONNECT"
                  ? { status: "error" }
                  : {}),
              },
            },
          );
        }
      }
      const cleanupItems = await db
        .collection("events")
        .find({
          eventType: "mailbox_secret_cleanup",
          "payload.completed": false,
        })
        .limit(20)
        .toArray();
      for (const item of cleanupItems)
        if (await cleanup(item.workspaceId, item.payload.reference, false))
          await db
            .collection("events")
            .updateOne(
              { id: item.id },
              { $set: { "payload.completed": true, updatedAt: new Date() } },
            );
      // Expired one-use attempts contain no tokens, but their PKCE secret must be removed.
      const expired = await db
        .collection("events")
        .find({
          eventType: "mailbox_oauth",
          "payload.expiresAt": { $lt: new Date().toISOString() },
          "payload.cleaned": { $ne: true },
        })
        .limit(20)
        .toArray();
      for (const attempt of expired) {
        if (
          !(await cleanup(
            attempt.workspaceId,
            attempt.payload.reference,
            false,
          ))
        )
          continue;
        await db.collection("events").updateOne(
          { id: attempt.id },
          {
            $set: {
              "payload.cleaned": true,
              "payload.consumed": true,
              updatedAt: new Date(),
            },
          },
        );
      }
    },
  };
}
