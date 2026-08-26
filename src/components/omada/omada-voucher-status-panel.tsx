/**
 * Read-only voucher status for one shop's own Omada controller.
 *
 * Available to any member of that shop. It never exposes credentials, the
 * controller address or tokens — the server does the lookup and returns only
 * the voucher's own details.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { lookupOmadaVoucher, type OmadaVoucherStatus } from "@/lib/omada-vouchers.functions";

function pretty(name: string) {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
}

export function OmadaVoucherStatusPanel({ ecosystemId }: { ecosystemId: string | null }) {
  const [state, setState] = useState<OmadaVoucherStatus | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!ecosystemId) return;
    void lookupOmadaVoucher({ data: { ecosystemId } })
      .then(setState)
      .catch(() => setState(null));
  }, [ecosystemId]);

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
          This shop has not connected an Omada controller yet, so voucher status is not available.
          Ask your shop admin to connect Omada.
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
       if (next.outcome === "not_found") toast.info("No voucher with that code was found on Omada.");
    } catch (e) {
      toast.error("Could not check that voucher", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="shadow-[var(--shadow-card)]">
      <CardHeader>
        <CardTitle className="text-sm">Voucher status</CardTitle>
        <CardDescription>
          Check a voucher code against this shop's Omada controller.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
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

        {state.found ? (
          <dl className="grid gap-2 rounded-md border p-3 text-xs sm:grid-cols-2">
            {Object.entries(state.found).map(([key, value]) => (
              <div key={key} className="min-w-0">
                <dt className="text-muted-foreground">{pretty(key)}</dt>
                <dd className="break-words font-medium">{value === null ? "—" : String(value)}</dd>
              </div>
            ))}
          </dl>
        ) : state.outcome === "not_found" ? (
          <p className="text-xs text-muted-foreground">
            No voucher with that code was found on this shop's Omada controller.
          </p>
        ) : null}

        {state.groups.length > 0 ? (
          <p className="text-[11px] text-muted-foreground">
            Searching {state.groups.length} voucher group{state.groups.length === 1 ? "" : "s"} on
            this shop's controller.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
