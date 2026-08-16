/**
 * Shop-to-shop credit transfers, routed through the member's global (Universe)
 * wallet.
 *
 * Financial rules mirrored from `transfer_credits_between_shops`:
 *  - Both the source and the destination must be shops the member is APPROVED
 *    and active in. The database re-checks this; nothing here is trusted.
 *  - A flat platform fee (default 5 credits) is deducted from the amount, so
 *    the destination shop receives amount − fee. The fee is platform-owner
 *    earnings and leaves the member's circulating balance.
 *  - Transferred credits NEVER earn cashback for the transfer itself, and any
 *    purchase later funded by them pays the destination shop admin the full
 *    100% retained share (resellers and subresellers earn 0), because the
 *    received credits are recorded as a `transfer` provenance lot.
 */
import { supabase } from "@/integrations/supabase/client";

export interface ShopWallet {
  ecosystemId: string;
  ecosystemName: string;
  balance: number;
}

export interface ShopTransferQuote {
  amount: number;
  fee: number;
  net: number;
}

export const DEFAULT_SHOP_TRANSFER_FEE = 5;

/* ------------------------------------------------------------------ */
/* Pure helpers (unit-tested)                                          */
/* ------------------------------------------------------------------ */

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** What the destination shop actually receives. Never negative. */
export function quoteShopTransfer(amount: number, fee: number): ShopTransferQuote {
  const gross = round2(amount);
  const f = Math.max(0, round2(fee));
  return { amount: gross, fee: f, net: round2(Math.max(0, gross - f)) };
}

/**
 * The single reason a transfer cannot be submitted, or null when it is valid.
 * Mirrors every guard the database enforces, so the button state matches.
 */
export function validateShopTransfer(input: {
  fromEcosystemId: string | null;
  toEcosystemId: string | null;
  amount: number;
  balance: number;
  fee: number;
}): string | null {
  const { fromEcosystemId, toEcosystemId, amount, balance, fee } = input;
  if (!fromEcosystemId || !toEcosystemId) return "Choose both a source and a destination shop.";
  if (fromEcosystemId === toEcosystemId) return "Choose two different shops.";
  if (!Number.isFinite(amount) || amount <= 0) return "Enter a positive amount.";
  if (amount <= fee) return `Send more than the ${fee} coin fee.`;
  if (amount > balance) return "That is more than the source shop wallet holds.";
  return null;
}

/** Shops that can still receive, given the chosen source. */
export const destinationOptions = (wallets: ShopWallet[], fromEcosystemId: string | null) =>
  wallets.filter((w) => w.ecosystemId !== fromEcosystemId);

/* ------------------------------------------------------------------ */
/* Data access                                                         */
/* ------------------------------------------------------------------ */

/** Balance of every shop wallet the signed-in member owns. */
export async function fetchMyShopWallets(): Promise<ShopWallet[]> {
  const { data, error } = await supabase.rpc("my_shop_wallets");
  if (error) return [];
  return ((data ?? []) as { ecosystem_id: string; ecosystem_name: string; balance: number }[]).map(
    (r) => ({
      ecosystemId: r.ecosystem_id,
      ecosystemName: r.ecosystem_name,
      balance: Number(r.balance ?? 0),
    }),
  );
}

/** Current platform fee for moving credits between two of your own shops. */
export async function fetchShopTransferFee(): Promise<number> {
  const { data } = await supabase
    .from("platform_settings")
    .select("shop_transfer_fee_credits")
    .eq("id", 1)
    .maybeSingle();
  const fee = Number((data as { shop_transfer_fee_credits?: number } | null)?.shop_transfer_fee_credits);
  return Number.isFinite(fee) ? fee : DEFAULT_SHOP_TRANSFER_FEE;
}

export async function transferBetweenShops(input: {
  fromEcosystemId: string;
  toEcosystemId: string;
  amount: number;
  note?: string;
}): Promise<{ txId: string; fee: number; net: number }> {
  const { data, error } = await supabase.rpc("transfer_credits_between_shops", {
    _from_ecosystem_id: input.fromEcosystemId,
    _to_ecosystem_id: input.toEcosystemId,
    _amount: input.amount,
    ...(input.note ? { _note: input.note } : {}),
  });
  if (error) throw new Error(error.message);
  const row = (data as unknown as { tx_id: string; fee_credits: number; net_credits: number }[])[0];
  return {
    txId: row?.tx_id ?? "",
    fee: Number(row?.fee_credits ?? 0),
    net: Number(row?.net_credits ?? 0),
  };
}
