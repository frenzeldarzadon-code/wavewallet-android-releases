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
import { requireOnline } from "@/lib/offline-guard";
import { normalizePhMobile } from "@/lib/cash-in-auto";
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
  if (!Number.isFinite(credits) || credits <= 0) return "Coins per unit must be greater than zero.";
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
  return `${s.creditsPerUnit.toLocaleString()} coins = ₱${s.phpPerUnit.toLocaleString()}`;
}

export function validateWithdrawal(
  input: { credits: number; mode: PaymentMode; accountName?: string; accountNumber?: string },
  balance: number,
): string | null {
  const { credits, mode } = input;
  if (!Number.isFinite(credits) || credits <= 0) return "Enter how many coins to cash out.";
  if (!Number.isInteger(credits)) return "Coins must be a whole number.";
  if (credits > WITHDRAWAL_MAX_CREDITS) return "A single withdrawal is limited to 10,000,000 coins.";
  if (credits > balance) return "You do not have that many coins available.";
  const spec = PAYMENT_MODES.find((m) => m.value === mode);
  if (!spec) return "Choose a payment mode.";
  if (spec.needsAccount && (!input.accountName?.trim() || !input.accountNumber?.trim())) {
    return "Account name and account number are required for e-wallet and bank payouts.";
  }
  return null;
}

/**
 * Cash in requires the amount, the payment screenshot and SOME identifier of
 * the account the money was paid from. That identifier is provider-agnostic: a
 * mobile wallet prints a mobile number, a bank prints a masked account number
 * or the payer's name. Notes stay optional. The same rules are enforced again
 * inside `request_cash_in`, and the server alone decides approval.
 */
export function validateCashIn(
  php: number,
  methodId: string | null,
  input?: {
    payerNumber?: string | null;
    payerReference?: string | null;
    hasProof?: boolean;
    /** Any other payer identity read off the receipt (name, masked account). */
    payerAccount?: string | null;
  },
): string | null {
  if (!methodId) return "Choose a payment method.";
  if (!Number.isFinite(php) || php <= 0) return "Enter how much you are paying.";
  if (php > 10_000_000) return "A single cash in is limited to ₱10,000,000.";
  if (input) {
    // The screenshot supplies the amount, reference and payment time. Many
    // "money sent" receipts never print the payer's OWN number, so the sending
    // identity is stated here — it is what gets matched against a real payment
    // notification.
    if (!input.hasProof) return "Attach your payment screenshot.";
    const number = normalizePhMobile(input.payerNumber ?? null);
    const account = (input.payerAccount ?? "").trim();
    const typed = (input.payerNumber ?? "").trim();
    if (!number && !account && typed.length < 4) {
      return "Enter the mobile number or account you paid from.";
    }
  }

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


/**
 * Receiving accounts a payer may use.
 *
 * `scope` narrows the list to one shop's own accounts plus the platform-wide
 * ones; row level security still decides what is actually readable, so a shop
 * can never see another shop's accounts.
 */
export async function fetchPaymentMethods(
  activeOnly = true,
  scope?: { ecosystemId?: string | null; includeGlobal?: boolean },
): Promise<PaymentMethod[]> {
  let q = supabase.from("payment_methods").select("*").order("sort_order").order("name");
  if (activeOnly) q = q.eq("active", true);
  if (scope?.ecosystemId) {
    q =
      scope.includeGlobal === false
        ? q.eq("ecosystem_id", scope.ecosystemId)
        : q.or(`ecosystem_id.is.null,ecosystem_id.eq.${scope.ecosystemId}`);
  } else if (scope && scope.ecosystemId === null && scope.includeGlobal !== false) {
    q = q.is("ecosystem_id", null);
  }
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
  /** Provider / bank this account belongs to (`payment_provider_registry`). */
  provider_id?: string | null;
  /** Owning shop. Null = platform-wide account (platform owner only). */
  ecosystem_id?: string | null;
  label?: string | null;
  qr_path?: string | null;
  qr_content?: string | null;
  metadata?: Record<string, unknown> | null;
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
    _provider_id: input.provider_id ?? undefined,
    _ecosystem_id: input.ecosystem_id ?? undefined,
    _label: input.label ?? undefined,
    _qr_path: input.qr_path ?? undefined,
    _qr_content: input.qr_content ?? undefined,
    _metadata: input.metadata ?? undefined,
  }));
  if (error) throw new Error(error.message);
  return data as unknown as PaymentMethod;
}

export async function deletePaymentMethod(id: string): Promise<void> {
  const { error } = await supabase.rpc("delete_payment_method", rpcArgs({ _id: id }));
  if (error) throw new Error(error.message);
}

/**
 * Where the cash comes from.
 * `admin`      — the shop admin hands over the cash; a straight 1:1 credit
 *                transfer inside the shop with no fee.
 * `superadmin` — the platform pays out; the configurable fee applies and the
 *                credits leave the shop for good.
 */
export type CashOutPath = "admin" | "superadmin";

export const CASH_OUT_PATHS: { value: CashOutPath; label: string; hint: string }[] = [
  { value: "admin", label: "My shop admin", hint: "Settled by your shop admin. No fee." },
  { value: "superadmin", label: "Platform cash out", hint: "Paid out by the platform. A cash out fee applies." },
];

export const cashOutPathLabel = (p?: string | null) =>
  CASH_OUT_PATHS.find((x) => x.value === p)?.label ?? "Platform cash out";

/** Fee only ever applies to the platform cash out path. */
export const cashOutFeePercent = (path: CashOutPath, s: MoneySettings) =>
  path === "admin" ? 0 : s.feePercent;

export async function requestWithdrawal(input: {
  credits: number;
  mode: PaymentMode;
  accountName?: string | null;
  accountNumber?: string | null;
  notes?: string | null;
  requestKey: string;
  path?: CashOutPath;
}): Promise<WithdrawalRequest> {
  requireOnline();
  const { data, error } = await supabase.rpc("request_withdrawal", rpcArgs({
    _credits: input.credits,
    _payment_mode: input.mode,
    _account_name: input.accountName ?? undefined,
    _account_number: input.accountNumber ?? undefined,
    _notes: input.notes ?? undefined,
    _request_key: input.requestKey,
    _cashout_path: input.path ?? "superadmin",
  }) as never);
  if (error) throw new Error(error.message);
  return data as unknown as WithdrawalRequest;
}

/** The shop admin settles (or denies) a cash out paid from their own pocket. */
export async function reviewAdminCashout(
  id: string,
  action: "approve" | "reject",
  reason?: string | null,
): Promise<void> {
  requireOnline();
  const { error } = await supabase.rpc("review_admin_cashout", rpcArgs({
    _id: id,
    _action: action,
    _reason: reason ?? undefined,
  }) as never);
  if (error) throw new Error(error.message);
}

export async function cancelWithdrawal(id: string): Promise<void> {
  requireOnline();
  const { error } = await supabase.rpc("cancel_withdrawal", rpcArgs({ _id: id }));
  if (error) throw new Error(error.message);
}

export async function reviewWithdrawal(
  id: string,
  action: "approve" | "reject" | "release",
  reason?: string | null,
): Promise<void> {
  requireOnline();
  const { error } = await supabase.rpc("review_withdrawal", rpcArgs({
    _id: id,
    _action: action,
    _reason: reason ?? undefined,
  }));
  if (error) throw new Error(error.message);
}

/* ---------------------------------------------------------------------------
 * Cash in payment screenshots (optional supporting proof)
 * Objects live at `{auth user id}/{uuid}.{ext}` in a PRIVATE bucket. Storage RLS
 * lets a member read only their own folder; the platform owner reads all of
 * them so cash in requests can be reviewed. Nothing is ever public.
 * ------------------------------------------------------------------------- */
export const CASH_IN_PROOF_BUCKET = "cash-in-proofs";
export const MAX_CASH_IN_PROOF_BYTES = 5 * 1024 * 1024; // 5 MB
export const CASH_IN_PROOF_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

export function validateCashInProof(file: { type: string; size: number }): string | null {
  if (!CASH_IN_PROOF_TYPES.includes((file.type || "").toLowerCase())) {
    return "Use a JPG, PNG or WEBP screenshot.";
  }
  if (file.size > MAX_CASH_IN_PROOF_BYTES) return "That image is larger than 5 MB. Pick a smaller screenshot.";
  return null;
}

export async function uploadCashInProof(userId: string, file: File): Promise<string> {
  const problem = validateCashInProof(file);
  if (problem) throw new Error(problem);
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `${userId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from(CASH_IN_PROOF_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error(error.message);
  return path;
}

export async function removeCashInProof(path: string): Promise<void> {
  await supabase.storage.from(CASH_IN_PROOF_BUCKET).remove([path]);
}

const proofUrlCache = new Map<string, { url: string; expires: number }>();

/** Short-lived signed URL — screenshots are never served from a public URL. */
export async function cashInProofUrl(path?: string | null): Promise<string | null> {
  if (!path) return null;
  const hit = proofUrlCache.get(path);
  if (hit && hit.expires > Date.now()) return hit.url;
  const { data, error } = await supabase.storage.from(CASH_IN_PROOF_BUCKET).createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) return null;
  proofUrlCache.set(path, { url: data.signedUrl, expires: Date.now() + 55 * 60 * 1000 });
  return data.signedUrl;
}

/**
 * Who funds the credits.
 * `platform` — paid into the platform GCash; the platform issues the credits.
 * `admin`    — paid into the shop admin's own GCash; the admin's own credits
 *              move to the member 1:1. Nothing is minted.
 */
export type CashInFunding = "platform" | "admin";

export const CASH_IN_FUNDINGS: { value: CashInFunding; label: string; hint: string }[] = [
  { value: "admin", label: "My shop admin's GCash", hint: "Limited by the coins your shop admin has available." },
  { value: "platform", label: "Platform GCash", hint: "No shop limit." },
];

export const cashInFundingLabel = (f?: string | null) =>
  CASH_IN_FUNDINGS.find((x) => x.value === f)?.label ?? "Platform GCash";

/** Spendable funding capacity of the shop admin, in credits. */
export interface AdminCashInCapacity {
  adminId: string | null;
  adminName: string | null;
  balance: number;
  reserved: number;
  available: number;
}

export const EMPTY_CAPACITY: AdminCashInCapacity = {
  adminId: null, adminName: null, balance: 0, reserved: 0, available: 0,
};

/**
 * The most a member may cash in through the shop admin right now, in pesos.
 * Credits arrive after the cash in fee, so the peso ceiling is grossed back up.
 */
export function maxAdminCashInPhp(capacity: AdminCashInCapacity, s: MoneySettings): number {
  const available = Math.max(0, Number(capacity.available) || 0);
  if (available <= 0) return 0;
  const php = available * (s.phpPerUnit / s.creditsPerUnit);
  const feePercent = Math.min(Math.max(Number(s.cashInFeePercent) || 0, 0), 99);
  const gross = php / (1 - feePercent / 100);
  return Math.floor(round2(gross) * 100) / 100;
}

export async function fetchAdminCashInCapacity(ecosystemId?: string | null): Promise<AdminCashInCapacity> {
  if (!ecosystemId) return EMPTY_CAPACITY;
  const { data, error } = await supabase.rpc("admin_cash_in_capacity", rpcArgs({ _ecosystem: ecosystemId }) as never);
  if (error) throw new Error(error.message);
  const row = (Array.isArray(data) ? data[0] : data) as
    | { admin_id: string | null; admin_name: string | null; balance: number; reserved: number; available: number }
    | undefined;
  if (!row) return EMPTY_CAPACITY;
  return {
    adminId: row.admin_id ?? null,
    adminName: row.admin_name ?? null,
    balance: Number(row.balance) || 0,
    reserved: Number(row.reserved) || 0,
    available: Number(row.available) || 0,
  };
}

export async function requestCashIn(input: {
  methodId: string;
  amountPhp: number;
  /** Account the member paid FROM — read off the receipt, matched against a real notification. */
  payerNumber?: string | null;
  /** Payment reference — the member may correct what the receipt reader read. */
  payerReference?: string | null;
  /** Payment date/time the member confirmed, ISO 8601. */
  paidAt?: string | null;
  /** The ORIGINAL screenshot reading, kept as evidence and never overwritten. */
  ocr?: {
    reference?: string | null;
    /** App or bank printed on the receipt — resolves the payment provider. */
    providerName?: string | null;
    amountPhp?: number | null;
    senderNumber?: string | null;
    senderName?: string | null;
    senderAccountMasked?: string | null;
    /** Destination read off the receipt — evidence only, never required to agree. */
    receivingNumber?: string | null;
    receivingAccountMasked?: string | null;
    paidAt?: string | null;
    confidence?: number | null;
    readable?: boolean | null;
  } | null;

  /** Optional — cash in never requires notes. */
  notes?: string | null;
  /** Storage path of the payment screenshot (required supporting evidence). */
  proofPath: string;
  requestKey: string;
  funding?: CashInFunding;
}): Promise<CashInRequest> {
  requireOnline();
  const { data, error } = await supabase.rpc("request_cash_in", rpcArgs({
    _method_id: input.methodId,
    _amount_php: input.amountPhp,
    _payer_reference: input.payerReference ?? undefined,
    _payer_number: input.payerNumber ?? undefined,
    _paid_at: input.paidAt ?? undefined,
    _ocr: input.ocr
      ? {
          reference: input.ocr.reference ?? null,
          provider_name: input.ocr.providerName ?? null,
          amount_php: input.ocr.amountPhp ?? null,
          sender_number: input.ocr.senderNumber ?? null,
          sender_name: input.ocr.senderName ?? null,
          sender_account_masked: input.ocr.senderAccountMasked ?? null,
          paid_at: input.ocr.paidAt ?? null,
          confidence: input.ocr.confidence ?? null,
          readable: input.ocr.readable ?? null,
        }
      : undefined,
    _notes: input.notes ?? undefined,
    _proof_path: input.proofPath,
    _request_key: input.requestKey,
    _funding_source: input.funding ?? "platform",
  }) as never);
  if (error) throw new Error(error.message);
  return data as unknown as CashInRequest;
}

/** The shop admin confirms (or denies) a cash in paid into their own GCash. */
export async function reviewAdminCashIn(
  id: string,
  action: "approve" | "reject",
  reason?: string | null,
): Promise<void> {
  requireOnline();
  const { error } = await supabase.rpc("review_admin_cash_in", rpcArgs({
    _id: id,
    _action: action,
    _reason: reason ?? undefined,
  }) as never);
  if (error) throw new Error(cashInDecisionError(error.message));
}

/** What the member is told after submitting — never "GCash verified this". */
export function cashInOutcomeMessage(
  row: Pick<CashInRequest, "status" | "approval_method" | "decision_reason"> & {
    duplicate_reference?: boolean | null;
    receipt_check?: string | null;
  },
): {
  tone: "success" | "error" | "info";
  message: string;
} {
  if (row.status === "approved") {
    return {
      tone: "success",
      message:
        row.approval_method === "automatic"
          ? "Automatically approved — your submitted details matched the shop's cash in rules and your coins have been added."
          : "Approved — your coins have been added.",
    };
  }
  if (row.status === "rejected") {
    const duplicate = (row.decision_reason ?? "").toLowerCase().includes("duplicate");
    return {
      tone: "error",
      message: duplicate
        ? "Rejected as a duplicate reference — that GCash reference number was already used, so no coins were added."
        : row.decision_reason ?? "Rejected — the submitted details did not match. No coins were added.",
    };
  }
  if (row.duplicate_reference) {
    return {
      tone: "error",
      message:
        "That GCash reference was already submitted. Held for manual investigation — no coins were added and the earlier transaction was left untouched.",
    };
  }
  if (row.receipt_check === "mismatch") {
    return {
      tone: "error",
      message: "Reference does not match receipt — held for manual review. No coins were added.",
    };
  }
  if (row.receipt_check === "unreadable" || row.receipt_check === "error") {
    return {
      tone: "info",
      message:
        "We could not read the reference from your screenshot, so this is held for manual review rather than guessed.",
    };
  }
  return {
    tone: "info",
    message:
      "Pending manual review — your details did not meet the automatic rules, so the platform owner will check your screenshot.",
  };
}



export async function cancelCashIn(id: string): Promise<void> {
  requireOnline();
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
    return "Blocked: the coins would not have gone to the member who submitted this request. Nothing was issued.";
  }
  if (m.includes("does not hold a member credit balance")) {
    return "The platform owner has no member coin balance, so this request cannot be approved. Coins always go to the requesting member.";
  }
  if (m.includes("no member attached")) {
    return "This request has no member attached, so no coins were issued.";
  }
  if (m.includes("already approved") || m.includes("was already")) {
    return "This request was already decided — refresh the queue to see its current status.";
  }
  if (m.includes("ecosystem_id") || m.includes("credit balance") || m.includes("credit account")) {
    return "This member's coin balance could not be opened because their shop link is missing. Fix the member's shop, then approve again.";
  }
  if (m.includes("member") && m.includes("not")) {
    return "This member account no longer exists, so coins cannot be released.";
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
  requireOnline();
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

/* ---------------------------------------------------------------------------
 * Shop admin queues — only the admin's own shop, and only the requests the
 * admin is responsible for settling out of their own pocket/wallet.
 * ------------------------------------------------------------------------- */

export async function fetchShopCashouts(ecosystemId?: string | null): Promise<WithdrawalRequest[]> {
  if (!ecosystemId) return [];
  const { data, error } = await supabase
    .from("withdrawal_requests")
    .select("*")
    .eq("ecosystem_id", ecosystemId)
    .eq("cashout_path", "admin")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function fetchShopCashIns(ecosystemId?: string | null): Promise<CashInRequest[]> {
  if (!ecosystemId) return [];
  const { data, error } = await supabase
    .from("cash_in_requests")
    .select("*")
    .eq("ecosystem_id", ecosystemId)
    .eq("funding_source", "admin")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return data ?? [];
}



export const pendingMoneyCount = (rows: { status: string }[]) =>
  rows.filter((r) => r.status === "pending").length;

export function filterByStatus<T extends { status: string }>(rows: T[], status: string): T[] {
  return status === "all" ? rows : rows.filter((r) => r.status === status);
}
