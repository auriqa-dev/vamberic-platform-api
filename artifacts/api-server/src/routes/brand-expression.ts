import { Router, type ErrorRequestHandler } from "express";
import { z, ZodError } from "zod";
import type { AppConfig } from "../config";
import type { MongoService } from "../services/mongo";
import type { Db, ClientSession } from "mongodb";
import type { AuthenticatedUser } from "../middlewares/auth";
import { withoutMongoId, resolveHvmContext } from "../services/hvm-context";
import { AuthorizationDenied } from "../authorization/policy";
import {
  EventSchema,
  generatePlatformId,
  platformIdSchema,
  partnerHumanSchema,
} from "../domain";
import { CommunicationFormatSchema } from "../domain/brand-expression";
import { readCurrentBrandKit } from "../services/brand-kits";
import { projectBrandContext } from "../services/brand-context";
import {
  BrandGenerationFailure,
  type BrandGenerator,
} from "../services/brand-expression/generate";
class Conflict extends Error {}
const inputSchema = z
  .object({
    requestKey: z.string().uuid(),
    mode: z.enum(["interpret", "preview"]),
    description: z.string().trim().min(1).max(4000),
    format: CommunicationFormatSchema.default("website"),
    useDrafts: z.boolean().default(false),
  })
  .strict();
export function createBrandExpressionRouter(
  config: AppConfig,
  mongo: MongoService,
  generate?: BrandGenerator,
) {
  const router = Router(),
    root = "/workspaces/:workspaceId/brands/:brandId/expression";
  async function access(
    db: Db,
    identity: AuthenticatedUser,
    w: string,
    b: string,
    action: "read" | "update",
    session?: ClientSession,
  ) {
    platformIdSchema("workspace").parse(w);
    platformIdSchema("brand").parse(b);
    const resolved = await resolveHvmContext(db, config, identity, session);
    const scope = resolved.authority.scopeFilter(resolved.context, action, {
      type: "brand_kits",
      workspaceId: w,
    });
    resolved.authority.scopeFilter(resolved.context, "read", {
      type: "brands",
      workspaceId: w,
    });
    if (
      !(await db
        .collection("brands")
        .findOne(
          { ...scope, id: b, status: "active", archived: { $ne: true } },
          { session },
        ))
    )
      throw new AuthorizationDenied();
    return resolved;
  }
  router.get(root + "/context", async (req, res) => {
    const { format } = z
      .object({ format: CommunicationFormatSchema })
      .strict()
      .parse(req.query);
    const db = await mongo.database(),
      w = String(req.params.workspaceId),
      b = String(req.params.brandId);
    const r = await access(db, req.auth!, w, b, "read");
    const current = await readCurrentBrandKit(db, r.authority, r.context, w, b);
    res.json({
      context: current ? projectBrandContext(current.kit, format) : null,
    });
  });
  router.get(root + "/generations/:id", async (req, res) => {
    const w = String(req.params.workspaceId),
      b = String(req.params.brandId),
      db = await mongo.database();
    await access(db, req.auth!, w, b, "read");
    const id = platformIdSchema("event").parse(req.params.id);
    const row = await db.collection("events").findOne({
      id,
      workspaceId: w,
      eventType: "brand_expression_generation",
      "payload.brandId": b,
    });
    if (!row) throw new AuthorizationDenied();
    res.json({
      id,
      ...row.payload,
      status:
        row.payload.status === "generating" &&
        Date.now() - row.createdAt.getTime() > 180000
          ? "interrupted"
          : row.payload.status,
    });
  });
  router.post(root + "/generations", async (req, res) => {
    const input = inputSchema.parse(req.body),
      w = String(req.params.workspaceId),
      b = String(req.params.brandId);
    if (!generate || !mongo.withTransaction)
      throw new Error("Generation unavailable");
    const prepared = await mongo.withTransaction(async (db, session) => {
      const r = await access(db, req.auth!, w, b, "update", session);
      const ledger = await db
        .collection("schema_versions")
        .findOne({ _id: "vapp-v1" } as import("mongodb").Document, { session });
      if (![25, 26, 27, 28, 29, 30].includes(ledger?.version))
        throw new Error("Brand expression schema is unavailable");
      const ws = await db
        .collection("crm_workspaces")
        .findOne({ id: w, archived: { $ne: true } }, { session });
      if (!ws) throw new AuthorizationDenied();
      const now = new Date(Math.max(Date.now(), ws.updatedAt.getTime() + 1));
      await db
        .collection("crm_workspaces")
        .updateOne(
          { id: w, updatedAt: ws.updatedAt },
          { $set: { updatedAt: now } },
          { session },
        );
      const previous = await db.collection("events").findOne(
        {
          workspaceId: w,
          eventType: "brand_expression_generation",
          "payload.input.requestKey": input.requestKey,
        },
        { session },
      );
      if (previous) {
        if (
          previous.payload.brandId !== b ||
          JSON.stringify(previous.payload.input) !== JSON.stringify(input)
        )
          throw new Conflict("Request changed");
        return { fresh: false, id: previous.id, context: null };
      }
      if (
        await db.collection("events").findOne(
          {
            workspaceId: w,
            eventType: "brand_expression_generation",
            "payload.brandId": b,
            "payload.status": "generating",
            createdAt: { $gte: new Date(Date.now() - 180000) },
          },
          { session },
        )
      )
        throw new Conflict("A preview is already running");
      const current = await readCurrentBrandKit(
        db,
        r.authority,
        r.context,
        w,
        b,
      );
      if (input.mode === "preview" && !current)
        throw new Conflict("Save brand settings before previewing");
      const context = current
        ? input.mode === "interpret"
          ? {
              currentSettings: Object.fromEntries(
                (["personality", "tone", "writingStyle"] as const).map(
                  (key) => [
                    key,
                    (
                      current.kit.expression?.[key]?.draft ??
                      current.kit.expression?.[key]?.approved
                    )?.content ?? null,
                  ],
                ),
              ),
              legacyContext: projectBrandContext(current.kit, input.format),
            }
          : projectBrandContext(current.kit, input.format, input.useDrafts)
        : null;
      const id = generatePlatformId("event"),
        actor = partnerHumanSchema.parse(r.context.actor);
      await db.collection("events").insertOne(
        EventSchema.parse({
          id,
          workspaceId: w,
          eventType: "brand_expression_generation",
          occurredAt: now,
          createdAt: now,
          updatedAt: now,
          actor,
          payload: {
            brandId: b,
            input,
            status: "generating",
            kitId: current?.kit.id ?? null,
            kitRevision: current?.kit.updatedAt.toISOString() ?? null,
          },
        }),
        { session },
      );
      return { fresh: true, id, context };
    });
    if (prepared.fresh) {
      void (async () => {
        const db = await mongo.database();
        let usage: Awaited<ReturnType<BrandGenerator>>["usage"] | undefined;
        try {
          const result = await generate(
            {
              mode: input.mode,
              description: input.description,
              format: input.format,
              context: prepared.context,
            },
            AbortSignal.timeout(120000),
          );
          usage = result.usage;
          await access(db, req.auth!, w, b, "update");
          const row = await db.collection("events").findOne({
            id: prepared.id,
            workspaceId: w,
            "payload.status": "generating",
          });
          if (!row) return;
          const checked = EventSchema.parse({
            ...withoutMongoId(row),
            payload: { ...row.payload, status: "completed", ...result },
            updatedAt: new Date(),
          });
          await db.collection("events").updateOne(
            {
              id: prepared.id,
              workspaceId: w,
              "payload.status": "generating",
            },
            {
              $set: {
                payload: checked.payload,
                updatedAt: checked.updatedAt,
              },
            },
          );
        } catch (error) {
          if (error instanceof BrandGenerationFailure) usage = error.usage;
          await db.collection("events").updateOne(
            {
              id: prepared.id,
              workspaceId: w,
              "payload.status": "generating",
            },
            {
              $set: {
                "payload.status": "failed",
                ...(usage ? { "payload.usage": usage } : {}),
                updatedAt: new Date(),
              },
            },
          );
        }
      })().catch(() => {});
    }
    res.status(202).json({ id: prepared.id });
  });
  const errors: ErrorRequestHandler = (err, _req, res, next) => {
    void next;
    const status =
      err instanceof AuthorizationDenied
        ? 403
        : err instanceof Conflict
          ? 409
          : err instanceof ZodError
            ? 400
            : 503;
    res.status(status).json({
      error:
        status === 409
          ? "Brand Kit changed or a generation is already running"
          : status === 400
            ? "Check the supplied brand details"
            : "Brand expression is unavailable",
    });
  };
  router.use(errors);
  return router;
}
