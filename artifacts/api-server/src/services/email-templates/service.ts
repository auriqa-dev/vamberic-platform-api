import sharp from "sharp";
import { createBrandImageStore } from "../brand-images";
import { z } from "zod";
import type { Db, ClientSession, Document } from "mongodb";
import type { AppConfig } from "../../config";
import type { MongoService } from "../mongo";
import type { AuthenticatedUser } from "../../middlewares/auth";
import {
  EventSchema,
  generatePlatformId,
  platformIdSchema,
} from "../../domain";
import { contentAccess, fingerprint } from "../content-strategy/application";
import { resolveHvmContext } from "../hvm-context";
import { readCurrentBrandKit } from "../brand-kits";
import { lockIcpWorkspace } from "../icp/access";
import { HiveConflict } from "../hive-definitions";
import { emailRecord, type EmailRecord } from "../email-content/model";
import { templateSettings, personal, branded, renderTemplate, type TemplateSettings } from "./render";
const kind = "email_template";
const change = z
  .object({
    requestKey: z.string().uuid(),
    id: z.string().default(""),
    expectedVersion: z.number().int().nonnegative().default(0),
    brandId: platformIdSchema("brand"),
    operation: z.enum([
      "save",
      "approve",
      "retire",
      "delete",
      "default",
      "duplicate",
    ]),
    settings: templateSettings.optional(),
  })
  .strict();
export function createEmailTemplates(config: AppConfig, mongo: MongoService) {
  async function kit(db: Db, u: AuthenticatedUser, w: string, b: string) {
    const auth = await resolveHvmContext(db, config, u);
    return (
      (await readCurrentBrandKit(db, auth.authority, auth.context, w, b))
        ?.kit || null
    );
  }
  async function rows(db: Db, w: string, b: string, s?: ClientSession) {
    return db
      .collection("events")
      .find(
        { workspaceId: w, eventType: kind, "payload.brandId": b },
        { session: s },
      )
      .toArray();
  }
  const publicRow = (r: Document) => ({ id: r.id, ...r.payload });
  async function list(u: AuthenticatedUser, w: string, b: string) {
    platformIdSchema("brand").parse(b);
    const db = await mongo.database();
    await contentAccess(db, config, u, w, "read");
    await kit(db, u, w, b);
    return (await rows(db, w, b)).map(publicRow);
  }
  async function mutate(u: AuthenticatedUser, w: string, raw: unknown) {
    const i = change.parse(raw);
    if (!mongo.withTransaction)
      throw new HiveConflict("Transactions unavailable.");
    return mongo.withTransaction(async (db, s) => {
      const actor = await contentAccess(
        db,
        config,
        u,
        w,
        i.operation === "approve" || i.operation === "default"
          ? "approve"
          : "update",
        s,
      );
      await lockIcpWorkspace(db, w, s);
      const replay = await db
        .collection("events")
        .findOne(
          {
            workspaceId: w,
            eventType: "email_template_history",
            "payload.requestKey": i.requestKey,
          },
          { session: s },
        );
      if (replay) {
        if (replay.payload.requestHash !== fingerprint(i))
          throw new HiveConflict(
            "This request was already used for another change.",
          );
        return { id: replay.payload.templateId, ...replay.payload };
      }

      const brand = await db.collection("brands").findOne(
        {
          id: i.brandId,
          workspaceId: w,
          archived: { $ne: true },
          status: "active",
        },
        { session: s },
      );
      if (!brand)
        throw new HiveConflict("Select an active brand in this workspace.");
      const all = await rows(db, w, i.brandId, s),
        old = all.find((r) => r.id === i.id);
      if (i.id && (!old || old.payload.version !== i.expectedVersion))
        throw new HiveConflict("Template changed. Refresh before continuing.");
      if (!old && i.operation !== "save")
        throw new HiveConflict("Save the template first.");
      if (i.operation === "delete") {
        if (
          old!.payload.status !== "draft" ||
          (await db.collection("events").findOne(
            {
              workspaceId: w,
              eventType: "communication",
              "payload.template.id": i.id,
            },
            { session: s },
          )) ||
          (await db.collection("events").findOne(
            {
              workspaceId: w,
              eventType: "email_template_history",
              "payload.templateId": i.id,
              "payload.status": "approved",
            },
            { session: s },
          ))
        )
          throw new HiveConflict(
            "This template has approved or delivery history. Retire it instead.",
          );
        await db
          .collection("events")
          .deleteOne(
            { id: i.id, workspaceId: w, eventType: kind },
            { session: s },
          );
        return { deleted: true, id: i.id };
      }
      if (i.operation === "default" && old!.payload.status !== "approved")
        throw new HiveConflict(
          "Approve the template before making it the default.",
        );
      const fresh = !old || i.operation === "duplicate";
      const id = fresh ? generatePlatformId("event") : old!.id;
      const settings =
        i.operation === "save"
          ? templateSettings.parse(i.settings)
          : templateSettings.parse(old!.payload.settings);
      const payload = {
        requestKey: i.requestKey,
        requestHash: fingerprint(i),
        brandId: i.brandId,
        version: fresh ? 1 : old!.payload.version + 1,
        status:
          i.operation === "approve"
            ? "approved"
            : i.operation === "retire"
              ? "retired"
              : i.operation === "default"
                ? "approved"
                : "draft",
        isDefault: i.operation === "default",
        settings,
      };
      if (i.operation === "default")
        for (const r of all.filter((r) => r.payload.isDefault && r.id !== id))
          await db
            .collection("events")
            .updateOne(
              { id: r.id, workspaceId: w },
              { $set: { "payload.isDefault": false } },
              { session: s },
            );
      const now = new Date();
      const record = EventSchema.parse({
        id,
        workspaceId: w,
        eventType: kind,
        createdAt: old?.createdAt || now,
        updatedAt: now,
        occurredAt: now,
        createdBy: actor,
        payload,
      });
      if (fresh)
        await db.collection("events").insertOne(record, { session: s });
      else
        await db
          .collection("events")
          .replaceOne({ id, workspaceId: w, eventType: kind }, record, {
            session: s,
          });
      await db.collection("events").insertOne(
        EventSchema.parse({
          ...record,
          id: generatePlatformId("event"),
          eventType: "email_template_history",
          payload: { ...payload, templateId: id },
        }),
        { session: s },
      );
      return publicRow(record);
    });
  }
  async function resolve(
    db: Db,
    u: AuthenticatedUser,
    w: string,
    d: EmailRecord,
    id = "",
    s?: ClientSession,
    deliveryUrl?: string,
    previewSettings?: TemplateSettings,
  ) {
    await contentAccess(db, config, u, w, "read", s);
    const all = await rows(db, w, d.brandId, s);
    const row =
      id && !["personal", "branded"].includes(id)
        ? all.find((r) => r.id === id)
        : id
          ? undefined
          : all.find(
              (r) => r.payload.isDefault && r.payload.status === "approved",
            );
    if (
      id &&
      !["personal", "branded"].includes(id) &&
      (!row || row.payload.status !== "approved")
    )
      throw new HiveConflict("Choose an approved template.");
    const settings = previewSettings ?? (row
      ? templateSettings.parse(row.payload.settings)
      : id === "branded"
        ? branded
        : personal);
    const current = await kit(db, u, w, d.brandId);
    const template = {
      id: row?.id || (id === "branded" ? "branded" : "personal"),
      version: row?.payload.version || 1,
      settings,
      brandKitId: current?.id || "",
      brandRevision: current?.updatedAt.toISOString() || "",
      brandHash: fingerprint(current),
    };
    const rendered: ReturnType<typeof renderTemplate> & {
      inlineImages?: { cid: string; base64: string }[];
    } = renderTemplate(d, settings, current, false, deliveryUrl);
    if (settings.includeLogo && settings.layout === "branded") {
      const asset = current?.assets.find(
        (a) =>
          a.type === "logo" &&
          (a.variant === "primary" || a.variant === "light" || !a.variant) &&
          a.object.bucket === config.brandImages?.bucket &&
          a.object.key.startsWith(`brand-images/${w}/${d.brandId}/`) &&
          a.object.versionId,
      );
      if (asset && config.brandImages) {
        try {
          const store = createBrandImageStore(
            config.brandImages.bucket,
            config.brandImages.region,
          );
          const bytes = await store.get(
            asset.object.key,
            asset.object.versionId!,
          );
          const image = await sharp(bytes)
            .resize({
              width: 320,
              height: 160,
              fit: "inside",
              withoutEnlargement: true,
            })
            .png()
            .toBuffer();
          if (image.length > 256000) throw new Error("Logo too large");
          const base64 = image.toString("base64");
          rendered.inlineImages = [{ cid: "brand-logo", base64 }];
          rendered.html = rendered.html.replace(
            '<div style="white-space:',
            `<img src="cid:brand-logo" alt="Brand logo" style="display:block;max-width:100%;width:${settings.logoWidth}px;height:auto;margin:${settings.logoSpacing}px ${settings.logoAlignment === "centre" ? "auto" : settings.logoAlignment === "right" ? "0" : "auto"} ${settings.logoSpacing}px ${settings.logoAlignment === "left" ? "0" : "auto"}"><div style="white-space:`,
          );
        } catch {
          rendered.notice +=
            " Logo unavailable: text-only presentation is used.";
        }
      } else
        rendered.notice +=
          " No suitable approved logo: text-only presentation is used.";
    }
    return { template, rendered };
  }
  async function sample(u: AuthenticatedUser, w: string, raw: unknown) {
    const i = z.object({ brandId: platformIdSchema("brand"), settings: templateSettings }).strict().parse(raw);
    const db = await mongo.database();
    await contentAccess(db, config, u, w, "read");
    if (!await db.collection("brands").findOne({id:i.brandId,workspaceId:w,archived:{$ne:true}}))
      throw new HiveConflict("Choose a brand in this workspace.");
    // Preview-only text is never persisted as a draft or made eligible for sending.
    const draft = {brandId:i.brandId,content:{subject:"Sample email — design preview",body:"Hello Alex,\n\nThis sample shows your email layout, spacing and approved brand presentation. Your personalised message will appear here.\n\nWould you like to find out more?",ctaText:""},ctaUrl:""} as EmailRecord;
    const result = await resolve(db,u,w,draft,"personal",undefined,undefined,i.settings);
    result.rendered.notice = "Sample content only. Unsaved design preview; no email or contact has been created. " + result.rendered.notice;
    return result;
  }
  async function preview(u: AuthenticatedUser, w: string, raw: unknown) {
    const i = z
      .object({
        draftId: z.string(),
        draftVersion: z.number(),
        templateId: z.string().default(""),
      })
      .strict()
      .parse(raw);
    const db = await mongo.database();
    await contentAccess(db, config, u, w, "read");
    const r = await db
      .collection("events")
      .find({
        workspaceId: w,
        eventType: "email_content_record",
        "payload.record.id": i.draftId,
      })
      .sort({ "payload.record.version": -1 })
      .limit(1)
      .next();
    const d = r ? emailRecord.parse(r.payload.record) : null;
    if (!d || d.status === "removed" || d.version !== i.draftVersion)
      throw new HiveConflict("Save the current email before previewing.");
    return resolve(db, u, w, d, i.templateId);
  }
  return { list, mutate, preview, sample, resolve };
}
