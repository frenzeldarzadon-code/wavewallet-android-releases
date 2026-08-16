import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, PageSection, StatusBadge } from "@/components/ui-kit";
import { toast } from "sonner";
import {
  fetchWalletIntegrity,
  integrityHeadline,
  summarizeWalletIntegrity,
  unexplainedTotals,
  type IntegritySummary,
} from "@/lib/wallet-integrity";
import { peso } from "@/lib/wavewallet";

/**
 * Read-only reconciliation check for the platform owner: compares every wallet
 * balance against its remaining ledger history, ignoring differences the
 * 12-month retention cleanup legitimately created.
 */
export function WalletIntegrityCard() {
  const [summary, setSummary] = useState<IntegritySummary | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const rows = await fetchWalletIntegrity();
      setSummary(summarizeWalletIntegrity(rows));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Integrity check failed");
    } finally {
      setBusy(false);
    }
  };

  const totals = summary ? unexplainedTotals(summary.unexplained) : null;

  return (
    <PageSection
      title="Wallet integrity"
      description="Compares every coin and points wallet against its remaining transaction history. Differences caused by the 12-month history cleanup are listed separately and are expected."
    >
      <Card>
        <CardContent className="space-y-4 pt-6">
          <Button onClick={run} disabled={busy} className="w-full sm:w-auto">
            {busy ? "Checking…" : "Run integrity check"}
          </Button>

          {!summary ? (
            <EmptyState
              title="Not run yet"
              description="Run the check to reconcile wallet balances against ledger history."
            />
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={summary.ok ? "success" : "danger"}>
                  {summary.ok ? "Reconciled" : "Attention needed"}
                </StatusBadge>
                <span className="text-sm text-muted-foreground">
                  {integrityHeadline(summary)} {summary.checked} wallet
                  {summary.checked === 1 ? "" : "s"} checked.
                </span>
              </div>

              {totals && !summary.ok && (
                <p className="text-sm">
                  Unaccounted: <span className="font-medium">{peso(totals.credits)}</span> credits,{" "}
                  <span className="font-medium">{totals.points}</span> points.
                </p>
              )}

              {summary.unexplained.length > 0 && (
                <ul className="space-y-2">
                  {summary.unexplained.slice(0, 25).map((r) => (
                    <li
                      key={`${r.kind}-${r.account_id}`}
                      className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm"
                    >
                      <p className="font-medium">{r.member_name ?? r.user_id}</p>
                      <p className="text-muted-foreground">
                        {r.kind === "points" ? "Points" : "Coins"} wallet · balance {r.balance} vs history{" "}
                        {r.ledger_sum} (difference {r.difference})
                      </p>
                    </li>
                  ))}
                </ul>
              )}

              {summary.explained.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {summary.explained.length} wallet{summary.explained.length === 1 ? "" : "s"} differ only because
                  history older than 12 months was cleaned up. Balances were preserved by design.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </PageSection>
  );
}
