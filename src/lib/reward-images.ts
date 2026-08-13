/**
 * Reward shop images.
 *
 * Binaries live in the private `reward-images` bucket, never in Postgres.
 * Objects are stored as `{ecosystem_id}/{uuid}.{ext}` so storage RLS can scope
 * reads to members of that ecosystem and writes to that ecosystem's admin.
 * Only the object path is persisted on reward_products / reward_redemptions.
 *
 * Uploads are cropped, resized and compressed in the browser to one uniform
 * 16:10 thumbnail before they reach storage — original full-resolution files
 * are never stored.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  MAX_UPLOAD_BYTES,
  REWARD_TARGET,
  loadImage,
  optimizeImage,
  optimizedName,
  validateImageFile,
  type CropRect,
} from "@/lib/image-optimize";

export const REWARD_IMAGE_BUCKET = "reward-images";
export const MAX_REWARD_IMAGE_BYTES = MAX_UPLOAD_BYTES;

export function validateRewardImage(file: File): string | null {
  return validateImageFile(file);
}

/** Uploads an optimised image and returns its storage path. Never overwrites. */
export async function uploadRewardImage(
  ecosystemId: string,
  file: File,
  crop?: CropRect,
  preloaded?: HTMLImageElement,
): Promise<string> {
  const problem = validateRewardImage(file);
  if (problem) throw new Error(problem);
  const source = preloaded ?? (await loadImage(file));
  const { blob, mime } = await optimizeImage(source, REWARD_TARGET, crop);
  const path = `${ecosystemId}/${optimizedName(crypto.randomUUID(), mime)}`;
  const { error } = await supabase.storage
    .from(REWARD_IMAGE_BUCKET)
    .upload(path, blob, { contentType: mime, upsert: false });
  if (error) throw new Error(error.message);
  return path;
}

/** Best-effort cleanup so replaced/removed images do not linger as orphans. */
export async function deleteRewardImage(path?: string | null): Promise<void> {
  if (!path) return;
  await supabase.storage.from(REWARD_IMAGE_BUCKET).remove([path]);
}

const cache = new Map<string, { url: string; expires: number }>();

/** Signed URL for a private object; storage RLS still decides whether it is issued. */
export async function rewardImageUrl(path?: string | null): Promise<string | null> {
  if (!path) return null;
  const hit = cache.get(path);
  if (hit && hit.expires > Date.now()) return hit.url;
  const { data, error } = await supabase.storage
    .from(REWARD_IMAGE_BUCKET)
    .createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) return null;
  cache.set(path, { url: data.signedUrl, expires: Date.now() + 55 * 60 * 1000 });
  return data.signedUrl;
}
