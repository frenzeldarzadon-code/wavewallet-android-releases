/**
 * Per-shop Omada controller health.
 *
 * Shows only this shop's own controller state. The backend checks the
 * controller on a schedule with bounded backoff and re-establishes the API
 * session by itself when the controller comes back — the admin never has to
 * reconnect manually for a transient outage.
 */
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui-kit";
import { useVisiblePoll } from "@/hooks/use-visible-poll";
import { getOmadaHealth, setOmadaMonitoring, type OmadaHealthView } from "@/lib/omada.functions";

const LABEL: Record<OmadaHealthView["state"], string> = {
  healthy: "Healthy",
  degraded: "Reachable, site not visible",
  unreachable: "Offline / unreachable",
  auth_failed: "Authentication failed",
  unknown: "Not checked yet",
};

function tone(state: OmadaHealthView["state"]) {
  if (state === "healthy") return "success" as const;
  if (state === "degraded") return "warning" as const;
  if (state === "unknown") return "muted" as const;
  return "danger" as const;
}

function when(value: string | null) {
  return value ? new Date(value).toLocaleString() : "—";
}

export function OmadaHealthCard({ ecosystemId }: { ecosystemId: string | null }) {
  const [health, setHealth] = useState<OmadaHealthView | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (force = false) => {
      if (!ecosystemId) return;
      try {
        setHealth(await getOmadaHealth({ data: { ecosystemId, force } }));
      } catch {
        setHealth(null);
      }
    },
    [ecosystemId],
  );

  // Re-runs as soon as the active shop is known (it is null on the first
  // renders while the session loads) and again after an in-place shop change.
  useVisiblePoll(() => void load(), 60_000, ecosystemId);

  if (!ecosystemId || !health?.configured) return null;

  const checkNow = async () => {
    setBusy(true);
    try {
      const next = await getOmadaHealth({ data: { ecosystemId, force: true } });
      setHealth(next);
      if (next.state === "healthy") toast.success("Your Omada controller is healthy.");
      else toast.error(LABEL[next.state], { description: next.reason ?? undefined });
    } catch (e) {
      toast.error("Health check failed", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const toggleMonitoring = async () => {
    setBusy(true);
    try {
      await setOmadaMonitoring({ data: { ecosystemId, enabled: !health.monitoringEnabled } });
      await load();
    } catch (e) {
      toast.error("Could not update monitoring", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="shadow-[var(--shadow-card)]">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3 text-sm">
          <span>Omada health</span>
          <StatusBadge tone={tone(health.state)}>{LABEL[health.state]}</StatusBadge>
        </CardTitle>
        <CardDescription>
          WaveWallet checks your controller automatically and reconnects on its own once it
          answers again. Your vouchers, Coins and sales in WaveWallet keep working normally even
          while your controller is offline.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {health.offlineTooLong ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs">
            <p className="font-medium text-destructive">
              Your Omada controller has been unreachable since {when(health.offlineSince)}.
            </p>
            <p className="mt-1 text-muted-foreground">
              WaveWallet keeps retrying automatically, but it cannot restart your controller.
              Restarting the Omada service needs server-level access on the machine that runs it.
            </p>
          </div>
        ) : null}

        {health.state === "auth_failed" ? (
          <p className="rounded-md border p-3 text-xs text-muted-foreground">
            Retrying will not help here: the credentials were rejected. Update your Client ID or
            Client Secret above.
          </p>
        ) : null}

        <dl className="grid gap-2 text-xs sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Last successful check</dt>
            <dd>{when(health.lastSuccessAt)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Last check</dt>
            <dd>{when(health.lastCheckedAt)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Last failure</dt>
            <dd>{when(health.lastFailureAt)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Recovered at</dt>
            <dd>{when(health.lastRecoveredAt)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Failures in a row</dt>
            <dd>{health.consecutiveFailures}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Next automatic check</dt>
            <dd>{health.monitoringEnabled ? when(health.nextCheckAt) : "Monitoring paused"}</dd>
          </div>
        </dl>

        {health.lastFailureReason ? (
          <p className="break-words rounded-md border p-3 text-xs text-muted-foreground">
            {health.lastFailureReason}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void checkNow()}>
            {busy ? "Checking…" : "Check now"}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void toggleMonitoring()}>
            {health.monitoringEnabled ? "Pause monitoring" : "Resume monitoring"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
