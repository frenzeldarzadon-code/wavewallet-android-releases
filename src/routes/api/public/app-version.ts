/**
 * Public, anonymous update manifest.
 *
 * Read-only presentation metadata: which web build and which Android build are
 * current. No secrets, no account data, no money data. Installed shells poll
 * this occasionally to decide whether to suggest a refresh or a new APK.
 *
 * The Android part is read live from the official release record the platform
 * owner maintains in Super Admin → Platform, so publishing a new APK no longer
 * needs a web deploy. The values compiled into update-manifest.ts remain the
 * fallback whenever that record is unreachable or not filled in yet.
 */
import { createFileRoute } from "@tanstack/react-router";
import { buildUpdateManifest, type UpdateManifest } from "@/lib/update-manifest";

interface ReleaseRow {
  android_enabled: boolean;
  android_download_url: string;
  android_version: string;
  android_version_code: number | null;
}

/** Live Android release, or null when the record is missing/incomplete. */
async function liveAndroidRelease(): Promise<ReleaseRow | null> {
  const url = process.env["VITE_SUPABASE_URL"] ?? process.env["SUPABASE_URL"];
  const key =
    process.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ??
    process.env["SUPABASE_PUBLISHABLE_KEY"] ??
    process.env["SUPABASE_ANON_KEY"];
  if (!url || !key) return null;
  try {
    const res = await fetch(
      `${url}/rest/v1/app_release?id=eq.1&select=android_enabled,android_download_url,android_version,android_version_code`,
      { headers: { apikey: key, accept: "application/json" } },
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as ReleaseRow[];
    const row = rows?.[0];
    if (!row) return null;
    if (!row.android_enabled) return null;
    if (!row.android_download_url?.startsWith("https://")) return null;
    if (!row.android_version_code || row.android_version_code <= 0) return null;
    return row;
  } catch {
    return null;
  }
}

export const Route = createFileRoute("/api/public/app-version")({
  server: {
    handlers: {
      GET: async () => {
        const manifest: UpdateManifest = buildUpdateManifest();
        const live = await liveAndroidRelease();
        // Only ever move forward: a stale record can never downgrade the
        // version installed shells are told about.
        if (live && (live.android_version_code ?? 0) > manifest.android.versionCode) {
          manifest.android = {
            ...manifest.android,
            versionCode: live.android_version_code as number,
            versionName: live.android_version || manifest.android.versionName,
            updateUrl: live.android_download_url,
          };
        }
        return new Response(JSON.stringify(manifest), {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store, max-age=0",
            "access-control-allow-origin": "*",
          },
        });
      },
    },
  },
});
