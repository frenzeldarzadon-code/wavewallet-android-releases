/**
 * Platform-owner credit management.
 *
 * Two capabilities live here, both platform-owner only and both authorized in
 * the database (never in this file):
 *
 *  1. Verification of admin credit purchase requests — approve / reject /
 *     freeze. The RPCs lock the order row and refuse a second review, so a
 *     double click or two concurrent operators can only ever release the
 *     credits once.
 *  2. Super Admin Credit Issuance — the platform owner MINTS credits straight
 *     into any account. It goes through `superadmin_issue_credits`, which is
 *     platform-owner only, never reads or debits the operator's own wallet
 *     (issuing with a zero balance is valid), writes one immutable
 *     `superadmin_credit_issuance` ledger row, one row in the platform
 *     issuance supply record and one audit entry. It never touches voucher
 *     inventory, commissions or historical rows.
 */
import { supabase } from "@/integrations/supabase/client";
import type { CreditPurchaseOrder, OrderStatus } from "@/lib/credit-purchases";

/** Ledger entry kind reserved for minted platform credits. */
export const ISSUANCE_ENTRY_KIND = "superadmin_credit_issuance";

/** Marker that identifies a minted credit forever after. */
export const CREDIT_ISSUANCE_ACTION = "Super Admin Coin Issuance";

/** Legacy label used by wallet-style manual grants written before issuance. */
export const LEGACY_MANUAL_CREDIT_ACTION = "Superadmin Manual Coin";

/** Largest single issuance the UI will submit. Mirrored in the database. */
export const CREDIT_ISSUANCE_MAX = 10_000_000;

export type QueueFilter = "pending" | OrderStatus | "all";

export const QUEUE_FILTERS: { value: QueueFilter; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "frozen", label: "Frozen" },
  { value: "all", label: "All" },
];

/** How many requests are still waiting for the platform owner. */
export function pendingCount(orders: Pick<CreditPurchaseOrder, "status">[]): number {
  return orders.filter((o) => o.status === "pending").length;
}

export function filterOrders(
  orders: CreditPurchaseOrder[],
  filter: QueueFilter,
): CreditPurchaseOrder[] {
  if (filter === "all") return orders;
  return orders.filter((o) => o.status === filter);
}

/** Balance the recipient will hold once the issuance is written. */
export function previewBalance(current: number, amount: number): number {
  return Math.round((Number(current || 0) + Number(amount || 0)) * 100) / 100;
}

/** Optional bucket the operator can tag an issuance with, for later reporting. */
export const CREDIT_ISSUANCE_CATEGORIES = [
  "Goodwill",
  "Correction",
  "Promotion",
  "Verified payment",
  "Migration",
] as const;
export type CreditIssuanceCategory = (typeof CREDIT_ISSUANCE_CATEGORIES)[number];

/** The reason stored on the ledger row — always identifies the action type. */
export function issuanceReason(note?: string | null, category?: string | null): string {
  const tag = (category ?? "").trim();
  const extra = (note ?? "").trim();
  const tail = [tag ? `[${tag}]` : "", extra].filter(Boolean).join(" ");
  return tail ? `${CREDIT_ISSUANCE_ACTION} — ${tail}` : CREDIT_ISSUANCE_ACTION;
}

/** True for a minted credit — new issuances and legacy manual grants alike. */
export function isCreditIssuance(reason: string | null | undefined): boolean {
  const r = reason ?? "";
  return r.startsWith(CREDIT_ISSUANCE_ACTION) || r.startsWith(LEGACY_MANUAL_CREDIT_ACTION);
}

/** Friendly blocker for the issuance form, or null when it may be sent. */
export function issuanceFormIssue(input: {
  userId?: string | null;
  amount: number;
  reason?: string | null;
}): string | null {
  if (!input.userId) return "Choose the account to coin";
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return "Enter how many coins to issue";
  }
  if (!Number.isInteger(input.amount)) {
    return "Coins must be a whole number";
  }
  if (input.amount > CREDIT_ISSUANCE_MAX) {
    return `A single issuance is limited to ${CREDIT_ISSUANCE_MAX.toLocaleString()} coins`;
  }
  if (input.reason !== undefined && (input.reason ?? "").trim().length < 5) {
    return "Give a reason of at least 5 characters";
  }
  return null;
}

/* ------------------------------------------------------------------ data */

export interface MemberShopWallet {
  ecosystemId: string;
  ecosystemName: string;
  role: string;
  balance: number;
}

/**
 * The shops one member belongs to, with the balance each shop wallet holds.
 * Wallets never merge across shops, so issuance must name the shop it lands
 * in. Platform-owner only; the database re-checks that.
 */
export async function fetchMemberShopWallets(userId: string): Promise<MemberShopWallet[]> {
  const { data, error } = await supabase.rpc("member_shop_wallets", { _user_id: userId });
  if (error) return [];
  return ((data ?? []) as {
    ecosystem_id: string;
    ecosystem_name: string;
    role: string;
    balance: number;
  }[]).map((r) => ({
    ecosystemId: r.ecosystem_id,
    ecosystemName: r.ecosystem_name,
    role: r.role,
    balance: Number(r.balance ?? 0),
  }));
}

/**
 * Mints credits into an account from the platform issuance authority.
 *
 * Nothing is taken from the operator's wallet — the platform owner may issue
 * with a zero balance. The credits land in the recipient's wallet for the
 * chosen shop only. Authorization, atomicity, duplicate protection
 * (`requestKey`) and the audit trail are all the database's job.
 */
export async function issueCredits(input: {
  userId: string;
  amount: number;
  reason: string;
  category?: string;
  reference?: string;
  requestKey?: string;
  ecosystemId?: string | null;
}): Promise<string> {
  const issue = issuanceFormIssue(input);
  if (issue) throw new Error(issue);
  const { data, error } = await supabase.rpc("superadmin_issue_credits", {
    _user_id: input.userId,
    _amount: input.amount,
    _reason: issuanceReason(input.reason, input.category ?? null),
    ...(input.category ? { _category: input.category } : {}),
    ...(input.reference?.trim() ? { _reference: input.reference.trim() } : {}),
    _request_key: input.requestKey ?? crypto.randomUUID(),
    ...(input.ecosystemId ? { _ecosystem_id: input.ecosystemId } : {}),
  });
  if (error) throw new Error(error.message);
  return data as unknown as string;
}


export interface CreditSupply {
  total_issued: number;
  issuance_count: number;
  last_issued_at: string | null;
}

/** Cumulative credits minted by the platform owner. */
export async function fetchCreditSupply(): Promise<CreditSupply> {
  const { data, error } = await supabase.rpc("platform_credit_supply");
  const row = (data ?? [])[0];
  if (error || !row) return { total_issued: 0, issuance_count: 0, last_issued_at: null };
  return {
    total_issued: Number(row.total_issued ?? 0),
    issuance_count: Number(row.issuance_count ?? 0),
    last_issued_at: (row.last_issued_at as string | null) ?? null,
  };
}

/** Shop names for the verification queue (RLS decides what is readable). */
export async function fetchEcosystemNames(): Promise<Map<string, string>> {
  const { data } = await supabase.from("ecosystems").select("id, name");
  return new Map((data ?? []).map((e) => [e.id as string, e.name as string]));
}

/** Count of purchase requests still awaiting verification. */
export async function fetchPendingOrderCount(): Promise<number> {
  const { count, error } = await supabase
    .from("credit_purchase_orders")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  if (error) return 0;
  return count ?? 0;
}
