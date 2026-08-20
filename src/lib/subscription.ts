/**
 * Stage 6 — manual subscription billing.
 *
 * Pricing, billing period and GCash collection details live in one
 * `platform_settings` row that only the platform owner can change. Every
 * submitted request snapshots the price/period in force at submission time, so
 * changing the global price never rewrites history.
 *
 * There is no payment gateway here on purpose: approval is manual.
 */
import { requireOnline } from "@/lib/offline-guard";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { peso, shortDate } from "@/lib/wavewallet";

export type PlatformSettings = Database["public"]["Tables"]["platform_settings"]["Row"];
export type SubscriptionRequest = Database["public"]["Tables"]["subscription_requests"]["Row"];
export type BillingPeriod = "monthly" | "quarterly" | "yearly";

export const BILLING_PERIODS: { value: BillingPeriod; label: string; per: string }[] = [
  { value: "monthly", label: "Monthly", per: "month" },
  { value: "quarterly", label: "Quarterly", per: "quarter" },
  { value: "yearly", label: "Yearly", per: "year" },
];

export const periodLabel = (p: string) =>
  BILLING_PERIODS.find((b) => b.value === p)?.per ?? "period";

export const PROOF_BUCKET = "payment-proofs";
export const MAX_PROOF_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_PROOF_TYPES = ["image/jpeg", "image/png", "image/webp"];

export function validateProof(file: File): string | null {
  if (!ALLOWED_PROOF_TYPES.includes(file.type)) return "Use a JPG, PNG or WEBP screenshot.";
  if (file.size > MAX_PROOF_BYTES) return "That image is larger than 5 MB.";
  return null;
}

export async function fetchPlatformSettings(): Promise<PlatformSettings | null> {
  const { data } = await supabase.from("platform_settings").select("*").eq("id", 1).maybeSingle();
  return data ?? null;
}

/** Objects are `{ecosystem_id}/{uuid}.{ext}` so storage RLS scopes them to one tenant. */
export async function uploadProof(ecosystemId: string, file: File): Promise<string> {
  const problem = validateProof(file);
  if (problem) throw new Error(problem);
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `${ecosystemId}/${crypto.randomUUID()}.${ext || "jpg"}`;
  const { error } = await supabase.storage
    .from(PROOF_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error(error.message);
  return path;
}

const urlCache = new Map<string, { url: string; expires: number }>();

export async function proofUrl(path?: string | null): Promise<string | null> {
  if (!path) return null;
  const hit = urlCache.get(path);
  if (hit && hit.expires > Date.now()) return hit.url;
  let { data, error } = await supabase.storage.from(PROOF_BUCKET).createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) {
    // New Generation Go Live payments reuse the shared private Cash In receipt
    // bucket, so fall back to it before giving up.
    ({ data, error } = await supabase.storage.from("cash-in-proofs").createSignedUrl(path, 3600));
  }
  if (error || !data?.signedUrl) return null;
  urlCache.set(path, { url: data.signedUrl, expires: Date.now() + 55 * 60 * 1000 });
  return data.signedUrl;
}

export async function fetchRequestsForEcosystem(ecosystemId: string) {
  const { data, error } = await supabase
    .from("subscription_requests")
    .select("*")
    .eq("ecosystem_id", ecosystemId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Platform-owner view: RLS returns every tenant's requests. */
export async function fetchAllRequests() {
  const { data, error } = await supabase
    .from("subscription_requests")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function submitSubscriptionRequest(input: {
  ecosystemId: string;
  reference: string;
  amountPaid?: number | null;
  proofPath?: string | null;
}) {
  requireOnline();
  const { error } = await supabase.rpc("submit_subscription_request", {
    _ecosystem_id: input.ecosystemId,
    _reference: input.reference,
    ...(input.amountPaid != null ? { _amount_paid: input.amountPaid } : {}),
    ...(input.proofPath ? { _proof_path: input.proofPath } : {}),
  });
  if (error) throw new Error(error.message);
}

export async function reviewSubscriptionRequest(
  requestId: string,
  decision: "approved" | "rejected",
  reason?: string | null,
) {
  requireOnline();
  const { error } = await supabase.rpc("review_subscription_request", {
    _request_id: requestId,
    _decision: decision,
    ...(reason?.trim() ? { _reason: reason.trim() } : {}),
  });
  if (error) throw new Error(error.message);
}

export const requestTone = (status: string) =>
  status === "approved" ? "success" : status === "rejected" ? "danger" : "warning";

/* ------------------------------------------------------------------ *
 * Per-ecosystem monthly duration rule
 *
 * Each shop has its own monthly rate. The number of months a payment buys
 * is derived from the amount — no manual month picker:
 *   months = amount / monthly rate  (150 => 1, 300 => 2, 450 => 3 …)
 * Amounts that are not an exact multiple are rejected, never rounded down
 * into a partial month. Mirrors public.months_for_payment in the database.
 * ------------------------------------------------------------------ */

export type DurationQuote =
  | {
      ok: true;
      months: number;
      amount: number;
      rate: number;
      /** Part of the payment that bought whole months. */
      applied: number;
      /** Leftover that buys no month — surfaced, never silently absorbed. */
      remainder: number;
    }
  | { ok: false; months: null; amount: number; rate: number; error: string };

export function monthsForPayment(amount: number, rate: number): DurationQuote {
  const fail = (error: string): DurationQuote => ({ ok: false, months: null, amount, rate, error });
  if (!Number.isFinite(rate) || rate <= 0)
    return fail("This shop has no monthly rate set yet — contact the platform owner.");
  if (!Number.isFinite(amount) || amount <= 0) return fail("Enter the amount you paid.");
  if (amount < rate) return fail(`Insufficient amount — one month costs ${peso(rate)}.`);
  // Work in centavos so 0.1-style float error can never invent a remainder.
  const cents = Math.round(amount * 100);
  const rateCents = Math.round(rate * 100);
  const months = Math.floor(cents / rateCents);
  const remainder = (cents - months * rateCents) / 100;
  return { ok: true, months, amount, rate, applied: (months * rateCents) / 100, remainder };
}

/**
 * New valid-until date: extends from the current expiry while the shop is
 * still active, otherwise starts from now.
 */
export function projectedExpiry(
  currentPeriodEnd: string | Date | null | undefined,
  months: number,
  now: Date = new Date(),
): Date {
  const current = currentPeriodEnd ? new Date(currentPeriodEnd) : null;
  const start = current && current.getTime() > now.getTime() ? current : now;
  const end = new Date(start.getTime());
  end.setMonth(end.getMonth() + months);
  return end;
}

/** Months a request covers, falling back to legacy quarterly/yearly rows. */
export function requestMonths(r: Pick<SubscriptionRequest, "months_purchased" | "billing_period">) {
  if (r.months_purchased != null) return r.months_purchased;
  return r.billing_period === "yearly" ? 12 : r.billing_period === "quarterly" ? 3 : 1;
}

export const monthsLabel = (months: number) => `${months} month${months === 1 ? "" : "s"}`;

/** Whole months of prepaid time left before the expiry date. */
export function prepaidRemaining(currentPeriodEnd: string | Date | null | undefined, now: Date = new Date()) {
  const end = currentPeriodEnd ? new Date(currentPeriodEnd) : null;
  if (!end || end.getTime() <= now.getTime()) return { expired: true, days: 0, label: "Expired" };
  const days = Math.ceil((end.getTime() - now.getTime()) / 86_400_000);
  const months = Math.floor(days / 30);
  const label =
    months >= 1
      ? `${months} month${months === 1 ? "" : "s"} ${days - months * 30} day${days - months * 30 === 1 ? "" : "s"} left`
      : `${days} day${days === 1 ? "" : "s"} left`;
  return { expired: false, days, label };
}

/* ------------------------------------------------------------------ *
 * Platform-owner expiration adjustments (courtesy / dispute)
 * Separate auditable events — payment records are never rewritten.
 * ------------------------------------------------------------------ */

export type SubscriptionAdjustment =
  Database["public"]["Tables"]["subscription_adjustments"]["Row"];

export const ADJUSTMENT_REASONS = [
  "Courtesy adjustment due to dispute",
  "Payment received outside the app",
  "Service downtime compensation",
  "Correcting a data entry error",
  "Other (see note)",
] as const;

/** "+7 days" / "-2 days" style summary of how far the expiry moved. */
export function adjustmentTimeFrame(
  previous: string | Date | null | undefined,
  next: string | Date,
): string {
  if (!previous) return "new expiry set";
  const diffMs = new Date(next).getTime() - new Date(previous).getTime();
  const days = Math.round(diffMs / 86_400_000);
  if (days === 0) return "no change";
  const sign = days > 0 ? "+" : "-";
  const abs = Math.abs(days);
  if (abs % 30 === 0) return `${sign}${abs / 30} month${abs / 30 === 1 ? "" : "s"}`;
  return `${sign}${abs} day${abs === 1 ? "" : "s"}`;
}

export const adjustmentIsShortening = (
  previous: string | Date | null | undefined,
  next: string | Date,
) => Boolean(previous) && new Date(next).getTime() < new Date(previous as string).getTime();

/** One-line audit sentence shown in history. */
export function adjustmentSummary(a: SubscriptionAdjustment): string {
  const frame = adjustmentTimeFrame(a.previous_period_end, a.new_period_end);
  const verb = a.direction === "shortened" ? "shortened" : "adjusted";
  return (
    `Expiration ${verb} by ${a.actor_name} (${frame}) — ` +
    `Original: ${a.previous_period_end ? shortDate(a.previous_period_end) : "none"} → ` +
    `New: ${shortDate(a.new_period_end)} — Reason: ${a.reason}`
  );
}

export async function fetchAdjustments(ecosystemId?: string) {
  let q = supabase
    .from("subscription_adjustments")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);
  if (ecosystemId) q = q.eq("ecosystem_id", ecosystemId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as SubscriptionAdjustment[];
}

export async function adjustExpiration(input: {
  ecosystemId: string;
  newPeriodEnd: Date | string;
  reason: string;
  note?: string | null;
  confirmShorten?: boolean;
}) {
  requireOnline();
  const note = input.note?.trim();
  const { data, error } = await supabase.rpc("adjust_ecosystem_expiration", {
    _ecosystem_id: input.ecosystemId,
    _new_period_end: new Date(input.newPeriodEnd).toISOString(),
    _reason: input.reason,
    _confirm_shorten: input.confirmShorten ?? false,
    ...(note ? { _note: note } : {}),
  });
  if (error) throw error;
  return data as unknown as SubscriptionAdjustment;
}
