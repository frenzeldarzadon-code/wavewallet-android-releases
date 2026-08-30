/**
 * WaveWallet customer captive portal.
 *
 * Omada redirects the connecting device here. The shop is resolved from the
 * portal identifiers in the redirect — the customer is never asked to pick a
 * shop. Manual voucher entry always works, with or without a WaveWallet
 * account; signing in additionally unlocks buying a voucher from THAT shop's
 * existing Voucher Shop with the customer's real coins.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute, useSearch } from "@tanstack/react-router";
import { toast } from "sonner";
import { Loader2, Wifi, WifiOff, CheckCircle2, Coins, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { signInWithPassword } from "@/lib/auth";
import { purchaseVoucher } from "@/lib/wallet";
import { fetchMyMemberships, switchEcosystem } from "@/lib/memberships";
import { fetchCreditBalance } from "@/lib/wallet";
import { fetchPointsAccount } from "@/lib/rewards";
import { formatAccessDuration } from "@/lib/portal-mapping";
import {
  authorizeManualVoucher,
  authorizePortalSale,
  claimPortalSession,
  getPortalState,
  retryPortalAuthorization,
  startPortalSession,
  type AuthorizeResult,
  type PortalState,
} from "@/lib/portal-session.functions";

export const Route = createFileRoute("/portal")({
  validateSearch: (search: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(search).filter(([, v]) => typeof v === "string"),
    ) as Record<string, string>,
  head: () => ({
    meta: [
      { title: "Get online — WaveWallet Wi-Fi" },
      {
        name: "description",
        content:
          "Connect to this hotspot: enter a voucher code, or sign in to WaveWallet and buy Wi-Fi access with your coins.",
      },
      { property: "og:title", content: "Get online — WaveWallet Wi-Fi" },
      {
        property: "og:description",
        content: "Enter your voucher or buy Wi-Fi access with your WaveWallet coins.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PortalPage,
});

interface Wallets {
  credits: number;
  points: number;
}

function PortalPage() {
  const search = useSearch({ from: "/portal" });
  const [state, setState] = useState<PortalState | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [wallets, setWallets] = useState<Wallets | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [isMember, setIsMember] = useState(false);
  const [busy, setBusy] = useState("");
  const [online, setOnline] = useState<AuthorizeResult | null>(null);

  const [code, setCode] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");

  /* ---------------- session ---------------- */
  useEffect(() => {
    let active = true;
    void startPortalSession({ data: { search } })
      .then((r) => {
        if (!active) return;
        if ("ok" in r && r.ok === false) setFailure(r.reason);
        else setState(r as PortalState);
      })
      .catch((e: Error) => active && setFailure(e.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
    // The redirect parameters are fixed for the life of this page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadAccount = useCallback(
    async (sessionId: string, shopId: string) => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        setSignedIn(false);
        return;
      }
      setSignedIn(true);
      const claim = await claimPortalSession({ data: { sessionId } }).catch(() => null);
      setIsMember(claim?.isMember === true);

      const memberships = await fetchMyMemberships().catch(() => []);
      const here = memberships.find((m) => m.ecosystemId === shopId && m.isActive);
      if (here) {
        // Buying uses the shop's own Voucher Shop, so the active shop must be this one.
        await switchEcosystem(shopId).catch(() => undefined);
        setIsMember(true);
      }

      const [{ data: profile }, credits, points] = await Promise.all([
        supabase.from("profiles").select("full_name").eq("id", data.user.id).maybeSingle(),
        fetchCreditBalance(data.user.id, shopId).catch(() => 0),
        fetchPointsAccount(data.user.id, shopId).catch(() => ({ balance: 0 })),
      ]);
      setDisplayName((profile as { full_name?: string } | null)?.full_name ?? null);
      setWallets({ credits, points: Number(points.balance ?? 0) });
    },
    [],
  );

  useEffect(() => {
    if (!state) return;
    void loadAccount(state.sessionId, state.shopId);
  }, [state, loadAccount]);

  const refresh = useCallback(async () => {
    if (!state) return;
    const next = await getPortalState({ data: { sessionId: state.sessionId } }).catch(() => null);
    if (next) setState(next);
    if (state) await loadAccount(state.sessionId, state.shopId);
  }, [state, loadAccount]);

  /* ---------------- actions ---------------- */
  const finish = (r: AuthorizeResult) => {
    setOnline(r);
    if (r.ok) toast.success(r.message);
    else toast.error(r.message);
  };

  const useManualCode = async () => {
    if (!state) return;
    setBusy("manual");
    try {
      finish(await authorizeManualVoucher({ data: { sessionId: state.sessionId, code } }));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const doSignIn = async () => {
    if (!state) return;
    setBusy("signin");
    try {
      await signInWithPassword(identifier, password);
      setPassword("");
      await refresh();
      toast.success("Signed in.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const buyAndConnect = async (productId: string) => {
    if (!state) return;
    setBusy(productId);
    try {
      const sale = await purchaseVoucher(productId, 1);
      const r = await authorizePortalSale({
        data: { sessionId: state.sessionId, saleId: sale.sale_id },
      });
      finish(r);
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const retry = async () => {
    if (!state || !online?.authorizationId) return;
    setBusy("retry");
    try {
      finish(
        await retryPortalAuthorization({
          data: { sessionId: state.sessionId, authorizationId: online.authorizationId },
        }),
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const products = useMemo(() => state?.products ?? [], [state]);

  /* ---------------- render ---------------- */
  if (loading) {
    return (
      <Shell>
        <p className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Connecting…
        </p>
      </Shell>
    );
  }

  if (!state) {
    return (
      <Shell>
        <Card className="shadow-[var(--shadow-card)]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <WifiOff className="h-5 w-5 text-destructive" /> Hotspot not ready
            </CardTitle>
            <CardDescription>{failure}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Reconnect to the Wi-Fi to try again, or ask the shop for help.
            </p>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  if (online?.ok) {
    return (
      <Shell title={state.shopName} ssid={state.ssid}>
        <Card className="shadow-[var(--shadow-card)]">
          <CardHeader className="items-center text-center">
            <CheckCircle2 className="h-10 w-10 text-success" />
            <CardTitle className="text-base">You're online</CardTitle>
            <CardDescription>{online.message}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-center">
            {online.code ? (
              <p className="text-sm">
                Voucher <span className="font-mono font-semibold">{online.code}</span>
              </p>
            ) : null}
            {online.durationMinutes ? (
              <p className="text-sm text-muted-foreground">
                Access time: {formatAccessDuration(online.durationMinutes)}
              </p>
            ) : null}
            {online.redirectUrl ? (
              <Button className="w-full" asChild>
                <a href={online.redirectUrl}>Continue browsing</a>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell title={state.shopName} ssid={state.ssid}>
      {online && !online.ok ? (
        <Card className="border-destructive/40 shadow-[var(--shadow-card)]">
          <CardHeader>
            <CardTitle className="text-sm">Could not put you online</CardTitle>
            <CardDescription>{online.message}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {online.code ? (
              <p className="text-sm">
                Your voucher <span className="font-mono font-semibold">{online.code}</span> is
                yours to keep — nothing was lost.
              </p>
            ) : null}
            {online.authorizationId ? (
              <Button className="w-full" disabled={busy !== ""} onClick={() => void retry()}>
                {busy === "retry" ? "Trying again…" : "Try again"}
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {!state.autoSignOn && state.autoSignOnNote ? (
        <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs">
          {state.autoSignOnNote}
        </p>
      ) : null}

      <Card className="shadow-[var(--shadow-card)]">
        <CardHeader>
          <CardTitle className="text-sm">I have a voucher</CardTitle>
          <CardDescription>Enter the code printed on your voucher.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="Voucher code"
            inputMode="text"
            autoCapitalize="characters"
            className="text-center font-mono text-lg tracking-widest"
          />
          <Button
            className="w-full"
            disabled={busy !== "" || code.trim().length === 0}
            onClick={() => void useManualCode()}
          >
            {busy === "manual" ? "Connecting…" : "Connect"}
          </Button>
        </CardContent>
      </Card>

      {state.flags.allowPurchase ? (
        signedIn ? (
          <Card className="shadow-[var(--shadow-card)]">
            <CardHeader>
              <CardTitle className="text-sm">
                {displayName ? `Hi, ${displayName}` : "Buy access"}
              </CardTitle>
              <CardDescription className="flex flex-wrap gap-3">
                {state.flags.showCoins && wallets ? (
                  <span className="inline-flex items-center gap-1">
                    <Coins className="h-3.5 w-3.5" /> {wallets.credits.toFixed(2)} coins
                  </span>
                ) : null}
                {state.flags.showPoints && wallets ? (
                  <span className="inline-flex items-center gap-1">
                    <Sparkles className="h-3.5 w-3.5" /> {wallets.points} points
                  </span>
                ) : null}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {!isMember ? (
                <p className="text-sm text-muted-foreground">
                  You are not a member of {state.shopName} yet, so you cannot buy here. You can
                  still connect with a voucher code above.
                </p>
              ) : products.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  This shop has no Wi-Fi package on sale right now.
                </p>
              ) : (
                products.map((p) => {
                  const out = p.available <= 0;
                  const short = wallets !== null && wallets.credits < p.price;
                  return (
                    <div
                      key={p.id}
                      className="flex items-center justify-between gap-3 rounded-md border p-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{p.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {p.durationMinutes
                            ? formatAccessDuration(p.durationMinutes)
                            : (p.description ?? "Wi-Fi access")}
                          {out ? " · out of stock" : ""}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        disabled={busy !== "" || out || short}
                        onClick={() => void buyAndConnect(p.id)}
                      >
                        {busy === p.id
                          ? "Buying…"
                          : short
                            ? "Not enough coins"
                            : `${p.price.toFixed(2)} coins`}
                      </Button>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        ) : (
          <Card className="shadow-[var(--shadow-card)]">
            <CardHeader>
              <CardTitle className="text-sm">Use my WaveWallet</CardTitle>
              <CardDescription>
                Sign in to buy Wi-Fi access with your coins from {state.shopName}.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="portal-id">Email or mobile number</Label>
                <Input
                  id="portal-id"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  autoComplete="username"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="portal-pw">Password</Label>
                <Input
                  id="portal-pw"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </div>
              <Button
                className="w-full"
                disabled={busy !== "" || !identifier || !password}
                onClick={() => void doSignIn()}
              >
                {busy === "signin" ? "Signing in…" : "Sign in"}
              </Button>
            </CardContent>
          </Card>
        )
      ) : null}
    </Shell>
  );
}

function Shell({
  children,
  title,
  ssid,
}: {
  children: React.ReactNode;
  title?: string;
  ssid?: string | null;
}) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 p-4">
      <header className="pt-4 text-center">
        <div className="mx-auto mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-primary/10">
          <Wifi className="h-5 w-5 text-primary" />
        </div>
        <h1 className="text-lg font-semibold">{title ?? "Wi-Fi access"}</h1>
        {ssid ? <p className="text-xs text-muted-foreground">Network: {ssid}</p> : null}
      </header>
      {children}
    </main>
  );
}
