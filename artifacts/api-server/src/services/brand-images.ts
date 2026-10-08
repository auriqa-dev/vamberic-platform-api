import { createHash } from "node:crypto";
import sharp from "sharp";
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { z } from "zod";

export const MAX_BRAND_IMAGE_BYTES = 5 * 1024 * 1024;
export class InvalidBrandImage extends Error {}
export interface BrandImageStore {
  bucket: string;
  put(key: string, bytes: Buffer): Promise<string>;
  get(key: string, versionId: string): Promise<Buffer>;
}
export const imageInput = z
  .object({
    expectedKitId: z
      .string()
      .regex(/^brandkit_[0-7][0-9abcdefghjkmnpqrstvwxyz]{25}$/)
      .nullable(),
    expectedUpdatedAt: z.string().datetime().optional(),
    name: z.string().trim().min(1).max(200),
    type: z.enum([
      "logo",
      "photography",
      "product_imagery",
      "icon_set",
      "illustration",
      "graphic",
      "background",
      "email_header",
      "email_footer",
    ]),
    altText: z.string().trim().max(1000).optional(),
    contentType: z.enum(["image/png", "image/jpeg", "image/webp"]),
    base64: z
      .string()
      .min(4)
      .max(4 * Math.ceil(MAX_BRAND_IMAGE_BYTES / 3)),
  })
  .strict();
export async function normalizeBrandImage(
  base64: string,
  contentType: string,
): Promise<Buffer> {
  if (
    base64.length > 4 * Math.ceil(MAX_BRAND_IMAGE_BYTES / 3) ||
    base64.length % 4 !== 0
  )
    throw new InvalidBrandImage();
  const bytes = Buffer.from(base64, "base64");
  if (bytes.toString("base64") !== base64) throw new InvalidBrandImage();
  if (!bytes.length || bytes.length > MAX_BRAND_IMAGE_BYTES)
    throw new InvalidBrandImage();
  // Reject non-raster formats before invoking any decoder (especially SVG).
  const format = bytes
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ? "png"
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      ? "jpeg"
      : bytes.toString("ascii", 0, 4) === "RIFF" &&
          bytes.toString("ascii", 8, 12) === "WEBP"
        ? "webp"
        : undefined;
  if (!format || contentType !== `image/${format}`)
    throw new InvalidBrandImage();
  try {
    const image = sharp(bytes, {
      failOn: "warning",
      limitInputPixels: 16_000_000,
      sequentialRead: true,
    });
    const metadata = await image.metadata();
    if (metadata.format !== format || (metadata.pages ?? 1) !== 1)
      throw new InvalidBrandImage();
    // Decode/re-encode, strip metadata, preserve transparency, apply EXIF orientation.
    const output = await image
      .rotate()
      .png()
      .timeout({ seconds: 10 })
      .toBuffer();
    if (output.length > MAX_BRAND_IMAGE_BYTES) throw new InvalidBrandImage();
    return output;
  } catch {
    throw new InvalidBrandImage();
  }
}
export function imagePrefix(
  workspaceId: string,
  brandId: string,
  kitId: string,
) {
  return `brand-images/${workspaceId}/${brandId}/${kitId}/`;
}
export function imageDigest(
  bytes: Buffer,
  name: string,
  type: string,
  altText?: string,
) {
  return createHash("sha256")
    .update(bytes)
    .update(JSON.stringify([name, type, altText ?? ""]))
    .digest("hex");
}
export function createBrandImageStore(
  bucket: string,
  region: string,
): BrandImageStore {
  const s3 = new S3Client({ region, maxAttempts: 2 });
  return {
    bucket,
    async put(key, bytes) {
      let version: string | undefined;
      try {
        const result = await s3.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: bytes,
            ContentLength: bytes.length,
            ContentType: "image/png",
            CacheControl: "private, no-store",
            ServerSideEncryption: "AES256",
            IfNoneMatch: "*",
          }),
          { abortSignal: AbortSignal.timeout(15000) },
        );
        version = result.VersionId;
      } catch (error) {
        if (!(error instanceof Error) || error.name !== "PreconditionFailed")
          throw error;
        const result = await s3.send(
          new HeadObjectCommand({ Bucket: bucket, Key: key }),
          { abortSignal: AbortSignal.timeout(15000) },
        );
        if (
          result.ContentLength !== bytes.length ||
          result.ContentType !== "image/png"
        )
          throw new Error("Stored image mismatch");
        version = result.VersionId;
      }
      if (!version || version === "null")
        throw new Error("Versioned image storage required");
      return version;
    },
    async get(key, versionId) {
      const result = await s3.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          VersionId: versionId,
        }),
        { abortSignal: AbortSignal.timeout(15000) },
      );
      if (
        !result.Body ||
        !result.ContentLength ||
        result.ContentLength > MAX_BRAND_IMAGE_BYTES ||
        result.ContentType !== "image/png"
      )
        throw new Error("Invalid stored image");
      const bytes = Buffer.from(await result.Body.transformToByteArray());
      if (bytes.length !== result.ContentLength)
        throw new Error("Truncated stored image");
      return bytes;
    },
  };
}
