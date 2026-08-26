/**
 * Admin review of conflicting device tracers.
 *
 * When a device (MAC) is given a different tracer than the one already on
 * record, nothing is overwritten: both entries are kept and the shop's admin
 * decides which one is current. Earlier associations stay available with their
 * dates so a later voucher dispute can be investigated.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  fetchTracerConflicts,
  resolveTracerConflict,
  type TracerConflict,
} from "@/lib/voucher-tracers";

export function TracerConflictsPanel({ ecosystemId }: { ecosystemId: string | null }) {
  const [rows, setRows] = useState<TracerConflict[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!ecosystemId) return;
    try {
      setRows(await fetchTracerConflicts(ecosystemId));
    } catch {
      setRows([]);
    }
  }, [ecosystemId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!ecosystemId) return null;

  const groups = new Map<string, TracerConflict[]>();
  for (const row of rows ?? []) {
    groups.set(row.device_mac, [...(groups.get(row.device_mac) ?? []), row]);
  }

  const choose = async (id: string) => {
    setBusy(id);
    try {
      await resolveTracerConflict(id);
      toast.success("Current tracer set. Previous entries are kept as history.");
      await load();
    } catch (e) {
      toast.error("Could not resolve that conflict", { description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="shadow-[var(--shadow-card)]">
      <CardHeader>
        <CardTitle className="text-sm">Tracer conflicts</CardTitle>
        <CardDescription>
          The same device was labelled with different tracers. Choose the current one; the others
          stay on record for disputes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : groups.size === 0 ? (
          <p className="text-sm text-muted-foreground">No conflicting tracers right now.</p>
        ) : (
          [...groups.entries()].map(([mac, entries]) => (
            <div key={mac} className="space-y-2 rounded-lg border p-3">
              <p className="text-xs font-semibold">Device {mac}</p>
              {entries.map((entry) => (
                <div key={entry.id} className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-medium">{entry.tracer}</p>
                    <p className="text-[11px] text-muted-foreground">
                      Voucher {entry.voucher_code} · {new Date(entry.recorded_at).toLocaleString()}
                    </p>
                  </div>
                  {entry.is_primary ? (
                    <Badge variant="outline">Current</Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy === entry.id}
                      onClick={() => void choose(entry.id)}
                    >
                      Make current
                    </Button>
                  )}
                </div>
              ))}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
