/**
 * One Update Center for both layers.
 *
 * Web/PWA updates are a refresh onto the newest deployed assets. The Android
 * app is an installed APK: a web deploy can never change its native code, so
 * the only honest action is to send the user to the official download page,
 * where Android's own installer asks for permission.
 *
 * Nothing here touches wallets, Coins, vouchers or sessions.
 */
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Download, Loader2, RefreshCw, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui-kit";
import {
  applyWebUpdate,
  checkForUpdates,
  openAndroidUpdate,
  type UpdateState,
} from "@/lib/app-update";
import { WEB_BUILD_ID, WEB_VERSION } from "@/lib/update-manifest";

function timeLabel(at: number | null) {
  if (!at) return "not yet";
  return new Date(at).toLocaleString();
}

export function UpdateCenterCard({ className }: { className?: string }) {
  const [state, setState] = useState<UpdateState | null>(null);
  const [checking, setChecking] = useState(false);

  const run = useCallback(async (background: boolean) => {
    if (!background) setChecking(true);
    try {
      const next = await checkForUpdates(background ? { background: true } : {});
      if (next) setState(next);
      if (!background && next?.offline) {
        toast.error("Could not reach the update service. You can keep using ONE WAVE.");
      }
    } finally {
      if (!background) setChecking(false);
    }
  }, []);

  // One quiet check when the card is opened; never on every render.
  useEffect(() => {
    void run(true);
  }, [run]);

  const upToDate = state && !state.offline && !state.webUpdateAvailable && !state.androidUpdateAvailable;

  return (
    <Card className={className}>
      <CardContent className="space-y-4 px-4 py-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">App updates</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              The website part of ONE WAVE updates with a refresh. The Android app itself only
              changes when you install a new version from the official download page.
            </p>
          </div>
          {upToDate ? (
            <StatusBadge tone="success">Up to date</StatusBadge>
          ) : state?.offline ? (
            <StatusBadge tone="muted">Unknown</StatusBadge>
          ) : state?.webUpdateAvailable || state?.androidUpdateAvailable ? (
            <StatusBadge tone="warning">Update available</StatusBadge>
          ) : null}
        </div>

        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Current web version</dt>
            <dd className="font-medium">
              {WEB_VERSION}{" "}
              <span className="font-mono text-[11px] text-muted-foreground">{WEB_BUILD_ID}</span>
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Latest web version</dt>
            <dd className="font-medium">{state?.latestWebVersion ?? "—"}</dd>
          </div>
          {state?.native ? (
            <>
              <div>
                <dt className="text-muted-foreground">Installed Android app</dt>
                <dd className="font-medium">
                  {state.native.versionName} (build {state.native.versionCode})
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Latest Android app</dt>
                <dd className="font-medium">
                  {state.latestAndroid
                    ? `${state.latestAndroid.versionName} (build ${state.latestAndroid.versionCode})`
                    : "—"}
                </dd>
              </div>
            </>
          ) : null}
          <div className="sm:col-span-2">
            <dt className="text-muted-foreground">Last checked</dt>
            <dd className="font-medium">{timeLabel(state?.checkedAt ?? null)}</dd>
          </div>
        </dl>

        {state?.notes && (state.webUpdateAvailable || state.androidUpdateAvailable) ? (
          <p className="rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">{state.notes}</p>
        ) : null}

        {state?.androidUpdateRequired ? (
          <p className="rounded-lg bg-destructive/10 p-3 text-xs text-destructive">
            Your installed app is older than the version this shop needs — saving voucher images to
            your phone may not work until you install the new app.
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void run(false)} disabled={checking}>
            {checking ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            Check for updates
          </Button>
          {state?.webUpdateAvailable ? (
            <Button onClick={() => void applyWebUpdate()}>
              <RefreshCw className="size-4" /> Update web app
            </Button>
          ) : null}
          {state?.androidUpdateAvailable ? (
            <Button
              variant="secondary"
              onClick={() => {
                if (!openAndroidUpdate(state.androidUpdateUrl)) {
                  toast.error("Could not open the download page. Visit /download in your browser.");
                }
              }}
            >
              <Smartphone className="size-4" /> Update Android app
            </Button>
          ) : null}
        </div>

        {upToDate ? (
          <p className="flex items-center gap-2 text-xs text-success">
            <CheckCircle2 className="size-4" /> You&apos;re running the latest ONE WAVE.
          </p>
        ) : (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Download className="size-3.5" /> Updates never touch your account, balances or history.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
