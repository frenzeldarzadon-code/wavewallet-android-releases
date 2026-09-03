/**
 * R6 — cash-on-delivery configuration for one shop's admin.
 *
 * The delivery fee is a flat amount added to the customer's cash total and is
 * never subject to the 1 % platform fee. The split between delivery person and
 * collector must total exactly 100 %. Both values are snapshotted onto each
 * order when it is placed, so changing them here never alters a past order.
 */
import { Loader2, Truck, Wallet } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { PageSection, StatusBadge } from "@/components/ui-kit";
import { useSession } from "@/lib/session";
import { fetchCreditBalance } from "@/lib/wallet";
import { peso } from "@/lib/wavewallet";
import { DEFAULT_STORE_SETTINGS, fetchStoreSettings, saveDeliverySettings, type StoreSettings } from "@/lib/retail";
import { splitDeliveryFee, splitProblem } from "@/lib/retail-cod";

export function DeliverySettingsCard({ ecosystemId }: { ecosystemId: string | null }) {
  const { account } = useSession();
  const [s, setS] = useState<StoreSettings>(DEFAULT_STORE_SETTINGS);
  const [available, setAvailable] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!ecosystemId) return;
    setLoading(true);
    try {
      const [settings, bal] = await Promise.all([
        fetchStoreSettings(ecosystemId),
        account ? fetchCreditBalance(account.id, null) : Promise.resolve(null),
      ]);
      setS(settings);
      setAvailable(bal);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [ecosystemId, account]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!ecosystemId) return null;

  const problem = splitProblem(s.deliveryPct, s.collectorPct);
  const preview = splitDeliveryFee(s.deliveryFee, s.deliveryPct);

  const save = async () => {
    if (problem) {
      toast.error(problem);
      return;
    }
    setBusy(true);
    try {
      await saveDeliverySettings(ecosystemId, s);
      toast.success("Delivery settings saved", {
        description: "New orders use these values; existing orders keep the split they were placed with.",
      });
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageSection
      devSlot="delivery-settings-card.cod"
      title="Cash on delivery"
      description="A collector floats the customer's cash total in Universe Coins; the delivery fee is split between the delivery person and the collector."
    >
      <Card className="shadow-[var(--shadow-card)]">
        <CardContent className="space-y-3">
          {loading ? (
            <p className="text-xs text-muted-foreground">Loading delivery settings…</p>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5">
                <div className="min-w-0">
                  <Label htmlFor="cod-enabled" className="text-sm">
                    Offer cash on delivery
                  </Label>
                  <p className="text-[11px] text-muted-foreground">
                    Universe shops only. Requires delivery to be enabled above.
                  </p>
                </div>
                <Switch
                  id="cod-enabled"
                  checked={s.codEnabled}
                  onCheckedChange={(v) => setS({ ...s, codEnabled: v })}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="delivery-fee">Delivery fee (₱, flat per order)</Label>
                <Input
                  id="delivery-fee"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={s.deliveryFee}
                  onChange={(e) => setS({ ...s, deliveryFee: Math.max(0, Number(e.target.value) || 0) })}
                />
                <p className="text-[11px] text-muted-foreground">
                  Added to the customer's cash total. The 1 % platform fee applies to product prices only — never to
                  this fee.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="split-delivery">Delivery person %</Label>
                  <Input
                    id="split-delivery"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={100}
                    value={s.deliveryPct}
                    onChange={(e) => {
                      const d = Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0)));
                      setS({ ...s, deliveryPct: d, collectorPct: 100 - d });
                    }}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="split-collector">Collector %</Label>
                  <Input
                    id="split-collector"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={100}
                    value={s.collectorPct}
                    onChange={(e) => {
                      const c = Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0)));
                      setS({ ...s, collectorPct: c, deliveryPct: 100 - c });
                    }}
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <StatusBadge tone={problem ? "danger" : "success"}>
                  {problem ? problem : `Split totals 100 %`}
                </StatusBadge>
                {s.deliveryFee > 0 && !problem ? (
                  <span className="text-muted-foreground">
                    On {peso(s.deliveryFee)}: delivery {peso(preview.delivery)} · collector {peso(preview.collector)}
                  </span>
                ) : null}
              </div>

              <div className="rounded-xl border border-border bg-muted/40 px-3 py-2.5 text-xs">
                <p className="flex items-center gap-1.5 font-medium">
                  <Wallet className="size-3.5 text-primary" /> Seller-side requirement
                </p>
                <p className="mt-1 text-muted-foreground">
                  COD is offered on an order only when the shop's settlement wallet holds at least that order's
                  embedded platform fee in <strong>available</strong> Universe Coins (e.g. Seller's Cut ₱100 →
                  Retail Price ₱101 → ₱1 required). The customer is never charged coins.
                </p>
                {available !== null ? (
                  <p className="mt-1 text-muted-foreground">
                    Your available Universe Coins right now: <strong>{peso(available)}</strong>
                  </p>
                ) : null}
              </div>

              <Button className="w-full" onClick={() => void save()} disabled={busy || !!problem}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Truck className="size-4" />}
                Save delivery settings
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </PageSection>
  );
}
