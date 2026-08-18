// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { VitePWA } from "vite-plugin-pwa";

/**
 * Offline caching rules.
 *
 * Only the app shell, branding and public/static assets are cached. Every
 * authenticated or money-related request (Supabase, server functions, API
 * routes) is deliberately left uncached so a balance, ledger row or mutation
 * response can never be replayed from disk as if it were current truth.
 */
export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    // Unique per deploy: the update check compares this against the build id
    // reported by /api/public/app-version. No secrets, just an identifier.
    define: {
      __WW_BUILD__: JSON.stringify(
        process.env["WW_BUILD_ID"] ?? new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14),
      ),
    },
    plugins: [
      VitePWA({
        registerType: "autoUpdate",
        injectRegister: null,
        filename: "sw.js",
        devOptions: { enabled: false },
        manifest: false,
        outDir: "dist/client",
        workbox: {
          // Keep the first visit light on slow connections: only the shell styling,
          // fonts and icons are precached; route JS is cached as it is used.
          globPatterns: [
            "**/*.{css,woff2,webmanifest}",
            "favicon.png",
            "icon-192.png",
            "apple-touch-icon.png",
          ],
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          skipWaiting: true,
          maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
          runtimeCaching: [
            {
              // HTML navigations: always try the network first so signed-in
              // screens stay live; the cached copy is a last-resort fallback.
              urlPattern: ({ request, url, sameOrigin }) =>
                request.mode === "navigate" &&
                Boolean(sameOrigin) &&
                !url.pathname.startsWith("/api") &&
                !url.pathname.startsWith("/_serverFn") &&
                !url.pathname.startsWith("/~oauth"),
              handler: "NetworkFirst",
              options: {
                cacheName: "ww-pages",
                networkTimeoutSeconds: 4,
                expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 },
              },
            },
            {
              // Hashed build output and static branding only.
              urlPattern: ({ request, sameOrigin }) =>
                Boolean(sameOrigin) &&
                ["script", "style", "font", "image"].includes(request.destination),
              handler: "CacheFirst",
              options: {
                cacheName: "ww-assets",
                expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
              },
            },
          ],
        },
      }),
    ],
  },
});
