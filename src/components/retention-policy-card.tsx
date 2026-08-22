import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageSection } from "@/components/ui-kit";
import { toast } from "sonner";
import {
  RETENTION_FLAGGED_LABELS,
  RETENTION_MONTHS,
  RETENTION_PURGED_LABELS,
  fetchRetentionRuns,
  runRetentionPurge,
  type RetentionRun,
} from "@/lib/retention";

function CountList({
  counts,
  labels,
}: {
  counts: Record<string, number>;
  labels: Record<string, string>;
}) {
  const entries = Object.entries(counts).filter(([, n]) => Number(n) > 0);
  if (entries.length === 0) return <span className="text-muted-foreground">none</span>;
  return (
    <span>
      {entries.map(([k, n]) => `${labels[k] ?? k}: ${n}`).join(" · ")}
    </span>
  );
}

export function RetentionPolicyCard({ canRun = false }: { canRun?: boolean }) {
  const [runs, setRuns] = useState<RetentionRun[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    fetchRetentionRuns(5)
      .then(setRuns)
      .catch(() => setRuns([]));
  };
  useEffect(load, []);

  const last = runs?.[0];

  const trigger = async (dryRun: boolean) => {
    setBusy(true);
    try {
      const run = await runRetentionPurge(dryRun);
      if (run.status === "failed") {
        toast.error("Cleanup failed", { description: run.error ?? "Unknown error" });
      } else {
        toast.success(dryRun ? "Preview complete" : "Cleanup complete");
      }
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageSection devSlot="retention-policy-card.transaction-history-retention"
      title="Transaction history retention"
      description={`Operational history is kept for ${RETENTION_MONTHS} months. This policy is fixed platform-wide.`}
    >
      <Card className="shadow-[var(--shadow-card)]">
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
            Fixed {RETENTION_MONTHS}-month policy
            <Badge variant="secondary">Runs daily</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-xs text-muted-foreground">
          <p>
            Every day the system removes records older than {RETENTION_MONTHS} months: wallet
            credit history, points history, voucher sales and sold codes, credit-back breakdowns,
            spent credit sources, voucher import batches and settled reward redemptions.
          </p>
          <p>
            <span className="text-success font-medium">Never removed:</span> balances, active
            users, shop settings, product and reward definitions, unused voucher stock, pending
            redemptions, current subscription status, and anything inside the retention window.
          </p>
          <p>
            <span className="text-destructive font-medium">Flagged, not deleted:</span> audit log
            entries, subscription payment records and operator invitations are kept for possible
            legal or accounting obligations and only reported for review.
          </p>

          <div className="rounded-lg border p-3 text-[11px] leading-relaxed">
            {runs === null ? (
              <span>Loading cleanup history…</span>
            ) : !last ? (
              <span>No cleanup has run yet.</span>
            ) : (
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={last.status === "failed" ? "destructive" : "secondary"}>
                    {last.status}
                  </Badge>
                  <span>
                    Last run {new Date(last.started_at).toLocaleString()}
                    {last.dry_run ? " (preview)" : ""}
                  </span>
                </div>
                <div>
                  Removed: <CountList counts={last.deleted} labels={RETENTION_PURGED_LABELS} />
                </div>
                <div>
                  Flagged for review:{" "}
                  <CountList counts={last.flagged} labels={RETENTION_FLAGGED_LABELS} />
                </div>
                {last.error ? (
                  <p className="text-destructive break-words">Error: {last.error}</p>
                ) : null}
              </div>
            )}
          </div>

          {canRun ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={busy} onClick={() => trigger(true)}>
                Preview cleanup
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => trigger(false)}>
                {busy ? "Working…" : "Run cleanup now"}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </PageSection>
  );
}
