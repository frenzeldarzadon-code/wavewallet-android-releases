/**
 * Public "Get the ONE WAVE App" page.
 *
 * Anonymous and shareable: it reads the official release metadata the platform
 * owner publishes and offers the signed Android APK plus the web/PWA option.
 * No wallet, Coin, ledger or account action can be reached from here.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { Suspense, lazy, useEffect, useState } from "react";

const QRCodeSVG = lazy(() => import("qrcode.react").then((m) => ({ default: m.QRCodeSVG })));

import {
  Apple,
  CheckCircle2,
  Download,
  Globe,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui-kit";
import { InstallAppCard } from "@/components/install-app-card";
import {
  fetchAppRelease,
  formatFileSize,
  isDownloadable,
  recordAppDownload,
  type AppRelease,
} from "@/lib/app-release";
import logo from "@/assets/wavewallet-logo.webp";

const SITE = "https://wallet.sagadawave.com";
const URL = `${SITE}/download`;
const OG_IMAGE = `${SITE}/og-wavewallet.jpg`;
const TITLE = "Download the ONE WAVE App — official Android APK";
const DESCRIPTION =
  "Get the official ONE WAVE Android app as a direct APK download, or use ONE WAVE in your browser. No Play Store needed. iPhone and iPad users can install the web app.";

export const Route = createFileRoute("/download")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:url", content: URL },
      { property: "og:site_name", content: "ONE WAVE" },
      { property: "og:image", content: OG_IMAGE },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: OG_IMAGE },
    ],
    links: [{ rel: "canonical", href: URL }],
  }),
  component: DownloadPage,
});

const STEPS = [
  "Tap “Download ONE WAVE for Android”. The APK saves to your Downloads folder.",
  "Open the downloaded file.",
  "If Android asks, allow installing apps from this source, then go back.",
  "Tap Install and wait a few seconds.",
  "Open ONE WAVE and sign in with your usual account.",
];

function DownloadPage() {
  const [release, setRelease] = useState<AppRelease | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void fetchAppRelease()
      .then(setRelease)
      .finally(() => setLoading(false));
  }, []);

  const ready = isDownloadable(release);
  const size = formatFileSize(release?.android_size_bytes);

  return (
    <div className="min-h-screen bg-app">
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/guide" className="flex items-center gap-2">
            <img src={logo} alt="ONE WAVE" width={32} height={32} className="size-8" />
            <span className="text-sm font-semibold tracking-tight">ONE WAVE</span>
          </Link>
          <Button asChild size="sm" variant="ghost">
            <Link to="/">Sign in</Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-4 py-8">
        <section className="text-center">
          <StatusBadge tone="brand">Official ONE WAVE app</StatusBadge>
          <h1 className="mt-3 text-3xl font-semibold leading-tight tracking-tight">
            Get the ONE WAVE app
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
            The official ONE WAVE Android app installs directly from this site — no Play Store
            needed. It uses the same account, the same shops and the same Coins as the website.
          </p>
        </section>

        {/* Version card */}
        <Card className="mt-6 overflow-hidden shadow-[var(--shadow-card)]">
          <div className="bg-primary/10 px-5 py-4">
            <div className="flex items-center gap-3">
              <img src={logo} alt="" width={44} height={44} className="size-11 rounded-xl" />
              <div>
                <h2 className="text-base font-semibold tracking-tight">ONE WAVE Android</h2>
                <p className="text-xs text-muted-foreground">
                  {loading
                    ? "Checking the latest release…"
                    : ready
                      ? `Official APK${release?.android_version ? ` · Version ${release.android_version}` : ""}`
                      : "The Android app is being prepared"}
                </p>
              </div>
            </div>
          </div>
          <CardContent className="space-y-4 px-5 py-5">
            <div className="flex flex-wrap gap-2 text-xs">
              {release?.android_version ? <Chip>Version {release.android_version}</Chip> : null}
              <Chip>{release?.android_min_os || "Android 7.0+"}</Chip>
              {size ? <Chip>{size}</Chip> : null}
              {release?.android_release_date ? (
                <Chip>Released {release.android_release_date}</Chip>
              ) : null}
              <Chip>Official APK</Chip>
            </div>

            {release?.android_release_notes ? (
              <p className="text-sm leading-relaxed text-muted-foreground">
                {release.android_release_notes}
              </p>
            ) : null}

            {ready ? (
              <Button
                asChild
                size="lg"
                className="w-full"
                onClick={() => void recordAppDownload()}
              >
                <a href={release!.android_download_url} rel="noopener">
                  <Download className="size-4" /> Download ONE WAVE for Android
                </a>
              </Button>
            ) : (
              <p className="rounded-lg border border-dashed px-3 py-3 text-sm text-muted-foreground">
                {loading
                  ? "Loading the official release…"
                  : "The Android download is not published yet. You can use ONE WAVE in your browser right now — see “Use ONE WAVE on the web” below."}
              </p>
            )}

            <p className="text-xs text-muted-foreground">
              Only download ONE WAVE from <strong>wallet.sagadawave.com</strong>. Files shared in
              chat groups or on other sites are not official and may be unsafe.
            </p>
          </CardContent>
        </Card>

        {/* QR to this page */}
        <Card className="mt-4 shadow-[var(--shadow-card)]">
          <CardContent className="flex flex-col items-center gap-4 px-5 py-5 sm:flex-row">
            <div className="rounded-xl bg-white p-3">
              <Suspense fallback={<div className="size-[116px]" />}>
                <QRCodeSVG value={URL} size={116} />
              </Suspense>
            </div>
            <div>
              <h3 className="text-sm font-semibold tracking-tight">On a computer?</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Scan this code with your phone camera to open this same download page on your
                phone, then install from there.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Install guide */}
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-semibold tracking-tight">
            How to install on Android
          </h2>
          <Card className="shadow-[var(--shadow-card)]">
            <CardContent className="px-5 py-5">
              <ol className="space-y-2.5 text-sm">
                {STEPS.map((step, i) => (
                  <li key={step} className="flex gap-3">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                      {i + 1}
                    </span>
                    <span className="leading-relaxed text-muted-foreground">{step}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-4 text-xs text-muted-foreground">
                Android may show a warning because the app is not installed from the Play Store.
                That is normal for a direct APK — continue only if you downloaded it from this
                page.
              </p>
            </CardContent>
          </Card>
        </section>

        {/* Security */}
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-semibold tracking-tight">Safety and verification</h2>
          <Card className="shadow-[var(--shadow-card)]">
            <CardContent className="space-y-3 px-5 py-5 text-sm text-muted-foreground">
              <p className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" />
                The APK is digitally signed for ONE WAVE. Updates released later install over the
                top and keep your account and data.
              </p>
              <p className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                Your Coins, transactions and history live in your ONE WAVE account, not on the
                phone. Signing in on the app shows exactly the same balances as the website.
              </p>
              {release?.android_sha256 ? (
                <div>
                  <p className="font-medium text-foreground">SHA-256 checksum</p>
                  <p className="mt-1 break-all rounded-md bg-muted px-2 py-1.5 font-mono text-[11px]">
                    {release.android_sha256}
                  </p>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </section>

        {/* iPhone + web */}
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-semibold tracking-tight">
            iPhone, iPad and computers
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Card className="shadow-[var(--shadow-card)]">
              <CardContent className="px-5 py-5">
                <Apple className="size-5 text-primary" />
                <h3 className="mt-2 text-sm font-semibold tracking-tight">iPhone &amp; iPad</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  There is no iOS app yet. Open ONE WAVE in Safari, tap Share, then{" "}
                  <strong>Add to Home Screen</strong> — it opens full screen like an app.
                </p>
              </CardContent>
            </Card>
            <Card className="shadow-[var(--shadow-card)]">
              <CardContent className="px-5 py-5">
                <Globe className="size-5 text-primary" />
                <h3 className="mt-2 text-sm font-semibold tracking-tight">
                  Use ONE WAVE on the web
                </h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  You never have to install anything. Everything works in the browser on any phone
                  or computer.
                </p>
                <Button asChild variant="outline" size="sm" className="mt-3">
                  <Link to="/">Open ONE WAVE in the browser</Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </section>

        <section className="mt-8">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold tracking-tight">
            <Smartphone className="size-5 text-primary" /> Install the web app instead
          </h2>
          <InstallAppCard className="shadow-[var(--shadow-card)]" />
        </section>

        <p className="mt-8 text-center text-sm text-muted-foreground">
          New to ONE WAVE?{" "}
          <Link to="/guide" className="font-medium text-primary underline-offset-4 hover:underline">
            Read the guide
          </Link>
        </p>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-muted-foreground">
          <span>Official ONE WAVE download — wallet.sagadawave.com</span>
          <span>© {new Date().getFullYear()} ONE WAVE</span>
        </div>
      </footer>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border px-2.5 py-1 text-xs font-medium">{children}</span>
  );
}
