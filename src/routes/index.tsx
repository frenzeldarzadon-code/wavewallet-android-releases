import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowRight, FlaskConical, LogIn, MailCheck, ShieldCheck, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import {
  AddressFields,
  EMPTY_ADDRESS,
  type AddressValue,
} from "@/components/universe/address-fields";
import { addressIssue } from "@/lib/ph-address";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/ui-kit";
import { SocialSignIn } from "@/components/auth/social-sign-in";
import { PasswordField } from "@/components/password-field";
import { homeFor } from "@/lib/session";
import { useOnline } from "@/lib/pwa";
import {
  loadAuthContext,
  signInWithPassword,
  signUpCustomerAccount,
} from "@/lib/auth";
import { isRealEmail, validateGlobalSignup } from "@/lib/account-identifiers";
import { normalizeShopCode, safeReturnPath } from "@/lib/shop-directory";
import { destinationAfterAuth, NEW_MEMBER_DESTINATION } from "@/lib/shop-routing";
import { signInWithUsername } from "@/lib/username-login.functions";
import { LOGIN_PASSWORD_HINT, LOGIN_USERNAME_HINT } from "@/lib/username-login";
import { newPasswordIssue } from "@/lib/password-policy";
import { supabase } from "@/integrations/supabase/client";
import logo from "@/assets/wavewallet-logo.webp";
import { DEMO_ECOSYSTEM_SLUG, DEMO_ROLES, isPreviewEnvironment } from "@/lib/demo";
import { startDemoSession } from "@/lib/demo.functions";
import { platformSettings } from "@/lib/wavewallet";
import { superAdminSetupAvailable } from "@/lib/bootstrap.functions";

export const Route = createFileRoute("/")({
  // A direct shop link carries only the public 7-digit Shop ID, an optional
  // mode, and an optional in-app path to return to after authenticating.
  validateSearch: (
    search: Record<string, unknown>,
  ): { shop?: string; mode?: "signin" | "signup"; next?: string } => {
    const raw = search["shop"];
    const code =
      typeof raw === "string" || typeof raw === "number" ? normalizeShopCode(String(raw)) : "";
    const rawMode = search["mode"];
    const next = safeReturnPath(typeof search["next"] === "string" ? search["next"] : null);
    return {
      ...(code ? { shop: code } : {}),
      ...(rawMode === "signin" || rawMode === "signup" ? { mode: rawMode } : {}),
      ...(next ? { next } : {}),
    };
  },

  head: () => ({
    meta: [
      { title: "ONE WAVE — Wallet, Voucher & Retail Ecosystem" },
      {
        name: "description",
        content:
          "ONE WAVE brings WaveWallet, voucher marketplaces, Retail Market and Universe together for hotspot operators, sellers and their customers.",
      },
      { property: "og:title", content: "ONE WAVE — Wallet, Voucher & Retail Ecosystem" },
      {
        property: "og:description",
        content:
          "ONE WAVE brings WaveWallet, voucher marketplaces, Retail Market and Universe together for hotspot operators, sellers and their customers.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const searchParams = Route.useSearch();
  // Public registration creates a ONE WAVE identity first. Explicit shop
  // joining remains on the dedicated join routes after account creation.
  const [mode, setMode] = useState<"signin" | "signup">(searchParams.mode ?? "signin");
  // Where a shop-specific link wants the customer back (e.g. the hotspot portal).
  const nextPath = safeReturnPath(searchParams.next ?? null);
  const [method, setMethod] = useState<"email" | "username">("email");
  const [username, setUsername] = useState("");
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
  const [address, setAddress] = useState<AddressValue>(EMPTY_ADDRESS);
  const [signupBusy, setSignupBusy] = useState(false);
  // Live, precise feedback while typing — never a vague "incomplete password".
  const signupIssue =
    form.password || form.confirm ? newPasswordIssue(form.password, form.confirm) : null;
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
    loadAuthContext().then(async (ctx) => {
      if (!active || !ctx) return;
      const to = nextPath ?? (await destinationAfterAuth(ctx.role));
      if (active) navigate({ to, replace: true });
    });
    superAdminSetupAvailable()
      .then((r) => active && setSetupOpen(r.available))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [navigate, nextPath]);

  const online = useOnline();

  const signIn = async () => {
    if (busy) return;
    if (method === "username" ? !username.trim() : !email.trim()) {
      toast.error(
        method === "username"
          ? "Enter your username and password."
          : "Enter your email or mobile number, and your password.",
      );
      return;
    }
    if (!password) {
      toast.error("Enter your password.");
      return;
    }
    setBusy(true);
    try {
      let ctx = null;
      if (method === "username") {
        // The username maps to the same single account — no duplicate identity.
        const tokens = await signInWithUsername({ data: { username, password } });
        const { error } = await supabase.auth.setSession({
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
        });
        if (error) throw new Error(error.message);
        ctx = await loadAuthContext();
      } else {
        ctx = await signInWithPassword(email, password);
      }
      if (!ctx) throw new Error("We could not load your account profile.");
      if (ctx.profile.status !== "active") {
        await supabase.auth.signOut();
        throw new Error("This account is suspended. Contact your operator.");
      }
      // Members who belong to a shop open that shop; the Universe stays in
      // navigation. Role is resolved after authentication, never chosen here.
      navigate({ to: nextPath ?? (await destinationAfterAuth(ctx.role)), replace: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not sign you in.");
    } finally {
      setBusy(false);
    }
  };

  const signUp = async () => {
    if (signupBusy) return;
    const problem =
      validateGlobalSignup(form) ??
      addressIssue({
        province: address.province,
        cityMunicipality: address.cityMunicipality,
        barangay: address.barangay,
        street: address.street,
        houseNumber: address.houseNumber,
      });
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
        province: address.province,
        cityMunicipality: address.cityMunicipality,
        barangay: address.barangay,
        street: address.street,
        houseNumber: address.houseNumber,
      });
      setForm({ name: "", email: "", phone: "", password: "", confirm: "" });
      setAddress(EMPTY_ADDRESS);
      if (needsEmailConfirmation && isRealEmail(form.email)) {
        await supabase.auth.signOut();
        setApplied({ needsEmail: true });
        return;
      }
      toast.success("Welcome to ONE WAVE.");
      navigate({ to: NEW_MEMBER_DESTINATION, replace: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create your account.");
    } finally {
      setSignupBusy(false);
    }
  };


  return (
    <div className="dark auth-surface relative min-h-[100dvh] w-full overflow-x-hidden">
      {/* Subtle wave / mountain accent — decorative only. */}
      <svg
        aria-hidden
        viewBox="0 0 400 220"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-40 w-full opacity-50"
      >
        <path d="M0 150 L110 70 L170 120 L250 45 L330 115 L400 80 L400 220 L0 220 Z" fill="oklch(0.3 0.07 250 / 0.55)" />
        <path
          d="M0 175 C70 145 120 195 200 170 C275 147 330 190 400 160 L400 220 L0 220 Z"
          fill="oklch(0.55 0.12 215 / 0.35)"
        />
      </svg>

      <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-md flex-col px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] sm:max-w-lg">
        <header className="flex items-center justify-between gap-3 py-2">
          <div className="flex items-center gap-2.5">
            <img
              src={logo}
              alt="ONE WAVE logo"
              className="size-9 rounded-xl object-contain"
              width={36}
              height={36}
            />
            <div className="leading-tight">
              <p className="text-base font-semibold tracking-tight text-auth-fg">
                {platformSettings.productName}
              </p>
              <p className="text-[11px] text-auth-muted">Wallet · Vouchers · Rewards</p>
            </div>
          </div>
          <span className="rounded-full border border-auth-border px-2.5 py-1 text-[11px] text-auth-muted">
            EN
          </span>
        </header>

        <main className="flex flex-1 flex-col justify-center py-2">
          {applied ? (
            <Card className="auth-card rounded-2xl">
              <CardContent className="space-y-3 py-5 text-center">
                <MailCheck className="mx-auto size-8 text-success" />
                <h1 className="text-base font-semibold">Account created</h1>
                <p className="text-xs text-auth-muted">
                  Sign in to continue to the ONE WAVE Universe.
                  {applied.needsEmail
                    ? " We also emailed you a confirmation link — please confirm your email address."
                    : ""}
                </p>
                <Button
                  variant="outline"
                  className="h-11 w-full"
                  onClick={() => {
                    setApplied(null);
                    setMode("signin");
                  }}
                >
                  Back to sign in
                </Button>
              </CardContent>
            </Card>
          ) : mode === "signin" ? (
            <Card className="auth-card rounded-2xl">
              <CardContent className="space-y-3 py-5">
                <div className="space-y-0.5">
                  <h1 className="text-xl font-semibold tracking-tight">Welcome back</h1>
                  <p className="text-xs text-auth-muted">
                    One sign-in for everyone — we take you to the right place.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-1 rounded-xl border border-auth-border p-1">
                  {(["email", "username"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMethod(m)}
                      className={
                        "rounded-lg px-2 py-1.5 text-xs font-medium " +
                        (method === m
                          ? "bg-primary text-primary-foreground"
                          : "text-auth-muted hover:text-auth-fg")
                      }
                    >
                      {m === "email" ? "Email / mobile" : "Username"}
                    </button>
                  ))}
                </div>
                {method === "username" ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="login-username">Username</Label>
                    <Input
                      id="login-username"
                      type="text"
                      className="h-11"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && signIn()}
                      placeholder="Enter username"
                      autoComplete="username"
                    />
                    <p className="text-[11px] text-auth-muted">{LOGIN_USERNAME_HINT}</p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label htmlFor="email">Email or mobile number</Label>
                    <Input
                      id="email"
                      type="text"
                      inputMode="email"
                      className="h-11"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && signIn()}
                      placeholder="Enter your email or mobile number"
                      autoComplete="username"
                    />
                  </div>
                )}
                <PasswordField
                  id="password"
                  label="Password"
                  value={password}
                  onChange={setPassword}
                  autoComplete="current-password"
                  onEnter={() => void signIn()}
                />
                {method === "username" ? (
                  <p className="-mt-1 text-[11px] text-auth-muted">{LOGIN_PASSWORD_HINT}</p>
                ) : null}

                <Button className="h-11 w-full" onClick={signIn} disabled={busy || !online}>
                  <LogIn className="size-4" />
                  {busy ? "Signing in…" : "Sign In"}
                </Button>
                <div className="text-center text-xs">
                  <Link to="/reset-password" className="text-auth-muted hover:underline">
                    Forgot password?
                  </Link>
                </div>

                <SocialSignIn disabled={busy || !online} />
                <Button
                  variant="outline"
                  className="h-11 w-full"
                  onClick={() => setMode("signup")}
                >
                  <UserPlus className="size-4" />
                  Create Free Account
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card className="auth-card rounded-2xl">
              <CardContent className="space-y-3 py-5">
                <div className="space-y-0.5">
                  <h1 className="text-xl font-semibold tracking-tight">Join ONE WAVE</h1>
                  <p className="text-xs text-auth-muted">
                    Create your account first. You can join or open shops later from Universe.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="su-name">Full name</Label>
                  <Input
                    id="su-name"
                    className="h-11"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Enter your full name"
                    autoComplete="name"
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="su-email">Email</Label>
                    <Input
                      id="su-email"
                      type="email"
                      className="h-11"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      placeholder="Enter your email"
                      autoComplete="email"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="su-phone">Mobile number</Label>
                    <Input
                      id="su-phone"
                      inputMode="tel"
                      className="h-11"
                      value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                      placeholder="Enter your mobile number"
                      autoComplete="tel"
                    />
                  </div>
                </div>
                <AddressFields value={address} onChange={setAddress} idPrefix="su" />
                <PasswordField
                  id="su-password"
                  label="Password"
                  value={form.password}
                  onChange={(v) => setForm({ ...form, password: v })}
                  autoComplete="new-password"
                  hint
                />
                <PasswordField
                  id="su-confirm"
                  label="Confirm password"
                  value={form.confirm}
                  onChange={(v) => setForm({ ...form, confirm: v })}
                  placeholder="Repeat your password"
                  autoComplete="new-password"
                  onEnter={() => void signUp()}
                />
                {signupIssue ? <p className="text-xs text-destructive">{signupIssue}</p> : null}
                <Button className="h-11 w-full" onClick={signUp} disabled={signupBusy || !online}>
                  <UserPlus className="size-4" />
                  {signupBusy ? "Creating…" : "Create Account"}
                </Button>
                <div className="flex items-center justify-between text-xs text-auth-muted">
                  <button
                    type="button"
                    className="hover:underline"
                    onClick={() => setMode("signin")}
                  >
                    ← Back to sign in
                  </button>
                  <span>Universe first</span>
                </div>
              </CardContent>
            </Card>

          )}

          {setupOpen ? (
            <Link
              to="/setup"
              className="mt-3 flex items-center justify-between rounded-xl border border-auth-border bg-primary/10 px-4 py-3"
            >
              <span>
                <span className="flex items-center gap-1.5 text-sm font-semibold text-auth-fg">
                  <ShieldCheck className="size-4" /> Initial Super Admin setup
                </span>
                <span className="mt-0.5 block text-xs text-auth-muted">
                  No platform owner exists yet — create the first one.
                </span>
              </span>
              <ArrowRight className="size-4" />
            </Link>
          ) : null}

          {preview ? (
            <div className="mt-3 rounded-xl border border-dashed border-destructive/50 bg-destructive/10 p-3">
              <div className="mb-1 flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-destructive">
                  <FlaskConical className="size-3.5" /> Demo / preview access
                </p>
                <StatusBadge tone="danger">Not live data</StatusBadge>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {DEMO_ROLES.map((d) => (
                  <Button
                    key={d.role}
                    variant="outline"
                    size="sm"
                    disabled={demoBusy !== null || busy}
                    onClick={() => startDemo(d.role)}
                  >
                    {demoBusy === d.role ? "Preparing…" : `Demo ${d.label}`}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
        </main>

        <footer className="py-2 text-center text-[11px] text-auth-muted">
          Your role and shop are resolved by the server after sign-in.
        </footer>
      </div>
    </div>
  );
}

