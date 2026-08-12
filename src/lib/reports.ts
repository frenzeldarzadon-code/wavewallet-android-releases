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
}

const SALE_COLUMNS =
  "id, ecosystem_id, product_name, buyer_id, buyer_role, reseller_id, list_price, discount_percent, sale_price, payment_method, tx_id, created_at, points_spent, points_earned, credits_per_point_used, points_rule_version";

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

export async function fetchCreditsReport(q: CreditQuery): Promise<CreditEntry[]> {
  let query = supabase
    .from("credit_ledger")
    .select(LEDGER_COLUMNS)
    .gte("created_at", iso(q.range.start))
    .lte("created_at", iso(q.range.end))
    .order("created_at", { ascending: false })
    .limit(q.limit ?? 1000);
  if (q.ecosystemId) query = query.eq("ecosystem_id", q.ecosystemId);
  if (q.userId) query = query.eq("user_id", q.userId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as CreditEntry[]).map(normalizeEntry);
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
