/**
 * Wallet Center data layer — one place for every wallet the signed-in person
 * owns, the history of each, and every transfer they are allowed to make.
 *
 * Nothing here is an authorization layer. `my_shop_wallets` / `my_memberships`
 * only describe the caller's own memberships, `wallet_upward_recipients` is
 * decided entirely in the database, and `transfer_credits_in_shop` re-checks
 * shop membership, the roles inside that shop and the parent/admin
 * relationship before moving a single credit. The helpers below simply keep
 * the UI honest so the button state matches what the database would accept.
 */
import { supabase } from "@/integrations/supabase/client";
import { fetchMyMemberships } from "@/lib/memberships";
import { fetchMyShopWallets } from "@/lib/shop-transfers";
import { friendlyWalletError } from "@/lib/wallet";
import type { Role } from "@/lib/wavewallet";

export interface WalletShop {
  ecosystemId: string;
  ecosystemName: string;
  balance: number;
  /** Role held inside THIS shop — roles never span shops. */
  role: Role | null;
}

export interface UpwardRecipient {
  id: string;
  full_name: string;
  handle: string | null;
  avatar_path: string | null;
  /** 'reseller' = the sender's own parent reseller, 'admin' = an admin of that shop. */
  relation: "reseller" | "admin";
}

/** Anyone the caller may send credits to inside ONE shop, as decided by the database. */
export interface ShopRecipient {
  id: string;
  full_name: string;
  handle: string | null;
  avatar_path: string | null;
  /** Role held inside this shop. */
  role: Role | null;
  /** How they relate to the caller: admin / reseller (my parent) / subreseller (my downline) / customer. */
  relation: string;
}


/* ------------------------------------------------------------------ */
/* Pure helpers (unit-tested)                                          */
/* ------------------------------------------------------------------ */

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** Total credits held across every shop wallet. */
export const totalWalletBalance = (shops: WalletShop[]): number =>
  round2(shops.reduce((sum, s) => sum + Number(s.balance || 0), 0));

/** Balance the source wallet is left with after a transfer. Never negative. */
export const projectedBalance = (balance: number, amount: number): number =>
  round2(Math.max(0, (Number(balance) || 0) - (Number(amount) || 0)));

/** Only a subreseller of the selected shop has an upward path. */
export const canSendUpward = (shop: WalletShop | null): boolean =>
  shop?.role === "subreseller";

/** The one reason a shop-scoped transfer cannot be submitted, or null. */
export function validateInShopTransfer(input: {
  ecosystemId: string | null;
  recipientId: string | null;
  amount: number;
  balance: number;
}): string | null {
  const { ecosystemId, recipientId, amount, balance } = input;
  if (!ecosystemId) return "Choose which shop wallet to send from.";
  if (!recipientId) return "Choose a recipient.";
  if (!Number.isFinite(amount) || amount <= 0) return "Enter a positive amount.";
  if (amount > balance) return "That is more than this shop wallet holds.";
  return null;
}

/** Human label for an upward recipient. */
export const upwardRelationLabel = (relation: UpwardRecipient["relation"]): string =>
  relation === "reseller" ? "My reseller" : "Shop admin";

/* ------------------------------------------------------------------ */
/* Data access                                                         */
/* ------------------------------------------------------------------ */

/** Every shop wallet the caller owns, with the role they hold in that shop. */
export async function fetchWalletShops(): Promise<WalletShop[]> {
  const [wallets, memberships] = await Promise.all([fetchMyShopWallets(), fetchMyMemberships()]);
  const roleOf = new Map(memberships.map((m) => [m.ecosystemId, m.role]));
  return wallets.map((w) => ({
    ecosystemId: w.ecosystemId,
    ecosystemName: w.ecosystemName,
    balance: Number(w.balance ?? 0),
    role: roleOf.get(w.ecosystemId) ?? null,
  }));
}

/**
 * Who a subreseller may send credits UP to inside one shop: their own parent
 * reseller (only when that reseller is active in the same shop) and every
 * active admin of that shop. Empty for anyone else — the database decides.
 */
export async function fetchUpwardRecipients(ecosystemId: string): Promise<UpwardRecipient[]> {
  const { data, error } = await supabase.rpc("wallet_upward_recipients", {
    _ecosystem_id: ecosystemId,
  });
  if (error) return [];
  return ((data ?? []) as unknown as UpwardRecipient[]).map((r) => ({
    id: r.id,
    full_name: r.full_name,
    handle: r.handle ?? null,
    avatar_path: r.avatar_path ?? null,
    relation: r.relation === "reseller" ? "reseller" : "admin",
  }));
}

/** Face-value transfer from ONE of the caller's own shop wallets. */
export async function transferInShop(input: {
  ecosystemId: string;
  recipientId: string;
  amount: number;
  note?: string;
}): Promise<string> {
  const { data, error } = await supabase.rpc("transfer_credits_in_shop", {
    _ecosystem_id: input.ecosystemId,
    _recipient_id: input.recipientId,
    _amount: input.amount,
    ...(input.note ? { _note: input.note } : {}),
  });
  if (error) throw new Error(friendlyWalletError(error.message));
  return (data ?? "") as unknown as string;
}
