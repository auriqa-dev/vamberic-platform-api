import { campaignTrackedUrl } from "../campaigns/tracking";
import { assertCampaignLaunch } from "../campaigns/journey";
import { readApprovedContactStrategies } from "../contact-strategy/current";
import { prepareTracking } from "../website-tracking/service";
import { recordOutcome } from "../measurement/store";
import { readMeasurement } from "../measurement/read";
import { randomUUID } from "node:crypto";
import type { Db, ClientSession, Document } from "mongodb";
import type { AppConfig } from "../../config";
import type { MongoService } from "../mongo";
import type { AuthenticatedUser } from "../../middlewares/auth";
import { generatePlatformId, platformIdSchema } from "../../domain";
import { HiveConflict } from "../hive-definitions";
import { lockIcpWorkspace } from "../icp/access";
import {
  contentAccess,
  currentRecords,
  fingerprint,
} from "../content-strategy/application";
import {
  contactContextAccess,
  readContactContext,
  contactActionRestriction,
} from "../contact-context";
import {
  createMailboxApplication,
  mailboxAccess,
} from "../mailbox/application";
import { emailMime, MailboxError } from "../mailbox/google";
import {
  outboundMail,
  matchesOutboundReply,
  type ReceivedMail,
} from "../mailbox/contracts";
import { emailRecord } from "../email-content/model";
import { emailAssets } from "../email-content/selection";
import { evaluateContactStrategies } from "../contact-strategy/evaluate";
import { ContactStrategyPolicyV14Schema } from "../../domain/identity-value-v14";
import { withoutMongoId } from "../hvm-context";
import { engagementConflicts } from "../nba/coordination";
import {
  createRequest,
  mutation,
  reviewReply,
  interpretReply,
  canTransition,
  pendingStates,
} from "./model";
import { createEmailTemplates } from "../email-templates/service";
import { communicationEvent } from "./events";
const kind = "communication";
function event(
  w: string,
  eventType: string,
  payload: Document,
  actor?: unknown,
  extra: Document = {},
) {
  const now = new Date();
  return communicationEvent({
    id: generatePlatformId("event"),
    workspaceId: w,
    eventType,
    createdAt: now,
    updatedAt: now,
    occurredAt: now,
    ...(actor ? { createdBy: actor } : {}),
    ...extra,
    payload,
  });
}
export function createCommunications(
  config: AppConfig,
  mongo: MongoService,
  mailbox = createMailboxApplication(config, mongo),
) {
  const templates = createEmailTemplates(config, mongo);
  async function access(
    db: Db,
    u: AuthenticatedUser,
    w: string,
    action: "read" | "update" | "approve",
    s?: ClientSession,
  ) {
    await contentAccess(db, config, u, w, action, s);
    await contactContextAccess(
      db,
      config,
      u,
      w,
      action === "read" ? "read" : "update",
      s,
    );
    return mailboxAccess(
      db,
      config,
      u,
      w,
      action === "read" ? "read" : "update",
    );
  }
  async function tx<T>(
    w: string,
    fn: (db: Db, s: ClientSession) => Promise<T>,
  ) {
    if (!mongo.withTransaction)
      throw new HiveConflict("Transactions unavailable.");
    return mongo.withTransaction(async (db, s) => {
      await lockIcpWorkspace(db, w, s);
      return fn(db, s);
    });
  }
  async function get(db: Db, w: string, id: string, s?: ClientSession) {
    platformIdSchema("event").parse(id);
    const r = await db
      .collection("events")
      .findOne({ id, workspaceId: w, eventType: kind }, { session: s });
    if (!r) throw new HiveConflict("Communication not found.");
    return r;
  }
  async function change(
    db: Db,
    s: ClientSession | undefined,
    r: Document,
    patch: Document,
    actor?: unknown,
  ) {
    const now = new Date();
    const payload = { ...r.payload, ...patch, version: r.payload.version + 1 };
    const done = await db.collection("events").updateOne(
      {
        id: r.id,
        workspaceId: r.workspaceId,
        "payload.version": r.payload.version,
      },
      { $set: { payload, updatedAt: now } },
      { session: s },
    );
    if (done.matchedCount !== 1)
      throw new HiveConflict(
        "Communication changed. Refresh before continuing.",
      );
    await db
      .collection("events")
      .insertOne(
        event(
          r.workspaceId,
          "communication_history",
          { communicationId: r.id, ...payload },
          actor,
        ),
        { session: s },
      );
    await recordOutcome(db, s, { ...r, payload, updatedAt: now });
    return { ...r, payload, updatedAt: now };
  }
  async function policies(db: Db, w: string, s?: ClientSession) {
    const current = await readApprovedContactStrategies(db, w, s);
    if (current.missingApproval.length) throw new HiveConflict("Contact strategy approval evidence is missing. Review the affected strategies.");
    return current.approved;
  }
  async function validate(
    db: Db,
    w: string,
    p: Document,
    u: AuthenticatedUser,
    s?: ClientSession,
    approving = false,
  ) {
    await access(db, u, w, approving ? "approve" : "update", s);
    const e = await db
      .collection("events")
      .find(
        {
          workspaceId: w,
          eventType: "email_content_record",
          "payload.record.id": p.draft.id,
        },
        { session: s },
      )
      .sort({ "payload.record.version": -1 })
      .limit(1)
      .next();
    const d = e ? emailRecord.parse(e.payload.record) : null;
    if (
      !d ||
      d.status !== "approved" ||
      d.version !== p.draft.version ||
      fingerprint(d) !== fingerprint(p.draft)
    )
      throw new HiveConflict(
        "Email content changed or is not approved. Prepare a new delivery review.",
      );
    if (p.template) {
      const latest = await templates.resolve(db, u, w, d, p.template.id, s);
      if (fingerprint(latest.template) !== fingerprint(p.template))
        throw new HiveConflict(
          "Template or approved Brand Kit changed. Prepare a new delivery review.",
        );
    }
    const connection = await db.collection("workspace_integrations").findOne(
      {
        workspaceId: w,
        provider: "google_workspace",
        archived: { $ne: true },
      },
      { session: s },
    );
    if (
      !connection ||
      connection.status !== "connected" ||
      connection.id !== p.integrationId ||
      connection.connectedAt.toISOString() !== p.connectionVersion ||
      connection.externalAccountId !== p.sender
    )
      throw new HiveConflict(
        "Sender connection changed. Reconnect and prepare a new delivery review.",
      );
    const all = currentRecords(
      await db
        .collection("events")
        .find(
          { workspaceId: w, eventType: "content_strategy_record" },
          { session: s },
        )
        .toArray(),
    );
    const brief = all.find(
      (r) =>
        r.id === d.briefId &&
        r.version === d.briefVersion &&
        r.status === "approved",
    );
    if (!brief)
      throw new HiveConflict(
        "The approved brief changed. Review email content again.",
      );
    if (
      d.content.ctaAssetId &&
      !emailAssets(all, brief).some(
        (r) => r.id === d.content.ctaAssetId && r.data.url === d.ctaUrl,
      )
    )
      throw new HiveConflict(
        "CTA is no longer eligible. Review the Library destination.",
      );
    const ctx = await readContactContext(db, w, d.contactId, s);
    if (p.testOnly) {
      if (
        ![
          p.sender,
          ...(process.env.HVM_MAILBOX_TEST_RECIPIENTS ?? "")
            .split(",")
            .map((v) => v.trim().toLowerCase()),
        ].includes(p.recipient)
      )
        throw new HiveConflict(
          "Choose the connected mailbox or configured test inbox.",
        );
      return;
    }
    const point = ctx.points.find(
      (c) => c.id === p.contactPointId && c.type === "email",
    );
    if (!point || point.value.toLowerCase() !== p.recipient)
      throw new HiveConflict(
        "Recipient address changed. Prepare a new review.",
      );
    const restriction = contactActionRestriction(
      ctx,
      p.purpose,
      p.contactPointId,
    );
    if (restriction.reasons.length)
      throw new HiveConflict(restriction.reasons.join(". "));
    const replies = await db.collection("events").findOne(
      {
        workspaceId: w,
        eventType: "communication_reply",
        $or: [
          { "payload.contactId": d.contactId },
          { "payload.proposedContactId": d.contactId },
        ],
        "payload.testOnly": false,
        "payload.reviewed": false,
      },
      { session: s },
    );
    if (replies)
      throw new HiveConflict(
        "Review the incoming reply before further contact.",
      );
    const suppressed = await db.collection("events").findOne(
      {
        workspaceId: w,
        eventType: "communication_suppression",
        "payload.contactId": d.contactId,
        "payload.active": true,
        $or: [
          { "payload.recipient": p.recipient },
          { "payload.recipient": "*" },
        ],
      },
      { session: s },
    );
    if (suppressed)
      throw new HiveConflict(
        "A reply has restricted further contact. Review contact restrictions first.",
      );
    const otherDelivery = await db.collection("events").findOne(
      {
        workspaceId: w,
        eventType: kind,
        "payload.testOnly": false,
        "payload.draft.contactId": d.contactId,
        "payload.requestKey": { $ne: p.requestKey },
        "payload.status": { $in: ["scheduled", "sending", "unknown"] },
      },
      { session: s },
    );
    if (otherDelivery)
      throw new HiveConflict(
        "Another delivery is already pending for this contact. Review it first.",
      );
    const conflicts = await engagementConflicts(
      db,
      s,
      w,
      [
        `person:${d.contactId}`,
        ...ctx.relationships
          .filter((r) => r.current)
          .map((r) => `organisation:${r.organisationId}`),
      ],
      d.nbaDecisionId || undefined,
    );
    if (conflicts.length)
      throw new HiveConflict(
        "This contact or organisation has another engagement under management.",
      );
    if (d.campaignId) {
      await assertCampaignLaunch(db, w, d.campaignId, d.contactId, p.contactPointId, s);
      const c = await db
        .collection("events")
        .find(
          {
            workspaceId: w,
            eventType: "campaign_setup",
            campaignId: d.campaignId,
          },
          { session: s },
        )
        .sort({ "payload.version": -1 })
        .limit(1)
        .next();
      if (
        !c ||
        c.payload.version !== d.campaignVersion ||
        c.payload.status !== "ready"
      )
        throw new HiveConflict(
          "Campaign setup changed or is no longer approved.",
        );
    }
    if (d.nbaDecisionId) {
      const n = await db
        .collection("events")
        .find(
          {
            workspaceId: w,
            eventType: "nba_decision",
            "payload.decisionId": d.nbaDecisionId,
          },
          { session: s },
        )
        .sort({ "payload.version": -1 })
        .limit(1)
        .next();
      if (
        !n ||
        ["cancelled", "rejected", "paused", "failed"].includes(n.payload.state)
      )
        throw new HiveConflict(
          "The NBA action is no longer available for delivery.",
        );
    }
    const active = await policies(db, w, s);
    if (p.policyHash !== fingerprint(active))
      throw new HiveConflict(
        "Contact strategies changed. Review delivery again.",
      );
    const evidence = await db.collection("events").findOne(
      {
        workspaceId: w,
        id: p.approvalEvidenceId,
        eventType: "communication_permission_review",
      },
      { session: s },
    );
    if (
      !evidence ||
      evidence.payload.requestKey !== p.requestKey ||
      evidence.payload.policyHash !== p.policyHash
    )
      throw new HiveConflict("A saved delivery permission review is required.");
    const assessment = Object.fromEntries(
      (evidence.payload.assessments ?? []).map((a: Document) => [
        a.policyId,
        {
          ...a,
          applies: a.effect !== "not_applicable",
          effect: a.effect === "not_applicable" ? "permitted" : a.effect,
          evidenceIds: [p.approvalEvidenceId],
        },
      ]),
    );
    const evaluated = evaluateContactStrategies(
      active.map((r) =>
        ContactStrategyPolicyV14Schema.parse(withoutMongoId(r)),
      ),
      {
        workspaceId: w,
        evaluatedAt: new Date(),
        legal: p.legalConfirmed ? "permitted" : "unknown",
        platform: p.platformConfirmed ? "permitted" : "unknown",
        suppression: "clear",
        assessments: assessment,
      },
    );
    if (evaluated.effect !== "permitted")
      throw new HiveConflict(
        "Review the applicable contact strategies and delivery permission before sending.",
      );
  }
  function publicRow(r: Document) {
    const p = { ...r.payload };
    delete p.authorisedUser;
    return { id: r.id, ...p, updatedAt: r.updatedAt.toISOString() };
  }
  async function list(u: AuthenticatedUser, w: string) {
    const db = await mongo.database();
    await access(db, u, w, "read");
    const [rows, replies, policyRows, connection] = await Promise.all([
      db
        .collection("events")
        .find({ workspaceId: w, eventType: kind })
        .sort({ updatedAt: -1 })
        .limit(200)
        .toArray(),
      db
        .collection("events")
        .find({ workspaceId: w, eventType: "communication_reply" })
        .sort({ occurredAt: -1 })
        .limit(200)
        .toArray(),
      policies(db, w),
      mailbox.read(u, w),
    ]);
    const draftRows = await db
      .collection("events")
      .find({ workspaceId: w, eventType: "email_content_record" })
      .sort({ "payload.record.version": -1 })
      .toArray();
    // Preserve historical evidence, but never present a known HVM outbound
    // message as an incoming reply, including records from older pollers.
    const ownMessages = replies.length
      ? await db
          .collection("events")
          .find({
            workspaceId: w,
            eventType: kind,
            $or: replies.map((r) => ({
              "payload.integrationId": r.payload.integrationId,
              "payload.providerId": r.payload.providerId,
            })),
          })
          .toArray()
      : [];
    const outboundKeys = new Set(
      ownMessages.map(
        (r) => `${r.payload.integrationId}:${r.payload.providerId}`,
      ),
    );
    const draftMap = new Map<string, Document>();
    for (const e of draftRows)
      if (!draftMap.has(e.payload.record.id))
        draftMap.set(e.payload.record.id, e.payload.record);
    const drafts = [];
    for (const d of draftMap.values()) {
      if (d.status !== "approved") continue;
      try {
        const ctx = await readContactContext(db, w, d.contactId);
        drafts.push({
          ...d,
          points: ctx.points.filter((p) => p.type === "email"),
        });
      } catch {
        /* Deleted contacts cannot be selected. */
      }
    }
    return {
      measurement: await readMeasurement(db, w),
      drafts,
      records: rows.map(publicRow),
      replies: replies
        .filter(
          (r) =>
            !outboundKeys.has(
              `${r.payload.integrationId}:${r.payload.providerId}`,
            ),
        )
        .map(publicRow),
      policies: policyRows.map((r) => ({
        id: r.id,
        key: r.key,
        version: r.version,
        title: r.key,
        details: r,
      })),
      mailbox: {
        email: connection.email,
        status: connection.status,
        testRecipients: connection.testRecipients,
      },
    };
  }
  async function create(u: AuthenticatedUser, w: string, raw: unknown) {
    const input = createRequest.parse(raw);
    return mailbox.locked(w, () =>
      tx(w, async (db, s) => {
        const actor = await access(db, u, w, "update", s);
        const existing = await db.collection("events").findOne(
          {
            workspaceId: w,
            eventType: kind,
            "payload.requestKey": input.requestKey,
          },
          { session: s },
        );
        if (existing) {
          if (existing.payload.requestHash !== fingerprint(input))
            throw new HiveConflict("Request key already used.");
          return publicRow(existing);
        }
        const duplicate = await db.collection("events").findOne(
          {
            workspaceId: w,
            eventType: kind,
            "payload.draft.id": input.draftId,
            "payload.testOnly": input.testOnly,
            "payload.status": { $in: [...pendingStates, "accepted"] },
          },
          { session: s },
        );
        if (duplicate)
          throw new HiveConflict(
            "This email already has a delivery record. Open it instead of creating another.",
          );
        const e = await db
          .collection("events")
          .find(
            {
              workspaceId: w,
              eventType: "email_content_record",
              "payload.record.id": input.draftId,
            },
            { session: s },
          )
          .sort({ "payload.record.version": -1 })
          .limit(1)
          .next();
        const draft = e ? emailRecord.parse(e.payload.record) : null;
        if (
          !draft ||
          draft.version !== input.draftVersion ||
          draft.status !== "approved"
        )
          throw new HiveConflict("Select a current approved email draft.");
        const connection = await db
          .collection("workspace_integrations")
          .findOne(
            {
              workspaceId: w,
              provider: "google_workspace",
              status: "connected",
              archived: { $ne: true },
            },
            { session: s },
          );
        if (!connection)
          throw new HiveConflict("Connect Gmail in Integrations first.");
        const ctx = await readContactContext(db, w, draft.contactId, s);
        const point = ctx.points.find(
          (p) => p.id === input.contactPointId && p.type === "email",
        );
        const recipient = input.testOnly
          ? input.testRecipient
          : point?.value.toLowerCase();
        if (!recipient) throw new HiveConflict("Choose a recipient address.");
        let replyMessageId: string | undefined,
          replyThreadId: string | undefined;
        if (input.replyToId) {
          const reply = await db.collection("events").findOne(
            {
              workspaceId: w,
              id: input.replyToId,
              eventType: "communication_reply",
            },
            { session: s },
          );
          if (
            !reply ||
            !reply.payload.reviewed ||
            !reply.payload.associated ||
            reply.payload.contactId !== draft.contactId ||
            reply.payload.testOnly !== input.testOnly
          )
            throw new HiveConflict(
              "Select a reviewed reply belonging to this contact and delivery mode.",
            );
          const original = await get(db, w, reply.payload.communicationId, s);
          if (
            original.payload.integrationId !== connection.id ||
            original.payload.recipient !== recipient
          )
            throw new HiveConflict(
              "Reply mailbox or recipient does not match.",
            );
          replyMessageId = reply.payload.message.internetMessageId;
          replyThreadId = original.payload.threadId;
          if (!replyMessageId || !/^<[^<>\s]+>$/.test(replyMessageId))
            throw new HiveConflict("Reply has no usable message reference.");
          if (
            draft.content.subject.replace(
              /^(?:(?:re:|\[HVM TEST\])\s*)+/i,
              "",
            ) !==
            reply.payload.message.subject.replace(
              /^(?:(?:re:|\[HVM TEST\])\s*)+/i,
              "",
            )
          )
            throw new HiveConflict(
              "For an in-thread reply, approve email content with the same subject as the conversation.",
            );
        }
        const id = generatePlatformId("event");
        const tracking = await prepareTracking(db, w, draft, id, input.testOnly, s);
        const presentation = await templates.resolve(
          db,
          u,
          w,
          draft,
          input.templateId,
          s,
          tracking?.url || campaignTrackedUrl(draft.ctaUrl, draft.campaignId, draft.id, input.testOnly),
        );
        const briefSource = await db.collection("events").findOne(
          {
            workspaceId: w,
            eventType: "content_strategy_record",
            "payload.record.id": draft.briefId,
            "payload.record.version": draft.briefVersion,
          },
          { session: s },
        );
        const offerIds: string[] = (
          briefSource?.payload?.record?.data?.scope?.offers ?? []
        ).filter((id: unknown): id is string => typeof id === "string");
        const r = event(
          w,
          kind,
          {
            ...input,
            requestHash: fingerprint(input),
            draft,
            offerIds,
            organisationId: ctx.relationships.find((r) => r.current)
              ?.organisationId,
            recipient,
            sender: connection.externalAccountId,
            integrationId: connection.id,
            connectionVersion: connection.connectedAt.toISOString(),
            status: "awaiting_review",
            version: 1,
            archived: false,
            notice:
              "Review content and recipient, then explicitly approve delivery.",
            dueAt: new Date().toISOString(),
            messageId: `<hvm-${randomUUID()}@${connection.externalAccountId.split("@")[1]}>`,
            checkedAt: "",
            policyHash: fingerprint(await policies(db, w, s)),
            tracking,
            template: presentation.template,
            rendered: {
              ...presentation.rendered,
              notice: presentation.rendered.notice + (tracking ? " Personalised CTA tracking is enabled for this delivery; website activity requires consent. A click does not prove recipient identity." : " CTA tracking is off for this delivery."),
              subject:
                (input.testOnly ? "[HVM TEST] " : "") +
                presentation.rendered.subject,
            },
            replyMessageId,
            replyThreadId,
          },
          actor,
        );
        r.id = id;
        await db.collection("events").insertOne(r, { session: s });
        await recordOutcome(db, s, r);
        return publicRow(r);
      }),
    );
  }
  async function mutate(
    u: AuthenticatedUser,
    w: string,
    id: string,
    raw: unknown,
  ) {
    const i = mutation.parse(raw);
    if (i.operation === "reconcile") {
      await access(await mongo.database(), u, w, "update");
      const r = await get(await mongo.database(), w, id);
      if (
        r.payload.version !== i.expectedVersion ||
        !canTransition(r.payload.status, "reconcile")
      )
        throw new HiveConflict("Refresh before checking this outcome.");
      await syncOne(w, id);
      return publicRow(await get(await mongo.database(), w, id));
    }
    return mailbox.locked(w, () =>
      tx(w, async (db, s) => {
        const actor = await access(
          db,
          u,
          w,
          i.operation === "approve" ? "approve" : "update",
          s,
        );
        const r = await get(db, w, id, s);
        if (r.payload.version !== i.expectedVersion)
          throw new HiveConflict("Record changed. Refresh first.");
        if (!canTransition(r.payload.status, i.operation))
          throw new HiveConflict(
            "This operation is not available. Sent history cannot be edited or recalled.",
          );
        let patch: Document = { lastReason: i.reason };
        if (i.operation === "approve") {
          if (
            i.responseDueAt &&
            Date.parse(i.responseDueAt) <=
              Math.max(Date.now(), Date.parse(i.dueAt || "1970-01-01"))
          )
            throw new HiveConflict(
              "Response review must be after the scheduled send time.",
            );
          const policyHash = fingerprint(await policies(db, w, s));
          patch = {
            ...patch,
            status: "scheduled",
            dueAt: i.dueAt ?? new Date().toISOString(),
            responseDueAt: i.responseDueAt ?? null,
            assessments: i.assessments,
            legalConfirmed: i.legalConfirmed,
            platformConfirmed: i.platformConfirmed,
            approvalEvidenceId: generatePlatformId("event"),
            policyHash,
            authorisedUser: u,
            approvedAt: new Date().toISOString(),
            notice:
              "Approved for this exact email, sender and recipient. Pending execution checks.",
          };
          const permission = event(
            w,
            "communication_permission_review",
            {
              requestKey: r.payload.requestKey,
              communicationId: r.id,
              recipient: r.payload.recipient,
              purpose: r.payload.purpose,
              policyHash,
              assessments: i.assessments,
              reason: i.reason,
              responseDueAt: i.responseDueAt,
              legalConfirmed: i.legalConfirmed,
              platformConfirmed: i.platformConfirmed,
            },
            actor,
          );
          permission.id = patch.approvalEvidenceId;
          await db.collection("events").insertOne(permission, { session: s });
          await validate(db, w, { ...r.payload, ...patch }, u, s, true);
        } else if (i.operation === "cancel") patch.status = "cancelled";
        else patch.archived = i.operation === "archive";
        return publicRow(await change(db, s, r, patch, actor));
      }),
    );
  }
  async function dispatch(w: string, id: string) {
    await mailbox.locked(w, async () => {
      let admitted: Document | undefined;
      try {
        admitted = await tx(w, async (db, s) => {
          const r = await get(db, w, id, s);
          if (
            r.payload.status !== "scheduled" ||
            Date.parse(r.payload.dueAt) > Date.now()
          )
            return;
          await validate(db, w, r.payload, r.payload.authorisedUser, s);
          return change(db, s, r, {
            status: "sending",
            dispatchStartedAt: new Date().toISOString(),
            notice: "Submitting to Gmail; do not retry.",
          });
        });
      } catch (e) {
        await tx(w, async (db, s) => {
          const r = await get(db, w, id, s);
          if (r.payload.status === "scheduled")
            await change(db, s, r, {
              status: "blocked",
              notice:
                e instanceof HiveConflict
                  ? e.message
                  : "Permission or connection check failed. Review before retrying.",
            });
        });
        return;
      }
      if (!admitted) return;
      const p = admitted.payload;
      let submitted = false;
      try {
        const db = await mongo.database();
        const { client, tokens } = await mailbox.connected(db, w);
        submitted = true;
        const sent = await client.send(
          tokens.accessToken,
          emailMime(
            p.sender,
            outboundMail.parse({
              operationId: p.requestKey,
              to: p.recipient,
              subject: p.rendered.subject,
              text: p.rendered.text,
              html: p.rendered.html,
              inlineImages: p.rendered.inlineImages,
            }),
            p.messageId,
            p.replyMessageId,
          ),
          p.replyThreadId,
        );
        await tx(w, async (db, s) => {
          const r = await get(db, w, id, s);
          await change(db, s, r, {
            status: "accepted",
            providerId: sent.id,
            threadId: sent.threadId,
            acceptedAt: new Date().toISOString(),
            notice:
              "Gmail accepted this email. Delivery and reading are not confirmed.",
          });
          await interaction(
            db,
            s,
            w,
            r,
            "outbound",
            p.rendered.subject,
            p.rendered.text,
            p.recipient,
            p.messageId,
          );
        });
      } catch (e) {
        await tx(w, async (db, s) => {
          const r = await get(db, w, id, s);
          if (r.payload.status === "sending")
            await change(db, s, r, {
              status:
                !submitted || (e instanceof MailboxError && !e.ambiguous)
                  ? "failed"
                  : "unknown",
              notice:
                e instanceof MailboxError
                  ? e.message
                  : "The send outcome is uncertain. Check Gmail status; HVM will not resend automatically.",
            });
        });
      }
    });
  }
  async function interaction(
    db: Db,
    s: ClientSession,
    w: string,
    r: Document,
    direction: string,
    subject: string,
    body: string,
    from: string,
    messageId: string,
    replyId?: string,
  ) {
    if (r.payload.testOnly) return;
    const existing = await db.collection("events").findOne(
      {
        workspaceId: w,
        eventType: "email",
        "payload.communicationMessageId": messageId,
      },
      { session: s },
    );
    if (existing) return;
    await db.collection("events").insertOne(
      event(
        w,
        "email",
        {
          communicationId: r.id,
          communicationMessageId: messageId,
          replyId,
          from,
        },
        undefined,
        {
          personIds: [r.payload.draft.contactId],
          ...(r.payload.draft.campaignId
            ? { campaignId: r.payload.draft.campaignId }
            : {}),
          interaction: {
            actor: { type: "integration", id: r.payload.integrationId },
            subject: subject.slice(0, 300) || "(No subject)",
            body,
            details: {
              type: "email",
              direction,
              outcome: direction === "inbound" ? "received" : "sent",
              references: { messageId },
            },
          },
        },
      ),
      { session: s },
    );
  }
  async function ingest(
    db: Db,
    s: ClientSession,
    w: string,
    r: Document,
    m: ReceivedMail,
  ) {
    const p = r.payload;
    const existing = await db.collection("events").findOne(
      {
        workspaceId: w,
        eventType: "communication_reply",
        "payload.integrationId": p.integrationId,
        "payload.providerId": m.providerId,
      },
      { session: s },
    );
    if (existing) return;
    const own = await db.collection("events").findOne(
      {
        workspaceId: w,
        eventType: kind,
        "payload.integrationId": p.integrationId,
        $or: [
          { "payload.providerId": m.providerId },
          ...(m.internetMessageId
            ? [{ "payload.messageId": m.internetMessageId }]
            : []),
        ],
      },
      { session: s },
    );
    if (own) return;
    const from = (m.from.match(/<([^>]+)>/)?.[1] ?? m.from)
      .trim()
      .toLowerCase();
    if (from === p.sender.toLowerCase() && from !== p.recipient) return;
    const associated =
      matchesOutboundReply(m, p.messageId) && from === p.recipient;
    const interpretation = interpretReply(m.text);
    if (m.deliveryReport) {
      interpretation.category = "delivery_failure";
      interpretation.reason =
        "Provider MIME identifies a delivery-status report; review the failure details.";
    } else if (
      m.autoSubmitted &&
      m.autoSubmitted !== "no" &&
      !["unsubscribe", "left_organisation", "out_of_office"].includes(
        interpretation.category,
      )
    ) {
      interpretation.category = "automated";
      interpretation.reason =
        "Auto-Submitted header indicates an automated response.";
    }
    const reply = event(
      w,
      "communication_reply",
      {
        communicationId: r.id,
        integrationId: p.integrationId,
        providerId: m.providerId,
        version: 1,
        testOnly: p.testOnly,
        message: m,
        contactId: associated ? p.draft.contactId : "",
        proposedContactId: p.draft.contactId,
        associated,
        reviewed: false,
        interpretation,
      },
      undefined,
      { occurredAt: new Date(m.occurredAt) },
    );
    await db.collection("events").insertOne(reply, { session: s });
    await recordOutcome(db, s, r, reply);
    if (p.testOnly) return;
    if (!associated) {
      await applyRestriction(db, s, w, r, reply.id, "unclear");
      return;
    }
    await interaction(
      db,
      s,
      w,
      r,
      "inbound",
      m.subject,
      m.text,
      from,
      m.internetMessageId || m.providerId,
      reply.id,
    );
    await applyRestriction(db, s, w, r, reply.id, interpretation.category);
    await db.collection("events").insertOne(
      event(w, "nba_communication_event", {
        communicationId: r.id,
        replyId: reply.id,
        contactId: p.draft.contactId,
        campaignId: p.draft.campaignId,
        nbaDecisionId: p.draft.nbaDecisionId,
        requiresReview: true,
        interpretation,
        testOnly: false,
      }),
      { session: s },
    );
  }
  async function applyRestriction(
    db: Db,
    s: ClientSession,
    w: string,
    r: Document,
    replyId: string,
    category: string,
  ) {
    if (r.payload.testOnly) return;
    const p = r.payload;
    if (
      [
        "unsubscribe",
        "not_interested",
        "left_organisation",
        "delivery_failure",
      ].includes(category)
    ) {
      await db.collection("events").insertOne(
        event(w, "communication_suppression", {
          contactId: p.draft.contactId,
          recipient: ["unsubscribe", "not_interested"].includes(category)
            ? "*"
            : p.recipient,
          replyId,
          category,
          active: true,
        }),
        { session: s },
      );
    }
    // All replies stop conflicting queued follow-ups. They require a fresh explicit review.
    const pending = await db
      .collection("events")
      .find(
        {
          workspaceId: w,
          eventType: kind,
          "payload.testOnly": false,
          "payload.draft.contactId": p.draft.contactId,
          "payload.status": "scheduled",
        },
        { session: s },
      )
      .toArray();
    for (const other of pending)
      await change(db, s, other, {
        status: "blocked",
        notice: "An incoming reply needs review before further contact.",
      });
  }
  async function syncOne(w: string, id: string) {
    await mailbox.locked(w, async (db) => {
      let r: Document = await get(db, w, id);
      if (!["accepted", "unknown", "sending"].includes(r.payload.status))
        return;
      const { r: connection, client, tokens } = await mailbox.connected(db, w);
      if (r.payload.connectionVersion !== connection.connectedAt.toISOString())
        return;
      if (!r.payload.threadId) {
        const found = await client.findSent(
          tokens.accessToken,
          r.payload.messageId,
        );
        if (!found) {
          await tx(w, async (db, s) => {
            r = await get(db, w, id, s);
            await change(db, s, r, {
              status: "unknown",
              checkedAt: new Date().toISOString(),
              notice:
                "No matching sent message found yet. Outcome remains uncertain; do not resend.",
            });
          });
          return;
        }
        await tx(w, async (db, s) => {
          r = await get(db, w, id, s);
          r = await change(db, s, r, {
            status: "accepted",
            providerId: found.id,
            threadId: found.threadId,
            notice:
              "Gmail acceptance recovered. This does not confirm delivery.",
          });
          await interaction(
            db,
            s,
            w,
            r,
            "outbound",
            r.payload.rendered.subject,
            r.payload.rendered.text,
            r.payload.recipient,
            r.payload.messageId,
          );
        });
      }
      const messages = await client.thread(
        tokens.accessToken,
        r.payload.threadId,
      );
      await tx(w, async (db, s) => {
        r = await get(db, w, id, s);
        for (const m of messages) {
          if (
            m.providerId === r.payload.providerId ||
            m.internetMessageId === r.payload.messageId
          )
            continue;
          await ingest(db, s, w, r, m);
        }
        await db.collection("events").updateOne(
          { id, workspaceId: w },
          {
            $set: {
              "payload.checkedAt": new Date().toISOString(),
              "payload.syncedAt": new Date().toISOString(),
            },
          },
          { session: s },
        );
      });
    });
  }
  async function review(
    u: AuthenticatedUser,
    w: string,
    id: string,
    raw: unknown,
  ) {
    const i = reviewReply.parse(raw);
    return mailbox.locked(w, () =>
      tx(w, async (db, s) => {
        const actor = await access(db, u, w, "update", s);
        const reply = await db
          .collection("events")
          .findOne(
            { workspaceId: w, id, eventType: "communication_reply" },
            { session: s },
          );
        if (!reply || reply.payload.version !== i.expectedVersion)
          throw new HiveConflict("Reply changed. Refresh first.");
        const r = await get(db, w, reply.payload.communicationId, s);
        const person = i.personId || reply.payload.contactId;
        if (person !== r.payload.draft.contactId)
          throw new HiveConflict(
            "Link only to the intended contact after reviewing the sender. Other identities must be reviewed separately.",
          );
        const p = {
          ...reply.payload,
          contactId: person,
          associated: true,
          reviewed: true,
          returnAt: i.returnAt,
          version: reply.payload.version + 1,
          interpretation: {
            ...reply.payload.interpretation,
            category: i.category,
            status: "reviewed",
            reason: i.reason,
          },
        };
        await db
          .collection("events")
          .updateOne(
            { workspaceId: w, id, "payload.version": i.expectedVersion },
            { $set: { payload: p, updatedAt: new Date() } },
            { session: s },
          );
        await db
          .collection("events")
          .insertOne(
            event(
              w,
              "communication_reply_review",
              { replyId: id, ...p },
              actor,
            ),
            { session: s },
          );
        await interaction(
          db,
          s,
          w,
          r,
          "inbound",
          p.message.subject,
          p.message.text,
          p.message.from,
          p.message.internetMessageId || p.message.providerId,
          id,
        );
        if (i.clearRestriction) {
          if (
            [
              "unsubscribe",
              "not_interested",
              "left_organisation",
              "delivery_failure",
            ].includes(i.category)
          )
            throw new HiveConflict(
              "Choose a corrected interpretation before clearing this reply restriction.",
            );
          await db.collection("events").updateMany(
            {
              workspaceId: w,
              eventType: "communication_suppression",
              "payload.replyId": id,
              "payload.active": true,
            },
            {
              $set: {
                "payload.active": false,
                "payload.resolutionReason": i.reason,
                updatedAt: new Date(),
              },
            },
            { session: s },
          );
        }
        if (!p.testOnly && i.category === "left_organisation")
          await db.collection("contact_points").updateOne(
            {
              workspaceId: w,
              id: r.payload.contactPointId,
              personId: person,
            },
            {
              $set: {
                suppressed: true,
                leftOrganisation: true,
                updatedAt: new Date(),
                updatedBy: actor,
              },
            },
            { session: s },
          );
        await applyRestriction(db, s, w, r, id, i.category);
        if (!p.testOnly)
          await db.collection("events").insertOne(
            event(w, "nba_communication_event", {
              communicationId: r.id,
              replyId: id,
              contactId: person,
              campaignId: r.payload.draft.campaignId,
              nbaDecisionId: r.payload.draft.nbaDecisionId,
              requiresReview: true,
              interpretation: p.interpretation,
              testOnly: false,
            }),
            { session: s },
          );
        await recordOutcome(db, s, r, {
          ...reply,
          payload: p,
          updatedAt: new Date(),
        });
        return publicRow({ ...reply, payload: p });
      }),
    );
  }
  return {
    list,
    async measurement(
      u: AuthenticatedUser,
      w: string,
      filter: Parameters<typeof readMeasurement>[2],
    ) {
      const db = await mongo.database();
      await access(db, u, w, "read");
      return readMeasurement(db, w, filter);
    },
    create,
    mutate,
    review,
    async sync(u: AuthenticatedUser, w: string) {
      await access(await mongo.database(), u, w, "update");
      const rows = await (
        await mongo.database()
      )
        .collection("events")
        .find({
          workspaceId: w,
          eventType: kind,
          "payload.status": { $in: ["accepted", "unknown"] },
        })
        .sort({ "payload.checkedAt": 1 })
        .limit(10)
        .toArray();
      for (const r of rows) await syncOne(w, r.id);
      return list(u, w);
    },
    async tick() {
      const db = await mongo.database();
      const rows = await db
        .collection("events")
        .find({
          eventType: kind,
          "payload.status": {
            $in: ["scheduled", "accepted", "sending", "unknown"],
          },
        })
        .sort({ "payload.checkedAt": 1 })
        .limit(30)
        .toArray();
      for (const r of rows) {
        try {
          if (r.payload.status === "scheduled")
            await dispatch(r.workspaceId, r.id);
          else if (
            r.payload.status !== "sending" ||
            Date.now() - Date.parse(r.payload.dispatchStartedAt) > 180000
          )
            await syncOne(r.workspaceId, r.id);
        } catch {
          /* bounded next tick; no blind resend */
        }
        await db
          .collection("events")
          .updateOne(
            { id: r.id, workspaceId: r.workspaceId },
            { $set: { "payload.checkedAt": new Date().toISOString() } },
          );
      }
    },
  };
}
