import { supabase } from "@/integrations/supabase/client";
import { requireOnline } from "@/lib/offline-guard";

const num = (value: unknown) => (typeof value === "number" ? value : Number(value ?? 0) || 0);
const text = (value: unknown) => (typeof value === "string" ? value : null);

export interface UniverseLoanSettings {
  enabled: boolean;
  interestPercent: number;
  ownerSharePercent: number;
  contributorSharePercent: number;
  platformFeePercent: number;
  terms: number[];
}

export interface LoanPoolSummary {
  contributed: number;
  available: number;
  allocated: number;
  interestEarned: number;
  poolTotal: number;
  poolAvailable: number;
  poolAllocated: number;
  walletBalance: number;
}

export interface LoanPoolEntry {
  id: string;
  loanId: string | null;
  kind: string;
  amount: number;
  availableAfter: number;
  allocatedAfter: number;
  note: string | null;
  createdAt: string;
}

export interface OpenUniverseLoan {
  id: string;
  borrowerName: string;
  borrowerHandle: string | null;
  amount: number;
  fundedAmount: number;
  remaining: number;
  termMonths: number;
  interestPercent: number;
  status: string;
  myFunded: number;
  createdAt: string;
}

export interface FundedUniverseLoan {
  loanId: string;
  borrowerName: string;
  borrowerHandle: string | null;
  loanAmount: number;
  termMonths: number;
  status: string;
  myFunded: number;
  myReleasedPrincipal: number;
  myPrincipalRepaid: number;
  myInterestEarned: number;
  principalOutstanding: number;
  interestPaid: number;
  releasedAt: string | null;
  createdAt: string;
}

export interface UniverseLoan {
  id: string;
  amount: number;
  termMonths: number;
  status: string;
  interestPercent: number;
  platformFeePercent: number;
  platformFee: number;
  ownerSharePercent: number;
  contributorSharePercent: number;
  fundedAmount: number;
  releasedAmount: number;
  principalOutstanding: number;
  principalPaid: number;
  interestAccrued: number;
  interestPaid: number;
  interestRefunded: number;
  monthlyPayment: number;
  idDocumentPath: string | null;
  releasedAt: string | null;
  settledAt: string | null;
  createdAt: string;
}

export interface UniverseLoanScheduleRow {
  periodIndex: number;
  dueDate: string;
  principalDue: number;
  interestDue: number;
  totalDue: number;
}

export interface UniverseLoanPaymentRow {
  id: string;
  kind: string;
  amount: number;
  principalPart: number;
  interestPart: number;
  principalAfter: number;
  note: string | null;
  createdAt: string;
}

export interface SuperUniverseLoan extends UniverseLoan {
  borrowerId: string;
  borrowerName: string;
  borrowerHandle: string | null;
  ownerInterest: number;
  funderCount: number;
}

export interface UniverseLoanFunder {
  funderId: string;
  funderName: string;
  funderHandle: string | null;
  amount: number;
  releasedPrincipal: number;
  principalRepaid: number;
  interestEarned: number;
}

export interface LoanPoolOverview {
  poolTotal: number;
  poolAvailable: number;
  poolAllocated: number;
  contributors: number;
  outstandingPrincipal: number;
  ownerInterestCollected: number;
  platformFeesCollected: number;
}

export interface AmortizationRow {
  period: number;
  principal: number;
  interest: number;
  payment: number;
  balance: number;
}

export function monthlyPayment(principal: number, monthlyPercent: number, months: number): number {
  if (principal <= 0 || months <= 0) return 0;
  const rate = monthlyPercent / 100;
  if (rate <= 0) return Math.round((principal / months) * 100) / 100;
  const factor = Math.pow(1 + rate, months);
  return Math.round(((principal * rate * factor) / (factor - 1)) * 100) / 100;
}

export function amortizationSchedule(
  principal: number,
  monthlyPercent: number,
  months: number,
): AmortizationRow[] {
  const payment = monthlyPayment(principal, monthlyPercent, months);
  const rate = monthlyPercent / 100;
  let balance = Math.max(0, principal);
  return Array.from({ length: Math.max(0, months) }, (_, index) => {
    const interest = Math.round(balance * rate * 100) / 100;
    const principalPart =
      index === months - 1
        ? Math.round(balance * 100) / 100
        : Math.min(balance, Math.round((payment - interest) * 100) / 100);
    balance = Math.max(0, Math.round((balance - principalPart) * 100) / 100);
    return {
      period: index + 1,
      principal: principalPart,
      interest,
      payment: Math.round((principalPart + interest) * 100) / 100,
      balance,
    };
  });
}

export function totalScheduledInterest(rows: AmortizationRow[]): number {
  return Math.round(rows.reduce((sum, row) => sum + row.interest, 0) * 100) / 100;
}

export function universeLoanStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending_funding: "Pending funding",
    partially_funded: "Partially funded",
    fully_funded: "Fully funded",
    active: "Active",
    paid: "Paid",
    early_paid: "Paid early",
    cancelled: "Cancelled",
    rejected: "Rejected",
  };
  return labels[status] ?? status.replaceAll("_", " ");
}

export function universeLoanTone(status: string): "brand" | "success" | "warning" | "danger" | "muted" {
  if (status === "active" || status === "partially_funded") return "warning";
  if (status === "paid" || status === "early_paid" || status === "fully_funded") return "success";
  if (status === "rejected") return "danger";
  if (status === "pending_funding") return "brand";
  return "muted";
}

function mapSettings(row?: Record<string, unknown>): UniverseLoanSettings {
  return {
    enabled: Boolean(row?.["enabled"]),
    interestPercent: num(row?.["interest_percent"]),
    ownerSharePercent: num(row?.["owner_share_percent"]),
    contributorSharePercent: num(row?.["contributor_share_percent"]),
    platformFeePercent: num(row?.["platform_fee_percent"]),
    terms: Array.isArray(row?.["terms"]) ? (row?.["terms"] as number[]) : [3, 6, 12],
  };
}

export async function fetchUniverseLoanSettings(): Promise<UniverseLoanSettings> {
  const { data, error } = await supabase.rpc("universe_loan_settings");
  if (error) throw error;
  return mapSettings((data?.[0] ?? undefined) as Record<string, unknown> | undefined);
}

export async function saveUniverseLoanSettings(settings: UniverseLoanSettings): Promise<void> {
  requireOnline();
  const { error } = await supabase.rpc("set_universe_loan_settings", {
    _enabled: settings.enabled,
    _interest: settings.interestPercent,
    _owner_share: settings.ownerSharePercent,
    _contributor_share: settings.contributorSharePercent,
    _platform_fee: settings.platformFeePercent,
  });
  if (error) throw error;
}

export async function fetchLoanPoolSummary(): Promise<LoanPoolSummary> {
  const { data, error } = await supabase.rpc("my_loan_pool");
  if (error) throw error;
  const row = data?.[0];
  return {
    contributed: num(row?.contributed), available: num(row?.available), allocated: num(row?.allocated),
    interestEarned: num(row?.interest_earned), poolTotal: num(row?.pool_total),
    poolAvailable: num(row?.pool_available), poolAllocated: num(row?.pool_allocated),
    walletBalance: num(row?.wallet_balance),
  };
}

export async function fetchLoanPoolHistory(): Promise<LoanPoolEntry[]> {
  const { data, error } = await supabase.rpc("my_loan_pool_history");
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id, loanId: row.loan_id, kind: row.kind, amount: num(row.amount),
    availableAfter: num(row.available_after), allocatedAfter: num(row.allocated_after),
    note: row.note, createdAt: row.created_at,
  }));
}

export async function contributeToLoanPool(amount: number): Promise<number> {
  requireOnline();
  const { data, error } = await supabase.rpc("loan_pool_contribute", { _amount: amount });
  if (error) throw error;
  return num(data);
}

export async function withdrawFromLoanPool(amount: number): Promise<number> {
  requireOnline();
  const { data, error } = await supabase.rpc("loan_pool_withdraw", { _amount: amount });
  if (error) throw error;
  return num(data);
}

export async function fetchOpenUniverseLoans(): Promise<OpenUniverseLoan[]> {
  const { data, error } = await supabase.rpc("open_universe_loan_applications");
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id, borrowerName: row.borrower_name, borrowerHandle: text(row.borrower_handle),
    amount: num(row.amount), fundedAmount: num(row.funded_amount), remaining: num(row.remaining),
    termMonths: row.term_months, interestPercent: num(row.interest_percent), status: row.status,
    myFunded: num(row.my_funded), createdAt: row.created_at,
  }));
}

export async function fetchMyFundedUniverseLoans(): Promise<FundedUniverseLoan[]> {
  const { data, error } = await supabase.rpc("my_funded_universe_loans");
  if (error) throw error;
  return (data ?? []).map((row) => ({
    loanId: row.loan_id, borrowerName: row.borrower_name, borrowerHandle: text(row.borrower_handle),
    loanAmount: num(row.loan_amount), termMonths: row.term_months, status: row.status,
    myFunded: num(row.my_funded), myReleasedPrincipal: num(row.my_released_principal),
    myPrincipalRepaid: num(row.my_principal_repaid), myInterestEarned: num(row.my_interest_earned),
    principalOutstanding: num(row.principal_outstanding), interestPaid: num(row.interest_paid),
    releasedAt: text(row.released_at), createdAt: row.created_at,
  }));
}

export async function fundUniverseLoan(loanId: string, amount: number): Promise<number> {
  requireOnline();
  const { data, error } = await supabase.rpc("fund_universe_loan", { _loan_id: loanId, _amount: amount });
  if (error) throw error;
  return num(data);
}

function mapLoan(row: Record<string, unknown>): UniverseLoan {
  return {
    id: String(row["id"]), amount: num(row["amount"]), termMonths: num(row["term_months"]),
    status: String(row["status"] ?? ""), interestPercent: num(row["interest_percent"]),
    platformFeePercent: num(row["platform_fee_percent"]), platformFee: num(row["platform_fee"]),
    ownerSharePercent: num(row["owner_share_percent"]), contributorSharePercent: num(row["contributor_share_percent"]),
    fundedAmount: num(row["funded_amount"]), releasedAmount: num(row["released_amount"]),
    principalOutstanding: num(row["principal_outstanding"]), principalPaid: num(row["principal_paid"]),
    interestAccrued: num(row["interest_accrued"]), interestPaid: num(row["interest_paid"]),
    interestRefunded: num(row["interest_refunded"]), monthlyPayment: num(row["monthly_payment"]),
    idDocumentPath: text(row["id_document_path"]), releasedAt: text(row["released_at"]),
    settledAt: text(row["settled_at"]), createdAt: String(row["created_at"] ?? ""),
  };
}

export async function fetchMyUniverseLoans(): Promise<UniverseLoan[]> {
  const { data, error } = await supabase.rpc("my_universe_loans");
  if (error) throw error;
  return (data ?? []).map((row) => mapLoan(row as unknown as Record<string, unknown>));
}

export async function applyForUniverseLoan(input: { amount: number; termMonths: number; idPath: string; clientToken: string }): Promise<string> {
  requireOnline();
  const { data, error } = await supabase.rpc("apply_universe_loan", {
    _amount: input.amount, _term_months: input.termMonths, _id_path: input.idPath,
    _client_token: input.clientToken,
  });
  if (error) throw error;
  return data;
}

export async function cancelUniverseLoan(loanId: string): Promise<void> {
  requireOnline();
  const { error } = await supabase.rpc("cancel_universe_loan", { _loan_id: loanId });
  if (error) throw error;
}

export async function payUniverseLoan(amount: number): Promise<number> {
  requireOnline();
  const { data, error } = await supabase.rpc("pay_universe_loan", { _amount: amount });
  if (error) throw error;
  return num(data);
}

export async function fetchUniverseLoanSchedule(loanId: string): Promise<UniverseLoanScheduleRow[]> {
  const { data, error } = await supabase.rpc("universe_loan_schedule_rows", { _loan_id: loanId });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    periodIndex: row.period_index, dueDate: row.due_date, principalDue: num(row.principal_due),
    interestDue: num(row.interest_due), totalDue: num(row.total_due),
  }));
}

export async function fetchUniverseLoanPayments(loanId: string): Promise<UniverseLoanPaymentRow[]> {
  const { data, error } = await supabase.rpc("universe_loan_payment_rows", { _loan_id: loanId });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id, kind: row.kind, amount: num(row.amount), principalPart: num(row.principal_part),
    interestPart: num(row.interest_part), principalAfter: num(row.principal_after),
    note: row.note, createdAt: row.created_at,
  }));
}

export async function fetchSuperUniverseLoans(status?: string): Promise<SuperUniverseLoan[]> {
  const { data, error } = await supabase.rpc("super_universe_loans", status && status !== "all" ? { _status: status } : {});
  if (error) throw error;
  return (data ?? []).map((row) => ({
    ...mapLoan(row as unknown as Record<string, unknown>), borrowerId: row.borrower_id,
    borrowerName: row.borrower_name, borrowerHandle: text(row.borrower_handle),
    ownerInterest: num(row.owner_interest), funderCount: row.funder_count,
  }));
}

export async function fetchUniverseLoanFunders(loanId: string): Promise<UniverseLoanFunder[]> {
  const { data, error } = await supabase.rpc("super_universe_loan_funders", { _loan_id: loanId });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    funderId: row.funder_id, funderName: row.funder_name, funderHandle: text(row.funder_handle),
    amount: num(row.amount), releasedPrincipal: num(row.released_principal),
    principalRepaid: num(row.principal_repaid), interestEarned: num(row.interest_earned),
  }));
}

export async function fetchLoanPoolOverview(): Promise<LoanPoolOverview> {
  const { data, error } = await supabase.rpc("super_loan_pool_overview");
  if (error) throw error;
  const row = data?.[0];
  return {
    poolTotal: num(row?.pool_total), poolAvailable: num(row?.pool_available),
    poolAllocated: num(row?.pool_allocated), contributors: num(row?.contributors),
    outstandingPrincipal: num(row?.outstanding_principal),
    ownerInterestCollected: num(row?.owner_interest_collected),
    platformFeesCollected: num(row?.platform_fees_collected),
  };
}