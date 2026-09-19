/**
 * Coin loans — borrowing against the ONE global Universe wallet.
 *
 * Rules that matter (all re-checked in the database, never trusted from here):
 *  - Any member may borrow. Members holding a position (admin / reseller /
 *    subreseller) can be released automatically within their limit; customers
 *    ALWAYS wait for a manual decision by the platform owner.
 *  - The automatic-approval ceiling is the GREATER of the configured base
 *    amount and `multiplier x free (unloaned) balance`. It is recomputed
 *    server-side at request time; the number shown here is only a preview.
 *  - Anything above that ceiling waits for the platform owner.
 *  - The first month's interest is deducted from the coins handed over, while
 *    the full principal is owed.
 *  - Released coins sit as a RESTRICTED portion of the same wallet balance.
 *    A position holder's loan coins can only buy from shops where they hold
 *    that position; a customer's loan coins can buy from any Universe shop.
 *    Neither can ever be transferred, gifted or cashed out.
 *  - Top-ups repay the outstanding loan first; only the excess is spendable.
 */
import { supabase } from "@/integrations/supabase/client";
import { requireOnline } from "@/lib/offline-guard";

export interface CoinLoanSettings {
  enabled: boolean;
  baseCredits: number;
  multiplier: number;
  monthlyInterestPercent: number;
  firstMonthUpfront: boolean;
}

export interface CoinLoanSummary {
  loanId: string | null;
  status: string | null;
  approvalMode: string | null;
  principal: number;
  releasedAmount: number;
  outstanding: number;
  totalOwed: number;
  accruedInterest: number;
  interestPercent: number;
  firstMonthInterest: number;
  autoLimit: number;
  freeBalance: number;
  restrictedBalance: number;
  balance: number;
  hasPosition: boolean;
  /** Only position holders (admin/reseller/subreseller) can be auto-approved. */
  canAuto: boolean;
  /** Customer loans: the restricted coins may buy from any Universe shop. */
  universeSpend: boolean;
  borrowerRole: string | null;
  loansEnabled: boolean;
  requestedAt: string | null;
  releasedAt: string | null;
}

export interface MyCoinLoan {
  id: string;
  id_document_path?: string | null;
  principal: number;
  released_amount: number;
  first_month_interest: number;
  interest_percent: number;
  accrued_interest: number;
  outstanding: number;
  total_owed: number;
  status: string;
  approval_mode: string;
  origin: string | null;
  reference_note: string | null;
  universe_spend: boolean | null;
  created_at: string;
  released_at: string | null;
  settled_at: string | null;
}

export interface CoinLoanEntry {
  id: string;
  loan_id: string;
  kind: string;
  amount: number;
  outstanding_after: number;
  period_index: number | null;
  note: string | null;
  created_at: string;
}

export interface AdminCoinLoan {
  id: string;
  user_id: string;
  full_name: string | null;
  handle: string | null;
  principal: number;
  interest_percent: number;
  first_month_interest: number;
  auto_limit_snapshot: number;
  free_balance_snapshot: number;
  outstanding: number;
  released_amount: number;
  status: string;
  approval_mode: string;
  borrower_role: string | null;
  id_document_path: string | null;
  id_document_uploaded_at: string | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  released_at: string | null;
  created_at: string;
}

const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0) || 0);

/* ------------------------------------------------------------------ */
/* Pure helpers — mirror the database maths so previews match exactly. */
/* ------------------------------------------------------------------ */

/** greater of the base amount and multiplier x free balance, to 2 decimals. */
export function autoApprovalLimit(
  freeBalance: number,
  settings: Pick<CoinLoanSettings, "baseCredits" | "multiplier">,
): number {
  const scaled = Math.round(Math.max(0, freeBalance) * settings.multiplier * 100) / 100;
  return Math.max(settings.baseCredits, scaled);
}

/** First month interest deducted on release (0 when the toggle is off). */
export function upfrontInterest(amount: number, settings: CoinLoanSettings): number {
  if (!settings.firstMonthUpfront) return 0;
  return Math.round(amount * settings.monthlyInterestPercent) / 100;
}

/** Coins that actually land in the wallet for a given request. */
export function releasedCoins(amount: number, settings: CoinLoanSettings): number {
  return Math.round((amount - upfrontInterest(amount, settings)) * 100) / 100;
}

export function needsManualApproval(amount: number, autoLimit: number): boolean {
  return amount > autoLimit;
}

/**
 * Does this request go straight through? Only members holding a shop position
 * can ever be released automatically — customers always wait for a decision.
 * The database enforces the same rule; this is only for wording.
 */
export function requestGoesToApproval(
  amount: number,
  summary: Pick<CoinLoanSummary, "canAuto" | "autoLimit">,
): boolean {
  if (!summary.canAuto) return true;
  return needsManualApproval(amount, summary.autoLimit);
}

/** Client-side pre-check; the database repeats every one of these. */
export function validateLoanRequest(
  amount: number,
  summary: Pick<CoinLoanSummary, "loansEnabled" | "status">,
): string | null {
  if (!summary.loansEnabled) return "Coin loans are not available right now.";
  if (summary.status === "pending") return "Your previous request is still waiting for a decision.";
  if (summary.status === "active") return "Repay your current loan before requesting another one.";
  if (!Number.isFinite(amount) || amount <= 0) return "Enter an amount greater than zero.";
  return null;
}

export function loanStatusLabel(status: string | null): string {
  switch (status) {
    case "pending":
      return "Waiting for approval";
    case "active":
      return "Active";
    case "settled":
      return "Fully repaid";
    case "rejected":
      return "Declined";
    case "cancelled":
      return "Cancelled";
    default:
      return "No loan";
  }
}

export function loanEntryLabel(kind: string): string {
  switch (kind) {
    case "release":
      return "Coins released";
    case "upfront_interest":
      return "First month interest";
    case "interest":
      return "Monthly interest";
    case "repayment":
      return "Repayment";
    case "writeoff":
      return "Written off";
    default:
      return kind;
  }
}

/* ------------------------------------------------------------------ */
/* Data access                                                         */
/* ------------------------------------------------------------------ */

export async function fetchCoinLoanSettings(): Promise<CoinLoanSettings> {
  const { data, error } = await supabase.rpc("coin_loan_settings");
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
  return {
    enabled: Boolean(row?.["enabled"]),
    baseCredits: num(row?.["base_credits"]),
    multiplier: num(row?.["multiplier"]),
    monthlyInterestPercent: num(row?.["monthly_interest_percent"]),
    firstMonthUpfront: Boolean(row?.["first_month_upfront"]),
  };
}

export async function saveCoinLoanSettings(s: CoinLoanSettings): Promise<void> {
  requireOnline();
  const { error } = await supabase.rpc("set_coin_loan_settings", {
    _enabled: s.enabled,
    _base: s.baseCredits,
    _multiplier: s.multiplier,
    _monthly_interest: s.monthlyInterestPercent,
    _first_month_upfront: s.firstMonthUpfront,
  });
  if (error) throw error;
}

export async function fetchMyCoinLoan(): Promise<CoinLoanSummary | null> {
  const { data, error } = await supabase.rpc("my_coin_loan_summary");
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    loanId: (row["loan_id"] as string | null) ?? null,
    status: (row["status"] as string | null) ?? null,
    approvalMode: (row["approval_mode"] as string | null) ?? null,
    principal: num(row["principal"]),
    releasedAmount: num(row["released_amount"]),
    outstanding: num(row["outstanding"]),
    totalOwed: num(row["total_owed"]),
    accruedInterest: num(row["accrued_interest"]),
    interestPercent: num(row["interest_percent"]),
    firstMonthInterest: num(row["first_month_interest"]),
    autoLimit: num(row["auto_limit"]),
    freeBalance: num(row["free_balance"]),
    restrictedBalance: num(row["restricted_balance"]),
    balance: num(row["balance"]),
    hasPosition: Boolean(row["has_position"]),
    canAuto: Boolean(row["can_auto"]),
    universeSpend: Boolean(row["universe_spend"]),
    borrowerRole: (row["borrower_role"] as string | null) ?? null,
    loansEnabled: Boolean(row["loans_enabled"]),
    requestedAt: (row["requested_at"] as string | null) ?? null,
    releasedAt: (row["released_at"] as string | null) ?? null,
  };
}

/** Every loan this member has ever had — the Loan Center's loan list. */
export async function fetchMyLoans(): Promise<MyCoinLoan[]> {
  const { data, error } = await supabase.rpc("my_coin_loans");
  if (error) throw error;
  return (data ?? []) as unknown as MyCoinLoan[];
}

export async function fetchMyLoanHistory(): Promise<CoinLoanEntry[]> {
  const { data, error } = await supabase.rpc("my_coin_loan_history");
  if (error) throw error;
  return (data ?? []) as unknown as CoinLoanEntry[];
}

export async function requestCoinLoan(amount: number) {
  requireOnline();
  const { data, error } = await supabase.rpc("request_coin_loan", { _amount: amount });
  if (error) throw error;
  return data;
}

export async function repayCoinLoan(amount: number): Promise<number> {
  requireOnline();
  const { data, error } = await supabase.rpc("repay_coin_loan", { _amount: amount });
  if (error) throw error;
  return num(data);
}

export async function cancelCoinLoan(loanId: string) {
  requireOnline();
  const { error } = await supabase.rpc("cancel_coin_loan", { _loan_id: loanId });
  if (error) throw error;
}

export async function fetchAdminCoinLoans(status?: string): Promise<AdminCoinLoan[]> {
  const { data, error } = await supabase.rpc(
    "admin_coin_loans",
    status ? { _status: status } : {},
  );
  if (error) throw error;
  return (data ?? []) as unknown as AdminCoinLoan[];
}

export async function reviewCoinLoan(loanId: string, approve: boolean, note?: string) {
  requireOnline();
  const { error } = await supabase.rpc("review_coin_loan", {
    _loan_id: loanId,
    _approve: approve,
    ...(note ? { _note: note } : {}),
  });
  if (error) throw error;
}
