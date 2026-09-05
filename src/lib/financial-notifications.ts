/**
 * Financial notifications — device registration and delivery helpers.
 *
 * The alerts themselves are written by the database, after (and only after) a
 * money movement is actually committed. Nothing in this file can create,
 * approve or change a financial transaction; it only registers where a person
 * wants to be alerted and reads back what happened.
 *
 * A "device" is one browser on one phone or computer. When the browser can
 * give us a real push subscription (a VAPID key is configured) we store that
 * endpoint; otherwise we register a local device id so the person still gets
 * in-app history plus foreground alerts, and the delivery log stays honest
 * about what was actually sent.
 */
import { supabase } from "@/integrations/supabase/client";
import { VAPID_PUBLIC_KEY } from "@/lib/push-config";

export const FINANCIAL_CATEGORIES = [
  { kind: "cash_in", label: "Cash In updates" },
  { kind: "purchase", label: "Purchases" },
  { kind: "cashback", label: "Cashback received" },
  { kind: "transfer", label: "Coins sent and received" },
  { kind: "points", label: "Points earned and spent" },
  { kind: "reward_redemption", label: "Reward redemptions" },
  { kind: "refund", label: "Refunds and reversals" },
  { kind: "withdrawal", label: "Cash Out updates" },
  { kind: "wallet_adjustment", label: "Other wallet movements" },
] as const;

const FINANCIAL_KINDS = new Set<string>(FINANCIAL_CATEGORIES.map((c) => c.kind));

export function isFinancialKind(kind: string): boolean {
  return FINANCIAL_KINDS.has(kind);
}

export interface PushDevice {
  id: string;
  device_label: string | null;
  user_agent: string | null;
  push_enabled: boolean;
  expired_at: string | null;
  last_error: string | null;
  last_seen_at: string;
  created_at: string;
  /** Present only for real push subscriptions (never for `local:` fallbacks). */
  endpoint?: string | null;
  push_capable?: boolean;
}

const DEVICE_ID_KEY = "wavewallet.device-id";

function fail(message: string): never {
  throw new Error(message);
}

/** A friendly, non-identifying name for the browser in front of us. */
export function deviceLabel(userAgent: string): string {
  const ua = userAgent.toLowerCase();
  if (ua.includes("android")) return "Android phone";
  if (ua.includes("iphone")) return "iPhone";
  if (ua.includes("ipad")) return "iPad";
  if (ua.includes("mac os")) return "Mac";
  if (ua.includes("windows")) return "Windows PC";
  if (ua.includes("linux")) return "Linux computer";
  return "This browser";
}

/** Plain wording for the delivery log. Never claims a send that did not happen. */
export function deliverySummary(status: string | null | undefined): string {
  if (!status) return "Saved to your list";
  const parts = status.split(",");
  if (parts.includes("sent")) return "Alert sent";
  if (parts.includes("failed")) return "Alert could not be delivered";
  if (parts.includes("pending")) return "Alert queued";
  return "Saved to your list";
}

export function localDeviceId(): string {
  if (typeof window === "undefined") return "server";
  const existing = window.localStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `d-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  window.localStorage.setItem(DEVICE_ID_KEY, id);
  return id;
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/**
 * Can this browser, right now, receive real phone notifications?
 *
 *  ready          — service worker active, push API present
 *  needs-install  — iPhone/iPad: Safari only allows push for apps added to the
 *                   Home Screen
 *  unavailable    — no service worker here (development / preview / iframe)
 *  unsupported    — the browser has no push API at all
 */
export type PushSupport = "ready" | "needs-install" | "unavailable" | "unsupported";

export async function pushSupport(): Promise<PushSupport> {
  if (typeof window === "undefined" || typeof navigator === "undefined") return "unsupported";
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/i.test(ua) || (ua.includes("Mac") && "ontouchend" in document);
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true;
  if (
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  ) {
    return isIOS && !standalone ? "needs-install" : "unsupported";
  }
  if (isIOS && !standalone) return "needs-install";
  try {
    const reg = await navigator.serviceWorker.getRegistration("/");
    if (!reg) return "unavailable";
    return "ready";
  } catch {
    return "unavailable";
  }
}

/** The live browser subscription, creating it when asked. Throws with a plain reason. */
async function browserSubscription(
  create: boolean,
): Promise<{ endpoint: string; p256dh: string | null; auth: string | null } | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  if (!reg || !("pushManager" in reg)) return null;
  let sub = await reg.pushManager.getSubscription();
  if (!sub && create) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
    });
  }
  if (!sub) return null;
  const json = sub.toJSON();
  // Only keep keys the sender can actually decode; otherwise record the
  // device without a push subscription rather than poisoning the queue.
  const ok = (v: string | undefined) => !!v && /^[A-Za-z0-9_-]{16,}$/.test(v);
  const p256dh = json.keys?.["p256dh"];
  const auth = json.keys?.["auth"];
  return {
    endpoint: sub.endpoint,
    p256dh: ok(p256dh) && ok(auth) ? p256dh! : null,
    auth: ok(p256dh) && ok(auth) ? auth! : null,
  };
}

/**
 * Registers this browser for the signed-in person. Safe to call repeatedly:
 * an existing subscription is refreshed, a new one is only created when
 * `subscribe` is true (i.e. from the person's own tap after granting
 * permission). Without a real subscription a local device id is recorded so
 * the in-app history and delivery log stay honest.
 */
export async function registerThisDevice(
  opts: { subscribe?: boolean; label?: string } = {},
): Promise<{ id: string | null; pushCapable: boolean }> {
  const sub = await browserSubscription(opts.subscribe ?? false);
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const { data, error } = await supabase.rpc("register_push_device", {
    _endpoint: sub?.endpoint ?? `local:${localDeviceId()}`,
    ...(sub?.p256dh ? { _p256dh: sub.p256dh } : {}),
    ...(sub?.auth ? { _auth: sub.auth } : {}),
    _label: opts.label ?? deviceLabel(ua),
    _user_agent: ua,
  });
  if (error) fail(error.message);
  return { id: (data as string | null) ?? null, pushCapable: !!(sub?.p256dh && sub?.auth) };
}

/** Drops this browser's push subscription (used when the person switches push off here). */
export async function unsubscribeThisDevice(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => undefined);
  const devices = await fetchPushDevices().catch(() => [] as PushDevice[]);
  const mine = devices.find((d) => d.endpoint === endpoint);
  if (mine) await removeDevice(mine.id).catch(() => undefined);
}

/** Is this exact browser one of the person's registered push devices? */
export async function thisDeviceEndpoint(): Promise<string | null> {
  try {
    const sub = await browserSubscription(false);
    return sub?.endpoint ?? null;
  } catch {
    return null;
  }
}

/** Sends the signed-in person one test alert through the whole pipeline. */
export async function sendTestNotification(): Promise<void> {
  const { error } = await supabase.rpc("send_test_notification");
  if (error) fail(error.message);
}

export async function fetchPushDevices(): Promise<PushDevice[]> {
  const { data, error } = await supabase.rpc("my_push_devices");
  if (error) fail(error.message);
  return (data ?? []) as PushDevice[];
}

export async function setDeviceEnabled(id: string, enabled: boolean): Promise<void> {
  const { error } = await supabase.rpc("set_push_device_enabled", { _id: id, _enabled: enabled });
  if (error) fail(error.message);
}

export async function removeDevice(id: string): Promise<void> {
  const { error } = await supabase.rpc("remove_push_device", { _id: id });
  if (error) fail(error.message);
}

/** Marks a token the browser has invalidated so nothing tries it again. */
export async function expireDevice(id: string, reason?: string): Promise<void> {
  const { error } = await supabase.rpc("expire_push_device", {
    _id: id,
    _reason: reason ?? "subscription expired",
  });
  if (error) fail(error.message);
}
