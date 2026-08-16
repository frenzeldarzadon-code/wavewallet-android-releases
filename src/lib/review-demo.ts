/**
 * Review shop simulation client.
 *
 * Every value here lives in the demo_* tables and is completely separate from
 * the production ledger — a review shop can never move real Coins.
 */
import { supabase } from "@/integrations/supabase/client";

export type DemoWallet = {
  id: string;
  ecosystem_id: string;
  member_key: string;
  display_name: string;
  role: string;
  parent_key: string | null;
  balance: number;
  points: number;
};

export type DemoVoucher = {
  id: string;
  name: string;
  description: string;
  price: number;
  stock: number;
  display_order: number;
};

export type DemoEntry = {
  id: string;
  member_key: string;
  direction: "credit" | "debit";
  amount: number;
  balance_after: number;
  entry_kind: string;
  reason: string;
  tx_id: string | null;
  created_at: string;
};

export type DemoState = {
  ecosystem_id: string;
  name: string;
  is_review: boolean;
  review_ends_at: string | null;
  ended: boolean;
  wallets: DemoWallet[];
  vouchers: DemoVoucher[];
  ledger: DemoEntry[];
};

export type ReviewShop = {
  id: string;
  name: string;
  slug: string;
  review_ends_at: string | null;
  ended: boolean;
};

const unwrap = <T,>(data: unknown, error: { message: string } | null): T => {
  if (error) throw new Error(error.message);
  return data as T;
};

/** The signed-in member's review shop, if they have one. */
export async function fetchMyReviewShop(): Promise<ReviewShop | null> {
  const { data, error } = await supabase.rpc("my_review_shop");
  if (error) throw new Error(error.message);
  return (data as ReviewShop | null) ?? null;
}

export async function fetchDemoState(ecosystemId: string): Promise<DemoState> {
  const { data, error } = await supabase.rpc("demo_shop_state", { _ecosystem_id: ecosystemId });
  return unwrap<DemoState>(data, error);
}

export async function demoTransfer(
  ecosystemId: string,
  from: string,
  to: string,
  amount: number,
): Promise<void> {
  const { error } = await supabase.rpc("demo_transfer", {
    _ecosystem_id: ecosystemId,
    _from: from,
    _to: to,
    _amount: amount,
  });
  if (error) throw new Error(error.message);
}

export type DemoSaleResult = {
  tx_id: string;
  total: number;
  reseller: number;
  subreseller: number;
  admin: number;
  points: number;
};

export async function demoSellVoucher(
  ecosystemId: string,
  voucherId: string,
  quantity: number,
): Promise<DemoSaleResult> {
  const { data, error } = await supabase.rpc("demo_sell_voucher", {
    _ecosystem_id: ecosystemId,
    _voucher_id: voucherId,
    _quantity: quantity,
  });
  return unwrap<DemoSaleResult>(data, error);
}

export async function demoReset(ecosystemId: string): Promise<void> {
  const { error } = await supabase.rpc("demo_reset", { _ecosystem_id: ecosystemId });
  if (error) throw new Error(error.message);
}

/** Human countdown for the 5-day review window. */
export function reviewCountdown(endsAt: string | null | undefined, now = Date.now()): string {
  if (!endsAt) return "No end date";
  const ms = new Date(endsAt).getTime() - now;
  if (ms <= 0) return "Review ended";
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  if (days > 0) return `${days}d ${hours}h left`;
  if (hours > 0) return `${hours}h ${minutes}m left`;
  return `${minutes}m left`;
}
