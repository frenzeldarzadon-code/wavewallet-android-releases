/**
 * Earnings history for resellers and subresellers.
 *
 * Every row here is derived from finalized transaction records through the
 * `earnings_history` database function: sale cashback and upline commission
 * come from `sale_commissions` (rates snapshotted at sale time), wholesale
 * margin comes from the discount snapshotted on `voucher_sales`. Credit
 * transfers are face value and never appear as earnings.
 *
 * Refunded/reversed transactions keep their row but carry status `reversed`,
 * and are excluded from net totals — never deleted, never double-counted.
 */
import { supabase } from "@/integrations/supabase/client";

/** One shared reporting timezone so every ecosystem buckets days identically. */
export const EARNINGS_TZ = "Asia/Manila";

export type EarningType = "sale_cashback" | "upline_commission" | "wholesale_discount";

export const EARNING_TYPE_LABEL: Record<EarningType, string> = {
  sale_cashback: "Sales cashback",
  upline_commission: "Upline commission",
  wholesale_discount: "Wholesale margin",
};

export interface EarningRow {
  id: string;
  occurred_at: string;
  ecosystem_id: string;
  earning_type: EarningType;
  recipient_id: string;
  recipient_name: string | null;
  counterparty_id: string | null;
  counterparty_name: string | null;
  product_name: string | null;
  quantity: number | null;
  /** Gross value of the underlying sale. */
  gross_amount: number;
  /** Amount the rate was applied to (credits consumed, or list value). */
  basis_amount: number;
  rate_percent: number;
  earning_amount: number;
  status: "settled" | "reversed";
  tx_id: string | null;
  sale_id: string | null;
}

export interface EarningsQuery {
  recipientId?: string | null;
  ecosystemId?: string | null;
  from: Date;
  to: Date;
}

export async function fetchEarnings(q: EarningsQuery): Promise<EarningRow[]> {
  const args: { _recipient?: string; _ecosystem?: string; _from?: string; _to?: string } = {
    _from: q.from.toISOString(),
    _to: q.to.toISOString(),
  };
  if (q.recipientId) args._recipient = q.recipientId;
  if (q.ecosystemId) args._ecosystem = q.ecosystemId;
  const { data, error } = await supabase.rpc("earnings_history", args);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown[]).map((raw) => {
    const r = raw as Record<string, unknown>;
    return {
      id: String(r["id"]),
      occurred_at: String(r["occurred_at"]),
      ecosystem_id: String(r["ecosystem_id"]),
      earning_type: String(r["earning_type"]) as EarningType,
      recipient_id: String(r["recipient_id"]),
      recipient_name: (r["recipient_name"] as string | null) ?? null,
      counterparty_id: (r["counterparty_id"] as string | null) ?? null,
      counterparty_name: (r["counterparty_name"] as string | null) ?? null,
      product_name: (r["product_name"] as string | null) ?? null,
      quantity: r["quantity"] === null || r["quantity"] === undefined ? null : Number(r["quantity"]),
      gross_amount: Number(r["gross_amount"] ?? 0),
      basis_amount: Number(r["basis_amount"] ?? 0),
      rate_percent: Number(r["rate_percent"] ?? 0),
      earning_amount: Number(r["earning_amount"] ?? 0),
      status: r["status"] === "reversed" ? "reversed" : "settled",
      tx_id: (r["tx_id"] as string | null) ?? null,
      sale_id: (r["sale_id"] as string | null) ?? null,
    } satisfies EarningRow;
  });
}

/* ------------------------------------------------------------------ */
/* Periods                                                             */
/* ------------------------------------------------------------------ */

export type PeriodId = "daily" | "monthly" | "quarterly" | "yearly";

export const PERIOD_OPTIONS: { id: PeriodId; label: string }[] = [
  { id: "daily", label: "Daily" },
  { id: "monthly", label: "Monthly" },
  { id: "quarterly", label: "Quarterly" },
  { id: "yearly", label: "Yearly" },
];

const partsFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: EARNINGS_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Calendar y/m/d of an instant in the shared reporting timezone. */
export function zonedParts(value: string | Date): { year: number; month: number; day: number } {
  const date = typeof value === "string" ? new Date(value) : value;
  const parts = partsFmt.formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day") };
}

const pad = (n: number) => String(n).padStart(2, "0");
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Stable sortable bucket key + human label for a transaction timestamp. */
export function periodBucket(
  value: string | Date,
  period: PeriodId,
): { key: string; label: string } {
  const { year, month, day } = zonedParts(value);
  switch (period) {
    case "daily":
      return { key: `${year}-${pad(month)}-${pad(day)}`, label: `${MONTHS[month - 1]} ${day}, ${year}` };
    case "monthly":
      return { key: `${year}-${pad(month)}`, label: `${MONTHS[month - 1]} ${year}` };
    case "quarterly": {
      const q = Math.floor((month - 1) / 3) + 1;
      return { key: `${year}-Q${q}`, label: `Q${q} ${year}` };
    }
    case "yearly":
    default:
      return { key: String(year), label: String(year) };
  }
}

export interface EarningsTotals {
  count: number;
  reversedCount: number;
  gross: number;
  /** Settled earnings only. */
  net: number;
  /** Value removed by refunds/reversals. */
  reversed: number;
  byType: Record<EarningType, number>;
}

export function summariseEarnings(rows: EarningRow[]): EarningsTotals {
  const totals: EarningsTotals = {
    count: rows.length,
    reversedCount: 0,
    gross: 0,
    net: 0,
    reversed: 0,
    byType: { sale_cashback: 0, upline_commission: 0, wholesale_discount: 0 },
  };
  for (const r of rows) {
    if (r.status === "reversed") {
      totals.reversedCount += 1;
      totals.reversed += r.earning_amount;
      continue;
    }
    totals.gross += r.gross_amount;
    totals.net += r.earning_amount;
    totals.byType[r.earning_type] = (totals.byType[r.earning_type] ?? 0) + r.earning_amount;
  }
  return totals;
}

export interface EarningsBucket {
  key: string;
  label: string;
  rows: EarningRow[];
  totals: EarningsTotals;
}

/** Aggregates rows into calendar day / month / quarter / year buckets. */
export function bucketEarnings(rows: EarningRow[], period: PeriodId): EarningsBucket[] {
  const map = new Map<string, { label: string; rows: EarningRow[] }>();
  for (const r of rows) {
    const { key, label } = periodBucket(r.occurred_at, period);
    const entry = map.get(key) ?? { label, rows: [] };
    entry.rows.push(r);
    map.set(key, entry);
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([key, v]) => ({ key, label: v.label, rows: v.rows, totals: summariseEarnings(v.rows) }));
}

/* ------------------------------------------------------------------ */
/* Filters                                                             */
/* ------------------------------------------------------------------ */

export interface EarningsFilters {
  type?: EarningType | "all";
  status?: "all" | "settled" | "reversed";
  product?: string | "all";
  counterparty?: string | "all";
  search?: string;
}

export function filterEarnings(rows: EarningRow[], f: EarningsFilters): EarningRow[] {
  const needle = (f.search ?? "").trim().toLowerCase();
  return rows.filter((r) => {
    if (f.type && f.type !== "all" && r.earning_type !== f.type) return false;
    if (f.status && f.status !== "all" && r.status !== f.status) return false;
    if (f.product && f.product !== "all" && (r.product_name ?? "") !== f.product) return false;
    if (f.counterparty && f.counterparty !== "all") {
      const who = r.counterparty_id ?? r.recipient_id;
      if (who !== f.counterparty) return false;
    }
    if (needle) {
      const hay = [r.product_name, r.counterparty_name, r.recipient_name, r.tx_id]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}

/** Default lookback window for each period selector, in the shared timezone. */
export function defaultRangeFor(period: PeriodId): { from: Date; to: Date } {
  const to = new Date();
  const from = new Date(to);
  if (period === "daily") from.setDate(from.getDate() - 30);
  else if (period === "monthly") from.setMonth(from.getMonth() - 12);
  else if (period === "quarterly") from.setFullYear(from.getFullYear() - 2);
  else from.setFullYear(from.getFullYear() - 5);
  from.setHours(0, 0, 0, 0);
  return { from, to };
}

export const EARNINGS_CSV_HEADERS = [
  "Date/time",
  "Earning type",
  "Product",
  "Counterparty",
  "Recipient",
  "Gross sale",
  "Basis",
  "Rate %",
  "Earning",
  "Status",
  "Reference",
];

export function earningsCsvRows(rows: EarningRow[]): (string | number | null)[][] {
  return rows.map((r) => [
    r.occurred_at,
    EARNING_TYPE_LABEL[r.earning_type] ?? r.earning_type,
    r.product_name ?? "",
    r.counterparty_name ?? "",
    r.recipient_name ?? "",
    r.gross_amount,
    r.basis_amount,
    r.rate_percent,
    r.status === "reversed" ? 0 : r.earning_amount,
    r.status,
    r.tx_id ?? "",
  ]);
}
