/**
 * Legacy-shop control: use the platform receiving accounts for customer cash in
 * instead of this shop's own listener payment methods.
 *
 * This is a switch, not a second payment-options editor — no account can be
 * created or edited here, and no other shop's configuration is ever shown.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  DEFAULT_PLATFORM_PAYMENT_OPTION,
  fetchPlatformPaymentOption,
  setPlatformPaymentOption,
  type PlatformPaymentOption,
} from "@/lib/platform-payment-option";

export function PlatformPaymentOptionCard({ ecosystemId }: { ecosystemId: string | null }) {
  const [state, setState] = useState<PlatformPaymentOption>(DEFAULT_PLATFORM_PAYMENT_OPTION);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const s = await fetchPlatformPaymentOption(ecosystemId);
    setState(s);
    setLoaded(true);
  }, [ecosystemId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Nothing to show for a shop that can neither use nor change the exception.
  if (!ecosystemId || !loaded || (!state.legacy && !state.enabled && !state.canChange)) return null;

  const toggle = async (next: boolean) => {
    setSaving(true);
    try {
      const saved = await setPlatformPaymentOption(ecosystemId, next);
      setState((s) => ({ ...s, enabled: saved }));
      toast.success(
        saved
          ? "Members will now pay into the platform receiving accounts."
          : "Members will now pay into this shop's own receiving accounts.",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not change that setting.");
      await load();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="shadow-[var(--shadow-card)]">
      <CardHeader>
        <CardTitle className="text-sm">Use platform payment methods for customer cash in</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="use-platform-pm" className="font-normal text-muted-foreground">
            {state.enabled
              ? "On — your members see WaveWallet's platform receiving accounts."
              : "Off — your members see the receiving accounts you configured above."}
          </Label>
          <Switch
            id="use-platform-pm"
            checked={state.enabled}
            disabled={saving || !state.canChange}
            onCheckedChange={(v) => void toggle(v)}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Legacy shops may keep paying into the platform account instead of configuring their own. This changes only
          what members see on Cash In — it never affects your own subscription payment to WaveWallet, and cash in
          matching, receipt checks and duplicate reference protection are unchanged.
        </p>
        {!state.canChange ? (
          <p className="text-xs text-muted-foreground">
            {state.legacy
              ? "Only a shop admin or the platform owner can change this."
              : "This shop is a Subscription Shop, so only the platform owner may authorise the platform accounts."}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
