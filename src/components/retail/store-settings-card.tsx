/**
 * Store configuration for one shop's admin.
 *
 * Turning a store off only hides it: its products, orders and history stay
 * exactly where they are and reappear the moment it is turned back on.
 */
import { Loader2, Store } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { PageSection } from "@/components/ui-kit";
import {
  DEFAULT_STORE_SETTINGS,
  fetchStoreSettings,
  saveStoreSettings,
  type StoreSettings,
} from "@/lib/retail";

const rows: Array<{ key: keyof StoreSettings; label: string; hint: string }> = [
  { key: "voucherEnabled", label: "Voucher store", hint: "Sell WiFi voucher codes." },
  { key: "retailEnabled", label: "Retail store", hint: "Sell physical goods." },
  { key: "cashEnabled", label: "Accept cash", hint: "Cash / cash-on-delivery for retail orders." },
  { key: "creditEnabled", label: "Accept shop credits", hint: "Pay retail orders from the shop wallet." },
  { key: "pickupEnabled", label: "Offer pickup", hint: "Customers collect at your shop." },
  { key: "deliveryEnabled", label: "Offer delivery", hint: "Door-to-door with an address." },
  {
    key: "publicStorefront",
    label: "Public storefront",
    hint: "Let visitors browse your public products and request to join.",
  },
];

export function StoreSettingsCard({ ecosystemId }: { ecosystemId: string | null }) {
  const [settings, setSettings] = useState<StoreSettings>(DEFAULT_STORE_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!ecosystemId) return;
    setLoading(true);
    try {
      setSettings(await fetchStoreSettings(ecosystemId));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [ecosystemId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!ecosystemId) return null;

  const save = async () => {
    setBusy(true);
    try {
      const { contactEmail: _ignored, ...rest } = settings;
      await saveStoreSettings(ecosystemId, rest);
      toast.success("Store settings saved");
      // The sidebar reads these flags, so refresh the console.
      window.dispatchEvent(new Event("wavewallet:session"));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageSection
      title="Stores"
      description="Choose which stores your shop offers and how customers can pay and receive orders."
    >
      <Card className="shadow-[var(--shadow-card)]">
        <CardContent className="space-y-3">
          {loading ? (
            <p className="text-xs text-muted-foreground">Loading store settings…</p>
          ) : (
            <>
              {rows.map((r) => (
                <div
                  key={r.key}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <Label htmlFor={`store-${r.key}`} className="text-sm">
                      {r.label}
                    </Label>
                    <p className="text-[11px] text-muted-foreground">{r.hint}</p>
                  </div>
                  <Switch
                    id={`store-${r.key}`}
                    checked={!!settings[r.key]}
                    onCheckedChange={(v) => setSettings({ ...settings, [r.key]: v })}
                  />
                </div>
              ))}
              {!settings.cashEnabled && !settings.creditEnabled && settings.retailEnabled ? (
                <p className="text-xs text-destructive">
                  Enable at least one payment method or customers cannot order.
                </p>
              ) : null}
              <Button className="w-full" onClick={() => void save()} disabled={busy}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Store className="size-4" />}
                Save store settings
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </PageSection>
  );
}
