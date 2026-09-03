/**
 * Review shop workspace — the 5-day simulation.
 *
 * Everything on this page runs on the demo_* tables: Demo Coins, demo vouchers
 * and a demo ledger. No real balance, GCash payment or settlement can be
 * reached from here.
 */
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  Clock,
  FlaskConical,
  Loader2,
  RotateCcw,
  ShoppingCart,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageSection, StatusBadge } from "@/components/ui-kit";
import { HelpTip } from "@/components/help-tip";
import { supabase } from "@/integrations/supabase/client";
import { GoLiveCard } from "@/components/subscription/go-live-card";
import {
  demoReset,
  demoSellVoucher,
  demoTransfer,
  fetchDemoState,
  fetchMyReviewShop,
  reviewCountdown,
  type DemoState,
} from "@/lib/review-demo";

const TITLE = "Review shop — ONE WAVE";
const DESCRIPTION =
  "Explore the full WaveWallet flow for 5 days with simulated Demo Coins before you subscribe.";

export const Route = createFileRoute("/review")({
  ssr: false,
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ReviewPage,
});

const chainLabel: Record<string, string> = {
  admin: "Shop admin (you)",
  reseller: "Reseller",
  subreseller: "Subreseller",
  customer: "Customer",
};

function ReviewPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [state, setState] = useState<DemoState | null>(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);

  const [from, setFrom] = useState("admin");
  const [to, setTo] = useState("reseller");
  const [amount, setAmount] = useState("100");
  const [voucherId, setVoucherId] = useState("");
  const [quantity, setQuantity] = useState("1");

  const load = useCallback(async () => {
    const { data } = await supabase.auth.getUser();
    setSignedIn(Boolean(data.user));
    if (!data.user) {
      setLoading(false);
      return;
    }
    try {
      const shop = await fetchMyReviewShop();
      if (!shop) {
        setState(null);
        return;
      }
      const next = await fetchDemoState(shop.id);
      setState(next);
      setVoucherId((v) => v || next.vouchers[0]?.id || "");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load your review shop");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That simulated action did not go through");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading your review shop…
        </p>
      </main>
    );
  }

  if (!signedIn) {
    return (
      <Shell>
        <p className="text-sm text-muted-foreground">
          Sign in to your ONE WAVE account to open your review shop.
        </p>
        <Button asChild className="mt-3">
          <Link to="/">Sign in</Link>
        </Button>
      </Shell>
    );
  }

  if (!state) {
    return (
      <Shell>
        <p className="text-sm text-muted-foreground">
          You do not have a review shop yet. Create one and explore the whole flow for 5 days with
          simulated Demo Coins.
        </p>
        <Button className="mt-3" onClick={() => void navigate({ to: "/start-shop" })}>
          Create a review shop
        </Button>
      </Shell>
    );
  }

  const countdown = reviewCountdown(state.review_ends_at, Date.now() + tick * 0);
  const wallets = state.wallets;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <StatusBadge tone="brand">
            <FlaskConical className="mr-1 inline size-3.5" /> Review shop · simulated
          </StatusBadge>
          <h1 className="mt-2 text-xl font-semibold tracking-tight">{state.name}</h1>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="size-3.5" /> {countdown}
          </p>
        </div>
        <Button asChild size="sm">
          <Link to="/help">Guide &amp; Help</Link>
        </Button>
      </div>

      <div className="mb-6 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-xs leading-relaxed">
        These are <strong>Demo Coins</strong>. They are simulated, have no monetary value, never
        touch a real wallet or ledger, and cannot be cashed out. When you subscribe they are
        removed and your plan&apos;s real Coin allocation is issued once.
      </div>

      {state.ended ? (
        <Card className="mb-6 border-destructive/40">
          <CardContent className="px-4">
            <p className="text-sm font-semibold text-destructive">Your 5-day review has ended</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Simulated operations are frozen. Subscribe to turn this shop into a live account with
              the same login — your ONE WAVE account and shop settings stay exactly as they are.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <PageSection
        title="Demo wallets"
        description="The same chain as a live shop: you load resellers, they load subresellers, customers buy vouchers."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {wallets.map((w) => (
            <Card key={w.id} className="shadow-[var(--shadow-card)]">
              <CardContent className="px-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{w.display_name}</p>
                  <StatusBadge tone="muted">{chainLabel[w.role] ?? w.role}</StatusBadge>
                </div>
                <p className="mt-2 text-lg font-semibold text-primary">
                  {Number(w.balance).toLocaleString()}{" "}
                  <span className="text-xs font-medium text-muted-foreground">Demo Coins</span>
                </p>
                {Number(w.points) > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {Number(w.points).toLocaleString()} demo points
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      </PageSection>

      <PageSection
        title="Load Demo Coins down the chain"
        action={
          <HelpTip
            title="Loading Coins"
            example="You load 300 Coins to Ana after she pays you ₱300. Ana then loads 100 Coins to Ben, her subreseller."
          >
            In a live shop, Coins move from your admin wallet to a reseller, and from a reseller to
            their subreseller. Money changes hands outside the app; the Coins move inside it.
          </HelpTip>
        }
      >
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="grid gap-3 px-4 sm:grid-cols-4">
            <div className="space-y-1.5">
              <Label>From</Label>
              <Select value={from} onValueChange={setFrom}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {wallets.map((w) => (
                    <SelectItem key={w.member_key} value={w.member_key}>
                      {w.display_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>To</Label>
              <Select value={to} onValueChange={setTo}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {wallets.map((w) => (
                    <SelectItem key={w.member_key} value={w.member_key}>
                      {w.display_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="demo-amount">Demo Coins</Label>
              <Input
                id="demo-amount"
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <Button
              className="self-end"
              disabled={busy || state.ended || !Number(amount)}
              onClick={() =>
                void run(
                  () => demoTransfer(state.ecosystem_id, from, to, Number(amount)),
                  "Demo Coins moved",
                )
              }
            >
              <ArrowRight className="mr-1 size-4" /> Load
            </Button>
          </CardContent>
        </Card>
      </PageSection>

      <PageSection
        title="Sell a WiFi voucher"
        action={
          <HelpTip
            title="Voucher sales and cashback"
            example="On a ₱50 voucher with a 10% reseller rate and a 4% subreseller rate, the subreseller earns 2, the reseller earns 3, and 45 stays with your shop."
          >
            The customer pays with Coins, the reseller chain earns cashback, and your shop keeps the
            remainder. The subreseller share always comes out of the reseller total.
          </HelpTip>
        }
      >
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="grid gap-3 px-4 sm:grid-cols-4">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Voucher</Label>
              <Select value={voucherId} onValueChange={setVoucherId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a voucher" />
                </SelectTrigger>
                <SelectContent>
                  {state.vouchers.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.name} — {Number(v.price)} Coins ({v.stock} left)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="demo-qty">Quantity</Label>
              <Input
                id="demo-qty"
                inputMode="numeric"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>
            <Button
              className="self-end"
              disabled={busy || state.ended || !voucherId}
              onClick={() =>
                void run(async () => {
                  const r = await demoSellVoucher(
                    state.ecosystem_id,
                    voucherId,
                    Number(quantity) || 1,
                  );
                  toast.message(
                    `Shop kept ${r.admin} · reseller ${r.reseller} · subreseller ${r.subreseller}`,
                  );
                }, "Simulated sale recorded")
              }
            >
              <ShoppingCart className="mr-1 size-4" /> Sell
            </Button>
          </CardContent>
        </Card>
      </PageSection>

      <GoLiveCard
        ecosystemId={state.ecosystem_id}
        shopName={state.name}
        onLive={() => {
          // Verified payment — continue in the live Admin console, not the demo.
          if (typeof window !== "undefined") window.location.assign("/admin");
        }}
      />

      <PageSection title="Demo ledger" description="Every simulated movement, newest first.">
        <Card className="shadow-[var(--shadow-card)]">
          <CardContent className="divide-y px-4">
            {state.ledger.length === 0 ? (
              <p className="py-3 text-sm text-muted-foreground">Nothing simulated yet.</p>
            ) : (
              state.ledger.map((e) => (
                <div key={e.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm">{e.reason}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {chainLabel[e.member_key] ?? e.member_key} ·{" "}
                      {new Date(e.created_at).toLocaleString()}
                    </p>
                  </div>
                  <p
                    className={
                      e.direction === "credit"
                        ? "text-sm font-semibold text-success"
                        : "text-sm font-semibold text-destructive"
                    }
                  >
                    {e.direction === "credit" ? "+" : "−"}
                    {Number(e.amount).toLocaleString()}
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </PageSection>

      <div className="mt-6 flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={busy || state.ended}
          onClick={() => void run(() => demoReset(state.ecosystem_id), "Simulation reset")}
        >
          <RotateCcw className="mr-1 size-4" /> Reset the simulation
        </Button>
        <Button asChild size="sm">
          <Link to="/admin">
            <Sparkles className="mr-1 size-4" /> Open the admin console
          </Link>
        </Button>
      </div>

      <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
        Ready to go live? Choose a plan above and pay it with GCash. Your login stays the same, this
        shop becomes your live account, Demo Coins are removed, and the plan&apos;s real Coin
        allocation is issued once.
      </p>
    </main>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-xl px-4 py-10">
      <Link to="/guide" className="text-xs font-medium text-primary">
        ← Back to the guide
      </Link>
      <h1 className="mt-4 text-xl font-semibold tracking-tight">Review shop</h1>
      <div className="mt-3">{children}</div>
    </main>
  );
}
