import { createHash } from "node:crypto";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { z } from "zod";
import type { Document } from "mongodb";
import type { AppConfig } from "../../config";
import type { MongoService } from "../mongo";
import type { AuthenticatedUser } from "../../middlewares/auth";
import {
  EventSchema,
  generatePlatformId,
  platformIdSchema,
} from "../../domain";
import { icpAccess, lockIcpWorkspace } from "../icp/access";
import { HiveConflict } from "../hive-definitions";
import { researchDetails } from "./context";
export const MAX_RESEARCH_BYTES = 50 * 1024 * 1024;
export interface ResearchStore {
  put(key: string, bytes: Buffer): Promise<string>;
  get(key: string, version: string): Promise<Buffer>;
}
export function createResearchStore(
  bucket: string,
  region: string,
): ResearchStore {
  const s3 = new S3Client({ region, maxAttempts: 2 });
  return {
    async put(key, bytes) {
      let result;
      try {
        result = await s3.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: bytes,
            IfNoneMatch: "*",
            ContentType: "application/octet-stream",
            CacheControl: "private, no-store",
            ServerSideEncryption: "AES256",
          }),
          { abortSignal: AbortSignal.timeout(60000) },
        );
      } catch (error) {
        if (!(error instanceof Error) || error.name !== "PreconditionFailed")
          throw error;
        result = await s3.send(
          new HeadObjectCommand({ Bucket: bucket, Key: key }),
          { abortSignal: AbortSignal.timeout(15000) },
        );
      }
      if (!result.VersionId || result.VersionId === "null")
        throw new Error("Versioned storage required");
      return result.VersionId;
    },
    async get(key, version) {
      const result = await s3.send(
        new GetObjectCommand({ Bucket: bucket, Key: key, VersionId: version }),
        { abortSignal: AbortSignal.timeout(60000) },
      );
      if (
        !result.ContentLength ||
        result.ContentLength > MAX_RESEARCH_BYTES ||
        !result.Body
      )
        throw new Error("Invalid document size");
      return Buffer.from(await result.Body.transformToByteArray());
    },
  };
}
const target = z
  .object({
    id: platformIdSchema("event"),
    expectedUpdatedAt: z.string().datetime(),
  })
  .strict();
export function createResearchDocuments(
  config: AppConfig,
  mongo: MongoService,
  store?: ResearchStore,
) {
  const present = (row: Document) => ({
    id: row.id,
    updatedAt: row.updatedAt.toISOString(),
    filename: row.payload.filename,
    size: row.payload.size,
    status: row.payload.status,
    revision: row.payload.revision,
    details: row.payload.details,
  });
  async function find(
    identity: AuthenticatedUser,
    w: string,
    id: string,
    action: "read" | "create",
  ) {
    const db = await mongo.database();
    await icpAccess(db, config, identity, w, action);
    platformIdSchema("event").parse(id);
    const row = await db.collection("events").findOne({
      id,
      workspaceId: w,
      eventType: "research_document",
      "payload.status": { $ne: "removed" },
    });
    if (!row) throw new HiveConflict("Document not found");
    return row;
  }
  return {
    async list(identity: AuthenticatedUser, w: string) {
      const db = await mongo.database();
      await icpAccess(db, config, identity, w, "read");
      const rows = await db
        .collection("events")
        .find({
          workspaceId: w,
          eventType: "research_document",
          "payload.status": { $ne: "removed" },
        })
        .sort({ updatedAt: -1, id: -1 })
        .limit(201)
        .toArray();
      return {
        available: Boolean(store),
        documents: rows.slice(0, 200).map(present),
        more: rows.length > 200,
      };
    },
    async create(identity: AuthenticatedUser, w: string, raw: unknown) {
      if (!store || !mongo.withTransaction)
        throw new Error("Document storage unavailable");
      const input = z
        .object({
          requestKey: z.string().uuid(),
          filename: z
            .string()
            .trim()
            .min(1)
            .max(200)
            .regex(
              /^[^/\\\r\n]+\.(csv|xlsx|xls|txt|md|pdf|docx|doc|pptx|ppt|png|jpg|jpeg|webp|gif|mp4|mov|webm|mp3|wav|m4a|ogg)$/i,
            ),
          size: z.number().int().positive().max(MAX_RESEARCH_BYTES),
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
          details: researchDetails,
        })
        .strict()
        .parse(raw);
      return mongo.withTransaction(async (db, session) => {
        const actor = await icpAccess(
          db,
          config,
          identity,
          w,
          "create",
          session,
        );
        const now = await lockIcpWorkspace(db, w, session);
        const prior = await db.collection("events").findOne(
          {
            workspaceId: w,
            eventType: "research_document",
            "payload.requestKey": input.requestKey,
          },
          { session },
        );
        if (prior) {
          if (
            prior.payload.sha256 !== input.sha256 ||
            JSON.stringify(prior.payload.details) !==
              JSON.stringify(input.details) ||
            prior.payload.status === "removed"
          )
            throw new HiveConflict("Upload request changed");
          return present(prior);
        }
        const row = EventSchema.parse({
          id: generatePlatformId("event"),
          workspaceId: w,
          createdAt: now,
          updatedAt: now,
          occurredAt: now,
          createdBy: actor,
          updatedBy: actor,
          eventType: "research_document",
          payload: { ...input, revision: 1, status: "uploading" },
        });
        await db.collection("events").insertOne(row, { session });
        return present(row);
      });
    },
    async authoriseUpload(identity: AuthenticatedUser, w: string, id: string) {
      await find(identity, w, id, "create");
    },
    async upload(
      identity: AuthenticatedUser,
      w: string,
      id: string,
      bytes: Buffer,
    ) {
      if (!store || !mongo.withTransaction)
        throw new Error("Document storage unavailable");
      const row = await find(identity, w, id, "create");
      if (
        !Buffer.isBuffer(bytes) ||
        bytes.length !== row.payload.size ||
        bytes.length > MAX_RESEARCH_BYTES ||
        createHash("sha256").update(bytes).digest("hex") !== row.payload.sha256
      )
        throw new HiveConflict("File does not match the selected upload");
      if (
        /\.pdf$/i.test(row.payload.filename) &&
        !bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))
      )
        throw new HiveConflict("The file is not a PDF.");
      if (
        /\.docx$/i.test(row.payload.filename) &&
        !bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
      )
        throw new HiveConflict("The file is not a Word document.");
      if (row.payload.status === "ready") return present(row);
      const key = `research-documents/${w}/${id}/${row.payload.sha256}`;
      const version = await store.put(key, bytes);
      return mongo.withTransaction(async (db, session) => {
        await icpAccess(db, config, identity, w, "create", session);
        const now = await lockIcpWorkspace(db, w, session);
        const current = await db
          .collection("events")
          .findOne(
            { id, workspaceId: w, eventType: "research_document" },
            { session },
          );
        if (current?.payload.status === "ready") return present(current);
        if (!current || current.payload.status !== "uploading")
          throw new HiveConflict("Upload was removed");
        const payload = { ...current.payload, status: "ready", key, version };
        await db
          .collection("events")
          .updateOne(
            { id, workspaceId: w, updatedAt: current.updatedAt },
            { $set: { payload, updatedAt: now } },
            { session },
          );
        return present({ ...current, payload, updatedAt: now });
      });
    },
    async download(identity: AuthenticatedUser, w: string, id: string) {
      const row = await find(identity, w, id, "read");
      if (!store || row.payload.status !== "ready")
        throw new HiveConflict("Upload is not complete");
      const bytes = await store.get(row.payload.key, row.payload.version);
      if (
        createHash("sha256").update(bytes).digest("hex") !== row.payload.sha256
      )
        throw new Error("Document integrity check failed");
      return { bytes, filename: row.payload.filename as string };
    },
    async mutate(identity: AuthenticatedUser, w: string, raw: unknown) {
      const input = z
        .discriminatedUnion("operation", [
          target.extend({
            operation: z.literal("update"),
            details: researchDetails,
          }),
          z
            .object({
              operation: z.literal("update-purpose"),
              targets: z.array(target).min(1).max(100),
              purpose: researchDetails.shape.purpose,
            })
            .strict(),
          z
            .object({
              operation: z.literal("remove"),
              targets: z.array(target).min(1).max(100),
            })
            .strict(),
        ])
        .parse(raw);
      if (!mongo.withTransaction) throw new Error("Transactions required");
      return mongo.withTransaction(async (db, session) => {
        const actor = await icpAccess(
          db,
          config,
          identity,
          w,
          "create",
          session,
        );
        const now = await lockIcpWorkspace(db, w, session);
        const targets = input.operation === "update" ? [input] : input.targets;
        for (const t of targets) {
          const row = await db.collection("events").findOne(
            {
              id: t.id,
              workspaceId: w,
              eventType: "research_document",
              updatedAt: new Date(t.expectedUpdatedAt),
              "payload.status": { $ne: "removed" },
            },
            { session },
          );
          if (!row)
            throw new HiveConflict(
              "A document changed. Reload before updating it.",
            );
          if (input.operation === "remove") {
            const references = await db
              .collection("events")
              .find(
                {
                  workspaceId: w,
                  eventType: "content_strategy_record",
                  "payload.record.kind": "asset",
                  "payload.record.data.sourceDocumentId": t.id,
                },
                { session },
              )
              .toArray();
            if (references.length)
              throw new HiveConflict(
                "This original is retained by Library asset history. Archive the Library asset instead.",
              );
          }
          await db.collection("events").insertOne(
            EventSchema.parse({
              id: generatePlatformId("event"),
              workspaceId: w,
              createdAt: now,
              updatedAt: now,
              occurredAt: now,
              createdBy: actor,
              updatedBy: actor,
              eventType: "research_document_revision",
              payload: {
                documentId: row.id,
                revision: row.payload.revision,
                details: row.payload.details,
                filename: row.payload.filename,
                sha256: row.payload.sha256,
                key: row.payload.key,
                version: row.payload.version,
                operation: input.operation,
              },
            }),
            { session },
          );
          const payload =
            input.operation === "remove"
              ? { ...row.payload, status: "removed" }
              : {
                  ...row.payload,
                  details:
                    input.operation === "update"
                      ? input.details
                      : { ...row.payload.details, purpose: input.purpose },
                  revision: row.payload.revision + 1,
                };
          await db
            .collection("events")
            .updateOne(
              { id: row.id, workspaceId: w, updatedAt: row.updatedAt },
              { $set: { payload, updatedAt: now, updatedBy: actor } },
              { session },
            );
        }
        return { updated: targets.length };
      });
    },
  };
}
