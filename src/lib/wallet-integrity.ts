/**
 * Wallet integrity report (platform owner only).
 *
 * Every balance change must come from a ledger row: `apply_credit_entry` /
 * `apply_points_entry` are the only writers of `credit_accounts.balance` and
 * `points_accounts.balance`, so `balance` normally equals the signed sum of the
 * account's ledger.
 *
 * One legitimate exception exists: the 12-month retention purge deletes old
 * ledger rows while deliberately preserving balances. An account whose history
 * was trimmed therefore shows a difference that is expected, not corruption.
 * The database reports that as `purge_explained`, and this module separates the
 * two so operators never chase a difference the retention policy created.
 */
import { supabase } from "@/integrations/supabase/client";

export interface WalletIntegrityRow {
  kind: "coins" | "points";
  account_id: string;
  user_id: string;
  ecosystem_id: string | null;
  member_name: string | null;
  balance: number;
  ledger_sum: number;
  difference: number;
  oldest_entry: string | null;
  purge_explained: boolean;
}

export interface IntegritySummary {
  /** Differences the retention purge cannot account for — these need attention. */
  unexplained: WalletIntegrityRow[];
  /** Differences fully explained by purged history — informational only. */
  explained: WalletIntegrityRow[];
  checked: number;
  ok: boolean;
}

/**
 * A row is only a genuine problem when the retention purge cannot explain it.
 * A purge can only ever remove entries, so it explains a difference when the
 * account still holds history that starts after the last purge cutoff (or holds
 * no history at all) — meaning older rows were removed underneath it.
 */
export function isUnexplained(row: WalletIntegrityRow): boolean {
  if (row.difference === 0) return false;
  return !row.purge_explained;
}

export function summarizeWalletIntegrity(rows: WalletIntegrityRow[]): IntegritySummary {
  const real = rows.filter((r) => r.difference !== 0);
  const unexplained = real.filter(isUnexplained);
  return {
    unexplained,
    explained: real.filter((r) => !isUnexplained(r)),
    checked: rows.length,
    ok: unexplained.length === 0,
  };
}

/** Total credits/points unaccounted for, by wallet kind. */
export function unexplainedTotals(rows: WalletIntegrityRow[]): { credits: number; points: number } {
  return rows.filter(isUnexplained).reduce(
    (acc, r) => {
      if (r.kind === "points") acc.points += r.difference;
      else acc.credits += r.difference;
      return acc;
    },
    { credits: 0, points: 0 },
  );
}

export function integrityHeadline(summary: IntegritySummary): string {
  if (summary.ok) {
    return summary.explained.length > 0
      ? `All wallets reconcile. ${summary.explained.length} differ only because old history was cleaned up.`
      : "All wallets reconcile with their transaction history.";
  }
  const n = summary.unexplained.length;
  return n === 1
    ? "1 wallet does not match their transaction history."
    : `${n} wallets do not match their transaction history.`;
}

export async function fetchWalletIntegrity(): Promise<WalletIntegrityRow[]> {
  const { data, error } = await supabase.rpc("wallet_integrity_check");
  if (error) throw new Error(error.message);
  return ((data ?? []) as WalletIntegrityRow[]).map((r) => ({
    ...r,
    balance: Number(r.balance ?? 0),
    ledger_sum: Number(r.ledger_sum ?? 0),
    difference: Number(r.difference ?? 0),
    purge_explained: Boolean(r.purge_explained),
  }));
}
