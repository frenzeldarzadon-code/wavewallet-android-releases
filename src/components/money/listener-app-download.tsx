/**
 * Download + install guidance for the official WaveWallet GCash Listener APK.
 *
 * The binary is the production-signed release build (package
 * com.wavewallet.gcashlistener), served from WaveWallet's own asset CDN — never
 * a GitHub artifact and never the old .debug build. This section is purely
 * informational: it does not touch pairing, matching or verification.
 */
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import apkAsset from "@/assets/wavewallet-gcash-listener.apk.asset.json";

const APK_SHA256 = "e58f845cb3ec550a91d7e68bf71eddf76f7f3405a92f7d6d2c0e91126441c9ee";
const APK_PACKAGE = "com.wavewallet.gcashlistener";

const sizeMb = (apkAsset.size / (1024 * 1024)).toFixed(2);

export function ListenerAppDownload() {
  return (
    <section className="rounded-lg border bg-muted/30 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">GCash Listener App for Admins</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            The official WaveWallet GCash Listener for Android. Install it on the phone that receives
            the GCash notifications for your shop. One physical GCash account uses one listener
            device.
          </p>
        </div>
        <Button asChild>
          <a href={apkAsset.url} download="wavewallet-gcash-listener.apk">
            <Download className="mr-2 h-4 w-4" />
            Download GCash Listener APK
          </a>
        </Button>
      </div>

      <dl className="mt-3 grid gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-3">
        <div>
          <dt>Package</dt>
          <dd className="break-all font-mono text-foreground">{APK_PACKAGE}</dd>
        </div>
        <div>
          <dt>Build</dt>
          <dd className="text-foreground">Signed release · {sizeMb} MB</dd>
        </div>
        <div className="sm:col-span-3">
          <dt>SHA-256</dt>
          <dd className="break-all font-mono text-foreground">{APK_SHA256}</dd>
        </div>
      </dl>

      <div className="mt-4 space-y-3 text-sm">
        <div>
          <p className="font-medium">Install (Android / OPPO ColorOS)</p>
          <ol className="mt-1 list-decimal space-y-1 pl-5 text-muted-foreground">
            <li>Download the APK on the listener phone and open it from the browser or Files app.</li>
            <li>
              When Android asks, allow installing apps from that browser or file manager for this
              install.
            </li>
            <li>
              If Android shows a Play Protect warning for a sideloaded app, read it and continue only
              if you trust this WaveWallet download. Keep Play Protect switched on.
            </li>
            <li>
              If ColorOS blocks a setting for the app, open Settings → Apps → Special app access (or
              App info → ⋮) and allow restricted settings for WaveWallet GCash Listener.
            </li>
          </ol>
        </div>
        <div>
          <p className="font-medium">Permissions</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
            <li>
              Grant Notification access: Settings → Notifications → Notification access (ColorOS:
              Settings → Notification &amp; status bar → Notification access) → enable WaveWallet
              GCash Listener.
            </li>
            <li>
              Allow background operation: App info → Battery usage → Unrestricted / Allow background
              activity, and disable battery optimisation for the app so it is not killed.
            </li>
            <li>Keep GCash notifications enabled and unmuted on the same phone.</li>
          </ul>
        </div>
        <div>
          <p className="font-medium">Then pair and verify</p>
          <p className="mt-1 text-muted-foreground">
            Register a device below, paste the Device ID and one-time pairing secret into the app
            with this site’s address, and confirm the device shows as online with a recent
            notification here. Only install this APK from this page — exact menu names vary by
            Android version and device.
          </p>
        </div>
      </div>
    </section>
  );
}
