/** TEMPORARY capability probe. Read-only. Deleted after investigation. */
import { createFileRoute } from "@tanstack/react-router";

const KEY = "probe-8f3a1c";

export const Route = createFileRoute("/api/public/omada-probe-temp")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get("k") !== KEY) return new Response("no", { status: 404 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { openOmadaSession } = await import("@/lib/omada-api.server");
        const { data: eco } = await supabaseAdmin
          .from("ecosystems")
          .select("id, slug")
          .eq("slug", "sagadawave")
          .maybeSingle();
        if (!eco) return Response.json({ error: "no shop" }, { status: 404 });
        const session = await openOmadaSession(supabaseAdmin as never, eco.id);
        const site = `${session.base}/openapi/v1/${session.omadacId}/sites/${session.siteId}`;
        const ctl = `${session.base}/openapi/v1/${session.omadacId}`;

        const devRes = await fetch(`${site}/devices?page=1&pageSize=100`, {
          headers: { Authorization: `AccessToken=${session.token}` },
        });
        const devJson = (await devRes.json()) as any;
        const devices = (devJson?.result?.data ?? []) as any[];
        const ap = devices.find((d) => String(d.type).toLowerCase() === "ap");
        const mac = ap?.mac ?? devices[0]?.mac ?? "";
        const enc = encodeURIComponent(mac);

        const paths = [
          `${site}/devices/${enc}`,
          `${site}/devices/${enc}/detail`,
          `${site}/devices/${enc}/clients?page=1&pageSize=10`,
          `${site}/devices/${enc}/statistics`,
          `${site}/devices/${enc}/radio`,
          `${site}/devices/${enc}/wireless`,
          `${site}/devices/${enc}/config`,
          `${site}/devices/${enc}/settings`,
          `${site}/devices/${enc}/led`,
          `${site}/devices/${enc}/upgrade`,
          `${site}/devices/${enc}/firmware`,
          `${site}/devices/${enc}/reprovision`,
          `${site}/devices/${enc}/forget`,
          `${site}/devices/${enc}/adopt`,
          `${site}/devices/account`,
          `${site}/pending-devices?page=1&pageSize=10`,
          `${site}/devices/pending?page=1&pageSize=10`,
          `${site}/clients?page=1&pageSize=5`,
          `${site}/dashboard`,
          `${site}/statistics`,
          `${site}/insight/clients?page=1&pageSize=5`,
          `${site}/firmware`,
          `${site}/device-firmware`,
          `${ctl}/devices?page=1&pageSize=10`,
          `${ctl}/firmware/latest`,
        ];

        const out: any[] = [];
        for (const p of paths) {
          try {
            const r = await fetch(p, { headers: { Authorization: `AccessToken=${session.token}` } });
            const t = await r.text();
            let body: any = t.slice(0, 600);
            try {
              body = JSON.parse(t);
            } catch {
              /* text */
            }
            out.push({
              path: p.replace(site, "{site}").replace(ctl, "{ctl}"),
              status: r.status,
              code: body?.errorCode ?? null,
              msg: body?.msg ?? null,
              keys:
                body?.result && typeof body.result === "object"
                  ? Array.isArray(body.result)
                    ? ["<array>", body.result.length]
                    : Object.keys(body.result).slice(0, 40)
                  : null,
              sample:
                body?.result && !Array.isArray(body.result)
                  ? JSON.stringify(body.result).slice(0, 900)
                  : JSON.stringify(body?.result ?? body).slice(0, 900),
            });
          } catch (e) {
            out.push({ path: p, error: String(e) });
          }
        }
        return Response.json({ mac, deviceSample: devices[0] ?? null, probes: out });
      },
    },
  },
});
