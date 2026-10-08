import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import {
  normalizeBrandImage,
  InvalidBrandImage,
  MAX_BRAND_IMAGE_BYTES,
} from "../src/services/brand-images";
for (const format of ["png", "jpeg", "webp"] as const)
  test(`normalizes ${format} to a metadata-free PNG`, async () => {
    const image = sharp({
      create: { width: 3, height: 2, channels: 4, background: "#ff000080" },
    });
    const bytes = await image[format]().toBuffer();
    const output = await normalizeBrandImage(
      bytes.toString("base64"),
      `image/${format}`,
    );
    const info = await sharp(output).metadata();
    assert.equal(info.format, "png");
    assert.equal(info.width, 3);
    assert.equal(info.height, 2);
    assert.equal(info.exif, undefined);
    if (format !== "jpeg") assert.equal(info.hasAlpha, true);
  });
test("rejects executable, spoofed, malformed, oversized and oversized-dimension input", async () => {
  const png = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();
  for (const [bytes, mime] of [
    [Buffer.from('<svg onload="alert(1)"/>'), "image/png"],
    [png, "image/jpeg"],
    [png.subarray(0, 15), "image/png"],
    [Buffer.alloc(MAX_BRAND_IMAGE_BYTES + 1), "image/png"],
  ] as const) {
    await assert.rejects(
      normalizeBrandImage(bytes.toString("base64"), mime),
      InvalidBrandImage,
    );
  }
  await assert.rejects(
    normalizeBrandImage("broken$$", "image/png"),
    InvalidBrandImage,
  );
  const large = await sharp({
    create: { width: 4001, height: 4000, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  await assert.rejects(
    normalizeBrandImage(large.toString("base64"), "image/png"),
    InvalidBrandImage,
  );
});
