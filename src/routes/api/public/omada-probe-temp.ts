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
        {
          const all: Array<Record<string, unknown>> = [];
          for (let page = 1; page <= 3; page++) {
            const r = await fetch(`${site}/clients?page=${page}&pageSize=100`, { headers: H });
            const j = (await r.json()) as any;
            const rows = j?.result?.data ?? [];
            all.push(...rows);
            if (rows.length < 100) break;
          }
          const hit = all.find((c) => String(c["mac"]).toUpperCase() === mac.toUpperCase());
          out.push({ url: "client-lookup", status: all.length, body: JSON.stringify(hit ?? { notFound: mac, sample: all.slice(0, 2).map((c) => c["mac"]) }).slice(0, 800) });
        }
        out.push(await call(`${site}/clients/${mac}`, { headers: H }));
        out.push(await call(`${site}/clients/${mac}/authorize?time=60000&authType=4`, { headers: H }));
        out.push(await call(`${site}/clients/${mac}/authorize`, { method: "POST", headers: { ...H, "content-type": "application/json" }, body: JSON.stringify({ time: 60000, authType: 4 }) }));
        out.push(await call(`${site}/hotspot/extPortal/auth`, { method: "POST", headers: { ...H, "content-type": "application/json" }, body: JSON.stringify({ clientMac: mac, time: 60000, authType: 4 }) }));
        out.push(await call(`${s.base}/openapi/v1/${s.omadacId}/hotspot/extPortal/auth`, { method: "POST", headers: { ...H, "content-type": "application/json" }, body: JSON.stringify({ clientMac: mac, time: 60000, authType: 4 }) }));
        out.push(await call(`${site}/clients/authorize`, { headers: H }));
        out.push(
          await call(`${site}/clients/authorize?clientMac=${encodeURIComponent(mac)}&time=60000&authType=4`, {
            headers: H,
          }),
        );
        out.push(
          await call(`${site}/clients/authorize`, {
            method: "POST",
            headers: { ...H, "content-type": "application/json" },
            body: JSON.stringify({ clientMac: mac, time: 60000, authType: 4 }),
          }),
        );
        out.push(
          await call(`${site}/clients/authorize`, {
            method: "POST",
            headers: { ...H, "content-type": "application/json" },
            body: JSON.stringify({}),
          }),
        );
        for (const doc of ["/openapi/v3/api-docs", "/openapi/doc", "/openapi/v1/openapi.json", "/doc/openapi.json"]) {
          const r = await call(`${s.base}${doc}`, { headers: H });
          out.push({ ...r, body: r.body.slice(0, 200) });
        }
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
