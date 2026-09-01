/**
 * Issues the post-authentication hand-off for a generated Omada portal.
 *
 * Cross-origin and unauthenticated by nature (the page is served by the
 * controller). It is safe because it only turns a saved, enabled portal mapping
 * into a signed, short-lived, single-shop link. No wallet, member, balance,
 * voucher code or Omada credential is ever returned.
 */
import { createFileRoute } from "@tanstack/react-router";
import { issuePortalHandoff } from "@/lib/portal-handoff.server";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "POST, OPTIONS",
  "cache-control": "no-store",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });
}

export const Route = createFileRoute("/api/public/portal-handoff")({
  server: {
    handlers: {
      OPTIONS: () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const secret = process.env["LOVABLE_API_KEY"];
        if (!secret) return json({ ok: false, reason: "Hand-off unavailable." }, 503);

        let payload: { mappingId?: unknown; sessionId?: unknown };
        try {
          payload = (await request.json()) as typeof payload;
        } catch {
          return json({ ok: false, reason: "Invalid request." }, 400);
        }
        const mappingId = typeof payload.mappingId === "string" ? payload.mappingId : "";
        const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : null;

        const result = await issuePortalHandoff(
          { mappingId, sessionId },
          resolvePublicOrigin({
            configured: process.env["PUBLIC_APP_ORIGIN"] ?? null,
            request: new URL(request.url).origin,
          }),
          secret,
        );
        return result.ok ? json(result) : json(result, 404);
      },
    },
  },
});
