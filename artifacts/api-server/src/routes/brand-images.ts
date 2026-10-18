import { Router, json } from "express";
import type { ClientSession, Db } from "mongodb";
import type { AppConfig } from "../config";
import type { MongoService } from "../services/mongo";
import { resolveHvmContext } from "../services/hvm-context";
import { AuthorizationDenied } from "../authorization/policy";
import {
  BrandKitSchema,
  EventSchema,
  generatePlatformId,
  partnerHumanSchema,
  platformIdSchema,
} from "../domain";
import {
  imageMutationInput,
  imageDigest,
  normalizeBrandImage,
  InvalidBrandImage,
  type BrandImageStore,
} from "../services/brand-images";
import { z, ZodError } from "zod";

class ImageConflict extends Error {}
export function createBrandImagesRouter(
  config: AppConfig,
  mongo: MongoService,
  store?: BrandImageStore,
) {
  const router = Router();
  const path = "/workspaces/:workspaceId/brands/:brandId/kits/:kitId/images";
  let uploads = 0;
  const ids = z.object({
    workspaceId: platformIdSchema("workspace"),
    brandId: platformIdSchema("brand"),
    kitId: platformIdSchema("brandkit"),
  });
  async function scoped(
    db: Db,
    auth: Parameters<typeof resolveHvmContext>[2],
    params: z.infer<typeof ids>,
    action: "read" | "update",
    session?: ClientSession,
  ) {
    const resolved = await resolveHvmContext(db, config, auth, session);
    const scope = resolved.authority.scopeFilter(resolved.context, action, {
      type: "brand_kits",
      workspaceId: params.workspaceId,
    });
    const options = session ? { session } : {};
    if (
      !(await db.collection("brands").findOne(
        {
          ...scope,
          id: params.brandId,
          status: "active",
          archived: { $ne: true },
        },
        options,
      ))
    )
      throw new AuthorizationDenied();
    const row = await db.collection("brand_kits").findOne(
      {
        ...scope,
        id: params.kitId,
        brandId: params.brandId,
        archived: { $ne: true },
      },
      options,
    );
    if (!row) throw new AuthorizationDenied();
    const { _id, ...value } = row;
    void _id;
    const kit = BrandKitSchema.parse(value);
    if (action === "update" && kit.status !== "draft")
      throw new ImageConflict();
    return { kit, actor: partnerHumanSchema.parse(resolved.context.actor) };
  }
  router.get(path + "/:imageId", async (req, res) => {
    const params = ids.parse(req.params);
    const digest = z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(req.params.imageId);
    const { kit } = await scoped(
      await mongo.database(),
      req.auth!,
      params,
      "read",
    );
    if (!store)
      return void res
        .status(503)
        .json({ error: { code: "BRAND_IMAGES_UNAVAILABLE" } });
    // Object references are server-derived and reauthorized on every download.
    const prefix = `brand-images/${params.workspaceId}/${params.brandId}/`;
    const asset = kit.assets.find(
      (a) =>
        a.status === "approved" &&
        a.object.bucket === store.bucket &&
        a.object.key.startsWith(prefix) &&
        a.object.key.endsWith(`/${digest}.png`) &&
        a.object.versionId,
    );
    if (!asset) throw new AuthorizationDenied();
    const bytes = await store.get(asset.object.key, asset.object.versionId!);
    res.json({ contentType: "image/png", base64: bytes.toString("base64") });
  });
  const brandIds = ids.omit({ kitId: true });
  async function writable(
    db: Db,
    auth: Parameters<typeof resolveHvmContext>[2],
    params: z.infer<typeof brandIds>,
    session?: ClientSession,
  ) {
    const resolved = await resolveHvmContext(db, config, auth, session);
    for (const action of ["create", "update", "approve"] as const)
      resolved.authority.scopeFilter(resolved.context, action, {
        type: "brand_kits",
        workspaceId: params.workspaceId,
      });
    if (
      !(await db.collection("brands").findOne(
        {
          id: params.brandId,
          workspaceId: params.workspaceId,
          status: "active",
          archived: { $ne: true },
        },
        { session },
      ))
    )
      throw new AuthorizationDenied();
    const rows = await db
      .collection("brand_kits")
      .find(
        {
          workspaceId: params.workspaceId,
          brandId: params.brandId,
          status: "approved",
          archived: { $ne: true },
        },
        { session },
      )
      .limit(2)
      .toArray();
    if (rows.length > 1) throw new ImageConflict();
    const row = rows[0];
    const kit = row
      ? BrandKitSchema.parse(
          Object.fromEntries(
            Object.entries(row).filter(([key]) => key !== "_id"),
          ),
        )
      : undefined;
    return { kit, actor: partnerHumanSchema.parse(resolved.context.actor) };
  }
  // Fresh write/approval authority before allocating the larger request body.
  router.post(
    "/workspaces/:workspaceId/brands/:brandId/images",
    async (req, res, next) => {
      await writable(
        await mongo.database(),
        req.auth!,
        brandIds.parse(req.params),
      );
      if (!store)
        return void res
          .status(503)
          .json({ error: { code: "BRAND_IMAGES_UNAVAILABLE" } });
      if (uploads >= 1)
        return void res.status(429).json({ error: { code: "UPLOAD_BUSY" } });
      uploads++;
      res.locals.releaseUpload = () => {
        uploads--;
      };
      next();
    },
    json({ limit: "7mb", strict: true, inflate: false }),
    async (req, res) => {
      try {
        const params = brandIds.parse(req.params),
          input = imageMutationInput.parse(req.body);
        const initial = await writable(
          await mongo.database(),
          req.auth!,
          params,
        );
        const operation = "operation" in input ? input.operation : "upload";
        const selected = (kit: typeof initial.kit) =>
          "imageIds" in input
            ? (kit?.assets.filter(
                (a) =>
                  a.object.bucket === store!.bucket &&
                  a.object.key.startsWith(
                    `brand-images/${params.workspaceId}/${params.brandId}/`,
                  ) &&
                  input.imageIds.some((id) =>
                    a.object.key.endsWith(`/${id}.png`),
                  ),
              ) ?? [])
            : [];
        const target = (kit: typeof initial.kit) =>
          "imageId" in input
            ? kit?.assets.find(
                (a) =>
                  a.object.bucket === store!.bucket &&
                  a.object.key.startsWith(
                    `brand-images/${params.workspaceId}/${params.brandId}/`,
                  ) &&
                  a.object.key.endsWith(`/${input.imageId}.png`),
              )
            : undefined;
        const unchanged = (kit: typeof initial.kit) =>
          (kit?.id ?? null) === input.expectedKitId &&
          kit?.updatedAt.toISOString() === input.expectedUpdatedAt;
        if (
          operation !== "upload" &&
          (!unchanged(initial.kit) ||
            !("imageIds" in input
              ? selected(initial.kit).length === input.imageIds.length
              : target(initial.kit)))
        )
          throw new ImageConflict();
        let asset:
          NonNullable<typeof initial.kit>["assets"][number] | undefined;
        if (
          !("operation" in input && input.operation === "delete") &&
          !("imageIds" in input)
        ) {
          let object = target(initial.kit)?.object;
          if (input.base64 && input.contentType) {
            const bytes = await normalizeBrandImage(
              input.base64,
              input.contentType,
            );
            const digest = imageDigest(
              bytes,
              input.name,
              input.type,
              input.altText,
            );
            const key = `brand-images/${params.workspaceId}/${params.brandId}/images/${digest}.png`;
            const existing = initial.kit?.assets.find(
              (a) => a.object.bucket === store!.bucket && a.object.key === key,
            );
            if (operation === "upload" && existing)
              return void res.json({
                id: initial.kit!.id,
                updatedAt: initial.kit!.updatedAt,
              });
            if (
              !unchanged(initial.kit) ||
              (operation === "upload" &&
                (initial.kit?.assets.length ?? 0) >= 100)
            )
              throw new ImageConflict();
            // Keep prior private versions for recovery; never delete on ambiguous commits.
            object = existing?.object ?? {
              store: "s3",
              bucket: store!.bucket,
              key,
              versionId: await store!.put(key, bytes),
            };
          }
          if (!object) throw new ImageConflict();
          asset = {
            name: input.name,
            type: input.type,
            ...(input.altText ? { altText: input.altText } : {}),
            status: "approved",
            object,
          };
        }
        if (!mongo.withTransaction) throw new Error("Transactions required");
        const result = await mongo.withTransaction(async (db, session) => {
          const { kit, actor } = await writable(db, req.auth!, params, session);
          if (
            operation === "upload" &&
            kit?.assets.some(
              (a) =>
                a.object.key === asset!.object.key &&
                a.object.bucket === asset!.object.bucket,
            )
          )
            return { id: kit.id, updatedAt: kit.updatedAt };
          if (
            !unchanged(kit) ||
            (operation === "upload" && (kit?.assets.length ?? 0) >= 100) ||
            (operation !== "upload" &&
              !("imageIds" in input
                ? selected(kit).length === input.imageIds.length
                : target(kit)))
          )
            throw new ImageConflict();
          const previousAsset = target(kit);
          // One stored image is one item; replacing it must not duplicate another item.
          if (
            operation === "update" &&
            kit!.assets.some(
              (a) => a !== previousAsset && a.object.key === asset!.object.key,
            )
          )
            throw new ImageConflict();
          const workspace = await db
            .collection("crm_workspaces")
            .findOne(
              { id: params.workspaceId, archived: { $ne: true } },
              { session },
            );
          if (!workspace) throw new AuthorizationDenied();
          const now = new Date(
            Math.max(
              Date.now(),
              (kit?.updatedAt.getTime() ?? 0) + 1,
              workspace.updatedAt.getTime() + 1,
            ),
          );
          await db
            .collection("crm_workspaces")
            .updateOne(
              { id: params.workspaceId, updatedAt: workspace.updatedAt },
              { $set: { updatedAt: now } },
              { session },
            );
          const updated = BrandKitSchema.parse({
            ...kit,
            id: generatePlatformId("brandkit"),
            workspaceId: params.workspaceId,
            brandId: params.brandId,
            createdAt: now,
            updatedAt: now,
            createdBy: actor,
            updatedBy: actor,
            approvedAt: now,
            approvedBy: actor,
            status: "approved",
            archived: false,
            assets:
              "imageIds" in input
                ? kit!.assets.flatMap((a) =>
                    selected(kit).includes(a)
                      ? input.operation === "bulk-delete"
                        ? []
                        : [{ ...a, type: input.type! }]
                      : [a],
                  )
                : operation === "upload"
                  ? [...(kit?.assets ?? []), asset!]
                  : kit!.assets.flatMap((a) =>
                      a === previousAsset
                        ? operation === "delete"
                          ? []
                          : [asset!]
                        : [a],
                    ),
          });
          if (kit)
            await db.collection("brand_kits").updateOne(
              {
                id: kit.id,
                workspaceId: kit.workspaceId,
                updatedAt: kit.updatedAt,
                status: "approved",
              },
              {
                $set: { status: "retired", updatedAt: now, updatedBy: actor },
              },
              { session },
            );
          await db.collection("brand_kits").insertOne(updated, { session });
          await db.collection("events").insertOne(
            EventSchema.parse({
              id: generatePlatformId("event"),
              createdAt: now,
              updatedAt: now,
              workspaceId: params.workspaceId,
              eventType: "hvm_onboarding_changed",
              occurredAt: now,
              actor,
              payload: {
                application: "hvmapp",
                resource: "brand_kits",
                resourceId: updated.id,
                action: `kit-image-${operation}`,
                human: actor,
              },
            }),
            { session },
          );
          return { id: updated.id, updatedAt: now };
        });
        res.status(201).json(result);
      } finally {
        res.locals.releaseUpload?.();
        delete res.locals.releaseUpload;
      }
    },
  );
  router.use(((error, _req, res, next) => {
    res.locals.releaseUpload?.();
    delete res.locals.releaseUpload;
    if (
      error instanceof InvalidBrandImage ||
      error instanceof ZodError ||
      error?.type === "entity.too.large" ||
      error?.type === "entity.parse.failed"
    )
      return void res.status(400).json({
        error: {
          code: "INVALID_IMAGE",
          message:
            "Choose a valid PNG, JPEG or WebP image up to 5 MB and 16 megapixels.",
        },
      });
    if (error instanceof ImageConflict)
      return void res.status(409).json({ error: { code: "CONFLICT" } });
    next(error);
  }) as import("express").ErrorRequestHandler);
  return router;
}
