import { requireOnline } from "@/lib/offline-guard";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type SubscriptionPlan = Database["public"]["Tables"]["subscription_plans"]["Row"];
export type ShopSubscription = Database["public"]["Tables"]["shop_subscriptions"]["Row"];
export type SubscriptionEvent = Database["public"]["Tables"]["subscription_events"]["Row"];
export type Ecosystem = Database["public"]["Tables"]["ecosystems"]["Row"];

export type SubscriptionShop = Ecosystem & { subscription: ShopSubscription | null };

export type SubscriptionQuote = {
  current_plan_id: string | null;
  current_plan_name: string | null;
  current_monthly_price: number;
  current_allocation: number;
  new_plan_name: string;
  new_monthly_price: number;
  new_allocation: number;
  days_remaining: number;
  daily_value: number;
  unused_value: number;
  amount_due: number;
  additional_allocation: number;
  is_first_activation: boolean;
};

/** Plans shown on the public guide and in the platform console. */
export async function fetchPlans(): Promise<SubscriptionPlan[]> {
  const { data, error } = await supabase
    .from("subscription_plans")
    .select("*")
    .eq("active", true)
    .order("display_order");
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * Super Admin view of the single source of truth for Subscription Shop plans,
 * including inactive ones. RLS restricts writes to the platform owner.
 */
export async function fetchAllPlans(): Promise<SubscriptionPlan[]> {
  const { data, error } = await supabase
    .from("subscription_plans")
    .select("*")
    .order("display_order");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export type SubscriptionPlanEdit = Partial<
  Pick<
    SubscriptionPlan,
    | "name"
    | "tagline"
    | "description"
    | "monthly_price"
    | "coin_allocation"
    | "display_order"
    | "active"
    | "recommended"
    | "who_for"
    | "wifi_use_case"
    | "upgrade_hint"
  >
>;

/** Edits the existing plan row — no separate pricing store exists. */
export async function updatePlan(id: string, patch: SubscriptionPlanEdit): Promise<void> {
  requireOnline();
  const { error } = await supabase.from("subscription_plans").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Subscription Shops only — Legacy shops keep their own console area. */
export async function fetchSubscriptionShops(): Promise<SubscriptionShop[]> {
  const [{ data: shops, error }, { data: subs }] = await Promise.all([
    supabase
      .from("ecosystems")
      .select("*")
      .eq("shop_kind", "subscription")
      .order("created_at", { ascending: false }),
    supabase.from("shop_subscriptions").select("*"),
  ]);
  if (error) throw new Error(error.message);
  const byShop = new Map((subs ?? []).map((s) => [s.ecosystem_id, s]));
  return (shops ?? []).map((s) => ({ ...s, subscription: byShop.get(s.id) ?? null }));
}

export async function fetchSubscriptionEvents(ecosystemId: string): Promise<SubscriptionEvent[]> {
  const { data, error } = await supabase
    .from("subscription_events")
    .select("*")
    .eq("ecosystem_id", ecosystemId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Deterministic upgrade maths, computed server-side before any payment. */
export async function fetchQuote(ecosystemId: string, planId: string): Promise<SubscriptionQuote> {
  const { data, error } = await supabase.rpc("subscription_quote", {
    _ecosystem_id: ecosystemId,
    _plan_id: planId,
  });
  if (error) throw new Error(error.message);
  const row = (data as SubscriptionQuote[] | null)?.[0];
  if (!row) throw new Error("Could not calculate this plan change");
  return row;
}

export async function activateSubscription(input: {
  ecosystemId: string;
  planId: string;
  amountPhp: number | null;
  reference: string | null;
  months: number;
}): Promise<void> {
  requireOnline();
  const { error } = await supabase.rpc("activate_subscription", {
    _ecosystem_id: input.ecosystemId,
    _plan_id: input.planId,
    _months: input.months,
    ...(input.amountPhp === null ? {} : { _amount_php: input.amountPhp }),
    ...(input.reference ? { _reference: input.reference } : {}),
  });
  if (error) throw new Error(error.message);
}

export async function runSubscriptionExpiry(dryRun: boolean) {
  const { data, error } = await supabase.rpc("run_subscription_expiry", { _dry: dryRun });
  if (error) throw new Error(error.message);
  const row = (data as { warned: number; expired: number; reviews_frozen: number }[] | null)?.[0];
  return row ?? { warned: 0, expired: 0, reviews_frozen: 0 };
}

/** One 5-day review shop per member, with simulated coins only. */
export async function createReviewShop(name: string, description?: string) {
  requireOnline();
  const { data, error } = await supabase.rpc("create_review_shop", {
    _name: name,
    ...(description ? { _description: description } : {}),
  });

  if (error) throw new Error(error.message);
  return data as unknown as Ecosystem;
}

export function subscriptionStateLabel(state: string | null | undefined): string {
  switch (state) {
    case "review":
      return "Review (5 days)";
    case "active":
      return "Active";
    case "expiring_soon":
      return "Expiring soon";
    case "expired":
      return "Expired";
    case "frozen":
      return "Frozen";
    case "closed":
      return "Closed";
    default:
      return "Not started";
  }
}

export function subscriptionStateTone(
  state: string | null | undefined,
): "success" | "warning" | "danger" | "muted" {
  switch (state) {
    case "active":
      return "success";
    case "expiring_soon":
    case "review":
      return "warning";
    case "expired":
    case "frozen":
      return "danger";
    default:
      return "muted";
  }
}

export function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.ceil(ms / 86_400_000);
}
