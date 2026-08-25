/**
 * Scheduled Omada health sweep.
 *
 * Called by an external scheduler (or manually by the operator) with the shared
 * secret header. It checks every tenant whose next check is due, applying that
 * tenant's own backoff. It performs no writes to WaveWallet money/voucher data.
 *
 *   POST /api/public/omada-health-sweep
 *   x-omada-sweep-secret: <OMADA_HEALTH_SWEEP_SECRET>
 */
import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

async function handle({ request }: { request: Request }) {
  const expected = process.env["OMADA_HEALTH_SWEEP_SECRET"];
  if (!expected) {
    return new Response(JSON.stringify({ error: "Health sweep is not configured." }), {
      status: 503,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }
  const provided = request.headers.get("x-omada-sweep-secret") ?? "";
  if (!provided || !safeEqual(provided, expected)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { sweepDueOmadaConnections } = await import("@/lib/omada-health.server");
  const summary = await sweepDueOmadaConnections(supabaseAdmin as never);

  return new Response(JSON.stringify({ ok: true, ...summary }), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export const Route = createFileRoute("/api/public/omada-health-sweep")({
  server: { handlers: { POST: handle, GET: handle } },
});
