/**
 * Super Admin earnings.
 *
 * The platform owner earns from EXACTLY ONE source: the cash-out fee actually
 * collected when a withdrawal is released. Everything else the platform owner
 * touches — minting credits, approving cash in, member wallet balances, shop
 * credit supply, transfers, withdrawal holds — moves credits without earning
 * anything, and must never appear here.
 *
 * Each released withdrawal already carries the fee snapshotted at submission
 * time (`fee_php`, `fee_percent`), so historical fees stay intact when the
 * platform fee setting changes later.
 */
import { supabase } from "@/integrations/supabase/client";
import { periodTotalsOf, type PeriodTotals } from "@/lib/earnings";

export interface CashOutFeeRow {
  id: string;
  reference: string;
  requester_name: string | null;
  ecosystem_id: string | null;
  gross_php: number;
  fee_percent: number;
  fee_php: number;
  net_php: number;
  released_at: string;
}

/** Only a RELEASED withdrawal has actually collected its fee. */
export const isFeeEarning = (r: { status: string; released_at: string | null }) =>
  r.status === "released" && !!r.released_at;

export async function fetchCashOutFees(opts?: {
  from?: Date;
  to?: Date;
  limit?: number;
}): Promise<CashOutFeeRow[]> {
  let query = supabase
    .from("withdrawal_requests")
    .select(
      "id, reference, requester_name, ecosystem_id, gross_php, fee_percent, fee_php, net_php, status, released_at",
    )
    .eq("status", "released")
    .not("released_at", "is", null)
    .order("released_at", { ascending: false })
    .limit(opts?.limit ?? 1000);
  if (opts?.from) query = query.gte("released_at", opts.from.toISOString());
  if (opts?.to) query = query.lte("released_at", opts.to.toISOString());
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as (CashOutFeeRow & { status: string })[])
    .filter(isFeeEarning)
    .map((r) => ({
      id: r.id,
      reference: r.reference,
      requester_name: r.requester_name ?? null,
      ecosystem_id: r.ecosystem_id ?? null,
      gross_php: Number(r.gross_php ?? 0),
      fee_percent: Number(r.fee_percent ?? 0),
      fee_php: Number(r.fee_php ?? 0),
      net_php: Number(r.net_php ?? 0),
      released_at: String(r.released_at),
    }));
}

/** Today / month / quarter / year fee income in the shared reporting timezone. */
export function feePeriodTotals(rows: CashOutFeeRow[]): PeriodTotals {
  return periodTotalsOf(rows, (r) => r.released_at, (r) => r.fee_php);
}

export const totalFees = (rows: CashOutFeeRow[]) => rows.reduce((s, r) => s + r.fee_php, 0);
