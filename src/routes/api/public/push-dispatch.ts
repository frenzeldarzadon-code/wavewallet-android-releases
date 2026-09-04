/**
 * Push dispatch wake-up.
 *
 * The database calls this right after it queues phone deliveries (and a
 * low-frequency safety check re-calls it while anything is still pending).
 * It only ever processes deliveries the database already decided to send;
 * the caller cannot choose recipients or content.
 *
 *   POST /api/public/push-dispatch
 *   x-push-dispatch-secret: <PUSH_DISPATCH_SECRET>
 */
import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

async function handle({ request }: { request: Request }) {
  const expected = process.env["PUSH_DISPATCH_SECRET"];
  if (!expected) return json({ error: "Push dispatch is not configured." }, 503);
  const provided = request.headers.get("x-push-dispatch-secret") ?? "";
  if (!provided || !safeEqual(provided, expected)) return json({ error: "Unauthorized" }, 401);

  const { vapidFromEnv, dispatchPendingPush } = await import("@/lib/push-dispatch.server");
  const vapid = vapidFromEnv();
  if (!vapid) return json({ error: "Push keys are not configured." }, 503);

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  try {
    const summary = await dispatchPendingPush(supabaseAdmin as never, vapid);
    return json({ ok: true, ...summary });
  } catch (e) {
    console.error("push dispatch failed", e);
    return json({ error: "Dispatch failed" }, 500);
  }
}

export const Route = createFileRoute("/api/public/push-dispatch")({
  server: { handlers: { POST: handle } },
});
