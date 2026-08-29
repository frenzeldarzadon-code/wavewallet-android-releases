/**
 * Coins tab presentation layer — grouping only.
 *
 * One voucher purchase can produce several immutable ledger rows (the purchase
 * debit plus one cashback credit per authorised recipient). This module folds
 * the rows a viewer is ALREADY allowed to read (their own shop wallet ledger,
 * enforced by RLS) into a single displayed entry per purchase.
 *
 * It performs no arithmetic on balances or commissions: amounts are copied
 * verbatim from the ledger rows, and nothing here writes to the database.
 *
 * Privacy: the input is the viewer's own ledger only, so cashback paid to an
 * upline (admin/reseller) is never part of this data set — it lives in that
 * member's own wallet. The grouping therefore cannot surface upline cashback,
 * and it never fetches other members' rows to fill a breakdown.
 */
import { peso } from "@/lib/wavewallet";
import { cashbackSourceLabel, type CashbackSourceMap } from "@/lib/cashback-source";
import type { CreditEntry } from "@/lib/wallet";


/** Ledger kinds that belong to the voucher-purchase family. */
const CASHBACK_KINDS = new Set(["sale_commission", "upline_commission"]);

export function isCashbackEntry(e: CreditEntry): boolean {
  return e.direction === "credit" && CASHBACK_KINDS.has(e.entry_kind ?? "");
}

export function isPurchaseEntry(e: CreditEntry): boolean {
  return e.direction === "debit" && (e.entry_kind === "purchase" || Boolean(e.sale_id));
}

/**
 * Stable key that ties rows to the same underlying sale.
 * `sale_id` is authoritative; `tx_id` is the fallback used by older rows that
 * predate the sale reference. Rows with neither stay ungrouped.
 */
export function groupKey(e: CreditEntry): string | null {
  if (e.sale_id) return `sale:${e.sale_id}`;
  if (e.tx_id) return `tx:${e.tx_id}`;
  return null;
}

export interface CoinCashbackLine {
  id: string;
  label: string;
  amount: number;
  percent: number | null;
}

export interface CoinHistoryRow {
  id: string;
  /** "purchase" rows are grouped sales; "entry" rows are any other movement. */
  kind: "purchase" | "entry";
  createdAt: string;
  title: string;
  txId: string | null;
  reference: string | null;
  /** Prominent amount — the purchase price, or the entry amount. */
  amount: number;
  direction: "credit" | "debit";
  balanceAfter: number | null;
  /** Cashback rows the viewer owns that belong to this purchase. */
  cashback: CoinCashbackLine[];
  cashbackTotal: number;
  /** Every underlying ledger row, kept for the expandable audit detail. */
  entries: CreditEntry[];
}

function cashbackLabel(e: CreditEntry, sources: CashbackSourceMap = {}): string {
  // Prefer the recorded origin of the sale (customer / reseller / subreseller
  // purchase). Falls back to the existing wording when it cannot be read.
  const source = cashbackSourceLabel(e.sale_id ?? null, sources);
  if (source) return `Cashback from ${source}`;
  if (e.entry_kind === "upline_commission") return "Cashback from your downline's sale";
  return "Sales cashback on coins you supplied";
}

function cashbackLine(e: CreditEntry, sources: CashbackSourceMap = {}): CoinCashbackLine {
  return {
    id: e.id,
    label: cashbackLabel(e, sources),
    amount: Number(e.amount),
    percent:
      e.commission_percent === null || e.commission_percent === undefined
        ? null
        : Number(e.commission_percent),
  };
}


/**
 * Folds a viewer's ledger rows into display rows: one row per voucher purchase
 * (with its cashback summarised inside), every other movement untouched.
 * Input order is preserved by created_at (newest first).
 */
export function buildCoinHistory(entries: CreditEntry[]): CoinHistoryRow[] {
  const groups = new Map<string, CreditEntry[]>();
  const rows: CoinHistoryRow[] = [];
  const order: (CoinHistoryRow | string)[] = [];

  for (const e of entries) {
    const key = isPurchaseEntry(e) || isCashbackEntry(e) ? groupKey(e) : null;
    if (!key) {
      const row: CoinHistoryRow = {
        id: `entry:${e.id}`,
        kind: "entry",
        createdAt: e.created_at,
        title: e.reason,
        txId: e.tx_id,
        reference: e.reference ?? null,
        amount: Number(e.amount),
        direction: e.direction,
        balanceAfter: Number(e.balance_after),
        cashback: [],
        cashbackTotal: 0,
        entries: [e],
      };
      rows.push(row);
      order.push(row);
      continue;
    }
    const existing = groups.get(key);
    if (existing) existing.push(e);
    else {
      groups.set(key, [e]);
      order.push(key);
    }
  }

  const out: CoinHistoryRow[] = [];
  for (const item of order) {
    if (typeof item !== "string") {
      out.push(item);
      continue;
    }
    const list = groups.get(item)!;
    const purchase = list.find(isPurchaseEntry) ?? null;
    const cashbackEntries = list.filter(isCashbackEntry);
    const rest = list.filter((e) => e !== purchase && !isCashbackEntry(e));
    const primary = purchase ?? cashbackEntries[0] ?? list[0]!;
    const latest = list.reduce((a, b) => (a.created_at >= b.created_at ? a : b));
    const cashback = cashbackEntries.map((e) => cashbackLine(e, sources));
    // No purchase debit in the viewer's own wallet (they earned cashback on
    // someone else's purchase): the cashback itself is the visible amount.
    const showsPurchase = Boolean(purchase);
    out.push({
      id: `group:${item}`,
      kind: showsPurchase ? "purchase" : "entry",
      createdAt: primary.created_at,
      title: primary.reason,
      txId: primary.tx_id,
      reference: primary.reference ?? null,
      amount: Number(primary.amount),
      direction: primary.direction,
      balanceAfter: Number(latest.balance_after),
      cashback: showsPurchase ? cashback : cashback.slice(1),
      cashbackTotal: (showsPurchase ? cashback : cashback.slice(1)).reduce(
        (s, c) => s + c.amount,
        0,
      ),
      entries: [...(purchase ? [purchase] : []), ...cashbackEntries, ...rest],
    });
  }

  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Direction filter applied to grouped rows (a purchase keeps its debit side). */
export function filterCoinHistory(
  rows: CoinHistoryRow[],
  direction: "all" | "credit" | "debit",
): CoinHistoryRow[] {
  if (direction === "all") return rows;
  return rows.filter((r) => r.direction === direction);
}

/** Compact secondary line, e.g. "Cashback earned: ₱2.00". */
export function cashbackSummary(row: CoinHistoryRow): string | null {
  if (row.cashback.length === 0) return null;
  return `Cashback earned: ${peso(row.cashbackTotal)}`;
}
