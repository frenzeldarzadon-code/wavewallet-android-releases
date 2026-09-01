/**
 * Hand-off from a generated Omada customized portal page to WaveWallet.
 *
 * The captive-portal page is served BY the controller, so this endpoint is
 * cross-origin and unauthenticated by nature. It is safe because it only ever:
 *  - resolves the shop from a saved, enabled portal mapping (server-side);
 *  - stores the Omada client context the controller itself produced;
 *  - answers with a short-lived hotspot session id and the shop name.
 * No wallet, member, balance, code or credential is ever returned here.
 */
import { createFileRoute } from "@tanstack/react-router";
import { parsePortalParams } from "@/lib/portal-mapping";
import { sanitizePortalContext } from "@/lib/portal-redeem";

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

export const Route = createFileRoute("/api/public/portal-context")({
  server: {
    handlers: {
      OPTIONS: () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        let payload: { mappingId?: unknown; context?: unknown; pageUrl?: unknown };
        try {
          payload = (await request.json()) as typeof payload;
        } catch {
          return json({ ok: false, reason: "Invalid request." }, 400);
        }
        const mappingId = typeof payload.mappingId === "string" ? payload.mappingId : "";
        if (!UUID.test(mappingId)) return json({ ok: false, reason: "Unknown portal." }, 400);

        const rawContext =
          payload.context && typeof payload.context === "object"
            ? (payload.context as Record<string, unknown>)
            : {};
        const search = sanitizePortalContext(rawContext);
        const params = parsePortalParams(search);

        // The page's own address (origin + path only). Stored as reported;
        // it is only ever USED after being checked against the shop's saved
        // controller host, so a made-up address goes nowhere.
        let pageUrl: string | null = null;
        if (typeof payload.pageUrl === "string" && payload.pageUrl.length <= 512) {
          try {
            const u = new URL(payload.pageUrl);
            if (u.protocol === "http:" || u.protocol === "https:") {
              pageUrl = `${u.origin}${u.pathname}`;
            }
          } catch {
            /* not a URL: ignored */
          }
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: mapping } = await supabaseAdmin
          .from("omada_portal_mappings")
          .select("id, ecosystem_id, enabled, site_id, ssid_info")
          .eq("id", mappingId)
          .maybeSingle();
        if (!mapping || mapping.enabled === false) {
          return json({ ok: false, reason: "This hotspot portal is not active." }, 404);
        }

        const { data: shop } = await supabaseAdmin
          .from("ecosystems")
          .select("name")
          .eq("id", mapping.ecosystem_id as string)
          .maybeSingle();

        const { data: session } = await supabaseAdmin
          .from("portal_sessions")
          .insert({
            mapping_id: mapping.id,
            ecosystem_id: mapping.ecosystem_id,
            client_mac: params.clientMac,
            client_ip: params.clientIp,
            ap_mac: params.apMac,
            ssid: params.ssidName ?? (mapping.ssid_info as string | null),
            radio_id: params.radioId,
            site_ref: params.siteRef ?? (mapping.site_id as string),
            redirect_url: params.redirectUrl,
            // Kept verbatim so a purchased code can be carried back to the
            // exact controller portal page with its original Omada context.
            raw_query: search,
            page_url: pageUrl,
          })
          .select("id")
          .single();
        if (!session) return json({ ok: false, reason: "Session could not be started." }, 500);

        return json({
          ok: true,
          sessionId: String(session.id),
          shopName: (shop?.name as string | null) ?? null,
          hasClient: Boolean(params.clientMac),
        });
      },
    },
  },
});
