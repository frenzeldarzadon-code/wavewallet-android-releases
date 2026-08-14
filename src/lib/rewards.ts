/**
 * Stage 4 — points ledger + physical rewards data layer.
 *
 * Every mutation is a SECURITY DEFINER RPC that authorizes the caller against
 * their ecosystem and role inside the database. Balances and holds are always
 * read back from the ledger-maintained points_accounts row.
 */
import { supabase } from "@/integrations/supabase/client";
import { friendlyWalletError } from "@/lib/wallet";

export type PointsEntryType = "earn" | "spend" | "hold" | "release" | "claim" | "adjust";
export type RedemptionStatus = "pending" | "approved" | "rejected" | "cancelled" | "claimed";

export interface PointsAccount {
  balance: number;
  held: number;
  available: number;
}

export interface PointsEntry {
  id: string;
  direction: "credit" | "debit";
  entry_type: PointsEntryType;
  amount: number;
  balance_after: number;
  reason: string;
  reference: string | null;
  tx_id: string | null;
  created_at: string;
}

export interface RewardListing {
  id: string;
  name: string;
  description: string;
  points_price: number;
  available: number;
  image_path: string | null;
  rating_avg: number | null;
  rating_count: number;
  /** Claimed redemptions only. */
  redeemed_count: number;
}

export interface RewardProductRow {
  id: string;
  ecosystem_id: string;
  name: string;
  description: string;
  points_price: number;
  stock: number;
  reserved: number;
  active: boolean;
  archived: boolean;
  image_path: string | null;
  created_at: string;
}

export interface RedemptionRow {
  id: string;
  ecosystem_id: string;
  reward_id: string;
  reward_name: string;
  points_price: number;
  user_id: string;
  user_name: string;
  code: string;
  status: RedemptionStatus;
  tx_id: string | null;
  note: string | null;
  handled_by_name: string | null;
  handled_at: string | null;
  reward_image_path: string | null;
  created_at: string;
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

/** Points are shop-scoped exactly like credits — one account per membership. */
export async function fetchPointsAccount(
  userId: string,
  ecosystemId: string | null,
): Promise<PointsAccount> {
  const q = supabase.from("points_accounts").select("balance, held").eq("user_id", userId);
  const { data } = await (ecosystemId
    ? q.eq("ecosystem_id", ecosystemId)
    : q.is("ecosystem_id", null)
  ).maybeSingle();
  const balance = Number(data?.balance ?? 0);
  const held = Number(data?.held ?? 0);
  return { balance, held, available: Math.max(balance - held, 0) };
}

export async function fetchPointsLedger(
  userId: string,
  ecosystemId: string | null,
  limit = 100,
): Promise<PointsEntry[]> {
  const q = supabase
    .from("points_ledger")
    .select("id, direction, entry_type, amount, balance_after, reason, reference, tx_id, created_at")
    .eq("user_id", userId);
  const { data } = await (ecosystemId
    ? q.eq("ecosystem_id", ecosystemId)
    : q.is("ecosystem_id", null)
  )
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as unknown as PointsEntry[];
}

export async function fetchRewards(): Promise<RewardListing[]> {
  const { data, error } = await supabase.rpc("list_rewards");
  if (error) throw new Error(friendlyWalletError(error.message));
  return ((data ?? []) as unknown as RewardListing[]).map((r) => ({
    ...r,
    rating_avg: r.rating_avg === null ? null : Number(r.rating_avg),
    rating_count: Number(r.rating_count ?? 0),
    redeemed_count: Number(r.redeemed_count ?? 0),
  }));
}

export async function fetchRewardProducts(ecosystemId: string): Promise<RewardProductRow[]> {
  const { data, error } = await supabase
    .from("reward_products")
    .select("*")
    .eq("ecosystem_id", ecosystemId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(friendlyWalletError(error.message));
  return (data ?? []) as unknown as RewardProductRow[];
}

export async function fetchMyRedemptions(userId: string): Promise<RedemptionRow[]> {
  const { data } = await supabase
    .from("reward_redemptions")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);
  return (data ?? []) as unknown as RedemptionRow[];
}

export async function fetchEcosystemRedemptions(ecosystemId: string): Promise<RedemptionRow[]> {
  const { data, error } = await supabase.rpc("list_ecosystem_redemptions", {
    _ecosystem_id: ecosystemId,
  });
  if (error) throw new Error(friendlyWalletError(error.message));
  return (data ?? []) as unknown as RedemptionRow[];
}

export interface RedemptionLookup {
  id: string;
  code: string;
  reward_name: string;
  points_price: number;
  status: RedemptionStatus;
  user_name: string;
  created_at: string;
  ecosystem_name: string;
}

export async function lookupRedemption(code: string): Promise<RedemptionLookup | null> {
  const { data, error } = await supabase.rpc("lookup_redemption", { _code: code });
  if (error) throw new Error(friendlyWalletError(error.message));
  return ((data ?? []) as unknown as RedemptionLookup[])[0] ?? null;
}

/* ------------------------------------------------------------------ */
/* Mutations                                                           */
/* ------------------------------------------------------------------ */

export interface RequestedRedemption {
  id: string;
  code: string;
  reward_name: string;
  points_price: number;
  status: RedemptionStatus;
  tx_id: string;
}

export async function requestRedemption(rewardId: string): Promise<RequestedRedemption> {
  const { data, error } = await supabase.rpc("request_redemption", { _reward_id: rewardId });
  if (error) throw new Error(friendlyWalletError(error.message));
  const row = (data as unknown as RequestedRedemption[])[0];
  if (!row) throw new Error("The redemption could not be created.");
  return row;
}

export async function reviewRedemption(
  id: string,
  decision: "approve" | "reject" | "cancel",
  note?: string,
): Promise<string> {
  const { data, error } = await supabase.rpc("review_redemption", {
    _id: id,
    _decision: decision,
    ...(note ? { _note: note } : {}),
  });
  if (error) throw new Error(friendlyWalletError(error.message));
  return data as unknown as string;
}

export interface PointsPurchaseResult {
  tx_id: string;
  code: string;
  points_spent: number;
  product_name: string;
  sale_id: string;
}

export async function purchaseVoucherWithPoints(productId: string): Promise<PointsPurchaseResult> {
  const { data, error } = await supabase.rpc("purchase_voucher_with_points", {
    _product_id: productId,
  });
  if (error) throw new Error(friendlyWalletError(error.message));
  const row = (data as unknown as PointsPurchaseResult[])[0];
  if (!row) throw new Error("Purchase could not be completed.");
  return row;
}

export async function adminAdjustPoints(input: {
  userId: string;
  amount: number;
  reason: string;
  reference?: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc("admin_adjust_points", {
    _user_id: input.userId,
    _amount: Math.trunc(input.amount),
    _reason: input.reason,
    ...(input.reference ? { _reference: input.reference } : {}),
  });
  if (error) throw new Error(friendlyWalletError(error.message));
  return data as unknown as string;
}

export async function setPointsRule(ecosystemId: string, creditsPerPoint: number): Promise<number> {
  const { data, error } = await supabase.rpc("set_points_rule", {
    _ecosystem_id: ecosystemId,
    _credits_per_point: creditsPerPoint,
  });
  if (error) throw new Error(friendlyWalletError(error.message));
  return Number(data);
}

export async function saveRewardProduct(input: {
  id?: string;
  ecosystemId: string;
  name: string;
  description: string;
  pointsPrice: number;
  stock: number;
  active: boolean;
  imagePath?: string | null;
}): Promise<void> {
  const payload = {
    ecosystem_id: input.ecosystemId,
    name: input.name.trim(),
    description: input.description.trim(),
    points_price: Math.trunc(input.pointsPrice),
    stock: Math.trunc(input.stock),
    active: input.active,
    ...(input.imagePath === undefined ? {} : { image_path: input.imagePath }),
  };
  const res = input.id
    ? await supabase.from("reward_products").update(payload).eq("id", input.id)
    : await supabase.from("reward_products").insert(payload);
  if (res.error) throw new Error(friendlyWalletError(res.error.message));
}

export async function setRewardArchived(id: string, archived: boolean): Promise<void> {
  const { error } = await supabase
    .from("reward_products")
    .update({ archived, active: archived ? false : true })
    .eq("id", id);
  if (error) throw new Error(friendlyWalletError(error.message));
}

export const redemptionTone = (status: RedemptionStatus) =>
  status === "pending"
    ? ("warning" as const)
    : status === "claimed" || status === "approved"
      ? ("success" as const)
      : ("danger" as const);

export const statusLabel = (status: RedemptionStatus) =>
  status === "claimed" ? "claimed" : status;

/** Fetches the ecosystem's configurable earning ratio (credits of spend per point). */
export async function fetchPointsRule(ecosystemId: string): Promise<number> {
  const { data } = await supabase
    .from("ecosystems")
    .select("credits_per_point")
    .eq("id", ecosystemId)
    .maybeSingle();
  return Number(data?.credits_per_point ?? 10);
}
