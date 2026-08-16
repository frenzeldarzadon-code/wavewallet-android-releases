/**
 * Stage 5 — Earnings & Reports data layer.
 *
 * Every figure in every report is derived from the immutable ledger/sale rows
 * (`voucher_sales`, `credit_ledger`, `points_ledger`). Nothing is recomputed
 * from today's configuration: reseller discounts, commission percentages and
 * points ratios are read from the snapshot columns written at transaction
 * time. RLS decides what each role can see — a reseller only ever receives
 * their own rows, an admin only their ecosystem, a super admin everything.
 */
import { supabase } from "@/integrations/supabase/client";
import { LEDGER_COLUMNS, normalizeEntry, type CreditEntry } from "@/lib/wallet";

/* ------------------------------------------------------------------ */
/* Ranges                                                              */
/* ------------------------------------------------------------------ */

export interface RangeOption {
  id: string;
  label: string;
  days: number;
}

export const RANGE_OPTIONS: RangeOption[] = [
  { id: "today", label: "Today", days: 1 },
  { id: "daily", label: "7 days", days: 7 },
  { id: "monthly", label: "Monthly", days: 30 },
  { id: "quarterly", label: "Quarterly", days: 90 },
  { id: "yearly", label: "Yearly", days: 365 },
  { id: "custom", label: "Custom", days: 0 },
];

export interface ResolvedRange {
  start: Date;
  end: Date;
  label: string;
}

/** Turns a range id (+ optional custom bounds) into concrete timestamps. */
export function resolveRange(id: string, from?: string, to?: string): ResolvedRange {
  const end = new Date();
  if (id === "custom") {
    const start = from ? new Date(`${from}T00:00:00`) : new Date(end.getTime() - 30 * 86400000);
    const stop = to ? new Date(`${to}T23:59:59`) : end;
    return {
      start,
      end: stop,
      label: `${start.toLocaleDateString()} – ${stop.toLocaleDateString()}`,
    };
  }
  if (id === "today") {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return { start, end, label: "Today" };
  }
  const days = RANGE_OPTIONS.find((r) => r.id === id)?.days ?? 30;
  const start = new Date(end.getTime() - days * 86400000);
  return { start, end, label: `Last ${days} days` };
}

const iso = (d: Date) => d.toISOString();

/* ------------------------------------------------------------------ */
/* Sales                                                               */
/* ------------------------------------------------------------------ */

export interface SaleReportRow {
  id: string;
  ecosystem_id: string;
  product_name: string;
  buyer_id: string;
  buyer_role: string;
  reseller_id: string | null;
  list_price: number;
  discount_percent: number;
  sale_price: number;
  payment_method: string;
  tx_id: string;
  created_at: string;
  points_spent: number;
  points_earned: number;
  credits_per_point_used: number | null;
  points_rule_version: number | null;
  refunded_at: string | null;
  refund_reason: string | null;
}

const SALE_COLUMNS =
  "id, ecosystem_id, product_name, buyer_id, buyer_role, reseller_id, list_price, discount_percent, sale_price, payment_method, tx_id, created_at, points_spent, points_earned, credits_per_point_used, points_rule_version, refunded_at, refund_reason";

export interface RefundResult {
  tx_id: string;
  credits_refunded: number;
  points_refunded: number;
  points_reversed: number;
  commission_reversed: number;
  codes_voided: number;
}

/**
 * Refunds a voucher sale. The original sale row is never edited — the server
 * writes reversal entries for credits, credit-back and points, and voids the
 * released codes. Refunding twice is refused by the database.
 */
export async function refundSale(saleId: string, reason: string): Promise<RefundResult> {
  const { data, error } = await supabase.rpc("refund_voucher_sale", {
    _sale_id: saleId,
    _reason: reason,
  });
  if (error) throw new Error(error.message);
  const row = (data as RefundResult[] | null)?.[0];
  if (!row) throw new Error("Refund did not return a result.");
  return {
    ...row,
    credits_refunded: Number(row.credits_refunded),
    commission_reversed: Number(row.commission_reversed),
  };
}

export interface SaleQuery {
  range: ResolvedRange;
  ecosystemId?: string | null;
  buyerId?: string | null;
  limit?: number;
}

export async function fetchSalesReport(q: SaleQuery): Promise<SaleReportRow[]> {
  let query = supabase
    .from("voucher_sales")
    .select(SALE_COLUMNS)
    .gte("created_at", iso(q.range.start))
    .lte("created_at", iso(q.range.end))
    .order("created_at", { ascending: false })
    .limit(q.limit ?? 1000);
  if (q.ecosystemId) query = query.eq("ecosystem_id", q.ecosystemId);
  if (q.buyerId) query = query.eq("buyer_id", q.buyerId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as SaleReportRow[]).map((s) => ({
    ...s,
    list_price: Number(s.list_price),
    sale_price: Number(s.sale_price),
    points_spent: Number(s.points_spent ?? 0),
    points_earned: Number(s.points_earned ?? 0),
    credits_per_point_used:
      s.credits_per_point_used === null || s.credits_per_point_used === undefined
        ? null
        : Number(s.credits_per_point_used),
  }));
}

export interface SalesSummary {
  count: number;
  creditCount: number;
  pointsCount: number;
  gross: number;
  net: number;
  /** Discount value captured at sale time — the reseller's margin. */
  resellerMargin: number;
  pointsSpent: number;
  pointsEarned: number;
}

/** Aggregates sale rows using only the values snapshotted on each sale. */
export function summariseSales(rows: SaleReportRow[]): SalesSummary {
  const credit = rows.filter((r) => r.payment_method !== "points");
  const points = rows.filter((r) => r.payment_method === "points");
  return {
    count: rows.length,
    creditCount: credit.length,
    pointsCount: points.length,
    gross: credit.reduce((s, r) => s + r.list_price, 0),
    net: credit.reduce((s, r) => s + r.sale_price, 0),
    resellerMargin: credit.reduce((s, r) => s + (r.list_price - r.sale_price), 0),
    pointsSpent: rows.reduce((s, r) => s + r.points_spent, 0),
    pointsEarned: rows.reduce((s, r) => s + r.points_earned, 0),
  };
}

/* ------------------------------------------------------------------ */
/* Credits                                                             */
/* ------------------------------------------------------------------ */

export interface CreditQuery {
  range: ResolvedRange;
  ecosystemId?: string | null;
  userId?: string | null;
  limit?: number;
}

export type CreditReportEntry = CreditEntry & { ecosystem_id: string };

export async function fetchCreditsReport(q: CreditQuery): Promise<CreditReportEntry[]> {
  let query = supabase
    .from("credit_ledger")
    .select(`${LEDGER_COLUMNS}, ecosystem_id`)
    .gte("created_at", iso(q.range.start))
    .lte("created_at", iso(q.range.end))
    .order("created_at", { ascending: false })
    .limit(q.limit ?? 1000);
  if (q.ecosystemId) query = query.eq("ecosystem_id", q.ecosystemId);
  if (q.userId) query = query.eq("user_id", q.userId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as CreditReportEntry[]).map(
    (e) => normalizeEntry(e) as CreditReportEntry,
  );
}

export interface CreditSummary {
  issued: number;
  spent: number;
  /** Base credits released on commission-bearing transfers. */
  commissionBase: number;
  /** Bonus credits granted on top, using each transfer's own snapshot rate. */
  commissionBonus: number;
  commissionCount: number;
  transferCount: number;
}

export function summariseCredits(entries: CreditEntry[]): CreditSummary {
  let issued = 0;
  let spent = 0;
  let commissionBase = 0;
  let commissionBonus = 0;
  let commissionCount = 0;
  for (const e of entries) {
    if (e.direction === "credit") issued += e.amount;
    else spent += e.amount;
    const bonus = Number(e.commission_amount ?? 0);
    if (e.direction === "credit" && bonus > 0) {
      commissionBonus += bonus;
      commissionBase += Number(e.base_amount ?? e.amount - bonus);
      commissionCount += 1;
    }
  }
  return {
    issued,
    spent,
    commissionBase,
    commissionBonus,
    commissionCount,
    transferCount: entries.length,
  };
}

/* ------------------------------------------------------------------ */
/* Current-model credit flow                                           */
/* ------------------------------------------------------------------ */

/**
 * Current business model view of the credit ledger.
 *
 * Shop earnings are NEVER derived from credits appearing in a wallet. Credits
 * minted by the platform owner (manual issuance, approved cash-in), wallet
 * transfers and withdrawal holds all move credits without producing any shop
 * earnings, so each gets its own bucket here and none of them feed `generated`.
 */
export interface CreditFlowSummary {
  /** Credits minted inside the shop by an admin correction. Not shop earnings. */
  generated: number;
  generatedCount: number;
  /** Credits removed from wallets by an admin correction. */
  revoked: number;
  /** Credits minted by the platform owner (manual issuance). Never shop earnings. */
  platformIssued: number;
  platformIssuedCount: number;
  /** Credits released by an approved Cash In. Never shop earnings. */
  cashIn: number;
  cashInCount: number;
  /** Credits reserved against a pending withdrawal — a hold, not a revocation. */
  withdrawalHeld: number;
  /** Held credits returned after a rejected/cancelled withdrawal. */
  withdrawalReturned: number;
  /** Held credits handed to the shop admin by a shop cash out (stay in the shop). */
  adminCashoutSettled: number;
  /** Existing credits moved between wallets at face value (no earnings). */
  transferred: number;
  transferCount: number;
  /** Credits spent on vouchers. */
  spentOnVouchers: number;
  /** Sale cashback credited to sellers. */
  cashbackPaid: number;
  /** Upline commission credited to parent resellers. */
  uplinePaid: number;
  /** Cashback/upline removed again by refunds. */
  commissionReversed: number;
}

/**
 * Both legs of a transfer share a transaction id; the receiving leg carries a
 * `-R` suffix. Normalising it lets us pair debit and credit sides.
 */
const txKey = (e: CreditEntry) =>
  e.tx_id ? e.tx_id.replace(/-R$/, "") : `id:${e.id}`;

export function summariseCreditFlow(entries: CreditEntry[]): CreditFlowSummary {
  const byTx = new Map<string, CreditEntry[]>();
  for (const e of entries) {
    const key = txKey(e);
    const list = byTx.get(key);
    if (list) list.push(e);
    else byTx.set(key, [e]);
  }
  const out: CreditFlowSummary = {
    generated: 0,
    generatedCount: 0,
    revoked: 0,
    platformIssued: 0,
    platformIssuedCount: 0,
    cashIn: 0,
    cashInCount: 0,
    withdrawalHeld: 0,
    withdrawalReturned: 0,
    adminCashoutSettled: 0,
    transferred: 0,
    transferCount: 0,
    spentOnVouchers: 0,
    cashbackPaid: 0,
    uplinePaid: 0,
    commissionReversed: 0,
  };
  for (const e of entries) {
    const kind = e.entry_kind ?? "general";
    if (kind === "purchase") {
      if (e.direction === "debit") out.spentOnVouchers += e.amount;
      continue;
    }
    // Platform-minted credits — never a sale, never shop or platform earnings.
    if (kind === "credit_issue" || kind === "superadmin_credit_issuance") {
      out.platformIssued += e.amount;
      out.platformIssuedCount += 1;
      continue;
    }
    // Platform owner removing credits from a shop wallet.
    if (kind === "credit_revocation") {
      out.revoked += e.amount;
      continue;
    }
    if (kind === "cash_in") {
      out.cashIn += e.amount;
      out.cashInCount += 1;
      continue;
    }
    if (kind === "withdrawal_hold") {
      out.withdrawalHeld += e.amount;
      continue;
    }
    if (kind === "withdrawal_return") {
      out.withdrawalReturned += e.amount;
      continue;
    }
    // Shop cash out: the requester's held credits move to the shop admin 1:1.
    // Nothing is minted and nothing leaves the shop.
    if (kind === "admin_cashout_settlement") {
      out.adminCashoutSettled += e.amount;
      continue;
    }
    if (kind === "sale_commission" || kind === "upline_commission") {
      if (e.direction === "credit") {
        if (kind === "upline_commission") out.uplinePaid += e.amount;
        else out.cashbackPaid += e.amount;
      } else {
        out.commissionReversed += e.amount;
      }
      continue;
    }
    if (kind === "sale_commission_reversal" || kind === "upline_commission_reversal") {
      out.commissionReversed += e.amount;
      continue;
    }
    const siblings = byTx.get(txKey(e)) ?? [];
    const paired = siblings.some((s) => s.id !== e.id && s.direction !== e.direction);
    if (paired) {
      if (e.direction === "debit") {
        out.transferred += e.amount;
        out.transferCount += 1;
      }
      continue;
    }
    if (e.direction === "credit") {
      out.generated += e.amount;
      out.generatedCount += 1;
    } else {
      out.revoked += e.amount;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Admin shop cashflow — retained earnings on completed sales          */
/* ------------------------------------------------------------------ */

export interface AdminShopEarnings {
  /** Completed, credit-funded sales counted. */
  saleCount: number;
  /** Credits collected on those sales (after any wholesale discount). */
  saleCollected: number;
  /** Cashback paid to the selling reseller/subreseller on those sales. */
  cashbackPaid: number;
  /** Upline commission paid on those sales. */
  uplinePaid: number;
  /** What the shop keeps: collected less downline cashback. */
  retained: number;
  /** Sales refunded in range — excluded from every figure above. */
  refundedCount: number;
  refundedAmount: number;
}

/**
 * The Admin's shop earnings, derived only from completed voucher sales and the
 * cashback/commission rows attached to those exact sales. Refunded, pending and
 * points-funded sales are excluded, so the same sale is never double counted
 * and no credit issuance, cash-in, transfer or withdrawal can inflate it.
 * Each row carries the percentages snapshotted at sale time, so changing the
 * configured rates only affects future sales.
 */
export function adminShopEarnings(
  sales: SaleReportRow[],
  commissions: SaleCommissionReportRow[],
): AdminShopEarnings {
  const out: AdminShopEarnings = {
    saleCount: 0,
    saleCollected: 0,
    cashbackPaid: 0,
    uplinePaid: 0,
    retained: 0,
    refundedCount: 0,
    refundedAmount: 0,
  };
  const counted = new Set<string>();
  for (const s of sales) {
    if (s.payment_method === "points") continue;
    if (s.refunded_at) {
      out.refundedCount += 1;
      out.refundedAmount += s.sale_price;
      continue;
    }
    counted.add(s.id);
    out.saleCount += 1;
    out.saleCollected += s.sale_price;
  }
  for (const c of commissions) {
    if (c.reversed_at) continue;
    if (!counted.has(c.sale_id)) continue;
    if (c.kind === "upline") out.uplinePaid += c.commission_amount;
    else out.cashbackPaid += c.commission_amount;
  }
  out.retained = out.saleCollected - out.cashbackPaid - out.uplinePaid;
  return out;
}


/* ------------------------------------------------------------------ */
/* Sale commissions (cashback + upline) paid inside an ecosystem       */
/* ------------------------------------------------------------------ */

export interface SaleCommissionReportRow {
  id: string;
  ecosystem_id: string;
  sale_id: string;
  recipient_id: string;
  kind: string;
  commission_percent: number;
  commission_amount: number;
  reversed_at: string | null;
  created_at: string;
}

export async function fetchSaleCommissionsReport(q: {
  range: ResolvedRange;
  ecosystemId?: string | null;
  recipientId?: string | null;
  limit?: number;
}): Promise<SaleCommissionReportRow[]> {
  let query = supabase
    .from("sale_commissions")
    .select(
      "id, ecosystem_id, sale_id, recipient_id, kind, commission_percent, commission_amount, reversed_at, created_at",
    )
    .gte("created_at", iso(q.range.start))
    .lte("created_at", iso(q.range.end))
    .order("created_at", { ascending: false })
    .limit(q.limit ?? 1000);
  if (q.ecosystemId) query = query.eq("ecosystem_id", q.ecosystemId);
  if (q.recipientId) query = query.eq("recipient_id", q.recipientId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as SaleCommissionReportRow[]).map((r) => ({
    ...r,
    commission_percent: Number(r.commission_percent),
    commission_amount: Number(r.commission_amount),
  }));
}

export interface CommissionSplit {
  cashback: number;
  upline: number;
  reversed: number;
}

/** Settled cashback vs upline totals; reversed rows are excluded from both. */
export function summariseSaleCommissions(rows: SaleCommissionReportRow[]): CommissionSplit {
  const out: CommissionSplit = { cashback: 0, upline: 0, reversed: 0 };
  for (const r of rows) {
    if (r.reversed_at) {
      out.reversed += r.commission_amount;
      continue;
    }
    if (r.kind === "upline") out.upline += r.commission_amount;
    else out.cashback += r.commission_amount;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Points                                                              */
/* ------------------------------------------------------------------ */

export interface PointsEntryRow {
  id: string;
  user_id: string;
  ecosystem_id: string;
  direction: "credit" | "debit";
  amount: number;
  entry_type: string;
  reason: string;
  created_at: string;
  credits_basis: number | null;
  credits_per_point_used: number | null;
  points_rule_version: number | null;
}

export async function fetchPointsReport(q: CreditQuery): Promise<PointsEntryRow[]> {
  let query = supabase
    .from("points_ledger")
    .select(
      "id, user_id, ecosystem_id, direction, amount, entry_type, reason, created_at, credits_basis, credits_per_point_used, points_rule_version",
    )
    .gte("created_at", iso(q.range.start))
    .lte("created_at", iso(q.range.end))
    .order("created_at", { ascending: false })
    .limit(q.limit ?? 1000);
  if (q.ecosystemId) query = query.eq("ecosystem_id", q.ecosystemId);
  if (q.userId) query = query.eq("user_id", q.userId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as PointsEntryRow[]).map((p) => ({
    ...p,
    amount: Number(p.amount),
    credits_basis: p.credits_basis === null ? null : Number(p.credits_basis),
    credits_per_point_used:
      p.credits_per_point_used === null ? null : Number(p.credits_per_point_used),
  }));
}

export interface PointsSummary {
  earned: number;
  spent: number;
  adjusted: number;
}

export function summarisePoints(rows: PointsEntryRow[]): PointsSummary {
  let earned = 0;
  let spent = 0;
  let adjusted = 0;
  for (const r of rows) {
    if (r.entry_type === "earn") earned += r.amount;
    else if (r.direction === "debit") spent += r.amount;
    else adjusted += r.amount;
  }
  return { earned, spent, adjusted };
}

/* ------------------------------------------------------------------ */
/* Names                                                               */
/* ------------------------------------------------------------------ */

/** Resolves profile ids to display names for report tables (RLS scoped). */
export async function fetchNameMap(ecosystemId?: string | null): Promise<Record<string, string>> {
  let query = supabase.from("profiles").select("id, full_name").limit(1000);
  if (ecosystemId) query = query.eq("ecosystem_id", ecosystemId);
  const { data } = await query;
  return Object.fromEntries((data ?? []).map((p) => [p.id, p.full_name]));
}

/* ------------------------------------------------------------------ */
/* CSV export                                                          */
/* ------------------------------------------------------------------ */

function escapeCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(headers: string[], rows: (string | number | null)[][]): string {
  return [headers, ...rows].map((r) => r.map(escapeCell).join(",")).join("\n");
}

/** Triggers a browser download; reports never leave the client. */
export function downloadCsv(filename: string, csv: string) {
  if (typeof window === "undefined") return;
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const csvStamp = () => new Date().toISOString().slice(0, 10);
