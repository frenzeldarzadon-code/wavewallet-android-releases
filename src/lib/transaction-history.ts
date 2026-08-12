/**
 * Unified ecosystem transaction history (Admin / Super Admin view).
 *
 * Read-only composition layer. It merges three already-existing sources —
 * the immutable credit ledger, voucher sales and recorded transfer reversals —
 * into one chronological feed and annotates each credit-transfer row with its
 * reversal status so the UI can offer (or withhold) the Reverse action.
 *
 * It creates no new server behaviour: reversals still go through
 * `reverse_credit_transfer`, and rows are limited to what RLS already allows
 * for the caller's ecosystem. The 12-month retention purge removes old rows at
 * the database level, so this feed inherits that window automatically.
 */
import { supabase } from "@/integrations/supabase/client";
import { LEDGER_COLUMNS, normalizeEntry, type CreditEntry } from "@/lib/wallet";
import {
  fetchReversalHistory,
  isReversibleTransferEntry,
  type ReversalRecord,
} from "@/lib/transfer-reversal";

export type TxKind = "transfer" | "adjustment" | "earning" | "purchase" | "reversal";

export const TX_FILTERS = [
  { value: "all", label: "All" },
  { value: "transfer", label: "Transfers" },
  { value: "purchase", label: "Voucher sales" },
  { value: "earning", label: "Earnings" },
  { value: "adjustment", label: "Adjustments" },
  { value: "reversal", label: "Reversals" },
] as const;

export type TxFilter = (typeof TX_FILTERS)[number]["value"];

/** Reversal state of a credit transfer, derived from recorded reversals. */
export interface TransferReversalState {
  status: "reversible" | "reversed" | "partially_reversed";
  reversedAmount: number;
  /** Amount of the original transfer not yet reversed. */
  remaining: number;
  record: ReversalRecord | null;
}

export interface TxRow {
  id: string;
  kind: TxKind;
  createdAt: string;
  /** Primary member the row belongs to (ledger owner / buyer / sender). */
  userId: string;
  counterpartyId: string | null;
  title: string;
  detail: string | null;
  txId: string | null;
  amount: number;
  direction: "credit" | "debit";
  balanceAfter: number | null;
  /** Present only for reversible credit-transfer rows. */
  transfer: TransferReversalState | null;
  entry: CreditEntry | null;
}

export interface VoucherSaleRow {
  id: string;
  created_at: string;
  buyer_id: string;
  reseller_id: string | null;
  product_name: string;
  quantity: number;
  sale_price: number;
  discount_percent: number;
  payment_method: string;
  tx_id: string;
  points_spent: number;
  points_earned: number;
  refunded_at: string | null;
}

export const SALE_COLUMNS =
  "id, created_at, buyer_id, reseller_id, product_name, quantity, sale_price, discount_percent, payment_method, tx_id, points_spent, points_earned, refunded_at";

/**
 * Derives the reversal state for a transfer from the ecosystem's reversal
 * records. A transfer already fully reversed must never offer Reverse again.
 */
export function transferState(
  entry: Pick<CreditEntry, "amount" | "tx_id">,
  byOriginalTx: Map<string, ReversalRecord>,
): TransferReversalState {
  const record = entry.tx_id ? (byOriginalTx.get(entry.tx_id) ?? null) : null;
  const original = Number(entry.amount ?? 0);
  if (!record) {
    return { status: "reversible", reversedAmount: 0, remaining: original, record: null };
  }
  const reversed = Number(record.reversed_amount ?? 0);
  const remaining = Math.max(0, original - reversed);
  return {
    status: record.kind === "partial" && remaining > 1e-9 ? "partially_reversed" : "reversed",
    reversedAmount: reversed,
    remaining,
    record,
  };
}

/** Only untouched or partially reversed transfers may still be reversed. */
export function canReverse(row: TxRow): boolean {
  if (row.kind !== "transfer" || !row.transfer) return false;
  return row.transfer.status !== "reversed" && row.transfer.remaining > 1e-9;
}

function ledgerKind(e: CreditEntry): TxKind {
  if (e.sale_id || e.entry_kind === "purchase") return "purchase";
  if (e.entry_kind === "sale_commission" || e.entry_kind === "upline_commission") return "earning";
  if (e.reason === "Credit transfer sent" || e.reason === "Credit transfer received") {
    return "transfer";
  }
  if (e.reason.toLowerCase().includes("reversal")) return "reversal";
  return "adjustment";
}

/** Merges ledger entries, voucher sales and reversals into one sorted feed. */
export function buildTransactionFeed(input: {
  ledger: CreditEntry[];
  sales: VoucherSaleRow[];
  reversals: ReversalRecord[];
}): TxRow[] {
  const byOriginalTx = new Map(input.reversals.map((r) => [r.original_tx_id, r]));
  const rows: TxRow[] = [];

  for (const e of input.ledger) {
    const kind = ledgerKind(e);
    rows.push({
      id: `ledger:${e.id}`,
      kind,
      createdAt: e.created_at,
      userId: e.user_id,
      counterpartyId: null,
      title: e.reason,
      detail: e.reference ?? null,
      txId: e.tx_id,
      amount: Number(e.amount),
      direction: e.direction,
      balanceAfter: Number(e.balance_after),
      transfer:
        kind === "transfer" && isReversibleTransferEntry(e)
          ? transferState(e, byOriginalTx)
          : null,
      entry: e,
    });
  }

  for (const s of input.sales) {
    rows.push({
      id: `sale:${s.id}`,
      kind: "purchase",
      createdAt: s.created_at,
      userId: s.buyer_id,
      counterpartyId: s.reseller_id,
      title: `${s.product_name}${s.quantity > 1 ? ` ×${s.quantity}` : ""}`,
      detail: [
        s.payment_method === "points" ? `${s.points_spent} pts spent` : null,
        s.discount_percent > 0 ? `${s.discount_percent}% wholesale discount` : null,
        s.points_earned > 0 ? `${s.points_earned} pts earned` : null,
        s.refunded_at ? "Refunded" : null,
      ]
        .filter(Boolean)
        .join(" · ") || null,
      txId: s.tx_id,
      amount: Number(s.sale_price),
      direction: "debit",
      balanceAfter: null,
      transfer: null,
      entry: null,
    });
  }

  for (const r of input.reversals) {
    rows.push({
      id: `reversal:${r.id}`,
      kind: "reversal",
      createdAt: r.created_at,
      userId: r.recipient_id,
      counterpartyId: r.sender_id,
      title: r.kind === "full" ? "Transfer reversed" : "Transfer partially reversed",
      detail: `${r.reason}${r.note ? ` · ${r.note}` : ""} · by ${r.actor_name}`,
      txId: r.reversal_tx_id,
      amount: Number(r.reversed_amount),
      direction: "debit",
      balanceAfter: null,
      transfer: null,
      entry: null,
    });
  }

  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function filterFeed(rows: TxRow[], filter: TxFilter, query: string, nameFor: (id: string) => string): TxRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter((r) => {
    if (filter !== "all" && r.kind !== filter) return false;
    if (!q) return true;
    return (
      r.title.toLowerCase().includes(q) ||
      (r.detail ?? "").toLowerCase().includes(q) ||
      (r.txId ?? "").toLowerCase().includes(q) ||
      nameFor(r.userId).toLowerCase().includes(q)
    );
  });
}

/**
 * Loads the ecosystem feed. Every query is scoped to the ecosystem id and
 * further constrained by RLS, so an admin can never read another shop's rows.
 */
export async function fetchTransactionFeed(
  ecosystemId: string,
  limit = 200,
): Promise<{ rows: TxRow[]; reversals: ReversalRecord[] }> {
  const [{ data: entries }, { data: sales }, reversals] = await Promise.all([
    supabase
      .from("credit_ledger")
      .select(LEDGER_COLUMNS)
      .eq("ecosystem_id", ecosystemId)
      .order("created_at", { ascending: false })
      .limit(limit),
    supabase
      .from("voucher_sales")
      .select(SALE_COLUMNS)
      .eq("ecosystem_id", ecosystemId)
      .order("created_at", { ascending: false })
      .limit(limit),
    fetchReversalHistory(ecosystemId, 200),
  ]);
  const ledger = ((entries ?? []) as unknown as CreditEntry[]).map(normalizeEntry);
  return {
    rows: buildTransactionFeed({
      ledger,
      sales: (sales ?? []) as unknown as VoucherSaleRow[],
      reversals,
    }),
    reversals,
  };
}
