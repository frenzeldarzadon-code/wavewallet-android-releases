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

        let spec: any = null;
        for (const p of ["/v3/api-docs"]) {
          const r = await fetch(`${session.base}${p}`, {
            headers: { Authorization: `AccessToken=${session.token}` },
          });
          if (!r.ok) continue;
          const t = await r.text();
          try {
            const j = JSON.parse(t);
            if (j?.paths) {
              spec = j;
              break;
            }
          } catch {
            /* not json */
          }
        }
        if (!spec) { const dbg:any[]=[]; for (const p of ["/openapi/v3/api-docs","/openapi/v3/api-docs/swagger-config","/openapi/v2/api-docs","/v3/api-docs","/openapi/doc"]) { const r=await fetch(`${session.base}${p}`,{headers:{Authorization:`AccessToken=${session.token}`,accept:"application/json"}}); const t=await r.text(); dbg.push({p,status:r.status,len:t.length,head:t.slice(0,300)});} return Response.json({error:"no spec",dbg}); }

        const filter = url.searchParams.get("q") ?? "";
        const paths = Object.entries(spec.paths as Record<string, any>)
          .filter(([p]) => !filter || p.toLowerCase().includes(filter))
          .map(([p, ops]) => ({
            path: p,
            methods: Object.keys(ops as Record<string, unknown>),
            summaries: Object.entries(ops as Record<string, any>).map(
              ([m, o]) => `${m}:${o?.summary ?? o?.operationId ?? ""}`,
            ),
          }));
        const detail = url.searchParams.get("detail");
        if (detail) {
          return Response.json({
            path: detail,
            op: spec.paths[detail] ?? null,
            components: undefined,
          });
        }
        const ref = url.searchParams.get("ref");
        if (ref) {
          return Response.json({ ref, schema: spec.components?.schemas?.[ref] ?? null });
        }
        return Response.json({ total: Object.keys(spec.paths).length, paths });
      },
    },
  },
});
