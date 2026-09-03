/**
 * Launcher for the integrated native WaveWallet Payment Listener screen.
 *
 * Operating the listener is a payment-operations task: it is rendered on
 * `/super/settings` (platform owner) and on `/admin/settings`, which is behind
 * the shop-admin guard, so the phone paired for that shop can be set up by its
 * own admin. Global listener configuration stays on the Super Admin pages.
 * Inside the ONE WAVE Android app the button calls the argument-less
 * `WaveWalletNative.openGcashListener()` bridge, which starts the
 * `exported=false` ListenerActivity; the screen itself only reports the state
 * of the phone it runs on and the device it is paired to.
 */
import { useEffect, useState } from "react";
import { Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type NativeBridge = { openGcashListener?: () => boolean };

const bridge = (): NativeBridge | undefined =>
  typeof window === "undefined"
    ? undefined
    : (window as unknown as { WaveWalletNative?: NativeBridge }).WaveWalletNative;

export function ListenerDeviceScreenButton() {
  const [inApp, setInApp] = useState(false);

  useEffect(() => {
    setInApp(typeof bridge()?.openGcashListener === "function");
  }, []);

  const open = () => {
    if (bridge()?.openGcashListener?.() !== true) {
      toast.error("Could not open the listener screen", {
        description: "Open it from the ONE WAVE Android app, signed in as the admin of this shop.",
      });
    }
  };

  return (
    <Card className="shadow-[var(--shadow-card)]">
      <CardHeader>
        <CardTitle className="text-sm">Listener device screen</CardTitle>
        <p className="text-sm text-muted-foreground">
          The payment notification listener ships inside the ONE WAVE Android app. This screen
          shows Notification Access, connection and pairing status, the last notification read, the
          parser result, the recovery sweep and the heartbeat for this phone only.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        <Button onClick={open} disabled={!inApp}>
          <Smartphone className="mr-2 h-4 w-4" />
          Open listener screen
        </Button>
        {inApp ? null : (
          <p className="text-xs text-muted-foreground">
            Available inside the ONE WAVE Android app. Open this page in the app on the paired
            phone, then tap the button.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
