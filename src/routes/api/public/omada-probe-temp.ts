/** TEMPORARY read-only Omada probe. Deleted after investigation. */
import { createFileRoute } from "@tanstack/react-router";

const TOKEN = "probe-9c2f4b7a";

async function call(url: string, init: RequestInit) {
  try {
    const res = await fetch(url, init);
    const text = await res.text();
    return { url: url.replace(/AccessToken=[^&]+/, "***"), status: res.status, body: text.slice(0, 600) };
  } catch (e) {
    return { url, status: 0, body: String(e).slice(0, 300) };
  }
}

export const Route = createFileRoute("/api/public/omada-probe-temp")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const u = new URL(request.url);
        if (u.searchParams.get("token") !== TOKEN) return new Response("no", { status: 404 });
        const ecosystemId = u.searchParams.get("ecosystemId")!;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { openOmadaSession } = await import("@/lib/omada-api.server");
        const s = await openOmadaSession(supabaseAdmin as never, ecosystemId);
        const H = { Authorization: `AccessToken=${s.token}`, accept: "application/json" };
        const site = `${s.base}/openapi/v1/${s.omadacId}/sites/${s.siteId}`;
        const mac = u.searchParams.get("mac") ?? "C2-12-E6-71-C1-A6";
        const out: unknown[] = [];
        out.push(await call(`${s.base}/api/info`, { headers: H }));
        out.push(await call(`${site}/clients/authorize`, { headers: H }));
        out.push(
          await call(`${site}/clients/authorize?clientMac=${encodeURIComponent(mac)}&time=60000&authType=4`, {
            headers: H,
          }),
        );
        out.push(await call(`${site}/clients?page=1&pageSize=3`, { headers: H }));
        // TP-Link external portal API (hotspot operator session required)
        out.push(
          await call(`${s.base}/${s.omadacId}/api/v2/hotspot/extPortal/auth`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ clientMac: mac, apMac: "30-68-93-63-06-36", ssidName: "Sagada Wave", radioId: 1, time: 60000, authType: 4 }),
          }),
        );
        out.push(
          await call(`${s.base}/${s.omadacId}/api/v2/hotspot/login`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: "x", password: "x" }),
          }),
        );
        return Response.json({ base: s.base, siteId: s.siteId, out });
      },
    },
  },
});
