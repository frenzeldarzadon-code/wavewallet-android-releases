/**
 * Official app release metadata.
 *
 * The Android APK is distributed from a permanent public URL that the platform
 * owner pastes into Super Admin → Platform. Nothing here touches wallets,
 * Coins, ledgers or authorization: it is presentation metadata plus an
 * anonymous download counter (no personal data is recorded).
 */
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type AppRelease = Database["public"]["Tables"]["app_release"]["Row"];

export interface AppReleaseInput {
  enabled: boolean;
  downloadUrl: string;
  version: string;
  releaseDate: string; // yyyy-mm-dd or ""
  sizeBytes: number;
  minOs: string;
  sha256: string;
  notes: string;
}

/** Human file size for the version card. Returns "" when unknown. */
export function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Normalises a pasted checksum: hex only, lower case. */
export function normalizeSha256(value: string): string {
  return value.replace(/[^0-9a-fA-F]/g, "").toLowerCase();
}

/** Client-side guard mirroring the database rules, for friendlier messages. */
export function validateRelease(input: AppReleaseInput): string | null {
  const url = input.downloadUrl.trim();
  if (url && !/^https:\/\//i.test(url)) return "The download link must start with https://";
  if (input.enabled && !url) return "Add the official APK link before publishing the download.";
  const sha = normalizeSha256(input.sha256);
  if (sha && sha.length !== 64) return "SHA-256 must be 64 hexadecimal characters.";
  if (input.sizeBytes < 0) return "File size cannot be negative.";
  return null;
}

/** True when the public page should show a working download button. */
export function isDownloadable(release: AppRelease | null): boolean {
  return Boolean(release?.android_enabled && release.android_download_url.trim());
}

export async function fetchAppRelease(): Promise<AppRelease | null> {
  const { data } = await supabase.from("app_release").select("*").eq("id", 1).maybeSingle();
  return data ?? null;
}

export async function updateAppRelease(input: AppReleaseInput): Promise<AppRelease> {
  const problem = validateRelease(input);
  if (problem) throw new Error(problem);
  const { data, error } = await supabase.rpc("update_app_release", {
    _android_enabled: input.enabled,
    _android_download_url: input.downloadUrl.trim(),
    _android_version: input.version.trim(),
    // A blank date must reach Postgres as NULL, which the generated types type as string.
    _android_release_date: (input.releaseDate.trim() || null) as unknown as string,
    _android_size_bytes: Math.max(0, Math.round(input.sizeBytes)),
    _android_min_os: input.minOs.trim() || "Android 7.0+",
    _android_sha256: normalizeSha256(input.sha256),
    _android_release_notes: input.notes.trim(),
  });
  if (error) throw new Error(error.message);
  return data as AppRelease;
}

/** Anonymous counter only — no identity, device or IP data is stored. */
export async function recordAppDownload(): Promise<void> {
  try {
    await supabase.rpc("record_app_download");
  } catch {
    /* counting must never block a download */
  }
}
