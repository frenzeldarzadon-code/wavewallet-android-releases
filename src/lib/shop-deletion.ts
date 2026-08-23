/**
 * Permanent shop deletion by the shop's own admin.
 *
 * This rule supersedes every earlier shop-deletion rule: a shop may only be
 * deleted when no member still holds Coins. Either every member balance is
 * already zero, or the Coins were returned to the shop admin first — Coins
 * sitting with the admin are settled and never block deletion.
 *
 * The rule is enforced in the database (`delete_own_shop` re-checks it inside
 * the same transaction); everything here is presentation only. Deletion is
 * recorded in the platform deletion log with the outstanding-Coin snapshot so
 * the platform owner can audit it afterwards.
 */
import { supabase } from "@/integrations/supabase/client";

export interface CoinHolder {
  user_id: string;
  name: string;
  handle: string | null;
  balance: number;
}

export interface ShopDeletionCheck {
  ecosystem_id: string;
  outstanding_total: number;
  holders: CoinHolder[];
  can_delete: boolean;
}

export async function fetchShopDeletionCheck(ecosystemId: string): Promise<ShopDeletionCheck> {
  const { data, error } = await supabase.rpc("shop_deletion_check", {
    _ecosystem_id: ecosystemId,
  });
  if (error) throw new Error(error.message);
  const raw = (data ?? {}) as Partial<ShopDeletionCheck>;
  return {
    ecosystem_id: raw.ecosystem_id ?? ecosystemId,
    outstanding_total: Number(raw.outstanding_total ?? 0),
    holders: (raw.holders ?? []).map((h) => ({ ...h, balance: Number(h.balance ?? 0) })),
    can_delete: Boolean(raw.can_delete),
  };
}

/** Plain-language explanation of why deletion is blocked, or null when allowed. */
export function deletionBlockedReason(check: ShopDeletionCheck | null): string | null {
  if (!check) return "Checking member Coin balances…";
  if (check.can_delete) return null;
  const count = check.holders.length;
  return (
    `Deletion is blocked: ${count} member${count === 1 ? "" : "s"} still hold ` +
    `${check.outstanding_total.toLocaleString()} Coins. ` +
    "Every member's Coin balance must be zero — either they spend their Coins or they return " +
    "them to you (the shop admin). Coins held by you do not block deletion."
  );
}

export function deleteConfirmationMatches(shopName: string, typed: string): boolean {
  return typed.trim() === shopName.trim() && shopName.trim().length > 0;
}

export function canSubmitShopDeletion(input: {
  check: ShopDeletionCheck | null;
  shopName: string;
  typed: string;
  reason: string;
  busy: boolean;
}): boolean {
  if (input.busy || !input.check?.can_delete) return false;
  if (input.reason.trim().length === 0) return false;
  return deleteConfirmationMatches(input.shopName, input.typed);
}

export async function deleteOwnShop(input: {
  ecosystemId: string;
  confirmName: string;
  reason: string;
}): Promise<{ name: string }> {
  const { data, error } = await supabase.rpc("delete_own_shop", {
    _ecosystem_id: input.ecosystemId,
    _confirm_name: input.confirmName,
    _reason: input.reason,
  });
  if (error) throw new Error(error.message);
  return (data ?? { name: "Shop" }) as unknown as { name: string };
}
