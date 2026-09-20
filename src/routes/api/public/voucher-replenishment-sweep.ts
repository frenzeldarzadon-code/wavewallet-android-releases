/**
 * Scheduled Voucher Shop stock replenishment sweep.
 *
 * This is the ONLY thing that keeps voucher stock topped up while nobody is
 * looking: the database scheduler calls it on a fixed interval, it checks each
 * shop's calibrated voucher products and tops up any whose available Voucher
 * Shop stock has fallen below the threshold. Products without a saved
 * calibration are never generated for. The Generate screen is a manual/status
 * surface only — it is not what makes automation happen.
 *
 *   POST /api/public/voucher-replenishment-sweep
 *   x-voucher-sweep-secret: <shared secret>
 *
 * The secret may come either from an environment secret or from the private
 * `internal_job_tokens` row the scheduler reads, so the scheduled job needs no
 * credential plumbing of its own. Either way the value never leaves the server.
 */
import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";

const TOKEN_NAME = "voucher_replenishment_sweep";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

async function handle({ request }: { request: Request }) {
  const provided =
    request.headers.get("x-voucher-sweep-secret") ??
    request.headers.get("x-omada-sweep-secret") ??
    "";
  if (!provided) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const envSecret =
    process.env["VOUCHER_REPLENISH_SECRET"] ?? process.env["OMADA_HEALTH_SWEEP_SECRET"] ?? null;
  const dbSecret = ((
    await supabaseAdmin
      .from("internal_job_tokens")
      .select("token")
      .eq("name", TOKEN_NAME)
      .maybeSingle()
  ).data as { token: string } | null)?.token ?? null;

  if (!envSecret && !dbSecret) {
    return new Response(JSON.stringify({ error: "Replenishment sweep is not configured." }), {
      status: 503,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }

  const authorised =
    (envSecret !== null && safeEqual(provided, envSecret)) ||
    (dbSecret !== null && safeEqual(provided, dbSecret));
  if (!authorised) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }

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
