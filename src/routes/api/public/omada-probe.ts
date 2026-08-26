/** TEMPORARY diagnostic probe — removed after verification. */
import { createFileRoute } from "@tanstack/react-router";

const TOKEN = "probe-9f3a71c4";

export const Route = createFileRoute("/api/public/omada-probe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json()) as {
          token: string;
          ecosystemId: string;
          paths: string[];
        };
        if (body.token !== TOKEN) return new Response("no", { status: 401 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { openOmadaSession } = await import("@/lib/omada-api.server");
        const session = await openOmadaSession(supabaseAdmin as never, body.ecosystemId);
        const out: Record<string, unknown> = {
          base: session.base,
          omadacId: session.omadacId,
          siteId: session.siteId,
        };
        for (const p of body.paths) {
          const url = `${session.base}${p
            .replace(/\{omadacId\}/g, session.omadacId)
            .replace(/\{siteId\}/g, session.siteId)}`;
          try {
            const res = await fetch(url, {
              headers: { Authorization: `AccessToken=${session.token}` },
            });
            const text = await res.text();
            out[p] = { status: res.status, body: text.slice(0, 2500) };
          } catch (e) {
            out[p] = { error: e instanceof Error ? e.message : String(e) };
          }
        }
        return Response.json(out);
      },
    },
  },
});
