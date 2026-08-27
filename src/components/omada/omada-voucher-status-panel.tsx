/**
 * Voucher Status Checker.
 *
 * The hotspot controller stays authoritative for status, usage, remaining
 * time/data and device information; this panel only translates it into plain
 * words. Raw controller fields (ids, byte and second counters, internal limits)
 * are never shown. Every device authorized by the voucher is listed separately
 * with its own Tracer, a free-form label anyone may set for operational
 * tracking by any member of that shop. A code that does not exist reads "Voucher not found"; a controller
 * problem reads as a controller problem — never as a missing voucher.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { lookupOmadaVoucher, type OmadaVoucherStatus } from "@/lib/omada-vouchers.functions";
import type { VoucherDeviceView } from "@/lib/omada-voucher-view";
import {
  fetchVoucherTracers,
  primaryTracer,
  saveVoucherTracer,
  tracerHistory,
  type TracerRecord,
} from "@/lib/voucher-tracers";

const stateTone: Record<string, string> = {
  unused: "bg-primary/10 text-primary border-primary/30",
  in_use: "bg-success/10 text-success border-success/30",
  expired: "bg-destructive/10 text-destructive border-destructive/30",
};

function Detail({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="break-words text-sm font-medium">{value}</dd>
    </div>
  );
}

function DeviceCard({
  device,
  index,
  records,
  onSave,
}: {
  device: VoucherDeviceView;
  index: number;
  records: TracerRecord[];
  onSave: (mac: string, tracer: string) => Promise<void>;
}) {
  const current = primaryTracer(records, device.mac);
  const history = tracerHistory(records, device.mac);
  const [tracer, setTracer] = useState(current?.tracer ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setTracer(current?.tracer ?? "");
  }, [current?.tracer]);

  const save = async () => {
    if (!device.mac || !tracer.trim()) return;
    setBusy(true);
    try {
      await onSave(device.mac, tracer.trim());
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">{device.deviceName ?? `Device ${index + 1}`}</p>
        <Badge variant="outline" className={stateTone[device.state]}>
          {device.state === "in_use" ? "In-use" : device.state === "unused" ? "Unused" : "Expired"}
        </Badge>
      </div>

      {device.mac ? (
        <p className="text-[11px] text-muted-foreground">Device address {device.mac}</p>
      ) : null}

      <dl className="grid gap-3 sm:grid-cols-2">
        <Detail label="Price" value={device.price} />
        <Detail label="Remaining time" value={device.remainingTime} />
        <Detail label="Remaining data" value={device.remainingData} />
        <Detail label="Initially entered" value={device.startedAt} />
        <Detail label="Expires" value={device.expiresAt} />
      </dl>

      {device.mac ? (
        <div className="space-y-1.5">
          <Label htmlFor={`tracer-${device.mac}`}>Tracer</Label>
          <div className="flex flex-wrap gap-2">
            <Input
              id={`tracer-${device.mac}`}
              className="min-w-0 flex-1"
              placeholder="Name or note for tracking"
              value={tracer}
              maxLength={80}
              onChange={(e) => setTracer(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void save();
              }}
            />
            <Button
              size="sm"
              variant="secondary"
              disabled={busy || !tracer.trim() || tracer.trim() === current?.tracer}
              onClick={() => void save()}
            >
              {busy ? "Saving…" : "Save"}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            A tracking label only — it is not a verified identity.
          </p>
          {history.length > 0 ? (
            <details className="text-[11px] text-muted-foreground">
              <summary className="cursor-pointer">Previous tracers ({history.length})</summary>
              <ul className="mt-1 space-y-0.5">
                {history.map((h) => (
                  <li key={h.id}>
                    {h.tracer} — {new Date(h.recorded_at).toLocaleString()}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Notice({ tone, children }: { tone: "muted" | "warn"; children: React.ReactNode }) {
  return (
    <p
      className={
        tone === "warn"
          ? "break-words rounded-md border border-destructive/40 p-3 text-xs text-destructive"
          : "break-words rounded-md border p-3 text-xs text-muted-foreground"
      }
    >
      {children}
    </p>
  );
}

export function OmadaVoucherStatusPanel({
  ecosystemId,
}: {
  /** The shop whose controller is searched. Members of this shop only. */
  ecosystemId?: string | null;
}) {
  const [state, setState] = useState<OmadaVoucherStatus | null>(null);
  const [records, setRecords] = useState<TracerRecord[]>([]);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const check = useCallback(
    async (searchCode?: string) => {
      if (!ecosystemId) return null;
      return lookupOmadaVoucher({ data: { ecosystemId, code: searchCode } });
    },
    [ecosystemId],
  );

  useEffect(() => {
    void check()
      .then((next) => setState(next))
      .catch(() => setState(null));
  }, [check]);

  const loadTracers = useCallback(
    async (voucherCode: string, shopId: string | null) => {
      if (!shopId) return;
      try {
        setRecords(await fetchVoucherTracers(shopId, voucherCode));
      } catch {
        setRecords([]);
      }
    },
    [],
  );

  if (!ecosystemId) return null;

  if (!state) {
    return (
      <Card className="shadow-[var(--shadow-card)]">
        <CardContent className="p-4 text-sm text-muted-foreground">Loading…</CardContent>
      </Card>
    );
  }

  if (!state.configured) {
    return (
      <Card className="shadow-[var(--shadow-card)]">
        <CardContent className="p-4 text-sm text-muted-foreground">
          This shop has not connected a hotspot controller yet, so voucher status is not available.
        </CardContent>
      </Card>
    );
  }

  const search = async () => {
    if (!code.trim()) return;
    setBusy(true);
    try {
      const next = await check(code);
      if (!next) return;
      setState(next);
      if (next.outcome === "found" || next.sessions.length > 0) {
        await loadTracers(code.trim(), ecosystemId);
      } else {
        setRecords([]);
      }
    } catch (e) {
      toast.error("Could not check that voucher", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const onSaveTracer = async (mac: string, tracer: string) => {
    const shopId = ecosystemId;
    if (!shopId) return;
    const voucherCode = state.view?.code ?? code.trim();
    try {
      const result = await saveVoucherTracer({
        ecosystemId: shopId,
        voucherCode,
        deviceMac: mac,
        tracer,
      });
      if (result.outcome === "conflict") {
        toast.warning("This device already has a different tracer", {
          description: `Kept "${result.existing}" as the current label and notified the shop admin to decide.`,
        });
      } else if (result.outcome === "recorded") {
        toast.success("Tracer saved");
      }
      await loadTracers(voucherCode, shopId);
    } catch (e) {
      toast.error("Could not save the tracer", { description: (e as Error).message });
    }
  };

  const view = state.view;
  const currentMacs = new Set(
    (view?.devices ?? []).map((d) => d.mac).filter((m): m is string => Boolean(m)),
  );
  // Past use. Omada 6.2.14.11's Open API does not link past clients back to a
  // voucher, so this is WaveWallet's own recorded observations plus any device
  // this shop labelled earlier — never invented controller history.
  const past = pastSessions(state.sessions);
  const pastMacs = new Set(past.map((s) => s.deviceMac));
  const labelledOnlyMacs = Array.from(
    new Set(
      records
        .map((r) => r.device_mac)
        .filter((m) => m && !currentMacs.has(m) && !pastMacs.has(m.toUpperCase())),
    ),
  );
  const hasPast = past.length > 0 || labelledOnlyMacs.length > 0;

  return (
    <Card className="shadow-[var(--shadow-card)]">
      <CardHeader>
        <CardTitle className="text-sm">Voucher status checker</CardTitle>
        <CardDescription>Search a voucher code to see its current status.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="omadaVoucherCode">Voucher code</Label>
          <div className="flex flex-wrap gap-2">
            <Input
              id="omadaVoucherCode"
              className="min-w-0 flex-1"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void search();
              }}
            />
            <Button size="sm" disabled={busy || !code.trim()} onClick={() => void search()}>
              {busy ? "Checking…" : "Check"}
            </Button>
          </div>
        </div>

        {state.outcome === "not_found" ? (
          <Notice tone="muted">
            Voucher not found. No voucher with that code exists on this shop's hotspot controller.
          </Notice>
        ) : null}
        {state.outcome === "invalid" ? (
          <Notice tone="muted">{state.error}</Notice>
        ) : null}
        {state.outcome === "unavailable" ||
        state.outcome === "authentication_failed" ||
        state.outcome === "status_unreadable" ? (
          <Notice tone="warn">
            {state.error} This does not mean the voucher is invalid — the status simply could not be
            read right now.
          </Notice>
        ) : null}

        {view ? (
          <div className="space-y-3">
            <div
              className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border p-4 ${stateTone[view.state]}`}
            >
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wide opacity-80">Voucher {view.code}</p>
                <p className="text-2xl font-bold">{view.stateLabel}</p>
              </div>
              {view.price ? <p className="text-sm font-semibold">{view.price}</p> : null}
            </div>

            {view.state === "unused" ? (
              <p className="text-xs text-muted-foreground">
                This voucher has not been used yet, so no device is connected to it.
              </p>
            ) : (
              <div className="space-y-3">
                <dl className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
                  <Detail label="Data used" value={view.dataUsed} />
                  <Detail label="Time used" value={view.timeUsed} />
                  <Detail label="Remaining time" value={view.remainingTime} />
                  <Detail label="Remaining data" value={view.remainingData} />
                  <Detail label="Initially entered" value={view.startedAt} />
                  <Detail label="Expires" value={view.expiresAt} />
                </dl>
                <p className="text-[11px] text-muted-foreground">
                  These totals are the voucher's own usage as counted by the hotspot controller,
                  not one device's usage.
                </p>

                {view.devices.map((device, i) => (
                  <DeviceCard
                    key={device.mac ?? i}
                    device={device}
                    index={i}
                    records={records}
                    onSave={onSaveTracer}
                  />
                ))}

                {previousMacs.length > 0 ? (
                  <div className="space-y-3">
                    <p className="text-xs font-medium">Devices recorded earlier</p>
                    <p className="text-[11px] text-muted-foreground">
                      These devices were seen on this voucher before and are no longer connected.
                      The hotspot controller does not keep a device-by-device history for a
                      voucher, so no per-device usage is available for them.
                    </p>
                    {previousMacs.map((mac, i) => (
                      <DeviceCard
                        key={mac}
                        device={{
                          mac,
                          deviceName: null,
                          state: view.state,
                          remainingTime: null,
                          remainingData: null,
                          startedAt: null,
                          expiresAt: null,
                          price: null,
                        }}
                        index={view.devices.length + i}
                        records={records}
                        onSave={onSaveTracer}
                      />
                    ))}
                  </div>
                ) : null}

                {view.devices.length === 0 && previousMacs.length === 0 ? (
                  <Notice tone="muted">
                    No device is connected to this voucher right now, and this shop has no earlier
                    device record for it. The voucher's own usage is shown above.
                  </Notice>
                ) : null}
              </div>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
