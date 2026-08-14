/**
 * Super Admin earnings.
 *
 * The platform owner earns from the fees it actually collects: the cash-out
 * fee taken when a withdrawal is released, the cash-in fee taken when a cash
 * in payment is verified, and the flat shop-to-shop transfer fee. Everything
 * else the platform owner touches — minting credits, member wallet balances,
 * shop credit supply, transfers, withdrawal holds — moves credits without
 * earning anything, and must never appear here.
 *
 * Each request carries the fee snapshotted at submission time (`fee_php`,
 * `fee_percent`), so historical fees stay intact when a fee setting changes
 * later.
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

/**
 * Shop-to-shop transfer fees.
 *
 * The flat fee charged when a member moves credits between two of their own
 * shop wallets is platform-owner earnings, denominated in CREDITS (not pesos),
 * so it is reported separately from cash-out fees and never mixed into a peso
 * total.
 */
export interface ShopTransferFeeRow {
  id: string;
  tx_id: string;
  gross_credits: number;
  fee_credits: number;
  net_credits: number;
  created_at: string;
}

export async function fetchShopTransferFees(opts?: {
  from?: Date;
  to?: Date;
  limit?: number;
}): Promise<ShopTransferFeeRow[]> {
  let query = supabase
    .from("shop_transfer_fees")
    .select("id, tx_id, gross_credits, fee_credits, net_credits, created_at")
    .order("created_at", { ascending: false })
    .limit(opts?.limit ?? 1000);
  if (opts?.from) query = query.gte("created_at", opts.from.toISOString());
  if (opts?.to) query = query.lte("created_at", opts.to.toISOString());
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as ShopTransferFeeRow[]).map((r) => ({
    id: r.id,
    tx_id: r.tx_id,
    gross_credits: Number(r.gross_credits ?? 0),
    fee_credits: Number(r.fee_credits ?? 0),
    net_credits: Number(r.net_credits ?? 0),
    created_at: String(r.created_at),
  }));
}

export function transferFeePeriodTotals(rows: ShopTransferFeeRow[]): PeriodTotals {
  return periodTotalsOf(rows, (r) => r.created_at, (r) => r.fee_credits);
}

/**
 * Cash-in fees.
 *
 * The fee is collected the moment the platform owner APPROVES a cash in: the
 * member is credited the net amount only. Each row keeps the fee percent and
 * peso fee it was submitted with, so changing the setting never rewrites a
 * completed transaction or its reported earnings.
 */
export interface CashInFeeRow {
  id: string;
  reference: string;
  requester_name: string | null;
  ecosystem_id: string | null;
  amount_php: number;
  fee_percent: number;
  fee_php: number;
  net_php: number;
  reviewed_at: string;
}

export async function fetchCashInFees(opts?: {
  from?: Date;
  to?: Date;
  limit?: number;
}): Promise<CashInFeeRow[]> {
  let query = supabase
    .from("cash_in_requests")
    .select(
      "id, reference, requester_name, ecosystem_id, amount_php, fee_percent, fee_php, net_php, status, reviewed_at",
    )
    .eq("status", "approved")
    .not("reviewed_at", "is", null)
    .order("reviewed_at", { ascending: false })
    .limit(opts?.limit ?? 1000);
  if (opts?.from) query = query.gte("reviewed_at", opts.from.toISOString());
  if (opts?.to) query = query.lte("reviewed_at", opts.to.toISOString());
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as (CashInFeeRow & { status: string })[])
    .filter((r) => r.status === "approved" && !!r.reviewed_at && Number(r.fee_php ?? 0) > 0)
    .map((r) => ({
      id: r.id,
      reference: r.reference,
      requester_name: r.requester_name ?? null,
      ecosystem_id: r.ecosystem_id ?? null,
      amount_php: Number(r.amount_php ?? 0),
      fee_percent: Number(r.fee_percent ?? 0),
      fee_php: Number(r.fee_php ?? 0),
      net_php: Number(r.net_php ?? 0),
      reviewed_at: String(r.reviewed_at),
    }));
}

export function cashInFeePeriodTotals(rows: CashInFeeRow[]): PeriodTotals {
  return periodTotalsOf(rows, (r) => r.reviewed_at, (r) => r.fee_php);
}

export const totalCashInFees = (rows: CashInFeeRow[]) => rows.reduce((s, r) => s + r.fee_php, 0);
