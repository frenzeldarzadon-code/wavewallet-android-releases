/**
 * Real money — cash out (withdrawals) and cash in.
 *
 * Financial rules that matter here:
 *  - The credit ↔ peso valuation and the withdrawal fee are NEVER hard-coded.
 *    They come from the single `platform_settings` row the platform owner
 *    controls, and every request snapshots the values in force at submission
 *    time so later setting changes cannot rewrite a pending request.
 *  - Requesting is open to customer / subreseller / reseller / admin. Only the
 *    platform owner may approve, reject or release money; that is enforced in
 *    the database RPCs, never here.
 *  - Credits are held (debited) the moment a withdrawal is requested and
 *    returned by a matching ledger entry when it is rejected or cancelled.
 *  - Cash in creates NO credits until the platform owner approves the real
 *    payment.
 *
 * The pure helpers below exist so the numbers shown to a member before they
 * submit match, to the centavo, what the database will snapshot.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type WithdrawalRequest = Database["public"]["Tables"]["withdrawal_requests"]["Row"];
export type CashInRequest = Database["public"]["Tables"]["cash_in_requests"]["Row"];
export type PaymentMethod = Database["public"]["Tables"]["payment_methods"]["Row"];

export type PaymentMode = "physical_cash" | "ewallet" | "bank";

export const PAYMENT_MODES: { value: PaymentMode; label: string; needsAccount: boolean }[] = [
  { value: "physical_cash", label: "Physical cash", needsAccount: false },
  { value: "ewallet", label: "E-wallet", needsAccount: true },
  { value: "bank", label: "Bank transfer", needsAccount: true },
];

export const paymentModeLabel = (mode: string) =>
  PAYMENT_MODES.find((m) => m.value === mode)?.label ?? mode;

/** Roles allowed to ask for money. The platform owner is not a member wallet. */
export const MONEY_REQUEST_ROLES = ["customer", "subreseller", "reseller", "admin"] as const;
export const canRequestMoney = (role?: string | null) =>
  MONEY_REQUEST_ROLES.includes((role ?? "") as (typeof MONEY_REQUEST_ROLES)[number]);
/** Only the platform owner may decide. Mirrors the database check. */
export const canDecideMoney = (role?: string | null) => role === "super_admin";

export const WITHDRAWAL_MAX_CREDITS = 10_000_000;
/** Disclosure shown on every cash out form and receipt. */
export const WITHDRAWAL_SLA_NOTICE =
  "Cash outs are verified by the platform owner and may take up to 48 hours. Nothing is sent until it is marked released.";

/** The live valuation + fees. Never assume a rate; always read this. */
export interface MoneySettings {
  creditsPerUnit: number;
  phpPerUnit: number;
  /** Cash OUT (withdrawal) fee percentage. */
  feePercent: number;
  /** Cash IN fee percentage, charged on the peso amount paid. */
  cashInFeePercent: number;
  cashbackReseller: number;
  cashbackSubreseller: number;
  /** Flat credits charged when a member moves credits between their shops. */
  shopTransferFee: number;
}

export const MONEY_SETTINGS_FALLBACK: MoneySettings = {
  creditsPerUnit: 1000,
  phpPerUnit: 1000,
  feePercent: 1,
  cashInFeePercent: 0,
  cashbackReseller: 10,
  cashbackSubreseller: 20,
  shopTransferFee: 5,
};


/** Supabase RPC args are exact-optional: drop undefined keys before sending. */
const rpcArgs = <T,>(o: Record<string, unknown>): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** Shop admin keeps whatever the two downstream rates do not take. */
export function adminCashbackPercent(reseller: number, subreseller: number): number {
  return round2(100 - (Number(reseller) || 0) - (Number(subreseller) || 0));
}

/** Guard the platform owner against an impossible distribution. */
export function validateCashback(reseller: number, subreseller: number): string | null {
  for (const v of [reseller, subreseller]) {
    if (!Number.isInteger(v) || v < 0 || v > 100) return "Use whole percentages between 0 and 100.";
  }
  if (reseller + subreseller > 100) return "Reseller and subreseller cashback cannot exceed 100% together.";
  return null;
}

export function validateValuation(credits: number, php: number, fee: number): string | null {
  if (!Number.isFinite(credits) || credits <= 0) return "Credits per unit must be greater than zero.";
  if (!Number.isFinite(php) || php <= 0) return "Peso value must be greater than zero.";
  if (!Number.isFinite(fee) || fee < 0 || fee >= 100) return "Cash out fee must be between 0% and 99.99%.";
  return null;
}

/** Same rules as the database: zero or more, never a whole confiscation. */
export function validateCashInFee(fee: number): string | null {
  if (!Number.isFinite(fee) || fee < 0) return "Cash in fee cannot be negative.";
  if (fee >= 100) return "Cash in fee must be less than 100%.";
  return null;
}

export interface Quote {
  credits: number;
  gross: number;
  feePercent: number;
  fee: number;
  net: number;
}

/** Credits → peso, using the CURRENT settings. Mirrors `request_withdrawal`. */
export function quoteWithdrawal(credits: number, s: MoneySettings): Quote {
  const gross = round2((Number(credits) || 0) * s.phpPerUnit / s.creditsPerUnit);
  const fee = round2(gross * s.feePercent / 100);
  return { credits: Number(credits) || 0, gross, feePercent: s.feePercent, fee, net: round2(gross - fee) };
}

/** Peso paid → fee → net → credits. Mirrors `request_cash_in` to the centavo. */
export interface CashInQuote {
  gross: number;
  feePercent: number;
  fee: number;
  net: number;
  credits: number;
}

export function quoteCashInBreakdown(php: number, s: MoneySettings): CashInQuote {
  const gross = round2(Number(php) || 0);
  const feePercent = Number(s.cashInFeePercent) || 0;
  const fee = round2(gross * feePercent / 100);
  const net = round2(gross - fee);
  return { gross, feePercent, fee, net, credits: round2(net * s.creditsPerUnit / s.phpPerUnit) };
}

/** Credits a member receives for a cash in. */
export function quoteCashIn(php: number, s: MoneySettings): number {
  return quoteCashInBreakdown(php, s).credits;
}


/** Re-derive a stored request's numbers from its own snapshot, never from live settings. */
export function snapshotQuote(row: Pick<WithdrawalRequest, "credits" | "gross_php" | "fee_percent" | "fee_php" | "net_php">): Quote {
  return {
    credits: Number(row.credits),
    gross: Number(row.gross_php),
    feePercent: Number(row.fee_percent),
    fee: Number(row.fee_php),
    net: Number(row.net_php),
  };
}

/**
 * Credits a member keeps after the withdrawal fee. Presentation helper: the
 * fee percent is the authoritative snapshot, the peso valuation is never shown
 * to members.
 */
export function creditsAfterFee(credits: number, feePercent: number): number {
  const c = Number(credits) || 0;
  const f = Number(feePercent) || 0;
  return round2(c - (c * f) / 100);
}

export function describeRate(s: MoneySettings): string {
  return `${s.creditsPerUnit.toLocaleString()} credits = ₱${s.phpPerUnit.toLocaleString()}`;
}

export function validateWithdrawal(
  input: { credits: number; mode: PaymentMode; accountName?: string; accountNumber?: string },
  balance: number,
): string | null {
  const { credits, mode } = input;
  if (!Number.isFinite(credits) || credits <= 0) return "Enter how many credits to cash out.";
  if (!Number.isInteger(credits)) return "Credits must be a whole number.";
  if (credits > WITHDRAWAL_MAX_CREDITS) return "A single withdrawal is limited to 10,000,000 credits.";
  if (credits > balance) return "You do not have that many credits available.";
  const spec = PAYMENT_MODES.find((m) => m.value === mode);
  if (!spec) return "Choose a payment mode.";
  if (spec.needsAccount && (!input.accountName?.trim() || !input.accountNumber?.trim())) {
    return "Account name and account number are required for e-wallet and bank payouts.";
  }
  return null;
}

export function validateCashIn(php: number, methodId: string | null): string | null {
  if (!methodId) return "Choose a payment method.";
  if (!Number.isFinite(php) || php <= 0) return "Enter how much you are paying.";
  if (php > 10_000_000) return "A single cash in is limited to ₱10,000,000.";
  return null;
}

export type MoneyStatus = string;

export const STATUS_TONE: Record<string, "pending" | "positive" | "negative"> = {
  pending: "pending",
  approved: "pending",
  released: "positive",
  rejected: "negative",
  cancelled: "negative",
};

export const statusLabel = (s: string) =>
  s === "released" ? "Successful withdrawal" : s.charAt(0).toUpperCase() + s.slice(1);

/* ------------------------------------------------------------------ */
/* Data access                                                         */
/* ------------------------------------------------------------------ */

export async function fetchMoneySettings(): Promise<MoneySettings> {
  const { data } = await supabase
    .from("platform_settings")
    .select(
      "cash_out_credits_per_unit, cash_out_php_per_unit, withdrawal_fee_percent, cash_in_fee_percent, cashback_reseller_percent, cashback_subreseller_percent, shop_transfer_fee_credits",
    )
    .eq("id", 1)
    .maybeSingle();
  if (!data) return MONEY_SETTINGS_FALLBACK;
  return {
    creditsPerUnit: Number(data.cash_out_credits_per_unit),
    phpPerUnit: Number(data.cash_out_php_per_unit),
    feePercent: Number(data.withdrawal_fee_percent),
    cashInFeePercent: Number(data.cash_in_fee_percent ?? 0),
    cashbackReseller: Number(data.cashback_reseller_percent),
    cashbackSubreseller: Number(data.cashback_subreseller_percent),
    shopTransferFee: Number(data.shop_transfer_fee_credits ?? 5),
  };
}

export async function saveMoneySettings(s: MoneySettings): Promise<void> {
  const { error } = await supabase.rpc("set_platform_money_settings", rpcArgs({
    _cashback_reseller: Math.round(s.cashbackReseller),
    _cashback_subreseller: Math.round(s.cashbackSubreseller),
    _credits_per_unit: s.creditsPerUnit,
    _php_per_unit: s.phpPerUnit,
    _withdrawal_fee: s.feePercent,
    _shop_transfer_fee: s.shopTransferFee,
    _cash_in_fee: s.cashInFeePercent,
  }));
  if (error) throw new Error(error.message);
}


export async function fetchPaymentMethods(activeOnly = true): Promise<PaymentMethod[]> {
  let q = supabase.from("payment_methods").select("*").order("sort_order").order("name");
  if (activeOnly) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function savePaymentMethod(input: {
  id?: string | null;
  name: string;
  method_type: string;
  instructions?: string | null;
  account_name?: string | null;
  account_number?: string | null;
  notes?: string | null;
  active: boolean;
  sort_order?: number;
}): Promise<PaymentMethod> {
  const { data, error } = await supabase.rpc("upsert_payment_method", rpcArgs({
    _id: input.id ?? undefined,
    _name: input.name,
    _method_type: input.method_type,
    _instructions: input.instructions ?? undefined,
    _account_name: input.account_name ?? undefined,
    _account_number: input.account_number ?? undefined,
    _notes: input.notes ?? undefined,
    _active: input.active,
    _sort_order: input.sort_order ?? 0,
  }));
  if (error) throw new Error(error.message);
  return data as unknown as PaymentMethod;
}

export async function deletePaymentMethod(id: string): Promise<void> {
  const { error } = await supabase.rpc("delete_payment_method", rpcArgs({ _id: id }));
  if (error) throw new Error(error.message);
}

export async function requestWithdrawal(input: {
  credits: number;
  mode: PaymentMode;
  accountName?: string | null;
  accountNumber?: string | null;
  notes?: string | null;
  requestKey: string;
}): Promise<WithdrawalRequest> {
  const { data, error } = await supabase.rpc("request_withdrawal", rpcArgs({
    _credits: input.credits,
    _payment_mode: input.mode,
    _account_name: input.accountName ?? undefined,
    _account_number: input.accountNumber ?? undefined,
    _notes: input.notes ?? undefined,
    _request_key: input.requestKey,
  }));
  if (error) throw new Error(error.message);
  return data as unknown as WithdrawalRequest;
}

export async function cancelWithdrawal(id: string): Promise<void> {
  const { error } = await supabase.rpc("cancel_withdrawal", rpcArgs({ _id: id }));
  if (error) throw new Error(error.message);
}

export async function reviewWithdrawal(
  id: string,
  action: "approve" | "reject" | "release",
  reason?: string | null,
): Promise<void> {
  const { error } = await supabase.rpc("review_withdrawal", rpcArgs({
    _id: id,
    _action: action,
    _reason: reason ?? undefined,
  }));
  if (error) throw new Error(error.message);
}

export async function requestCashIn(input: {
  methodId: string;
  amountPhp: number;
  payerReference?: string | null;
  notes?: string | null;
  requestKey: string;
}): Promise<CashInRequest> {
  const { data, error } = await supabase.rpc("request_cash_in", rpcArgs({
    _method_id: input.methodId,
    _amount_php: input.amountPhp,
    _payer_reference: input.payerReference ?? undefined,
    _notes: input.notes ?? undefined,
    _request_key: input.requestKey,
  }));
  if (error) throw new Error(error.message);
  return data as unknown as CashInRequest;
}

export async function cancelCashIn(id: string): Promise<void> {
  const { error } = await supabase.rpc("cancel_cash_in", rpcArgs({ _id: id }));
  if (error) throw new Error(error.message);
}

/**
 * Turn raw database failures from a cash in decision into wording the platform
 * owner can act on. Cash in credits the member's SAME standard credit balance,
 * so wallet/ecosystem plumbing problems must never surface as SQL text.
 */
export function cashInDecisionError(message: string): string {
  const m = (message || "").toLowerCase();
  if (m.includes("recipient mismatch") || m.includes("refusing to credit")) {
    return "Blocked: the credits would not have gone to the member who submitted this request. Nothing was issued.";
  }
  if (m.includes("does not hold a member credit balance")) {
    return "The platform owner has no member credit balance, so this request cannot be approved. Credits always go to the requesting member.";
  }
  if (m.includes("no member attached")) {
    return "This request has no member attached, so no credits were issued.";
  }
  if (m.includes("already approved") || m.includes("was already")) {
    return "This request was already decided — refresh the queue to see its current status.";
  }
  if (m.includes("ecosystem_id") || m.includes("credit balance") || m.includes("credit account")) {
    return "This member's credit balance could not be opened because their shop link is missing. Fix the member's shop, then approve again.";
  }
  if (m.includes("member") && m.includes("not")) {
    return "This member account no longer exists, so credits cannot be released.";
  }
  if (m.includes("platform owner")) {
    return "Only the platform owner can decide cash in requests.";
  }
  return message;
}


export async function reviewCashIn(
  id: string,
  action: "approve" | "reject",
  reason?: string | null,
): Promise<void> {
  const { error } = await supabase.rpc("review_cash_in", rpcArgs({ _id: id, _action: action, _reason: reason ?? undefined }));
  if (error) throw new Error(cashInDecisionError(error.message));
}


export async function fetchMyWithdrawals(userId: string): Promise<WithdrawalRequest[]> {
  const { data, error } = await supabase
    .from("withdrawal_requests")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function fetchMyCashIns(userId: string): Promise<CashInRequest[]> {
  const { data, error } = await supabase
    .from("cash_in_requests")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function fetchAllWithdrawals(): Promise<WithdrawalRequest[]> {
  const { data, error } = await supabase
    .from("withdrawal_requests")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function fetchAllCashIns(): Promise<CashInRequest[]> {
  const { data, error } = await supabase
    .from("cash_in_requests")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export const pendingMoneyCount = (rows: { status: string }[]) =>
  rows.filter((r) => r.status === "pending").length;

export function filterByStatus<T extends { status: string }>(rows: T[], status: string): T[] {
  return status === "all" ? rows : rows.filter((r) => r.status === status);
}
