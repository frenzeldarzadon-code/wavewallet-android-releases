/**
 * Super Admin-only launcher for the integrated native GCash listener screen.
 *
 * This button is rendered exclusively on `/super/settings`, which is behind the
 * `super_admin` session guard, so shop admins, resellers and customers never
 * see it. On the web it explains where the screen lives; inside the WaveWallet
 * Android app it calls the argument-less `WaveWalletNative.openGcashListener()`
 * bridge, which starts the `exported=false` ListenerActivity.
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
        description: "Open it from the WaveWallet Android app, signed in as Super Admin.",
      });
    }
  };

  return (
    <Card className="shadow-[var(--shadow-card)]">
      <CardHeader>
        <CardTitle className="text-sm">Listener device screen (Super Admin only)</CardTitle>
        <p className="text-sm text-muted-foreground">
          The GCash notification listener now ships inside the WaveWallet Android app. This screen
          shows Notification Access, connection and pairing status, the last notification read, the
          parser result, the recovery sweep and the heartbeat — and it is only reachable from here.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        <Button onClick={open} disabled={!inApp}>
          <Smartphone className="mr-2 h-4 w-4" />
          Open listener screen
        </Button>
        {inApp ? null : (
          <p className="text-xs text-muted-foreground">
            Available inside the WaveWallet Android app. Open this page in the app on the paired
            phone, signed in as Super Admin, then tap the button.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
