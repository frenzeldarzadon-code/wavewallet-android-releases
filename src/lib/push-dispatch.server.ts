/**
 * Background push dispatcher.
 *
 * Drains `notification_deliveries` rows the database queued (one per active
 * device of the recipient) and sends each through Web Push. Every row is
 * claimed with row locks, so two overlapping runs can never send the same
 * delivery twice. Outcomes are written back so the device list and the
 * delivery log stay honest, and dead subscriptions are retired.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { pushText } from "@/lib/push-text";
import { sendWebPush, type VapidConfig } from "@/lib/web-push.server";

interface ClaimedDelivery {
  delivery_id: string;
  notification_id: string;
  device_id: string;
  user_id: string;
  endpoint: string;
  p256dh: string | null;
  auth_secret: string | null;
  kind: string;
  category: string | null;
  title: string;
  body: string | null;
  link: string | null;
  created_at: string;
  ecosystem_id: string | null;
  show_details: boolean | null;
}

export interface DispatchSummary {
  claimed: number;
  sent: number;
  failed: number;
  retried: number;
  expired: number;
  batches: number;
}

export function vapidFromEnv(): VapidConfig | null {
  const publicKey = process.env["VAPID_PUBLIC_KEY"];
  const privateKey = process.env["VAPID_PRIVATE_KEY"];
  const subject = process.env["VAPID_SUBJECT"] ?? "https://wallet.sagadawave.com";
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject };
}

async function finish(
  admin: SupabaseClient,
  id: string,
  status: "sent" | "failed" | "pending" | "skipped",
  reason?: string,
  deviceGone = false,
) {
  const { error } = await admin.rpc("finish_push_delivery", {
    _delivery_id: id,
    _status: status,
    _reason: reason ?? null,
    _device_gone: deviceGone,
  } as never);
  if (error) console.error("finish_push_delivery failed", error.message);
}

async function sendOne(
  admin: SupabaseClient,
  vapid: VapidConfig,
  d: ClaimedDelivery,
  summary: DispatchSummary,
) {
  if (!d.p256dh || !d.auth_secret || d.endpoint.startsWith("local:")) {
    await finish(admin, d.delivery_id, "skipped", "no_push_subscription");
    return;
  }
  const text = pushText(d);
  const payload = JSON.stringify({
    id: d.notification_id,
    title: text.title,
    body: text.body,
    tag: text.tag,
    link: text.link,
  });
  const result = await sendWebPush(
    { endpoint: d.endpoint, p256dh: d.p256dh, auth: d.auth_secret },
    vapid,
    payload,
    { topic: text.tag, urgency: d.category === "financial" ? "high" : "normal" },
  );
  switch (result.outcome) {
    case "sent":
      summary.sent += 1;
      await finish(admin, d.delivery_id, "sent");
      return;
    case "gone":
      summary.expired += 1;
      await finish(admin, d.delivery_id, "failed", `subscription gone (${result.status})`, true);
      return;
    case "retry":
      summary.retried += 1;
      await finish(admin, d.delivery_id, "pending", result.reason);
      return;
    default:
      summary.failed += 1;
      await finish(admin, d.delivery_id, "failed", result.reason);
  }
}

export async function dispatchPendingPush(
  admin: SupabaseClient,
  vapid: VapidConfig,
  opts: { batchSize?: number; maxBatches?: number } = {},
): Promise<DispatchSummary> {
  const summary: DispatchSummary = {
    claimed: 0,
    sent: 0,
    failed: 0,
    retried: 0,
    expired: 0,
    batches: 0,
  };
  const batchSize = opts.batchSize ?? 40;
  const maxBatches = opts.maxBatches ?? 25;

  for (let i = 0; i < maxBatches; i += 1) {
    const { data, error } = await admin.rpc("claim_push_deliveries", {
      _limit: batchSize,
    } as never);
    if (error) throw new Error(`claim_push_deliveries: ${error.message}`);
    const rows = (data ?? []) as ClaimedDelivery[];
    if (rows.length === 0) break;
    summary.batches += 1;
    summary.claimed += rows.length;
    // Modest parallelism keeps a burst of chat messages fast without hammering
    // one push service.
    for (let j = 0; j < rows.length; j += 8) {
      await Promise.all(rows.slice(j, j + 8).map((d) => sendOne(admin, vapid, d, summary)));
    }
    if (rows.length < batchSize) break;
  }
  return summary;
}
