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
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

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
  const { data, error } = await supabase.storage.from(PROOF_BUCKET).createSignedUrl(path, 3600);
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
  const { error } = await supabase.rpc("submit_subscription_request", {
    _ecosystem_id: input.ecosystemId,
    _reference: input.reference,
    _amount_paid: input.amountPaid ?? null,
    _proof_path: input.proofPath ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function reviewSubscriptionRequest(
  requestId: string,
  decision: "approved" | "rejected",
  reason?: string | null,
) {
  const { error } = await supabase.rpc("review_subscription_request", {
    _request_id: requestId,
    _decision: decision,
    _reason: reason?.trim() ? reason.trim() : null,
  });
  if (error) throw new Error(error.message);
}

export const requestTone = (status: string) =>
  status === "approved" ? "success" : status === "rejected" ? "danger" : "warning";
