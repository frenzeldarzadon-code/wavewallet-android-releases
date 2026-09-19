/**
 * Platform owner loan monitoring — READ ONLY.
 *
 * Every number here comes from the existing loan records (`coin_loans` and
 * `coin_loan_entries`) through Super-Admin-only database functions. Nothing in
 * this module writes, recalculates or re-posts anything: the loan maths,
 * interest rules and repayment rules stay exactly where they already live.
 * The database refuses all four calls for anyone who is not a Super Admin, so
 * hiding the page in the menu is presentation only, never the protection.
 */
import { supabase } from "@/integrations/supabase/client";

const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0) || 0);
const str = (v: unknown) => (typeof v === "string" ? v : null);

export interface LoanStats {
  totalOutstanding: number;
  totalPrincipal: number;
  totalReleased: number;
  totalRepaid: number;
  totalInterest: number;
  activeCount: number;
  settledCount: number;
  pendingCount: number;
  borrowerCount: number;
}

export interface SuperLoan {
  id: string;
  userId: string;
  fullName: string | null;
  handle: string | null;
  role: string | null;
  principal: number;
  releasedAmount: number;
  firstMonthInterest: number;
  interestPercent: number;
  accruedInterest: number;
  outstanding: number;
  totalOwed: number;
  repaid: number;
  autoLimitSnapshot: number;
  freeBalanceSnapshot: number;
  status: string;
  approvalMode: string;
  origin: string;
  createdBy: string | null;
  createdByName: string | null;
  referenceNote: string | null;
  borrowerRole: string | null;
  universeSpend: boolean;
  decidedAt: string | null;
  decisionNote: string | null;
  releasedAt: string | null;
  settledAt: string | null;
  createdAt: string;
}

export interface SuperLoanEntry {
  id: string;
  loanId: string;
  kind: string;
  amount: number;
  outstandingAfter: number;
  periodIndex: number | null;
  note: string | null;
  createdAt: string;
}

export interface SuperLoanTransaction extends SuperLoanEntry {
  userId: string;
  fullName: string | null;
  handle: string | null;
  role: string | null;
  loanStatus: string;
}

export interface LoanTransactionFilters {
  kind?: string;
  status?: string;
  search?: string;
  from?: string;
  to?: string;
}

/* ------------------------------------------------------------------ */
/* Presentation helpers (pure)                                         */
/* ------------------------------------------------------------------ */

export const LOAN_ENTRY_KINDS = [
  "release",
  "upfront_interest",
  "interest",
  "repayment",
  "writeoff",
] as const;

export function roleLabel(role: string | null): string {
  switch (role) {
    case "super_admin":
      return "Platform owner";
    case "admin":
      return "Shop admin";
    case "reseller":
      return "Reseller";
    case "subreseller":
      return "Sub-reseller";
    case "customer":
      return "Customer";
    default:
      return "Member";
  }
}

export function loanTone(
  status: string,
): "brand" | "success" | "warning" | "danger" | "muted" {
  switch (status) {
    case "active":
      return "warning";
    case "settled":
      return "success";
    case "pending":
      return "brand";
    case "rejected":
      return "danger";
    default:
      return "muted";
  }
}


export function borrowerName(loan: { fullName: string | null; handle: string | null }): string {
  if (loan.fullName) return loan.fullName;
  if (loan.handle) return `@${loan.handle}`;
  return "Member";
}

/**
 * How the displayed "total owed" is composed, straight from the stored loan
 * record — principal borrowed, interest added, repayments already received.
 * It never invents a figure: `outstanding` is the authoritative balance and
 * the difference (if the stored numbers ever disagree) is surfaced, not hidden.
 */
export function owedBreakdown(loan: SuperLoan) {
  const charged = Math.round((loan.principal + loan.accruedInterest) * 100) / 100;
  const derived = Math.round((charged - loan.repaid) * 100) / 100;
  const difference = Math.round((loan.outstanding - derived) * 100) / 100;
  return {
    principal: loan.principal,
    interest: loan.accruedInterest,
    charged,
    repaid: loan.repaid,
    derived,
    outstanding: loan.outstanding,
    reconciles: Math.abs(difference) < 0.005,
    difference,
  };
}

/* ------------------------------------------------------------------ */
/* Data access — all Super-Admin-gated in the database                 */
/* ------------------------------------------------------------------ */

export async function fetchLoanStats(): Promise<LoanStats> {
  const { data, error } = await supabase.rpc("super_coin_loan_stats");
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
  return {
    totalOutstanding: num(row?.["total_outstanding"]),
    totalPrincipal: num(row?.["total_principal"]),
    totalReleased: num(row?.["total_released"]),
    totalRepaid: num(row?.["total_repaid"]),
    totalInterest: num(row?.["total_interest"]),
    activeCount: num(row?.["active_count"]),
    settledCount: num(row?.["settled_count"]),
    pendingCount: num(row?.["pending_count"]),
    borrowerCount: num(row?.["borrower_count"]),
  };
}

function mapLoan(row: Record<string, unknown>): SuperLoan {
  return {
    id: String(row["id"]),
    userId: String(row["user_id"]),
    fullName: str(row["full_name"]),
    handle: str(row["handle"]),
    role: str(row["role"]),
    principal: num(row["principal"]),
    releasedAmount: num(row["released_amount"]),
    firstMonthInterest: num(row["first_month_interest"]),
    interestPercent: num(row["interest_percent"]),
    accruedInterest: num(row["accrued_interest"]),
    outstanding: num(row["outstanding"]),
    totalOwed: num(row["total_owed"]),
    repaid: num(row["repaid"]),
    autoLimitSnapshot: num(row["auto_limit_snapshot"]),
    freeBalanceSnapshot: num(row["free_balance_snapshot"]),
    status: String(row["status"] ?? ""),
    approvalMode: String(row["approval_mode"] ?? ""),
    origin: String(row["origin"] ?? "member_request"),
    createdBy: str(row["created_by"]),
    createdByName: str(row["created_by_name"]),
    referenceNote: str(row["reference_note"]),
    borrowerRole: str(row["borrower_role"]),
    universeSpend: Boolean(row["universe_spend"]),
    decidedAt: str(row["decided_at"]),
    decisionNote: str(row["decision_note"]),
    releasedAt: str(row["released_at"]),
    settledAt: str(row["settled_at"]),
    createdAt: String(row["created_at"] ?? ""),
  };
}

export async function fetchSuperLoans(status?: string, search?: string): Promise<SuperLoan[]> {
  const args: { _status?: string; _search?: string } = {};
  if (status && status !== "all") args._status = status;
  const q = search?.trim();
  if (q) args._search = q;
  const { data, error } = await supabase.rpc("super_coin_loans", args);

  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map(mapLoan);
}

function mapEntry(row: Record<string, unknown>): SuperLoanEntry {
  return {
    id: String(row["id"]),
    loanId: String(row["loan_id"]),
    kind: String(row["kind"] ?? ""),
    amount: num(row["amount"]),
    outstandingAfter: num(row["outstanding_after"]),
    periodIndex: row["period_index"] == null ? null : num(row["period_index"]),
    note: str(row["note"]),
    createdAt: String(row["created_at"] ?? ""),
  };
}

export async function fetchLoanEntries(loanId: string): Promise<SuperLoanEntry[]> {
  const { data, error } = await supabase.rpc("super_coin_loan_entries", { _loan_id: loanId });
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map(mapEntry);
}

export async function fetchLoanTransactions(
  filters: LoanTransactionFilters = {},
): Promise<SuperLoanTransaction[]> {
  const args: {
    _kind?: string;
    _status?: string;
    _search?: string;
    _from?: string;
    _to?: string;
    _limit?: number;
  } = { _limit: 500 };
  if (filters.kind && filters.kind !== "all") args._kind = filters.kind;
  if (filters.status && filters.status !== "all") args._status = filters.status;
  const q = filters.search?.trim();
  if (q) args._search = q;
  if (filters.from) args._from = new Date(filters.from).toISOString();
  if (filters.to) args._to = new Date(`${filters.to}T23:59:59`).toISOString();
  const { data, error } = await supabase.rpc("super_coin_loan_transactions", args);

  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    ...mapEntry(row),
    userId: String(row["user_id"]),
    fullName: str(row["full_name"]),
    handle: str(row["handle"]),
    role: str(row["role"]),
    loanStatus: String(row["loan_status"] ?? ""),
  }));
}

/**
 * The ONE write on this page: the platform owner books a real loan for a
 * member. The database creates the authoritative loan record, releases the
 * coins through the normal ledger and stores who created it. `clientToken`
 * makes a double submit return the same loan instead of creating a second one.
 */
export async function createManualLoan(input: {
  userId: string;
  amount: number;
  note?: string;
  clientToken: string;
}): Promise<void> {
  const note = input.note?.trim();
  const { error } = await supabase.rpc("superadmin_create_manual_loan", {
    _user_id: input.userId,
    _amount: input.amount,
    _client_token: input.clientToken,
    ...(note ? { _note: note } : {}),
  });
  if (error) throw error;
}

/** Plain wording for where a loan came from. */
export function originLabel(origin: string): string {
  return origin === "super_admin_manual" ? "Added by platform owner" : "Member request";
}

/** Newest/oldest/amount ordering for the transactions table (client-side). */
export type LoanSort = "newest" | "oldest" | "amount-high" | "amount-low";

export function sortTransactions<T extends { createdAt: string; amount: number }>(
  rows: T[],
  sort: LoanSort,
): T[] {
  const copy = [...rows];
  switch (sort) {
    case "oldest":
      return copy.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    case "amount-high":
      return copy.sort((a, b) => b.amount - a.amount);
    case "amount-low":
      return copy.sort((a, b) => a.amount - b.amount);
    default:
      return copy.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
