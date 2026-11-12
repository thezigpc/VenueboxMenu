// Uploaded slide images: checked, turned upright, shrunk to fit 1920x1080, and stripped of
// camera metadata (phone photos carry GPS). Small, clean images are kept byte for byte.

import sharp from "sharp";

// One image at a time and no cache: a box gives the container 256 MB.
sharp.cache(false);
sharp.concurrency(1);

export const MAX_WIDTH = 1920;
export const MAX_HEIGHT = 1080;
export const MAX_UPLOAD_MB = 20;
/** About 80 megapixels: far beyond any real menu, well short of a decompression bomb. */
const MAX_INPUT_PIXELS = 80_000_000;

export type ImageFormat = "jpeg" | "png" | "webp";
const EXT: Record<ImageFormat, string> = { jpeg: "jpg", png: "png", webp: "webp" };

export class UploadError extends Error {}

export interface ProcessedImage {
  data: Buffer;
  ext: string;
  format: ImageFormat;
  width: number;
  height: number;
  /** True when the stored file differs from the upload (resized, rotated or cleaned). */
  changed: boolean;
}

export async function processImage(input: Buffer): Promise<ProcessedImage> {
  let meta: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    meta = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  } catch {
    throw new UploadError("That file isn't an image we can read. Use JPG, PNG or WebP.");
  }
  const format = meta.format === "jpeg" || meta.format === "png" || meta.format === "webp" ? meta.format : null;
  if (!format) throw new UploadError("Only JPG, PNG and WebP images can be slides.");
  if (!meta.width || !meta.height) throw new UploadError("That image has no size.");
  if (meta.width * meta.height > MAX_INPUT_PIXELS) throw new UploadError("That image is far too large (over 80 megapixels).");

  const rotated = (meta.orientation ?? 1) >= 5; // EXIF orientations 5-8 swap width and height
  const w = rotated ? meta.height : meta.width;
  const h = rotated ? meta.width : meta.height;
  const needsResize = w > MAX_WIDTH || h > MAX_HEIGHT;
  const needsRotate = (meta.orientation ?? 1) !== 1;
  const hasMetadata = Boolean(meta.exif || meta.xmp || meta.iptc);

  if (!needsResize && !needsRotate && !hasMetadata) {
    return { data: input, ext: EXT[format], format, width: w, height: h, changed: false };
  }

  let pipeline = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .resize({ width: MAX_WIDTH, height: MAX_HEIGHT, fit: "inside", withoutEnlargement: true });
  pipeline =
    format === "jpeg"
      ? pipeline.jpeg({ quality: 85, mozjpeg: true })
      : format === "png"
        ? pipeline.png({ compressionLevel: 9 })
        : pipeline.webp({ quality: 85 });
  try {
    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
    return { data, ext: EXT[format], format, width: info.width, height: info.height, changed: true };
  } catch {
    throw new UploadError("That image couldn't be processed. Try saving it again as JPG or PNG.");
  }
}
