/**
 * Public, anonymous update manifest.
 *
 * Read-only presentation metadata: which web build and which Android build are
 * current. No secrets, no account data, no money data. Installed shells poll
 * this occasionally to decide whether to suggest a refresh or a new APK.
 */
import { createFileRoute } from "@tanstack/react-router";
import { buildUpdateManifest } from "@/lib/update-manifest";

export const Route = createFileRoute("/api/public/app-version")({
  server: {
    handlers: {
      GET: async () =>
        new Response(JSON.stringify(buildUpdateManifest()), {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store, max-age=0",
            "access-control-allow-origin": "*",
          },
        }),
    },
  },
});
