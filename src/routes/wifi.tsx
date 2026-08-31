/**
 * The ONE customer entry point every shop's hotspot redirects to.
 *
 * The shop is resolved server-side from a signed hand-off token; nothing in the
 * address bar names a shop, so a customer cannot switch to another one. When
 * the token is missing, tampered with or expired, this is simply the normal
 * WaveWallet sign-in — never another shop's context.
 */
import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { LogIn, ShieldCheck, Wifi } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordField } from "@/components/password-field";
import { loadAuthContext, signInWithPassword } from "@/lib/auth";
import { destinationAfterAuth } from "@/lib/shop-routing";
import { resolvePortalHandoff } from "@/lib/portal-handoff.functions";
import type { HandoffShopContext } from "@/lib/portal-handoff";
import { platformSettings } from "@/lib/wavewallet";

export const Route = createFileRoute("/wifi")({
  validateSearch: (search: Record<string, unknown>) => ({
    h: typeof search["h"] === "string" ? search["h"] : "",
  }),
  head: () => ({
    meta: [
      { title: "Your shop's Wi-Fi customer portal — WaveWallet" },
      {
        name: "description",
        content:
          "You're connected. Sign in or create your WaveWallet account for this hotspot shop to buy vouchers, hold coins and watch your voucher live.",
      },
      { property: "og:title", content: "Your shop's Wi-Fi customer portal — WaveWallet" },
      {
        property: "og:description",
        content: "Sign in or sign up with the hotspot shop you just connected to.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: WifiEntryPage,
});

function WifiEntryPage() {
  const { h } = useSearch({ from: "/wifi" });
  const navigate = useNavigate();
  const [shop, setShop] = useState<HandoffShopContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    if (!h) {
      setLoading(false);
      return;
    }
    resolvePortalHandoff({ data: { token: h } })
      .then((r) => {
        if (!active) return;
        setShop(r.ok ? r.shop : null);
        setLoading(false);
      })
      .catch(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [h]);

  // Already signed in? Never ask again just to see WaveWallet account data.
  useEffect(() => {
    let active = true;
    loadAuthContext()
      .then(async (ctx) => {
        if (!active || !ctx) return;
        const to = await destinationAfterAuth(ctx.role);
        if (active) navigate({ to, replace: true });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [navigate]);

  const signIn = async () => {
    if (busy) return;
    if (!email.trim() || !password) {
      toast.error("Enter your email or mobile number and your password.");
      return;
    }
    setBusy(true);
    try {
      const ctx = await signInWithPassword(email.trim(), password);
      if (!ctx) throw new Error("Your profile could not be loaded.");
      const to = await destinationAfterAuth(ctx.role);
      await navigate({ to });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not sign you in.");
    } finally {
      setBusy(false);
    }
  };

  const shopName = shop?.shopName ?? null;

  return (
    <main className="min-h-screen bg-muted/40">
      <div className="surface-gradient px-6 py-10 text-primary-foreground">
        <div className="mx-auto max-w-md">
          <p className="flex items-center gap-2 text-xs uppercase tracking-wide opacity-80">
            <Wifi className="size-4" /> {platformSettings.productName} · Customer portal
          </p>
          <h1 className="mt-2 text-2xl font-semibold leading-tight">
            {loading ? "You're connected" : shopName ? `Welcome to ${shopName}` : "Welcome back"}
          </h1>
          <p className="mt-2 text-sm opacity-90">
            {shopName
              ? `You're online through ${shopName}. This is the customer portal for that shop — sign in or create your account to buy vouchers, keep your coins and watch your voucher live.`
              : "Sign in to WaveWallet to buy vouchers, keep your coins and watch your voucher live."}
          </p>
        </div>
      </div>

      <div className="mx-auto -mt-6 max-w-md space-y-4 px-4 pb-12">
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="space-y-4 py-6">
            <div className="space-y-1.5">
              <Label htmlFor="wifi-email">Email or mobile number</Label>
              <Input
                id="wifi-email"
                inputMode="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>
            <PasswordField
              id="wifi-password"
              label="Password"
              autoComplete="current-password"
              value={password}
              onChange={setPassword}
              onEnter={() => void signIn()}
            />

            <Button className="w-full" disabled={busy} onClick={() => void signIn()}>
              <LogIn className="mr-2 size-4" />
              {busy ? "Signing in…" : "Sign in"}
            </Button>
            {shop?.shopSlug ? (
              <Button asChild variant="outline" className="w-full">
                <Link to="/join/$slug" params={{ slug: shop.shopSlug }}>
                  New here? Sign up with {shopName}
                </Link>
              </Button>
            ) : (
              <Button asChild variant="outline" className="w-full">
                <Link to="/">Other sign-in options</Link>
              </Button>
            )}
          </CardContent>
        </Card>

        <p className="flex items-start gap-2 px-1 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" />
          {shopName
            ? `Your shop was confirmed by ${platformSettings.productName} from the hotspot you authenticated on. Signing up here joins ${shopName} only.`
            : "Your hotspot link is no longer valid, so sign in normally. Your shops stay exactly as they are."}
        </p>
      </div>
    </main>
  );
}
