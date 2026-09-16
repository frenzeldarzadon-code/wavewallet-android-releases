/**
 * Historical points → shop Admin coin cost reconciliation (1 point = 1 coin).
 *
 * Everything here is accounting *reporting* plus one platform-owner action.
 * Points themselves are never written: the authoritative `points_ledger`
 * history and every member's points balance stay exactly as earned. The
 * reconciliation only posts a coin debit on the shop Admin's Universe wallet
 * and records which historical awards that debit covered, which is what makes
 * re-running it safe.
 */
import { supabase } from "@/integrations/supabase/client";

const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0) || 0);
const str = (v: unknown) => (typeof v === "string" ? v : null);

export interface PointsCostShop {
  ecosystemId: string;
  shopName: string;
  adminId: string | null;
  adminName: string | null;
  historicalPoints: number;
  chargedPoints: number;
  pendingPoints: number;
  chargedCoins: number;
  shortfallCoins: number;
  adminAvailable: number;
  status: string;
}

export interface PointsCostUnresolved {
  bucket: string;
  detail: string;
  entries: number;
  points: number;
}

export interface PointsCostRun {
  id: string;
  ecosystemId: string;
  shopName: string;
  adminId: string | null;
  adminName: string | null;
  pointsTotal: number;
  coinEquivalent: number;
  amountDebited: number;
  shortfall: number;
  entriesCount: number;
  status: string;
  txId: string | null;
  note: string | null;
  createdAt: string;
}

export interface PointsCostPreview {
  ecosystemId: string;
  shopName: string;
  adminId: string | null;
  adminName: string | null;
  pointsTotal: number;
  coinEquivalent: number;
  amountDebited: number;
  shortfall: number;
  entriesCount: number;
  status: string;
}

/* ------------------------------------------------------------------ */
/* Pure presentation helpers                                           */
/* ------------------------------------------------------------------ */

/** 1 point = 1 coin, to the two decimals the ledger stores. */
export function coinCostForPoints(points: number): number {
  if (!Number.isFinite(points) || points <= 0) return 0;
  return Math.round(points * 100) / 100;
}

export function reconciliationStatusLabel(status: string): string {
  switch (status) {
    case "settled":
      return "Fully charged";
    case "partial":
      return "Partly charged";
    case "pending":
      return "Not charged yet";
    case "nothing_to_charge":
      return "Nothing to charge";
    case "unresolved_no_admin":
      return "Unresolved — no shop admin";
    case "unresolved_insufficient_balance":
      return "Unresolved — not enough coins";
    default:
      return status;
  }
}

export function reconciliationTone(
  status: string,
): "brand" | "success" | "warning" | "danger" | "muted" {
  switch (status) {
    case "settled":
      return "success";
    case "partial":
      return "warning";
    case "pending":
      return "brand";
    case "unresolved_no_admin":
    case "unresolved_insufficient_balance":
      return "danger";
    default:
      return "muted";
  }
}

/** A shop reconciles when charged + pending equals the historical total. */
export function shopReconciles(shop: PointsCostShop): boolean {
  const sum = Math.round((shop.chargedPoints + shop.pendingPoints) * 100) / 100;
  return Math.abs(sum - shop.historicalPoints) < 0.005;
}

export function totals(shops: PointsCostShop[]) {
  const add = (pick: (s: PointsCostShop) => number) =>
    Math.round(shops.reduce((t, s) => t + pick(s), 0) * 100) / 100;
  return {
    historicalPoints: add((s) => s.historicalPoints),
    chargedCoins: add((s) => s.chargedCoins),
    pendingCoins: add((s) => s.pendingPoints),
    shops: shops.filter((s) => s.historicalPoints > 0).length,
  };
}

/* ------------------------------------------------------------------ */
/* Data access — every call is Super-Admin-gated inside the database   */
/* ------------------------------------------------------------------ */

export async function fetchPointsCostReport(): Promise<PointsCostShop[]> {
  const { data, error } = await supabase.rpc("super_points_cost_report");
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => ({
    ecosystemId: String(row["ecosystem_id"]),
    shopName: String(row["shop_name"] ?? ""),
    adminId: str(row["admin_id"]),
    adminName: str(row["admin_name"]),
    historicalPoints: num(row["historical_points"]),
    chargedPoints: num(row["charged_points"]),
    pendingPoints: num(row["pending_points"]),
    chargedCoins: num(row["charged_coins"]),
    shortfallCoins: num(row["shortfall_coins"]),
    adminAvailable: num(row["admin_available"]),
    status: String(row["status"] ?? ""),
  }));
}

export async function fetchPointsCostUnresolved(): Promise<PointsCostUnresolved[]> {
  const { data, error } = await supabase.rpc("super_points_cost_unresolved");
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => ({
    bucket: String(row["bucket"] ?? ""),
    detail: String(row["detail"] ?? ""),
    entries: num(row["entries"]),
    points: num(row["points"]),
  }));
}

export async function fetchPointsCostRuns(limit = 200): Promise<PointsCostRun[]> {
  const { data, error } = await supabase.rpc("super_points_cost_runs", { _limit: limit });
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row["id"]),
    ecosystemId: String(row["ecosystem_id"]),
    shopName: String(row["shop_name"] ?? ""),
    adminId: str(row["admin_id"]),
    adminName: str(row["admin_name"]),
    pointsTotal: num(row["points_total"]),
    coinEquivalent: num(row["coin_equivalent"]),
    amountDebited: num(row["amount_debited"]),
    shortfall: num(row["shortfall"]),
    entriesCount: num(row["entries_count"]),
    status: String(row["status"] ?? ""),
    txId: str(row["tx_id"]),
    note: str(row["note"]),
    createdAt: String(row["created_at"] ?? ""),
  }));
}

/** `dryRun` previews only; the database writes nothing in that mode. */
export async function runPointsCostReconciliation(dryRun: boolean): Promise<PointsCostPreview[]> {
  const { data, error } = await supabase.rpc("super_reconcile_points_cost", {
    _dry_run: dryRun,
  });
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => ({
    ecosystemId: String(row["ecosystem_id"]),
    shopName: String(row["shop_name"] ?? ""),
    adminId: str(row["admin_id"]),
    adminName: str(row["admin_name"]),
    pointsTotal: num(row["points_total"]),
    coinEquivalent: num(row["coin_equivalent"]),
    amountDebited: num(row["amount_debited"]),
    shortfall: num(row["shortfall"]),
    entriesCount: num(row["entries_count"]),
    status: String(row["status"] ?? ""),
  }));
}
