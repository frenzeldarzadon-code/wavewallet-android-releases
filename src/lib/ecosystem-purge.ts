/**
 * Permanent ecosystem deletion (platform owner only).
 *
 * This is NOT the 1-year inactivity cleanup (`archiveEcosystem`), which only
 * archives a shop and keeps its history under the retention policy. A purge is
 * an explicit, administrative, irreversible removal of an entire shop and every
 * record that belongs to it — deliberately bypassing the normal transaction
 * history protections because the platform owner chose permanent deletion.
 *
 * Authorization and the exact-name check are enforced server-side by
 * `purge_ecosystem`; the UI guards here exist only to make the action
 * intentional. A platform-level deletion record is written outside the deleted
 * shop so the audit trail survives.
 */
import { supabase } from "@/integrations/supabase/client";

/** Everything a purge removes — shown to the operator before they confirm. */
export const PURGE_DELETION_ITEMS = [
  "Member accounts and profiles (admins, resellers, subresellers, customers)",
  "Reseller / subreseller / customer relationships",
  "Credit wallets, balances and the full credit ledger",
  "Points wallets, points history and reward claims",
  "Voucher products, batches, codes and inventory",
  "Voucher sales and every transaction record",
  "Transfer reversals and dispute records",
  "Earnings, commissions, cashback and discount records",
  "Subscription requests, payments and expiry adjustments",
  "Shop settings, signup link and Facebook support settings",
  "Audit and history records belonging to this shop",
] as const;

export const PURGE_WARNING =
  "This permanently deletes the shop and all of its data regardless of transaction history. " +
  "It bypasses the normal transaction-history protections because you explicitly chose permanent " +
  "deletion. It cannot be undone.";

export type PurgeStep = "warning" | "confirm";

/** Step 2 gate: the typed value must match the shop name exactly (trimmed only). */
export function purgeConfirmationMatches(ecosystemName: string, typed: string): boolean {
  return typed.trim() === ecosystemName.trim() && ecosystemName.trim().length > 0;
}

/** Both steps must be completed and a reason given before the final action unlocks. */
export function canSubmitPurge(input: {
  step: PurgeStep;
  ecosystemName: string;
  typed: string;
  reason: string;
  busy: boolean;
}): boolean {
  if (input.step !== "confirm" || input.busy) return false;
  if (input.reason.trim().length === 0) return false;
  return purgeConfirmationMatches(input.ecosystemName, input.typed);
}

export interface PurgeResult {
  ecosystem_id: string;
  name: string;
  counts: Record<string, number>;
}

export function summarizePurge(result: PurgeResult): string {
  const total = Object.values(result.counts ?? {}).reduce((sum, n) => sum + Number(n || 0), 0);
  return `${result.name} deleted — ${total} record${total === 1 ? "" : "s"} removed.`;
}

export async function purgeEcosystem(
  ecosystemId: string,
  confirmName: string,
  reason: string,
): Promise<PurgeResult> {
  const { data, error } = await supabase.rpc("purge_ecosystem", {
    _ecosystem_id: ecosystemId,
    _confirm_name: confirmName,
    _reason: reason,
  });
  if (error) throw new Error(error.message);
  return data as unknown as PurgeResult;
}

export interface PlatformDeletionRecord {
  id: string;
  ecosystem_id: string;
  ecosystem_name: string;
  ecosystem_slug: string;
  actor_name: string;
  reason: string;
  counts: Record<string, number>;
  created_at: string;
}

/** The platform-level deletion trail — it lives outside every shop. */
export async function fetchDeletionLog(limit = 50): Promise<PlatformDeletionRecord[]> {
  const { data, error } = await supabase
    .from("platform_deletion_log")
    .select("id, ecosystem_id, ecosystem_name, ecosystem_slug, actor_name, reason, counts, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as PlatformDeletionRecord[];
}
