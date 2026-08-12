import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowRight, FlaskConical, LogIn, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/ui-kit";
import { homeFor } from "@/lib/session";
import { loadAuthContext, signInWithPassword, type SignupEcosystem } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { DEMO_ECOSYSTEM_SLUG, DEMO_ROLES, isPreviewEnvironment } from "@/lib/demo";
import { startDemoSession } from "@/lib/demo.functions";
import { platformSettings } from "@/lib/wavewallet";
import { superAdminSetupAvailable } from "@/lib/bootstrap.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "WaveWallet — Voucher & Wallet Platform for Hotspot Operators" },
      {
        name: "description",
        content:
          "WaveWallet is a multi-tenant credit wallet, voucher marketplace and rewards platform for Omada hotspot operators, resellers and their customers.",
      },
      { property: "og:title", content: "WaveWallet — Voucher & Wallet Platform for Hotspot Operators" },
      {
        property: "og:description",
        content:
          "WaveWallet is a multi-tenant credit wallet, voucher marketplace and rewards platform for Omada hotspot operators, resellers and their customers.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [shops, setShops] = useState<SignupEcosystem[]>([]);
  const [preview, setPreview] = useState(false);
  const [demoBusy, setDemoBusy] = useState<string | null>(null);
  // One-time platform-owner setup; the server decides whether it is still open.
  const [setupOpen, setSetupOpen] = useState(false);

  useEffect(() => setPreview(isPreviewEnvironment()), []);

  /**
   * Demo sign-in is a real password sign-in: the server provisions a sandbox
   * account in the isolated demo ecosystem and hands back a freshly rotated
   * one-time password. No auth bypass, no shared master credential.
   */
  const startDemo = async (
    role: "customer" | "reseller" | "subreseller" | "admin" | "super_admin",
  ) => {
    if (demoBusy || busy) return;
    setDemoBusy(role);
    try {
      const creds = await startDemoSession({ data: { role } });
      const ctx = await signInWithPassword(creds.email, creds.password);
      if (!ctx) throw new Error("The demo profile could not be loaded.");
      toast.success(`Signed in to the DEMO shop as ${creds.label}.`);
      navigate({ to: homeFor(ctx.role) });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start the demo session.");
    } finally {
      setDemoBusy(null);
    }
  };



  // Already signed in? Send straight to the right dashboard.
  useEffect(() => {
    let active = true;
    loadAuthContext().then((ctx) => {
      if (active && ctx) navigate({ to: homeFor(ctx.role), replace: true });
    });
    // Signed-out visitors cannot read the shops table directly (row-level
    // security), so the open-signup list comes from a safe public function
    // that exposes name/slug/description only.
    supabase.rpc("list_signup_ecosystems").then(({ data }) => {
      if (!active) return;
      const list = (data as SignupEcosystem[] | null) ?? [];
      // The sandbox shop is only advertised inside the preview environment.
      setShops(
        isPreviewEnvironment() ? list : list.filter((e) => e.slug !== DEMO_ECOSYSTEM_SLUG),
      );
    });
    superAdminSetupAvailable()
      .then((r) => active && setSetupOpen(r.available))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [navigate]);

  const signIn = async () => {
    if (busy) return;
    if (!email.trim() || !password) {
      toast.error("Enter your email and password.");
      return;
    }
    setBusy(true);
    try {
      const ctx = await signInWithPassword(email, password);
      if (!ctx) throw new Error("We could not load your account profile.");
      if (ctx.profile.status !== "active") {
        await supabase.auth.signOut();
        throw new Error("This account is suspended. Contact your operator.");
      }
      // Role is resolved after authentication — never chosen by the visitor.
      navigate({ to: homeFor(ctx.role) });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not sign you in.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-2">
      <div className="surface-gradient relative overflow-hidden px-6 py-10 text-primary-foreground lg:flex lg:flex-col lg:justify-between lg:px-12 lg:py-14">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-background/15 text-lg font-bold">
              W
            </div>
            <div>
              <p className="text-lg font-semibold leading-tight">{platformSettings.productName}</p>
              <p className="text-xs opacity-80">Multi-tenant hotspot commerce</p>
            </div>
          </div>
          <h1 className="mt-10 max-w-md text-3xl font-semibold leading-tight tracking-tight lg:text-4xl">
            Run your hotspot shop like a real business.
          </h1>
          <p className="mt-3 max-w-md text-sm opacity-90">
            Closed-loop credit wallets, voucher inventory with duplicate-safe imports, reseller
            networks, points and physical rewards — each operator fully isolated in their own
            ecosystem.
          </p>
          <ul className="mt-6 space-y-2 text-sm opacity-90">
            {[
              "Atomic voucher dispensing — a code is never sold twice",
              "Immutable ledger for every credit and point movement",
              "Reseller discount and earnings captured at sale time",
              "Subscription gating with approval workflow",
            ].map((line) => (
              <li key={line} className="flex items-start gap-2">
                <ArrowRight className="mt-0.5 size-4 shrink-0" />
                {line}
              </li>
            ))}
          </ul>
        </div>
        <p className="mt-10 hidden text-xs opacity-70 lg:block">
          No Omada API dependency. Voucher codes are imported manually in this version.
        </p>
      </div>

      <div className="flex items-center justify-center px-4 py-10 lg:px-12">
        <div className="w-full max-w-md">
          <h2 className="text-xl font-semibold tracking-tight">Sign in</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            One sign-in for everyone — we take you to the right dashboard automatically.
          </p>

          <Card className="mt-5 shadow-[var(--shadow-card)]">
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && signIn()}
                  placeholder="you@example.com"
                  autoComplete="username"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  onKeyDown={(e) => e.key === "Enter" && signIn()}
                />
              </div>
              <Button className="w-full" onClick={signIn} disabled={busy}>
                <LogIn className="size-4" />
                {busy ? "Signing in…" : "Continue"}
              </Button>
              <p className="text-center text-xs">
                <Link to="/reset-password" className="text-primary hover:underline">
                  Forgot your password?
                </Link>
              </p>
              <p className="text-center text-[11px] text-muted-foreground">
                Your role and ecosystem are resolved by the server after sign-in.
              </p>
            </CardContent>
          </Card>

          {setupOpen ? (
            <Link
              to="/setup"
              className="mt-4 flex items-center justify-between rounded-xl border border-primary/40 bg-primary/5 px-4 py-3 transition-colors hover:bg-primary/10"
            >
              <span>
                <span className="flex items-center gap-1.5 text-sm font-semibold text-primary">
                  <ShieldCheck className="size-4" /> Initial Super Admin setup
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  No platform owner exists yet — create the first one.
                </span>
              </span>
              <ArrowRight className="size-4 text-primary" />
            </Link>
          ) : null}

          {preview ? (
            <div className="mt-6 rounded-xl border-2 border-dashed border-destructive/50 bg-destructive/5 p-4">
              <div className="mb-1 flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-destructive">
                  <FlaskConical className="size-3.5" /> Demo / preview access
                </p>
                <StatusBadge tone="danger">Not live data</StatusBadge>
              </div>
              <p className="text-xs text-muted-foreground">
                One-tap sign-in to a sandbox shop filled with clearly fake sample data. Only shown in
                the Lovable preview — never on a published site. Real shops, codes, credits and
                payments are untouched.
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {DEMO_ROLES.map((d) => (
                  <Button
                    key={d.role}
                    variant="outline"
                    className="h-auto flex-col items-start gap-0.5 py-2.5 text-left"
                    disabled={demoBusy !== null || busy}
                    onClick={() => startDemo(d.role)}
                  >
                    <span className="text-sm font-semibold">
                      {demoBusy === d.role ? "Preparing…" : `Demo ${d.label}`}
                    </span>
                    <span className="text-[11px] font-normal text-muted-foreground">{d.hint}</span>
                  </Button>
                ))}
              </div>
            </div>
          ) : null}



          <div className="mt-6 rounded-xl border border-border bg-card p-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                New customer?
              </p>
              <StatusBadge tone="brand">Invite only</StatusBadge>
            </div>
            <p className="text-xs text-muted-foreground">
              Customer accounts are created through your hotspot operator's signup link
              (<span className="font-mono">/join/your-shop</span>). Ask your operator for theirs, or
              open a shop below.
            </p>
            <div className="mt-3 grid gap-2">
              {shops.map((e) => (
                <a
                  key={e.id}
                  href={`/join/${e.slug}`}
                  className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:border-primary/40 hover:bg-accent"
                >
                  <span className="truncate">{e.name}</span>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    /join/{e.slug}
                    <ArrowRight className="size-3.5" />
                  </span>
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
