/**
 * Scheduled Voucher Shop stock replenishment sweep.
 *
 * Called by an external scheduler with the shared secret header. It checks each
 * shop's calibrated voucher products and tops up any whose available Voucher
 * Shop stock has fallen below the threshold. Products without a saved
 * calibration are never generated for.
 *
 *   POST /api/public/voucher-replenishment-sweep
 *   x-voucher-sweep-secret: <VOUCHER_REPLENISH_SECRET>
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
  const expected =
    process.env["VOUCHER_REPLENISH_SECRET"] ?? process.env["OMADA_HEALTH_SWEEP_SECRET"];
  if (!expected) {
    return new Response(JSON.stringify({ error: "Replenishment sweep is not configured." }), {
      status: 503,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }
  const provided =
    request.headers.get("x-voucher-sweep-secret") ??
    request.headers.get("x-omada-sweep-secret") ??
    "";
  if (!provided || !safeEqual(provided, expected)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { sweepReplenishments } = await import("@/lib/voucher-replenishment.server");
  const summary = await sweepReplenishments(supabaseAdmin as never);

  return new Response(JSON.stringify({ ok: true, ...summary }), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export const Route = createFileRoute("/api/public/voucher-replenishment-sweep")({
  server: { handlers: { POST: handle, GET: handle } },
});
