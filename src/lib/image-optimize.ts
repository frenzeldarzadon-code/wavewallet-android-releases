/**
 * Client-side image optimisation shared by profile avatars and reward images.
 *
 * Uploads never carry the original full-resolution file: the browser crops the
 * selected region on a canvas, downscales it to a fixed target size and encodes
 * it as WEBP (JPEG fallback). Only the optimised bytes reach storage, which
 * keeps the buckets small and thumbnails visually uniform.
 */

export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
/** Largest file we let a user pick before optimisation. */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export interface ImageTarget {
  /** Output width in px. */
  width: number;
  /** Output height in px. */
  height: number;
  /** Starting encoder quality (0-1). */
  quality: number;
  /** Hard ceiling for the encoded file. */
  maxBytes: number;
}

/** Square avatar — small, cheap, crisp on retina phones. */
export const AVATAR_TARGET: ImageTarget = {
  width: 256,
  height: 256,
  quality: 0.85,
  maxBytes: 120 * 1024,
};

/** Reward card thumbnail — uniform 16:10 across every card and list. */
export const REWARD_TARGET: ImageTarget = {
  width: 800,
  height: 500,
  quality: 0.82,
  maxBytes: 300 * 1024,
};

/**
 * Profile cover banner — 3:1, the same proportion the profile pages render
 * it at, so the crop preview is exactly the composition members will see.
 */
export const PROFILE_COVER_TARGET: ImageTarget = {
  width: 1200,
  height: 400,
  quality: 0.82,
  maxBytes: 300 * 1024,
};
export const PROFILE_COVER_ASPECT = PROFILE_COVER_TARGET.width / PROFILE_COVER_TARGET.height;

/** Returns an error message, or null when the picked file is safe to process. */
export function validateImageFile(file: { type: string; size: number }): string | null {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) return "Use a JPG, PNG, WEBP or GIF image.";
  if (file.size > MAX_UPLOAD_BYTES) return "That image is larger than 8 MB.";
  return null;
}

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Largest centred rectangle of `aspect` (w/h) that fits inside the source,
 * offset by a -1..1 pan on each axis. Used as the default crop and by the
 * cropper when the user repositions the photo.
 */
export function coverCrop(
  sourceWidth: number,
  sourceHeight: number,
  aspect: number,
  zoom = 1,
  panX = 0,
  panY = 0,
): CropRect {
  const safeZoom = Math.min(Math.max(zoom, 1), 5);
  let width = sourceWidth;
  let height = width / aspect;
  if (height > sourceHeight) {
    height = sourceHeight;
    width = height * aspect;
  }
  width /= safeZoom;
  height /= safeZoom;
  const freeX = sourceWidth - width;
  const freeY = sourceHeight - height;
  const clamp = (v: number) => Math.min(Math.max(v, -1), 1);
  const x = (freeX / 2) * (1 + clamp(panX));
  const y = (freeY / 2) * (1 + clamp(panY));
  return { x, y, width, height };
}

/** File name for an optimised upload — always the optimised extension. */
export function optimizedName(prefix: string, mime: string): string {
  return `${prefix}.${mime === "image/webp" ? "webp" : "jpg"}`;
}

const supportsWebp = (): boolean => {
  if (typeof document === "undefined") return false;
  const c = document.createElement("canvas");
  return c.toDataURL("image/webp").startsWith("data:image/webp");
};

function toBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Could not process that image."))),
      mime,
      quality,
    );
  });
}

/** Decodes a File into an HTMLImageElement (browser only). */
export function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file could not be read as an image."));
    };
    img.src = url;
  });
}

/**
 * Crops, resizes and compresses to the target. Quality is stepped down until
 * the encoded blob fits `maxBytes`, so stored files stay predictable.
 */
export async function optimizeImage(
  source: HTMLImageElement,
  target: ImageTarget,
  crop?: CropRect,
): Promise<{ blob: Blob; mime: string }> {
  const rect =
    crop ?? coverCrop(source.naturalWidth, source.naturalHeight, target.width / target.height);
  const canvas = document.createElement("canvas");
  canvas.width = target.width;
  canvas.height = target.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not process that image.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    source,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    0,
    0,
    target.width,
    target.height,
  );

  const mime = supportsWebp() ? "image/webp" : "image/jpeg";
  let quality = target.quality;
  let blob = await toBlob(canvas, mime, quality);
  while (blob.size > target.maxBytes && quality > 0.4) {
    quality -= 0.12;
    blob = await toBlob(canvas, mime, quality);
  }
  return { blob, mime };
}
