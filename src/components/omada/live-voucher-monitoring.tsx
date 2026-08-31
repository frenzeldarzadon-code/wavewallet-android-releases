/**
 * Live Voucher Monitoring — the customer's board.
 *
 * "Live" means the page re-reads the shop's own hotspot controller on a timer
 * while the tab is visible; nothing is counted down locally. When the
 * controller cannot be reached the last values it reported stay on screen with
 * an explicit "Unable to refresh" notice, so a network blip never turns into
 * fake zeros.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, RefreshCw, WifiOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useVisiblePoll } from "@/hooks/use-visible-poll";
import type { MonitorCard } from "@/lib/voucher-monitoring";
import {
  addMonitoredVoucher,
  getVoucherMonitoring,
  monitorLocalUser,
  stopMonitoringVoucher,
  type LocalUserResult,
  type MonitoringSnapshot,
} from "@/lib/voucher-monitoring.functions";

const REFRESH_MS = 30_000;

const tone: Record<MonitorCard["state"], string> = {
  unused: "bg-primary/10 text-primary border-primary/30",
  in_use: "bg-success/10 text-success border-success/30",
  expired: "bg-destructive/10 text-destructive border-destructive/30",
};

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function VoucherCard({
  card,
  highlight,
  onStop,
}: {
  card: MonitorCard;
  highlight: boolean;
  onStop: (code: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  return (
    <Card className={highlight ? "border-primary shadow-sm" : undefined}>
      <CardHeader className="gap-2 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base tracking-wide">Voucher {card.masked}</CardTitle>
          <Badge variant="outline" className={tone[card.state]}>
            {card.statusLabel}
          </Badge>
        </div>
        {card.productName ? <CardDescription>{card.productName}</CardDescription> : null}
      </CardHeader>
      <CardContent className="space-y-2">
        {card.state === "unused" ? (
          <>
            <Field label={card.pausable ? "Time (pausable)" : "Time"} value={card.time} />
            <Field label="Consumable data" value={card.consumableData} />
          </>
        ) : (
          <>
            <Field label="Running time" value={card.runningTime} />
            <Field label="Remaining time" value={card.remainingTime} />
            <Field label="Data used" value={card.dataUsed} />
            <Field label="Data left" value={card.dataLeft} />
          </>
        )}

        {card.expiredReason ? (
          <p className="rounded-md bg-muted px-2.5 py-2 text-xs text-muted-foreground">
            {card.expiredReason}
          </p>
        ) : null}

        <div className="pt-1">
          {confirming ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Stop monitoring this voucher?</span>
              <Button
                size="sm"
                variant="destructive"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await onStop(card.code);
                  } finally {
                    setBusy(false);
                    setConfirming(false);
                  }
                }}
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Yes"}
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
                No
              </Button>
            </div>
          ) : (
            <button
              type="button"
              className="text-xs font-medium text-muted-foreground underline underline-offset-4 hover:text-destructive"
              onClick={() => setConfirming(true)}
            >
              Do not monitor
            </button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function LocalUserSection({ ecosystemId }: { ecosystemId: string }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<LocalUserResult | null>(null);

  const check = useCallback(async () => {
    if (!username.trim() || !password) return;
    setBusy(true);
    try {
      setResult(await monitorLocalUser({ data: { ecosystemId, username, password } }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not check that account.");
    } finally {
      setBusy(false);
    }
  }, [ecosystemId, username, password]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Local User monitoring</CardTitle>
        <CardDescription>
          Sign in with your hotspot Local User account to see what the controller reports for it.
          Your password is used for that check only and is never stored.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="lu-user">Username</Label>
            <Input
              id="lu-user"
              autoComplete="off"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lu-pass">Password</Label>
            <Input
              id="lu-pass"
              type="password"
              autoComplete="off"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        </div>
        <Button className="w-full sm:w-auto" disabled={busy} onClick={check}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Sign in
        </Button>

        {result?.error ? <p className="text-sm text-destructive">{result.error}</p> : null}
        {result?.view ? (
          <div className="space-y-2 rounded-lg border p-3">
            <Field label="Username" value={result.view.username} />
            <Field label="Expires" value={result.view.expiresAt ?? "No expiry reported"} />
            <Field label="Data remaining" value={result.view.dataRemaining} />
            {result.checkedAt ? (
              <p className="text-[11px] text-muted-foreground">
                Last updated {new Date(result.checkedAt).toLocaleTimeString()}
              </p>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function LiveVoucherMonitoring({
  ecosystemId,
  highlightCode,
}: {
  ecosystemId: string | null;
  highlightCode?: string | undefined;
}) {
  const [snapshot, setSnapshot] = useState<MonitoringSnapshot | null>(null);
  const [staleError, setStaleError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (!ecosystemId || inFlight.current) return;
    inFlight.current = true;
    try {
      const next = await getVoucherMonitoring({ data: { ecosystemId } });
      if (next.error && snapshotHasCards(next) === false && next.checkedAt === null) {
        // Controller unreachable: keep the last good values on screen.
        setStaleError(next.error);
        setSnapshot((prev) => prev ?? next);
      } else {
        setSnapshot(next);
        setStaleError(null);
        if (next.checkedAt) setLastUpdated(next.checkedAt);
      }
    } catch (e) {
      setStaleError(e instanceof Error ? e.message : "Unable to refresh.");
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [ecosystemId]);

  useVisiblePoll(() => void refresh(), REFRESH_MS, ecosystemId);

  useEffect(() => {
    if (!highlightCode) return;
    setCode("");
  }, [highlightCode]);

  const cards = snapshot?.cards ?? [];
  const empty = !loading && cards.length === 0;
  const highlight = (highlightCode ?? "").trim().toUpperCase();

  const add = async () => {
    if (!ecosystemId || !code.trim()) return;
    setBusy(true);
    try {
      await addMonitoredVoucher({ data: { ecosystemId, code } });
      setCode("");
      setAdding(false);
      await refresh();
      toast.success("Voucher added to monitoring.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add that voucher.");
    } finally {
      setBusy(false);
    }
  };

  const stop = async (target: string) => {
    if (!ecosystemId) return;
    try {
      await stopMonitoringVoucher({ data: { ecosystemId, code: target } });
      setSnapshot((prev) =>
        prev ? { ...prev, cards: prev.cards.filter((c) => c.code !== target) } : prev,
      );
      toast.success("Removed from your monitoring list.");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update your list.");
    }
  };

  const updatedLabel = useMemo(
    () => (lastUpdated ? new Date(lastUpdated).toLocaleTimeString() : null),
    [lastUpdated],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {staleError ? (
            <span className="inline-flex items-center gap-1 text-destructive">
              <WifiOff className="h-3.5 w-3.5" /> Unable to refresh
            </span>
          ) : null}
          {updatedLabel ? <span>Last updated {updatedLabel}</span> : null}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void refresh()}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
          </Button>
          <Button size="sm" onClick={() => setAdding((v) => !v)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Add Voucher
          </Button>
        </div>
      </div>

      {adding ? (
        <Card>
          <CardContent className="flex flex-wrap items-end gap-2 pt-6">
            <div className="min-w-[12rem] flex-1 space-y-1.5">
              <Label htmlFor="monitor-code">Add voucher manually</Label>
              <Input
                id="monitor-code"
                placeholder="Voucher code"
                inputMode="text"
                autoCapitalize="characters"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </div>
            <Button disabled={busy || !code.trim()} onClick={() => void add()}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Add
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">Reading the hotspot controller…</p>
      ) : null}

      {empty ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No vouchers are being monitored yet. Vouchers you buy in this shop appear here
            automatically, or add one by code.
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        {cards.map((card) => (
          <VoucherCard
            key={card.code}
            card={card}
            highlight={highlight !== "" && card.code === highlight}
            onStop={stop}
          />
        ))}
      </div>

      {snapshot && snapshot.unreadable.length > 0 && !staleError ? (
        <p className="text-xs text-muted-foreground">
          The controller did not report on {snapshot.unreadable.length} monitored code
          {snapshot.unreadable.length === 1 ? "" : "s"} in this refresh.
        </p>
      ) : null}

      {ecosystemId && snapshot?.localUserAvailable ? (
        <LocalUserSection ecosystemId={ecosystemId} />
      ) : null}
    </div>
  );
}

function snapshotHasCards(s: MonitoringSnapshot) {
  return s.cards.length > 0;
}
