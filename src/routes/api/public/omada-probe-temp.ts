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
        const site2 = `${session.base}/openapi/v2/${session.omadacId}/sites/${session.siteId}`;
        const H = { Authorization: `AccessToken=${session.token}`, "content-type": "application/json" };

        const devRes = await fetch(`${site}/devices?page=1&pageSize=100`, { headers: H });
        const devJson = (await devRes.json()) as any;
        const devices = (devJson?.result?.data ?? devJson?.result ?? []) as any[];
        const aps = devices.filter((d) => String(d.type).toLowerCase() === "ap");
        const online = aps.find((d) => d.status === 1) ?? aps[0];
        const mac = encodeURIComponent(online?.mac ?? "");

        const out: any[] = [];
        const hit = async (label: string, u: string, init?: RequestInit) => {
          try {
            const r = await fetch(u, { headers: H, ...init });
            const t = await r.text();
            let b: any = t.slice(0, 400);
            try {
              b = JSON.parse(t);
            } catch {
              /* text */
            }
            out.push({
              label,
              status: r.status,
              code: b?.errorCode ?? null,
              msg: b?.msg ?? null,
              result: JSON.stringify(b?.result ?? b).slice(0, 1200),
            });
          } catch (e) {
            out.push({ label, error: String(e) });
          }
        };

        await hit("radio-config", `${site}/aps/${mac}/radio-config`);
        await hit("firmware-info", `${site}/devices/${mac}/latest-firmware-info`);
        await hit("health-detail", `${site}/eaps/${mac}/health/detail`);
        await hit("timeline", `${site}/devices/${mac}/timeline?page=1&pageSize=5`);
        await hit("adopt-result", `${site}/devices/${mac}/adopt-result`);
        await hit("topology-clients", `${site2}/topology/devices/${mac}/clients?page=1&pageSize=5`);
        await hit("channel-info", `${site}/aps/channel-info`, {
          method: "POST",
          body: JSON.stringify([decodeURIComponent(mac)]),
        });
        await hit("channel-limit", `${site}/aps/${mac}/channel-limit`);
        await hit("clients", `${site}/clients?page=1&pageSize=3`);

        return Response.json({
          apCount: aps.length,
          probedMac: decodeURIComponent(mac),
          probedStatus: online?.status,
          statuses: devices.map((d) => ({ n: d.name, t: d.type, s: d.status, ds: d.detailStatus })),
          out,
        });
      },
    },
  },
});
