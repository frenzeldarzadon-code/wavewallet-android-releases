/**
 * Self-service member profile: display name, unique @handle and avatar.
 *
 * Authorization lives in the database (`update_own_profile` only ever edits the
 * caller's own row and audits the change). Nothing here can touch balances,
 * roles, discounts or commissions, and no authentication data is exposed.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { AVATAR_TARGET, optimizeImage, optimizedName } from "@/lib/image-optimize";

export const AVATAR_BUCKET = "avatars";

export const HANDLE_MIN = 3;
export const HANDLE_MAX = 20;
const HANDLE_RE = /^[a-z0-9_.]{3,20}$/;

/** Strips a leading @ and lowercases — the stored, comparable form. */
export function normalizeHandle(input: string): string {
  return input.trim().replace(/^@+/, "").toLowerCase();
}

/** Always displayed with the @ prefix. */
export function displayHandle(handle?: string | null): string | null {
  const h = normalizeHandle(handle ?? "");
  return h ? `@${h}` : null;
}

/** Returns an error message, or null when the handle is well formed. */
export function validateHandle(input: string): string | null {
  const h = normalizeHandle(input);
  if (!h) return null; // a handle is optional
  if (h.length < HANDLE_MIN) return `Handles need at least ${HANDLE_MIN} characters`;
  if (h.length > HANDLE_MAX) return `Handles can be at most ${HANDLE_MAX} characters`;
  if (!HANDLE_RE.test(h)) return "Use letters, numbers, dots or underscores only";
  return null;
}

export function validateDisplayName(name: string): string | null {
  const n = name.trim();
  if (!n) return "A display name is required";
  if (n.length > 60) return "That display name is too long";
  return null;
}

export type HandleCheck = "available" | "taken" | "invalid" | "unknown";

/**
 * Friendly availability check — the database still enforces uniqueness.
 * A failed check reports "unknown" so a network/permission problem is never
 * shown to the member as a false "already taken".
 */
export async function checkHandle(
  handle: string,
  currentHandle?: string | null,
): Promise<HandleCheck> {
  const h = normalizeHandle(handle);
  if (!h) return "invalid";
  if (validateHandle(h)) return "invalid";
  // Keeping your own handle is always allowed.
  if (normalizeHandle(currentHandle ?? "") === h) return "available";
  const { data, error } = await supabase.rpc("handle_available", { _handle: h });
  if (error) return "unknown";
  return data ? "available" : "taken";
}

/** Back-compat boolean helper. */
export async function isHandleAvailable(handle: string): Promise<boolean> {
  return (await checkHandle(handle)) === "available";
}


export interface MyProfile {
  id: string;
  full_name: string;
  handle: string | null;
  avatar_path: string | null;
  email: string;
  phone: string;
  bio: string | null;
  preferences: Json | null;
  joined_at: string;
  /** Address to barangay level. Street and house number stay optional. */
  province: string | null;
  city_municipality: string | null;
  barangay: string | null;
  street: string | null;
  house_number: string | null;
}

export async function fetchMyProfile(userId: string): Promise<MyProfile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select(
      "id, full_name, handle, avatar_path, email, phone, bio, preferences, joined_at, province, city_municipality, barangay, street, house_number",
    )
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as MyProfile | null) ?? null;
}

/**
 * Object path for a member's avatar: `{ecosystem}/{user}/{uuid}.webp`.
 * Platform-level members (no shop, e.g. the platform owner) use `platform/`.
 */
export const PLATFORM_AVATAR_FOLDER = "platform";

export function avatarPathFor(
  ecosystemId: string | null | undefined,
  userId: string,
  mime: string,
): string {
  const folder = ecosystemId || PLATFORM_AVATAR_FOLDER;
  return `${folder}/${userId}/${optimizedName(crypto.randomUUID(), mime)}`;
}

/**
 * Uploads an already-cropped image after resizing/compressing it to the square
 * avatar target, then removes the previous object so storage does not grow.
 */
export async function uploadAvatar(input: {
  ecosystemId: string | null;
  userId: string;
  source: HTMLImageElement;
  crop?: { x: number; y: number; width: number; height: number };
  previousPath?: string | null;
}): Promise<string> {
  const { blob, mime } = await optimizeImage(input.source, AVATAR_TARGET, input.crop);
  const path = avatarPathFor(input.ecosystemId, input.userId, mime);
  const { error } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(path, blob, { contentType: mime, upsert: false });
  if (error) throw new Error(error.message);
  if (input.previousPath && input.previousPath !== path) await deleteAvatar(input.previousPath);
  return path;
}

export async function deleteAvatar(path?: string | null): Promise<void> {
  if (!path) return;
  await supabase.storage.from(AVATAR_BUCKET).remove([path]);
}

const urlCache = new Map<string, { url: string; expires: number }>();

/** Signed URL for a private avatar; storage RLS still decides if it is issued. */
export async function avatarUrl(path?: string | null): Promise<string | null> {
  if (!path) return null;
  const hit = urlCache.get(path);
  if (hit && hit.expires > Date.now()) return hit.url;
  const { data, error } = await supabase.storage.from(AVATAR_BUCKET).createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) return null;
  urlCache.set(path, { url: data.signedUrl, expires: Date.now() + 55 * 60 * 1000 });
  return data.signedUrl;
}

export interface ProfileUpdate {
  fullName?: string;
  handle?: string | null;
  avatarPath?: string | null;
  clearAvatar?: boolean;
  bio?: string | null;
  /** Merged into the stored preferences object by the database. */
  preferences?: Record<string, unknown>;
}

export async function updateOwnProfile(update: ProfileUpdate): Promise<void> {
  const { error } = await supabase.rpc("update_own_profile", {
    ...(update.fullName !== undefined ? { _full_name: update.fullName.trim() } : {}),
    ...(update.handle !== undefined ? { _handle: normalizeHandle(update.handle ?? "") } : {}),
    ...(update.avatarPath !== undefined && update.avatarPath !== null
      ? { _avatar_path: update.avatarPath }
      : {}),
    ...(update.clearAvatar ? { _clear_avatar: true } : {}),
    ...(update.bio !== undefined ? { _bio: (update.bio ?? "").trim() } : {}),
    ...(update.preferences !== undefined ? { _preferences: update.preferences as Json } : {}),
  });
  if (error) throw new Error(error.message);
}

/** Initials fallback shown when a member has no photo. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]![0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]![0] ?? "") : "";
  return (first + last).toUpperCase();
}

/**
 * One place that decides whether "Save profile" may run, so the button, the
 * save handler and the tests all agree. Returns a message to show, or null.
 */
export function profileSaveIssue(input: {
  name: string;
  handle: string;
  handleState: HandleCheck | "idle" | "checking";
  hasFile: boolean;
  hasCrop: boolean;
}): string | null {
  const nameProblem = validateDisplayName(input.name);
  if (nameProblem) return nameProblem;
  const handleProblem = validateHandle(input.handle);
  if (handleProblem) return handleProblem;
  if (input.handleState === "checking") return "Still checking that handle — try again in a moment";
  if (input.handleState === "taken")
    return `${displayHandle(input.handle)} is already used by another member of this shop. Choose a different handle to save.`;
  if (input.hasFile && !input.hasCrop) return "Your photo is still loading — try again in a moment";
  return null;
}
