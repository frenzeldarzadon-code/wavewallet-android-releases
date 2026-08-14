import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowRight, FlaskConical, LogIn, MailCheck, ShieldCheck, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/ui-kit";
import { SocialSignIn } from "@/components/auth/social-sign-in";
import { homeFor } from "@/lib/session";
import {
  loadAuthContext,
  signInWithPassword,
  signUpCustomerAccount,
} from "@/lib/auth";
import { fetchMyApplication } from "@/lib/membership-applications";
import { isRealEmail, validateGlobalSignup } from "@/lib/account-identifiers";
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
  const [preview, setPreview] = useState(false);
  const [demoBusy, setDemoBusy] = useState<string | null>(null);
  // One-time platform-owner setup; the server decides whether it is still open.
  const [setupOpen, setSetupOpen] = useState(false);
  // Self-service signup: the ecosystem comes from a fixed list, never free text.
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    password: "",
    confirm: "",
  });
  const [signupBusy, setSignupBusy] = useState(false);
  const [applied, setApplied] = useState<{ needsEmail: boolean } | null>(null);

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
      if (!active || !ctx) return;
      // A brand-new social sign-in has no shop membership yet — land them in
      // the Universe directory instead of a console they cannot use.
      if (!ctx.ecosystem && ctx.role === "customer") {
        navigate({ to: "/universe/shops", replace: true });
        return;
      }
      navigate({ to: homeFor(ctx.role), replace: true });
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
      toast.error("Enter your email or mobile number, and your password.");
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
      // Shop membership is separate from having an account. Someone who belongs
      // to no shop still gets the whole Universe — feed, profile, messages and
      // the shop directory — while any shop application stays pending.
      if (!ctx.ecosystem && ctx.role === "customer") {
        navigate({ to: "/universe", replace: true });
        return;
      }
      // Role is resolved after authentication — never chosen by the visitor.
      navigate({ to: homeFor(ctx.role) });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not sign you in.");
    } finally {
      setBusy(false);
    }
  };

  const signUp = async () => {
    if (signupBusy) return;
    const problem = validateGlobalSignup(form);
    if (problem) {
      toast.error(problem);
      return;
    }
    setSignupBusy(true);
    try {
      const { needsEmailConfirmation } = await signUpCustomerAccount({
        fullName: form.name,
        email: form.email,
        phone: form.phone,
        password: form.password,
      });
      setForm({ name: "", email: "", phone: "", password: "", confirm: "" });
      // A new account belongs to no shop, and that is fine: the Universe is open
      // to everyone straight away. Joining a shop stays a separate, approved step.
      if (needsEmailConfirmation && isRealEmail(form.email)) {
        await supabase.auth.signOut();
        setApplied({ needsEmail: true });
        return;
      }
      toast.success("Welcome to WaveWallet. You are in the Universe — join a shop any time.");
      navigate({ to: "/universe", replace: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create your account.");
    } finally {
      setSignupBusy(false);
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
            shop.
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
                <Label htmlFor="email">Email or mobile number</Label>
                <Input
                  id="email"
                  type="text"
                  inputMode="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && signIn()}
                  placeholder="you@example.com or 0917 000 0000"
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
              <SocialSignIn disabled={busy} />
              <p className="text-center text-[11px] text-muted-foreground">
                Your role and shop are resolved by the server after sign-in.
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
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                New here?
              </p>
              <StatusBadge tone="success">Free account</StatusBadge>
            </div>

            {applied ? (
              <div className="space-y-3 text-center">
                <MailCheck className="mx-auto size-8 text-success" />
                <h3 className="text-sm font-semibold">Account created</h3>
                <p className="text-xs text-muted-foreground">
                  Sign in to browse shops and apply to the one you want to join. Shop access starts
                  once an authorized member approves your application.
                  {applied.needsEmail
                    ? " We also emailed you a confirmation link — please confirm your email address."
                    : ""}
                </p>
                <Button variant="outline" className="w-full" onClick={() => setApplied(null)}>
                  Back to sign in
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <h3 className="text-sm font-semibold">Create your account</h3>
                  <p className="text-xs text-muted-foreground">
                    One account for everything. Give us an email address or a mobile number — at
                    least one is required. You can join a shop after signing in.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="su-name">Full name</Label>
                  <Input
                    id="su-name"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Juan Dela Cruz"
                    autoComplete="name"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="su-email">Email (optional)</Label>
                  <Input
                    id="su-email"
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="you@example.com"
                    autoComplete="email"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="su-phone">Mobile number (optional)</Label>
                  <Input
                    id="su-phone"
                    inputMode="tel"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    placeholder="0917 000 0000"
                    autoComplete="tel"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Enter at least one of email or mobile number — that is what you will sign in
                    with. Only an email address can reset a forgotten password by itself.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="su-password">Password</Label>
                    <Input
                      id="su-password"
                      type="password"
                      value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                      placeholder="At least 8 characters"
                      autoComplete="new-password"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="su-confirm">Confirm password</Label>
                    <Input
                      id="su-confirm"
                      type="password"
                      value={form.confirm}
                      onChange={(e) => setForm({ ...form, confirm: e.target.value })}
                      placeholder="Repeat your password"
                      autoComplete="new-password"
                      onKeyDown={(e) => e.key === "Enter" && signUp()}
                    />
                  </div>
                </div>
                <Button
                  className="w-full"
                  variant="secondary"
                  onClick={signUp}
                  disabled={signupBusy}
                >
                  <UserPlus className="size-4" />
                  {signupBusy ? "Creating…" : "Create account"}
                </Button>
                <p className="text-center text-[11px] text-muted-foreground">
                  Signing up creates a normal member account. Roles and shop access are granted by
                  the shop, never chosen here.
                </p>
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
