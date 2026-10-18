import { logger } from "../../lib/logger";
import { getOfferMethodology } from "../../domain/offer-methodologies";
import { resolveHvmContext } from "../hvm-context";
import { createContactStrategies } from "../contact-strategy/application";
import { createPsuApplication } from "../psu/application";
import type { Db, ClientSession, Document } from "mongodb";
import type { AppConfig } from "../../config";
import type { AuthenticatedUser } from "../../middlewares/auth";
import type { MongoService } from "../mongo";
import { offerAuthority } from "../offers";
import {
  EventSchema,
  generatePlatformId,
  platformIdSchema,
} from "../../domain";
import { AuthorizationDenied } from "../../authorization/policy";
import { HiveConflict } from "../hive-definitions";
import { lockIcpWorkspace } from "../icp/access";
import { contentAccess, fingerprint, currentRecords } from "./application";
import { contentContext } from "./context";
import type { ContentGenerator } from "./generate";
import {
  workspaceHenryRequest,
  workspaceHenryReply,
  type HenryScreen,
} from "./henry-model";

export function validateHenryProposal(screen: HenryScreen, raw: unknown) {
  const reply = workspaceHenryReply.parse(raw);
  let omitted = false;
  const rejected: Record<string, number> = {};
  if (reply.actionId && !screen.actions.some((a) => a.id === reply.actionId)) {
    reply.actionId = "";
    omitted = true;
  }
  reply.changes = reply.changes.filter((change) => {
    const field = screen.editor?.fields.find((f) => f.key === change.key);
    let rejection = "unknown_or_duplicate_field";
    try {
      if (
        !field ||
        reply.changes.filter((c) => c.key === change.key).length !== 1
      )
        throw new Error();
      rejection = "invalid_editor_encoding";
      const before: unknown = JSON.parse(field.value);
      rejection = "invalid_proposal_encoding";
      const after: unknown = JSON.parse(change.value);
      rejection = "invalid_shape_or_unsafe_value";
      if (screen.editor?.key.startsWith("offer-review:")) {
        if (
          !Array.isArray(after) ||
          after.length !== 6 ||
          after.some((v) => typeof v !== "string" || v.length > 2000) ||
          !Array.isArray(before) ||
          after[0] !== before[0] ||
          !["supported_information", "assumption", "recommendation"].includes(
            after[3],
          ) ||
          !["review", "human_input"].includes(after[4])
        )
          throw new Error();
      }
      if (
        Array.isArray(before) !== Array.isArray(after) ||
        (before !== null &&
          (after === null || typeof before !== typeof after)) ||
        unsafeValue(after) ||
        change.key
          .split(".")
          .some((k) => ["__proto__", "prototype", "constructor"].includes(k))
      )
        throw new Error();
      return true;
    } catch {
      rejected[rejection] = (rejected[rejection] || 0) + 1;
      omitted = true;
      return false;
    }
  });
  if (Object.keys(rejected).length)
    logger.warn(
      { operation: "henry_proposal_validation", rejected },
      "Henry suggestions rejected",
    );
  if (omitted)
    reply.reply =
      reply.reply.slice(0, 11600) +
      (reply.changes.length
        ? "\n\nSome suggestions did not match the current form and were left out. The remaining suggestions are available for review; nothing has been saved or approved."
        : "\n\nNo editable suggestions passed the current form checks; they were left out. Nothing has been saved or approved.");
  return reply;
}
async function context(
  db: Db,
  config: AppConfig,
  identity: AuthenticatedUser,
  w: string,
  brandId: string,
  mongo: MongoService,
  session?: ClientSession,
  editorKey?: string,
) {
  // Use approved snapshots, never current draft definitions as approved facts.
  const products = await db
    .collection("offerings")
    .find(
      {
        workspaceId: w,
        brandId,
        archived: { $ne: true },
        status: { $ne: "retired" },
        approvedRevision: { $gt: 0 },
      },
      { session },
    )
    .sort({ id: 1 })
    .limit(20)
    .toArray();
  const productIds = products.map((p) => p.id);
  const selected: {
    brandId: string;
    products: { id: string; revision: number }[];
    offers: { id: string; revision: number }[];
    audiences: { id: string; revision: number }[];
  } = {
    brandId,
    products: products.map((p) => ({ id: p.id, revision: p.approvedRevision })),
    offers: [],
    audiences: [],
  };
  for (const [collection, key] of [
    ["offers", "offers"],
    ["ideal_customer_profiles", "audiences"],
  ] as const) {
    const rows = await db
      .collection(collection)
      .find(
        {
          workspaceId: w,
          offeringId: { $in: productIds },
          archived: { $ne: true },
          status: { $ne: "retired" },
          approvedRevision: { $gt: 0 },
        },
        { session },
      )
      .sort({ id: 1 })
      .limit(20)
      .toArray();
    selected[key] = rows.map((r) => ({
      id: r.id,
      revision: r.approvedRevision,
    }));
  }
  const approved = await contentContext(
    db,
    config,
    identity,
    w,
    selected,
    session,
  );
  const company = await createPsuApplication(
    config,
    mongo,
  ).approvedCompanyContext(identity, w, brandId, session);
  const library = await createContactStrategies(config, mongo).list(
    identity,
    w,
  );
  const policies = library.policies
    .filter(
      (p) =>
        p.status === "recorded" &&
        !p.organisationIds.length &&
        !p.personIds.length &&
        !p.contactPointIds.length &&
        !p.campaignIds.length &&
        !library.policies.some(
          (n) =>
            n.key === p.key && n.status !== "draft" && n.version > p.version,
        ),
    )
    .map((p) => ({
      key: p.key,
      version: p.version,
      status: p.status,
      clauses: p.clauses,
    }));
  const records = currentRecords(
    await db
      .collection("events")
      .find(
        { workspaceId: w, eventType: "content_strategy_record" },
        { session },
      )
      .toArray(),
  );
  const content = records
    .filter(
      (r) =>
        r.status === "approved" &&
        (r.data.scope as { brandId?: string } | undefined)?.brandId === brandId,
    )
    .slice(0, 20)
    .map((r) => ({
      id: r.id,
      kind: r.kind,
      version: r.version,
      title: r.data.title,
      objective: r.data.objective,
      businessObjectives: r.data.businessObjectives,
      requiredMessages: r.data.requiredMessages,
      constraints: r.data.constraints,
      sourceRecordIds: r.data.sourceRecordIds,
    }));
  let currentOfferReview: unknown = null;
  if (editorKey?.startsWith("offer-review:")) {
    const id = platformIdSchema("offer").parse(
      editorKey.slice("offer-review:".length),
    );
    await offerAuthority(db, config, identity, w, "offers", "read", session);
    await offerAuthority(
      db,
      config,
      identity,
      w,
      "offer_designs",
      "read",
      session,
    );
    const offer = await db
      .collection("offers")
      .findOne({ workspaceId: w, id, archived: { $ne: true } }, { session });
    const product =
      offer &&
      (await db.collection("offerings").findOne(
        {
          workspaceId: w,
          id: offer.offeringId,
          brandId,
          archived: { $ne: true },
        },
        { session },
      ));
    const design =
      offer &&
      (await db.collection("offer_designs").findOne(
        {
          workspaceId: w,
          id: offer.offerDesignId,
          offeringId: offer.offeringId,
          archived: { $ne: true },
        },
        { session },
      ));
    if (!offer || !product || !design)
      throw new HiveConflict(
        "This offer is no longer available in the selected brand.",
      );
    currentOfferReview = {
      informationStatus:
        "Current working draft and human review decisions, not approved facts",
      selectedProduct: {
        id: product.id,
        revision: product.revision,
        status: product.status,
        definition: product.definition,
        informationStatus:
          "Recorded product context. Use approved snapshots above for approved facts; current entries may be suggestions.",
      },
      offerId: offer.id,
      definition: offer.definition,
      offerUpdatedAt: offer.updatedAt,
      methodology: getOfferMethodology(
        design.methodologyId,
        design.methodologyVersion,
      ),
      designId: design.id,
      work: design.work,
      designUpdatedAt: design.updatedAt,
      sourceReferences: design.sourceReferences,
    };
  }
  let campaigns: unknown[] = [];
  let campaignContextStatus =
    "Unavailable with current permissions; do not infer absence.";
  try {
    const access = await resolveHvmContext(db, config, identity, session);
    access.authority.scopeFilter(access.context, "read", {
      type: "campaigns",
      workspaceId: w,
    });
    const rows = await db
      .collection("events")
      .find({ workspaceId: w, eventType: "campaign_setup" }, { session })
      .sort({ "payload.version": -1, createdAt: -1 })
      .limit(200)
      .toArray();
    const seen = new Set<string>();
    campaigns = rows
      .filter((row) => {
        if (seen.has(row.campaignId)) return false;
        seen.add(row.campaignId);
        return (
          row.payload.setup?.brandId === brandId &&
          !["deleted", "archived"].includes(row.payload.status)
        );
      })
      .slice(0, 20)
      .map((row) => ({
        id: row.campaignId,
        version: row.payload.version,
        status: row.payload.status,
        name: row.payload.setup.name,
        objective: row.payload.setup.objective,
        goal: row.payload.setup.goal,
        products: row.payload.setup.products,
        offers: row.payload.setup.offers,
        audiences: row.payload.setup.audiences,
      }));
    const journeyRows = await db
      .collection("events")
      .find({ workspaceId: w, eventType: "campaign_journey" }, { session })
      .sort({ "payload.version": -1 })
      .limit(200)
      .toArray();
    campaigns = campaigns.map((value) => {
      const c = value as { id: string; version: number };
      const j = journeyRows.find((row) => row.campaignId === c.id);
      return {
        ...c,
        preparation: j
          ? {
              version: j.payload.version,
              status:
                j.payload.campaignVersion === c.version
                  ? j.payload.status
                  : "review_required",
              recipientCount:
                j.payload.recipientCount ?? j.payload.recipients?.length ?? 0,
              launchRequiresCurrentReview: true,
            }
          : null,
      };
    });
    campaignContextStatus =
      "Saved campaign plans, including drafts. Drafts are not approved or executing. Bounded recent context; do not infer that omitted plans do not exist.";
  } catch (error) {
    if (!(error instanceof AuthorizationDenied)) throw error;
  }
  const websiteTracking = (
    await db
      .collection("events")
      .find(
        {
          workspaceId: w,
          eventType: "website_tracking_site",
          "payload.brandId": brandId,
        },
        { session },
      )
      .limit(20)
      .toArray()
  ).map((r) => ({
    origin: r.payload.origin,
    enabled: r.payload.enabled,
    verified: !!r.payload.verifiedAt,
    testOnly: r.payload.testOnly,
    revoked: r.payload.revoked,
    lastReceivedAt: r.payload.lastReceivedAt,
  }));
  const value = {
    ...approved,
    company,
    policies,
    content,
    currentOfferReview,
    campaigns,
    campaignContextStatus,
    websiteTracking,
    websiteTrackingGuidance:
      "Manage website tracking in Integrations. Browser activity requires consent; forwarded links only identify intended recipients. Tracking is never sending authority or proof of conversion.",
  };
  return { ...value, hash: fingerprint(value) };
}
export function createWorkspaceHenry(
  config: AppConfig,
  mongo: MongoService,
  generate?: ContentGenerator,
) {
  return {
    async list(identity: AuthenticatedUser, w: string, brandId: string) {
      const db = await mongo.database(),
        actor = await contentAccess(db, config, identity, w, "read");
      const brands = await db
        .collection("brands")
        .find(
          {
            workspaceId: w,
            archived: { $ne: true },
            status: { $ne: "retired" },
          },
          { projection: { id: 1, name: 1 } },
        )
        .sort({ id: 1 })
        .toArray();
      if (brandId && !brands.some((b) => b.id === brandId))
        throw new HiveConflict("Select a current workspace brand.");
      const rows = brandId
        ? await db
            .collection("events")
            .find({
              workspaceId: w,
              eventType: "content_strategy_generation",
              "payload.task": "workspace_henry",
              "createdBy.id": actor.id,
              "payload.actorIssuer": actor.issuer,
              "payload.brandId": brandId,
              "payload.status": "completed",
            })
            .sort({ createdAt: -1 })
            .limit(50)
            .toArray()
        : [];
      const turns = [];
      for (const e of rows) {
        const saved = await readParts(db, w, e, "screen"),
          result = await readParts(db, w, e, "result");
        turns.push({
          id: e.id,
          conversationId: e.payload.conversationId,
          brandId: e.payload.brandId,
          section: saved.section,
          instruction: e.payload.instruction,
          result,
          screen: saved,
          createdAt: new Date(e.createdAt).toISOString(),
        });
      }
      let available = !!generate && !!mongo.withTransaction;
      try {
        await contentAccess(db, config, identity, w, "update");
      } catch (error) {
        if (error instanceof AuthorizationDenied) available = false;
        else throw error;
      }
      return {
        brands: brands.map((b) => ({ id: b.id, name: b.name })),
        available,
        turns,
      };
    },
    async ask(identity: AuthenticatedUser, w: string, raw: unknown) {
      const input = workspaceHenryRequest.parse(raw);
      if (!generate || !mongo.withTransaction)
        throw new HiveConflict(
          "Henry is temporarily unavailable. Your existing records are unchanged.",
        );
      const tx = mongo.withTransaction.bind(mongo);
      const reserved = await tx(async (db, session) => {
        const actor = await contentAccess(
          db,
          config,
          identity,
          w,
          "update",
          session,
        );
        const now = await lockIcpWorkspace(db, w, session);
        const owned = {
          workspaceId: w,
          eventType: "content_strategy_generation",
          "payload.task": "workspace_henry",
          "createdBy.id": actor.id,
          "payload.actorIssuer": actor.issuer,
        };
        const old = await db
          .collection("events")
          .findOne(
            { ...owned, "payload.requestKey": input.requestKey },
            { session },
          );
        if (old) {
          if (old.payload.requestHash !== fingerprint(input))
            throw new HiveConflict("Request identity changed.");
          if (old.payload.status === "completed")
            return { old: await readParts(db, w, old, "result", session) };
          throw new HiveConflict(
            "This request is running or interrupted. Refresh to recover a completed reply; otherwise retry after two minutes.",
          );
        }
        if (
          await db.collection("events").findOne(
            {
              ...owned,
              "payload.status": "generating",
              createdAt: { $gt: new Date(Date.now() - 120000) },
            },
            { session },
          )
        )
          throw new HiveConflict(
            "Henry is still working on your previous message.",
          );
        const approved = await context(
          db,
          config,
          identity,
          w,
          input.screen.brandId,
          mongo,
          session,
          input.screen.editor?.key,
        );
        const history = await db
          .collection("events")
          .find(
            {
              ...owned,
              "payload.brandId": input.screen.brandId,
              "payload.conversationId": input.conversationId,
              "payload.status": "completed",
            },
            { session },
          )
          .sort({ createdAt: -1 })
          .limit(12)
          .toArray();
        const conversation = [];
        for (const e of history.reverse()) {
          const result = await readParts(db, w, e, "result", session);
          const previousScreen = await readParts(db, w, e, "screen", session);
          conversation.push({
            user: e.payload.instruction,
            reply: result.reply,
            objective: result.objective,
            section: e.payload.section,
            unapprovedSuggestions: result.changes,
            originalPageContext: previousScreen.summary.slice(0, 4000),
            originalEditor: previousScreen.editor?.key,
          });
        }
        if (
          Buffer.byteLength(
            JSON.stringify({ approved, conversation, screen: input.screen }),
          ) > 650000
        )
          throw new HiveConflict(
            "This context is too large. Open a smaller editor or start a new conversation.",
          );
        const event = EventSchema.parse({
          id: generatePlatformId("event"),
          workspaceId: w,
          eventType: "content_strategy_generation",
          occurredAt: now,
          createdAt: now,
          updatedAt: now,
          createdBy: actor,
          updatedBy: actor,
          source: { system: "hvm_henry" },
          payload: {
            task: "workspace_henry",
            status: "generating",
            requestKey: input.requestKey,
            requestHash: fingerprint(input),
            conversationId: input.conversationId,
            actorIssuer: actor.issuer,
            brandId: input.screen.brandId,
            section: input.screen.section,
            instruction: input.instruction,
            contextHash: approved.hash,
          },
        });
        event.payload.screenParts = await writeParts(
          db,
          event,
          "screen",
          input.screen,
          session,
        );
        await db
          .collection("events")
          .insertOne(EventSchema.parse(event), { session });
        return { event, approved, conversation };
      });
      if (reserved.old) return workspaceHenryReply.parse(reserved.old);
      const { event, approved, conversation } = reserved;
      let usage: Awaited<ReturnType<ContentGenerator>>["usage"] | undefined;
      try {
        const response = await generate("workspace_henry", {
          instruction: input.instruction,
          objective: input.objective,
          screen: input.screen,
          approvedContext: approved,
          conversation,
          contextCoverage:
            "Up to 20 approved products, offers and audiences each; not an exhaustive CRM search. Contact details are provided only from the open editor.",
        });
        usage = response.usage;
        const result = validateHenryProposal(input.screen, response.result);
        await tx(async (db, session) => {
          await contentAccess(db, config, identity, w, "update", session);
          await lockIcpWorkspace(db, w, session);
          const fresh = await context(
            db,
            config,
            identity,
            w,
            input.screen.brandId,
            mongo,
            session,
            input.screen.editor?.key,
          );
          if (fresh.hash !== approved.hash)
            throw new HiveConflict(
              "Business context or offer decisions changed. Ask Henry again with the current context.",
            );
          if (Date.now() - new Date(event.createdAt).getTime() > 120000)
            throw new HiveConflict("This request expired. Ask Henry again.");
          const resultParts = await writeParts(
            db,
            event,
            "result",
            result,
            session,
          );
          const saved = await db.collection("events").updateOne(
            { id: event.id, workspaceId: w, "payload.status": "generating" },
            {
              $set: {
                "payload.status": "completed",
                "payload.resultParts": resultParts,
                "payload.usage": usage,
              },
            },
            { session },
          );
          if (!saved.matchedCount)
            throw new HiveConflict("This request is no longer current.");
        });
        return result;
      } catch (error) {
        const db = await mongo.database();
        await db.collection("events").updateOne(
          { id: event.id, workspaceId: w, "payload.status": "generating" },
          {
            $set: {
              "payload.status": "failed",
              ...(usage ? { "payload.usage": usage } : {}),
              ...(error && typeof error === "object" && "usage" in error
                ? { "payload.usage": error.usage }
                : {}),
            },
          },
        );
        throw error;
      }
    },
  };
}

function unsafeValue(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(unsafeValue);
  return Object.entries(value).some(
    ([key, value]) =>
      ["__proto__", "prototype", "constructor"].includes(key) ||
      unsafeValue(value),
  );
}
// The established events metadata limit is 16 KB. Keep large editor snapshots and
// replies in bounded, hash-checked parts of the same protected event type.
async function writeParts(
  db: Db,
  parent: Document,
  kind: "screen" | "result",
  value: unknown,
  session?: ClientSession,
) {
  const text = JSON.stringify(value);
  let offset = 0,
    count = 0;
  while (offset < text.length) {
    let length = Math.min(8000, text.length - offset);
    while (JSON.stringify(text.slice(offset, offset + length)).length > 12000)
      length = Math.floor(length / 2);
    const part = EventSchema.parse({
      ...parent,
      id: generatePlatformId("event"),
      payload: {
        task: "workspace_henry",
        status: "part",
        parentId: parent.id,
        kind,
        ordinal: count,
        text: text.slice(offset, offset + length),
      },
    });
    await db.collection("events").insertOne(part, { session });
    offset += length;
    count++;
  }
  return { count, hash: fingerprint(value) };
}
async function readParts(
  db: Db,
  w: string,
  parent: Document,
  kind: "screen" | "result",
  session?: ClientSession,
): Promise<Document> {
  const expected = parent.payload[kind + "Parts"];
  const parts = await db
    .collection("events")
    .find(
      {
        workspaceId: w,
        eventType: "content_strategy_generation",
        "payload.task": "workspace_henry",
        "payload.status": "part",
        "payload.parentId": parent.id,
        "payload.kind": kind,
      },
      { session },
    )
    .sort({ "payload.ordinal": 1 })
    .limit(1000)
    .toArray();
  if (
    !expected ||
    parts.length !== expected.count ||
    parts.some((p, i) => p.payload.ordinal !== i)
  )
    throw new HiveConflict(
      "Conversation content is incomplete. Your application records are unchanged.",
    );
  const value = JSON.parse(parts.map((p) => p.payload.text).join(""));
  if (fingerprint(value) !== expected.hash)
    throw new HiveConflict(
      "Conversation content changed. Your application records are unchanged.",
    );
  return value;
}
