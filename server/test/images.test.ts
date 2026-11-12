import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { processImage, UploadError } from "../src/images.js";
import { makeImage } from "./helpers.js";

test("a small clean image is stored as uploaded", async () => {
  const input = await makeImage(1280, 720, "png");
  const out = await processImage(input);
  assert.equal(out.changed, false);
  assert.equal(out.data, input);
  assert.deepEqual([out.width, out.height, out.ext], [1280, 720, "png"]);
});

test("anything bigger than 1920x1080 is shrunk to fit, keeping its shape", async () => {
  const out = await processImage(await makeImage(4000, 3000, "jpeg"));
  assert.equal(out.changed, true);
  assert.deepEqual([out.width, out.height], [1440, 1080]);
  const meta = await sharp(out.data).metadata();
  assert.deepEqual([meta.width, meta.height, meta.format], [1440, 1080, "jpeg"]);

  const wide = await processImage(await makeImage(3840, 1000, "webp"));
  assert.deepEqual([wide.width, wide.height, wide.ext], [1920, 500, "webp"]);
});

test("phone photos are turned upright and lose their metadata", async () => {
  // Orientation 6: stored landscape, displayed portrait.
  const out = await processImage(await makeImage(900, 600, "jpeg", { orientation: 6 }));
  assert.equal(out.changed, true);
  assert.deepEqual([out.width, out.height], [600, 900]);
  const meta = await sharp(out.data).metadata();
  assert.equal(meta.orientation, undefined);
  assert.equal(meta.exif, undefined);

  const withExif = await processImage(await makeImage(640, 480, "jpeg", { exif: true }));
  assert.equal(withExif.changed, true);
  assert.equal((await sharp(withExif.data).metadata()).exif, undefined);
});

test("non-images and other formats are refused", async () => {
  await assert.rejects(processImage(Buffer.from("hello, not an image")), UploadError);
  const gif = await sharp({ create: { width: 10, height: 10, channels: 3, background: "red" } }).gif().toBuffer();
  await assert.rejects(processImage(gif), /JPG, PNG and WebP/);
});
