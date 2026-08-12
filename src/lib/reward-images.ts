/**
 * Stage 4 — optional reward images.
 *
 * Binaries live in the private `reward-images` bucket, never in Postgres.
 * Objects are stored as `{ecosystem_id}/{uuid}.{ext}` so storage RLS can scope
 * reads to members of that ecosystem and writes to that ecosystem's admin.
 * Only the object path is persisted on reward_products / reward_redemptions.
 */
import { supabase } from "@/integrations/supabase/client";

export const REWARD_IMAGE_BUCKET = "reward-images";
export const MAX_REWARD_IMAGE_BYTES = 3 * 1024 * 1024; // 3 MB
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export function validateRewardImage(file: File): string | null {
  if (!ALLOWED.includes(file.type)) return "Use a JPG, PNG, WEBP or GIF image.";
  if (file.size > MAX_REWARD_IMAGE_BYTES) return "That image is larger than 3 MB.";
  return null;
}

/** Uploads a new image and returns its storage path. Never overwrites an existing object. */
export async function uploadRewardImage(ecosystemId: string, file: File): Promise<string> {
  const problem = validateRewardImage(file);
  if (problem) throw new Error(problem);
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `${ecosystemId}/${crypto.randomUUID()}.${ext || "jpg"}`;
  const { error } = await supabase.storage
    .from(REWARD_IMAGE_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
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
