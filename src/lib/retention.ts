import { supabase } from "@/integrations/supabase/client";

export const RETENTION_MONTHS = 12;

export type RetentionRun = {
  id: string;
  started_at: string;
  finished_at: string | null;
  cutoff: string;
  dry_run: boolean;
  status: string;
  deleted: Record<string, number>;
  flagged: Record<string, number>;
  error: string | null;
};

const asCounts = (value: unknown): Record<string, number> =>
  value && typeof value === "object" ? (value as Record<string, number>) : {};

const normalise = (row: Record<string, unknown>): RetentionRun => ({
  id: String(row["id"]),
  started_at: String(row["started_at"]),
  finished_at: (row["finished_at"] as string | null) ?? null,
  cutoff: String(row["cutoff"]),
  dry_run: Boolean(row["dry_run"]),
  status: String(row["status"]),
  deleted: asCounts(row["deleted"]),
  flagged: asCounts(row["flagged"]),
  error: (row["error"] as string | null) ?? null,
});

export async function fetchRetentionRuns(limit = 10): Promise<RetentionRun[]> {
  const { data, error } = await supabase
    .from("retention_runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => normalise(row as Record<string, unknown>));
}

/** Super admin only — the daily scheduler runs the same routine automatically. */
export async function runRetentionPurge(dryRun: boolean): Promise<RetentionRun> {
  const { data, error } = await supabase.rpc("run_retention_purge", { _dry_run: dryRun });
  if (error) throw new Error(error.message);
  return normalise(data as unknown as Record<string, unknown>);
}

export const RETENTION_PURGED_LABELS: Record<string, string> = {
  credit_ledger: "Wallet credit history",
  credit_lots: "Spent credit sources",
  credit_lot_consumptions: "Credit source usage",
  sale_commissions: "Credit-back breakdowns",
  points_ledger: "Points history",
  voucher_sales: "Voucher sales",
  voucher_codes: "Sold voucher codes",
  voucher_imports: "Voucher import batches",
  reward_redemptions: "Settled reward redemptions",
};

export const RETENTION_FLAGGED_LABELS: Record<string, string> = {
  audit_logs: "Audit log entries",
  subscription_requests: "Subscription payment records",
  admin_invitations: "Operator invitations",
};
