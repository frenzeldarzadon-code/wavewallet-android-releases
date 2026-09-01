/**
 * Exchanges a single-use connect ticket for the voucher code it protects, and
 * records the controller's real verdict afterwards.
 *
 * Called by the controller-served portal page after WaveWallet sent the
 * customer back with ?wwRedeem=<ticket>. Cross-origin and unauthenticated by
 * nature; safe because:
 *  - a ticket is a random single-use value that expires within minutes and is
 *    burned on first claim, so the address can never be replayed;
 *  - each ticket is bound server-side to ONE hotspot session and its shop's
 *    portal mapping — a ticket presented to another portal answers nothing;
 *  - only the voucher code the customer already owns is returned. The page
 *    then fills Omada's OWN voucher form, so what redeems the code is the
 *    controller's native /portal/auth authentication, never WaveWallet.
 */
import { createFileRoute } from "@tanstack/react-router";

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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const Route = createFileRoute("/api/public/portal-redeem")({
  server: {
    handlers: {
      OPTIONS: () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        let payload: { mappingId?: unknown; token?: unknown; result?: unknown };
        try {
          payload = (await request.json()) as typeof payload;
        } catch {
          return json({ ok: false, reason: "Invalid request." }, 400);
        }
        const mappingId = typeof payload.mappingId === "string" ? payload.mappingId : "";
        const token = typeof payload.token === "string" ? payload.token.trim() : "";
        if (!UUID.test(mappingId) || !token || token.length > 64) {
          return json({ ok: false, reason: "Unknown ticket." }, 400);
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { claimPortalRedemption, reportPortalRedemption } = await import(
          "@/lib/portal-redeem.server"
        );

        // Verdict report: only ever flips a ticket that was already claimed.
        if (payload.result && typeof payload.result === "object") {
          const result = payload.result as Record<string, unknown>;
          const ok = result["ok"] === true;
          const errorCode = typeof result["errorCode"] === "number" ? result["errorCode"] : null;
          const done = await reportPortalRedemption(supabaseAdmin, token, ok, errorCode);
          return json({ ok: done.ok });
        }

        const claim = await claimPortalRedemption(supabaseAdmin, mappingId, token);
        if (!claim.ok) return json({ ok: false, reason: claim.reason }, 410);
        return json({ ok: true, code: claim.code });
      },
    },
  },
});
