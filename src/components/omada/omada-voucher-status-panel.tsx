/**
 * Customer-facing voucher Status Checker.
 *
 * Omada stays authoritative for status, usage, remaining time/data and device
 * information; this panel only translates it into plain words. Raw controller
 * fields (ids, byte and second counters, internal limits) are never shown.
 * Each device using the voucher is listed separately with its own Tracer, a
 * free-form label anyone may set for operational tracking.
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
  unknown: "bg-muted text-muted-foreground",
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
        <p className="text-sm font-semibold">
          {device.deviceName ?? `Device ${index + 1}`}
        </p>
        <Badge variant="outline" className={stateTone[device.state]}>
          {device.state === "in_use" ? "In-use" : device.state === "unused" ? "Unused" : device.state === "expired" ? "Expired" : "Unknown"}
        </Badge>
      </div>

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

export function OmadaVoucherStatusPanel({ ecosystemId }: { ecosystemId: string | null }) {
  const [state, setState] = useState<OmadaVoucherStatus | null>(null);
  const [records, setRecords] = useState<TracerRecord[]>([]);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!ecosystemId) return;
    void lookupOmadaVoucher({ data: { ecosystemId } })
      .then(setState)
      .catch(() => setState(null));
  }, [ecosystemId]);

  const loadTracers = useCallback(
    async (voucherCode: string) => {
      if (!ecosystemId) return;
      try {
        setRecords(await fetchVoucherTracers(ecosystemId, voucherCode));
      } catch {
        setRecords([]);
      }
    },
    [ecosystemId],
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
          Ask your shop admin to set it up.
        </CardContent>
      </Card>
    );
  }

  const search = async () => {
    if (!code.trim()) return;
    setBusy(true);
    try {
      const next = await lookupOmadaVoucher({ data: { ecosystemId, code } });
      setState(next);
      if (next.outcome === "found") await loadTracers(code.trim());
      else setRecords([]);
      if (next.outcome === "not_found") toast.info("No voucher with that code was found.");
    } catch (e) {
      toast.error("Could not check that voucher", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const onSaveTracer = async (mac: string, tracer: string) => {
    try {
      const result = await saveVoucherTracer({
        ecosystemId,
        voucherCode: state.view?.code ?? code.trim(),
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
      await loadTracers(state.view?.code ?? code.trim());
    } catch (e) {
      toast.error("Could not save the tracer", { description: (e as Error).message });
    }
  };

  const view = state.view;

  return (
    <Card className="shadow-[var(--shadow-card)]">
      <CardHeader>
        <CardTitle className="text-sm">Voucher status checker</CardTitle>
        <CardDescription>Search a voucher code to see its current status.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {state.error ? (
          <p className="break-words rounded-md border border-destructive/40 p-3 text-xs text-destructive">
            {state.error}
          </p>
        ) : null}

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
                This voucher has not been used yet, so there is no device information.
              </p>
            ) : view.devices.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                The controller did not report device details for this voucher.
              </p>
            ) : (
              <div className="space-y-3">
                {view.devices.map((device, i) => (
                  <DeviceCard
                    key={device.mac ?? i}
                    device={device}
                    index={i}
                    records={records}
                    onSave={onSaveTracer}
                  />
                ))}
              </div>
            )}
          </div>
        ) : state.outcome === "not_found" ? (
          <p className="text-xs text-muted-foreground">
            No voucher with that code was found on this shop's controller.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
