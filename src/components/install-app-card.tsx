/**
 * Install WaveWallet as an app. This is the same web application in a
 * standalone window — one account, one backend, one ledger. It is not a Play
 * Store or App Store listing.
 */
import { Download, Check, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useInstallPrompt, useStandalone } from "@/lib/pwa";

export function InstallAppCard({ className }: { className?: string }) {
  const { canInstall, installed, install } = useInstallPrompt();
  const standalone = useStandalone();

  return (
    <Card className={className}>
      <CardContent className="space-y-4 px-4 py-5">
        <div className="flex items-start gap-3">
          <span className="rounded-xl bg-primary/10 p-2 text-primary">
            <Smartphone className="size-5" />
          </span>
          <div>
            <h3 className="text-base font-semibold">Install WaveWallet on your phone</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Adds a WaveWallet icon to your home screen and opens full screen, without a browser
              bar. Same login, same shops, same Coins — nothing is stored separately on the device.
            </p>
          </div>
        </div>

        {standalone || installed ? (
          <p className="flex items-center gap-2 text-sm font-medium text-success">
            <Check className="size-4" /> WaveWallet is installed on this device.
          </p>
        ) : canInstall ? (
          <Button onClick={() => void install()} className="w-full sm:w-auto">
            <Download className="size-4" /> Install app
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">
            Your browser did not offer an automatic install button. Use the manual steps below.
          </p>
        )}

        <div className="grid gap-4 text-sm sm:grid-cols-2">
          <div className="space-y-1.5">
            <p className="font-medium">Android (Chrome, Edge, Samsung Internet)</p>
            <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
              <li>Open this site in Chrome.</li>
              <li>Tap the ⋮ menu (top right).</li>
              <li>
                Tap <span className="font-medium text-foreground">Add to Home screen</span> or{" "}
                <span className="font-medium text-foreground">Install app</span>.
              </li>
              <li>Confirm — WaveWallet appears with the other apps.</li>
            </ol>
          </div>
          <div className="space-y-1.5">
            <p className="font-medium">iPhone / iPad (Safari) &amp; Windows</p>
            <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
              <li>iOS: tap Share, then Add to Home Screen.</li>
              <li>
                Windows: open in Chrome or Edge and click the install icon in the address bar (or ⋮
                → Install).
              </li>
              <li>Launch it like any other app.</li>
            </ol>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          An internet connection is required for Coin transfers, WiFi voucher purchases, cash in and
          cash out. Nothing financial is queued or processed offline.
        </p>
      </CardContent>
    </Card>
  );
}
